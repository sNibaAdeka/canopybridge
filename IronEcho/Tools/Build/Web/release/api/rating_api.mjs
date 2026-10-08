// The rating server's logic, independent of the host: a function (request) -> (response). The Vercel entry (ratings.mjs) and the tests
// both call it. Nothing here trusts the page: a rated result exists only when the recording of the bout, played again on this server's
// copy of the rules core, ends in that result.
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { cleanNick, nickKey, ratingAfter, RATING_START, isLadder, isLevel, PROVISIONAL_GAMES } from '../lib/ratingrules.js';
import { parseReplay, replayBout, REPLAY_MAX_ROWS } from '../lib/replay.js';

export const MIN_BOUT_GAP_MS = 15000;   // one rated bout per player per 15 s: a real bout is longer than that
export const MAX_BODY_BYTES = 3_500_000; // below the 4.5 MB limit of a Vercel function
export const MIN_SIM_SECONDS = 4;       // a replay that ends sooner than this in the ring is not a bout

const sha256 = (x) => crypto.createHash('sha256').update(x).digest('hex');
const isUuid = (s) => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const isSecret = (s) => typeof s === 'string' && /^[0-9a-f]{32,64}$/i.test(s);
const reply = (status, json) => ({ status, json });
const fail = (status, error, extra = {}) => reply(status, { ok: false, error, ...extra });

