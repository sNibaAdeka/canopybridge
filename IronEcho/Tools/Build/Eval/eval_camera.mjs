// Camera accuracy from real recordings (Collection Mode, ?collect=1): every session file is replayed through the same strike detectors the
// game uses (site/src/pose.js, PoseProcessor), from the file's own calibration to the end, and every cue ("Хук левой — ДАВАЙ!") is scored:
//   HIT        a detection of the right strike, side and target inside [cue - 0.2 s, cue + window]
//   KIND       right strike and side, wrong target (head/body, mid/low)  — counted separately, not as a hit
//   WRONG      something else fired in the window (a hook read as a straight, the other hand…)
//   MISS       nothing fired
// plus false positives (detections outside every strike window), per minute of the idle/confounder blocks and overall, and the delay from
// the start of the movement (wrist/knee speed onset in the image) to the detection.
//
//   node Tools/Build/Eval/eval_camera.mjs <session files or folders...> [--md Docs/Testing/CAMERA_ACCURACY.md] [--json out.json] [--quiet]
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPose, decodeMasks } from '../../../Tests/Web/replay_trace.mjs';

export const EVAL_CFG = { before: 0.2, minWindow: 1.4, blockThreshold: 0.6, slipThreshold: 0.6, duckThreshold: 0.6, leanThreshold: 0.5, onsetShare: 0.3 };

// expected bits for a strike cue: [punchMask, kickMask]
export function expectedMask(c) {
  const s = c.side === 'R' ? 1 : 0;
  switch (c.kind) {
    case 'straight': return [c.target === 'body' ? 4 << s : 1 << s, 0];
    case 'elbow': return [16 << s, 0];
    case 'hook': return [c.target === 'body' ? 256 << s : 64 << s, 0];
    case 'upper': return [1024 << s, 0];
    case 'knee': return [0, 16 << s];
    case 'kick': return [0, c.target === 'low' ? 4 << s : 1 << s];
    default: return null;
  }
}
// the same strike and side regardless of target (straight head/body, hook head/body, kick mid/low)
function kindMask(c) {
  const s = c.side === 'R' ? 1 : 0;
  switch (c.kind) {
    case 'straight': return [(1 | 4) << s, 0];
    case 'hook': return [(64 | 256) << s, 0];
    case 'kick': return [0, (1 | 4) << s];
    default: return expectedMask(c);
  }
}
const STRIKE_KINDS = ['straight', 'hook', 'upper', 'elbow', 'knee', 'kick'];
const STATE_KINDS = ['block', 'slip', 'duck', 'lean'];

export function readSession(path) {
  const buf = readFileSync(path);
  const text = buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf).toString('utf8') : buf.toString('utf8');
  const s = JSON.parse(text);
  if (s.format !== 'ironecho-session') throw new Error(`${path}: not an IRON ECHO session file`);
  if (!Array.isArray(s.frames) || !Array.isArray(s.cues)) throw new Error(`${path}: frames or cues missing`);
  return s;
}

export function listSessionFiles(args) {
  const out = [];
  for (const a of args) {
    const st = statSync(a);
    if (st.isDirectory()) for (const f of readdirSync(a).sort()) { if (/^ironecho-session-.*\.json(\.gz)?$/.test(f)) out.push(join(a, f)); }
    else out.push(a);
  }
  return out;
}

const world = (w) => (w ? w.map(([x, y, z, v]) => ({ x, y, z, visibility: v })) : null);
const image = (i) => (i ? i.map(([x, y]) => ({ x, y })) : null);
const median = (a) => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };

// speed onset of the striking limb inside [from, to]: the first frame where the image speed passes onsetShare of the window's peak
function onsetTime(frames, cue, from, to) {
  const s = cue.side === 'R' ? 1 : 0;
  const idx = cue.kind === 'knee' ? 25 + s : cue.kind === 'kick' ? 27 + s : 15 + s;
  const pts = [];
  for (const f of frames) {
    if (f.t < from || f.t > to) continue;
    const p = f.i ? f.i[idx] : f.w ? f.w[idx] : null;
    if (p) pts.push([f.t, p[0], p[1]]);
  }
  const sp = [];
  for (let k = 1; k < pts.length; k++) {
    const dt = pts[k][0] - pts[k - 1][0];
    if (dt > 0) sp.push([pts[k][0], Math.hypot(pts[k][1] - pts[k - 1][1], pts[k][2] - pts[k - 1][2]) / dt]);
  }
  if (!sp.length) return null;
  const peak = Math.max(...sp.map((x) => x[1]));
  const hit = sp.find((x) => x[1] >= peak * EVAL_CFG.onsetShare);
  return hit ? hit[0] : null;
}

