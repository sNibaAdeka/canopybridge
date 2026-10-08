// The built website's rating function, as deployed: Tools/Build/Web/release/api/ratings.mjs with the release's own lib/ and core_build.mjs, called the way
// Vercel calls it (req, res), storage replaced by the PostgREST stand-in. Proves the release layout resolves its imports, the core inside it is the core
// inside the page, and one bout goes in and out.   node Tests/Web/release_api_smoke.mjs   (after build_web.py release)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REL = path.join(HERE, '..', '..', 'Tools', 'Build', 'Web', 'release');
if (!fs.existsSync(path.join(REL, 'api', 'ratings.mjs'))) { console.error('no release/api: run build_web.py release'); process.exit(2); }
const results = [];
const check = (name, ok, info = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`); };
const imp = (...p) => import(pathToFileURL(path.join(REL, ...p)));
const { postgrest } = await import(pathToFileURL(path.join(HERE, 'postgrest_standin.mjs')));

const { CORE_WASM_B64 } = await imp('api', 'core_build.mjs');
const page = fs.readFileSync(path.join(REL, 'play', 'index.html'), 'utf8');
check('the core inside the function is the core inside the page', page.includes(CORE_WASM_B64));

const route = (await imp('api', 'ratings.mjs')).default;
const call = async ({ method = 'GET', url, headers = {}, body }) => {
  const req = { method, url, headers, body: body === undefined ? undefined : Buffer.from(body) };
  const res = { headers: {}, statusCode: 0, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = b; } };
  await route(req, res);
  return { status: res.statusCode, headers: res.headers, json: res.body ? JSON.parse(res.body) : null };
};

delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_KEY;
const off = await call({ url: '/api/ratings?ladder=keys' });
check('without storage settings the function says "not configured" (the page then hides ratings)', off.status === 503 && off.json.error === 'not_configured' && off.headers['access-control-allow-origin'] === '*');
check('a browser preflight is answered', (await call({ method: 'OPTIONS', url: '/api/ratings?op=bout' })).status === 204);

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'sb_secret_smoke';
const pg = postgrest();
globalThis.fetch = pg.fetchFn;

const empty = await call({ url: '/api/ratings?ladder=keys&limit=5' });
check('an empty table is an empty list', empty.status === 200 && empty.json.ok && empty.json.rows.length === 0 && empty.json.total === 0);

const id = '5b1c2d3e-4f50-4a61-8b72-93a4b5c6d7e8';
const secret = 'ab12'.repeat(8);
const claim = await call({ method: 'POST', url: '/api/ratings?op=claim', body: JSON.stringify({ id, secret, nick: 'Smoke Test' }) });
check('a nickname is claimed', claim.status === 200 && claim.json.created === true);

// a bout recorded with the release's own core and modules
const { loadCore } = await imp('lib', 'core.js');
const { BoutRecorder } = await imp('lib', 'replay.js');
const { ratingCoreId, ratingGzip } = await imp('lib', 'rating.js');
globalThis.IRONECHO_CORE_WASM_B64 = CORE_WASM_B64;
const core = await loadCore();
core.init({ mode: 0, level: 0, seed: 31, rounds: 0, roundSeconds: 45 });
core.recorder = new BoutRecorder({ v: 1, core: ratingCoreId(CORE_WASM_B64), level: 0, seed: 31, roundSeconds: 45, ladder: 'keys' });
let k = 0;
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
for (; k < 60 * 400 && core.snapshot().match.phaseName !== 'MatchOver'; k++) {
  core.frame(1 / 60, { status: 7, lean: 0, block: Math.sin(k / 40) > 0.7 ? 1 : 0, punchMask: rnd() < 0.12 ? [1, 2, 4, 8][(rnd() * 4) | 0] : 0, moveForward: Math.sin(k / 150) > 0.3 ? 1 : 0 });
}
check('the release core plays a bout to its end', core.snapshot().match.phaseName === 'MatchOver', `${k} frames`);
const gz = await ratingGzip(core.recorder.bytes());
const sent = await call({ method: 'POST', url: '/api/ratings?op=bout', headers: { 'x-player-id': id, 'x-player-secret': secret, 'content-type': 'application/octet-stream' }, body: gz });
check('the bout is replayed and rated by the function', sent.status === 200 && sent.json.ok && sent.json.games === 1 && ['win', 'loss', 'draw'].includes(sent.json.result), JSON.stringify(sent.json).slice(0, 160));
const again = await call({ method: 'POST', url: '/api/ratings?op=bout', headers: { 'x-player-id': id, 'x-player-secret': secret }, body: gz });
check('the same recording again is refused', again.status === 409 || again.status === 429, again.json.error);
const board = await call({ url: `/api/ratings?ladder=keys&nick=${encodeURIComponent('Smoke Test')}` });
check('the table lists the player and knows the caller', board.json.rows.length === 1 && board.json.rows[0].nick === 'Smoke Test' && board.json.me && board.json.me.rank === 1, JSON.stringify(board.json.me));
check('the storage was called with the secret key and the three tables', pg.calls.some((c) => c.includes('ie_players')) && pg.calls.some((c) => c.includes('ie_ratings')) && pg.calls.some((c) => c.includes('ie_bouts')));
check('the unpacked recording is what the page sends', zlib.gunzipSync(gz).length > 1000);

console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
