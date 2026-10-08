// A bout is recorded as the exact calls made to the rules core (frame by frame), so the rating server can play the very same bout
// again on its own copy of the core and find out who won: a claimed win means nothing without a replay that ends in one.
//
// Every call is quantised before it reaches the core (so recording and replaying see identical numbers): dt in 1/8192 s, the analogue
// inputs in 1/1000. Layout of a recording (little endian, then gzip on the wire):
//   'IER1' | u32 headerLength | header JSON (utf-8) | u32 rowCount | rowCount x 18 bytes
//   row: u8 op (0 frame, 1 pause, 2 resume) | u8 status | u8 punchMask | u8 kickMask | u16 dt | i16 x 6: confidence, lean, leanForward, block, moveForward, moveSide
export const REPLAY_MAGIC = 'IER1';
export const REPLAY_ROW = 18;
export const REPLAY_MAX_ROWS = 80000; // ~22 minutes at 60 frames per second (a long bout is ~6): longer ones are not rated, and the server never replays more
export const DT_UNIT = 8192;

const clampInt = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const q16 = (x) => clampInt(Math.round((Number.isFinite(x) ? x : 0) * 1000), -32000, 32000);

// What the core is called with, for one frame: quantised copies of the page's numbers.
export function quantizeFrame(dt, input) {
  const u = clampInt(Math.round((Number.isFinite(dt) ? dt : 0) * DT_UNIT), 1, 2048);
  const f = {
    u,
    dt: u / DT_UNIT,
    status: clampInt(input.status | 0, 0, 7),
    punch: clampInt((input.punchMask ?? 0) | 0, 0, 15),
    kick: clampInt((input.kickMask ?? 0) | 0, 0, 15),
    q: [input.confidence ?? 1, input.lean ?? 0, input.leanForward ?? 0, input.block ?? 0, input.moveForward ?? 0, input.moveSide ?? 0].map(q16),
  };
  return f;
}

// Back to the numbers the core receives (the same function runs on the page and on the server).
export function frameArgs(f) {
  return { dt: f.u / DT_UNIT, status: f.status, confidence: f.q[0] / 1000, lean: f.q[1] / 1000, leanForward: f.q[2] / 1000, block: f.q[3] / 1000,
    punchMask: f.punch, moveForward: f.q[4] / 1000, moveSide: f.q[5] / 1000, kickMask: f.kick };
}

export class BoutRecorder {
  constructor(header) {
    this.header = header;
    this.buf = new Uint8Array(REPLAY_ROW * 8192);
    this.view = new DataView(this.buf.buffer);
    this.rows = 0;
    this.overflow = false;
  }

  _room() {
    if ((this.rows + 1) * REPLAY_ROW > this.buf.length) {
      const bigger = new Uint8Array(this.buf.length * 2);
      bigger.set(this.buf);
      this.buf = bigger;
      this.view = new DataView(bigger.buffer);
    }
  }

  push(op, f) {
    if (this.rows >= REPLAY_MAX_ROWS) { this.overflow = true; return; }
    this._room();
    const o = this.rows * REPLAY_ROW;
    const v = this.view;
    v.setUint8(o, op);
    v.setUint8(o + 1, f ? f.status : 0);
    v.setUint8(o + 2, f ? f.punch : 0);
    v.setUint8(o + 3, f ? f.kick : 0);
    v.setUint16(o + 4, f ? f.u : 0, true);
    for (let i = 0; i < 6; i++) v.setInt16(o + 6 + i * 2, f ? f.q[i] : 0, true);
    this.rows++;
  }

  // The whole recording as bytes (not compressed).
  bytes() {
    const head = new TextEncoder().encode(JSON.stringify({ ...this.header, rows: this.rows }));
    const out = new Uint8Array(4 + 4 + head.length + 4 + this.rows * REPLAY_ROW);
    const v = new DataView(out.buffer);
    out.set(new TextEncoder().encode(REPLAY_MAGIC), 0);
    v.setUint32(4, head.length, true);
    out.set(head, 8);
    v.setUint32(8 + head.length, this.rows, true);
    out.set(this.buf.subarray(0, this.rows * REPLAY_ROW), 12 + head.length);
    return out;
  }
}

// Parse a recording; throws a short Error('...') on anything malformed.
export function parseReplay(bytes) {
  if (bytes.length < 16) throw new Error('too short');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (new TextDecoder().decode(bytes.subarray(0, 4)) !== REPLAY_MAGIC) throw new Error('not a recording');
  const hl = v.getUint32(4, true);
  if (hl > 4096 || 8 + hl + 4 > bytes.length) throw new Error('bad header');
  let header;
  try { header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + hl))); } catch { throw new Error('bad header'); }
  const rows = v.getUint32(8 + hl, true);
  if (rows > REPLAY_MAX_ROWS || 12 + hl + rows * REPLAY_ROW !== bytes.length) throw new Error('bad length');
  return { header, rows, view: v, offset: 12 + hl };
}

export function replayRow(parsed, i) {
  const v = parsed.view;
  const o = parsed.offset + i * REPLAY_ROW;
  return { op: v.getUint8(o), status: v.getUint8(o + 1), punch: v.getUint8(o + 2), kick: v.getUint8(o + 3), u: v.getUint16(o + 4, true),
    q: [0, 1, 2, 3, 4, 5].map((k) => v.getInt16(o + 6 + k * 2, true)) };
}

// Replays a recording on a fresh core and reports how the bout ended. `core` is a Core (core.js) already loaded; never throws for bad data:
// { ok: false, error } instead.
export function replayBout(core, parsed) {
  const h = parsed.header;
  core.recorder = null;
  core.init({ mode: 0, level: h.level, seed: h.seed, rounds: 0, roundSeconds: h.roundSeconds });
  let over = -1;
  for (let i = 0; i < parsed.rows; i++) {
    const r = replayRow(parsed, i);
    if (r.op === 0) {
      if (r.u < 1 || r.u > 2048 || r.status > 7 || r.punch > 15 || r.kick > 15) return { ok: false, error: 'bad frame ' + i };
      core.rawFrame(frameArgs(r));
    } else if (r.op === 1) core.pause();
    else if (r.op === 2) core.resume();
    else return { ok: false, error: 'bad op ' + i };
    if (core.snapshot().match.phaseName === 'MatchOver') { over = i; break; }
  }
  const m = core.snapshot().match;
  return { ok: true, finished: over >= 0, rowsUsed: over >= 0 ? over + 1 : parsed.rows, winner: m.hasWinner ? (m.winner === 0 ? 'player' : 'bot') : 'none',
    method: ['none', 'ko', 'decision', 'draw', 'tko'][m.result] || 'none', round: m.round, simTick: m.simTick, player: core.snapshot().player, opponent: core.snapshot().opponent };
}
