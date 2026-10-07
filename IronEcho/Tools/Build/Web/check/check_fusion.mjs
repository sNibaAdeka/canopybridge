// Checks PoseFusion on a synthetic moving body seen by two cameras with realistic noise:
//   - camera A at 60 fps in the world frame, camera B at 30 fps, turned by an arbitrary 3-D rotation (yaw 80 deg, tilted),
//     its clock shifted by 137 ms, its depth noisier than its lateral axes;
//   - the fused skeleton must be closer to the truth than camera A alone (wrist depth especially), must recover the
//     rotation and the time offset, and must survive camera B going away and a mirrored (wrong) second stream.
// Usage: node check_fusion.mjs   (exit code 1 on failure)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, '..', 'site', 'src', 'fusion.js'), 'utf8').replace(/^export\s+/gm, '');
const { PoseFusion } = new Function(`${src}; return { PoseFusion };`)();

// deterministic noise
let seed = 12345;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const gauss = () => { let u = 0; while (u === 0) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };

// ground truth: a standing body (y down, hip origin) with punching wrists, bobbing head and kicking ankles
function body(t) {
  const p = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0 }));
  const set = (i, x, y, z) => { p[i] = { x, y, z }; };
  const sway = 0.04 * Math.sin(2 * Math.PI * 0.7 * t);
  const punch = (phase, f) => Math.max(0, Math.sin(2 * Math.PI * f * t + phase)) ** 3;
  const jabL = punch(0, 1.3); const jabR = punch(2, 1.1);
  const lift = (phase) => 0.35 * Math.max(0, Math.sin(2 * Math.PI * 0.45 * t + phase)) ** 4;
  set(0, sway, -0.62, 0.05); set(7, sway + 0.08, -0.6, 0.0); set(8, sway - 0.08, -0.6, 0.0);
  set(11, 0.19, -0.42, 0); set(12, -0.19, -0.42, 0);
  set(13, 0.22, -0.2, 0.12 + 0.2 * jabL); set(14, -0.22, -0.2, 0.12 + 0.2 * jabR);
  set(15, 0.2 + 0.02 * jabL, -0.35 + 0.1 * jabL, 0.25 + 0.55 * jabL); set(16, -0.2, -0.35 + 0.1 * jabR, 0.25 + 0.55 * jabR);
  set(23, 0.1, 0, 0); set(24, -0.1, 0, 0);
  set(25, 0.12, 0.4, 0.05); set(26, -0.12, 0.4, 0.05);
  set(27, 0.13, 0.8 - lift(0), 0.05 + 0.5 * lift(0) / 0.35 * 0.3); set(28, -0.13, 0.8 - lift(3), 0.05 + 0.5 * lift(3) / 0.35 * 0.3);
  return p;
}

// rotation matrices: yaw about y, pitch about x
const rotY = (a) => [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)];
const rotX = (a) => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
const mul = (A, B) => { const C = new Array(9).fill(0); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) C[i * 3 + j] += A[i * 3 + k] * B[k * 3 + j]; return C; };
const tr = (A) => [A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]];
const app = (R, p) => ({ x: R[0] * p.x + R[1] * p.y + R[2] * p.z, y: R[3] * p.x + R[4] * p.y + R[5] * p.z, z: R[6] * p.x + R[7] * p.y + R[8] * p.z });

const R_BA = mul(rotY((80 * Math.PI) / 180), rotX((-12 * Math.PI) / 180)); // true B -> A
const R_AB = tr(R_BA);
const OFFSET = 0.137; // B stamped tB corresponds to A time tB + OFFSET... generated below as tB = tA - OFFSET
const SL = 0.012; const SD = 0.045;

function view(truth, R, mirror = false) {
  // observe in camera axes with anisotropic noise: lateral (x, y) small, depth (z) large
  return truth.map((p) => {
    const q = app(R, p);
    if (mirror) q.x = -q.x;
    return { x: q.x + SL * gauss(), y: q.y + SL * gauss(), z: q.z + SD * gauss(), visibility: 0.95 };
  });
}

function run({ seconds = 24, bGoesAwayAt = null, mirrored = false, waitBudget = 0.5 }) {
  const out = [];
  const fusion = new PoseFusion((t, world, info) => out.push({ t, world, mode: info.mode }), { waitBudget });
  const events = [];
  for (let k = 0; k < seconds * 60; k++) events.push({ t: k / 60, cam: 'A' });
  for (let k = 0; k < seconds * 30; k++) events.push({ t: k / 30 + 0.004 * gauss(), cam: 'B' });
  // delivery order: A arrives 15 ms after capture, B 120 ms after its capture (the phone stream)
  const delivery = events.map((e) => ({ ...e, at: e.t + (e.cam === 'A' ? 0.015 : 0.12) })).sort((a, b) => a.at - b.at);
  for (const e of delivery) {
    const truth = body(e.t);
    if (e.cam === 'A') fusion.pushA(e.t, view(truth, new Array(9).fill(0).map((_, i) => (i % 4 === 0 ? 1 : 0))));
    else {
      if (bGoesAwayAt !== null && e.t > bGoesAwayAt) continue;
      // B's own clock reads tA - OFFSET for the same instant
      fusion.pushB(e.t - OFFSET, view(truth, R_AB, mirrored));
    }
  }
  return { out, fusion };
}

