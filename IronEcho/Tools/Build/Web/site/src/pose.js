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
// Hooks and uppercuts (web, 1.7). What a hand does is read from the direction its wrist moves relative to its shoulder (arm lengths per
// second): forward = a straight (PunchDetector), across toward the other side with the arm bent but open = a hook (a hook's glove
// swings on an arc around the shoulder, so its reach hardly changes: the straight detector does not see it), up out of a dip below
// the guard = an uppercut. An elbow strike also swings across, but folded (the glove at the head): hookMinOpen keeps them apart. A
// block lifts both gloves, an uppercut one (upOtherShare); the return of a body shot rises too, but backward (upMaxBack).
const STRIKE_CFG = { window: 0.30, minInterval: 0.35, minVisibility: 0.5, gapReset: 0.30,
  hookInSpeed: 1.6, hookTravel: 0.30, hookDominance: 1.2, hookMinOpen: 0.62, hookBodyBelow: -0.20,
  upSpeed: 1.8, upRise: 0.30, upDip: 0.12, upDominance: 1.3, upMaxBack: -0.4, upOtherShare: 0.35,
  // an elbow strike is confirmed this long after it fires, unless the arm opened meanwhile (then it was the cocking of a hook)
  elbowConfirm: 0.10, elbowMaxOpen: 0.62, elbowMinAsym: 0.05,
  // a straight that fires while the glove swings OUT this fast relative to forward (or up to cockHold after) is the cocking of a hook
  // (a straight never leaves the shoulder line: cockOutside, in arm lengths across the body, keeps depth-noise from being taken for a swing)
  cockOut: 1.0, cockMinSpeed: 1.0, cockTravel: 0.12, cockOutside: 0.05, cockHold: 0.15,
  // a hand coming back to the guard from any strike rises too: an uppercut needs this long since the same hand's last strike
  upAfterStrike: 0.7 };
// Duck (web, 1.7): how far the head has dropped. Best seen in the image (the world landmarks are centred on the hips, which go down
// with a knee-bend duck): head height in the frame against the calibrated stance, in torso lengths. Without image landmarks (the
// two-camera fusion) from the world: the waist folding plus both feet rising toward the hips (the knees bending).
// The stance it compares with follows the player slowly while not ducking (stepping back from the camera lowers the head in the frame).
const DUCK_CFG = { fullTorso: 0.5, fullMetres: 0.25, followBelow: 0.35, followSeconds: 6 };
// Personal block: the calibrated block pose (wrists relative to the head) against the neutral guard.
const BLOCK_CAL = { minRise: 0.07, holdSeconds: 0.7, waitSeconds: 10, minDelta: 0.07 };
// Does the camera see the player? The head, shoulders, elbows and wrists decide. The hips are NOT required (1.7.1): a webcam on a desk
// rarely shows them, MediaPipe's world coordinates are centred on the (estimated) hips anyway, and a body that is "not seen" because
// of its hips used to stall the calibration and pause the fight. The legs are judged on their own (kicks and knees need them only).
const KEY_POINTS = [0, 11, 12, 13, 14, 15, 16];
const PART_NAMES = [[[0], 'голова'], [[11, 12], 'плечи'], [[13, 14], 'локти'], [[15, 16], 'кисти']];
// A frame or two without a pose (the model blinks all the time) or with a doubtful one does not end tracking: the last state is
// kept and nothing is detected until the pose is lost for this long.
const LOSS_HOLD = 0.35;
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
// The second camera never holds the fight back: the game starts on the first camera, the phone joins when its view fits and is let
// go when it does not fit or when it slows things down (more detectors on one graphics card = fewer frames for everything).
const SECOND_CFG = { matchSeconds: 15, lostSeconds: 6, minFps: 8, minFpsSeconds: 5, dropShare: 0.6, dropSeconds: 4, baseMinFps: 18 };
// Brightness of the picture (0..1 luma of a 32x24 thumbnail): the usual reason for "the camera does not see me"
const LIGHT_CFG = { dark: 0.2, dim: 0.3, backlitGap: 0.15, backlitCentre: 0.45, every: 1000 };
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
// Image landmarks -> what a duck changes: head height in the frame (0 = top) and the torso's length in the frame (shoulders to hips).
function imageMeasures(lm) {
  const y = (i) => lm[i].y;
  const headY = (y(P.NOSE) + y(P.LEAR) + y(P.REAR)) / 3;
  const torso = (y(P.LH) + y(P.RH)) / 2 - (y(P.LS) + y(P.RS)) / 2;
  return { headY, torso };
}

