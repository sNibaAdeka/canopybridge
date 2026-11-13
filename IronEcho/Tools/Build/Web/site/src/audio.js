// Synthesised sound (Web Audio, no files). 1.10: an arena instead of a test tone. Everything goes through a short room reverb
// (a generated impulse response: early reflections off the stands, then a ~1.8 s tail), so a punch lands IN a hall; a hit is
// three layers (a low body thump through a soft clipper, a short crack of the armour, the ringing plates of a robot); a punch
// starts with the whine of the shoulder's servo; the crowd murmurs, gasps at a heavy blow and roars at a knockdown.
// The API is the one main.js calls: whoosh, servo, hit, block, bell, count, knockdown, crowdSwell, ui.
export class Sound {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.crowdGain = null;
    this.enabled = true;
  }

  // Must be called from a user gesture (browsers start audio only after interaction). `ctx`: an (Offline)AudioContext for tests.
  start(ctx = null) {
    if (this.ctx) {
      if (this.ctx.resume) this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!ctx && !AC) return;
    this.ctx = ctx || new AC();
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = 0.85;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 8;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;
    this.master.connect(comp).connect(c.destination);
    // the hall: every sound sends some of itself here
    this.reverb = c.createConvolver();
    this.reverb.buffer = this._hall(1.9);
    this.wet = c.createGain();
    this.wet.gain.value = 0.32;
    this.reverb.connect(this.wet).connect(this.master);
    this.noise = this._noiseBuffer(2.0);
    this.clip = this._clipCurve(2.2);
    this._crowd();
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.setTargetAtTime(on ? 0.85 : 0, this.ctx.currentTime, 0.05);
  }

  // ---- building blocks ----
  _noiseBuffer(seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b = 0.97 * b + 0.03 * w; // a little brown for body
      d[i] = 0.6 * w + 2.2 * b;
    }
    return buf;
  }

  // a stereo impulse response: sparse early reflections in the first 80 ms, then a decaying, darkening tail
  _hall(seconds) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / rate;
        const tail = Math.exp(-t * 3.4);
        const dark = 0.25 + 0.7 * Math.exp(-t * 2.0); // the higher frequencies die first in a big room
        lp += dark * ((Math.random() * 2 - 1) - lp);
        d[i] = lp * tail * 0.6;
      }
      for (let k = 0; k < 14; k++) { // early reflections: the ring posts, the apron, the first rows
        const at = Math.floor(rate * (0.008 + 0.075 * Math.random()));
        d[at] += (Math.random() < 0.5 ? -1 : 1) * (0.5 - 0.025 * k);
      }
    }
    return buf;
  }

  _clipCurve(drive) {
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(drive * x) / Math.tanh(drive);
    }
    return curve;
  }

  _src(loop = false) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = loop;
    return s;
  }

  // the end of every voice: a pan, then dry to the master and a share to the hall
  _out(node, pan = 0, wet = 0.25) {
    const c = this.ctx;
    let last = node;
    if (pan && c.createStereoPanner) {
      const p = c.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      node.connect(p);
      last = p;
    }
    last.connect(this.master);
    if (wet > 0) {
      const s = c.createGain();
      s.gain.value = wet;
      last.connect(s).connect(this.reverb);
    }
  }

  _env(t, peak, attack, decay) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return g;
  }

  _tone(type, f0, f1, dur, vol, t, pan = 0, wet = 0.2) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    this._out(g, pan, wet);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  _noiseBurst(t, { type = 'bandpass', freq = 1000, q = 1, peak = 0.3, attack = 0.002, decay = 0.05, pan = 0, wet = 0.2, sweepTo = 0 }) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + attack + decay);
    f.Q.value = q;
    const g = this._env(t, peak, attack, decay);
    const s = this._src();
    s.connect(f).connect(g);
    this._out(g, pan, wet);
    s.start(t, Math.random() * 1.5, attack + decay + 0.05);
  }

  // ---- the crowd ----
  _crowd() {
    const c = this.ctx;
    this.crowdGain = c.createGain();
    this.crowdGain.gain.value = 0.0;
    // two bands of murmur, each breathing at its own slow rate: a hall of people, not a fan
    for (const [freq, q, rate, depth] of [[520, 0.7, 0.11, 0.025], [1350, 0.9, 0.23, 0.018]]) {
      const src = this._src(true);
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = freq;
      bp.Q.value = q;
      const g = c.createGain();
      g.gain.value = 0.5;
      const lfo = c.createOscillator();
      const lfoGain = c.createGain();
      lfo.frequency.value = rate;
      lfoGain.gain.value = depth * 8;
      lfo.connect(lfoGain).connect(g.gain);
      src.connect(bp).connect(g).connect(this.crowdGain);
      src.start(0, Math.random() * 1.5);
      lfo.start();
    }
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2600;
    this.crowdGain.connect(lp);
    this._out(lp, 0, 0.5);
    this.crowdGain.gain.setTargetAtTime(0.07, c.currentTime, 1.5);
  }

  // amount ~0.6: a gasp at a heavy blow; 1.5-2: a roar (knockdown, the end)
  crowdSwell(amount = 1) {
    if (!this.ctx || !this.crowdGain) return;
    const t = this.ctx.currentTime;
    const g = this.crowdGain.gain;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(0.07 + 0.16 * amount, t, 0.08);
    g.setTargetAtTime(0.07, t + 0.6 + amount, 1.2);
    if (!this.enabled) return;
    // the "ooh": a vowel-like band that rises and falls with the crowd's breath
    this._noiseBurst(t + 0.05, { freq: 480, q: 3.5, peak: 0.05 * amount, attack: 0.18, decay: 0.5 + 0.3 * amount, sweepTo: 760, wet: 0.6 });
    if (amount >= 1.2) this._noiseBurst(t + 0.1, { freq: 1800, q: 1.2, peak: 0.04 * amount, attack: 0.25, decay: 1.2, wet: 0.7 });
  }

  // ---- the fighters ----
  // the shoulder's servo spinning up as a punch leaves: a short, filtered whine that glides up
  servo(power = 1, pan = 0) {
    if (!this.ctx || !this.enabled) return;
    const c = this.ctx;
    const t = c.currentTime;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    const f0 = 180 + 60 * Math.random();
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * (2.2 + 0.4 * power), t + 0.12);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1400;
    bp.Q.value = 2.5;
    const g = this._env(t, 0.028 * power, 0.02, 0.11);
    o.connect(bp).connect(g);
    this._out(g, pan, 0.12);
    o.start(t);
    o.stop(t + 0.16);
  }

  whoosh(power = 1, pan = 0) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    this._noiseBurst(t, { freq: 2600, q: 1.4, peak: 0.16 * power, attack: 0.03, decay: 0.15, sweepTo: 480, pan, wet: 0.15 });
  }

  // power ~0.7-1.2; counter: a sharper, louder crack; zone 1 = body (duller, lower)
  hit(power = 1, counter = false, pan = 0, zone = 0) {
    if (!this.ctx || !this.enabled) return;
    const c = this.ctx;
    const t = c.currentTime;
    const body = zone === 1;
    // 1) the thump: a sine with a fast pitch drop, driven into a soft clipper so it has weight on small speakers too
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(body ? 105 : 140, t);
    o.frequency.exponentialRampToValueAtTime(body ? 38 : 48, t + 0.14);
    const ws = c.createWaveShaper();
    ws.curve = this.clip;
    const g = this._env(t, 0.62 * power, 0.003, body ? 0.22 : 0.16);
    o.connect(ws).connect(g);
    this._out(g, pan * 0.5, 0.18);
    o.start(t);
    o.stop(t + 0.3);
    // 2) the crack of armour meeting a fist
    this._noiseBurst(t, { type: 'bandpass', freq: body ? 1500 : 3200, q: 0.8, peak: (counter ? 0.5 : 0.32) * power, attack: 0.001, decay: counter ? 0.05 : 0.035, pan, wet: 0.3 });
    this._noiseBurst(t, { type: 'lowpass', freq: 900, q: 0.7, peak: 0.25 * power, attack: 0.002, decay: 0.08, pan, wet: 0.2 });
    // 3) the plates ring: inharmonic partials (a struck metal shell), longer on a heavy blow, lower on the body
    const base = (body ? 260 : 430) + Math.random() * 90;
    const ring = 0.6 + 0.5 * Math.min(1.4, power);
    for (const [m, v, d] of [[1, 0.07, 0.42], [1.59, 0.05, 0.3], [2.76, 0.04, 0.24], [4.07, 0.025, 0.16], [5.4, 0.018, 0.1]]) {
      this._tone('sine', base * m, base * m * (0.992 + 0.004 * Math.random()), d * ring, v * power * (counter ? 1.5 : 1), t, pan, 0.35);
    }
  }

  block(power = 1, pan = 0) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    // forearm guard: a dull knock and a short clank, no ring (the block took it)
    this._noiseBurst(t, { freq: 340, q: 0.9, peak: 0.5 * power, attack: 0.001, decay: 0.08, pan, wet: 0.2 });
    this._noiseBurst(t, { freq: 2200, q: 2.0, peak: 0.12 * power, attack: 0.001, decay: 0.03, pan, wet: 0.2 });
    this._tone('triangle', 190, 120, 0.08, 0.2 * power, t, pan, 0.15);
  }

  bell(times = 1) {
    if (!this.ctx || !this.enabled) return;
    const t0 = this.ctx.currentTime;
    for (let k = 0; k < times; k++) {
      const t = t0 + k * 0.32;
      this._noiseBurst(t, { type: 'highpass', freq: 3000, q: 0.7, peak: 0.12, attack: 0.001, decay: 0.02, wet: 0.4 }); // the hammer
      for (const [f, v, d] of [[1120, 0.18, 2.2], [2060, 0.09, 1.6], [2990, 0.05, 1.1], [560, 0.06, 1.8], [4180, 0.025, 0.6]]) {
        this._tone('sine', f, f * 0.998, d, v, t, 0, 0.45);
      }
    }
  }

  count() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    this._tone('square', 880, 880, 0.06, 0.05, t, 0, 0.3);
    this._tone('sine', 440, 440, 0.12, 0.08, t, 0, 0.3);
  }

  knockdown() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    // a heavy frame on the canvas: a long low thud and the clatter of plates settling
    this._tone('sine', 80, 30, 0.6, 0.7, t, 0, 0.4);
    this._noiseBurst(t, { type: 'lowpass', freq: 600, q: 0.7, peak: 0.4, attack: 0.004, decay: 0.3, wet: 0.4 });
    for (let k = 0; k < 4; k++) this._noiseBurst(t + 0.08 + 0.07 * k + 0.03 * Math.random(), { freq: 1800 + 900 * Math.random(), q: 3, peak: 0.08, attack: 0.001, decay: 0.05, wet: 0.4 });
    this.crowdSwell(1.6);
  }

  ui() {
    if (!this.ctx || !this.enabled) return;
    this._tone('sine', 660, 990, 0.06, 0.06, this.ctx.currentTime, 0, 0);
  }
}
