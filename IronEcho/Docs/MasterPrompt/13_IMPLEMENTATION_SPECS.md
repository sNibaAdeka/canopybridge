# 13 — IMPLEMENTATION SPECS (code skeletons, interfaces, test lists)

Concrete starting points for the largest work packages. They are skeletons: adapt to the real code (read the surrounding files first),
keep the style of the repository (ES modules in `site/src`, no build step except `site_build.py` inlining, 2-space indentation, single quotes, semicolons).
Every spec ends with the tests that must exist.

## 13.1 `telemetry.js`

### Interface
```js
// site/src/telemetry.js
export const telemetry = {
  init({ version, endpoint = '/api/events', flags }),   // reads settings, DNT, creates ids, starts flush timer
  track(type, props = {}),                               // never throws, never blocks
  setEnabled(on),                                        // Settings → Приватность; persists 'ironecho.telemetry'
  flush(useBeacon = false),
  identity(),                                            // { anon, session }
};
```
### Skeleton
```js
const KEY_ID = 'ironecho.aid', KEY_ON = 'ironecho.telemetry', KEY_FIRST = 'ironecho.first';
const MAX_QUEUE = 100, MAX_BATCH = 20, FLUSH_MS = 10000;
const ALLOWED = new Set(['page_open','cta_click','game_loaded','bout_start','first_punch','bout_end','rematch','camera_try',
  'camera_step','camera_calibrated','camera_fail','camera_quality','strike_use','fps_sample','rating_join','share_click',
  'error','net_stats','net_fail','return_day','feedback']);
let state = { enabled: true, queue: [], timer: 0, version: '', endpoint: '', anon: '', session: '' };

function safeStorage(fn, fallback) { try { return fn(); } catch { return fallback; } }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now(); }

export function init(opts) {
  state.version = opts.version; state.endpoint = opts.endpoint || '/api/events';
  const dnt = navigator.doNotTrack === '1' || window.doNotTrack === '1';
  const saved = safeStorage(() => localStorage.getItem(KEY_ON), null);
  state.enabled = saved === null ? !dnt : saved === '1';
  state.anon = safeStorage(() => localStorage.getItem(KEY_ID) || (localStorage.setItem(KEY_ID, uuid()), localStorage.getItem(KEY_ID)), uuid());
  state.session = uuid();
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(true); });
  addEventListener('pagehide', () => flush(true));
  addEventListener('error', (e) => track('error', { msg: String(e.message || '').slice(0, 120), where: String(e.filename || '').split('/').pop() + ':' + e.lineno }));
  addEventListener('unhandledrejection', (e) => track('error', { msg: String(e.reason && e.reason.message || e.reason).slice(0, 120), where: 'promise' }));
  state.timer = setInterval(() => flush(false), FLUSH_MS);
  returnDays();
}
export function track(type, props = {}) {
  if (!state.enabled || !ALLOWED.has(type)) return;
  const clean = {};
  for (const [k, v] of Object.entries(props)) {
    if (typeof v === 'number' || typeof v === 'boolean') clean[k] = v;
    else if (typeof v === 'string') clean[k] = v.slice(0, 80);
    else if (v && typeof v === 'object' && JSON.stringify(v).length < 300) clean[k] = v;
  }
  state.queue.push({ type, props: clean, t: Date.now() });
  if (state.queue.length > MAX_QUEUE) state.queue.shift();
}
export function flush(useBeacon) {
  if (!state.enabled || !state.queue.length) return;
  const batch = state.queue.splice(0, MAX_BATCH);
  const body = JSON.stringify({ v: state.version, a: state.anon, s: state.session, ua: uaClass(), gpu: gpuClass(), events: batch });
  if (useBeacon && navigator.sendBeacon) { navigator.sendBeacon(state.endpoint, new Blob([body], { type: 'application/json' })); return; }
  fetch(state.endpoint, { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'application/json' } })
    .catch(() => { state.queue.unshift(...batch.slice(0, 10)); });
}
```
Helpers `uaClass()` (browser + OS family only), `gpuClass()` (WEBGL_debug_renderer_info → family; cache), `returnDays()` (compare first-seen date with today; emit once per n in [1,3,7,14,30]).
Wire points in `main.js`: `page_open` at module start; `cta_click` on `#start`; `game_loaded` when `app.loaded`; `bout_start` in `startBout`; `first_punch` when first player attack event; `bout_end` in `onMatch` MatchOver; camera events from `pose.js` via an injected callback `opts.onEvent` (keep `pose.js` free of imports: pass a function).

