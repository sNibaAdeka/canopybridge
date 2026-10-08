// Where the rating tables live. Two implementations of one small interface:
//  - MemoryStore: tests and local runs (nothing survives the process).
//  - SupabaseStore: the real thing, Postgres behind Supabase's REST interface, called with the service key from the server only
//    (the tables have row level security on and no policies, so no browser can read or write them directly). Schema: api/rating_schema.sql.
import { RATING_START } from '../site/src/ratingrules.js';

const blank = () => ({ rating: RATING_START, games: 0, wins: 0, losses: 0, draws: 0, kos: 0 });

export class MemoryStore {
  constructor() { this.players = new Map(); this.ratings = new Map(); this.bouts = []; }

  async getPlayerById(id) { return this.players.get(id) || null; }
  async getPlayerByKey(key) { for (const p of this.players.values()) if (p.nickKey === key) return p; return null; }
  async createPlayer(p) {
    if (this.players.has(p.id) || await this.getPlayerByKey(p.nickKey)) return false;
    this.players.set(p.id, { ...p });
    return true;
  }
  async renamePlayer(id, nick, key) {
    const other = await this.getPlayerByKey(key);
    if (other && other.id !== id) return false;
    const p = this.players.get(id);
    if (!p) return false;
    p.nick = nick; p.nickKey = key;
    return true;
  }
  async getRating(id, ladder) { return { ...(this.ratings.get(`${id}|${ladder}`) || blank()) }; }
  async saveRating(id, ladder, expectedGames, row) {
    const k = `${id}|${ladder}`;
    const cur = this.ratings.get(k) || blank();
    if (cur.games !== expectedGames) return false;
    this.ratings.set(k, { ...row });
    return true;
  }
  async insertBout(b) {
    if (this.bouts.some((x) => x.playerId === b.playerId && x.replayHash === b.replayHash)) return false;
    this.bouts.push({ ...b });
    return true;
  }
  async deleteBout(playerId, hash) { this.bouts = this.bouts.filter((x) => !(x.playerId === playerId && x.replayHash === hash)); }
  async lastBoutAt(id) { let t = 0; for (const b of this.bouts) if (b.playerId === id && b.at > t) t = b.at; return t || null; }
  _rows(ladder) {
    const out = [];
    for (const [k, r] of this.ratings) {
      const [id, l] = k.split('|');
      if (l === ladder && r.games > 0) out.push({ nick: this.players.get(id).nick, ...r });
    }
    return out.sort((a, b) => b.rating - a.rating || a.games - b.games || (a.nick < b.nick ? -1 : 1));
  }
  async top(ladder, limit) { return this._rows(ladder).slice(0, limit); }
  async countRated(ladder) { return this._rows(ladder).length; }
  async rankOf(ladder, rating) { return 1 + this._rows(ladder).filter((r) => r.rating > rating).length; }
}

export class SupabaseStore {
  constructor({ url, key, fetchFn = fetch }) {
    this.base = `${String(url).replace(/\/+$/, '')}/rest/v1`;
    this.key = key;
    this.fetch = fetchFn;
  }

