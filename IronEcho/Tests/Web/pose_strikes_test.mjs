// Camera strikes without a person: the browser pose module (site/src/pose.js) reads a synthetic fighter (pose_sim.mjs) that throws
// straight punches AT the camera, elbows, knees and kicks, then stands, blocks, slips and leans for a while (nothing may fire there).
// Run with the faults one webcam really has: depth compression, the elbow hidden behind the glove, noise, 30 fps, dropped frames.
//
//   node Tests/Web/pose_strikes_test.mjs
// Prints a table per fault set; fails when a strike type is detected less often than its floor, mistaken for another type, or fires
// on its own. The floors are set on this synthetic body; a real player must still try it (Docs/Testing/HUMAN_TRIALS.md, T9).
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '..', '..', 'Tools', 'Build', 'Web', 'site', 'src');
const { PoseProcessor } = await import(pathToFileURL(path.join(SRC, 'pose.js')));
const { Script, stream, calibration, rng } = await import(pathToFileURL(path.join(HERE, 'pose_sim.mjs')));
globalThis.setTimeout = () => 0; // the processor clears its "ready" message later; nothing to wait for here

const results = [];
const check = (name, ok, info = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`); };

// One session: calibration (with the punch step), then 64 strikes in random order, then 40 s of no strikes.
function session(faults, seed) {
  const { script, end } = calibration(new Script(), { punches: true });
  const r = rng(seed * 977 + 3);
  const kinds = [];
  for (let i = 0; i < 16; i++) kinds.push('punch', 'elbow', 'knee', i % 2 ? 'kick' : 'low');
  for (let i = kinds.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [kinds[i], kinds[j]] = [kinds[j], kinds[i]]; }
  const truth = [];
  let t = end + 1.0;
  for (const [i, kind] of kinds.entries()) {
    const side = i % 2;
    if (kind === 'punch') script.punch(t, side, { up: 0.11 + r() * 0.09, body: r() < 0.25 });
    if (kind === 'elbow') script.elbow(t, side, { up: 0.11 + r() * 0.05 });
    if (kind === 'knee') script.knee(t, side, { up: 0.14 + r() * 0.06 });
    if (kind === 'kick') script.kick(t, side, { up: 0.16 + r() * 0.06 });
    if (kind === 'low') script.kick(t, side, { up: 0.16 + r() * 0.06, low: true });
    truth.push({ t, side, kind });
    t += 1.1 + r() * 0.5;
  }
  const quiet = t + 0.8;
  t = quiet;
  for (let i = 0; i < 8; i++) {
    script.block(t, 1.0 + r() * 0.6); t += 2.4;
    script.slip(t, 0.7, (i % 2 ? 1 : -1) * 0.18); t += 1.4;
    if (i % 2) { script.leanForward(t, 1.2, 0.12); t += 1.8; }
  }
  script.idle(t, 1.0);
  script.fidget(0.03);
  const proc = new PoseProcessor(() => {}, {});
  for (const fr of stream(script, { ...faults, seed })) proc.process(fr.world, fr.t);
  // every detection as [t, side, kind]
  const det = [
    ...proc.punches.map(([pt, s]) => [pt, s, 'punch']),
    ...proc.elbows.map(([pt, s]) => [pt, s, 'elbow']),
    ...proc.kicks.map(([pt, s, k]) => [pt, s, k === 'mid' ? 'kick' : k]),
  ].filter(([pt]) => pt > end + 0.5).sort((a, b) => a[0] - b[0]);
  const used = new Set();
  const tally = {};
  for (const k of ['punch', 'elbow', 'knee', 'kick', 'low']) tally[k] = { of: 0, hit: 0, wrong: {} };
  for (const s of truth) {
    tally[s.kind].of++;
    const near = det.map((d, i) => [d, i]).filter(([d, i]) => !used.has(i) && d[0] >= s.t && d[0] <= s.t + 0.5 && d[1] === s.side);
    const right = near.find(([d]) => d[2] === s.kind);
    if (right) { used.add(right[1]); tally[s.kind].hit++; }
    else if (near.length) { const k = near[0][0][2]; tally[s.kind].wrong[k] = (tally[s.kind].wrong[k] || 0) + 1; used.add(near[0][1]); }
  }
  const extra = det.filter((d, i) => !used.has(i));
  return { cal: !!proc.cal, tally, extra, quietFrom: quiet, quietFalse: extra.filter(([pt]) => pt >= quiet).length, script };
}

const SETS = [
  ['clean 60 fps', { fps: 60 }],
  ['webcam 30 fps, jitter, drops', { fps: 30, jitterMs: 4, drop: 0.04, depthNoise: 0.02 }],
  ['frontal: depth 0.6 + hidden elbow', { fps: 30, jitterMs: 4, drop: 0.04, depthNoise: 0.02, depth: 0.6, occlusion: true }],
];
const FLOOR = { punch: 0.92, elbow: 0.85, knee: 0.85, kick: 0.85, low: 0.85 };
for (const [name, faults] of SETS) {
  const runs = [1, 2, 3].map((seed) => session(faults, seed));
  const sum = {};
  for (const k of Object.keys(FLOOR)) {
    sum[k] = { of: 0, hit: 0, wrong: {} };
    for (const r of runs) {
      sum[k].of += r.tally[k].of;
      sum[k].hit += r.tally[k].hit;
      for (const [w, n] of Object.entries(r.tally[k].wrong)) sum[k].wrong[w] = (sum[k].wrong[w] || 0) + n;
    }
  }
  const extra = runs.reduce((a, r) => a + r.extra.length, 0);
  const quietFalse = runs.reduce((a, r) => a + r.quietFalse, 0);
  console.log(`--- ${name}`);
  check(`${name}: calibration completes`, runs.every((r) => r.cal));
  for (const [k, v] of Object.entries(sum)) {
    const rate = v.hit / v.of;
    const wrong = Object.entries(v.wrong).map(([w, n]) => `${n} as ${w}`).join(', ');
    check(`${name}: ${k.padEnd(5)} detected ${v.hit}/${v.of}`, rate >= FLOOR[k], wrong || 'no confusions');
  }
  const quietList = runs.flatMap((r, i) => r.extra.filter(([pt]) => pt >= r.quietFrom).map(([pt, s, k]) => { const a = r.script.actions.filter((x) => x.start <= pt).pop(); return `seed ${i + 1}: ${k}${s} at ${pt.toFixed(2)} s, ${a ? `${(pt - a.start).toFixed(2)} s into a ${a.kind}` : ''}`; }));
  check(`${name}: nothing fires while blocking, slipping, leaning, standing`, quietFalse === 0, `${quietFalse} in the quiet part${quietList.length ? ': ' + quietList.join(', ') : ''}, ${extra} unmatched in all`);
  check(`${name}: few extra detections during the strikes`, extra - quietFalse <= 6, `${extra - quietFalse}`);
}

console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
