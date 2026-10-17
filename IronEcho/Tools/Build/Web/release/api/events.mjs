// Vercel entry: /api/events (anonymous telemetry). Storage is Supabase when SUPABASE_URL and SUPABASE_SERVICE_KEY are set; without them the
// function answers 503 and the page simply loses its statistics (the game is unaffected).
import { createEventsApi } from './events_api.mjs';
import { SupabaseEventsStore } from './events_store.mjs';

let handler = null;
function getHandler() {
  if (handler) return handler;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  handler = createEventsApi({ store: new SupabaseEventsStore({ url, key }), salt: process.env.EVENTS_SALT || '' });
  return handler;
}

async function readBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body);
  const chunks = [];
  let size = 0;
  for await (const c of req) { size += c.length; if (size > 64_000) break; chunks.push(c); }
  return Buffer.concat(chunks);
}

export default async function route(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*'); // the downloadable page and the Windows app report through the public site
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  const h = getHandler();
  if (!h) { res.statusCode = 503; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: false, error: 'not_configured' })); return; }
  const out = await h({ method: req.method, headers: req.headers, body: req.method === 'POST' ? await readBody(req) : Buffer.alloc(0) });
  res.statusCode = out.status;
  if (out.json) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(out.json)); } else res.end();
}
