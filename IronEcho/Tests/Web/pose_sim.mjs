// A synthetic fighter in front of ONE webcam, with the faults MediaPipe really has in that setup, for testing the browser pose module
// (site/src/pose.js) without a person. Not a substitute for a real player: it only makes the known failure modes reproducible.
//
// Faults modelled (all switchable):
//  - depth compression: a limb that reaches toward the camera is estimated much shallower than it is (k = 0.4-0.6 of the true depth);
//  - occlusion: a forearm pointing at the camera hides the elbow behind the glove; MediaPipe then reports the elbow with low visibility
//    and a wandering position;
//  - noise: a few mm side to side, centimetres in depth; 30 frames per second with timestamp jitter and dropped frames.
//
// Body frame (metres): X forward to the camera, Y the person's right, Z up, origin between the hips. MediaPipe world:
// x = -Y, y = -Z, z = -X (what PoseLandmarker returns and pose.js turns back into the body frame).

const UPPER_ARM = 0.30;
const FOREARM = 0.27;
const THIGH = 0.45;
const SHIN = 0.44;
const SHOULDER_Z = 0.50;
const HEAD_Z = 0.66;
// wrist targets relative to the shoulder: [forward, inward (toward the midline), up]
const ARM = {
  guard: [0.24, 0.07, 0.16],
  punch: [0.54, 0.06, 0.06],
  body: [0.48, 0.05, -0.20],
  block: [0.17, 0.12, 0.30],
  // elbow strike: the hand stays by the head, the elbow swings across at shoulder height (wrist near the opposite shoulder)
  elbow: [0.22, 0.30, 0.10],
};

export function rng(seed) { let s = seed >>> 0 || 1; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
const smooth = (x) => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c); };
const lerp3 = (a, b, w) => [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w, a[2] + (b[2] - a[2]) * w];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// a two-bone chain from `root` toward `tip`, bent toward `pole`
function twoBone(root, tip, pole, l1, l2) {
  let axis = sub(tip, root);
  let d = len(axis);
  const reach = l1 + l2 - 1e-4;
  if (d > reach) { tip = add(root, mul(axis, reach / d)); axis = sub(tip, root); d = reach; }
  const u = mul(axis, 1 / Math.max(d, 1e-6));
  const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(l1 * l1 - along * along, 0));
  let perp = sub(pole, mul(u, dot(pole, u)));
  perp = mul(perp, 1 / Math.max(len(perp), 1e-6));
  return [add(add(root, mul(u, along)), mul(perp, h)), tip];
}

// An action script: [{ kind, start, side, ... }]. Envelope: rise over `up`, hold, fall over `down`.
function envelope(a, t) {
  const up = a.up ?? 0.15;
  const hold = a.hold ?? 0.06;
  const down = a.down ?? 0.22;
  const local = t - a.start;
  if (local < 0 || local > up + hold + down) return 0;
  if (local < up) return smooth(local / up);
  if (local < up + hold) return 1;
  return smooth((up + hold + down - local) / down);
}

export class Script {
  constructor() { this.actions = []; this.duration = 0; }
  _add(a) { this.actions.push(a); this.duration = Math.max(this.duration, a.start + (a.up ?? 0.15) + (a.hold ?? 0.06) + (a.down ?? 0.22) + (a.seconds ?? 0)); return this; }
  idle(start, seconds) { this.duration = Math.max(this.duration, start + seconds); return this; }
  // a straight punch (head) or `body: true` to the body; up = time to full extension
  punch(start, side, o = {}) { return this._add({ kind: 'punch', start, side, up: 0.15, hold: 0.06, down: 0.22, ...o }); }
  block(start, seconds) { return this._add({ kind: 'block', start, up: 0.15, hold: seconds - 0.3, down: 0.15 }); }
  slip(start, seconds, metres) { return this._add({ kind: 'slip', start, amount: metres, up: 0.15, hold: seconds - 0.3, down: 0.15 }); }
  leanForward(start, seconds, metres) { return this._add({ kind: 'lean', start, amount: metres, up: 0.25, hold: seconds - 0.5, down: 0.25 }); }
  // a kick: the leg straightens forward and up; `low` keeps the foot at knee height (a low kick)
  kick(start, side, o = {}) { return this._add({ kind: 'kick', start, side, up: 0.18, hold: 0.08, down: 0.28, ...o }); }
  // a knee strike: the knee drives up and forward, the shin hangs (heel stays under the knee)
  knee(start, side, o = {}) { return this._add({ kind: 'knee', start, side, up: 0.16, hold: 0.08, down: 0.24, ...o }); }
  // an elbow strike: the elbow swings across at shoulder height with the hand by the head
  elbow(start, side, o = {}) { return this._add({ kind: 'elbow', start, side, up: 0.13, hold: 0.05, down: 0.22, ...o }); }
  // the guard drifting: small random walk of the gloves, as a real person never stands still
  fidget(amount = 0.04) { this.fidgetAmount = amount; return this; }
}

