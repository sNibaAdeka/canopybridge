// The telemetry endpoint's logic, independent of the host (request -> response), like rating_api.mjs. Accepts batches of anonymous events
// from the page (site/src/telemetry.js), keeps only known event types and small flat props, and stores them. Never echoes storage errors.
import crypto from 'node:crypto';
import { TELE_TYPES } from '../site/src/telemetry.js';

export const EVENTS_MAX_BODY = 32_000;
export const EVENTS_MAX_PER_BATCH = 20;
export const EVENTS_MAX_PROPS = 1000;          // bytes of JSON per event
export const EVENTS_RATE_PER_MINUTE = 60;      // requests per minute per (hashed) address

const str = (v, n) => String(v ?? '').slice(0, n);

// deps: { store, now(): ms, salt }
export function createEventsApi(deps) {
  const { store } = deps;
  const now = deps.now || Date.now;
  const rate = new Map(); // hashed address -> { n, t }; best effort (a cold start forgets)

  function limited(ip) {
    const day = Math.floor(now() / 86400000);
    const key = crypto.createHash('sha256').update(`${ip}|${day}|${deps.salt || 'ironecho'}`).digest('hex').slice(0, 24);
    const slot = rate.get(key) || { n: 0, t: now() };
    if (now() - slot.t > 60000) { slot.n = 0; slot.t = now(); }
    slot.n += 1;
    rate.set(key, slot);
    if (rate.size > 5000) rate.clear();
    return slot.n > EVENTS_RATE_PER_MINUTE;
  }

  return async function handle({ method, headers = {}, body }) {
    if (method !== 'POST') return { status: 405, json: { ok: false, error: 'method' } };
    const ip = str(headers['x-forwarded-for'], 200).split(',')[0].trim() || 'local';
    if (limited(ip)) return { status: 429, json: { ok: false, error: 'rate' } };
    if (!body || body.length > EVENTS_MAX_BODY) return { status: 413, json: { ok: false, error: 'size' } };
    let data;
    try { data = JSON.parse(Buffer.isBuffer(body) ? body.toString('utf8') : String(body)); } catch { return { status: 400, json: { ok: false, error: 'json' } }; }
    if (!data || !Array.isArray(data.events) || data.events.length > EVENTS_MAX_PER_BATCH) return { status: 400, json: { ok: false, error: 'shape' } };
    const anon = str(data.a, 64);
    const session = str(data.s, 64);
    if (!/^[0-9a-z-]{8,64}$/i.test(anon) || !/^[0-9a-z-]{8,64}$/i.test(session)) return { status: 400, json: { ok: false, error: 'id' } };
    const rows = [];
    for (const e of data.events) {
      if (!e || !TELE_TYPES.has(e.type)) continue;
      const props = e.props && typeof e.props === 'object' && !Array.isArray(e.props) ? e.props : {};
      if (JSON.stringify(props).length > EVENTS_MAX_PROPS) continue;
      rows.push({ anon_id: anon, session_id: session, type: e.type, props, version: str(data.v, 16), ua_class: str(data.ua, 24),
        gpu_class: str(data.gpu, 24), country: str(headers['x-vercel-ip-country'], 2) });
    }
    if (rows.length) {
      try { await store.insert(rows); } catch (err) { console.error('events: store failed', String(err && err.message).slice(0, 80)); return { status: 503, json: { ok: false, error: 'store' } }; }
    }
    return { status: 204, json: null };
  };
}
