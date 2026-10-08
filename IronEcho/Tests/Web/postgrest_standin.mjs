// A small stand-in for Supabase's REST interface (PostgREST): exactly the requests Tools/Build/Web/api/rating_store.mjs makes.
// eq./gt. filters, order, limit, embedded select, Prefer return=minimal / representation / count=exact, Range, unique violations as 409.
// Used by rating_store_test.mjs and release_api_smoke.mjs. It is a model of PostgREST, not PostgREST.
export function postgrest() {
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