// Faults: { depth: 0.5, occlusion: true, noise: 0.006, depthNoise: 0.02, fps: 30, jitterMs: 3, drop: 0.03, seed }
export function* stream(script, faults = {}) {
  const f = { depth: 1, occlusion: false, noise: 0.006, depthNoise: 0.012, fps: 30, jitterMs: 0, drop: 0, seed: 1, start: 0, ...faults };
  const r = rng(f.seed);
  const gauss = () => { let u = 0; for (let i = 0; i < 6; i++) u += r(); return (u - 3) / 0.7071; };
  const fid = [[0, 0, 0], [0, 0, 0]];
  const frames = Math.ceil(script.duration * f.fps) + 1;
  for (let i = 0; i < frames; i++) {
    const t = i / f.fps;
    // the guard random walk is advanced on every frame (also dropped ones) so it does not depend on the drop pattern
    if (script.fidgetAmount) for (const s of [0, 1]) for (let k = 0; k < 3; k++) fid[s][k] = 0.92 * fid[s][k] + 0.08 * script.fidgetAmount * 2.2 * gauss();
    if (f.drop && r() < f.drop) continue;
    const ts = f.start + t + (f.jitterMs ? (r() - 0.5) * 2 * f.jitterMs / 1000 : 0);
    yield { t: ts, world: frame(script, t, f, gauss, fid) };
  }
}