### Tests (`Tests/Web/telemetry_test.mjs`, node + fake `window`/`localStorage`)
1. disabled by DNT; `setEnabled(false)` empties the queue.
2. unknown type ignored; props sanitised (long strings truncated, nested objects > 300 chars dropped).
3. batching ≤ 20 events; flush on pagehide uses beacon; failed fetch re-queues at most 10.
4. no PII fields: scan payload keys against a deny-list (`name`, `email`, `nick` must not appear unless `rating_join` carries no nick).
5. errors captured with truncated messages.

## 13.2 `api/events.mjs`

```js
// Vercel function (Node 20). Reads SUPABASE_URL + SUPABASE_SERVICE_KEY from env.
const WHITELIST = new Set([...]);                    // same as client
const RATE = new Map();                              // ipHash -> { n, t }  (best-effort; resets on cold start)
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const day = new Date().toISOString().slice(0, 10);
  const ipHash = await sha256(ip + day + (process.env.EVENTS_SALT || 'x'));
  const slot = RATE.get(ipHash) || { n: 0, t: Date.now() };
  if (Date.now() - slot.t > 60000) { slot.n = 0; slot.t = Date.now(); }
  if (++slot.n > 60) return res.status(429).end();
  RATE.set(ipHash, slot);
  let body; try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch { return res.status(400).end(); }
  if (!body || !Array.isArray(body.events) || body.events.length > 20) return res.status(400).end();
  const rows = [];
  for (const e of body.events) {
    if (!WHITELIST.has(e.type)) continue;
    if (JSON.stringify(e.props || {}).length > 1000) continue;
    rows.push({ anon_id: String(body.a).slice(0, 64), session_id: String(body.s).slice(0, 64), type: e.type, props: e.props || {},
      version: String(body.v).slice(0, 16), ua_class: String(body.ua || '').slice(0, 24), gpu_class: String(body.gpu || '').slice(0, 24),
      country: String(req.headers['x-vercel-ip-country'] || '').slice(0, 2) });
  }
  if (rows.length) {
    const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/events`, { method: 'POST',
      headers: { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(rows) });
    if (!r.ok) console.error('events insert failed', r.status);   // never echo body or key
  }
  res.status(204).end();
}
```
Also support CORS preflight only for allowed origins. Reuse the existing storage abstraction in `api/rating_store.mjs` (MemoryStore + SupabaseStore) for tests: add `EventsStore` with the same two backends so `telemetry_test` can run end-to-end without the network.

## 13.3 `collect.js` (Collection Mode)

### State machine
```
idle → consent → form → setup → running(block i, cue j) → paused → finished
```
### Data structures
```js
export const PROTOCOL = [   // loaded from collect_protocol.json
  { id: 'stance', title: {ru:'Стойка', en:'Stance'}, kind: 'hold', seconds: 3, count: 3 },
  { id: 'block', kind: 'hold', seconds: 2, count: 5 },
  { id: 'hook', kind: 'strike', sides: ['L','R'], count: 10, targets: ['head','head','head','body'] , cue: {ru:'Хук {side}', en:'Hook {side}'} },
  ...
];
class Runner {
  constructor(camera, protocol, ui, rng)
  start(condition)              // sets condition, begins first block
  nextCue()                     // schedules cue with randomised rest 1.4–2.0 s
  mark(status)                  // ok | skipped | redo | invisible
  tick(now)                     // called from rAF; manages countdown/windows
  export()                      // returns session object per schema 4.2.5
}
```
### Reuse
- Frames: `CameraInput.rec` (`TraceRecorder`) — extend its `build()` with `cues`, `conditions`, `participant` via a `meta` extension; do not duplicate capture.
- Speech: `speechSynthesis.speak(new SpeechSynthesisUtterance(text))` with `lang` ru-RU/en-US; wrap in try/catch; setting "Голос" on/off.
- Randomisation: seeded PRNG (participant id) for rest times and counterbalanced block order.

### UI
Full-screen overlay `#collect` with big text (≥ 48 px), progress bar, preview of the camera (small), buttons. Use existing CSS tokens. No external assets.