function bodyPose(world, t) {
  const p = world.map((w) => [-w.z, -w.x, -w.y]);
  const vis = world.map((w) => (w.visibility ?? 1));
  const mid = (a, b) => scale(add(p[a], p[b]), 0.5);
  return {
    t, p, vis,
    // MediaPipe's world landmarks are centred on the hips (the origin IS the hip midpoint). When the hips are not in the frame their
    // reported positions are a guess that jitters; the origin itself is the steadier answer (a body "standing still" stayed unstable).
    hipMid: () => (vis[P.LH] < 0.5 && vis[P.RH] < 0.5 ? [0, 0, 0] : mid(P.LH, P.RH)),
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
    // Two rising steps in a row (one frame of depth noise jumps and falls back). On a slow pose stream (under ~22 frames a second) a
    // fast punch gives only two frames of rise, so there the last step plus the progress over the window is what counts.
    const slow = t - this.history[n - 2][0] > 0.045 && this.history[n - 1][0] - this.history[n - 3][0] > 0.09;
    const rising = this.history[n - 1][1] > this.history[n - 2][1] && (slow || this.history[n - 2][1] > this.history[n - 3][1]);
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

class HandStrikeDetector {
  constructor(side) { this.side = side; this.reset(); this.firedAt = -1e9; }
  reset() { this.history = []; this.v = [0, 0, 0]; this.dip = 0; this.cockAt = -1e9; }
  // rel: wrist - shoulder in arm lengths [forward, inward (toward the other side), up]; open: |wrist - shoulder| / arm;
  // guardUp: the guard's wrist height over the shoulder (arm lengths); otherUp: the other hand's upward speed.
  // Returns 'hook' | 'hookBody' | 'upper' | null.
  update(t, rel, open, visibility, guardUp, otherUp) {
    const c = STRIKE_CFG;
    const last = this.history[this.history.length - 1];
    if (visibility < c.minVisibility || !rel.every(Number.isFinite)) {
      if (last && t - last[0] > c.gapReset) this.reset();
      return null;
    }
    if (last && t - last[0] > c.gapReset) this.reset();
    this.history.push([t, rel[0], rel[1], rel[2]]);
    while (this.history.length && t - this.history[0][0] > c.window) this.history.shift();
    if (this.history.length < 3) return null;
    // velocity against the newest sample at least two frames (30 fps) back, at most 0.12 s
    let ref = null;
    for (let i = this.history.length - 2; i >= 0; i--) {
      const age = t - this.history[i][0];
      if (age > PUNCH_CFG.velMaxSpan) break;
      ref = this.history[i];
      if (age >= PUNCH_CFG.velMinSpan) break;
    }
    if (!ref) return null;
    const dt = t - ref[0];
    if (dt <= 1e-4) return null;
    this.v = [(rel[0] - ref[1]) / dt, (rel[1] - ref[2]) / dt, (rel[2] - ref[3]) / dt];
    this.open = open;
    this.low = rel[2] < c.hookBodyBelow;
    const minIn = Math.min(...this.history.map((s) => s[2]));
    this.outTravel = Math.max(...this.history.map((s) => s[2])) - rel[1];
    const minUp = Math.min(...this.history.map((s) => s[3]));
    this.travelIn = rel[1] - minIn;
    this.rise = rel[2] - minUp;
    this.dip = guardUp - minUp;
    this.otherUp = otherUp;
    this.t = t;
    this.inward = rel[1]; // + = across the body, - = outside the shoulder line
    if (this._swingingOut()) this.cockAt = t;
    if (t - this.firedAt < c.minInterval) return null;
    const kind = this.shape();
    if (kind === 'hook' || kind === 'hookBody' || kind === 'upper') { this.firedAt = t; return kind; }
    return null;
  }
  // What the hand's current motion is: 'hook' | 'hookBody' | 'upper' | 'cock' (swinging out: the start of a hook) | null.
  shape() {
    const c = STRIKE_CFG;
    const [vf, vi, vu] = this.v;
    if (vi >= c.hookInSpeed && this.travelIn >= c.hookTravel && vi >= c.hookDominance * Math.max(0, vf) && this.open >= c.hookMinOpen) {
      return this.low ? 'hookBody' : 'hook';
    }
    if (vu >= c.upSpeed && this.rise >= c.upRise && this.dip >= c.upDip && vu >= c.upDominance * Math.max(0, vf) && vf >= c.upMaxBack
      && (this.otherUp ?? 0) < c.upOtherShare * vu) return 'upper';
    if (this._swingingOut() || this.t - this.cockAt <= c.cockHold) return 'cock';
    return null;
  }
  // the glove swinging out to the side right now (the cocking of a hook): only the motion itself, never the remembered cockAt
  _swingingOut() {
    const c = STRIKE_CFG;
    return -this.v[1] >= Math.max(c.cockMinSpeed, c.cockOut * this.v[0]) && this.outTravel >= c.cockTravel && this.inward < c.cockOutside;
  }
}

// Knee strike when the feet are out of the frame (1.7.1): only the knee is seen, so a fast rise of the knee is all there is to go on.
// (A kick lifts the knee as well; it needs the ankle to be told apart, and without the ankle there is no kick to tell.)
KickDetector.prototype.updateKneeOnly = function updateKneeOnly(t, rise, visibility) {
  const c = KICK_CFG;
  if (visibility < c.minVisibility || !Number.isFinite(rise)) { this.reset(); return null; }
  this.history.push([t, 0, rise]);
  while (this.history.length && t - this.history[0][0] > 0.4) this.history.shift();
  if (this.pending) {
    const p = this.pending;
    p.rise = Math.max(p.rise, rise);
    if (t - p.t0 >= c.kneeSettle) { this.pending = null; return p.rise >= c.kneeMinRise ? 'knee' : null; }
    return null;
  }
  if (!this.armed) { if (rise < c.rearm) this.armed = true; return null; }
  if (this.history.length < 3 || t - this.firedAt < c.minInterval) return null;
  const ref = this.history.find((s) => t - s[0] <= 0.12 && s[0] < t) || this.history[this.history.length - 2];
  const dt = t - ref[0];
  if (dt <= 1e-4) return null;
  if (rise >= c.kneeLift && (rise - ref[2]) / dt >= c.kneeSpeed) {
    this.armed = false;
    this.firedAt = t;
    this.pending = { t0: t, peak: 0, top: rise, rise, lift: 0, ahead: 1 };
  }
  return null;
};

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
// A recording of what the camera gave the game, for taking apart a bad session afterwards (F4 saves it). Only skeleton numbers are kept -
// no picture, nothing that shows a face. Two parts: the calibration at the start of the session (so a replay can calibrate exactly like
// the game did) and the last 25 seconds. Tests/Web/replay_trace.mjs feeds a saved file through the same PoseProcessor.
export class TraceRecorder {
  constructor(seconds = 25, tapeSeconds = 60) {
    this.seconds = seconds;
    this.tapeSeconds = tapeSeconds;
    this.frames = [];     // the last `seconds`: { t, a: Float32Array(33*4 world x,y,z,visibility + 33*2 image x,y) | null }
    this.tape = [];       // from the first frame until calibration is over (at most tapeSeconds)
    this.tapeOpen = true;
    this.tapeEnd = Infinity;
    this.decisions = []; // what the game was told: { t, punch, kick }
  }

  add(t, world, image) {
    let a = null;
    if (world && world.length >= 33) {
      a = new Float32Array(33 * 6);
      for (let i = 0; i < 33; i++) {
        const w = world[i];
        a[i * 4] = w.x; a[i * 4 + 1] = w.y; a[i * 4 + 2] = w.z; a[i * 4 + 3] = w.visibility ?? 1;
        const m = image && image[i];
        a[132 + i * 2] = m ? m.x : -9; a[132 + i * 2 + 1] = m ? m.y : -9;
      }
    }
    const f = { t, a };
    if (this.tapeOpen) {
      if (!this.tape.length || (t <= this.tapeEnd && t - this.tape[0].t <= this.tapeSeconds)) this.tape.push(f);
      else this.tapeOpen = false;
    }
    this.frames.push(f);
    while (this.frames.length && t - this.frames[0].t > this.seconds) this.frames.shift();
    while (this.decisions.length && t - this.decisions[0].t > this.seconds) this.decisions.shift();
  }

  // calibration is over: a second more goes on the tape, then it closes
  calibrated(t) { if (this.tapeEnd === Infinity) this.tapeEnd = t + 1; }

  note(t, punch, kick) { this.decisions.push({ t, punch, kick }); }

  build(meta = {}) {
    const r3 = (v) => Math.round(v * 1000) / 1000;
    const r2 = (v) => Math.round(v * 100) / 100;
    const first = this.tape.length ? this.tape[0] : this.frames[0];
    const t0 = first ? first.t : 0;
    const enc = (f) => (f.a ? {
      t: r3(f.t - t0),
      w: Array.from({ length: 33 }, (_, i) => [r3(f.a[i * 4]), r3(f.a[i * 4 + 1]), r3(f.a[i * 4 + 2]), r2(f.a[i * 4 + 3])]),
      i: f.a[132] < -5 ? null : Array.from({ length: 33 }, (_, k) => [r3(f.a[132 + k * 2]), r3(f.a[133 + k * 2])]),
    } : { t: r3(f.t - t0), w: null, i: null });
    const tapeLast = this.tape.length ? this.tape[this.tape.length - 1].t : -Infinity;
    const ring = this.frames.filter((f) => f.t > tapeLast + 1e-6);
    return {
      format: 'ironecho-trace', formatVersion: 2, meta,
      seconds: this.frames.length ? this.frames[this.frames.length - 1].t - this.frames[0].t : 0,
      tape: this.tape.map(enc),   // the start of the session, calibration included
      frames: ring.map(enc),      // then the last seconds (times continue the same clock; a gap is normal)
      decisions: this.decisions.map((d) => ({ t: r3(d.t - t0), punch: d.punch, kick: d.kick })),
    };
  }
}

export class PoseProcessor {
  constructor(say = () => {}, opts = {}) {
    this._say = say;
    // close: elbows and knees (1.6, web only like the kicks); strikes: hooks, uppercuts and the duck (1.7, web only)
    this.opts = { personalBlock: true, kicks: true, punchCal: true, close: true, strikes: true, ...opts };
    this.strikeDetectors = [new HandStrikeDetector(0), new HandStrikeDetector(1)];
    this.strikes = [];        // [t, side, 'hook' | 'hookBody' | 'upper'] log (tests)
    this.lastHand = [-1e9, -1e9]; // when each hand last struck (one strike per hand at a time)
    this.lastOther = [-1e9, -1e9]; // when each hand last threw a hook, an uppercut or an elbow (no straight right after one)
    this.lastElbow = [-1e9, -1e9];
    this.pendingElbow = [null, null]; // { t, open }: an elbow strike waiting to be told from a hook (1.7)
    this.lastSeen = undefined; // the last frame with a good pose (loss hold)
    this.duck = 0;
    this.ducks = [];          // [t] each time the duck goes past 0.6 (tests)
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
  // image (optional): the same frame's image landmarks ({x, y} normalised); they show a duck best.
  process(world, t, image = null) {
    if (!world) {
      if (this._holding(t)) return;
      this.status = this.cal ? 3 : 6; // NoPerson
      this.confidence = 0;
      this._resetMotion();
      if (!this.cal) this._say('Не вижу тебя', 0, 'Встань в кадр: голова, плечи, руки. Больше света, без окна за спиной.');
      return;
    }
    const pose = bodyPose(world, t);
    pose.img = image && image.length >= 25 ? imageMeasures(image) : null;
    this.confidence = pose.visibilityOf(KEY_POINTS);
    if (!this.cal) {
      this._calibrate(pose);
      if (!this.cal) return; // like the tracker, the frame that completes calibration is already processed live
    }
    if (this.confidence < MIN_CONFIDENCE) {
      if (this._holding(t)) return;
      this.status = 4; // LowConfidence
      this._resetMotion();
      return;
    }
    this.lastSeen = t;
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
    if (this.opts.strikes) {
      this.duck = this._duck(pose, head, hips);
      // the log counts a duck once: down past 0.6, then up below 0.4 before the next one (the core's own hysteresis, IntentConfig)
      if (this.duck >= 0.6 && !this.ducked) { this.ducks.push(t); this.ducked = true; }
      if (this.duck < 0.4) this.ducked = false;
      // a duck folds the waist and brings the head toward the screen: that is not the lean that steps in
      this.leanForward *= 1 - Math.max(0, Math.min(1, (this.duck - 0.2) / 0.4));
    }
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
          if (this.opts.strikes) this.pendingElbow[side] = { t, open: fold, asym: raise - raises[1 - side] };
          else this._elbow(t, side);
        }
        const pe = this.pendingElbow[side];
        if (pe) {
          // a hook raises the elbow too, but its arm opens: wait a moment for the arm before calling it an elbow; and a block that
          // raised one elbow first raises the other one after it
          pe.open = Math.max(pe.open, fold);
          pe.asym = Math.min(pe.asym, raise - raises[1 - side]);
          if (pe.open > STRIKE_CFG.elbowMaxOpen || pe.asym < STRIKE_CFG.elbowMinAsym) this.pendingElbow[side] = null;
          else if (t - pe.t >= STRIKE_CFG.elbowConfirm) { this.pendingElbow[side] = null; this._elbow(pe.t, side); }
        }
      }
    }
    for (const side of [0, 1]) {
      const delta = sub(pose.p[WRIST_I[side]], pose.p[SHOULDER_I[side]]);
      const ext = norm(delta) / c.arm[side];
      const fwd = delta[0] / c.arm[side];
      // the extension is shoulder -> wrist: the elbow is not needed, and in a punch straight at the camera the glove hides it
      const vis = Math.min(pose.vis[WRIST_I[side]], pose.vis[SHOULDER_I[side]]);
      let kind = null;
      const sd = this.strikeDetectors[side];
      if (this.opts.strikes && c.guardUp) {
        const rel = [delta[0] / c.arm[side], (side === 0 ? delta[1] : -delta[1]) / c.arm[side], delta[2] / c.arm[side]];
        kind = sd.update(t, rel, ext, vis, c.guardUp[side], this.strikeDetectors[1 - side].v[2]);
      }
      if (this.detectors[side].update(t, ext, fwd, vis, c.guardExt[side])) {
        // The straight detector sees a hand leave the guard toward the screen. With hooks and uppercuts on, the direction decides:
        // across = a hook, up = an uppercut, swinging out = the cocking of a hook (it fires when the glove comes across).
        const shape = this.opts.strikes && c.guardUp ? sd.shape() : null;
        if (shape === 'hook' || shape === 'hookBody' || shape === 'upper') { kind = shape; sd.firedAt = t; }
        else if (shape !== 'cock' && t - this.lastOther[side] >= STRIKE_CFG.minInterval) {
          // a punch that ends well below the shoulders goes to the body (web only for now: the v1 tracker protocol
          // carries head punches; see Docs/Contracts/INPUT_CONTRACT.md 1.2)
          const low = pose.p[WRIST_I[side]][2] - pose.shoulderMid()[2] < -BODY_PUNCH_DROP * c.arm[side];
          this.mask |= side === 0 ? (low ? 4 : 1) : (low ? 8 : 2);
          this.punches.push([t, side]);
          this.lastHand[side] = t;
        }
      }
      if (kind === 'upper' && t - this.lastHand[side] < STRIKE_CFG.upAfterStrike) kind = null;
      if (kind && t - this.lastHand[side] >= STRIKE_CFG.minInterval && t - this.lastElbow[side] >= STRIKE_CFG.minInterval) {
        this.pendingElbow[side] = null; // the raised elbow was this hook's
        // 64 / 128 hook, 256 / 512 hook to the body, 1024 / 2048 uppercut: lead (left) / rear (right)
        this.mask |= (kind === 'hook' ? 64 : kind === 'hookBody' ? 256 : 1024) << side;
        this.strikes.push([t, side, kind]);
        this.lastHand[side] = t;
        this.lastOther[side] = t;
      }
    }
  }

  _elbow(t, side) {
    this.mask |= side === 0 ? 16 : 32;
    this.elbows.push([t, side]);
    this.lastElbow[side] = t;
    this.lastHand[side] = t;
    this.lastOther[side] = t;
  }

  // True while a short loss of the pose is being bridged (the player was Live a moment ago).
  _holding(t) {
    return !!this.cal && this.status === 7 && this.lastSeen !== undefined && t - this.lastSeen < LOSS_HOLD;
  }

  // 0 = standing, 1 = a full duck (the head about a quarter of a metre lower).
  _duck(pose, head, hips) {
    const c = this.cal;
    const dt = this.duckT === undefined ? 0 : Math.max(0, Math.min(0.2, pose.t - this.duckT));
    this.duckT = pose.t;
    const follow = this.duck < DUCK_CFG.followBelow ? dt / DUCK_CFG.followSeconds : 0;
    if (pose.img && c.neutralImg && c.neutralImg.torso > 0.02) {
      const n = c.neutralImg;
      const amount = (pose.img.headY - n.headY) / (DUCK_CFG.fullTorso * n.torso);
      n.headY += (pose.img.headY - n.headY) * follow;
      n.torso += (pose.img.torso - n.torso) * follow;
      return Math.max(0, Math.min(1.5, amount));
    }
    // world: the waist folds (the head comes down toward the hips) and both feet rise toward the hips (the knees bend)
    const up = head[2] - hips[2];
    let down = c.headUp - up;
    c.headUp += (up - c.headUp) * follow;
    if (c.legBase && this.legsVisible) {
      const lifts = [0, 1].map((s) => (pose.p[ANKLE_I[s]][2] - hips[2]) - c.legBase[s]);
      down += Math.max(0, Math.min(lifts[0], lifts[1]));
    }
    return Math.max(0, Math.min(1.5, down / DUCK_CFG.fullMetres));
  }

  _resetMotion() {
    this.detectors.forEach((d) => d.reset());
    if (this.strikeDetectors) this.strikeDetectors.forEach((d) => d.reset());
    this.kickDetectors.forEach((d) => d.reset());
    if (this.elbowDetectors) this.elbowDetectors.forEach((d) => d.reset());
    this.smooth.reset();
  }

  _kicks(pose, t) {
    const hip = pose.hipMid();
    let seen = 0;
    const close = this.opts.close && this.cal.kneeBase;
    const lifts = [0, 1].map((s) => (pose.p[ANKLE_I[s]][2] - hip[2]) - this.cal.legBase[s]);
    const rises = [0, 1].map((s) => (close ? (pose.p[KNEE_I[s]][2] - hip[2]) - this.cal.kneeBase[s] : 0));
    for (const side of [0, 1]) {
      // the hip is not required (1.7.1): a desk webcam hardly ever shows it, and the hip height is the model's own estimate anyway
      const kneeVis = pose.vis[KNEE_I[side]];
      const vis = Math.min(pose.vis[ANKLE_I[side]], kneeVis);
      seen += vis;
      // A kick lifts one leg; a duck (1.7) bends both knees, and in the hip-centred world both feet come up together. What both legs
      // share (beyond the standing leg's own small dip) is the body going down, not a leg strike.
      const common = this.opts.strikes ? Math.max(0, Math.min(lifts[0], lifts[1]) - 0.03) : 0;
      const commonKnee = this.opts.strikes && close ? Math.max(0, Math.min(rises[0], rises[1]) - 0.03) : 0;
      const lift = lifts[side] - common;
      const rise = close ? rises[side] - commonKnee : null;
      const kneeP = pose.p[KNEE_I[side]];
      const ankleP = pose.p[ANKLE_I[side]];
      const ahead = close ? (ankleP[0] - kneeP[0]) + 0.6 * Math.abs(ankleP[1] - kneeP[1]) : null;
      let kind;
      if (vis < KICK_CFG.minVisibility && close && kneeVis >= KICK_CFG.minVisibility) kind = this.kickDetectors[side].updateKneeOnly(t, rise, kneeVis);
      else kind = this.kickDetectors[side].update(t, lift, vis, rise, ahead);
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
      if (!visible) {
        this.window = [];
        const missing = PART_NAMES.filter(([idx]) => idx.some((i) => pose.vis[i] < 0.5)).map(([, name]) => name);
        this._say(STEPS.neutral, 0, `Нужно видеть голову, плечи, локти и кисти${missing.length ? `. Не видно: ${missing.join(', ')}` : ''}. Встань в кадр по центру, добавь света.`);
        return;
      }
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
        // how much of the legs the camera sees: both knees, both ankles (0..1)
        this.kneesSeen = median(this.neutral.map((q) => Math.min(q.vis[KNEE_I[0]], q.vis[KNEE_I[1]])));
        this.anklesSeen = median(this.neutral.map((q) => Math.min(q.vis[ANKLE_I[0]], q.vis[ANKLE_I[1]])));
        const imgs = this.neutral.filter((q) => q.img);
        this.neutralImg = imgs.length >= 3 ? { headY: median(imgs.map((q) => q.img.headY)), torso: median(imgs.map((q) => q.img.torso)) } : null;
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
      kneesSeen: this.kneesSeen,
      anklesSeen: this.anklesSeen,
      // 1.7: the guard's wrist height over its own shoulder (arm lengths), the head over the hips (m), the stance in the image
      guardUp: [0, 1].map((s) => median(ps.map((q) => (q.p[WRIST_I[s]][2] - q.p[SHOULDER_I[s]][2]) / arm[s]))),
      headUp: median(ps.map((q) => q.head()[2] - q.hipMid()[2])),
      neutralImg: this.neutralImg || null,
      slipLeft: this.slip[0],
      slipRight: this.slip[1],
      punchLimits: this.punchLimits || [null, null],
    };
    this.detectors.forEach((d, s) => d.setLimits(this.cal.punchLimits[s]));
    this._resetMotion();
    const legsNote = this.kneesSeen < 0.5 ? ' Ног не видно: колени и удары ногами выключены (отойди дальше, чтобы были видны колени и стопы).'
      : this.anklesSeen < 0.5 ? ' Стоп не видно: колени работают, удары ногами выключены.' : '';
    this._say('Готово! Бой начинается', 100, `Прямой — резко к экрану (ниже плеч — в корпус). Хук — дугой сбоку, локоть вверх. Апперкот — снизу вверх под подбородок. Нырок — присесть, голову вниз. Вплотную: локоть, колено. Блок — руки к лицу. Уклон — голову в сторону. Наклон к экрану — шаг вперёд.${legsNote}`);
    setTimeout(() => this._say(''), legsNote ? 6000 : 2600);
  }

  poll() {
    const mask = this.mask;
    this.mask = 0;
    const kickMask = this.kickMask;
    this.kickMask = 0;
    const block = this.cal && this.cal.blockPose ? this.blockPersonal : this.block;
    return { status: this.status, lean: this.lean, leanForward: this.leanForward, block, duck: this.duck, punchMask: mask, kickMask, confidence: this.confidence };
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
    // the phone's detector always runs the plain model: with "high accuracy" (3x slower) two detectors starve the game of the GPU
    if (!this.detector) this.detector = await this.host._makeDetector('full');
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
      this.els.badge(this.host._qualityOf(res, this.inferMs, !!this.isMain), this);
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
    // Webcam + phone: the fight starts on the webcam at once, the phone joins later (or is dropped, see _watchSecond). Two phones: there is
    // no webcam, so the fight waits for the first phone only.
    this.hold = this.second === 'phones';
    this.secondCfg = { ...SECOND_CFG };
    this.secondState = this.second === 'off' ? 'off' : 'waiting'; // waiting | matching | joined | dropped
    this.secondReason = '';
    this.matchSince = 0;
    this.everJoined = false;
    this.fpsHist = [];
    this.slowTicks = 0;
    this.starvedTicks = 0;
    this.light = null;
    this.lostSince = 0;
    this.lostShown = false;
    this.rec = new TraceRecorder(25);
    this.lastT = 0;
    this.taps = {};
    this.streams = {};
    this._ui();
    this.proc = new PoseProcessor((title, progress, note) => this._say(title, progress, note));
  }

  _ui() {
    const box = document.createElement('div');
    box.id = 'cam';
    box.innerHTML = `<video playsinline muted></video><canvas></canvas><div class="cam-guide"><span>голова</span><span>бёдра</span></div><div class="cam-q"><i></i><span></span></div><div class="cam-msg"><b></b><div class="cam-bar"><i></i></div><small></small></div>`;
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
      #cam .cam-bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#3f7dff,#8fb3ff)}
      #cam.big{width:min(46vw,460px)}
      #cam .cam-guide{position:absolute;inset:7% 27% 5% 27%;border:2px dashed rgba(143,179,255,.6);border-radius:10px;pointer-events:none}
      #cam .cam-guide span{position:absolute;left:50%;transform:translateX(-50%);padding:1px 6px;border-radius:3px;background:rgba(10,11,14,.7);color:#bcd0ff;font:700 10px/1.3 Inter,system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase}
      #cam .cam-guide span:first-child{top:-9px}#cam .cam-guide span:last-child{top:50%}
      .cam-toast{position:absolute;left:50%;top:calc(env(safe-area-inset-top,0px) + 64px);transform:translateX(-50%);z-index:8;max-width:min(92vw,560px);text-align:center;
        background:rgba(10,11,14,.92);border:1px solid rgba(255,255,255,.14);border-radius:8px;padding:9px 16px;color:#e8ecf2;font:600 14px/1.35 Inter,system-ui,sans-serif;pointer-events:none}`;
    document.head.appendChild(style);
    document.querySelector('#stage').appendChild(box);
    this.box = box;
    this.video = box.querySelector('video');
    this.overlay = box.querySelector('canvas');
    this.msg = box.querySelector('.cam-msg');
    this.qbox = box.querySelector('.cam-q');
    this.guide = box.querySelector('.cam-guide');
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
    this.tickTimer = setInterval(() => this._tick(), 500);
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
      minPoseDetectionConfidence: 0.35, minPosePresenceConfidence: 0.3, minTrackingConfidence: 0.3 });
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
    clearInterval(this.tickTimer);
    if (this.toastEl) this.toastEl.remove();
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
      if (this.hold) this._release(); // two phones: the first one is delivering
      this._feed(world, t, null);
    }, opts);
    if (this.hold) this._holdMessage();
  }

  async _openLink() {
    this._say('Готовлю подключение телефона…', 5, '');
    this.link = new PhoneLink();
    this.link.on('stream', ({ slot, stream }) => {
      this.streams[slot] = stream;
      if (this.detector && this.active && !this._secondDropped(slot)) this._attachPhone(slot);
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
      if (isMain) { tap.detector = this.detector; tap.shared = true; tap.isMain = true; } // the main camera uses the page's own detector
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
      #cam-link{position:absolute;left:16px;bottom:calc(env(safe-area-inset-bottom,0px) + 14px);z-index:7;width:min(92vw,360px);
        background:rgba(10,11,14,.95);border:1px solid rgba(255,255,255,.14);border-radius:10px;padding:12px 14px;color:#e8ecf2;font:500 13px/1.4 Inter,system-ui,sans-serif}
      #cam-link b{font:800 20px/1.1 "Barlow Condensed",Arial Narrow,sans-serif;letter-spacing:.05em}
      #cam-link .pp-row{display:flex;gap:10px;flex-direction:column;margin:8px 0}
      #cam-link .pp-ph{display:flex;gap:12px;align-items:center;min-width:0}
      #cam-link .pp-state{margin:4px 0 6px;font-weight:700;color:#c9d3e0}#cam-link .pp-state.ok{color:#3ddc84}#cam-link .pp-state.off{color:#ffb020}
      #cam-link .pp-btns{display:flex;gap:8px;flex-wrap:wrap}
      #cam-link .pp-qr{flex:none;background:#fff;padding:5px;border-radius:6px;line-height:0;width:112px;height:112px}
      #cam-link .pp-qr img{width:102px;height:102px;image-rendering:pixelated}
      #cam-link .pp-st{font-weight:700;color:#8fb3ff}#cam-link .pp-st.on{color:#3ddc84}
      #cam-link small{display:block;color:#9aa3ae;word-break:break-all}
      #cam-link button{margin-top:4px;background:#1d2530;color:#e8ecf2;border:1px solid rgba(255,255,255,.18);border-radius:6px;padding:7px 14px;font:700 13px Inter,system-ui,sans-serif;cursor:pointer;pointer-events:auto}`;
    document.head.appendChild(style);
    const panel = document.createElement('div');
    panel.id = 'cam-link';
    const title = this.second === 'phones' ? 'Два телефона вместо веб-камеры' : 'Второй телефон (необязательно)';
    panel.innerHTML = `<b>${title}</b>
      <div class="pp-row">${need.map((slot) => `<div class="pp-ph" data-slot="${slot}"><div class="pp-qr"></div>
        <div><div>${this.second === 'phones' ? (slot === 1 ? 'Телефон 1 (главная камера)' : 'Телефон 2 (сбоку)') : 'Телефон (поставь под углом около 45° к веб-камере, не строго сбоку)'}</div>
        <div class="pp-st">ждём…</div><small></small></div></div>`).join('')}</div>
      <div class="pp-state"></div>
      <div class="pp-note">${this.second === 'phones' ? 'Наведи камеру телефона на QR-код (или открой ссылку) и разреши камеру. Телефоны ставь в 2–3 м, чтобы было видно тебя от головы до бёдер.'
        : 'Бой идёт на веб-камере, ждать не нужно. Телефон подключится сам: поставь его в 2–3 м под углом ~45° так, чтобы он видел тебя целиком. Если камеры не сойдутся за 15 секунд, телефон отключится, и лагов не будет.'}</div>
      <div class="pp-btns"><button type="button" class="pp-close">Скрыть</button><button type="button" class="pp-retry" hidden>Подключить снова</button></div>`;
    document.querySelector('#stage').appendChild(panel);
    this.panel = panel;
    panel.querySelector('.pp-close').addEventListener('click', () => { panel.hidden = true; this.panelDone = false; });
    panel.querySelector('.pp-retry').addEventListener('click', () => this._retrySecond());
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
    const C = this.secondCfg;
    const f = this.fusion ? this.fusion.info : null;
    const left = this.matchSince ? Math.max(0, Math.ceil(((this.everJoined ? C.lostSeconds : C.matchSeconds) * 1000 - (performance.now() - this.matchSince)) / 1000)) : 0;
    const line = {
      waiting: this.hold ? 'Жду первый телефон…' : 'Жду телефон — бой идёт без него',
      matching: `Подбираю угол камер${f && f.rmsCm !== null ? ` (расхождение ${f.rmsCm.toFixed(0)} см, нужно меньше 16)` : ''}: подвигайся, ты один в кадре обеих камер. Ещё ${left} с`,
      joined: 'Две камеры работают ✓',
      dropped: `Второй телефон отключён: ${this.secondReason}. Играю на одной камере.`,
    }[this.secondState] || '';
    const stateEl = this.panel.querySelector('.pp-state');
    stateEl.textContent = line;
    stateEl.className = `pp-state${this.secondState === 'joined' ? ' ok' : this.secondState === 'dropped' ? ' off' : ''}`;
    this.panel.querySelector('.pp-retry').hidden = this.secondState !== 'dropped' || !this.streams[this.second === 'phones' ? 2 : 1];
    if (all && this.secondState === 'joined' && this.panelDone === undefined) {
      this.panelDone = true;
      setTimeout(() => { if (this.panel && this.secondState === 'joined') this.panel.hidden = true; }, 2500);
    }
  }

  _secondDropped(slot) { return this.secondState === 'dropped' && slot === (this.second === 'phones' ? 2 : 1); }

  // ---- the watch over the cameras, twice a second: the light, a lost player, the second camera
  _tick() {
    if (!this.active) return;
    // until calibration is done the preview is larger and shows where to stand (head at the top of the frame, hips about half way)
    const calibrating = !this.proc.cal && !this.hold;
    this.box.classList.toggle('big', calibrating && this.second === 'off');
    if (this.guide) this.guide.hidden = !calibrating;
    this._watchLight();
    this._watchLost();
    this._watchSecond();
  }

  // Brightness of the picture. A dark room or a window behind the player is the most common reason for "the camera does not see me",
  // and the tip says exactly that instead of a general "more light".
  _watchLight() {
    const now = performance.now();
    if (now - (this.lightAt || 0) < LIGHT_CFG.every || !this.video.videoWidth || this.video.readyState < 2) return;
    this.lightAt = now;
    try {
      if (!this.lightCtx) {
        const c = document.createElement('canvas');
        c.width = 32;
        c.height = 24;
        this.lightCtx = c.getContext('2d', { willReadFrequently: true });
      }
      this.lightCtx.drawImage(this.video, 0, 0, 32, 24);
      const d = this.lightCtx.getImageData(0, 0, 32, 24).data;
      let mid = 0; let nMid = 0; let edge = 0; let nEdge = 0;
      for (let y = 0; y < 24; y++) {
        for (let x = 0; x < 32; x++) {
          const i = (y * 32 + x) * 4;
          const l = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
          if (x >= 10 && x < 22 && y >= 3 && y < 21) { mid += l; nMid++; } else { edge += l; nEdge++; }
        }
      }
      const L = { centre: mid / nMid, edge: edge / nEdge };
      L.mean = (mid + edge) / (nMid + nEdge);
      this.light = this.light ? { centre: this.light.centre * 0.5 + L.centre * 0.5, edge: this.light.edge * 0.5 + L.edge * 0.5, mean: this.light.mean * 0.5 + L.mean * 0.5 } : L;
    } catch { this.light = null; }
  }

  _lightTip() {
    const L = this.light;
    if (!L) return '';
    if (L.centre < LIGHT_CFG.dark) return `Темно (яркость ${Math.round(L.centre * 100)} %): включи свет перед собой`;
    if (L.edge - L.centre > LIGHT_CFG.backlitGap && L.centre < LIGHT_CFG.backlitCentre) return 'Свет сзади (окно или лампа за спиной): повернись лицом к свету';
    if (L.centre < LIGHT_CFG.dim) return `Тусклый свет (${Math.round(L.centre * 100)} %): добавь освещения, иначе удары будут теряться`;
    return '';
  }

  // During the fight: the player has been missing for a second and a half: say so in big letters, with the likely reason
  _watchLost() {
    const p = this.proc;
    if (this.hold || !p.cal) return;
    const now = performance.now();
    if (p.status !== 3 && p.status !== 4) {
      this.lostSince = 0;
      if (this.lostShown) { this.lostShown = false; this._say(''); }
      return;
    }
    if (!this.lostSince) this.lostSince = now;
    if (now - this.lostSince < 1500) return;
    this.lostShown = true;
    const q = this.quality;
    const hint = this._lightTip() || (q && q.level !== 'good' && q.tip ? q.tip : 'Встань в 2–3 м от камеры: в кадре должны быть голова, руки и бёдра');
    this._say(p.status === 3 ? 'Не вижу тебя' : 'Плохо вижу тебя', 0, hint);
  }

  // The second camera joins when its view fits and is let go when it does not, or when it makes things slower.
  _watchSecond() {
    const C = this.secondCfg;
    if (this.second === 'off' || !this.fusion || this.secondState === 'dropped') return;
    const slotB = this.second === 'phones' ? 2 : 1;
    const tap = this.taps[slotB];
    const mainFps = this.second === 'phones' ? (this.taps[1] ? this.taps[1].fps : 0) : this.fps || 0;
    const now = performance.now();
    if (!this.streams[slotB] || !tap || !tap.active || tap.total < 5) { // no phone yet, or its model is still loading
      this.secondState = 'waiting';
      this.matchSince = 0;
      if (mainFps) { this.fpsHist.push(mainFps); if (this.fpsHist.length > 30) this.fpsHist.shift(); } // the speed of the first camera alone
      return;
    }
    const info = this.fusion.info;
    if (info.usable) {
      if (this.secondState !== 'joined') {
        this.secondState = 'joined';
        this.everJoined = true;
        this._toast('Вторая камера подключена ✓ — точнее удары вперёд и ногами');
      }
      this.matchSince = 0;
    } else {
      if (this.secondState !== 'matching') { this.secondState = 'matching'; this.matchSince = now; }
      if (now - this.matchSince > (this.everJoined ? C.lostSeconds : C.matchSeconds) * 1000) {
        this._dropSecond(this.everJoined ? 'камеры перестали сходиться'
          : `не сошлись за ${C.matchSeconds} с${info.rmsCm !== null ? ` (расхождение ${info.rmsCm.toFixed(0)} см)` : ', тебя не видно в обоих кадрах'}`);
        return;
      }
    }
    // load: a second detector shares the graphics card with the first one and the game
    this.slowTicks = tap.fps > 0 && tap.fps < C.minFps ? this.slowTicks + 1 : 0;
    if (this.slowTicks >= C.minFpsSeconds * 2) { this._dropSecond(`телефон даёт только ${Math.round(tap.fps)} к/с`); return; }
    const base = this.fpsHist.length ? Math.max(...this.fpsHist) : 0;
    this.starvedTicks = base >= C.baseMinFps && mainFps > 0 && mainFps < base * C.dropShare ? this.starvedTicks + 1 : 0;
    if (this.starvedTicks >= C.dropSeconds * 2) this._dropSecond(`первая камера замедлилась с ${Math.round(base)} до ${Math.round(mainFps)} к/с`);
  }

  _dropSecond(reason) {
    if (this.secondState === 'dropped') return;
    this.secondState = 'dropped';
    this.secondReason = reason;
    const slotB = this.second === 'phones' ? 2 : 1;
    if (this.fusion) this.fusion.setSecondEnabled(false);
    const tap = this.taps[slotB];
    if (tap) { tap.stop(); delete this.taps[slotB]; } // its detector (a worker on the graphics card) goes away; the phone's call stays open for a retry
    if (this.box2) this.box2.hidden = true;
    this.slowTicks = 0;
    this.starvedTicks = 0;
    this._toast(`Второй телефон отключён: ${reason}. Играю на одной камере.`, 7000);
    if (this.panel) { this.panel.hidden = false; this.panelDone = undefined; }
    this._refreshPanel();
  }

  _retrySecond() {
    if (this.secondState !== 'dropped') return;
    const slotB = this.second === 'phones' ? 2 : 1;
    this.secondState = 'waiting';
    this.secondReason = '';
    this.matchSince = 0;
    this.everJoined = false;
    this.slowTicks = 0;
    this.starvedTicks = 0;
    this.fpsHist = [];
    if (this.fusion) this.fusion.setSecondEnabled(true);
    if (this.streams[slotB] && this.detector && this.active) this._attachPhone(slotB);
    this._refreshPanel();
  }

  _toast(text, ms = 5000) {
    if (!this.toastEl) {
      this.toastEl = document.createElement('div');
      this.toastEl.className = 'cam-toast';
      document.querySelector('#stage').appendChild(this.toastEl);
    }
    this.toastEl.textContent = text;
    this.toastEl.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { if (this.toastEl) this.toastEl.hidden = true; }, ms);
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
      if (!bmp) { this._feed(null, now / 1000, null); continue; } // no frames: the processor reports tracking lost
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
        this._feed(res.worldLandmarks && res.worldLandmarks.length ? res.worldLandmarks[0] : null, tc / 1000, res.landmarks && res.landmarks[0]);
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

  _qualityOf(res, inferMs, mainView = true) {
    let level = 'good';
    let tip = 'Отслеживание в норме';
    const lm = res.landmarks && res.landmarks[0];
    const lightTip = mainView ? this._lightTip() : '';
    if (!lm) {
      level = 'bad';
      tip = lightTip || 'Тебя не видно: встань в кадр целиком, включи свет';
    } else {
      const vis = (i) => lm[i].visibility ?? 1;
      const mean = KEY_POINTS.reduce((a, i) => a + vis(i), 0) / KEY_POINTS.length;
      const ys = lm.filter((l) => (l.visibility ?? 1) > 0.5).map((l) => l.y);
      const xs = lm.filter((l) => (l.visibility ?? 1) > 0.5).map((l) => l.x);
      const height = ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
      const wristsSeen = vis(15) > 0.5 && vis(16) > 0.5;
      const kneesSeen = vis(25) > 0.5 && vis(26) > 0.5;
      const anklesSeen = vis(27) > 0.5 && vis(28) > 0.5;
      if (mean < 0.5) { level = 'bad'; tip = lightTip || 'Плохо видно: больше света, без окна за спиной'; }
      else if (!wristsSeen) { level = 'warn'; tip = 'Кисти выпали из кадра: отойди или встань по центру'; }
      else if (height < 0.42) { level = 'warn'; tip = 'Подойди ближе: ты слишком мелкий в кадре'; }
      else if (xs.length && (Math.min(...xs) < 0.04 || Math.max(...xs) > 0.96)) { level = 'warn'; tip = 'Встань по центру кадра'; }
      else if (mean < 0.7) { level = 'warn'; tip = lightTip || 'Видимость средняя: добавь света'; }
      else if (inferMs > 45) { level = 'warn'; tip = `Трекер тормозит (${Math.round(inferMs)} мс): выбери «Обычная» точность`; }
      else if (lightTip) { level = 'warn'; tip = lightTip; }
      else if (!kneesSeen && this.proc.cal) { tip = 'Ног не видно: колени и удары ногами выключены (отойди дальше)'; }
      else if (!anklesSeen && this.proc.cal) { tip = 'Стоп не видно: удары ногами выключены, колени работают'; }
    }
    return { level, tip };
  }

  _badge(q) {
    let { level, tip } = q;
    const f = this.fusionInfo;
    if (this.fusion && this.second !== 'off' && level === 'good') {
      if (this.secondState === 'dropped') tip = 'Одна камера: второй телефон отключён (причина — в панели слева)';
      else if (!Object.keys(this.streams).length) { level = 'warn'; tip = 'Телефон не подключён: работает одна камера'; }
      else if (this.secondState === 'joined' && f) tip = `2 камеры: синхронизация ${Math.round(f.offsetMs)} мс, расхождение ${f.rmsCm.toFixed(1)} см`;
      else if (this.secondState === 'matching') tip = 'Подбираю угол второй камеры: подвигайся';
    }
    this.quality = { level, tip };
    this.qbox.className = `cam-q ${level}`;
    // the numbers that decide whether the camera can be played with: frames a second the game really gets, ms per detection, where it runs
    const mode = this.detector ? `${this.detector.mode === 'worker' ? this.detector.delegate : 'основной поток'}` : '';
    const fps = this.fps ? ` · ${Math.round(this.fps)} к/с · ${Math.round(this.inferMs)} мс${mode ? ' · ' + mode : ''}` : '';
    this.qbox.querySelector('span').textContent = tip + fps;
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
    this._watchExposure(world);
    if (this.fusion) this.fusion.pushA(stamp / 1000, world);
    else this._feed(world, stamp / 1000, res.landmarks && res.landmarks[0]);
  }

  // every skeleton the game gets goes through here: into the recording, then into the strike detectors
  _feed(world, t, image) {
    this.lastT = t;
    this.rec.add(t, world, image);
    this.proc.process(world, t, image);
    if (this.proc.cal) this.rec.calibrated(t);
  }

  // Many webcams cut the exposure when asked for 60 frames a second, and a dim room then gives a dark picture the model cannot read:
  // "the camera constantly does not see me". When the person is missing from most of the last 4 seconds of results, once, ask the
  // camera for 30 frames a second (a longer exposure). The detector is not faster than that anyway.
  _watchExposure(world) {
    if (this.fpsLowered || this.source !== 'webcam') return;
    this.expSeen = (this.expSeen || 0) + (world ? 1 : 0);
    this.expAll = (this.expAll || 0) + 1;
    if (this.expAll < 100) return;
    const missing = 1 - this.expSeen / this.expAll;
    this.expSeen = 0;
    this.expAll = 0;
    if (missing < 0.6) return;
    this.fpsLowered = true;
    try {
      const track = this.video.srcObject && this.video.srcObject.getVideoTracks()[0];
      const have = track && track.getSettings ? track.getSettings().frameRate : 0;
      if (track && (!have || have > 31)) {
        track.applyConstraints({ frameRate: { ideal: 30, max: 30 } }).catch(() => {});
        this._say('Камера плохо видит тебя', 0, 'Снизил частоту камеры до 30 к/с — так она ловит больше света. Если не помогло: свет спереди, без окна за спиной.');
        setTimeout(() => this._say(''), 5000);
      }
    } catch { /* the camera does not allow it: nothing to do */ }
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
      fusion: f ? { mode: f.mode, offsetMs: f.offsetMs, rmsCm: f.rmsCm, usable: f.usable, blend: f.blend ?? 0 } : null, hold: this.hold,
      second: this.secondState, secondReason: this.secondReason, light: this.light ? Math.round(this.light.centre * 100) : null,
    };
  }

  poll() {
    if (this.hold) return { status: 6, lean: 0, leanForward: 0, block: 0, punchMask: 0, kickMask: 0, confidence: 0 }; // 6: calibrating
    const r = this.proc.poll();
    if (r.punchMask || r.kickMask) this.rec.note(this.lastT, r.punchMask, r.kickMask);
    return r;
  }

  // F4: save the last 25 seconds of what the camera gave the game (skeleton numbers only; a gzip file when the browser can, else plain JSON)
  async saveTrace() {
    const ver = document.querySelector('.ver');
    const track = this.video && this.video.srcObject && this.video.srcObject.getVideoTracks ? this.video.srcObject.getVideoTracks()[0] : null;
    const cal = this.proc.cal;
    const trace = this.rec.build({
      game: ver ? ver.textContent.trim() : '', savedAt: new Date().toISOString(), userAgent: navigator.userAgent, model: this.model, source: this.source,
      second: this.second, secondState: this.secondState, secondReason: this.secondReason,
      camera: track && track.getSettings ? track.getSettings() : null, video: this.video ? [this.video.videoWidth, this.video.videoHeight] : null,
      fps: Math.round(this.fps || 0), inferMs: Math.round(this.inferMs || 0), detector: this.detector ? `${this.detector.mode}/${this.detector.delegate}` : '-',
      light: this.light, status: this.proc.status, calibrated: !!cal,
      calibration: cal ? { arm: cal.arm, slipLeft: cal.slipLeft, slipRight: cal.slipRight, punchLimits: cal.punchLimits, kneesSeen: cal.kneesSeen, anklesSeen: cal.anklesSeen, blockPose: cal.blockPose } : null,
    });
    const json = JSON.stringify(trace);
    let blob = new Blob([json], { type: 'application/json' });
    let name = `ironecho-trace-${Date.now()}.json`;
    try {
      blob = await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
      name += '.gz';
    } catch { /* plain JSON */ }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 15000);
    this._toast(`Запись сохранена: ${name} (${Math.round(trace.seconds)} с, ${Math.round(blob.size / 1024)} КБ, только точки скелета — без видео). Пришли этот файл — разберу.`, 8000);
    return { name, bytes: blob.size, seconds: trace.seconds, frames: trace.frames.length, tape: trace.tape.length };
  }

  _release() {
    if (!this.hold) return;
    this.hold = false;
    this._say(STEPS.neutral, 0, 'Калибровка: 5 коротких шагов (стойка, блок, уклоны, удары в экран).');
  }

  // what the screen says while the fight waits for the first phone (two-phone mode: there is no webcam to start on)
  _holdMessage() {
    if (!this.hold) return;
    this._say('Жду телефон 1', 0, 'Отсканируй QR-код «Телефон 1 (главная камера)» (панель слева внизу). Бой начнётся, как только он заработает; второй телефон можно подключить позже.');
  }
}
