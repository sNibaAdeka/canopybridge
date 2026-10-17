// Anonymous telemetry: the page side (site/src/telemetry.js) and the endpoint (api/events_api.mjs with the in-memory store), without a browser.
//   node Tests/Web/telemetry_test.mjs
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(HERE, '..', '..', 'Tools', 'Build', 'Web');

// a tiny localStorage for node
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };

const { Telemetry, teleUaClass, teleGpuClass, TELE_TYPES } = await import(pathToFileURL(path.join(WEB, 'site', 'src', 'telemetry.js')));
const { createEventsApi, EVENTS_RATE_PER_MINUTE } = await import(pathToFileURL(path.join(WEB, 'api', 'events_api.mjs')));
const { MemoryEventsStore } = await import(pathToFileURL(path.join(WEB, 'api', 'events_store.mjs')));

const results = [];
const check = (name, ok, info = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`); };

// ---- page side
let clock = Date.UTC(2026, 9, 17, 12);
const sent = [];
const mk = (extra = {}) => new Telemetry({ version: '1.7.0', endpoint: '/api/events', send: (u, b) => sent.push(JSON.parse(b)), now: () => clock, automated: false, ...extra });

const t = mk();
check('enabled by default for a person (no DNT, not automated)', t.enabled);
check('a random anonymous id is kept between page loads', t.anon && mk().anon === t.anon && t.session !== mk().session, t.anon.slice(0, 8));
t.track('bout_start', { mode: 'bout', control: 'keys', level: 0, nick: 'Петя'.repeat(40), nested: { a: 1, b: 'x' }, list: [1, 2] });
t.track('not_an_event', { x: 1 });
t.flush();
const ev = sent[0].events;
check('unknown event types are dropped', ev.length === 1 && ev[0].type === 'bout_start');
check('long strings are cut to 80 chars, arrays dropped, nested objects keep numbers only',
  ev[0].props.nick.length === 80 && !('list' in ev[0].props) && JSON.stringify(ev[0].props.nested) === '{"a":1}', JSON.stringify(ev[0].props).slice(0, 80));
check('the batch carries version, ids, browser family; never a raw user agent', sent[0].v === '1.7.0' && sent[0].a === t.anon && !('userAgent' in sent[0]) && /-/.test(sent[0].ua));

sent.length = 0;
for (let i = 0; i < 45; i++) t.track('fps_sample', { avg: 60 });
t.flush(); t.flush(); t.flush();
check('batches of at most 20 events', sent.length === 3 && sent[0].events.length === 20 && sent[2].events.length === 5, sent.map((b) => b.events.length).join('/'));

for (let i = 0; i < 150; i++) t.track('fps_sample', { avg: i });
check('the queue never grows past 100 events (oldest dropped)', t.queue.length === 100 && t.queue[0].props.avg === 50);

t.setEnabled(false);
t.track('bout_end', {});
check('switched off: the queue is emptied and nothing is recorded', t.queue.length === 0 && localStorage.getItem('ironecho.telemetry') === '0');
check('...and it stays off after reload', !mk().enabled);
t.setEnabled(true);
check('switched on again', mk().enabled);

const setNav = (v) => Object.defineProperty(globalThis, 'navigator', { value: v, configurable: true, writable: true });
setNav({ doNotTrack: '1', userAgent: 'x' });
mem.delete('ironecho.telemetry');
check('Do Not Track: off unless the player switches it on', !mk().enabled);
setNav({ userAgent: 'x' });
check('automated browsers (tests) send nothing unless forced', !mk({ automated: true }).enabled && mk({ automated: true, force: true }).enabled);
check('no endpoint: nothing is enabled', !new Telemetry({ version: '1', endpoint: '' }).enabled);

const e1 = mk();
sent.length = 0;
e1.error('boom'); e1.error('boom'); e1.error('other');
e1.flush();
check('each error message is reported once per page', sent[0].events.filter((e) => e.type === 'error').length === 2);

mem.delete('ironecho.firstSeen'); mem.delete('ironecho.returnDays');
const r0 = mk(); r0.returnDays();
clock += 3 * 86400000;
const r3 = mk(); sent.length = 0; r3.returnDays(); r3.returnDays(); r3.flush();
const days = sent[0] ? sent[0].events.filter((e) => e.type === 'return_day').map((e) => e.props.n) : [];
check('return days 1 and 3 reported once each after three days', JSON.stringify(days) === '[1,3]', JSON.stringify(days));

check('browser/OS family', teleUaClass('Mozilla/5.0 (Windows NT 10.0) AppleWebKit Chrome/130 Safari/537 Edg/130') === 'edge-win'
  && teleUaClass('Mozilla/5.0 (Macintosh; Intel Mac OS X) Version/17 Safari/605') === 'safari-mac'
  && teleUaClass('Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile') === 'chrome-android');
check('graphics family', teleGpuClass('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060)') === 'nvidia' && teleGpuClass('ANGLE (Intel, Intel(R) UHD Graphics 620)') === 'intel'
  && teleGpuClass('Google SwiftShader') === 'software' && teleGpuClass('') === 'unknown');

// ---- endpoint
const store = new MemoryEventsStore();
let now = 1_000_000;
const api = createEventsApi({ store, now: () => now });
const body = (events, extra = {}) => Buffer.from(JSON.stringify({ v: '1.7.0', a: 'a1b2c3d4-0000-4000-8000-000000000001', s: 's1b2c3d4-0000', ua: 'chrome-win', gpu: 'intel', events, ...extra }));
let r = await api({ method: 'POST', headers: { 'x-forwarded-for': '1.2.3.4', 'x-vercel-ip-country': 'KZ' }, body: body([{ type: 'page_open', props: { lang: 'ru' } }, { type: 'evil', props: {} }]) });
check('a valid batch is stored (204), unknown types skipped', r.status === 204 && store.rows.length === 1 && store.rows[0].type === 'page_open' && store.rows[0].country === 'KZ');
check('no address is stored', !JSON.stringify(store.rows).includes('1.2.3.4'));
r = await api({ method: 'GET', headers: {}, body: null });
check('GET is refused', r.status === 405);
r = await api({ method: 'POST', headers: { 'x-forwarded-for': '9.9.9.9' }, body: Buffer.from('{oops') });
check('broken JSON → 400', r.status === 400);
r = await api({ method: 'POST', headers: { 'x-forwarded-for': '9.9.9.9' }, body: body(Array.from({ length: 21 }, () => ({ type: 'page_open', props: {} }))) });
check('more than 20 events → 400', r.status === 400);
r = await api({ method: 'POST', headers: { 'x-forwarded-for': '9.9.9.9' }, body: body([{ type: 'page_open', props: {} }], { a: '<script>' }) });
check('a malformed id → 400', r.status === 400);
const before = store.rows.length;
r = await api({ method: 'POST', headers: { 'x-forwarded-for': '9.9.9.9' }, body: body([{ type: 'bout_end', props: { big: 'x'.repeat(2000) } }]) });
check('an event with oversized props is skipped', r.status === 204 && store.rows.length === before);
r = await api({ method: 'POST', headers: { 'x-forwarded-for': '9.9.9.9' }, body: Buffer.alloc(40_000, 32) });
check('an oversized body → 413', r.status === 413);
let last = null;
for (let i = 0; i < EVENTS_RATE_PER_MINUTE + 2; i++) last = await api({ method: 'POST', headers: { 'x-forwarded-for': '5.5.5.5' }, body: body([{ type: 'page_open', props: {} }]) });
check('rate limit per address → 429', last.status === 429);
now += 61_000;
r = await api({ method: 'POST', headers: { 'x-forwarded-for': '5.5.5.5' }, body: body([{ type: 'page_open', props: {} }]) });
check('...and the limit resets after a minute', r.status === 204);
const broken = createEventsApi({ store: { insert: async () => { throw new Error('secret db detail'); } } });
r = await broken({ method: 'POST', headers: {}, body: body([{ type: 'page_open', props: {} }]) });
check('a storage failure answers 503 without details', r.status === 503 && !JSON.stringify(r.json).includes('secret'));
check('the page and the server know the same event types', TELE_TYPES.has('camera_calibrated') && TELE_TYPES.has('collect'));

const failed = results.filter((x) => !x).length;
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
