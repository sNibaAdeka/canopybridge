// Rating system, end to end without a browser or a database: the page's RatingClient talks to the real server code (rating_api.mjs) over a
// fake fetch, with the in-memory store, and the server replays recorded bouts on the real WebAssembly core.
//
//   node Tests/Web/rating_test.mjs        (needs Build/Web/core/ironecho_core.wasm: python Tools/Build/Web/build_web.py core)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..', '..');
const SRC = path.join(PROJECT, 'Tools', 'Build', 'Web', 'site', 'src');
const API = path.join(PROJECT, 'Tools', 'Build', 'Web', 'api');
const WASM = process.env.IRONECHO_CORE_WASM || path.join(PROJECT, 'Build', 'Web', 'core', 'ironecho_core.wasm');
if (!fs.existsSync(WASM)) { console.error(`no core at ${WASM}; run: python Tools/Build/Web/build_web.py core`); process.exit(2); }
const B64 = fs.readFileSync(WASM).toString('base64');
globalThis.IRONECHO_CORE_WASM_B64 = B64;
const imp = (dir, f) => import(pathToFileURL(path.join(dir, f)));
const { loadCore } = await imp(SRC, 'core.js');
const rules = await imp(SRC, 'ratingrules.js');
const { BoutRecorder, parseReplay, replayBout } = await imp(SRC, 'replay.js');
const { RatingClient, ratingCoreId, ratingGzip } = await imp(SRC, 'rating.js');
const { createRatingApi, MIN_BOUT_GAP_MS } = await imp(API, 'rating_api.mjs');
const { MemoryStore } = await imp(API, 'rating_store.mjs');

