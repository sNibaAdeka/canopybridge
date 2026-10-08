// The rating store contract, run against both implementations: MemoryStore, and SupabaseStore talking to a small stand-in for Supabase's REST
// interface (PostgREST) that implements exactly the requests the store makes: eq./gt. filters, order, limit, embedded select, Prefer
// return=minimal / representation / count=exact, Range, unique violations answered with 409.
//
//   node Tests/Web/rating_store_test.mjs
// What this does NOT prove: that the real PostgREST answers these requests the same way. Run the same contract against a real project
// before relying on it (see Tools/Build/Web/api/README.md).
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const API = path.join(HERE, '..', '..', 'Tools', 'Build', 'Web', 'api');
const { MemoryStore, SupabaseStore } = await import(pathToFileURL(path.join(API, 'rating_store.mjs')));

const results = [];
const check = (name, ok, info = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`); };

// ------------------------------------------------------------------ the stand-in
function postgrest() {
  const tables = { ie_players: [], ie_ratings: [], ie_bouts: [] };
  const unique = { ie_players: [['id'], ['nick_key']], ie_ratings: [['player_id', 'ladder']], ie_bouts: [['player_id', 'replay_hash']] };
  let serial = 0;
  const calls = [];
  const filterRows = (rows, params) => {
    let out = rows;
    for (const [k, v] of params) {
      if (['select', 'order', 'limit'].includes(k)) continue;
      const m = /^(eq|gt)\.(.*)$/.exec(v);
      if (!m) throw new Error(`unsupported filter ${k}=${v}`);
      out = out.filter((r) => (m[1] === 'eq' ? String(r[k]) === m[2] : Number(r[k]) > Number(m[2])));
    }
    return out;
  };
  const fetchFn = async (url, init) => {
    const u = new URL(url);
    const table = u.pathname.replace('/rest/v1/', '');
    const params = [...u.searchParams];
    const headers = init.headers || {};
    calls.push(`${init.method} ${table}`);
    if (!headers.apikey) return resp(401, { message: 'no apikey' });
    const prefer = headers.Prefer || '';
    const rows = tables[table];
    if (!rows) return resp(404, {});
    const body = init.body ? JSON.parse(init.body) : null;
    if (init.method === 'POST') {
      const row = { ...body };
      if (table === 'ie_bouts') row.id = ++serial;
      for (const cols of unique[table]) if (rows.some((r) => cols.every((c) => r[c] === row[c]))) return resp(409, { code: '23505' });
      rows.push(row);
      return resp(201, prefer.includes('representation') ? [row] : null);
    }
    if (init.method === 'PATCH') {
      const hit = filterRows(rows, params);
      for (const cols of unique[table]) for (const r of hit) if (rows.some((o) => o !== r && cols.every((c) => (body[c] ?? r[c]) === o[c]))) return resp(409, { code: '23505' });
      hit.forEach((r) => Object.assign(r, body));
      return resp(200, prefer.includes('representation') ? hit : null);
    }
    if (init.method === 'DELETE') {
      const hit = new Set(filterRows(rows, params));
      tables[table] = rows.filter((r) => !hit.has(r));
      return resp(204, null);
    }
    // GET
    let out = filterRows(rows, params);
    const total = out.length;
    const order = u.searchParams.get('order');
    if (order) {
      const keys = order.split(',').map((x) => x.split('.'));
      out = [...out].sort((a, b) => { for (const [c, d] of keys) { const x = a[c], y = b[c]; if (x !== y) return (x < y ? -1 : 1) * (d === 'desc' ? -1 : 1); } return 0; });
    }
    const limit = Number(u.searchParams.get('limit') || 1000);
    out = out.slice(0, limit);
    const sel = u.searchParams.get('select') || '*';
    const embed = /ie_players!inner\(nick\)/.test(sel);
    out = out.map((r) => {
      const o = { ...r };
      if (embed) { const p = tables.ie_players.find((x) => x.id === r.player_id); o.ie_players = { nick: p.nick }; }
      return o;
    });
    if (embed) out = out.filter((r) => r.ie_players);
    const h = {};
    if (prefer.includes('count=exact')) h['content-range'] = total ? `0-0/${total}` : '*/0';
    return resp(200, out, h);
  };
  const resp = (status, json, h = {}) => ({ status, text: async () => (json === null ? '' : JSON.stringify(json)), headers: { get: (k) => h[k.toLowerCase()] || null } });
  return { fetchFn, calls, tables };
}

// ------------------------------------------------------------------ the contract
async function contract(name, store) {
  const A = '11111111-1111-4111-8111-111111111111';
  const B = '22222222-2222-4222-8222-222222222222';
  const C = '33333333-3333-4333-8333-333333333333';
  check(`${name}: a new player is stored once`, await store.createPlayer({ id: A, nick: 'Адёка', nickKey: 'adeka', secretHash: 'aa' }) === true && await store.createPlayer({ id: A, nick: 'Other', nickKey: 'other', secretHash: 'bb' }) === false);
  check(`${name}: a taken nick key is refused`, await store.createPlayer({ id: B, nick: 'Aдёка', nickKey: 'adeka', secretHash: 'cc' }) === false && await store.createPlayer({ id: B, nick: 'Rival', nickKey: 'rival', secretHash: 'cc' }) === true);
  const p = await store.getPlayerById(A);
  check(`${name}: players are found by id and by key`, p.nick === 'Адёка' && p.nickKey === 'adeka' && p.secretHash === 'aa' && (await store.getPlayerByKey('rival')).id === B && await store.getPlayerById(C) === null && await store.getPlayerByKey('nobody') === null);
  check(`${name}: renaming to a free key works, to a taken one is refused`, await store.renamePlayer(A, 'Адёка 2', 'adeka2') === true && await store.renamePlayer(A, 'Rival', 'rival') === false && (await store.getPlayerById(A)).nick === 'Адёка 2');
  const blank = await store.getRating(A, 'keys');
  check(`${name}: a player without games has the starting rating`, blank.rating === 1000 && blank.games === 0);
  check(`${name}: the first save claims the row, a second save with the same expectation is refused`,
    await store.saveRating(A, 'keys', 0, { rating: 1012.5, games: 1, wins: 1, losses: 0, draws: 0, kos: 0 }) === true
    && await store.saveRating(A, 'keys', 0, { rating: 1100, games: 1, wins: 1, losses: 0, draws: 0, kos: 0 }) === false
    && (await store.getRating(A, 'keys')).rating === 1012.5);
  check(`${name}: a save with the right game count goes through, with a stale one it does not`,
    await store.saveRating(A, 'keys', 1, { rating: 1020.25, games: 2, wins: 2, losses: 0, draws: 0, kos: 1 }) === true
    && await store.saveRating(A, 'keys', 1, { rating: 900, games: 2, wins: 1, losses: 1, draws: 0, kos: 0 }) === false
    && (await store.getRating(A, 'keys')).games === 2);
  await store.saveRating(B, 'keys', 0, { rating: 980, games: 1, wins: 0, losses: 1, draws: 0, kos: 0 });
  await store.saveRating(B, 'camera', 0, { rating: 1050, games: 1, wins: 1, losses: 0, draws: 0, kos: 0 });
  const top = await store.top('keys', 10);
  check(`${name}: the table is ordered by rating, one table per ladder`, top.length === 2 && top[0].nick === 'Адёка 2' && top[0].rating === 1020.25 && top[1].nick === 'Rival' && (await store.top('camera', 10)).length === 1);
  check(`${name}: rank and count`, await store.rankOf('keys', 1020.25) === 1 && await store.rankOf('keys', 980) === 2 && await store.countRated('keys') === 2 && await store.countRated('camera') === 1);
  check(`${name}: an empty table counts zero`, await store.countRated('nothing') === 0);
  const bout = { playerId: A, ladder: 'keys', level: 1, result: 'win', method: 'ko', seed: 5, frames: 100, replayHash: 'h1', at: 1_700_000_000_000 };
  check(`${name}: a bout is stored once per recording`, await store.insertBout(bout) === true && await store.insertBout(bout) === false && await store.insertBout({ ...bout, replayHash: 'h2', at: 1_700_000_100_000 }) === true);
  check(`${name}: the last bout time is the newest`, await store.lastBoutAt(A) === 1_700_000_100_000 && await store.lastBoutAt(B) === null);
  await store.deleteBout(A, 'h2');
  check(`${name}: a bout can be taken back`, await store.lastBoutAt(A) === 1_700_000_000_000 && await store.insertBout({ ...bout, replayHash: 'h2' }) === true);
}

await contract('MemoryStore', new MemoryStore());
const pg = postgrest();
await contract('SupabaseStore', new SupabaseStore({ url: 'https://example.supabase.co', key: 'sb_secret_test', fetchFn: pg.fetchFn }));
const legacy = postgrest();
await new SupabaseStore({ url: 'https://example.supabase.co/', key: 'eyJ.legacy.jwt', fetchFn: async (url, init) => { legacy.sent = init.headers; return legacy.fetchFn(url, init); } }).getPlayerById('x').catch(() => {});
check('SupabaseStore: a new-style secret key goes in apikey alone, a legacy JWT also as Bearer', !('Authorization' in (await (async () => { let h; const s = new SupabaseStore({ url: 'https://x.co', key: 'sb_secret_k', fetchFn: async (u, i) => { h = i.headers; return postgrest().fetchFn(u, i); } }); await s.getPlayerById('a'); return h; })()))
  && legacy.sent.Authorization === 'Bearer eyJ.legacy.jwt');

console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