### Tests (`Tests/Web/collect_test.mjs`)
1. Runner over the synthetic fighter: for each cue schedule the corresponding `pose_sim` action at `cue_time + reaction(0.35 s)`; run full protocol; `export()` validates against `Docs/Testing/session.schema.json` (ajv-free hand validator).
2. Redo/skip semantics; invisible detection when frames have `world=null` in a window.
3. Counterbalance: orders differ for participants 0..3 and cover all blocks.
4. File size < 12 MB gz for 3 conditions of the synthetic fighter at 30 fps.

## 13.4 `Tools/Eval/eval_camera.mjs`

### CLI
```
node Tools/Eval/eval_camera.mjs <folder|file...> [--md Docs/Testing/CAMERA_ACCURACY.md] [--json out.json] [--condition A] [--participants p1,p2]
                                [--pose Tools/Build/Web/site/src/pose.js] [--calib synthetic|recorded]
```
### Core loop (pseudo)
```js
for (const s of sessions) {
  for (const cond of s.conditions) {
    const proc = new PoseProcessor(() => {}, {});
    feedCalibration(proc, s, cond);                              // 4.4.2 mapping
    for (const f of framesIn(s, cond)) {
      proc.process(world(f.w), f.t, image(f.i));
      const r = proc.poll();
      if (r.punchMask || r.kickMask) detections.push({ t: f.t, punch: r.punchMask, kick: r.kickMask });
      stateSamples.push({ t: f.t, block: r.block, lean: r.lean, duck: r.duck, status: r.status });
    }
    scoreCues(s.cues.filter(c => c.c === cond.id), detections, stateSamples, out);
  }
}
aggregate(out); writeMarkdown(out); writeJson(out);
```
`expectedMask(cue)`: map cue (`kind`,`side`,`target`) → bit: straight head L=1,R=2; body L=4,R=8; elbow 16/32; hook head 64/128; hook body 256/512; uppercut 1024/2048; kick mid 1/2 (kickMask), low 4/8, knee 16/32.
State cues (block/slip/duck): accept if state variable crosses its trigger (block ≥ 0.6; |lean| ≥ 0.6 with right sign; duck ≥ 0.6) within the window and holds ≥ 0.3 s.
Bootstrap CI: resample participants 1000× with seeded RNG.

### Tests (`Tests/Web/eval_test.mjs`)
- Synthetic session with 100 known cues → recall within ±5 % of the pose_strikes number for the same fault set.
- Time-shift robustness; empty session; missing cue file; unknown cue kind → clear error.
- Determinism: run twice, identical JSON bytes.

## 13.5 `golden_test.mjs`

```js
// loads Tests/Web/golden/manifest.json: [{ file, segment:[t0,t1], expects:{ hits:{ 'hook-L': 8, ... }, maxFalsePositives: 1 } }]
// runs the same evaluator on the segments, compares with expects (>= for hits, <= for FP)
// prints a table, exits 1 on regression
```
Update tool: `node Tools/Eval/golden_update.mjs --reason "…"` rewrites `expects` from the current build and appends the reason to `Tests/Web/golden/CHANGELOG.md`. Requires the owner's knowledge (state in the report).

## 13.6 Service worker (`sw.js`)