function rmse(out, pick, from = 8) {
  let s = 0; let n = 0;
  for (const o of out) {
    if (o.t < from || !o.world) continue;
    const tr0 = body(o.t);
    for (const i of [15, 16, 27, 28]) { const d = pick(o.world[i], tr0[i]); s += d * d; n++; }
  }
  return Math.sqrt(s / Math.max(1, n));
}

let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}  ${detail}`); if (!ok) failed++; };

// 1. fused vs camera A alone (the same noise realisation is not shared, so compare statistically)
{
  const { out, fusion } = run({});
  const fused = out.filter((o) => o.mode === 'ab');
  const aOnly = (() => {
    const o2 = [];
    const f2 = new PoseFusion((t, w, info) => o2.push({ t, world: w, mode: info.mode }));
    for (let k = 0; k < 24 * 60; k++) f2.pushA(k / 60, view(body(k / 60), [1, 0, 0, 0, 1, 0, 0, 0, 1]));
    return o2;
  })();
  const eAll = (o) => rmse(o, (p, q) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z));
  const eDepth = (o) => rmse(o, (p, q) => p.z - q.z);
  const ef = eAll(out); const ea = eAll(aOnly);
  const df = eDepth(out); const da = eDepth(aOnly);
  check('fused mode reached', fused.length > out.length * 0.8, `${fused.length}/${out.length} frames fused`);
  check('3-D error lower than camera A alone', ef < ea * 0.7, `fused ${(ef * 100).toFixed(2)} cm vs A ${(ea * 100).toFixed(2)} cm`);
  check('depth error lower than camera A alone', df < da * 0.5, `fused ${(df * 100).toFixed(2)} cm vs A ${(da * 100).toFixed(2)} cm`);
  const offErr = Math.abs(fusion.info.offsetMs - OFFSET * 1000);
  // B's clock reads tA - OFFSET, so the correction that maps it to A's time is +OFFSET
  check('time offset recovered', offErr < 15, `estimated ${fusion.info.offsetMs.toFixed(1)} ms, true ${OFFSET * 1000} ms`);
  // rotation: apply R to the unit axes, compare with the truth
  const dev = (() => {
    let worst = 0;
    for (const e of [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }]) {
      const a = app(fusion.R || [1,0,0,0,1,0,0,0,1], e); const b = app(R_BA, e);
      worst = Math.max(worst, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
    }
    return worst;
  })();
  check('rotation B->A recovered', dev < 0.04, `worst axis error ${dev.toFixed(4)} (angle ${(fusion.info.angleDeg ?? -1).toFixed(1)} deg)`);
}

// 2. latency budget: the output keeps camera A's rate (60 Hz) while waiting for B, and never lags A beyond the budget
{
  const { out } = run({ waitBudget: 0.15 });
  const span = out[out.length - 1].t - 8;
  const rate = out.filter((o) => o.t > 8).length / span;
  const modes = out.filter((o) => o.t > 8).reduce((m, o) => { m[o.mode] = (m[o.mode] || 0) + 1; return m; }, {});
  check('output keeps camera A rate', rate > 55, `${rate.toFixed(1)} Hz, modes ${JSON.stringify(modes)}`);
}

// 3. camera B disappears: the output goes on from A alone
{
  const { out } = run({ bGoesAwayAt: 12 });
  const late = out.filter((o) => o.t > 15);
  check('survives camera B loss', late.length > 8 * 40 && late.every((o) => o.mode === 'a'), `${late.length} frames after loss, modes ${[...new Set(late.map((o) => o.mode))]}`);
}

// 4. a mirrored second stream cannot be aligned: it is ignored, not blended in
{
  const { out, fusion } = run({ mirrored: true });
  const fusedShare = out.filter((o) => o.t > 10 && o.mode === 'ab').length / out.filter((o) => o.t > 10).length;
  check('mirrored stream rejected', fusedShare < 0.1, `fit rms ${(fusion.info.rmsCm ?? -1).toFixed(1)} cm, fused share ${(fusedShare * 100).toFixed(0)}%`);
}

if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log('fusion checks passed');
