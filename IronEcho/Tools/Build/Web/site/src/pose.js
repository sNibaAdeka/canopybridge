// Webcam control in the browser: MediaPipe Tasks Vision PoseLandmarker (same model family as the tracker process)
// and a port of Tracking/iron_echo_tracker: body frame (body.py), calibration (calibration.py: neutral guard, slip
// left/right), punch onset detection, block amount, lean and One Euro smoothing (gestures.py, config.py defaults).
// Output = InputFrame fields for the core, exactly what the tracker sends to Unreal (INPUT_CONTRACT.md).
const MP_VERSION = '0.10.18';
// The offline builds (Netlify /play, Windows app) ship MediaPipe and the model next to the page: IRONECHO_DEPS.
const DEPS = globalThis.IRONECHO_DEPS || {};
const MP_BASE = DEPS.mediapipe || `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
// the CommonJS build of tasks-vision for the pose Web Worker (a classic worker cannot load the ES module build)
const WORKER_BUNDLE = DEPS.mediapipeWorker || `${MP_BASE}/vision_bundle.cjs`;
const MODEL_BASE = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker';
// full = the default; heavy = a bigger network (3x slower, clearly steadier hands and legs); lite = for weak machines.
const MODELS = {
  full: DEPS.poseModel || `${MODEL_BASE}/pose_landmarker_full/float16/1/pose_landmarker_full.task`,
  heavy: DEPS.poseModelHeavy || `${MODEL_BASE}/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task`,
  lite: DEPS.poseModelLite || `${MODEL_BASE}/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`,
};

const P = { NOSE: 0, LEAR: 7, REAR: 8, LS: 11, RS: 12, LE: 13, RE: 14, LW: 15, RW: 16, LH: 23, RH: 24, LK: 25, RK: 26, LA: 27, RA: 28 };
const KNEE_I = [P.LK, P.RK];
const ANKLE_I = [P.LA, P.RA];
const HIP_I = [P.LH, P.RH];
// Leg kicks (web only, the v1 tracker protocol has no kicks): the ankle rises above its standing height fast.
// midLift: a mid kick brings the foot toward hip height (~0.8 m up), a low kick to the opponent's thigh / knee (~0.35 m up)
const KICK_CFG = { minLift: 0.22, minSpeed: 1.4, midLift: 0.55, settle: 0.08, rearm: 0.08, minInterval: 0.5, minVisibility: 0.5,
  // a leg strike starts when the ankle rises fast OR the knee drives up fast (a knee keeps the foot low and under it)
  kneeLift: 0.18, kneeSpeed: 1.2,
  // at the peak (the frame the knee and the ankle are highest together): the knee well up, the foot no higher than a little above
  // the knee's own rise and NOT out in front of / across from the knee (the shin hangs under it) is a knee strike (1.6); a foot
  // that goes out past the knee is a kick, low or mid by its height. "In front of the knee" survives the depth compression of a
  // kick toward the camera: both the knee and the foot shrink toward the hip by the same factor. Settle a little longer than a kick.
  kneeSettle: 0.12, kneeMinRise: 0.22, kneeMaxFootLead: 0.20, kneeMaxFootAhead: 0.06 };
// Elbow strike (web, 1.6): the elbow comes up to shoulder height fast while the arm stays folded (glove by the head).
// A block lifts BOTH elbows a little; an elbow strike lifts one, to the shoulder line: minAsym over the other elbow.
const ELBOW_CFG = { minRaise: 0.17, minAsym: 0.10, minSpeed: 1.3, maxFold: 0.62, rearmRaise: 0.06, minInterval: 0.45, minVisibility: 0.5 };
// Personal block: the calibrated block pose (wrists relative to the head) against the neutral guard.
const BLOCK_CAL = { minRise: 0.07, holdSeconds: 0.7, waitSeconds: 10, minDelta: 0.07 };
const KEY_POINTS = [0, 11, 12, 13, 14, 15, 16, 23, 24];
const SHOULDER_I = [P.LS, P.RS];
const ELBOW_I = [P.LE, P.RE];
const WRIST_I = [P.LW, P.RW];
const PUNCH_CFG = { triggerExtVelocity: 2.0, triggerFwdVelocity: 1.4, minExtAboveGuard: 0.10, minProgress: 0.16,
  progressWindow: 0.25, rearmFraction: 0.5, rearmTimeout: 0.6, minInterval: 0.15, minVisibility: 0.5,
  // velocity over at least velMinSpan (two frames at 30 fps: one frame of noise is not a punch), at most velMaxSpan back
  velMinSpan: 0.05, velMaxSpan: 0.12,
  // a frame the model is unsure of is skipped; only a longer gap forgets the motion
  gapReset: 0.30 };
// Personal punch calibration (web): a punch straight at ONE camera is mostly depth, and MediaPipe sees depth compressed (often to
// half) and hides the elbow behind the glove. The player throws two jabs and two crosses at the screen; the thresholds become a share
// of what this camera actually measured for this player: speeds never stricter than the defaults, heights 60 % of the real punch.
// A calibration punch must stand out: rise above the guard by minRise (or 3x the guard's own jitter, up to maxRise) and peak at
// 1.5x that and at least minAbove, at minExtVel or faster, so the guard drifting is never taken for the player's punch.
// share: of the measured speeds; ampShare: of the measured heights (a speed spike of depth noise is short, a height is not)
const PUNCH_CAL = { share: 0.45, ampShare: 0.6, minRise: 0.06, maxRise: 0.12, jitterFactor: 3, minAbove: 0.10, minExtVel: 0.8, separation: 0.35, perSide: 2, waitSeconds: 14,
  floor: { extVel: 0.7, fwdVel: 0.45, above: 0.04, progress: 0.07 } };
const BLOCK_CFG = { raiseAboveGuard: 0.03, raiseFull: 0.10, maxFaceDistance: 0.55 };
const CAL_CFG = { neutralSeconds: 1.5, neutralMaxHeadStd: 0.03, neutralMaxWristStd: 0.05, slipMinOffset: 0.08,
  slipHoldSeconds: 0.4, slipRangeFraction: 0.85, minVisibility: 0.6 };
const MIN_CONFIDENCE = 0.5;
const FORWARD_LEAN_RANGE = 0.25;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const median = (xs) => { const s = [...xs].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : 0.5 * (s[m - 1] + s[m]); };
const std = (xs) => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length); };

// MediaPipe world (x = person's left, y down, z away) -> body frame (X forward to the camera, Y person's right, Z up).
function bodyPose(world, t) {
  const p = world.map((w) => [-w.z, -w.x, -w.y]);
  const vis = world.map((w) => (w.visibility ?? 1));
  const mid = (a, b) => scale(add(p[a], p[b]), 0.5);
  return {
    t, p, vis,
    hipMid: () => mid(P.LH, P.RH),
    shoulderMid: () => mid(P.LS, P.RS),
    head: () => scale(add(add(p[P.NOSE], p[P.LEAR]), p[P.REAR]), 1 / 3),
    armLength: (side) => norm(sub(p[ELBOW_I[side]], p[SHOULDER_I[side]])) + norm(sub(p[WRIST_I[side]], p[ELBOW_I[side]])),
    visibilityOf: (idx) => idx.reduce((a, i) => a + vis[i], 0) / idx.length,
  };
}

class OneEuro {
  constructor(minCutoff, beta, dCutoff = 1.0) { Object.assign(this, { minCutoff, beta, dCutoff }); this.reset(); }
  reset() { this.x = null; this.dx = null; this.t = null; }
  static alpha(cutoff, dt) { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }
  filter(x, t) {
    if (this.x === null || t <= this.t) { this.x = [...x]; this.dx = x.map(() => 0); this.t = t; return x; }
    const dt = t - this.t;
    const ad = OneEuro.alpha(this.dCutoff, dt);
    const out = x.map((v, i) => {
      const dxv = ad * ((v - this.x[i]) / dt) + (1 - ad) * this.dx[i];
      this.dx[i] = dxv;
      const a = OneEuro.alpha(this.minCutoff + this.beta * Math.abs(dxv), dt);
      return a * v + (1 - a) * this.x[i];
    });
    this.x = out;
    this.t = t;
    return out;
  }
}

class PunchDetector {
  constructor(side) { this.side = side; this.reset(); this.firedAt = -1e9; this.limits = null; }
  reset() { this.history = []; this.armed = true; this.peak = 0; }
  // personal thresholds from the punch calibration: { extVel, fwdVel, above, progress } (null = the defaults)
  setLimits(limits) { this.limits = limits; }
  update(t, extension, forward, visibility, guardExtension) {
    const c = PUNCH_CFG;
    const L = this.limits || { extVel: c.triggerExtVelocity, fwdVel: c.triggerFwdVelocity, above: c.minExtAboveGuard, progress: c.minProgress };
    if (visibility < c.minVisibility || !Number.isFinite(extension)) {
      // skip the doubtful frame; forget the motion only after a real gap
      const last = this.history[this.history.length - 1];
      if (last && t - last[0] > c.gapReset) this.history = [];
      return false;
    }
    const last = this.history[this.history.length - 1];
    if (last && t - last[0] > c.gapReset) this.history = [];
    this.history.push([t, extension, forward]);
    while (this.history.length && t - this.history[0][0] > Math.max(c.progressWindow, 0.3)) this.history.shift();
    if (!this.armed) {
      this.peak = Math.max(this.peak, extension);
      const retracted = extension <= guardExtension + c.rearmFraction * (this.peak - guardExtension);
      if (retracted || t - this.firedAt > c.rearmTimeout) this.armed = true;
      return false;
    }
    if (this.history.length < 3 || t - this.firedAt < c.minInterval) return false;
    const [extVel, fwdVel] = punchVelocity(this.history, t);
    if (extVel === null) return false;
    const windowMin = Math.min(...this.history.filter((s) => t - s[0] <= c.progressWindow).map((s) => s[1]));
    // a punch is a rise over consecutive frames; one frame of depth noise jumps and falls back
    const n = this.history.length;
    const rising = this.history[n - 1][1] > this.history[n - 2][1] && this.history[n - 2][1] > this.history[n - 3][1];
    if (rising && extVel >= L.extVel && fwdVel >= L.fwdVel && extension >= guardExtension + L.above
      && extension - windowMin >= L.progress) {
      this.armed = false;
      this.peak = extension;
      this.firedAt = t;
      return true;
    }
    return false;
  }
}

// Pushes (ext, fwd) into `raw` (last three kept) and returns their per-component median (the value itself until three are in).
function median3(raw, ext, fwd) {
  raw.push([ext, fwd]);
  if (raw.length > 3) raw.shift();
  if (raw.length < 3) return [ext, fwd];
  const m = (k) => { const v = raw.map((r) => r[k]).sort((a, b) => a - b); return v[1]; };
  return [m(0), m(1)];
}

// [extension velocity, forward velocity] at the newest sample of history ([t, ext, fwd]), measured against the oldest sample that is
// at least velMinSpan and at most velMaxSpan back (the newest older one if none is that old). [null, null] when there is none.
function punchVelocity(history, t) {
  const c = PUNCH_CFG;
  const cur = history[history.length - 1];
  let ref = null;
  for (let i = history.length - 2; i >= 0; i--) {
    const age = t - history[i][0];
    if (age > c.velMaxSpan) break;
    ref = history[i];
    if (age >= c.velMinSpan) break;
  }
  if (!ref) ref = history[history.length - 2];
  const dt = t - ref[0];
  if (!ref || dt <= 1e-4) return [null, null];
  return [(cur[1] - ref[1]) / dt, (cur[2] - ref[2]) / dt];
}

class KickDetector {
  constructor(side) { this.side = side; this.reset(); this.firedAt = -1e9; }
  reset() { this.history = []; this.armed = true; this.pending = null; }
  // lift: ankle height above the calibrated standing height, m; rise: the same for the knee.
  // Returns 'mid' | 'low' | 'knee' | null. Without knee data (rise null) it is the 1.4 kick detector.
  // ahead: how far the foot is out past the knee (forward, and across), m.
  update(t, lift, visibility, rise = null, ahead = null) {
    const c = KICK_CFG;
    if (visibility < c.minVisibility || !Number.isFinite(lift)) { this.reset(); return null; }
    const knees = rise !== null && Number.isFinite(rise) && Number.isFinite(ahead);
    this.history.push([t, lift, knees ? rise : 0]);
    while (this.history.length && t - this.history[0][0] > 0.4) this.history.shift();
    if (this.pending) {
      const p = this.pending;
      p.peak = Math.max(p.peak, lift);
      if (knees && lift + rise >= p.top) { p.top = lift + rise; p.rise = rise; p.lift = lift; p.ahead = ahead; }
      if (t - p.t0 >= (knees ? c.kneeSettle : c.settle)) {
        this.pending = null;
        if (knees && p.rise >= c.kneeMinRise && p.lift - p.rise <= c.kneeMaxFootLead && p.ahead <= c.kneeMaxFootAhead) return 'knee';
        return p.peak >= c.minLift ? (p.peak >= c.midLift ? 'mid' : 'low') : null;
      }
      return null;
    }
    if (!this.armed) {
      if (lift < c.rearm && (!knees || rise < c.rearm)) this.armed = true;
      return null;
    }
    if (this.history.length < 3 || t - this.firedAt < c.minInterval) return null;
    const ref = this.history.find((s) => t - s[0] <= 0.12 && s[0] < t) || this.history[this.history.length - 2];
    const dt = t - ref[0];
    if (dt <= 1e-4) return null;
    const speed = (lift - ref[1]) / dt;
    const kneeSpeed = knees ? (rise - ref[2]) / dt : 0;
    if ((lift >= c.minLift && speed >= c.minSpeed) || (knees && rise >= c.kneeLift && kneeSpeed >= c.kneeSpeed)) {
      this.armed = false;
      this.firedAt = t;
      this.pending = { t0: t, peak: lift, top: knees ? lift + rise : 0, rise: knees ? rise : 0, lift, ahead: knees ? ahead : 1 };
    }
    return null;
  }
}

class ElbowDetector {
  constructor(side) { this.side = side; this.reset(); this.firedAt = -1e9; }
  reset() { this.history = []; this.armed = true; }
  // raise: elbow height above its guard height, m; fold: shoulder -> wrist over the arm length (small = folded); elbow: position
  update(t, raise, fold, elbow, visibility, otherRaise = 0) {
    const c = ELBOW_CFG;
    if (visibility < c.minVisibility || !Number.isFinite(raise)) { this.history = []; return false; }
    this.history.push([t, elbow]);
    while (this.history.length && t - this.history[0][0] > 0.3) this.history.shift();
    if (!this.armed) {
      if (raise < c.rearmRaise) this.armed = true;
      return false;
    }
    if (this.history.length < 3 || t - this.firedAt < c.minInterval) return false;
    let ref = null;
    for (let i = this.history.length - 2; i >= 0; i--) { ref = this.history[i]; if (t - ref[0] >= 0.06) break; }
    const dt = t - ref[0];
    if (dt <= 1e-4) return false;
    const speed = norm(sub(elbow, ref[1])) / dt;
    if (raise >= c.minRaise && raise - otherRaise >= c.minAsym && fold <= c.maxFold && speed >= c.minSpeed) {
      this.armed = false;
      this.firedAt = t;
      return true;
    }
    return false;
  }
}

const STEPS = {
  punchLeft: 'УДАР ЛЕВОЙ — дважды резко в экран, как джеб',
  punchRight: 'УДАР ПРАВОЙ — дважды резко в экран, как кросс',
  neutral: 'Встань в боксёрскую стойку, руки у подбородка — и замри',
  block: 'БЛОК — подними перчатки к лицу, как от удара, и задержи',
  slipLeft: 'Уклон ВЛЕВО — наклони голову влево и задержи',
  slipRight: 'Уклон ВПРАВО — наклони голову вправо и задержи',
};

const BODY_PUNCH_DROP = 0.25; // wrist below the shoulder line by this many arm lengths at the punch: body shot

// Pure tracker logic (no DOM, no MediaPipe): feed world landmarks, read InputFrame fields. Tested against the Python
// tracker by Tools/Build/Web/check_pose.mjs.
export class PoseProcessor {
  constructor(say = () => {}, opts = {}) {
    this._say = say;
    // close: elbows and knees (1.6, web only like the kicks)
    this.opts = { personalBlock: true, kicks: true, punchCal: true, close: true, ...opts };
    this.elbowDetectors = [new ElbowDetector(0), new ElbowDetector(1)];
    this.elbows = []; // [t, side] log (tests)
    this.kickMask = 0;
    this.legsVisible = false;
    this.blockPersonal = 0;
    this.kickDetectors = [new KickDetector(0), new KickDetector(1)];
    this.kicks = []; // [t, side, kind] log (tests)
    this.status = 6; // Calibrating
    this.mask = 0;
    this.lean = 0;
    this.leanForward = 0;
    this.block = 0;
    this.confidence = 0;
    this.cal = null;          // calibration result
    this.step = 'neutral';
    this.window = [];
    this.holdStart = null;
    this.extreme = 0;
    this.slip = [0.18, 0.18];
    this.smooth = new OneEuro(2.5, 0.3);
    this.detectors = [new PunchDetector(0), new PunchDetector(1)];
    this.punches = []; // [t, side] log (tests)
  }

  // world: 33 MediaPipe world landmarks {x, y, z, visibility} or null when nobody is detected; t in seconds.
  process(world, t) {
    if (!world) {
      this.status = this.cal ? 3 : 6; // NoPerson
      this.confidence = 0;
      this._resetMotion();
      if (!this.cal) this._say('Не вижу тебя', 0, 'Встань в кадр целиком: голова, руки, бёдра.');
      return;
    }
    const pose = bodyPose(world, t);
    this.confidence = pose.visibilityOf(KEY_POINTS);
    if (!this.cal) {
      this._calibrate(pose);
      if (!this.cal) return; // like the tracker, the frame that completes calibration is already processed live
    }
    if (this.confidence < MIN_CONFIDENCE) {
      this.status = 4; // LowConfidence
      this._resetMotion();
      return;
    }
    this.status = 7; // Live
    const c = this.cal;
    const head = pose.head();
    const hips = pose.hipMid();
    const lateral = head[1] - hips[1] - c.neutralLat;
    const leanLat = lateral / (lateral < 0 ? c.slipLeft : c.slipRight);
    const leanFwd = (head[0] - hips[0] - c.neutralFwd) / FORWARD_LEAN_RANGE;
    const [sl, sf] = this.smooth.filter([leanLat, leanFwd], t);
    this.lean = Math.max(-2, Math.min(2, sl));
    this.leanForward = Math.max(-2, Math.min(2, sf));
    this.block = this._block(pose);
    if (c.blockPose) this.blockPersonal = this._blockPersonal(pose);
    if (this.opts.kicks && c.legBase) this._kicks(pose, t);
    if (this.opts.close && c.elbowBase) {
      const raises = [0, 1].map((side) => (pose.p[ELBOW_I[side]][2] - pose.p[SHOULDER_I[side]][2]) - c.elbowBase[side]);
      for (const side of [0, 1]) {
        const elbow = pose.p[ELBOW_I[side]];
        const raise = raises[side];
        const fold = norm(sub(pose.p[WRIST_I[side]], pose.p[SHOULDER_I[side]])) / c.arm[side];
        const vis = Math.min(pose.vis[ELBOW_I[side]], pose.vis[SHOULDER_I[side]]);
        if (this.elbowDetectors[side].update(t, raise, fold, elbow, vis, raises[1 - side])) {
          this.mask |= side === 0 ? 16 : 32;
          this.elbows.push([t, side]);
        }
      }
    }
    for (const side of [0, 1]) {
      const delta = sub(pose.p[WRIST_I[side]], pose.p[SHOULDER_I[side]]);
      const ext = norm(delta) / c.arm[side];
      const fwd = delta[0] / c.arm[side];
      // the extension is shoulder -> wrist: the elbow is not needed, and in a punch straight at the camera the glove hides it
      const vis = Math.min(pose.vis[WRIST_I[side]], pose.vis[SHOULDER_I[side]]);
      if (this.detectors[side].update(t, ext, fwd, vis, c.guardExt[side])) {
        // a punch that ends well below the shoulders goes to the body (web only for now: the v1 tracker protocol
        // carries head punches; see Docs/Contracts/INPUT_CONTRACT.md 1.2)
        const low = pose.p[WRIST_I[side]][2] - pose.shoulderMid()[2] < -BODY_PUNCH_DROP * c.arm[side];
        this.mask |= side === 0 ? (low ? 4 : 1) : (low ? 8 : 2);
        this.punches.push([t, side]);
      }
    }
  }

  _resetMotion() {
    this.detectors.forEach((d) => d.reset());
    this.kickDetectors.forEach((d) => d.reset());
    if (this.elbowDetectors) this.elbowDetectors.forEach((d) => d.reset());
    this.smooth.reset();
  }

  _kicks(pose, t) {
    const hip = pose.hipMid();
    let seen = 0;
    for (const side of [0, 1]) {
      const vis = Math.min(pose.vis[ANKLE_I[side]], pose.vis[KNEE_I[side]], pose.vis[HIP_I[side]]);
      seen += vis;
      const lift = (pose.p[ANKLE_I[side]][2] - hip[2]) - this.cal.legBase[side];
      const close = this.opts.close && this.cal.kneeBase;
      const rise = close ? (pose.p[KNEE_I[side]][2] - hip[2]) - this.cal.kneeBase[side] : null;
      const kneeP = pose.p[KNEE_I[side]];
      const ankleP = pose.p[ANKLE_I[side]];
      const ahead = close ? (ankleP[0] - kneeP[0]) + 0.6 * Math.abs(ankleP[1] - kneeP[1]) : null;
      const kind = this.kickDetectors[side].update(t, lift, vis, rise, ahead);
      if (kind) {
        // 1 / 2 mid kick, 4 / 8 low kick, 16 / 32 knee: lead (left) / rear (right)
        this.kickMask |= (kind === 'mid' ? 1 : kind === 'low' ? 4 : 16) << side;
        this.kicks.push([t, side, kind]);
      }
    }
    this.legsVisible = seen / 2 >= KICK_CFG.minVisibility;
  }

  // 0 = the neutral guard, 1 = the calibrated block, per wrist along the guard -> block direction; the worse hand counts.
  _blockPersonal(pose) {
    const c = this.cal;
    const head = pose.head();
    let score = 1;
    for (const side of [0, 1]) {
      const cur = sub(sub(pose.p[WRIST_I[side]], head), c.guardRel[side]);
      const d = c.blockDelta[side];
      const dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
      const along = (cur[0] * d[0] + cur[1] * d[1] + cur[2] * d[2]) / dd;
      const off = Math.sqrt(Math.max(0, norm(cur) ** 2 - along * along * dd)) / Math.sqrt(dd);
      score = Math.min(score, Math.max(0, Math.min(1.1, along)) * (1 - Math.max(0, Math.min(1, off - 0.6))));
    }
    return Math.max(0, Math.min(1, score));
  }

  _block(pose) {
    const c = this.cal;
    const head = pose.head();
    const sm = pose.shoulderMid();
    let cover = 1;
    for (const side of [0, 1]) {
      const w = pose.p[WRIST_I[side]];
      const raised = (w[2] - sm[2]) - c.guardH[side];
      const coverH = Math.min(1, Math.max(0, (raised - BLOCK_CFG.raiseAboveGuard) / BLOCK_CFG.raiseFull));
      const dist = norm(sub(w, head)) / c.arm[side];
      const coverF = dist <= BLOCK_CFG.maxFaceDistance ? 1 : Math.max(0, 1 - (dist - BLOCK_CFG.maxFaceDistance) / 0.15);
      cover = Math.min(cover, coverH * coverF);
    }
    return cover;
  }

  _calibrate(pose) {
    this.status = 6;
    const visible = this.confidence >= CAL_CFG.minVisibility;
    if (this.step === 'neutral') {
      if (!visible) { this.window = []; this._say(STEPS.neutral, 0, 'Нужно видеть голову, плечи, локти, кисти и бёдра.'); return; }
      this.window.push(pose);
      while (this.window.length && pose.t - this.window[0].t > CAL_CFG.neutralSeconds) this.window.shift();
      const heads = this.window.map((q) => sub(q.head(), q.hipMid()));
      const wrists = this.window.map((q) => [...sub(q.p[P.LW], q.shoulderMid()), ...sub(q.p[P.RW], q.shoulderMid())]);
      const stable = this.window.length < 3 || (Math.max(std(heads.map((h) => h[0])), std(heads.map((h) => h[1]))) <= CAL_CFG.neutralMaxHeadStd
        && Math.max(...[0, 1, 2, 3, 4, 5].map((i) => std(wrists.map((w) => w[i])))) <= CAL_CFG.neutralMaxWristStd);
      if (!stable) { this.window = [pose]; this._say(STEPS.neutral, 0, 'Замри: держи стойку неподвижно.'); return; }
      const span = pose.t - this.window[0].t;
      this._say(STEPS.neutral, (100 * span) / CAL_CFG.neutralSeconds, 'Держи…');
      if (span >= CAL_CFG.neutralSeconds * 0.98 && this.window.length >= 5) {
        this.neutral = [...this.window];
        this.neutralLat = median(this.neutral.map((q) => q.head()[1] - q.hipMid()[1]));
        this.guardRel = [0, 1].map((s) => [0, 1, 2].map((k) => median(this.neutral.map((q) => q.p[WRIST_I[s]][k] - q.head()[k]))));
        this.legBase = [0, 1].map((s) => median(this.neutral.map((q) => q.p[ANKLE_I[s]][2] - q.hipMid()[2])));
        this.kneeBase = [0, 1].map((s) => median(this.neutral.map((q) => q.p[KNEE_I[s]][2] - q.hipMid()[2])));
        this.legLen = [0, 1].map((s) => median(this.neutral.map((q) => norm(sub(q.p[KNEE_I[s]], q.p[HIP_I[s]])) + norm(sub(q.p[ANKLE_I[s]], q.p[KNEE_I[s]])))));
        this.elbowBase = [0, 1].map((s) => median(this.neutral.map((q) => q.p[ELBOW_I[s]][2] - q.p[SHOULDER_I[s]][2])));
        this.holdStart = null;
        this.stepStart = pose.t;
        this.step = this.opts.personalBlock ? 'block' : 'slipLeft';
        this._say(STEPS[this.step], 0, this.opts.personalBlock ? 'Это запомнится как твой блок.' : '');
      }
      return;
    }
    if (this.step === 'block') {
      if (!visible) { this.holdStart = null; return; }
      const head = pose.head();
      const rel = [0, 1].map((s) => sub(pose.p[WRIST_I[s]], head));
      const rise = rel.map((v, s) => v[2] - this.guardRel[s][2]);
      if (pose.t - this.stepStart > BLOCK_CAL.waitSeconds) {
        // not done in time: the built-in block rule stays in charge
        this.step = 'slipLeft';
        this.holdStart = null;
        this._say(STEPS.slipLeft, 0, 'Блок пропущен: сработает обычное правило.');
        return;
      }
      if (!rise.every((r) => r >= BLOCK_CAL.minRise)) {
        this.holdStart = null;
        this.blockSamples = [];
        this._say(STEPS.block, 0, 'Обе перчатки выше — к лицу.');
        return;
      }
      if (this.holdStart === null) { this.holdStart = pose.t; this.blockSamples = []; }
      this.blockSamples.push(rel);
      const held = pose.t - this.holdStart;
      this._say(STEPS.block, (100 * held) / BLOCK_CAL.holdSeconds, 'Держи…');
      if (held >= BLOCK_CAL.holdSeconds) {
        const blockRel = [0, 1].map((s) => [0, 1, 2].map((k) => median(this.blockSamples.map((r) => r[s][k]))));
        const delta = blockRel.map((b, s) => sub(b, this.guardRel[s]));
        if (delta.every((d) => norm(d) >= BLOCK_CAL.minDelta)) this.blockDelta = delta;
        this.step = 'slipLeft';
        this.holdStart = null;
        this._say(STEPS.slipLeft, 0, '');
      }
      return;
    }
    if (this.step === 'punchLeft' || this.step === 'punchRight') { this._punchCal(pose); return; }
    const left = this.step === 'slipLeft';
    if (!visible) { this.holdStart = null; return; }
    const offset = pose.head()[1] - pose.hipMid()[1] - this.neutralLat;
    const directed = left ? -offset : offset;
    if (directed < CAL_CFG.slipMinOffset) {
      this.holdStart = null;
      this._say(left ? STEPS.slipLeft : STEPS.slipRight, 0, 'Наклонись сильнее — как уклон от удара.');
      return;
    }
    if (this.holdStart === null) { this.holdStart = pose.t; this.extreme = directed; }
    this.extreme = Math.max(this.extreme, directed);
    const held = pose.t - this.holdStart;
    this._say(left ? STEPS.slipLeft : STEPS.slipRight, (100 * held) / CAL_CFG.slipHoldSeconds, 'Держи…');
    if (held >= CAL_CFG.slipHoldSeconds) {
      const measured = Math.max(CAL_CFG.slipMinOffset, this.extreme * CAL_CFG.slipRangeFraction);
      if (left) {
        this.slip[0] = measured;
        this.step = 'slipRight';
        this.holdStart = null;
      } else {
        this.slip[1] = measured;
        if (this.opts.punchCal) this._beginPunchCal(pose.t);
        else this._finish();
      }
    }
  }

  _beginPunchCal(t) {
    const ps = this.neutral;
    this.calArm = [0, 1].map((s) => median(ps.map((q) => q.armLength(s))));
    this.calGuard = [0, 1].map((s) => median(ps.map((q) => norm(sub(q.p[WRIST_I[s]], q.p[SHOULDER_I[s]])) / this.calArm[s])));
    // the guard's jitter on a 3-frame average (a punch lasts many frames, the depth noise of one frame does not count)
    const avg3 = (xs) => xs.map((_, i) => (xs[Math.max(0, i - 1)] + xs[i] + xs[Math.min(xs.length - 1, i + 1)]) / 3);
    this.calRise = [0, 1].map((s) => Math.min(PUNCH_CAL.maxRise, Math.max(PUNCH_CAL.minRise,
      PUNCH_CAL.jitterFactor * std(avg3(ps.map((q) => norm(sub(q.p[WRIST_I[s]], q.p[SHOULDER_I[s]])) / this.calArm[s]))))));
    this.punchCal = [0, 1].map(() => ({ history: [], peaks: [], cur: null }));
    this.step = 'punchLeft';
    this.stepStart = t;
    this._say(STEPS.punchLeft, 0, 'Так камера узнает, как она видит твои удары.');
  }

  // One side at a time: each punch is a rise of the extension above the guard; per punch keep its height and its best speeds.
  _punchCal(pose) {
    const side = this.step === 'punchLeft' ? 0 : 1;
    const st = this.punchCal[side];
    const t = pose.t;
    if (t - this.stepStart > PUNCH_CAL.waitSeconds) { this._endPunchCal(t, 'Удар не увидел — оставлю обычную настройку.'); return; }
    const vis = Math.min(pose.vis[WRIST_I[side]], pose.vis[SHOULDER_I[side]]);
    if (vis < PUNCH_CFG.minVisibility) return;
    const delta = sub(pose.p[WRIST_I[side]], pose.p[SHOULDER_I[side]]);
    const ext = norm(delta) / this.calArm[side];
    const fwd = delta[0] / this.calArm[side];
    if (!st.raw) st.raw = [];
    const [mExt, mFwd] = median3(st.raw, ext, fwd);
    const above = mExt - this.calGuard[side];
    st.history.push([t, mExt, mFwd]);
    while (st.history.length && t - st.history[0][0] > 0.4) st.history.shift();
    const [extVel, fwdVel] = st.history.length >= 2 ? punchVelocity(st.history, t) : [null, null];
    if (!st.cur && above >= this.calRise[side] && extVel > 0) st.cur = { t0: t, above, extVel: 0, fwdVel: 0, frames: 0, low: Math.min(...st.history.map((h) => h[1])) };
    if (st.cur) {
      if (above >= this.calRise[side]) st.cur.frames++;
      st.cur.above = Math.max(st.cur.above, above);
      if (extVel !== null) { st.cur.extVel = Math.max(st.cur.extVel, extVel); st.cur.fwdVel = Math.max(st.cur.fwdVel, fwdVel); }
      // back toward the guard: the punch is over
      if (above < st.cur.above * 0.45 && t - st.cur.t0 > 0.08) {
        const prev = st.peaks[st.peaks.length - 1];
        const real = st.cur.above >= Math.max(PUNCH_CAL.minAbove, 1.25 * this.calRise[side]) && st.cur.extVel >= PUNCH_CAL.minExtVel && st.cur.frames >= 2;
        if (real && (!prev || st.cur.t0 - prev.t0 >= PUNCH_CAL.separation)) st.peaks.push({ ...st.cur, progress: st.cur.above + this.calGuard[side] - st.cur.low });
        st.cur = null;
      }
    }
    this._say(STEPS[this.step], (100 * st.peaks.length) / PUNCH_CAL.perSide, st.peaks.length ? 'Ещё раз!' : 'Резко, к экрану, и назад в стойку.');
    if (st.peaks.length >= PUNCH_CAL.perSide) {
      if (side === 0) { this.step = 'punchRight'; this.stepStart = t; this._say(STEPS.punchRight, 0, ''); }
      else this._endPunchCal(t, '');
    }
  }

  _endPunchCal(t, note) {
    const c = PUNCH_CFG;
    const F = PUNCH_CAL.floor;
    const share = PUNCH_CAL.share;
    const amp = PUNCH_CAL.ampShare;
    // a side with no measured punch borrows the other side's measurement; none at all: the defaults
    const m = this.punchCal.map((st) => (st.peaks.length ? {
      extVel: median(st.peaks.map((p) => p.extVel)), fwdVel: median(st.peaks.map((p) => p.fwdVel)),
      above: median(st.peaks.map((p) => p.above)), progress: median(st.peaks.map((p) => p.progress)),
    } : null));
    this.punchLimits = [0, 1].map((s) => {
      const x = m[s] || m[1 - s];
      if (!x) return null;
      const lim = (v, k, floor, def) => Math.max(floor, Math.min(def, k * v));
      return { extVel: lim(x.extVel, share, F.extVel, c.triggerExtVelocity), fwdVel: lim(x.fwdVel, share, F.fwdVel, c.triggerFwdVelocity),
        // heights follow the player's real punch both ways (60 % of it): a long arm is not held to a short one's noise floor
        above: Math.max(F.above, Math.min(0.25, amp * x.above)), progress: Math.max(F.progress, Math.min(0.30, amp * x.progress)), measured: x };
    });
    if (note) this._say(STEPS[this.step], 100, note);
    this._finish();
  }

  _finish() {
    const ps = this.neutral;
    const arm = [0, 1].map((s) => median(ps.map((q) => q.armLength(s))));
    this.cal = {
      arm,
      guardExt: [0, 1].map((s) => median(ps.map((q) => norm(sub(q.p[WRIST_I[s]], q.p[SHOULDER_I[s]])) / arm[s]))),
      guardH: [0, 1].map((s) => median(ps.map((q) => q.p[WRIST_I[s]][2] - q.shoulderMid()[2]))),
      neutralLat: this.neutralLat,
      neutralFwd: median(ps.map((q) => q.head()[0] - q.hipMid()[0])),
      guardRel: this.guardRel,
      blockDelta: this.blockDelta || null,
      blockPose: !!this.blockDelta,
      legBase: this.legBase,
      kneeBase: this.kneeBase,
      legLen: this.legLen,
      elbowBase: this.elbowBase,
      slipLeft: this.slip[0],
      slipRight: this.slip[1],
      punchLimits: this.punchLimits || [null, null],
    };
    this.detectors.forEach((d, s) => d.setLimits(this.cal.punchLimits[s]));
    this._resetMotion();
    this._say('Готово! Бой начинается', 100, 'Удар — резко к экрану (ниже плеч — в корпус). Вплотную: локоть — одной рукой вверх-вперёд, колено — к груди. Блок — руки к лицу. Уклон — голову в сторону. Наклон к экрану — шаг вперёд.');
    setTimeout(() => this._say(''), 2600);
  }

  poll() {
    const mask = this.mask;
    this.mask = 0;
    const kickMask = this.kickMask;
    this.kickMask = 0;
    const block = this.cal && this.cal.blockPose ? this.blockPersonal : this.block;
    return { status: this.status, lean: this.lean, leanForward: this.leanForward, block, punchMask: mask, kickMask, confidence: this.confidence };
  }
}

// One camera stream (the computer's webcam is handled inline by CameraInput; the phones' WebRTC streams come through here):
// a <video>, its own landmarker, an overlay with the skeleton, and a callback with the world landmarks and the time the
// frame reached us (the best clock we have for a remote stream; PoseFusion finds the constant part of the delay itself).
class PoseTap {
  constructor(host, els, onWorld) {
    this.host = host;
    this.els = els; // { video, overlay, badge: (q) => void }
    this.onWorld = onWorld;
    this.active = false;
    this.inferMs = 0;
    this.frames = 0;
    this.total = 0; // frames processed since the stream attached
    this.fpsAt = performance.now();
    this.fps = 0;
    this.lastVideoTime = -1;
    this.lastQualityAt = 0;
    this.lastFrameAt = 0;
  }

  async attach(stream) {
    const v = this.els.video;
    v.srcObject = stream;
    v.muted = true;
    v.playsInline = true;
    try { await v.play(); } catch { /* the first frame event starts it */ }
    if (!this.detector) this.detector = await this.host._makeDetector();
    if (this.active) return;
    this.active = true;
    const loop = (now, meta) => {
      if (!this.active) return;
      this._process(meta);
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(loop);
      else requestAnimationFrame(loop);
    };
    loop();
  }

  stop() {
    this.active = false;
    const v = this.els.video;
    if (v.srcObject) v.srcObject = null;
    if (this.detector && !this.shared) this.detector.stop();
    this.detector = null;
  }

  _process(meta) {
    const v = this.els.video;
    if (v.currentTime === this.lastVideoTime || !v.videoWidth) return;
    const now = performance.now();
    const stamp = meta && Number.isFinite(meta.receiveTime) ? meta.receiveTime : (meta && Number.isFinite(meta.captureTime) ? meta.captureTime : now);
    const accepted = this.detector.submit(v, stamp, (res, infer, tc) => this._onResult(res, infer, tc));
    if (accepted) this.lastVideoTime = v.currentTime;
  }

  _onResult(res, infer, stamp) {
    if (!this.active) return;
    const o = this.els.overlay;
    const v = this.els.video;
    if (o.width !== v.videoWidth || o.height !== v.videoHeight) { o.width = v.videoWidth; o.height = v.videoHeight; }
    const now = performance.now();
    this.inferMs = this.inferMs ? this.inferMs * 0.9 + infer * 0.1 : infer;
    this.frames++;
    this.total++;
    if (now - this.fpsAt > 1000) { this.fps = (this.frames * 1000) / (now - this.fpsAt); this.frames = 0; this.fpsAt = now; }
    this.lastFrameAt = now;
    const ctx = o.getContext('2d');
    ctx.clearRect(0, 0, o.width, o.height);
    const lm = res.landmarks && res.landmarks[0];
    if (lm) {
      if (!this.du) this.du = this.host.drawing(ctx);
      this.du.drawConnectors(lm, this.host.connections, { color: '#3f7dff', lineWidth: 3 });
      this.du.drawLandmarks(lm, { color: '#ffffff', radius: 2 });
    }
    if (now - this.lastQualityAt >= 400) {
      this.lastQualityAt = now;
      this.els.badge(this.host._qualityOf(res, this.inferMs), this);
    }
    this.onWorld(stamp / 1000, res.worldLandmarks && res.worldLandmarks.length ? res.worldLandmarks[0] : null);
  }
}

// source: 'webcam' (getUserMedia on this computer) or 'phone' (a phone on the same Wi-Fi streams its camera to the
// Windows app's local server; the app shows a QR code to pair it).
export class CameraInput {
  constructor(source = 'webcam', opts = {}) {
    this.source = source;
    this.model = MODELS[opts.model] ? opts.model : 'full';
    this.inferMs = 0;      // moving average of one detection, ms
    this.quality = { level: 'wait', tip: '' };
    this.lastQualityAt = 0;
    this.active = false;
    this.lastVideoTime = -1;
    this.phoneSeq = 0;
    // second camera: 'off' | 'phone' (the computer's webcam + one phone) | 'phones' (two phones, no webcam)
    this.second = opts.second === 'phone' || opts.second === 'phones' ? opts.second : 'off';
    this.waitBudget = opts.wait;
    this.link = null;
    this.fusion = null;
    this.fusionInfo = null;
    // With a second camera the fight does not start (and calibration does not begin) until both cameras are found and matched,
    // or the player chooses to play with one: started earlier, the first seconds would be played on a half-set-up rig.
    this.hold = this.second !== 'off';
    this.taps = {};
    this.streams = {};
    this._ui();
    this.proc = new PoseProcessor((title, progress, note) => this._say(title, progress, note));
  }

  _ui() {
    const box = document.createElement('div');
    box.id = 'cam';
    box.innerHTML = `<video playsinline muted></video><canvas></canvas><div class="cam-q"><i></i><span></span></div><div class="cam-msg"><b></b><div class="cam-bar"><i></i></div><small></small></div>`;
    const style = document.createElement('style');
    style.textContent = `#cam{position:absolute;right:16px;top:calc(env(safe-area-inset-top,0px) + 92px);width:min(30vw,300px);aspect-ratio:4/3;border-radius:6px;overflow:hidden;border:1px solid rgba(255,255,255,.12);background:#000;z-index:5;pointer-events:none}
      #cam video,#cam canvas{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform:scaleX(-1)}
      #cam .cam-msg{position:fixed;left:50%;bottom:24%;transform:translateX(-50%);width:min(90vw,560px);text-align:center;background:rgba(10,11,14,.88);border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:14px 18px}
      #cam .cam-msg b{font:800 26px/1.15 "Barlow Condensed",Arial Narrow,sans-serif;letter-spacing:.05em;color:#fff}
      #cam .cam-msg small{display:block;margin-top:8px;color:#9aa3ae;font:500 13px/1.35 Inter,system-ui,sans-serif}
      #cam .cam-bar{height:8px;margin-top:10px;border-radius:4px;background:rgba(255,255,255,.08);overflow:hidden}
      #cam .cam-q{position:absolute;left:0;right:0;bottom:0;padding:3px 6px;background:rgba(10,11,14,.78);font:600 11px/1.3 Inter,system-ui,sans-serif;color:#e8ecf2}
      #cam .cam-q i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;background:#888}
      #cam .cam-q.good i{background:#3ddc84}#cam .cam-q.warn i{background:#ffb020}#cam .cam-q.bad i{background:#ff4b3e}
      #cam .cam-bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#3f7dff,#8fb3ff)}`;
    document.head.appendChild(style);
    document.querySelector('#stage').appendChild(box);
    this.box = box;
    this.video = box.querySelector('video');
    this.overlay = box.querySelector('canvas');
    this.msg = box.querySelector('.cam-msg');
    this.qbox = box.querySelector('.cam-q');
    box.hidden = true;
  }

  _say(title, progress = 0, note = '') {
    this.msg.hidden = !title;
    this.msg.querySelector('b').textContent = title || '';
    this.msg.querySelector('i').style.width = `${Math.round(progress)}%`;
    this.msg.querySelector('small').textContent = note;
  }

  async start() {
    this.box.hidden = false;
    if (this.source === 'phone') {
      await this._pairPhone();
    } else if (this.second === 'phones') {
      this.video.hidden = false;
      await this._openLink();
    } else {
      this._say('Включаю камеру…', 5, 'Разреши доступ к камере. Встань в 2–3 м, чтобы в кадре были голова, руки и бёдра.');
      // 640x480 is enough (the network sees ~256 px); what matters is the frame rate: ask for 60, take what the camera gives
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 60 } }, audio: false });
      this.video.srcObject = stream;
      await this.video.play();
      this.overlay.width = this.video.videoWidth || 640;
      this.overlay.height = this.video.videoHeight || 480;
      if (this.second === 'phone') {
        try {
          await this._openLink();
        } catch (err) { // no internet for the introduction: play on with the webcam alone
          this.second = 'off';
          this._say('Телефон не подключить', 10, `${err.message}. Играем с одной камерой.`);
          await new Promise((r) => setTimeout(r, 2200));
        }
      }
    }
    const names = { full: 'обычная', heavy: 'высокая точность, ~30 МБ', lite: 'лёгкая' };
    this._say('Загружаю модель позы…', 30, `MediaPipe PoseLandmarker: ${names[this.model]}, один раз.`);
    const vision = await import(/* @vite-ignore */ `${MP_BASE}/vision_bundle.mjs`);
    this.vision = vision;
    try {
      this.detector = await this._makeDetector(this.model);
    } catch (err) {
      if (this.model === 'full') throw err;
      this._say('Модель не загрузилась', 30, 'Беру обычную модель.');
      this.model = 'full';
      this.detector = await this._makeDetector('full');
    }
    this.drawingUtils = new vision.DrawingUtils(this.overlay.getContext('2d'));
    this.connections = vision.PoseLandmarker.POSE_CONNECTIONS;
    this.active = true;
    this._say(STEPS.neutral, 0, 'Калибровка: 5 коротких шагов (стойка, блок, уклоны, удары в экран).');
    if (this.source === 'phone') {
      this._phoneLoop();
      return;
    }
    if (this.second !== 'off') {
      this._startFusion();
      for (const slot of [1, 2]) if (this.streams[slot]) this._attachPhone(slot);
    }
    if (this.second === 'phones') return; // the phone streams drive the processing
    const loop = (now, meta) => {
      if (!this.active) return;
      // the moment the camera captured the frame (not the moment we got to it): steadier speeds for the punch detector
      this._process(meta && Number.isFinite(meta.captureTime) ? meta.captureTime : undefined);
      if (this.video.requestVideoFrameCallback) this.video.requestVideoFrameCallback(loop);
      else requestAnimationFrame(loop);
    };
    loop();
  }

  // a lower presence / tracking bar keeps the skeleton through fast punches and motion blur (the processor still drops
  // frames whose key points are not visible)
  // One pose detector (a Web Worker with its own PoseLandmarker; the main thread only if a worker cannot run): see poseworker.js
  async _makeDetector(model = this.model) {
    const abs = (u) => new URL(u, location.href).href;
    const det = new PoseDetector();
    await det.init({
      bundle: abs(WORKER_BUNDLE), wasm: abs(`${MP_BASE}/wasm`), model: abs(MODELS[model]),
      makeLocal: async () => {
        if (!this.fileset) this.fileset = await this.vision.FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
        return this._makeLandmarker(model);
      },
    });
    return det;
  }

  async _makeLandmarker(model = this.model) {
    const options = (delegate) => ({ baseOptions: { modelAssetPath: MODELS[model], delegate }, runningMode: 'VIDEO', numPoses: 1,
      minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.4, minTrackingConfidence: 0.4 });
    try {
      return await this.vision.PoseLandmarker.createFromOptions(this.fileset, options('GPU'));
    } catch {
      return this.vision.PoseLandmarker.createFromOptions(this.fileset, options('CPU'));
    }
  }

  // DrawingUtils bound to a canvas context (one per overlay)
  drawing(ctx) {
    return ctx === this.overlay.getContext('2d') ? this.drawingUtils : new this.vision.DrawingUtils(ctx);
  }

  stop() {
    this.active = false;
    this.stopped = true;
    const s = this.video.srcObject;
    if (s) s.getTracks().forEach((tr) => tr.stop());
    for (const tap of Object.values(this.taps)) tap.stop();
    if (this.detector) { this.detector.stop(); this.detector = null; }
    if (this.link) this.link.close();
    clearInterval(this.panelTimer);
    if (this.panel) this.panel.remove();
    if (this.box2) this.box2.remove();
    this.box.hidden = true;
    if (this.pairBox) this.pairBox.remove();
  }

  // ---- phones over WebRTC (public site and Windows app; needs the internet only for the introduction)
  _startFusion() {
    const opts = this.waitBudget ? { waitBudget: this.waitBudget } : {};
    this.fusion = new PoseFusion((t, world, info) => {
      this.fusionInfo = info;
      if (this.hold) { if (info.usable) this._release(); else return; }
      this.proc.process(world, t);
    }, opts);
    if (this.hold) this._holdMessage();
  }

  async _openLink() {
    this._say('Готовлю подключение телефона…', 5, '');
    this.link = new PhoneLink();
    this.link.on('stream', ({ slot, stream }) => {
      this.streams[slot] = stream;
      if (this.detector && this.active) this._attachPhone(slot);
      this._refreshPanel();
    });
    this.link.on('lost', ({ slot }) => {
      delete this.streams[slot];
      if (this.taps[slot]) { this.taps[slot].stop(); delete this.taps[slot]; }
      this._refreshPanel();
    });
    this.link.on('error', (text) => { if (this.panel) this.panel.querySelector('.pp-note').textContent = text; });
    await this.link.open();
    await this._panel();
  }

  _attachPhone(slot) {
    const isMain = this.second === 'phones' && slot === 1;
    let tap = this.taps[slot];
    if (!tap) {
      const els = isMain
        ? { video: this.video, overlay: this.overlay, badge: (q) => this._badge(q) }
        : this._phoneBox(slot);
      const push = (t, world) => (slot === 1 && this.second === 'phones' ? this.fusion.pushA(t, world) : this.fusion.pushB(t, world));
      tap = new PoseTap(this, els, push);
      if (isMain) { tap.detector = this.detector; tap.shared = true; } // the main camera uses the page's own detector
      this.taps[slot] = tap;
    }
    tap.attach(this.streams[slot]).catch((err) => console.error('phone stream', err));
  }

  // a small preview of a phone camera under the main one
  _phoneBox(slot) {
    if (!this.box2) {
      const box = document.createElement('div');
      box.id = 'cam2';
      box.innerHTML = '<video playsinline muted></video><canvas></canvas><div class="cam-q"><i></i><span></span></div>';
      document.querySelector('#stage').appendChild(box);
      this.box2 = box;
    }
    const box = this.box2;
    box.hidden = false;
    const q = box.querySelector('.cam-q');
    return {
      video: box.querySelector('video'),
      overlay: box.querySelector('canvas'),
      badge: (res, tap) => {
        q.className = `cam-q ${res.level}`;
        q.querySelector('span').textContent = `Телефон ${slot}: ${res.tip} · ${Math.round(tap.fps)} к/с`;
      },
    };
  }

  async _panel() {
    const need = this.second === 'phones' ? [1, 2] : [1];
    const style = document.createElement('style');
    style.textContent = `#cam2{position:absolute;right:16px;top:calc(env(safe-area-inset-top,0px) + 92px + min(30vw,300px) * .75 + 12px);width:min(30vw,300px);aspect-ratio:4/3;
      border-radius:6px;overflow:hidden;border:1px solid rgba(255,255,255,.12);background:#000;z-index:5;pointer-events:none}
      #cam2 video,#cam2 canvas{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}
      #cam2 .cam-q{position:absolute;left:0;right:0;bottom:0;padding:3px 6px;background:rgba(10,11,14,.78);font:600 11px/1.3 Inter,system-ui,sans-serif;color:#e8ecf2}
      #cam2 .cam-q i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;background:#888}
      #cam2 .cam-q.good i{background:#3ddc84}#cam2 .cam-q.warn i{background:#ffb020}#cam2 .cam-q.bad i{background:#ff4b3e}
      #cam-link{position:absolute;left:50%;top:calc(env(safe-area-inset-top,0px) + 80px);transform:translateX(-50%);z-index:7;width:min(94vw,760px);
        background:rgba(10,11,14,.95);border:1px solid rgba(255,255,255,.14);border-radius:10px;padding:16px 18px;color:#e8ecf2;font:500 14px/1.45 Inter,system-ui,sans-serif}
      #cam-link b{font:800 24px/1.1 "Barlow Condensed",Arial Narrow,sans-serif;letter-spacing:.05em}
      #cam-link .pp-row{display:flex;gap:18px;flex-wrap:wrap;margin:10px 0}
      #cam-link .pp-ph{display:flex;gap:12px;align-items:center;min-width:0;flex:1 1 280px}
      #cam-link .pp-qr{flex:none;background:#fff;padding:6px;border-radius:6px;line-height:0;width:132px;height:132px}
      #cam-link .pp-qr img{width:120px;height:120px;image-rendering:pixelated}
      #cam-link .pp-st{font-weight:700;color:#8fb3ff}#cam-link .pp-st.on{color:#3ddc84}
      #cam-link small{display:block;color:#9aa3ae;word-break:break-all}
      #cam-link button{margin-top:6px;background:#1d2530;color:#e8ecf2;border:1px solid rgba(255,255,255,.18);border-radius:6px;padding:7px 14px;font:700 13px Inter,system-ui,sans-serif;cursor:pointer;pointer-events:auto}`;
    document.head.appendChild(style);
    const panel = document.createElement('div');
    panel.id = 'cam-link';
    const title = this.second === 'phones' ? 'Два телефона вместо веб-камеры' : 'Второй телефон как камера';
    panel.innerHTML = `<b>${title}</b>
      <div class="pp-row">${need.map((slot) => `<div class="pp-ph" data-slot="${slot}"><div class="pp-qr"></div>
        <div><div>${this.second === 'phones' ? (slot === 1 ? 'Телефон 1 (главная камера)' : 'Телефон 2 (сбоку)') : 'Телефон (поставь под углом около 45° к веб-камере, не строго сбоку)'}</div>
        <div class="pp-st">ждём…</div><small></small></div></div>`).join('')}</div>
      <div class="pp-note">Наведи камеру телефона на QR-код (или открой ссылку) и разреши камеру. Телефоны ставь в 2–3 м, чтобы было видно тебя от головы до бёдер. Синхронизация и угол подберутся сами, пока ты двигаешься.</div>
      <button type="button" class="pp-close">Играть без второй камеры</button>`;
    document.querySelector('#stage').appendChild(panel);
    this.panel = panel;
    panel.querySelector('.pp-close').addEventListener('click', () => { panel.hidden = true; this.panelDone = false; this._release(); });
    let qrmod = null;
    try { qrmod = await import(/* @vite-ignore */ DEPS.qrcode || './vendor/qrcode/qrcode.mjs'); } catch { /* the link text is enough */ }
    for (const slot of need) {
      const url = this.link.url(slot);
      const row = panel.querySelector(`[data-slot="${slot}"]`);
      if (!url) { row.querySelector('small').textContent = 'В этой версии страницы нет сопряжения телефона: открой сайт iron-echo-boxing.vercel.app/play'; row.querySelector('.pp-qr').remove(); continue; }
      row.querySelector('small').textContent = url;
      if (qrmod) {
        try {
          const qr = qrmod.default(0, 'M');
          qr.addData(url);
          qr.make();
          const img = document.createElement('img');
          img.src = qr.createDataURL(5, 2);
          img.alt = url;
          row.querySelector('.pp-qr').appendChild(img);
        } catch { row.querySelector('.pp-qr').remove(); }
      } else row.querySelector('.pp-qr').remove();
    }
    this.panelTimer = setInterval(() => this._refreshPanel(), 700);
    this._refreshPanel();
  }

  _refreshPanel() {
    this._holdMessage();
    if (!this.panel) return;
    const need = this.second === 'phones' ? [1, 2] : [1];
    let all = true;
    for (const slot of need) {
      const st = this.panel.querySelector(`[data-slot="${slot}"] .pp-st`);
      const tap = this.taps[slot];
      const on = !!this.streams[slot];
      all = all && on;
      st.classList.toggle('on', on);
      st.textContent = !on ? 'ждём подключения…' : tap && tap.fps > 1 ? `подключён · ${Math.round(tap.fps)} к/с` : 'подключён · загружаю модель…';
    }
    this.panel.querySelector('.pp-close').textContent = this.hold ? 'Играть без второй камеры' : 'Скрыть';
    if (all && !this.hold && this.panelDone === undefined) {
      this.panelDone = true;
      setTimeout(() => { if (this.panel) this.panel.hidden = true; }, 2500);
    }
  }

  // ---- phone as the camera (Windows app only: its local server relays the phone's frames)
  async _pairPhone() {
    this._say('Подключаю телефон…', 5, '');
    const res = await fetch('/__ironecho/phone');
    if (!res.ok) throw new Error('телефон-камера работает только в приложении IronEcho для Windows');
    const info = await res.json();
    if (!info.urls || !info.urls.length) throw new Error('компьютер не подключён к локальной сети (Wi-Fi или кабель)');
    const url = info.urls[0];
    const pair = document.createElement('div');
    pair.id = 'phone-pair';
    pair.innerHTML = `<div class="pp-qr"></div><div class="pp-text"><b>Камера телефона</b>
      <ol><li>Телефон и компьютер — в одной сети Wi-Fi. Если Windows спросит о доступе к сети — «Разрешить».</li><li>Наведи камеру телефона на QR-код и открой ссылку.</li>
      <li>Браузер предупредит о сертификате: «Дополнительно» → «Перейти на сайт» (это твой компьютер).</li>
      <li>Разреши камеру, поставь телефон в 2–3 м так, чтобы было видно тебя от головы до бёдер.</li></ol>
      <p class="pp-status">Жду телефон…</p><small></small></div>`;
    const style = document.createElement('style');
    style.textContent = `#phone-pair{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:flex;gap:22px;align-items:center;
      width:min(92vw,720px);background:rgba(10,11,14,.94);border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:22px;z-index:6;color:#e8ecf2;
      font:500 14px/1.45 Inter,system-ui,sans-serif}
      #phone-pair .pp-qr{flex:none;background:#fff;padding:10px;border-radius:6px;line-height:0}
      #phone-pair .pp-qr img{width:220px;height:220px;image-rendering:pixelated}
      #phone-pair b{font:800 26px/1.1 "Barlow Condensed",Arial Narrow,sans-serif;letter-spacing:.05em}
      #phone-pair ol{margin:10px 0 8px;padding-left:20px}#phone-pair .pp-status{margin:6px 0;color:#8fb3ff;font-weight:600}#phone-pair small{display:block;color:#9aa3ae;word-break:break-all}
      @media (max-width:640px){#phone-pair{flex-direction:column;text-align:left}}`;
    document.head.appendChild(style);
    document.querySelector('#stage').appendChild(pair);
    this.pairBox = pair;
    pair.querySelector('small').textContent = info.urls.join('  ·  ');
    try {
      const mod = await import('./vendor/qrcode/qrcode.mjs');
      const qr = mod.default(0, 'M');
      qr.addData(url);
      qr.make();
      const img = document.createElement('img');
      img.src = qr.createDataURL(6, 2);
      img.alt = url;
      pair.querySelector('.pp-qr').appendChild(img);
    } catch {
      pair.querySelector('.pp-qr').remove();
    }
    this._say(''); // the panel carries the status while pairing
    // first frame = paired
    for (;;) {
      if (this.stopped) throw new Error('отменено');
      const frame = await this._fetchFrame(4000);
      if (frame) { frame.close(); break; }
    }
    pair.remove();
    this.pairBox = null;
    this.video.hidden = true;
  }

  async _fetchFrame(waitMs = 1500) {
    let res;
    try {
      res = await fetch(`/__ironecho/phone/frame?after=${this.phoneSeq}&wait=${waitMs}`, { cache: 'no-store' });
    } catch {
      return null;
    }
    if (res.status !== 200) return null;
    this.phoneSeq = Number(res.headers.get('X-Seq')) || this.phoneSeq + 1;
    return createImageBitmap(await res.blob());
  }

  async _phoneLoop() {
    while (this.active) {
      const bmp = await this._fetchFrame();
      if (!this.active) { if (bmp) bmp.close(); break; }
      const now = performance.now();
      if (!bmp) { this.proc.process(null, now / 1000); continue; } // no frames: the processor reports tracking lost
      if (this.overlay.width !== bmp.width || this.overlay.height !== bmp.height) {
        this.overlay.width = bmp.width;
        this.overlay.height = bmp.height;
      }
      this.overlay.getContext('2d').drawImage(bmp, 0, 0);
      this.detector.submit(bmp, now, (res, infer, tc) => { // the frame is handed over (and closed) by the detector
        this._assess(res, infer);
        if (res.landmarks && res.landmarks[0]) {
          this.drawingUtils.drawConnectors(res.landmarks[0], this.connections, { color: '#3f7dff', lineWidth: 3 });
          this.drawingUtils.drawLandmarks(res.landmarks[0], { color: '#ffffff', radius: 2 });
        }
        this.proc.process(res.worldLandmarks && res.worldLandmarks.length ? res.worldLandmarks[0] : null, tc / 1000);
      });
    }
  }

  // Tracking quality badge: what the camera sees and what to change (distance, light, load).
  _assess(res, inferMs) {
    this.inferMs = this.inferMs ? this.inferMs * 0.9 + inferMs * 0.1 : inferMs;
    const now = performance.now();
    if (now - this.lastQualityAt < 400) return;
    this.lastQualityAt = now;
    this._badge(this._qualityOf(res, this.inferMs));
  }

  _qualityOf(res, inferMs) {
    let level = 'good';
    let tip = 'Отслеживание в норме';
    const lm = res.landmarks && res.landmarks[0];
    if (!lm) {
      level = 'bad';
      tip = 'Тебя не видно: встань в кадр целиком, включи свет';
    } else {
      const vis = (i) => lm[i].visibility ?? 1;
      const keys = [0, 11, 12, 13, 14, 15, 16, 23, 24];
      const mean = keys.reduce((a, i) => a + vis(i), 0) / keys.length;
      const ys = lm.filter((l) => (l.visibility ?? 1) > 0.5).map((l) => l.y);
      const xs = lm.filter((l) => (l.visibility ?? 1) > 0.5).map((l) => l.x);
      const height = ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
      const hipsSeen = vis(23) > 0.5 && vis(24) > 0.5;
      const wristsSeen = vis(15) > 0.5 && vis(16) > 0.5;
      if (mean < 0.5) { level = 'bad'; tip = 'Плохо видно: больше света, без окна за спиной'; }
      else if (!hipsSeen) { level = 'warn'; tip = 'Отойди дальше: в кадре нужны бёдра'; }
      else if (!wristsSeen) { level = 'warn'; tip = 'Кисти выпали из кадра: отойди или встань по центру'; }
      else if (height < 0.42) { level = 'warn'; tip = 'Подойди ближе: ты слишком мелкий в кадре'; }
      else if (xs.length && (Math.min(...xs) < 0.04 || Math.max(...xs) > 0.96)) { level = 'warn'; tip = 'Встань по центру кадра'; }
      else if (mean < 0.7) { level = 'warn'; tip = 'Видимость средняя: добавь света'; }
      else if (inferMs > 45) { level = 'warn'; tip = `Трекер тормозит (${Math.round(inferMs)} мс): выбери «Обычная» точность`; }
      else if (!this.proc.legsVisible && this.proc.cal) { tip = 'Ноги не видны: удары ногами выключены (отойди на 3 м)'; }
    }
    return { level, tip };
  }

  _badge(q) {
    let { level, tip } = q;
    const f = this.fusionInfo;
    if (this.fusion && this.second !== 'off') {
      if (!Object.keys(this.streams).length) { if (level === 'good') { level = 'warn'; tip = 'Телефон не подключён: работает одна камера'; } }
      else if (f && f.mode === 'ab' && level === 'good') tip = `2 камеры: синхронизация ${Math.round(f.offsetMs)} мс, согласие ${f.rmsCm.toFixed(1)} см`;
      else if (f && f.rmsCm !== null && !f.usable) { level = 'warn'; tip = `Камеры не сходятся (${f.rmsCm.toFixed(0)} см): в обоих кадрах должен быть ты один, без зеркала`; }
      else if (f && f.mode === 'a' && level === 'good' && Object.keys(this.streams).length) tip = 'Подбираю угол второй камеры: подвигайся';
    }
    this.quality = { level, tip };
    this.qbox.className = `cam-q ${level}`;
    this.qbox.querySelector('span').textContent = tip;
  }

  _process(captureTime) {
    if (this.video.currentTime === this.lastVideoTime) return;
    const tc = captureTime ?? performance.now();
    // the detector works in a Web Worker; when it is still busy with the previous frame this one is skipped (real time: never queue)
    const accepted = this.detector.submit(this.video, tc, (res, infer, stamp) => this._onResult(res, infer, stamp));
    if (accepted) this.lastVideoTime = this.video.currentTime;
  }

  _onResult(res, infer, stamp) {
    if (!this.active) return;
    this._assess(res, infer);
    this._noteFrame();
    const ctx = this.overlay.getContext('2d');
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    if (res.landmarks && res.landmarks[0]) {
      this.drawingUtils.drawConnectors(res.landmarks[0], this.connections, { color: '#3f7dff', lineWidth: 3 });
      this.drawingUtils.drawLandmarks(res.landmarks[0], { color: '#ffffff', radius: 2 });
    }
    const world = res.worldLandmarks && res.worldLandmarks.length ? res.worldLandmarks[0] : null;
    if (this.fusion) this.fusion.pushA(stamp / 1000, world);
    else this.proc.process(world, stamp / 1000);
  }

  // frames per second of this camera's detector (for the F3 overlay)
  _noteFrame() {
    const now = performance.now();
    this.fpsFrames = (this.fpsFrames || 0) + 1;
    if (!this.fpsAt) this.fpsAt = now;
    if (now - this.fpsAt > 1000) { this.fps = (this.fpsFrames * 1000) / (now - this.fpsAt); this.fpsFrames = 0; this.fpsAt = now; }
  }

  // numbers for the F3 overlay
  stats() {
    const f = this.fusion ? this.fusion.info : null;
    return {
      mode: this.detector ? `${this.detector.mode}/${this.detector.delegate}` : '-', model: this.model,
      fps: this.fps || 0, inferMs: this.inferMs,
      taps: Object.fromEntries(Object.entries(this.taps).map(([k, t]) => [k, { fps: t.fps, inferMs: t.inferMs, mode: t.detector ? `${t.detector.mode}/${t.detector.delegate}` : '-' }])),
      fusion: f ? { mode: f.mode, offsetMs: f.offsetMs, rmsCm: f.rmsCm, usable: f.usable } : null, hold: this.hold,
    };
  }

  poll() {
    if (this.hold) return { status: 6, lean: 0, leanForward: 0, block: 0, punchMask: 0, kickMask: 0, confidence: 0 }; // 6: calibrating
    return this.proc.poll();
  }

  _release() {
    if (!this.hold) return;
    this.hold = false;
    this._say(STEPS.neutral, 0, 'Калибровка: 5 коротких шагов (стойка, блок, уклоны, удары в экран).');
    if (this.panel) setTimeout(() => { if (this.panel && this.panelDone !== false) this.panel.hidden = true; }, 1500);
  }

  // what the screen says while the fight waits for the cameras
  _holdMessage() {
    if (!this.hold) return;
    const f = this.fusion;
    const phones = Object.keys(this.streams).length;
    const need = this.second === 'phones' ? 2 : 1;
    if (phones < need) {
      this._say('Жду телефон', 0, this.second === 'phones' ? `Подключено ${phones} из 2. Отсканируй QR-коды (панель сверху). Бой начнётся, когда обе камеры заработают.`
        : 'Отсканируй QR-код (панель сверху). Бой начнётся, когда заработает вторая камера. Или нажми «Играть без телефона».');
    } else {
      const done = f ? Math.min(100, (100 * f.alignN) / f.cfg.alignMinSamples) : 0;
      this._say('Подбираю угол камер', done, f && f.info.rmsCm !== null && !f.info.usable && f.alignN >= f.cfg.alignMinSamples
        ? `Камеры пока не сходятся (${f.info.rmsCm.toFixed(0)} см). Встань целиком в кадр ОБЕИХ камер; телефон поставь под углом ~45°, не строго сбоку.`
        : 'Встань целиком в кадр обеих камер и чуть подвигай руками.');
    }
  }
}