```js
const VERSION = '@@VERSION@@';                   // replaced at build
const CORE = ['/play/', '/play/index.html', '/play/core.wasm', '/play/fonts.css'];   // Phase A (names depend on the split build)
const LATE = ['/play/arena.js', '/play/robots.mo.glb', ...];                          // Phase B
self.addEventListener('install', (e) => e.waitUntil(caches.open('ie-' + VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('ie-') && k !== 'ie-' + VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/')) return;                     // never cache API
  if (e.request.mode === 'navigate') { e.respondWith(fetch(e.request).catch(() => caches.match('/play/index.html'))); return; }   // network-first for HTML
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(res => { if (res.ok) caches.open('ie-' + VERSION).then(c => c.put(e.request, res.clone())); return res; })));
});
```
Rules: never reload during a bout; the page shows "Доступна новая версия — обновить после боя" when a new SW is waiting. Test: Playwright loads twice, second load served from cache (check `performance.getEntriesByType('resource')` transferSize 0), offline reload keeps the menu working.

## 13.7 Quality tiers governor (`tiers.js`)

```js
export const TIERS = ['high', 'low', 'minimum'];
export class TierGovernor {
  constructor({ start, apply, onChange })      // apply(tier) rebuilds lights/pixel cap/particles
  sample(dtSeconds)                            // call every frame
  // rule: keep 4 s window; if p5 fps < 30 → step down (not during the first 3 s of a bout, not within 8 s of the last change);
  //       never step up automatically; expose suggestUp() when p5 > 58 for 20 s in the menu
}
```
Initial tier from `gpuClass()` and `deviceMemory`/`hardwareConcurrency`: `nvidia|amd|apple` → high; `intel-*` → low; `swiftshader|mali|adreno|other` → minimum for first load, then re-evaluated after 10 s.
Telemetry: `fps_sample` includes tier and changes `tier_change`. Tests: simulate frame times with a stub and verify transitions and hysteresis.

## 13.8 Pre-wind-up intent (visual only)

- `pose.js` exposes `proc.intent` = `{ hand, kind, strength, t }` updated every frame from raw wrist velocity and direction (kind guess: forward → straight, lateral → hook, up → upper), strength = clamp(speed / threshold).
- `main.js` passes `intent` to `anim.js` through `anim.setVisualIntent(slot, intent)` only for the player's robot when `control === 'camera'`.
- `anim.js` blends an extra glove offset (pull-back) proportional to `strength` when no attack is active; resets after 150 ms without refresh.
- Never feeds the core; deterministic tests unaffected.
- Tests: QA animation continuity (`qa.js animation`) with injected intents; false visual wind-ups counted over idle synthetic segments ≤ 1/min.

## 13.9 Clip recorder (`share.js`)

```js
export class ClipRecorder {
  constructor(canvas, { fps = 30, seconds = 12, bitrate = 2.5e6 })
  start()                      // captureStream + MediaRecorder with 1-second timeslice, ring buffer of Blob chunks
  mark(label)                  // remembers the time of a highlight
  async export(label)          // concatenates chunks around the mark (−6 s / +2 s) into a single Blob, adds watermark? (draw watermark on a offscreen canvas before capture to keep it in the file)
  stop()
}
```
Notes: MediaRecorder WebM chunks are not independently decodable except from the first; to cut a window, keep a ring of **keyframe-aligned segments** by restarting the recorder every 4 s (three overlapping recorders) or simply record the last 12 s by running a recorder in 6 s segments and concatenating the last two. Test on Chrome/Edge; fallback: hide the button if `MediaRecorder` or `captureStream` is missing. Result card: draw on an offscreen canvas then `toBlob('image/png')`.

## 13.10 Ghost link (`ghost.js`)

- Encode: `recording = replay.js.serialize(bout)` (IER2 rows) → `CompressionStream('deflate-raw')` → base64url → `#ghost=`.
- Decode: parse → `replay.js.parse` → create a match setup with seed from the recording header; slot B inputs = recorded player inputs; slot A = live player.
- Size guard: if encoded length > 6000 chars → upload to storage (`/api/ghost` POST returns id; `?ghost=<id>`).
- Tests: round trip bit-exact; fight a ghost headless and verify the ghost’s recorded damage events reproduce when the live player stands idle.

