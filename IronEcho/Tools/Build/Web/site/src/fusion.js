// Two cameras, one skeleton.
//
// Each camera gives MediaPipe "world" landmarks: metres, origin at the hip middle, axes aligned with THAT camera
// (x across the image, y down the image, z along the viewing direction). A single camera measures x and y well and the
// depth z poorly (about 3-4 times worse), which is why punches toward the screen and kicks are the shaky part of a
// webcam pose. A second camera standing to the side sees exactly that depth as its own lateral axis.
//
// PoseFusion takes the two streams (each frame carries the time its camera captured/received it) and emits one skeleton
// in the frame of camera A:
//   1. rotation  B -> A: a full 3-D rotation (Horn's closed-form absolute orientation: unit quaternion from the largest
//                eigenvector of a 4x4 matrix) fitted continuously to the two skeletons, so a phone that is tilted, on a
//                shelf or turned by any angle needs no placement guide. If the fit stays poor (a mirrored stream, a
//                different person in the other view) the second camera is ignored instead of corrupting the pose;
//   2. time      offset of B against A: positions of wrists, ankles and head from both cameras (rotated into one frame)
//                are compared at shifted times; the shift with the smallest difference wins, re-estimated every second
//                while the person moves. The rotation and the offset are found from the same data, one refining the
//                other, with no clap or marker needed;
//   3. merge     per landmark, optimal linear fusion: each camera contributes an information matrix strong across its
//                image and weak along its viewing ray, so depth comes from the camera that sees it across its image;
//   4. loss      if one camera loses the person (a punch hides the arm, somebody walks by) the other one carries on;
//   5. latency   the output follows A's clock. B is waited for at most `waitBudget` seconds (a phone stream arrives
//                100-250 ms after the capture); when it is later than that the frame is A alone, so the second camera
//                can never add more than that much delay to the controls.
const FUSION_CFG = {
  sigmaLateral: 0.012,    // m, noise of a world landmark across the image
  sigmaDepth: 0.045,      // m, noise along the viewing ray
  minVisibility: 0.3,
  maxGap: 0.25,           // s: no interpolation across a longer hole
  staleAfter: 0.4,        // s: a stream silent for this long is treated as lost
  alignLandmarks: [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28],
  alignVisibility: 0.6,
  alignDecay: 0.9985,     // per sample: the estimate follows a phone that was moved (half-life ~7 s at 30 fps)
  alignMinSamples: 150,
  alignMaxRms: 0.20,      // m: a fit worse than this means "not the same body" (real MediaPipe depth noise is large): camera B is ignored
  alignMinRms: 0.16,      // m: ... and it is trusted again only below this (hysteresis)
  timeLandmarks: [0, 15, 16, 27, 28],
  timeWindow: 5.0,        // s of A history compared
  timeRange: 0.9,         // s, searched shift +- (a phone's video reaches the page 0.2-0.5 s after the capture)
  timeStep: 0.01,
  timeEvery: 1.0,         // s between estimates
  timeMinMotion: 0.06,    // m: rms movement of the compared landmarks needed to trust an estimate
  timeSmoothing: 0.4,
  waitBudget: 0.15,       // s: how long the output may wait for the other camera
  buffer: 12.0,           // s of frames kept
  emitEvery: 0.012,       // s: no more than ~80 fused skeletons per second
};

const fuseLerp = (a, b, k) => a + (b - a) * k;

// the landmarks at time t (interpolated); null: a hole, nobody seen, or t outside the buffered frames
function fuseSample(buf, t) {
  const n = buf.length;
  if (!n || t < buf[0].t - 1e-6) return null;
  let hi = n - 1;
  while (hi > 0 && buf[hi - 1].t >= t) hi--;
  if (buf[hi].t < t - 1e-6) return null; // later than the newest frame
  const b = buf[hi];
  if (hi === 0) return b.t - t < 1e-6 && b.w ? b.w : null;
  const a = buf[hi - 1];
  if (!a.w || !b.w || b.t - a.t > FUSION_CFG.maxGap) return null;
  const k = (t - a.t) / Math.max(1e-6, b.t - a.t);
  return a.w.map((p, i) => ({
    x: fuseLerp(p.x, b.w[i].x, k), y: fuseLerp(p.y, b.w[i].y, k), z: fuseLerp(p.z, b.w[i].z, k),
    visibility: Math.min(p.visibility ?? 1, b.w[i].visibility ?? 1),
  }));
}

