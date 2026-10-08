import { cleanNick } from './ratingrules.js';

// The page's side of the rating: a profile (nickname + a secret that proves it is yours), the table, and sending a finished bout.
// No DOM in here (the menu wiring is in main.js), so it runs in the tests against the very same server code.
//
// What is sent for a rated bout is its recording (replay.js), not a claim: the server plays it again and decides who won.
// A bout that is left half way counts as a loss (a "forfeit"), also when the tab is closed: a marker in the storage is
// settled at the next start.

const RATING_PROFILE_KEY = 'ironecho.profile';
const RATING_PENDING_KEY = 'ironecho.pending';
const RATING_QUEUE_KEY = 'ironecho.queue';
const RATING_QUEUE_MAX_CHARS = 700000; // a bout that could not be sent is kept for the next start, as base64 text

const ratingHex = (n) => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('');
function ratingUuid() {
  if (globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID();
  const h = ratingHex(16).split('');
  h[12] = '4'; h[16] = '89ab'[parseInt(h[16], 16) & 3];
  const s = h.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

// A short id of the core build in the page (the server only accepts recordings made with the build it holds).
export function ratingCoreId(b64) {
  let h = 0x811c9dc5;
  const s = String(b64 || '');
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return `${s.length.toString(36)}-${h.toString(36)}`;
}

export async function ratingGzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const b64Of = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
const bytesOf = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

export class RatingClient {
  // api: base URL of /api/ratings ('' = ratings off); storage: localStorage-like; coreId: ratingCoreId(...)
  constructor({ api, storage, coreId, fetchFn }) {
    this.api = api || '';
    this.storage = storage;
    this.coreId = coreId;
    this.fetch = fetchFn || ((...a) => globalThis.fetch(...a));
  }

  get enabled() { return !!this.api; }

  _read(key) { try { const t = this.storage.getItem(key); return t ? JSON.parse(t) : null; } catch { return null; } }
  _write(key, value) { try { if (value === null) this.storage.removeItem(key); else this.storage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } }

  get profile() { return this._read(RATING_PROFILE_KEY); }
  get nick() { const p = this.profile; return p && p.claimed ? p.nick : ''; }

  async _json(method, query, body, headers) {
    const res = await this.fetch(`${this.api}?${new URLSearchParams(query)}`, { method, headers: { ...(headers || {}) }, body });
    let json = null;
    try { json = await res.json(); } catch { /* not JSON */ }
    if (!json) throw Object.assign(new Error('no answer'), { code: 'network' });
    return json;
  }

  // Takes (or renames to) a nickname. Returns { ok, nick } or { ok: false, error: 'taken' | 'invalid_nick' | ... }.
  async claim(rawNick) {
    const nick = cleanNick(rawNick);
    if (!nick) return { ok: false, error: 'invalid_nick' };
    let p = this.profile;
    if (!p) p = { id: ratingUuid(), secret: ratingHex(24), nick: '', claimed: false };
    let json;
    try {
      json = await this._json('POST', { op: 'claim' }, JSON.stringify({ id: p.id, secret: p.secret, nick }), { 'Content-Type': 'application/json' });
    } catch (e) { return { ok: false, error: e.code || 'network' }; }
    if (json.ok) this._write(RATING_PROFILE_KEY, { ...p, nick: json.nick, claimed: true });
    return json;
  }

  // The code that carries the profile to another device (or back after the storage was cleared).
  exportCode() { const p = this.profile; return p && p.claimed ? `${p.id}.${p.secret}.${p.nick}` : ''; }
  importCode(code) {
    const m = /^([0-9a-f-]{36})\.([0-9a-f]{32,64})\.(.{3,16})$/i.exec(String(code || '').trim());
    if (!m || !cleanNick(m[3])) return false;
    this._write(RATING_PROFILE_KEY, { id: m[1].toLowerCase(), secret: m[2].toLowerCase(), nick: cleanNick(m[3]), claimed: true });
    return true;
  }

  async board(ladder, limit = 50) {
    const q = { ladder, limit: String(limit) };
    if (this.nick) q.nick = this.nick;
    return this._json('GET', q);
  }

  // The recording of a finished bout. Returns the server's answer; a network failure queues the bout for the next start.
  async submitBout(recorder, ladder) {
    const p = this.profile;
    if (!p || !p.claimed || !this.enabled) return { ok: false, error: 'no_profile' };
    recorder.header.ladder = ladder;
    const gz = await ratingGzip(recorder.bytes());
    this.pendingClear();
    return this._sendBout(gz, true);
  }

  async _sendBout(gz, canQueue) {
    const p = this.profile;
    try {
      const json = await this._json('POST', { op: 'bout' }, gz, { 'Content-Type': 'application/octet-stream', 'X-Player-Id': p.id, 'X-Player-Secret': p.secret });
      return json;
    } catch (e) {
      if (canQueue) this._queue(gz);
      return { ok: false, error: 'network', queued: canQueue };
    }
  }

  _queue(gz) {
    const q = this._read(RATING_QUEUE_KEY) || [];
    const item = b64Of(gz);
    if (item.length > RATING_QUEUE_MAX_CHARS) return;
    q.push(item);
    while (q.length > 2 || q.reduce((n, x) => n + x.length, 0) > RATING_QUEUE_MAX_CHARS) q.shift();
    this._write(RATING_QUEUE_KEY, q);
  }

  // A bout that was started and not finished: remember it, so that closing the tab still costs the loss.
  pendingStart(level, ladder) { this._write(RATING_PENDING_KEY, { level, ladder, at: Date.now() }); }
  pendingClear() { this._write(RATING_PENDING_KEY, null); }

  async forfeit(level, ladder) {
    const p = this.profile;
    if (!p || !p.claimed || !this.enabled) return { ok: false, error: 'no_profile' };
    this.pendingClear();
    try {
      return await this._json('POST', { op: 'forfeit' }, JSON.stringify({ id: p.id, secret: p.secret, level, ladder }), { 'Content-Type': 'application/json' });
    } catch (e) { return { ok: false, error: 'network' }; }
  }

  // At start: settle a bout abandoned last time and send the ones that could not go out. Returns the answers.
  async flush() {
    const out = [];
    const p = this.profile;
    if (!p || !p.claimed || !this.enabled) return out;
    const pending = this._read(RATING_PENDING_KEY);
    if (pending && Date.now() - pending.at < 24 * 3600 * 1000) out.push(await this.forfeit(pending.level, pending.ladder));
    else this.pendingClear();
    const q = this._read(RATING_QUEUE_KEY) || [];
    if (q.length) {
      this._write(RATING_QUEUE_KEY, null);
      const left = [];
      for (const item of q) {
        const r = await this._sendBout(bytesOf(item), false);
        out.push(r);
        if (r.error === 'network') left.push(item);
      }
      if (left.length) this._write(RATING_QUEUE_KEY, left);
    }
    return out;
  }
}