function frame(script, t, f, gauss, fid) {
  let lat = 0.012 * Math.sin(2 * Math.PI * 0.35 * t);
  let fwd = 0.008 * Math.sin(2 * Math.PI * 0.21 * t + 1);
  const arm = [{ w: 0, pose: null }, { w: 0, pose: null }];
  let block = 0;
  const leg = [{ kick: 0, low: false, knee: 0 }, { kick: 0, low: false, knee: 0 }];
  for (const a of script.actions) {
    const w = envelope(a, t);
    if (!w) continue;
    if (a.kind === 'slip') lat += a.amount * w;
    else if (a.kind === 'lean') fwd += a.amount * w;
    else if (a.kind === 'block') block = Math.max(block, w);
    else if (a.kind === 'punch' || a.kind === 'elbow') {
      if (w > arm[a.side].w) arm[a.side] = { w, pose: a.kind === 'elbow' ? ARM.elbow : a.body ? ARM.body : ARM.punch, kind: a.kind };
    } else if (a.kind === 'kick') { leg[a.side].kick = Math.max(leg[a.side].kick, w); leg[a.side].low = !!a.low; }
    else if (a.kind === 'knee') leg[a.side].knee = Math.max(leg[a.side].knee, w);
  }
  const P = new Array(33).fill(null).map(() => [0, 0, 0]);
  const vis = new Array(33).fill(0.98);
  // legs
  P[23] = [0, -0.11, 0]; P[24] = [0, 0.11, 0];
  for (const side of [0, 1]) {
    const sy = side === 0 ? -1 : 1;
    const hip = P[23 + side];
    let foot = [0, sy * 0.13, -0.88];
    let pole = [1, 0, 0]; // knees bend forward
    const L = leg[side];
    if (L.kick) { // straight leg up and forward (mid kick: foot at hip height; low kick: foot at knee height)
      const target = L.low ? [0.66, sy * 0.06, -0.54] : [0.78, sy * 0.02, -0.05]; // low: foot at the opponent's knee; mid: at hip height
      foot = lerp3(foot, target, L.kick);
    }
    let knee;
    if (L.knee) { // knee up to hip height in front, shin hanging back and down
      const kneeTarget = lerp3([0.03, sy * 0.12, -0.45], [0.40, sy * 0.06, -0.06], L.knee);
      knee = kneeTarget;
      foot = lerp3(foot, [0.20, sy * 0.06, -0.42], L.knee);
    } else {
      [knee, foot] = twoBone(hip, foot, pole, THIGH, SHIN);
    }
    P[25 + side] = knee; P[27 + side] = foot;
    P[29 + side] = add(foot, [-0.05, 0, -0.04]); P[31 + side] = add(foot, [0.12, 0, -0.05]);
  }
  // upper body, then lean (shear proportional to height)
  P[11] = [0, -0.19, SHOULDER_Z]; P[12] = [0, 0.19, SHOULDER_Z];
  P[0] = [0.10, 0, HEAD_Z];
  for (const [i, y] of [[1, -0.02], [2, -0.035], [3, -0.05], [4, 0.02], [5, 0.035], [6, 0.05]]) P[i] = [0.09, y, 0.69];
  P[7] = [0, -0.075, 0.67]; P[8] = [0, 0.075, 0.67]; P[9] = [0.085, -0.025, 0.62]; P[10] = [0.085, 0.025, 0.62];
  for (let i = 0; i <= 12; i++) { const z = P[i][2]; P[i][1] += lat * (z / HEAD_Z); P[i][0] += fwd * (z / HEAD_Z); }
  for (const side of [0, 1]) {
    const sy = side === 0 ? -1 : 1;
    const sh = P[11 + side];
    let target = lerp3(ARM.guard, ARM.block, block);
    const a = arm[side];
    if (a.w) target = lerp3(target, a.pose, a.w);
    target = add(target, mul(fid[side], 1));
    target = add(target, [0.008 * Math.sin(3.1 * t + side), 0.008 * Math.sin(2.3 * t + 2 * side), 0.008 * Math.sin(2.7 * t + side)]);
    const wristT = add(sh, [target[0], -sy * target[1], target[2]]);
    // an elbow strike lifts the elbow out to the side; otherwise it hangs down and out
    const pole = a.kind === 'elbow' && a.w > 0.2 ? [0.2, sy * 1.0, 0.25] : [0, sy * 0.6, -1];
    const [elbow, wrist] = twoBone(sh, wristT, pole, UPPER_ARM, FOREARM);
    P[13 + side] = elbow; P[15 + side] = wrist;
    const d = sub(wrist, elbow); const dl = Math.max(len(d), 1e-6);
    const u = mul(d, 1 / dl);
    P[17 + side] = add(add(wrist, mul(u, 0.07)), [0, sy * 0.02, 0]);
    P[19 + side] = add(wrist, mul(u, 0.08));
    P[21 + side] = add(add(wrist, mul(u, 0.05)), [0, -sy * 0.02, 0]);
  }
  // ---- MediaPipe faults ----
  if (f.depth !== 1) {
    // limbs toward the camera come out shallower than they are: compress their depth toward the torso plane
    const chains = [[11, [13, 15, 17, 19, 21]], [12, [14, 16, 18, 20, 22]], [23, [25, 27, 29, 31]], [24, [26, 28, 30, 32]]];
    for (const [root, idx] of chains) for (const i of idx) P[i][0] = P[root][0] + (P[i][0] - P[root][0]) * f.depth;
  }
  if (f.occlusion) {
    for (const side of [0, 1]) {
      const e = P[13 + side]; const w = P[15 + side];
      const d = sub(w, e); const dl = Math.max(len(d), 1e-6);
      // forearm pointing at the camera within ~45 degrees: the glove hides the elbow
      if (d[0] / dl > 0.7) { vis[13 + side] = 0.22; P[13 + side] = add(e, [gauss() * 0.04, gauss() * 0.04, gauss() * 0.04]); vis[15 + side] = 0.80; }
    }
  }
  const world = P.map((p, i) => {
    const n = [gauss() * f.noise, gauss() * f.noise, gauss() * (i >= 13 ? f.depthNoise : f.noise)];
    return { x: -(p[1] + n[1]), y: -(p[2] + n[2]), z: -(p[0] + n[0]), visibility: vis[i] };
  });
  return world;
}

// The web calibration as a player does it: guard 2.2 s, block, slip left, slip right; `punches` adds the punch step
// (a jab and a cross at the screen) when the page asks for it.
export function calibration(s = new Script(), { punches = true } = {}) {
  s.idle(0, 2.2);
  s.block(2.2, 1.6);
  s.idle(3.8, 0.4);
  s.slip(4.2, 1.1, -0.20);
  s.idle(5.3, 0.4);
  s.slip(5.7, 1.1, 0.20);
  s.idle(6.8, 1.0);
  let t = 7.8;
  if (punches) {
    // what the screen asks: two jabs, then two crosses, at the screen
    for (const side of [0, 0, 1, 1]) { s.punch(t, side); t += 0.9; }
    t += 0.6;
  }
  s.idle(t, 0.1);
  return { script: s, end: t };
}