## 13.11 Career data (`career.js`)

```js
export const OPPONENTS = [
  { id: 'coach', name: 'Тренер Кусок', bio: '…', arena: 'gym', robot: { primary: '#7a8794', accent: '#f0a030' },
    bot: { level: 0, overrides: { attackRate: 0.2, telegraphMul: 1.5 } }, reward: { unlock: 'colourway:slate' }, par: { stars: [ 'win', 'noKnockdown', 'ko' ] } },
  ...
];
export function loadProgress() / saveProgress(p) / unlock(id) / stars(result)
```
The bridge must allow passing overrides into `BotConfig` (check `IronEchoWeb.cpp` exports; if absent, add `setBotOverrides` with tests in `Tests/CoreRules` and the parity check).

## 13.12 Tutorial (`tutorial.js`)

```js
export function runTutorial(app, mode)    // mode: 'keys' | 'camera'
steps = [{ id:'jabL', prompt:t('tut.jabL'), done: (ev)=> ev.type==='playerAttack' && ev.hand===0 }, ...]
```
Subscribe to core events through the existing `onCombat`; display prompt chip; mark ✓ with sound; timeout hint after 8 s; `Пропустить` ends. Persist `ironecho.tutorial=done`. Test: scripted keys complete all steps; skip works; second visit skips.

## 13.13 Localization (`i18n.js`)

```js
import ru from './strings.ru.json'; // inlined by site_build.py as JS objects
export function t(key, params) {...}   // falls back to ru, then to key (and logs in dev)
export function setLang(l)             // updates [data-i18n] nodes and dynamic strings; stores setting
```
HTML templates: `data-i18n="menu.play"`; build step replaces defaults at build time for SEO (default RU in the markup). Tests: key parity script; DOM scan shows no raw keys; plural helper `plural(n, ['удар','удара','ударов'])`.

## 13.14 Health page queries (SQL)

```sql
-- daily funnel
select date_trunc('day', ts) d,
  count(distinct anon_id) filter (where type='page_open') visitors,
  count(distinct anon_id) filter (where type='cta_click') clicked,
  count(distinct anon_id) filter (where type='bout_start') started,
  count(distinct anon_id) filter (where type='bout_end') finished,
  count(distinct anon_id) filter (where type='camera_try') cam_try,
  count(distinct anon_id) filter (where type='camera_calibrated') cam_ok
from events where ts > now() - interval '14 days' group by 1 order by 1 desc;

-- load time median/p90 by day
select date_trunc('day', ts) d,
  percentile_cont(0.5) within group (order by (props->>'ms')::numeric) p50,
  percentile_cont(0.9) within group (order by (props->>'ms')::numeric) p90
from events where type='game_loaded' and ts > now() - interval '14 days' group by 1 order by 1 desc;

-- fps by gpu class
select gpu_class, count(*) n, percentile_cont(0.5) within group (order by (props->>'avg')::numeric) fps_p50,
  percentile_cont(0.05) within group (order by (props->>'p5')::numeric) fps_p5
from events where type='fps_sample' group by 1 order by n desc;

-- top errors
select props->>'msg' msg, count(*) n, count(distinct anon_id) players from events where type='error' and ts > now() - interval '3 days' group by 1 order by n desc limit 20;
```

## 13.15 Order of implementation inside Phase 0 (dependencies)

```
env.example.sh → baseline ──┬─> telemetry.js + api/events + tests
                            ├─> TraceRecorder.v2 (cues, conditions) ─> collect.js ─> collect_test
                            └─> session schema ─> eval_camera.mjs ─> eval_test ─> golden_test (after real data)
                latency mode + timeline log ─> latency_from_video.py
                verify.py + CI skeleton (last, uses everything)
```

## 13.16 Definition of done per spec

Each spec is done when: code merged, tests listed above pass, relevant doc updated, the feature flag (if any) documented in `flags.json`, telemetry events added, and a line appended to `PROJECT_STATE.md` with verified numbers.
