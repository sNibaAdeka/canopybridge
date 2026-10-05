// Synthesised sound (Web Audio, no files): crowd bed, punch whoosh, metal impact, glove block, bell, referee count.
export class Sound {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.crowdGain = null;
    this.enabled = true;
  }

  // Must be called from a user gesture (browsers start audio only after interaction).
  start() {
    if (this.ctx) {
      this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.8;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(this.ctx.destination);
    this.noise = this._noiseBuffer(2.0);
    this._crowd();
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.setTargetAtTime(on ? 0.8 : 0, this.ctx.currentTime, 0.05);
  }

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

  _src(loop = false) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = loop;
    return s;
  }

  _crowd() {
    const ctx = this.ctx;
    const src = this._src(true);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 700;
    bp.Q.value = 0.5;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    this.crowdGain = ctx.createGain();
    this.crowdGain.gain.value = 0.0;
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.13;
    lfoGain.gain.value = 0.02;
    lfo.connect(lfoGain).connect(this.crowdGain.gain);
    src.connect(bp).connect(lp).connect(this.crowdGain).connect(this.master);
    src.start();
    lfo.start();
    this.crowdGain.gain.setTargetAtTime(0.07, ctx.currentTime, 1.5);
  }

  crowdSwell(amount = 1) {
    if (!this.ctx || !this.crowdGain) return;
    const t = this.ctx.currentTime;
    const g = this.crowdGain.gain;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(0.07 + 0.16 * amount, t, 0.08);
    g.setTargetAtTime(0.07, t + 0.6 + amount, 1.2);
  }

  whoosh(power = 1) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = this._src();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(2600, t);
    bp.frequency.exponentialRampToValueAtTime(500, t + 0.16);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18 * power, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.5, 0.2);
  }

  _tone(type, f0, f1, dur, vol, t) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  hit(power = 1, counter = false) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    this._tone('sine', 120, 42, 0.16, 0.55 * power, t); // body thump
    const src = this._src();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.35 * power, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    src.connect(hp).connect(g).connect(this.master);
    src.start(t, Math.random(), 0.06);
    // armour ring: inharmonic partials
    const base = 520 + Math.random() * 120;
    for (const [m, v, d] of [[1, 0.06, 0.32], [2.76, 0.04, 0.22], [5.4, 0.025, 0.12]]) {
      this._tone('sine', base * m, base * m * 0.995, d, v * power * (counter ? 1.5 : 1), t);
    }
  }

  block(power = 1) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = this._src();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 340;
    bp.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5 * power, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t, Math.random(), 0.1);
    this._tone('triangle', 180, 120, 0.07, 0.2 * power, t);
  }

  bell(times = 1) {
    if (!this.ctx || !this.enabled) return;
    const t0 = this.ctx.currentTime;
    for (let k = 0; k < times; k++) {
      const t = t0 + k * 0.32;
      for (const [f, v, d] of [[1120, 0.18, 2.2], [2060, 0.09, 1.6], [2990, 0.05, 1.1], [560, 0.06, 1.8]]) {
        this._tone('sine', f, f * 0.998, d, v, t);
      }
    }
  }

  count() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    this._tone('square', 880, 880, 0.06, 0.05, t);
    this._tone('sine', 440, 440, 0.12, 0.08, t);
  }

  knockdown() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    this._tone('sine', 80, 30, 0.6, 0.7, t);
    this.crowdSwell(1.6);
  }

  ui() {
    if (!this.ctx || !this.enabled) return;
    this._tone('sine', 660, 990, 0.06, 0.06, this.ctx.currentTime);
  }
}
