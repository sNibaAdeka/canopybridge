// IRON ECHO rules core in the page: the same C++ IronEchoRules the game uses, compiled to WebAssembly by
// Tools/Build/Web/build_web.py (proved bit-identical to the native build). If the host forbids WebAssembly, the
// wasm2js build of the very same module (globalThis.IronEchoCoreJS, inlined by the page) runs instead.

export const STATUS_LIVE = 7;
export const STATUS_NO_PERSON = 3;
export const STATUS_CALIBRATING = 6;

function readCString(buffer, ptr) {
  const bytes = new Uint8Array(buffer, ptr);
  let end = 0;
  while (bytes[end] !== 0) end++;
  return new TextDecoder().decode(bytes.subarray(0, end));
}

function indexOf(names) {
  const map = {};
  names.forEach((n, i) => { map[n] = i; });
  return map;
}

export async function loadCore() {
  let ex = null;
  let kind = '';
  const b64 = globalThis.IRONECHO_CORE_WASM_B64;
  if (b64 && typeof WebAssembly === 'object') {
    try {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const { instance } = await WebAssembly.instantiate(bytes, {});
      ex = instance.exports;
      kind = 'WebAssembly';
    } catch (err) {
      console.warn('[core] WebAssembly unavailable here, using the JS build of the same core:', err);
    }
  }
  if (!ex && globalThis.IronEchoCoreJS) {
    ex = globalThis.IronEchoCoreJS;
    kind = 'JS (wasm2js)';
  }
  if (!ex) throw new Error('IRON ECHO core is missing from the page');
  if (ex._initialize) ex._initialize();
  return new Core(ex, kind);
}

export class Core {
  constructor(ex, kind) {
    this.ex = ex;
    this.kind = kind;
    this.layout = JSON.parse(readCString(ex.memory.buffer, ex.ie_layout()));
    this.enums = this.layout.enums;
    this.matchIdx = indexOf(this.layout.match);
    this.fighterIdx = indexOf(this.layout.fighter);
    this.combatIdx = indexOf(this.layout.combatEvent);
    this.matchEvIdx = indexOf(this.layout.matchEvent);
    this.tickRate = this.layout.tickRate;
    this.matchCount = this.layout.match.length;
    this.fighterCount = this.layout.fighter.length;
  }

  init({ mode = 0, level = 1, seed = 1, rounds = 0, roundSeconds = 0 } = {}) {
    this.ex.ie_init(mode, level, seed, rounds, roundSeconds);
    this.ex.ie_clear_events();
  }

  // input: { status, lean, leanForward, block, punchMask, confidence, moveForward, moveSide }
  // punchMask bits: 1 jab, 2 cross, 4 jab to the body, 8 cross to the body.
  frame(dt, input) {
    return this.ex.ie_frame(dt, input.status, input.confidence ?? 1, input.lean ?? 0, input.leanForward ?? 0,
      input.block ?? 0, input.punchMask ?? 0, 1.0, input.moveForward ?? 0, input.moveSide ?? 0);
  }

  ringHalfSize() { return this.ex.ie_ring_half_size ? this.ex.ie_ring_half_size() : 2.95; }

  pause() { this.ex.ie_pause(); }
  resume() { this.ex.ie_resume(); }
  rematch() { this.ex.ie_rematch(); }
  alpha() { return this.ex.ie_alpha(); }

  _fighter(view, offset) {
    const f = {};
    this.layout.fighter.forEach((name, i) => { f[name] = view[offset + i]; });
    f.stateName = this.enums.state[f.state] || '?';
    f.stageName = this.enums.stage[f.stage] || '?';
    return f;
  }

  snapshot() {
    const view = new Float64Array(this.ex.memory.buffer, this.ex.ie_state(), this.ex.ie_state_size());
    const m = {};
    this.layout.match.forEach((name, i) => { m[name] = view[i]; });
    m.phaseName = this.enums.phase[m.phase] || '?';
    m.resumePhaseName = this.enums.phase[m.resumePhase] || '?';
    return {
      match: m,
      player: this._fighter(view, this.matchCount),
      opponent: this._fighter(view, this.matchCount + this.fighterCount),
    };
  }

  // Combat and match events produced since the last call (consumed).
  drainEvents() {
    const ex = this.ex;
    const cs = ex.ie_combat_event_size();
    const cn = ex.ie_combat_event_count();
    const cv = new Float64Array(ex.memory.buffer, ex.ie_combat_events(), cn * cs);
    const combat = [];
    for (let k = 0; k < cn; k++) {
      const e = {};
      this.layout.combatEvent.forEach((name, i) => { e[name] = cv[k * cs + i]; });
      e.typeName = this.enums.combatEvent[e.type] || '?';
      combat.push(e);
    }
    const ms = ex.ie_match_event_size();
    const mn = ex.ie_match_event_count();
    const mv = new Float64Array(ex.memory.buffer, ex.ie_match_events(), mn * ms);
    const match = [];
    for (let k = 0; k < mn; k++) {
      const e = {};
      this.layout.matchEvent.forEach((name, i) => { e[name] = mv[k * ms + i]; });
      e.typeName = this.enums.matchEvent[e.type] || '?';
      e.phaseName = this.enums.phase[e.phase] || '?';
      match.push(e);
    }
    ex.ie_clear_events();
    return { combat, match };
  }
}
