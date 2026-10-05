// Webcam control in the browser: MediaPipe Tasks Vision PoseLandmarker (same model family as the tracker process)
// and a port of Tracking/iron_echo_tracker: body frame (body.py), calibration (calibration.py: neutral guard, slip
// left/right), punch onset detection, block amount, lean and One Euro smoothing (gestures.py, config.py defaults).
// Output = InputFrame fields for the core, exactly what the tracker sends to Unreal (INPUT_CONTRACT.md).
const MP_VERSION = '0.10.18';
// The offline builds (Netlify /play, Windows app) ship MediaPipe and the model next to the page: IRONECHO_DEPS.
const DEPS = globalThis.IRONECHO_DEPS || {};
const MP_BASE = DEPS.mediapipe || `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const MODEL_URL = DEPS.poseModel || 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';

const P = { NOSE: 0, LEAR: 7, REAR: 8, LS: 11, RS: 12, LE: 13, RE: 14, LW: 15, RW: 16, LH: 23, RH: 24 };
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

const STEPS = {
  neutral: 'Встань в боксёрскую стойку, руки у подбородка — и замри',
  slipLeft: 'Уклон ВЛЕВО — наклони голову влево и задержи',
  slipRight: 'Уклон ВПРАВО — наклони голову вправо и задержи',
};

// Pure tracker logic (no DOM, no MediaPipe): feed world landmarks, read InputFrame fields. Tested against the Python
// tracker by Tools/Build/Web/check_pose.mjs.
export class PoseProcessor {
  constructor(say = () => {}) {
    this._say = say;
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
    for (const side of [0, 1]) {
      const delta = sub(pose.p[WRIST_I[side]], pose.p[SHOULDER_I[side]]);
      const ext = norm(delta) / c.arm[side];
      const fwd = delta[0] / c.arm[side];
      const vis = Math.min(pose.vis[WRIST_I[side]], pose.vis[ELBOW_I[side]], pose.vis[SHOULDER_I[side]]);
      if (this.detectors[side].update(t, ext, fwd, vis, c.guardExt[side])) {
        this.mask |= side === 0 ? 1 : 2;
        this.punches.push([t, side]);
      }
    }
  }

  _resetMotion() {
    this.detectors.forEach((d) => d.reset());
    this.smooth.reset();
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
      slipLeft: this.slip[0],
      slipRight: this.slip[1],
    };
    this._resetMotion();
    this._say('Готово! Бой начинается', 100, 'Джеб и кросс — резкий прямой удар к экрану. Блок — обе руки к лицу. Уклон — голову в сторону.');
    setTimeout(() => this._say(''), 2600);
  }

  poll() {
    const mask = this.mask;
    this.mask = 0;
    return { status: this.status, lean: this.lean, leanForward: this.leanForward, block: this.block, punchMask: mask, confidence: this.confidence };
  }
}

export class CameraInput {
  constructor() {
    this.active = false;
    this.lastVideoTime = -1;
    this._ui();
    this.proc = new PoseProcessor((title, progress, note) => this._say(title, progress, note));
  }

  _ui() {
    const box = document.createElement('div');
    box.id = 'cam';
    box.innerHTML = `<video playsinline muted></video><canvas></canvas><div class="cam-msg"><b></b><div class="cam-bar"><i></i></div><small></small></div>`;
    const style = document.createElement('style');
    style.textContent = `#cam{position:absolute;right:16px;top:calc(env(safe-area-inset-top,0px) + 92px);width:min(30vw,300px);aspect-ratio:4/3;border-radius:6px;overflow:hidden;border:1px solid rgba(255,255,255,.12);background:#000;z-index:5;pointer-events:none}
      #cam video,#cam canvas{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform:scaleX(-1)}
      #cam .cam-msg{position:fixed;left:50%;bottom:24%;transform:translateX(-50%);width:min(90vw,560px);text-align:center;background:rgba(10,11,14,.88);border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:14px 18px}
      #cam .cam-msg b{font:800 26px/1.15 "Barlow Condensed",Arial Narrow,sans-serif;letter-spacing:.05em;color:#fff}
      #cam .cam-msg small{display:block;margin-top:8px;color:#9aa3ae;font:500 13px/1.35 Inter,system-ui,sans-serif}
      #cam .cam-bar{height:8px;margin-top:10px;border-radius:4px;background:rgba(255,255,255,.08);overflow:hidden}
      #cam .cam-bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#3f7dff,#8fb3ff)}`;
    document.head.appendChild(style);
    document.querySelector('#stage').appendChild(box);
    this.box = box;
    this.video = box.querySelector('video');
    this.overlay = box.querySelector('canvas');
    this.msg = box.querySelector('.cam-msg');
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
    this._say('Включаю камеру…', 5, 'Разреши доступ к камере. Встань в 2–3 м, чтобы в кадре были голова, руки и бёдра.');
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 60 } }, audio: false });
    this.video.srcObject = stream;
    await this.video.play();
    this.overlay.width = this.video.videoWidth || 640;
    this.overlay.height = this.video.videoHeight || 480;
    this._say('Загружаю модель позы…', 30, 'MediaPipe PoseLandmarker (full), один раз ~10 МБ.');
    const vision = await import(/* @vite-ignore */ `${MP_BASE}/vision_bundle.mjs`);
    const fileset = await vision.FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
    const options = (delegate) => ({ baseOptions: { modelAssetPath: MODEL_URL, delegate }, runningMode: 'VIDEO', numPoses: 1,
      minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5 });
    try {
      this.landmarker = await vision.PoseLandmarker.createFromOptions(fileset, options('GPU'));
    } catch {
      this.landmarker = await vision.PoseLandmarker.createFromOptions(fileset, options('CPU'));
    }
    this.drawing = new vision.DrawingUtils(this.overlay.getContext('2d'));
    this.connections = vision.PoseLandmarker.POSE_CONNECTIONS;
    this.active = true;
    this._say(STEPS.neutral, 0, 'Калибровка: 3 коротких шага.');
    const loop = () => {
      if (!this.active) return;
      this._process();
      if (this.video.requestVideoFrameCallback) this.video.requestVideoFrameCallback(loop);
      else requestAnimationFrame(loop);
    };
    loop();
  }

  stop() {
    this.active = false;
    const s = this.video.srcObject;
    if (s) s.getTracks().forEach((tr) => tr.stop());
    this.box.hidden = true;
  }

  _process() {
    if (this.video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = this.video.currentTime;
    const now = performance.now();
    const res = this.landmarker.detectForVideo(this.video, now);
    const ctx = this.overlay.getContext('2d');
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    if (res.landmarks && res.landmarks[0]) {
      this.drawing.drawConnectors(res.landmarks[0], this.connections, { color: '#3f7dff', lineWidth: 3 });
      this.drawing.drawLandmarks(res.landmarks[0], { color: '#ffffff', radius: 2 });
    }
    this.proc.process(res.worldLandmarks && res.worldLandmarks.length ? res.worldLandmarks[0] : null, now / 1000);
  }

  poll() { return this.proc.poll(); }
}
