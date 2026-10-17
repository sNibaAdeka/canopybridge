// Anonymous product telemetry: which steps players reach (opened → started a bout → finished → came back), how fast the game loads,
// frame rates, camera success and errors. No cookies, no names, no IP addresses, no video: a random id in localStorage and a few
// numbers per event. Off when the browser sends Do Not Track, when the player switches it off (Settings), and in automated browsers
// (tests) unless a test asks for it. Events go in batches to /api/events (Tools/Build/Web/api/events.mjs).
const TELE_KEY_ID = 'ironecho.aid';
const TELE_KEY_ON = 'ironecho.telemetry';
const TELE_KEY_FIRST = 'ironecho.firstSeen';
const TELE_KEY_DAYS = 'ironecho.returnDays';
const TELE_MAX_QUEUE = 100;
const TELE_MAX_BATCH = 20;
const TELE_FLUSH_MS = 10000;
export const TELE_TYPES = new Set(['page_open', 'cta_click', 'game_loaded', 'bout_start', 'first_punch', 'bout_end', 'rematch',
  'camera_try', 'camera_step', 'camera_calibrated', 'camera_fail', 'camera_quality', 'strike_use', 'fps_sample', 'rating_join',
  'share_click', 'error', 'net_stats', 'net_fail', 'return_day', 'feedback', 'tutorial', 'career', 'collect']);