// deps: { store, loadCore(): Promise<Core>, coreIds: Set<string>, now(): ms }
export function createRatingApi(deps) {
  const { store, loadCore, coreIds } = deps;
  const now = deps.now || Date.now;

  async function authenticate(id, secret) {
    if (!isUuid(id) || !isSecret(secret)) return null;
    const p = await store.getPlayerById(id.toLowerCase());
    if (!p) return null;
    const a = Buffer.from(p.secretHash, 'hex');
    const b = Buffer.from(sha256(secret), 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b) ? p : null;
  }

  async function standing(playerId, ladder) {
    const r = await store.getRating(playerId, ladder);
    return { rating: Math.round(r.rating * 100) / 100, games: r.games, wins: r.wins, losses: r.losses, draws: r.draws, kos: r.kos,
      provisional: r.games < PROVISIONAL_GAMES };
  }

  async function board(query) {
    const ladder = isLadder(query.ladder) ? query.ladder : 'keys';
    const limit = Math.max(1, Math.min(100, Number(query.limit) || 50));
    const rows = await store.top(ladder, limit);
    const total = await store.countRated(ladder);
    const out = { ok: true, ladder, total, rows: rows.map((r, i) => ({ rank: i + 1, nick: r.nick, rating: Math.round(r.rating), games: r.games, wins: r.wins, losses: r.losses, draws: r.draws, kos: r.kos,
      provisional: r.games < PROVISIONAL_GAMES })) };
    const key = query.nick ? nickKey(cleanNick(query.nick)) : '';
    if (key) {
      const p = await store.getPlayerByKey(key);
      if (p) {
        const s = await standing(p.id, ladder);
        out.me = { nick: p.nick, ...s, rating: Math.round(s.rating), rank: s.games ? await store.rankOf(ladder, s.rating) : null };
      }
    }
    return reply(200, out);
  }

  async function claim(body) {
    let j;
    try { j = JSON.parse(body.toString('utf8')); } catch { return fail(400, 'bad_json'); }
    const nick = cleanNick(j.nick);
    if (!nick) return fail(400, 'invalid_nick');
    if (!isUuid(j.id) || !isSecret(j.secret)) return fail(400, 'bad_profile');
    const id = j.id.toLowerCase();
    const key = nickKey(nick);
    if (key.length < 3) return fail(400, 'invalid_nick');
    const existing = await store.getPlayerById(id);
    if (!existing) {
      const ok = await store.createPlayer({ id, nick, nickKey: key, secretHash: sha256(j.secret) });
      return ok ? reply(200, { ok: true, nick, created: true }) : fail(409, 'taken');
    }
    if (!(await authenticate(id, j.secret))) return fail(403, 'bad_secret');
    if (existing.nick === nick) return reply(200, { ok: true, nick, created: false });
    const ok = await store.renamePlayer(id, nick, key);
    return ok ? reply(200, { ok: true, nick, created: false, renamed: true }) : fail(409, 'taken');
  }

  async function standingAfter(player, ladder, extra) {
    const s = await standing(player.id, ladder);
    return { ...extra, ok: true, ladder, rating: Math.round(s.rating), exact: s.rating, games: s.games, wins: s.wins, losses: s.losses, draws: s.draws, kos: s.kos,
      provisional: s.provisional, rank: s.games ? await store.rankOf(ladder, s.rating) : null, total: await store.countRated(ladder) };
  }

  // Applies one result to the player's rating with a few retries (two bouts of one player finishing together).
  async function applyResult(player, ladder, level, score, kind) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const cur = await store.getRating(player.id, ladder);
      const next = {
        rating: ratingAfter(cur.rating, cur.games, level, score), games: cur.games + 1,
        wins: cur.wins + (score === 1 ? 1 : 0), losses: cur.losses + (score === 0 ? 1 : 0), draws: cur.draws + (score === 0.5 ? 1 : 0),
        kos: cur.kos + (score === 1 && kind === 'ko' ? 1 : 0),
      };
      if (await store.saveRating(player.id, ladder, cur.games, next)) return { before: cur.rating, after: next.rating };
    }
    return null;
  }

  async function bout(headers, body) {
    const id = String(headers['x-player-id'] || '');
    const player = await authenticate(id, String(headers['x-player-secret'] || ''));
    if (!player) return fail(403, 'unknown_player');
    if (body.length === 0 || body.length > MAX_BODY_BYTES) return fail(400, 'bad_size');
    let raw;
    try { raw = zlib.gunzipSync(body, { maxOutputLength: REPLAY_MAX_ROWS * 18 + 8192 }); } catch { return fail(400, 'bad_replay'); }
    let parsed;
    try { parsed = parseReplay(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)); } catch (e) { return fail(400, 'bad_replay', { detail: e.message }); }
    const h = parsed.header;
    if (h.v !== 1 || !isLevel(h.level) || !Number.isInteger(h.seed) || h.seed < 1 || h.seed > 2147483647) return fail(400, 'bad_header');
    if (h.roundSeconds !== 0 && h.roundSeconds !== 45) return fail(400, 'bad_header');
    const ladder = isLadder(h.ladder) ? h.ladder : 'keys';
    if (!coreIds.has(String(h.core))) return fail(426, 'old_version');
    const last = await store.lastBoutAt(player.id);
    if (last && now() - last < MIN_BOUT_GAP_MS) return fail(429, 'too_fast');

    const core = await loadCore();
    const r = replayBout(core, parsed);
    if (!r.ok) return fail(400, 'bad_replay', { detail: r.error });
    if (!r.finished) return fail(422, 'not_finished');
    if (r.simTick < MIN_SIM_SECONDS * 120) return fail(422, 'too_short');
    const score = r.winner === 'player' ? 1 : r.winner === 'bot' ? 0 : 0.5;
    const result = score === 1 ? 'win' : score === 0 ? 'loss' : 'draw';
    const hash = sha256(raw);
    const applied = await (async () => {
      // the bout row first: its unique (player, replay) key turns a resubmitted recording into a rejection, before any rating moves
      const fresh = await store.insertBout({ playerId: player.id, ladder, level: h.level, result, method: r.method, seed: h.seed, frames: parsed.rows, replayHash: hash, at: now() });
      if (!fresh) return 'duplicate';
      const done = await applyResult(player, ladder, h.level, score, r.method === 'ko' || r.method === 'tko' ? 'ko' : 'other');
      if (!done) await store.deleteBout(player.id, hash); // nothing was rated: the player may send the same recording again
      return done;
    })();
    if (applied === 'duplicate') return fail(409, 'duplicate');
    if (!applied) return fail(503, 'busy');
    return reply(200, await standingAfter(player, ladder, { result, method: r.method, level: h.level, delta: Math.round((applied.after - applied.before) * 10) / 10 }));
  }

  // Leaving a started bout is a loss (otherwise everyone would quit the fights they are losing). Harmless to forge: it can only hurt the sender.
  async function forfeit(body) {
    let j;
    try { j = JSON.parse(body.toString('utf8')); } catch { return fail(400, 'bad_json'); }
    const player = await authenticate(String(j.id || ''), String(j.secret || ''));
    if (!player) return fail(403, 'unknown_player');
    if (!isLadder(j.ladder) || !isLevel(j.level)) return fail(400, 'bad_header');
    const last = await store.lastBoutAt(player.id);
    if (last && now() - last < 3000) return fail(429, 'too_fast');
    const hash = sha256(`forfeit|${player.id}|${now()}|${Math.random()}`);
    await store.insertBout({ playerId: player.id, ladder: j.ladder, level: j.level, result: 'loss', method: 'forfeit', seed: 0, frames: 0, replayHash: hash, at: now() });
    const applied = await applyResult(player, j.ladder, j.level, 0, 'other');
    if (!applied) return fail(503, 'busy');
    return reply(200, await standingAfter(player, j.ladder, { result: 'loss', method: 'forfeit', level: j.level, delta: Math.round((applied.after - applied.before) * 10) / 10 }));
  }

  // req: { method, query: {..}, headers: {lowercase..}, body: Buffer }
  return async function handle(req) {
    try {
      const op = String(req.query.op || '');
      if (req.method === 'GET') return await board(req.query);
      if (req.method !== 'POST') return fail(405, 'method');
      if (req.body.length > MAX_BODY_BYTES) return fail(413, 'too_big');
      if (op === 'claim') return await claim(req.body);
      if (op === 'bout') return await bout(req.headers, req.body);
      if (op === 'forfeit') return await forfeit(req.body);
      return fail(400, 'op');
    } catch (err) {
      console.error('rating api:', err && err.stack ? err.stack : err);
      return fail(500, 'server');
    }
  };
}

export { RATING_START };