// Replays one session; returns per-cue scores, false positives and the calibration moment.
export function evaluateSession(PoseProcessor, session) {
  const proc = new PoseProcessor(() => {}, {});
  const detections = [];
  const states = [];
  let calibratedAt = null;
  for (const f of session.frames) {
    proc.process(world(f.w), f.t, image(f.i));
    const r = proc.poll();
    if (calibratedAt === null && proc.cal) calibratedAt = f.t;
    if (r.punchMask || r.kickMask) detections.push({ t: f.t, punch: r.punchMask, kick: r.kickMask, used: false });
    states.push({ t: f.t, block: r.block || 0, lean: r.lean || 0, duck: r.duck || 0, fwd: r.leanForward || 0, status: r.status });
  }
  const scored = [];
  const strikeWindows = [];
  for (const c of session.cues) {
    if (c.status !== 'ok' || c.t === null) continue;
    const win = Math.max(EVAL_CFG.minWindow, c.dur || 0);
    const from = c.t - EVAL_CFG.before;
    const to = c.t + win;
    if (STRIKE_KINDS.includes(c.kind)) {
      strikeWindows.push([from, to]);
      const [ep, ek] = expectedMask(c);
      const [kp, kk] = kindMask(c);
      const inWin = detections.filter((d) => d.t >= from && d.t <= to);
      const hit = inWin.find((d) => (d.punch & ep) || (d.kick & ek));
      const kindHit = !hit && inWin.find((d) => (d.punch & kp) || (d.kick & kk));
      let result = 'MISS';
      let det = null;
      if (hit) { result = 'HIT'; det = hit; } else if (kindHit) { result = 'KIND'; det = kindHit; } else if (inWin.length) { result = 'WRONG'; det = inWin[0]; }
      for (const d of inWin) d.used = true;
      const onset = det ? onsetTime(session.frames, c, from, det.t) : null;
      scored.push({ kind: c.kind, side: c.side, target: c.target, block: c.block, t: c.t, result,
        got: det ? decodeMasks(det.punch, det.kick).join('+') : '', delay: det ? det.t - c.t : null, fromOnset: det && onset !== null ? det.t - onset : null });
    } else if (STATE_KINDS.includes(c.kind)) {
      const st = states.filter((x) => x.t >= c.t && x.t <= to);
      let ok = false;
      if (c.kind === 'block') ok = st.some((x) => x.block >= EVAL_CFG.blockThreshold);
      if (c.kind === 'slip') ok = st.some((x) => (c.side === 'L' ? -x.lean : x.lean) >= EVAL_CFG.slipThreshold);
      if (c.kind === 'duck') ok = st.some((x) => x.duck >= EVAL_CFG.duckThreshold);
      if (c.kind === 'lean') ok = st.some((x) => x.fwd >= EVAL_CFG.leanThreshold);
      scored.push({ kind: c.kind, side: c.side, block: c.block, t: c.t, result: ok ? 'HIT' : 'MISS' });
    }
  }
  // false positives: detections outside every strike window
  const quiet = session.cues.filter((c) => (c.kind === 'idle' || c.kind === 'confound') && c.status === 'ok' && c.t !== null && c.block !== 'stance')
    .map((c) => [c.t, c.t + (c.hold || c.dur || 0)]);
  const quietSeconds = quiet.reduce((a, [x, y]) => a + (y - x), 0);
  const fps = detections.filter((d) => !d.used && !strikeWindows.some(([x, y]) => d.t >= x && d.t <= y) && (calibratedAt === null || d.t > calibratedAt + 1));
  const fpQuiet = fps.filter((d) => quiet.some(([x, y]) => d.t >= x && d.t <= y));
  const seenShare = session.frames.length ? session.frames.filter((f) => f.w).length / session.frames.length : 0;
  return { calibratedAt, scored, falsePositives: fps.map((d) => ({ t: d.t, what: decodeMasks(d.punch, d.kick).join('+') })),
    fpQuiet: fpQuiet.length, quietSeconds, seenShare, frames: session.frames.length };
}