const teleStore = {
  get(k) { try { return globalThis.localStorage ? localStorage.getItem(k) : null; } catch { return null; } },
  set(k, v) { try { if (globalThis.localStorage) localStorage.setItem(k, v); } catch { /* storage blocked: the id lives for this page only */ } },
};
const teleId = () => (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

// browser and OS family only (never the full user agent)
export function teleUaClass(ua = (globalThis.navigator && navigator.userAgent) || '') {
  const os = /Android/.test(ua) ? 'android' : /iPhone|iPad|iPod/.test(ua) ? 'ios' : /Windows/.test(ua) ? 'win' : /Mac OS X|Macintosh/.test(ua) ? 'mac'
    : /CrOS/.test(ua) ? 'cros' : /Linux/.test(ua) ? 'lin' : 'other';
  const br = /Edg\//.test(ua) ? 'edge' : /OPR\//.test(ua) ? 'opera' : /Firefox\//.test(ua) ? 'firefox' : /Chrome\//.test(ua) ? 'chrome'
    : /Safari\//.test(ua) ? 'safari' : 'other';
  return `${br}-${os}`;
}

// graphics family from the WebGL renderer string (the string itself never leaves the page)
export function teleGpuClass(renderer) {
  const r = String(renderer || '').toLowerCase();
  if (!r) return 'unknown';
  if (r.includes('swiftshader') || r.includes('llvmpipe') || r.includes('software')) return 'software';
  if (r.includes('nvidia') || r.includes('geforce') || r.includes('quadro') || r.includes('rtx')) return 'nvidia';
  if (r.includes('radeon') || r.includes('amd')) return 'amd';
  if (r.includes('apple')) return 'apple';
  if (r.includes('iris')) return 'intel-iris';
  if (r.includes('intel')) return 'intel';
  if (r.includes('mali')) return 'mali';
  if (r.includes('adreno')) return 'adreno';
  return 'other';
}

// a value that is safe to send: numbers, booleans, short strings; small flat objects (counts) at most
function teleClean(props) {
  const out = {};
  for (const [k, v] of Object.entries(props || {})) {
    if (typeof v === 'number') { if (Number.isFinite(v)) out[k] = Math.round(v * 1000) / 1000; }
    else if (typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string') out[k] = v.slice(0, 80);
    else if (v && typeof v === 'object' && !Array.isArray(v)) {
      const flat = {};
      for (const [kk, vv] of Object.entries(v)) if (typeof vv === 'number' && Number.isFinite(vv)) flat[kk] = vv;
      if (JSON.stringify(flat).length <= 300) out[k] = flat;
    }
    if (Object.keys(out).length >= 16) break;
  }
  return out;
}

export class Telemetry {
  // opts: { version, endpoint, send(url, body) (tests), now() (tests), automated (navigator.webdriver), force }
  constructor(opts = {}) {
    this.version = String(opts.version || '');
    this.endpoint = opts.endpoint || '';
    this.sendFn = opts.send || null;
    this.now = opts.now || (() => Date.now());
    this.queue = [];
    this.gpu = 'unknown';
    this.ua = teleUaClass(opts.ua);
    this.anon = teleStore.get(TELE_KEY_ID) || '';
    if (!this.anon) { this.anon = teleId(); teleStore.set(TELE_KEY_ID, this.anon); }
    this.session = teleId();
    const nav = globalThis.navigator || {};
    const dnt = nav.doNotTrack === '1' || globalThis.doNotTrack === '1';
    const automated = opts.automated ?? !!nav.webdriver;
    const saved = teleStore.get(TELE_KEY_ON);
    this.enabled = !!this.endpoint && (opts.force || (!automated && (saved === null ? !dnt : saved === '1')));
    this.seenErrors = new Set();
    this.timer = 0;
  }

  // listeners and the periodic flush (the page calls this once)
  start() {
    if (!globalThis.addEventListener) return;
    addEventListener('visibilitychange', () => { if (globalThis.document && document.visibilityState === 'hidden') this.flush(true); });
    addEventListener('pagehide', () => this.flush(true));
    addEventListener('error', (e) => this.error(e && e.message, e && e.filename ? `${String(e.filename).split('/').pop()}:${e.lineno}` : 'window'));
    addEventListener('unhandledrejection', (e) => this.error(e && e.reason && (e.reason.message || e.reason), 'promise'));
    this.timer = setInterval(() => this.flush(false), TELE_FLUSH_MS);
    this.returnDays();
  }

  setGpu(renderer) { this.gpu = teleGpuClass(renderer); }

  setEnabled(on) {
    teleStore.set(TELE_KEY_ON, on ? '1' : '0');
    this.enabled = !!on && !!this.endpoint;
    if (!this.enabled) this.queue = [];
  }

  track(type, props = {}) {
    if (!this.enabled || !TELE_TYPES.has(type)) return;
    this.queue.push({ type, props: teleClean(props), t: this.now() });
    if (this.queue.length > TELE_MAX_QUEUE) this.queue.shift();
  }

  // an error is sent once per distinct message per page load
  error(msg, where) {
    const m = String(msg || 'unknown').slice(0, 120);
    if (this.seenErrors.has(m) || this.seenErrors.size > 20) return;
    this.seenErrors.add(m);
    this.track('error', { msg: m, where: String(where || '').slice(0, 60) });
  }

  // days since the first visit: 1, 3, 7, 14, 30 are reported once each (retention without any server-side profile)
  returnDays() {
    const today = Math.floor(this.now() / 86400000);
    let first = Number(teleStore.get(TELE_KEY_FIRST));
    if (!Number.isFinite(first) || first <= 0) { first = today; teleStore.set(TELE_KEY_FIRST, String(today)); return; }
    const n = today - first;
    const done = new Set(String(teleStore.get(TELE_KEY_DAYS) || '').split(',').filter(Boolean).map(Number));
    for (const d of [1, 3, 7, 14, 30]) {
      if (n >= d && !done.has(d)) { done.add(d); this.track('return_day', { n: d }); }
    }
    teleStore.set(TELE_KEY_DAYS, [...done].join(','));
  }

  body(events) {
    return JSON.stringify({ v: this.version, a: this.anon, s: this.session, ua: this.ua, gpu: this.gpu, events });
  }

  flush(useBeacon = false) {
    if (!this.enabled || !this.queue.length) return null;
    const batch = this.queue.splice(0, TELE_MAX_BATCH);
    const body = this.body(batch);
    if (this.sendFn) { this.sendFn(this.endpoint, body); return body; }
    try {
      if (useBeacon && globalThis.navigator && navigator.sendBeacon && navigator.sendBeacon(this.endpoint, new Blob([body], { type: 'text/plain' }))) return body;
      fetch(this.endpoint, { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'text/plain' } })
        .catch(() => { this.queue.unshift(...batch.slice(0, 10)); });
    } catch { /* never let statistics break the game */ }
    return body;
  }
}
