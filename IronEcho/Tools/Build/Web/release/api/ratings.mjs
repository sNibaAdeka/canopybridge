// Vercel entry: /api/ratings. Storage is Supabase when SUPABASE_URL and SUPABASE_SERVICE_KEY are set in the project's environment;
// without them the function answers 503 (the page then keeps working without ratings).
import { createRatingApi } from './rating_api.mjs';
import { SupabaseStore } from './rating_store.mjs';
import { loadCore } from '../lib/core.js';
import { ratingCoreId } from '../lib/rating.js';
import { CORE_WASM_B64 } from './core_build.mjs';

let handler = null;
function getHandler() {
  if (handler) return handler;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  handler = createRatingApi({
    store: new SupabaseStore({ url, key }),
    coreIds: new Set([ratingCoreId(CORE_WASM_B64)]),
    loadCore: async () => { globalThis.IRONECHO_CORE_WASM_B64 = CORE_WASM_B64; return loadCore(); },
  });
  return handler;
}

async function readBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  const chunks = [];
  let size = 0;
  for await (const c of req) { size += c.length; if (size > 4_000_000) break; chunks.push(c); }
  return Buffer.concat(chunks);
}

export default async function route(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*'); // the Windows app and the downloadable page rate through the public site
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, x-player-id, x-player-secret');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  const h = getHandler();
  if (!h) { res.statusCode = 503; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: false, error: 'not_configured' })); return; }
  const url = new URL(req.url, 'http://x');
  const out = await h({ method: req.method, query: Object.fromEntries(url.searchParams), headers: req.headers, body: req.method === 'POST' ? await readBody(req) : Buffer.alloc(0) });
  res.statusCode = out.status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(out.json));
}