// Tables over all sessions: by kind and condition (and overall)
export function aggregate(results) {
  const rows = {};
  const add = (key, s) => {
    const r = rows[key] || (rows[key] = { n: 0, HIT: 0, KIND: 0, WRONG: 0, MISS: 0, delays: [], fromOnset: [], confusions: {} });
    r.n++; r[s.result]++;
    if (s.delay !== null && s.delay !== undefined && s.result === 'HIT') r.delays.push(s.delay);
    if (s.fromOnset !== null && s.fromOnset !== undefined && s.result === 'HIT') r.fromOnset.push(s.fromOnset);
    if (s.result === 'WRONG' || s.result === 'KIND') r.confusions[s.got] = (r.confusions[s.got] || 0) + 1;
  };
  let quietSeconds = 0;
  let fpQuiet = 0;
  let fpAll = 0;
  for (const res of results) {
    const cond = res.condition || '?';
    for (const s of res.eval.scored) { add(`${s.kind}|${cond}`, s); add(`${s.kind}|all`, s); }
    quietSeconds += res.eval.quietSeconds;
    fpQuiet += res.eval.fpQuiet;
    fpAll += res.eval.falsePositives.length;
  }
  const table = Object.entries(rows).map(([key, r]) => {
    const [kind, cond] = key.split('|');
    return { kind, cond, n: r.n, hit: r.HIT / r.n, kindOnly: r.KIND / r.n, wrong: r.WRONG / r.n, miss: r.MISS / r.n,
      delayMs: r.delays.length ? Math.round(median(r.delays) * 1000) : null, fromOnsetMs: r.fromOnset.length ? Math.round(median(r.fromOnset) * 1000) : null,
      confusions: Object.entries(r.confusions).sort((a, b) => b[1] - a[1]).slice(0, 3) };
  }).sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.cond < b.cond ? -1 : a.cond > b.cond ? 1 : 0));
  return { table, fpPerQuietMinute: quietSeconds > 0 ? fpQuiet / (quietSeconds / 60) : null, fpQuiet, fpAll, quietSeconds };
}

const pct = (x) => `${Math.round(x * 100)}%`;
export function markdown(agg, results, meta = {}) {
  const lines = [];
  lines.push('# Точность камеры на реальных записях', '');
  lines.push(`Сгенерировано: ${meta.date || new Date().toISOString().slice(0, 10)} · сборка правил распознавания: ${meta.version || '?'} · записей: ${results.length}` +
    ` · участников: ${new Set(results.map((r) => r.participant)).size}`, '');
  lines.push('Как читать: «попал» — тот удар, той рукой, в ту цель; «вид верный» — удар и рука верные, цель (голова/корпус) нет; «перепутал» — сработало другое; «пропуск» — ничего.', '');
  lines.push('| Удар | Условие | Просили | Попал | Вид верный | Перепутал | Пропуск | Задержка от команды, мс | От начала движения, мс | Чаще всего вместо |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const r of agg.table) {
    lines.push(`| ${r.kind} | ${r.cond} | ${r.n} | ${pct(r.hit)} | ${pct(r.kindOnly)} | ${pct(r.wrong)} | ${pct(r.miss)} | ${r.delayMs ?? '–'} | ${r.fromOnsetMs ?? '–'} | ${r.confusions.map(([k, v]) => `${k} ×${v}`).join(', ') || '–'} |`);
  }
  lines.push('', `Ложные срабатывания: ${agg.fpQuiet} за ${Math.round(agg.quietSeconds)} с спокойных блоков (${agg.fpPerQuietMinute === null ? '–' : agg.fpPerQuietMinute.toFixed(2)} в минуту); всего вне окон ударов: ${agg.fpAll}.`, '');
  lines.push('## Записи', '', '| Файл | Участник | Условие | Кадров | Человек виден | Калибровка |', '|---|---|---|---|---|---|');
  for (const r of results) lines.push(`| ${r.file} | ${r.participant} | ${r.condition} | ${r.eval.frames} | ${pct(r.eval.seenShare)} | ${r.eval.calibratedAt === null ? 'не прошла' : `${r.eval.calibratedAt.toFixed(1)} с`} |`);
  return `${lines.join('\n')}\n`;
}

export async function evaluateFiles(files) {
  const { PoseProcessor } = await loadPose();
  return files.map((file) => {
    const s = readSession(file);
    return { file: file.split('/').pop(), participant: (s.participant && s.participant.id) || '?', condition: (s.condition && s.condition.id) || '?',
      game: s.game || '', eval: evaluateSession(PoseProcessor, s) };
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
  const md = opt('--md');
  const json = opt('--json');
  const quiet = args.includes('--quiet');
  const inputs = args.filter((a) => !a.startsWith('--'));
  if (!inputs.length) { console.error('usage: node Tools/Build/Eval/eval_camera.mjs <session files or folders> [--md out.md] [--json out.json]'); process.exit(2); }
  const files = listSessionFiles(inputs);
  const results = await evaluateFiles(files);
  const agg = aggregate(results);
  const text = markdown(agg, results, { version: results[0] ? results[0].game : '' });
  if (md) writeFileSync(md, text);
  if (json) writeFileSync(json, `${JSON.stringify({ aggregate: agg, results: results.map((r) => ({ ...r, eval: { ...r.eval } })) }, null, 1)}\n`);
  if (!quiet) console.log(text);
}
