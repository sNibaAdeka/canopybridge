// The whole scripted session of synthetic_session.py (calibration, 40 punches, 4 kicks, a block, a step in) seen with
// realistic noise and fed through the real PoseProcessor, first from camera A alone, then from A + a second camera B
// through PoseFusion (B turned 70 deg with a tilt, its stream 130 ms late and at 30 fps, noisier along its viewing ray).
//   python synthetic_session.py session.json && node check_fusion_session.mjs session.json
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const load = (name) => import('data:text/javascript;base64,' + Buffer.from(readFileSync(join(here, '..', 'site', 'src', name), 'utf8')).toString('base64'));
const { PoseProcessor } = await load('pose.js');
const { PoseFusion } = await load('fusion.js');
const session = JSON.parse(readFileSync(process.argv[2], 'utf8'));
// the phone is connected before the player starts calibrating: ~6.6 s of standing still (the first 2.2 s of the script, three
// times) let the fusion find the angle between the cameras first (the time offset needs movement and is found during calibration)
const PRE = 6.6;
const idle = session.filter((f) => f.t < 2.2);
const frames = [
  ...[0, 1, 2].flatMap((rep) => idle.map((f) => ({ t: f.t + rep * 2.2, w: f.w }))),
  ...session.map((f) => ({ t: f.t + PRE, w: f.w })),
];

let seed = 99;
const reseed = (v) => { seed = v; };
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const gauss = () => { let u = 0; while (u === 0) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };
const rotY = (a) => [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)];
const rotX = (a) => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
const mul = (A, B) => { const C = new Array(9).fill(0); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) C[i * 3 + j] += A[i * 3 + k] * B[k * 3 + j]; return C; };
const tr = (A) => [A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]];
const R_AB = tr(mul(rotY((70 * Math.PI) / 180), rotX((-10 * Math.PI) / 180)));
const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const SL = Number(process.env.LATERAL_SIGMA || 0.006); const SD = Number(process.env.DEPTH_SIGMA || 0.025);

// a camera's noisy view of the true skeleton w ([x, y, z, vis] rows) in that camera's axes
const view = (w, R) => w.map(([x, y, z, v]) => ({
  x: R[0] * x + R[1] * y + R[2] * z + SL * gauss(),
  y: R[3] * x + R[4] * y + R[5] * z + SL * gauss(),
  z: R[6] * x + R[7] * y + R[8] * z + SD * gauss(),
  visibility: v,
}));

function run(useB) {
  const proc = new PoseProcessor(() => {}, {});
  const fusion = new PoseFusion((t, world) => proc.process(world, t));
  const events = [];
  frames.forEach((f, i) => {
    events.push({ at: f.t + 0.015, cam: 'A', t: f.t, f });
    if (useB && i % 2 === 0) events.push({ at: f.t + 0.13, cam: 'B', t: f.t - 0.13 + 0.004 * gauss(), f }); // B's clock reads 130 ms early
  });
  events.sort((a, b) => a.at - b.at);
  for (const e of events) {
    const w = e.f.w;
    if (e.cam === 'A') fusion.pushA(e.t, w ? view(w, I3) : null);
    else fusion.pushB(e.t, w ? view(w, R_AB) : null);
  }
  return { proc, fusion };
}

const trueTimes = (() => { // when the script punches / kicks (8.0 + 0.9 k ... see synthetic_session.py)
  const punches = Array.from({ length: 40 }, (_, k) => PRE + 8.0 + k * 0.9);
  const t0 = PRE + 8.0 + 40 * 0.9 + 0.8;
  const kicks = [0, 1, 2, 3].map((k) => t0 + k * 1.1);
  return { punches, kicks };
})();
const hits = (events, truth, tol = 0.45) => { // matched true events, and detections that match nothing
  let matched = 0; const used = new Set();
  for (const tt of truth) { const i = events.findIndex((e, j) => !used.has(j) && Math.abs(e[0] - tt) <= tol); if (i >= 0) { used.add(i); matched++; } }
  return { matched, extra: events.length - used.size };
};

let failed = 0;
for (const sd of [99, 7, 2024]) {
  for (const [name, useB] of [['camera A alone', false], ['A + camera B fused', true]]) {
    reseed(sd);
    const { proc, fusion } = run(useB);
    const p = hits(proc.punches, trueTimes.punches);
    const k = hits(proc.kicks, trueTimes.kicks, 0.6);
    console.log(`seed ${String(sd).padEnd(4)} ${name.padEnd(20)} calibrated ${!!proc.cal}  punches ${p.matched}/40 (+${p.extra} false)  kicks ${k.matched}/4 (+${k.extra} false)` +
      (useB ? `  offset ${fusion.info.offsetMs.toFixed(0)} ms  fit ${fusion.info.rmsCm.toFixed(1)} cm  angle ${fusion.info.angleDeg.toFixed(0)} deg` : ''));
    if (useB && (!proc.cal || p.matched < 36 || p.extra > 2 || k.matched < 3)) failed++;
  }
}
if (failed) { console.error(`fused session below the bar in ${failed} run(s)`); process.exit(1); }
console.log('fused session OK');
