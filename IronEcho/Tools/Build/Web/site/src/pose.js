// Webcam control in the browser: MediaPipe Tasks Vision PoseLandmarker (same model family as the tracker process)
// and a port of Tracking/iron_echo_tracker: body frame (body.py), calibration (calibration.py: neutral guard, slip
// left/right), punch onset detection, block amount, lean and One Euro smoothing (gestures.py, config.py defaults).
// Output = InputFrame fields for the core, exactly what the tracker sends to Unreal (INPUT_CONTRACT.md).
const MP_VERSION = '0.10.18';
// The offline builds (Netlify /play, Windows app) ship MediaPipe and the model next to the page: IRONECHO_DEPS.
const DEPS = globalThis.IRONECHO_DEPS || {};
const MP_BASE = DEPS.mediapipe || `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
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
const KICK_CFG = { minLift: 0.22, minSpeed: 1.4, midLift: 0.40, settle: 0.08, rearm: 0.08, minInterval: 0.5, minVisibility: 0.5 };
// Personal block: the calibrated block pose (wrists relative to the head) against the neutral guard.
const BLOCK_CAL = { minRise: 0.07, holdSeconds: 0.7, waitSeconds: 10, minDelta: 0.07 };
const KEY_POINTS = [0, 11, 12, 13, 14, 15, 16, 23, 24];
const SHOULDER_I = [P.LS, P.RS];
const ELBOW_I = [P.LE, P.RE];
const WRIST_I = [P.LW, P.RW];
const PUNCH_CFG = { triggerExtVelocity: 2.0, triggerFwdVelocity: 1.4, minExtAboveGuard: 0.10, minProgress: 0.16,
  progressWindow: 0.25, rearmFraction: 0.5, rearmTimeout: 0.6, minInterval: 0.15, minVisibility: 0.5 };
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
  constructor(side) { this.side = side; this.reset(); this.firedAt = -1e9; }
  reset() { this.history = []; this.armed = true; this.peak = 0; }
  update(t, extension, forward, visibility, guardExtension) {
    const c = PUNCH_CFG;
    if (visibility < c.minVisibility || !Number.isFinite(extension)) { this.history = []; return false; }
    this.history.push([t, extension, forward]);
    while (this.history.length && t - this.history[0][0] > Math.max(c.progressWindow, 0.3)) this.history.shift();
    if (!this.armed) {
      this.peak = Math.max(this.peak, extension);
      const retracted = extension <= guardExtension + c.rearmFraction * (this.peak - guardExtension);
      if (retracted || t - this.firedAt > c.rearmTimeout) this.armed = true;
      return false;
    }
    if (this.history.length < 3 || t - this.firedAt < c.minInterval) return false;
    let ref = this.history.find((s) => t - s[0] <= 0.075 && s[0] < t) || this.history[this.history.length - 2];
    const dt = t - ref[0];
    if (dt <= 1e-4) return false;
    const extVel = (extension - ref[1]) / dt;
    const fwdVel = (forward - ref[2]) / dt;
    const windowMin = Math.min(...this.history.filter((s) => t - s[0] <= c.progressWindow).map((s) => s[1]));
    if (extVel >= c.triggerExtVelocity && fwdVel >= c.triggerFwdVelocity && extension >= guardExtension + c.minExtAboveGuard
      && extension - windowMin >= c.minProgress) {
      this.armed = false;
      this.peak = extension;
      this.firedAt = t;
      return true;
    }
    return false;
  }
}

class KickDetector {
  constructor(side) { this.side = side; this.reset(); this.firedAt = -1e9; }
  reset() { this.history = []; this.armed = true; this.pending = null; }
  // lift: ankle height above the calibrated standing height, metres. Returns 'mid' | 'low' | null.
  update(t, lift, visibility) {
    const c = KICK_CFG;
    if (visibility < c.minVisibility || !Number.isFinite(lift)) { this.reset(); return null; }
    this.history.push([t, lift]);
    while (this.history.length && t - this.history[0][0] > 0.4) this.history.shift();
    if (this.pending) {
      this.pending.peak = Math.max(this.pending.peak, lift);
      if (t - this.pending.t0 >= c.settle) {
        const kind = this.pending.peak >= c.midLift ? 'mid' : 'low';
        this.pending = null;
        return kind;
      }
      return null;
    }
    if (!this.armed) {
      if (lift < c.rearm) this.armed = true;
      return null;
    }
    if (this.history.length < 3 || t - this.firedAt < c.minInterval) return null;
    const ref = this.history.find((s) => t - s[0] <= 0.12 && s[0] < t) || this.history[this.history.length - 2];
    const dt = t - ref[0];
    if (dt <= 1e-4) return null;
    const speed = (lift - ref[1]) / dt;
    if (lift >= c.minLift && speed >= c.minSpeed) {
      this.armed = false;
      this.firedAt = t;
      this.pending = { t0: t, peak: lift };
    }
    return null;
  }
}

const STEPS = {
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
    this.opts = { personalBlock: true, kicks: true, ...opts };
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
    for (const side of [0, 1]) {
      const delta = sub(pose.p[WRIST_I[side]], pose.p[SHOULDER_I[side]]);
      const ext = norm(delta) / c.arm[side];
      const fwd = delta[0] / c.arm[side];
      const vis = Math.min(pose.vis[WRIST_I[side]], pose.vis[ELBOW_I[side]], pose.vis[SHOULDER_I[side]]);
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
    this.smooth.reset();
  }

  _kicks(pose, t) {
    const hip = pose.hipMid();
    let seen = 0;
    for (const side of [0, 1]) {
      const vis = Math.min(pose.vis[ANKLE_I[side]], pose.vis[KNEE_I[side]], pose.vis[HIP_I[side]]);
      seen += vis;
      const lift = (pose.p[ANKLE_I[side]][2] - hip[2]) - this.cal.legBase[side];
      const kind = this.kickDetectors[side].update(t, lift, vis);
      if (kind) {
        this.kickMask |= (kind === 'mid' ? 1 : 4) << side; // 1 / 2 mid kick, 4 / 8 low kick: lead (left) / rear (right)
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
        this._finish();
      }
    }
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
      slipLeft: this.slip[0],
      slipRight: this.slip[1],
    };
    this._resetMotion();
    this._say('Готово! Бой начинается', 100, 'Удар — резко к экрану (ниже плеч — в корпус). Блок — руки к лицу. Уклон — голову в сторону. Наклон к экрану — шаг вперёд, назад — отход.');
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
    } else {
      this._say('Включаю камеру…', 5, 'Разреши доступ к камере. Встань в 2–3 м, чтобы в кадре были голова, руки и бёдра.');
      // 640x480 is enough (the network sees ~256 px); what matters is the frame rate: ask for 60, take what the camera gives
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 60 } }, audio: false });
      this.video.srcObject = stream;
      await this.video.play();
      this.overlay.width = this.video.videoWidth || 640;
      this.overlay.height = this.video.videoHeight || 480;
    }
    const names = { full: 'обычная', heavy: 'высокая точность, ~30 МБ', lite: 'лёгкая' };
    this._say('Загружаю модель позы…', 30, `MediaPipe PoseLandmarker: ${names[this.model]}, один раз.`);
    const vision = await import(/* @vite-ignore */ `${MP_BASE}/vision_bundle.mjs`);
    const fileset = await vision.FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
    // a lower presence / tracking bar keeps the skeleton through fast punches and motion blur (the processor
    // still drops frames whose key points are not visible)
    const options = (model, delegate) => ({ baseOptions: { modelAssetPath: MODELS[model], delegate }, runningMode: 'VIDEO', numPoses: 1,
      minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.4, minTrackingConfidence: 0.4 });
    const create = async (model) => {
      try {
        return await vision.PoseLandmarker.createFromOptions(fileset, options(model, 'GPU'));
      } catch {
        return vision.PoseLandmarker.createFromOptions(fileset, options(model, 'CPU'));
      }
    };
    try {
      this.landmarker = await create(this.model);
    } catch (err) {
      if (this.model === 'full') throw err;
      this._say('Модель не загрузилась', 30, 'Беру обычную модель.');
      this.model = 'full';
      this.landmarker = await create('full');
    }
    this.drawing = new vision.DrawingUtils(this.overlay.getContext('2d'));
    this.connections = vision.PoseLandmarker.POSE_CONNECTIONS;
    this.active = true;
    this._say(STEPS.neutral, 0, 'Калибровка: 3 коротких шага.');
    if (this.source === 'phone') {
      this._phoneLoop();
      return;
    }
    const loop = (now, meta) => {
      if (!this.active) return;
      // the moment the camera captured the frame (not the moment we got to it): steadier speeds for the punch detector
      this._process(meta && Number.isFinite(meta.captureTime) ? meta.captureTime : undefined);
      if (this.video.requestVideoFrameCallback) this.video.requestVideoFrameCallback(loop);
      else requestAnimationFrame(loop);
    };
    loop();
  }

  stop() {
    this.active = false;
    this.stopped = true;
    const s = this.video.srcObject;
    if (s) s.getTracks().forEach((tr) => tr.stop());
    this.box.hidden = true;
    if (this.pairBox) this.pairBox.remove();
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
      const res = this.landmarker.detectForVideo(bmp, now);
      this._assess(res, performance.now() - now);
      const ctx = this.overlay.getContext('2d');
      ctx.drawImage(bmp, 0, 0);
      if (res.landmarks && res.landmarks[0]) {
        this.drawing.drawConnectors(res.landmarks[0], this.connections, { color: '#3f7dff', lineWidth: 3 });
        this.drawing.drawLandmarks(res.landmarks[0], { color: '#ffffff', radius: 2 });
      }
      bmp.close();
      this.proc.process(res.worldLandmarks && res.worldLandmarks.length ? res.worldLandmarks[0] : null, now / 1000);
    }
  }

  // Tracking quality badge: what the camera sees and what to change (distance, light, load).
  _assess(res, inferMs) {
    this.inferMs = this.inferMs ? this.inferMs * 0.9 + inferMs * 0.1 : inferMs;
    const now = performance.now();
    if (now - this.lastQualityAt < 400) return;
    this.lastQualityAt = now;
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
      else if (this.inferMs > 45) { level = 'warn'; tip = `Трекер тормозит (${Math.round(this.inferMs)} мс): выбери «Обычная» точность`; }
      else if (!this.proc.legsVisible && this.proc.cal) { tip = 'Ноги не видны: удары ногами выключены (отойди на 3 м)'; }
    }
    this.quality = { level, tip };
    this.qbox.className = `cam-q ${level}`;
    this.qbox.querySelector('span').textContent = tip;
  }

  _process(captureTime) {
    if (this.video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = this.video.currentTime;
    const now = performance.now();
    const res = this.landmarker.detectForVideo(this.video, now);
    this._assess(res, performance.now() - now);
    const ctx = this.overlay.getContext('2d');
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    if (res.landmarks && res.landmarks[0]) {
      this.drawing.drawConnectors(res.landmarks[0], this.connections, { color: '#3f7dff', lineWidth: 3 });
      this.drawing.drawLandmarks(res.landmarks[0], { color: '#ffffff', radius: 2 });
    }
    this.proc.process(res.worldLandmarks && res.worldLandmarks.length ? res.worldLandmarks[0] : null, (captureTime ?? now) / 1000);
  }

  poll() { return this.proc.poll(); }
}