// largest eigenvector of a symmetric 4x4 matrix (cyclic Jacobi); returns [w, x, y, z]
function fuseTopEigenvector(N) {
  const A = N.map((r) => r.slice());
  const V = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
  for (let sweep = 0; sweep < 24; sweep++) {
    let off = 0;
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) off += A[i][j] * A[i][j];
    if (off < 1e-18) break;
    for (let p = 0; p < 3; p++) {
      for (let q = p + 1; q < 4; q++) {
        if (Math.abs(A[p][q]) < 1e-30) continue;
        const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < 4; k++) {
          const akp = A[k][p]; const akq = A[k][q];
          A[k][p] = c * akp - s * akq; A[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 4; k++) {
          const apk = A[p][k]; const aqk = A[q][k];
          A[p][k] = c * apk - s * aqk; A[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 4; k++) {
          const vkp = V[k][p]; const vkq = V[k][q];
          V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  let best = 0;
  for (let i = 1; i < 4; i++) if (A[i][i] > A[best][best]) best = i;
  return [V[0][best], V[1][best], V[2][best], V[3][best]];
}

// unit quaternion [w, x, y, z] -> row-major 3x3 rotation
function fuseQuatMatrix(q) {
  const [w, x, y, z] = q;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y),
  ];
}

const fuseApply = (R, p) => ({
  x: R[0] * p.x + R[1] * p.y + R[2] * p.z,
  y: R[3] * p.x + R[4] * p.y + R[5] * p.z,
  z: R[6] * p.x + R[7] * p.y + R[8] * p.z,
  visibility: p.visibility,
});

function fuseInverse3(m) { // symmetric 3x3 [a b c; b d e; c e f] -> same layout inverse
  const [a, b, c, d, e, f] = m;
  const A = d * f - e * e; const B = c * e - b * f; const C = b * e - c * d;
  const det = a * A + b * B + c * C;
  return [A / det, B / det, C / det, (a * f - c * c) / det, (b * c - a * e) / det, (a * d - b * b) / det];
}

export class PoseFusion {
  constructor(onFused = () => {}, opts = {}) {
    this.cfg = { ...FUSION_CFG, ...opts };
    this.onFused = onFused;
    this.a = [];
    this.b = [];
    this.S = new Array(9).fill(0); // decayed sum of b_j * a_k
    this.alignN = 0;
    this.R = null;                 // row-major 3x3, B -> A
    this.rms = null;               // m, smoothed residual of the rotation fit
    this.usable = false;           // R known and the fit is good: B may be merged
    this.offset = 0;               // s: a frame of B stamped tB corresponds to A time tB + offset
    this.offsetKnown = false;
    this.lastTimeEstimate = -1e9;
    this.lastOut = -1e9;
    this.lastLearn = -1e9;
    this.aliveA = false;
    this.aliveB = false;
    this.info = { mode: 'a', offsetMs: 0, rmsCm: null, usable: false, angleDeg: null };
  }

  pushA(t, world) { this._push(this.a, t, world); this._step(); }
  pushB(t, world) { this._push(this.b, t, world); this._step(); }

  _push(buf, t, world) {
    if (buf.length && t <= buf[buf.length - 1].t) return; // clocks must go forward
    buf.push({ t, w: world });
    while (buf.length && t - buf[0].t > this.cfg.buffer) buf.shift();
  }

  _align(wa, wb) {
    const C = this.cfg;
    const S = this.S;
    let sq = 0;
    let cnt = 0;
    for (const i of C.alignLandmarks) {
      const va = wa[i].visibility ?? 1;
      const vb = wb[i].visibility ?? 1;
      if (va < C.alignVisibility || vb < C.alignVisibility) continue;
      const w = va * vb;
      const a = wa[i]; const b = wb[i];
      S[0] = S[0] * C.alignDecay + w * b.x * a.x; S[1] = S[1] * C.alignDecay + w * b.x * a.y; S[2] = S[2] * C.alignDecay + w * b.x * a.z;
      S[3] = S[3] * C.alignDecay + w * b.y * a.x; S[4] = S[4] * C.alignDecay + w * b.y * a.y; S[5] = S[5] * C.alignDecay + w * b.y * a.z;
      S[6] = S[6] * C.alignDecay + w * b.z * a.x; S[7] = S[7] * C.alignDecay + w * b.z * a.y; S[8] = S[8] * C.alignDecay + w * b.z * a.z;
      this.alignN++;
      if (this.R) {
        const r = fuseApply(this.R, b);
        sq += (r.x - a.x) ** 2 + (r.y - a.y) ** 2 + (r.z - a.z) ** 2;
        cnt++;
      }
    }
    if (this.alignN >= C.alignMinSamples) {
      const [Sxx, Sxy, Sxz, Syx, Syy, Syz, Szx, Szy, Szz] = S;
      const q = fuseTopEigenvector([
        [Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx],
        [Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz],
        [Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy],
        [Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz],
      ]);
      this.R = fuseQuatMatrix(q);
      const angle = 2 * Math.acos(Math.min(1, Math.abs(q[0])));
      this.info.angleDeg = (angle * 180) / Math.PI;
    }
    if (cnt) {
      const rms = Math.sqrt(sq / cnt);
      this.rms = this.rms === null ? rms : this.rms * 0.95 + rms * 0.05;
      this.info.rmsCm = this.rms * 100;
    }
    const limit = this.usable ? C.alignMaxRms : C.alignMinRms; // hysteresis: no flicker between fused and single-camera
    this.usable = !!this.R && this.rms !== null && this.rms < limit;
    this.info.usable = this.usable;
  }

  // Positions of a few landmarks (B rotated into A's frame) compared with A's at shifted times.
  _estimateOffset(now) {
    const C = this.cfg;
    if (!this.R || now - this.lastTimeEstimate < C.timeEvery || this.a.length < 30 || this.b.length < 30) return;
    this.lastTimeEstimate = now;
    const frames = this.a.filter((f) => f.w && now - f.t <= C.timeWindow);
    if (frames.length < 40) return;
    const idx = C.timeLandmarks;
    // motion gate: a person standing still gives nothing to align on
    const mean = idx.map((i) => {
      const m = { x: 0, y: 0, z: 0 };
      for (const f of frames) { m.x += f.w[i].x; m.y += f.w[i].y; m.z += f.w[i].z; }
      return { x: m.x / frames.length, y: m.y / frames.length, z: m.z / frames.length };
    });
    let motion = 0;
    for (const f of frames) idx.forEach((i, j) => { motion += (f.w[i].x - mean[j].x) ** 2 + (f.w[i].y - mean[j].y) ** 2 + (f.w[i].z - mean[j].z) ** 2; });
    if (Math.sqrt(motion / (frames.length * idx.length)) < C.timeMinMotion) return;

    // B's landmarks of interest, already in A's frame, kept as plain arrays for a fast scan
    const bt = [];
    const bp = [];
    for (const f of this.b) {
      if (!f.w || f.t < frames[0].t - C.timeRange - 0.5) continue;
      bt.push(f.t);
      bp.push(idx.map((i) => { const p = fuseApply(this.R, f.w[i]); p.v = f.w[i].visibility ?? 1; return p; }));
    }
    if (bt.length < 20) return;
    const steps = Math.round(C.timeRange / C.timeStep);
    const costs = [];
    for (let k = -steps; k <= steps; k++) {
      const shift = k * C.timeStep; // B(tA - shift) corresponds to A(tA)
      let cost = 0;
      let n = 0;
      let h = 0;
      for (const f of frames) {
        const t = f.t - shift;
        while (h < bt.length - 1 && bt[h + 1] < t) h++;
        if (h >= bt.length - 1 || bt[h] > t || bt[h + 1] - bt[h] > C.maxGap) continue;
        const u = (t - bt[h]) / Math.max(1e-6, bt[h + 1] - bt[h]);
        for (let j = 0; j < idx.length; j++) {
          const pa = f.w[idx[j]];
          const p0 = bp[h][j]; const p1 = bp[h + 1][j];
          if ((pa.visibility ?? 1) < 0.5 || p0.v < 0.5 || p1.v < 0.5) continue;
          const dx = pa.x - fuseLerp(p0.x, p1.x, u);
          const dy = pa.y - fuseLerp(p0.y, p1.y, u);
          const dz = pa.z - fuseLerp(p0.z, p1.z, u);
          cost += dx * dx + dy * dy + dz * dz;
          n++;
        }
      }
      costs.push(n >= 60 ? cost / n : Infinity);
    }
    let best = 0;
    for (let k = 1; k < costs.length; k++) if (costs[k] < costs[best]) best = k;
    if (!Number.isFinite(costs[best])) return;
    let frac = 0; // parabola through the minimum: sub-step accuracy
    if (best > 0 && best < costs.length - 1 && Number.isFinite(costs[best - 1]) && Number.isFinite(costs[best + 1])) {
      const d = costs[best - 1] - 2 * costs[best] + costs[best + 1];
      if (d > 0) frac = Math.max(-1, Math.min(1, (0.5 * (costs[best - 1] - costs[best + 1])) / d));
    }
    const estimate = (best - steps + frac) * C.timeStep;
    this.offset = this.offsetKnown ? fuseLerp(this.offset, estimate, C.timeSmoothing) : estimate;
    this.offsetKnown = true;
    this.info.offsetMs = this.offset * 1000;
  }

  _merge(wa, wbRaw) {
    const C = this.cfg;
    const la = 1 / (C.sigmaLateral ** 2);
    const ld = 1 / (C.sigmaDepth ** 2);
    const R = this.R;
    // information of B in A's frame: R diag(la, la, ld) R^T  (symmetric: xx xy xz yy yz zz)
    const ib = [0, 0, 0, 0, 0, 0];
    {
      const d = [la, la, ld];
      const at = [[R[0], R[1], R[2]], [R[3], R[4], R[5]], [R[6], R[7], R[8]]];
      const val = (r, c) => d.reduce((s, dk, k) => s + at[r][k] * dk * at[c][k], 0);
      ib[0] = val(0, 0); ib[1] = val(0, 1); ib[2] = val(0, 2); ib[3] = val(1, 1); ib[4] = val(1, 2); ib[5] = val(2, 2);
    }
    return wa.map((pa, i) => {
      const pb = fuseApply(R, wbRaw[i]);
      const va = pa.visibility ?? 1;
      const vb = pb.visibility ?? 1;
      if (vb < C.minVisibility) return pa;
      if (va < C.minVisibility) return pb;
      // M = va*diag(la, la, ld) + vb*Ib ;  r = va*diag*pa + vb*Ib*pb
      const m = [va * la + vb * ib[0], vb * ib[1], vb * ib[2], va * la + vb * ib[3], vb * ib[4], va * ld + vb * ib[5]];
      const r0 = va * la * pa.x + vb * (ib[0] * pb.x + ib[1] * pb.y + ib[2] * pb.z);
      const r1 = va * la * pa.y + vb * (ib[1] * pb.x + ib[3] * pb.y + ib[4] * pb.z);
      const r2 = va * ld * pa.z + vb * (ib[2] * pb.x + ib[4] * pb.y + ib[5] * pb.z);
      const inv = fuseInverse3(m);
      return {
        x: inv[0] * r0 + inv[1] * r1 + inv[2] * r2,
        y: inv[1] * r0 + inv[3] * r1 + inv[4] * r2,
        z: inv[2] * r0 + inv[4] * r1 + inv[5] * r2,
        visibility: Math.max(va, vb),
      };
    });
  }

  _step() {
    const C = this.cfg;
    const lastA = this.a[this.a.length - 1];
    const lastB = this.b[this.b.length - 1];
    if (!lastA) return;
    const bNewest = lastB ? lastB.t + this.offset : -Infinity;
    const newest = Math.max(lastA.t, bNewest);
    this.aliveA = newest - lastA.t < C.staleAfter;
    this.aliveB = !!lastB && newest - bNewest < C.staleAfter;
    // learning (rotation, time offset) runs at the newest moment BOTH streams cover: B trails A by its network delay, so
    // before the offset is known A's own "now" lies beyond anything B has delivered
    if (this.aliveA && this.aliveB) {
      const tl = Math.min(lastA.t, bNewest);
      if (tl - this.lastLearn >= 0.02) {
        this.lastLearn = tl;
        const la = fuseSample(this.a, tl);
        const lb = fuseSample(this.b, tl - this.offset);
        if (la && lb) {
          this._align(la, lb);
          this._estimateOffset(tl);
        }
      }
    }
    let t;
    if (this.aliveA) {
      // A leads; B is waited for, but never longer than the budget
      t = this.aliveB && this.usable ? Math.max(Math.min(lastA.t, bNewest), lastA.t - C.waitBudget) : lastA.t;
      // every A frame up to t goes out (A runs at 60 fps, B at 30: the output keeps A's rate even while waiting for B)
      const times = [];
      for (let i = this.a.length - 1; i >= 0 && this.a[i].t > this.lastOut + 1e-6; i--) if (this.a[i].t <= t + 1e-6) times.push(this.a[i].t);
      for (let i = times.length - 1; i >= 0; i--) this._emit(times[i]);
    } else if (this.aliveB && this.usable) {
      t = bNewest;
      if (t - this.lastOut >= C.emitEvery) this._emit(t);
    }
  }

  _emit(t) {
    this.lastOut = t;
    const wa = this.aliveA ? fuseSample(this.a, t) : null;
    const wb = this.aliveB ? fuseSample(this.b, t - this.offset) : null;
    let world = null;
    let mode = 'a';
    if (wa && wb && this.usable) { world = this._merge(wa, wb); mode = 'ab'; }
    else if (wa) { world = wa; mode = 'a'; }
    else if (wb && this.usable) { world = wb.map((p) => fuseApply(this.R, p)); mode = 'b'; }
    this.info.mode = mode;
    this.onFused(t, world, this.info);
  }
}

export const FUSION_DEFAULTS = FUSION_CFG;