  async _req(method, path, { body, prefer, range } = {}) {
    // new-style secret keys (sb_secret_...) are not JWTs: they go in the apikey header alone; legacy service_role keys are JWTs and also go as Bearer
    const headers = { apikey: this.key, 'Content-Type': 'application/json' };
    if (!this.key.startsWith('sb_')) headers.Authorization = `Bearer ${this.key}`;
    if (prefer) headers.Prefer = prefer;
    if (range) headers.Range = range;
    const res = await this.fetch(`${this.base}/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    return { status: res.status, json, headers: res.headers, text };
  }

  _must(r, what) { if (r.status >= 400) throw new Error(`supabase ${what}: ${r.status} ${r.text.slice(0, 200)}`); return r.json; }

  async getPlayerById(id) {
    const rows = this._must(await this._req('GET', `ie_players?id=eq.${encodeURIComponent(id)}&select=id,nick,nick_key,secret_hash&limit=1`), 'player');
    return rows && rows[0] ? { id: rows[0].id, nick: rows[0].nick, nickKey: rows[0].nick_key, secretHash: rows[0].secret_hash } : null;
  }
  async getPlayerByKey(key) {
    const rows = this._must(await this._req('GET', `ie_players?nick_key=eq.${encodeURIComponent(key)}&select=id,nick,nick_key,secret_hash&limit=1`), 'player by key');
    return rows && rows[0] ? { id: rows[0].id, nick: rows[0].nick, nickKey: rows[0].nick_key, secretHash: rows[0].secret_hash } : null;
  }
  async createPlayer(p) {
    const r = await this._req('POST', 'ie_players', { body: { id: p.id, nick: p.nick, nick_key: p.nickKey, secret_hash: p.secretHash }, prefer: 'return=minimal' });
    if (r.status === 409) return false; // unique violation: nick or id taken
    this._must(r, 'create player');
    return true;
  }
  async renamePlayer(id, nick, key) {
    const r = await this._req('PATCH', `ie_players?id=eq.${encodeURIComponent(id)}`, { body: { nick, nick_key: key }, prefer: 'return=representation' });
    if (r.status === 409) return false;
    return (this._must(r, 'rename') || []).length === 1;
  }
  async getRating(id, ladder) {
    const rows = this._must(await this._req('GET', `ie_ratings?player_id=eq.${encodeURIComponent(id)}&ladder=eq.${ladder}&select=rating,games,wins,losses,draws,kos&limit=1`), 'rating');
    return rows && rows[0] ? { rating: Number(rows[0].rating), games: rows[0].games, wins: rows[0].wins, losses: rows[0].losses, draws: rows[0].draws, kos: rows[0].kos } : blank();
  }
  async saveRating(id, ladder, expectedGames, row) {
    const data = { rating: row.rating, games: row.games, wins: row.wins, losses: row.losses, draws: row.draws, kos: row.kos, updated_at: new Date().toISOString() };
    if (expectedGames === 0) {
      const ins = await this._req('POST', 'ie_ratings', { body: { player_id: id, ladder, ...data }, prefer: 'return=minimal' });
      if (ins.status === 409) {
        // a row with zero games may exist (never happens today, but it is the only row that can still be claimed here)
        const upd = await this._req('PATCH', `ie_ratings?player_id=eq.${encodeURIComponent(id)}&ladder=eq.${ladder}&games=eq.0`, { body: data, prefer: 'return=representation' });
        return (this._must(upd, 'rating claim') || []).length === 1;
      }
      this._must(ins, 'rating insert');
      return true;
    }
    const upd = await this._req('PATCH', `ie_ratings?player_id=eq.${encodeURIComponent(id)}&ladder=eq.${ladder}&games=eq.${expectedGames}`, { body: data, prefer: 'return=representation' });
    return (this._must(upd, 'rating update') || []).length === 1;
  }
  async insertBout(b) {
    const r = await this._req('POST', 'ie_bouts', { body: { player_id: b.playerId, ladder: b.ladder, level: b.level, result: b.result, method: b.method, seed: b.seed, frames: b.frames,
      replay_hash: b.replayHash, created_at: new Date(b.at).toISOString() }, prefer: 'return=minimal' });
    if (r.status === 409) return false;
    this._must(r, 'insert bout');
    return true;
  }
  async deleteBout(playerId, hash) { await this._req('DELETE', `ie_bouts?player_id=eq.${encodeURIComponent(playerId)}&replay_hash=eq.${encodeURIComponent(hash)}`); }
  async lastBoutAt(id) {
    const rows = this._must(await this._req('GET', `ie_bouts?player_id=eq.${encodeURIComponent(id)}&select=created_at&order=created_at.desc&limit=1`), 'last bout');
    return rows && rows[0] ? Date.parse(rows[0].created_at) : null;
  }
  async top(ladder, limit) {
    const rows = this._must(await this._req('GET', `ie_ratings?ladder=eq.${ladder}&games=gt.0&order=rating.desc,games.asc&limit=${limit}&select=rating,games,wins,losses,draws,kos,ie_players!inner(nick)`), 'top');
    return (rows || []).map((r) => ({ nick: r.ie_players.nick, rating: Number(r.rating), games: r.games, wins: r.wins, losses: r.losses, draws: r.draws, kos: r.kos }));
  }
  async _count(query) {
    const r = await this._req('GET', `ie_ratings?${query}&select=player_id`, { prefer: 'count=exact', range: '0-0' });
    this._must(r, 'count');
    const m = /\/(\d+)$/.exec(r.headers.get('content-range') || '');
    return m ? Number(m[1]) : 0;
  }
  async countRated(ladder) { return this._count(`ladder=eq.${ladder}&games=gt.0`); }
  async rankOf(ladder, rating) { return 1 + await this._count(`ladder=eq.${ladder}&games=gt.0&rating=gt.${rating}`); }
}
