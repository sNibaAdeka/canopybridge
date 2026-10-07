// Pose detection off the main thread.
//
// MediaPipe's PoseLandmarker used to run inside the render loop: one detection takes 8-40 ms (the heavy model on a weak GPU or
// the CPU fallback, far more), so every camera frame stole a slice of the frame the game needs for drawing, and two cameras
// doubled it. Here each camera gets its own Web Worker with its own PoseLandmarker; the page only copies the video frame
// (createImageBitmap) and later draws what comes back. At most one frame per camera is in flight: when the detector is busy the
// newest camera frame simply waits for the next turn (a real-time pipeline never queues).
//
// The worker is a classic worker (a module worker cannot importScripts, which MediaPipe's WASM loader needs) and loads the
// CommonJS build of tasks-vision. If a worker cannot be started (no Worker / OffscreenCanvas, a blocked script) the detector
// falls back to running on the main thread, exactly as before.
//
// Result layout (Float32Array, transferred): [found, 33 x (x, y, z, visibility) world landmarks, 33 x (x, y, z, visibility) image landmarks]
function poseWorkerMain() {
  let lm = null;
  let last = 0;
  self.onmessage = async (e) => {
    const m = e.data;
    if (m.t === 'init') {
      try {
        self.exports = {};
        self.module = { exports: self.exports };
        importScripts(m.bundle);
        const vision = self.module.exports.PoseLandmarker ? self.module.exports : self.exports;
        const fileset = await vision.FilesetResolver.forVisionTasks(m.wasm);
        const make = (delegate) => vision.PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: m.model, delegate }, runningMode: 'VIDEO', numPoses: 1,
          minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.4, minTrackingConfidence: 0.4 });
        let delegate = 'GPU';
        try { lm = await make('GPU'); } catch { delegate = 'CPU'; lm = await make('CPU'); }
        self.postMessage({ t: 'ready', delegate });
      } catch (err) {
        self.postMessage({ t: 'error', error: String((err && err.message) || err) });
      }
    } else if (m.t === 'frame') {
      const t0 = performance.now();
      let out = null;
      try {
        last = Math.max(last + 1, t0);
        const r = lm.detectForVideo(m.bitmap, last);
        const w = r.worldLandmarks && r.worldLandmarks[0];
        const n = r.landmarks && r.landmarks[0];
        if (w && n) {
          out = new Float32Array(1 + 33 * 8);
          out[0] = 1;
          for (let i = 0; i < 33; i++) {
            const o = 1 + i * 4;
            out[o] = w[i].x; out[o + 1] = w[i].y; out[o + 2] = w[i].z; out[o + 3] = w[i].visibility ?? 1;
            const p = 1 + 33 * 4 + i * 4;
            out[p] = n[i].x; out[p + 1] = n[i].y; out[p + 2] = n[i].z; out[p + 3] = n[i].visibility ?? 1;
          }
        } else out = new Float32Array([0]);
      } catch (err) {
        self.postMessage({ t: 'result', seq: m.seq, tc: m.tc, ms: performance.now() - t0, error: String((err && err.message) || err) });
        if (m.bitmap.close) m.bitmap.close();
        return;
      }
      if (m.bitmap.close) m.bitmap.close();
      self.postMessage({ t: 'result', seq: m.seq, tc: m.tc, ms: performance.now() - t0, out }, [out.buffer]);
    }
  };
}
const POSE_WORKER_SRC = `(${poseWorkerMain.toString()})()`;

const unpackLandmarks = (arr, offset) => {
  const lm = new Array(33);
  for (let i = 0; i < 33; i++) {
    const o = offset + i * 4;
    lm[i] = { x: arr[o], y: arr[o + 1], z: arr[o + 2], visibility: arr[o + 3] };
  }
  return lm;
};

// One camera's detector: `submit(source, captureMs, onResult)` where source is a <video> or an ImageBitmap (consumed).
// onResult(res, inferMs, captureMs): res looks like MediaPipe's own result ({ landmarks, worldLandmarks }).
class PoseDetector {
  constructor() {
    this.worker = null;
    this.local = null;      // fallback: a PoseLandmarker on the main thread
    this.busy = false;
    this.seq = 0;
    this.pending = null;
    this.mode = '';         // 'worker' | 'main'
    this.delegate = '';
  }

  // cfg: { bundle (absolute URL of the worker bundle) | null, wasm, model, makeLocal: async () => PoseLandmarker }
  async init(cfg) {
    if (cfg.bundle && typeof Worker !== 'undefined' && typeof createImageBitmap === 'function') {
      try {
        await this._startWorker(cfg);
        this.mode = 'worker';
        return;
      } catch (err) {
        console.warn('pose worker unavailable, detecting on the main thread:', err && err.message ? err.message : err);
        this._stopWorker();
      }
    }
    this.local = await cfg.makeLocal();
    this.mode = 'main';
    this.delegate = 'main';
  }

  _startWorker(cfg) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(new Blob([POSE_WORKER_SRC], { type: 'text/javascript' }));
      const w = new Worker(url);
      this.worker = w;
      const timer = setTimeout(() => reject(new Error('pose worker did not start in 90 s')), 90000);
      w.onerror = (e) => { clearTimeout(timer); reject(new Error(e.message || 'worker error')); };
      w.onmessage = (e) => {
        const m = e.data;
        if (m.t === 'ready') { clearTimeout(timer); this.delegate = m.delegate; w.onmessage = (ev) => this._onWorker(ev.data); resolve(); }
        else if (m.t === 'error') { clearTimeout(timer); reject(new Error(m.error)); }
      };
      w.postMessage({ t: 'init', bundle: cfg.bundle, wasm: cfg.wasm, model: cfg.model });
    });
  }

  _stopWorker() {
    if (this.worker) { try { this.worker.terminate(); } catch { /* ignore */ } this.worker = null; }
  }

  _onWorker(m) {
    if (m.t !== 'result') return;
    this.busy = false;
    const p = this.pending;
    this.pending = null;
    if (!p) return;
    if (m.error || !m.out) { p.cb({ landmarks: [], worldLandmarks: [] }, m.ms || 0, p.tc); return; }
    const o = m.out;
    p.cb(o[0] ? { landmarks: [unpackLandmarks(o, 1 + 33 * 4)], worldLandmarks: [unpackLandmarks(o, 1)] } : { landmarks: [], worldLandmarks: [] }, m.ms, p.tc);
  }

  // false: the detector is busy and this frame was dropped (an ImageBitmap source is closed here)
  submit(source, tc, cb) {
    if (this.mode === 'main') {
      const t0 = performance.now();
      const res = this.local.detectForVideo(source, t0);
      if (source.close) source.close();
      cb(res, performance.now() - t0, tc);
      return true;
    }
    if (this.busy) { if (source.close) source.close(); return false; }
    this.busy = true;
    const seq = ++this.seq;
    this.pending = { cb, tc, seq };
    const send = (bitmap) => {
      if (!this.worker) { this.busy = false; this.pending = null; if (bitmap.close) bitmap.close(); return; }
      this.worker.postMessage({ t: 'frame', seq, tc, bitmap }, [bitmap]);
    };
    if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) send(source);
    else createImageBitmap(source).then(send, () => { this.busy = false; this.pending = null; });
    return true;
  }

  stop() {
    this._stopWorker();
    this.busy = false;
    this.pending = null;
    if (this.local && this.local.close) { try { this.local.close(); } catch { /* ignore */ } }
  }
}