const results = [];
const check = (name, ok, info = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`); };
const approx = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;

// ------------------------------------------------------------------ rules
check('nicknames: letters of any alphabet, digits, inner space _ . -, 3-16 characters',
  rules.cleanNick('Адёка') === 'Адёка' && rules.cleanNick('  Iron  Echo ') === 'Iron Echo' && rules.cleanNick('a_b-c.d9') === 'a_b-c.d9' && rules.cleanNick('ab') === ''
  && rules.cleanNick('x'.repeat(17)) === '' && rules.cleanNick('<b>hi</b>') === '' && rules.cleanNick('-abc') === '' && rules.cleanNick('abc-') === '' && rules.cleanNick('😀😀😀') === '');
check('nicknames: Cyrillic look-alikes and separators collapse to one key', rules.nickKey('Аdmin') === rules.nickKey('admin') && rules.nickKey('Iron_Echo') === rules.nickKey('iron echo') && rules.nickKey('Сергей') === rules.nickKey('Cергей'));
check('Elo: equal ratings, a win is worth K/2', approx(rules.ratingAfter(1200, 50, 1, 1), 1212) && approx(rules.ratingAfter(1200, 50, 1, 0), 1188) && approx(rules.ratingAfter(1200, 50, 1, 0.5), 1200));
check('Elo: beating the Easy bot at 1500 earns almost nothing, losing to it costs nearly everything',
  rules.ratingAfter(1500, 50, 0, 1) - 1500 < 1 && 1500 - rules.ratingAfter(1500, 50, 0, 0) > 20);
check('Elo: new players move faster (K 40 / 32 / 24) and never fall below the floor', rules.kFactor(0) === 40 && rules.kFactor(10) === 32 && rules.kFactor(30) === 24 && rules.ratingAfter(100, 50, 2, 0) === 100);

// ------------------------------------------------------------------ recording a bout
function rng(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
// A scripted fighter: steady pressure with jabs and crosses, some body shots, guard in between; `aggr` sets how often it throws.
function script(seed, aggr) {
  const r = rng(seed * 31 + 7);
  return (k) => {
    const t = k / 60;
    const input = { status: 7, lean: 0, leanForward: 0, block: 0, punchMask: 0, kickMask: 0, moveForward: 0, moveSide: 0, confidence: 1 };
    if (r() < aggr) input.punchMask = [1, 2, 1, 2, 4, 8][(r() * 6) | 0];
    input.block = Math.sin(t * 1.7) > 0.7 ? 1 : 0;
    input.moveForward = Math.sin(t * 0.4) > 0.3 ? 1 : 0;
    input.lean = Math.round(Math.sin(t * 2) * 300) / 1000;
    return input;
  };
}
async function playRecorded({ level, seed, roundSeconds, aggr, header }) {
  const core = await loadCore();
  core.init({ mode: 0, level, seed, rounds: 0, roundSeconds });
  core.recorder = new BoutRecorder({ v: 1, core: ratingCoreId(B64), level, seed, roundSeconds, ladder: 'keys', ...header });
  const input = script(seed, aggr);
  let paused = false;
  for (let k = 0; k < 60 * 60 * 6; k++) {
    // a pause in the middle, as a player does (focus lost, Esc): recorded as its own rows
    if (k === 600) { core.pause(); core.frame(1 / 100, { status: 7 }); paused = true; }
    if (k === 640 && paused) { core.resume(); paused = false; }
    core.frame(1 / 60 + ((k % 7) - 3) * 0.0004, input(k));
    if (core.snapshot().match.phaseName === 'MatchOver') break;
  }
  return { core, recorder: core.recorder, over: core.snapshot().match.phaseName === 'MatchOver' };
}

console.log('--- a recorded bout replays to the very same state');
const rec = await playRecorded({ level: 0, seed: 11, roundSeconds: 45, aggr: 0.12 });
check('the scripted bout (with a pause) reaches its end', rec.over, `${rec.recorder.rows} rows`);
const bytes = rec.recorder.bytes();
const parsed = parseReplay(bytes);
const replayCore = await loadCore();
const rr = replayBout(replayCore, parsed);
const same = (a, b) => { const x = a.stateWords(); const y = b.stateWords(); return x.length === y.length && x.every((v, i) => v === y[i]); };
check('replaying the recording on a fresh core ends in exactly the recorded final state', rr.ok && rr.finished && same(rec.core, replayCore), `${rr.winner} by ${rr.method}, round ${rr.round}`);
const gz = await ratingGzip(bytes);
check('a whole bout is a small upload (gzip)', gz.length < 150000, `${rec.recorder.rows} rows, ${bytes.length} B raw, ${gz.length} B gzip`);
const cut = new Uint8Array(bytes.subarray(0, 12 + JSON.stringify({ ...rec.recorder.header, rows: 0 }).length + 18 * 300));
check('a truncated file is refused by the parser', (() => { try { parseReplay(cut); return false; } catch { return true; } })());

// ------------------------------------------------------------------ server + client
let clock = 1_000_000_000_000;
const store = new MemoryStore();
const coreIds = new Set([ratingCoreId(B64)]);
const api = createRatingApi({ store, coreIds, now: () => clock, loadCore: async () => loadCore() });
let online = true;
const fakeFetch = async (url, init = {}) => {
  if (!online) throw new Error('offline');
  const u = new URL(url, 'http://test');
  const headers = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  const body = init.body === undefined ? Buffer.alloc(0) : Buffer.from(typeof init.body === 'string' ? init.body : init.body);
  const out = await api({ method: init.method || 'GET', query: Object.fromEntries(u.searchParams), headers, body });
  return { status: out.status, json: async () => out.json };
};
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };
const coreId = ratingCoreId(B64);
const A = new RatingClient({ api: 'http://test/api/ratings', storage: mem(), coreId, fetchFn: fakeFetch });
const B = new RatingClient({ api: 'http://test/api/ratings', storage: mem(), coreId, fetchFn: fakeFetch });

console.log('--- nicknames');
check('a nickname is taken by its first player', (await A.claim('Адёка')).ok === true && A.nick === 'Адёка');
check('another player cannot take it, not even with Latin look-alikes', (await B.claim('Адёка')).error === 'taken' && (await B.claim('Aдёкa')).error === 'taken' && B.nick === '');
check('bad nicknames are refused before any request', (await B.claim('x')).error === 'invalid_nick' && (await B.claim('<script>')).error === 'invalid_nick');
check('the second player takes a free name', (await B.claim('Rival')).ok === true && B.nick === 'Rival');
check('a player may rename to a free name, ratings stay with the profile', (await A.claim('Адёка 2')).ok === true && A.nick === 'Адёка 2');
check('the profile moves to another device with its code', (() => { const c = new RatingClient({ api: 'x', storage: mem(), coreId }); return c.importCode(A.exportCode()) && c.nick === 'Адёка 2' && !c.importCode('junk'); })());

console.log('--- rated bouts');
const bout = async (client, opts) => { const r = await playRecorded(opts); return { r, answer: await client.submitBout(r.recorder, opts.ladder || 'keys') }; };
let a1 = await bout(A, { level: 1, seed: 21, roundSeconds: 45, aggr: 0.10 });
check('a finished bout is verified by replay and rated with the Elo formula', a1.answer.ok && a1.answer.games === 1 && ['win', 'loss', 'draw'].includes(a1.answer.result),
  `${a1.answer.result} by ${a1.answer.method}, ${rules.RATING_START} -> ${a1.answer.exact}, rank ${a1.answer.rank}/${a1.answer.total}`);
const score = { win: 1, loss: 0, draw: 0.5 }[a1.answer.result];
check('the new rating is exactly what the formula says', approx(a1.answer.exact, rules.ratingAfter(1000, 0, 1, score)), `${a1.answer.exact}`);
const dup = await A._sendBout(await ratingGzip(a1.r.recorder.bytes()), false);
check('the same recording cannot be sent twice', dup.error === 'duplicate' || dup.error === 'too_fast', dup.error);
const early = await bout(A, { level: 1, seed: 22, roundSeconds: 45, aggr: 0.10 });
check('a second bout right away is refused (one per 15 s)', early.answer.error === 'too_fast', early.answer.error);
clock += MIN_BOUT_GAP_MS + 1000;
const dup2 = await A._sendBout(await ratingGzip(a1.r.recorder.bytes()), false);
check('...also not after the waiting time', dup2.error === 'duplicate', dup2.error);
clock += MIN_BOUT_GAP_MS + 1000;

// find one winning and one losing recording to see the table move both ways
let win = null, loss = null;
for (let seed = 30; seed < 80 && (!win || !loss); seed++) {
  const aggr = seed % 3 === 0 ? 0.25 : seed % 3 === 1 ? 0.12 : 0.02;
  const rec2 = await playRecorded({ level: 0, seed, roundSeconds: 45, aggr });
  if (!rec2.over) continue;
  const res = replayBout(await loadCore(), parseReplay(rec2.recorder.bytes()));
  if (res.winner === 'player' && !win) win = { seed, aggr, ...res };
  if (res.winner === 'bot' && !loss) loss = { seed, aggr, ...res };
}
check('the scripts produce both a win and a loss against the Easy bot', !!win && !!loss, win && loss ? `win seed ${win.seed} (${win.method}), loss seed ${loss.seed} (${loss.method})` : 'none');

const before = (await B.board('keys')).me;
const bw = await bout(B, { level: 0, seed: win.seed, roundSeconds: 45, aggr: win.aggr });
check('a win against Easy raises the rating', bw.answer.ok && bw.answer.result === 'win' && bw.answer.exact > 1000 && bw.answer.wins === 1, `${bw.answer.exact}`);
clock += MIN_BOUT_GAP_MS + 1000;
const bl = await bout(B, { level: 0, seed: loss.seed, roundSeconds: 45, aggr: loss.aggr });
check('a loss against Easy lowers it by more than the win gave', bl.answer.ok && bl.answer.result === 'loss' && bl.answer.exact < bw.answer.exact && bl.answer.losses === 1, `${bw.answer.exact} -> ${bl.answer.exact}`);

console.log('--- cheating attempts');
clock += MIN_BOUT_GAP_MS + 1000;
const forged = new Uint8Array(await ratingGzip(new Uint8Array(40)));
const send = (client, gzBytes, extraHeaders = {}) => fakeFetch('http://test/api/ratings?op=bout', { method: 'POST', body: gzBytes,
  headers: { 'X-Player-Id': client.profile.id, 'X-Player-Secret': client.profile.secret, ...extraHeaders } }).then((r) => r.json());
check('garbage instead of a recording is refused', (await send(B, forged)).error === 'bad_replay');
check('a made-up gzip with a believable header but no bout is refused', (await send(B, await ratingGzip((() => { const r = new BoutRecorder({ v: 1, core: coreId, level: 0, seed: 5, roundSeconds: 0, ladder: 'keys' }); return r.bytes(); })()))).error === 'not_finished');
const half = await playRecorded({ level: 0, seed: win.seed, roundSeconds: 45, aggr: win.aggr });
half.recorder.rows = Math.floor(half.recorder.rows / 2);
check('a bout cut in half (to hide a bad ending) is not a finished bout', (await send(B, await ratingGzip(half.recorder.bytes()))).error === 'not_finished');
const alien = await playRecorded({ level: 0, seed: 77, roundSeconds: 45, aggr: 0.1, header: { core: 'zzz-1' } });
check('a recording from another build of the core is told to update', (await send(B, await ratingGzip(alien.recorder.bytes()))).error === 'old_version');
check('a wrong secret is refused', (await fakeFetch('http://test/api/ratings?op=bout', { method: 'POST', body: forged, headers: { 'X-Player-Id': B.profile.id, 'X-Player-Secret': 'ab'.repeat(24) } }).then((r) => r.json())).error === 'unknown_player');
// the classic: change one punch in the recording of a lost bout; the replay is then a different bout and rated by what it really is
const lossRec = await playRecorded({ level: 0, seed: loss.seed, roundSeconds: 45, aggr: loss.aggr });
const flip = lossRec.recorder.bytes();
const parsedLoss = parseReplay(flip);
const noPunches = new BoutRecorder({ v: 1, core: coreId, level: 0, seed: loss.seed, roundSeconds: 45, ladder: 'keys' });
noPunches.buf = new Uint8Array(lossRec.recorder.buf); noPunches.view = new DataView(noPunches.buf.buffer); noPunches.rows = lossRec.recorder.rows;
for (let i = 0; i < noPunches.rows; i++) noPunches.view.setUint8(i * 18 + 2, 0); // remove every punch
const tamper = await send(B, await ratingGzip(noPunches.bytes()));
check('an edited recording is judged by what it replays to, not by what was claimed', tamper.ok === false ? ['not_finished', 'bad_replay'].includes(tamper.error) : tamper.result !== 'win', JSON.stringify({ r: tamper.result, e: tamper.error }));

console.log('--- leaving a bout, the table');
clock += MIN_BOUT_GAP_MS + 1000;
const beforeForfeit = (await B.board('keys', 5)).me;
B.pendingStart(0, 'keys');
const flushed = await B.flush();
check('a bout abandoned last time is settled at the next start as a loss', flushed.length === 1 && flushed[0].ok && flushed[0].method === 'forfeit' && flushed[0].exact < beforeForfeit.rating + 0.5, `${beforeForfeit.rating} -> ${flushed[0].exact}`);
check('...once only', (await B.flush()).length === 0);

// a network failure queues the bout and the next start sends it
clock += MIN_BOUT_GAP_MS + 1000;
online = false;
const queued = await bout(B, { level: 0, seed: win.seed + 1000 > 2147483647 ? 5 : win.seed, roundSeconds: 45, aggr: win.aggr });
check('with no network the bout is kept, not lost', queued.answer.error === 'network' && queued.answer.queued === true && (B._read('ironecho.queue') || []).length === 1);
online = true;
clock += 1000;
const re = await B.flush();
check('and goes out at the next start', re.length === 1 && (re[0].ok || re[0].error === 'duplicate'), JSON.stringify({ ok: re[0].ok, e: re[0].error, r: re[0].result }));

const boardKeys = await A.board('keys', 10);
check('the table lists rated players best first, with the caller marked', boardKeys.ok && boardKeys.rows.length === 2 && boardKeys.rows[0].rating >= boardKeys.rows[1].rating && boardKeys.me && boardKeys.me.nick === 'Адёка 2', JSON.stringify(boardKeys.rows.map((r) => [r.nick, r.rating])));
check('the camera table is separate', (await A.board('camera', 10)).rows.length === 0);
check('a camera bout goes to the camera table', await (async () => { clock += MIN_BOUT_GAP_MS + 1000; const c = await bout(A, { level: 0, seed: win.seed, roundSeconds: 45, aggr: win.aggr, ladder: 'camera' }); return c.answer.ok && c.answer.ladder === 'camera' && (await A.board('camera', 10)).rows.length === 1; })());

console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
