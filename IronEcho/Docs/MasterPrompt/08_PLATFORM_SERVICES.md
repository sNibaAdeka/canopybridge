# 08 — PLATFORM SERVICES: TELEMETRY, RATING, SOCIAL, ONLINE, PRIVACY

All services run on Vercel serverless functions + Supabase Postgres/Storage (already in use). No new vendors without owner approval.
Secrets live in Vercel env vars set by the owner. Code reads them from `process.env`. Never log or print them.

## 8.1 Environment variables (owner sets in Vercel → Project → Settings → Environment Variables)

| Name | Used by | Notes |
|---|---|---|
| `SUPABASE_URL` | all APIs | `https://tboqtclodnlzqcllaaij.supabase.co` |
| `SUPABASE_SERVICE_KEY` | ratings, events, profiles, traces | **secret**; owner enters, never shared with the AI |
| `EVENTS_ADMIN_TOKEN` | `/admin/health` | random 32 chars; owner creates |
| `TRACE_UPLOAD_ENABLED` | trace upload | "1" to enable |
| `ALLOWED_ORIGINS` | CORS | e.g. `https://iron-echo-boxing.vercel.app` |
Rules: preview and production both configured; redeploy after changes; the AI verifies by calling the API and reading status codes, not by reading secrets.

## 8.2 Telemetry (anonymous, privacy-first)

### 8.2.1 Principles
- No cookies, no fingerprinting, no IP storage (hash with a daily-rotating salt only for rate limiting, store nothing long-term).
- Anonymous id: random UUID in `localStorage` (`ironecho.aid`); regenerated if cleared. Session id per page load.
- Opt-out toggle in Settings → Приватность; honoured immediately (queue cleared).
- Do-Not-Track respected (`navigator.doNotTrack === '1'` → off by default).
- Payload ≤ 2 KB per batch; props whitelist; free-text never sent.

### 8.2.2 Table (migration)
```sql
create table if not exists public.events (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  anon_id text not null,
  session_id text not null,
  type text not null,
  props jsonb not null default '{}'::jsonb,
  version text not null,
  ua_class text,            -- 'chrome-win','edge-win','safari-mac','firefox-lin','android','ios','other'
  gpu_class text,           -- hashed family
  country text              -- coarse, from Vercel header x-vercel-ip-country (optional)
);
create index on public.events (type, ts desc);
create index on public.events (anon_id, ts desc);
alter table public.events enable row level security;  -- service key bypasses; no public policies
```
Retention: delete rows older than 180 days (scheduled Supabase function or manual monthly script in RUNBOOK).

### 8.2.3 Event catalog

| type | props (all optional unless noted) | when |
|---|---|---|
| `page_open` | `ref` (domain only), `lang`, `cached` | landing/app load |
| `cta_click` | `where` (hero/menu/footer), `variant` | main buttons |
| `game_loaded` | `ms`, `cached`, `bytes` | menu ready |
| `bout_start` | `mode`, `control` (keys/touch/camera), `level`, `opponent`, `tutorial` | fight begins |
| `first_punch` | `ms_since_start`, `control` | first punch thrown |
| `bout_end` | `result`, `method`, `rounds`, `duration`, `control`, `level`, `thrown`, `landed`, `knockdowns` | match over |
| `rematch` | — | |
| `camera_try` | `step` | camera chosen |
| `camera_step` | `step`, `ms`, `fail` | each calibration step |
| `camera_calibrated` | `ms`, `quality`, `skipped` | done |
| `camera_fail` | `reason` (denied/busy/none/model/slow/lost) | |
| `camera_quality` | `light`, `fpsCam`, `inferMs`, `delegate`, `res`, `lostShare` | every 30 s while camera on |
| `strike_use` | counts by kind per bout `{straight, hook, upper, elbow, knee, kick, duck...}` | with `bout_end` |
| `fps_sample` | `avg`, `p5`, `worst`, `scale`, `tier`, `dpr`, `cores` | every 30 s in bout |
| `rating_join` | — | nickname set |
| `share_click` | `kind` (clip/card/link) | |
| `error` | `msg` (≤ 120 chars), `where`, `count` | window errors, once per unique msg per session |
| `net_stats` | `rtt`, `rollbacks`, `maxDepth` | online bouts |
| `net_fail` | `reason` | |
| `return_day` | `n` (1/3/7/14/30) | computed client-side from first-seen date |
| `feedback` | `kind`, `len` | report button (text is not stored here; separate table) |

### 8.2.4 Client (`telemetry.js`)
- `track(type, props)`; buffer in memory; flush every 10 s, on `visibilitychange`, and `pagehide` via `navigator.sendBeacon('/api/events', blob)`.
- Backoff on failure; max queue 100 events; drop oldest.
- No blocking: all calls are non-throwing and async.
- Test: `Tests/Web/telemetry_test.mjs` – with stub endpoint, verify batching, opt-out, DNT, size limits, no PII keys.

### 8.2.5 Server (`api/events.mjs`)
- Validate JSON schema (type whitelist, props size ≤ 1 KB per event, ≤ 20 events per request).
- Rate limit: 60 requests/minute per IP-hash (in-memory + Supabase fallback table); reject with 429.
- Insert in one batch; return 204. Never return DB errors to the client.
- Attach `version` from the payload; `ua_class` parsed server-side; `country` from header.

### 8.2.6 Health dashboard (`/admin/health.html` + `api/health.mjs`)
- Token in query (`?t=<EVENTS_ADMIN_TOKEN>`), constant-time compare, `noindex`.
- Queries (SQL views): daily funnel counts, conversion by step, medians for `game_loaded.ms`, FPS distribution by `gpu_class`, camera success rate by `ua_class`, top errors (group by `props->>'msg'`), bout length histogram, win rate by level/opponent, strike usage mix, D1/D7 retention from `return_day`.
- Render with simple tables and inline SVG sparklines; no heavy libraries; works on phone.
- Daily summary text (copyable) for the owner: "вчера: 120 визитов → 62 начали бой → 44 закончили; камера: 18 пробовали, 13 откалибровались".

## 8.3 Feedback channel

- Pause menu and results footer: `Сообщить о проблеме`. Modal: category (камера/лаги/баг/идея), text ≤ 500 chars, checkbox "Приложить техданные" (version, settings, FPS, UA class), optional checkbox "Приложить запись скелета последних 25 с" (consent text) — if checked, the trace is uploaded to the traces bucket.
- Table `feedback(id, ts, anon_id, category, text, tech jsonb, trace_id)`; admin page lists newest 100 (token); email notification optional (owner decides).
- Auto-reply in UI: "Спасибо! Мы читаем каждое сообщение."
- Text moderation: length limit, strip HTML on display.

## 8.4 Rating system (solo Elo)

State: server + client built and tested; storage connected after the owner adds env vars.

### 8.4.1 Activation checklist
1. Owner adds `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` in Vercel (Production + Preview) and redeploys.
2. Verify: `curl -s https://<site>/api/ratings?ladder=keys` → JSON with `players: []` or list, status 200. If 500, read Vercel function logs (owner) or reproduce locally with `release_api_smoke.mjs`.
3. Play a rated bout in the browser; check the top table changes.
4. Check tables exist: `ratings`, `bouts` (schema applied earlier; verify via Supabase MCP `list_tables` on project `tboqtclodnlzqcllaaij` only).

### 8.4.2 Design recap
- Client records inputs (IER2) during a rated bout; on finish posts nickname + recording; server re-simulates with the same core, verifies result, applies Elo K-factor by games played; duplicate recordings rejected by hash; leaving mid-bout counts as a loss (next launch).
- Separate ladders: `keys` (keyboard/touch) and `camera`.
- Nickname: 3–16 chars, letters/digits/space/underscore/hyphen; profanity filter; unique case-insensitive; claim token stored in localStorage (so only the claimant updates it).
- Rate limit: 20 submissions/hour per IP-hash.

### 8.4.3 Additions for the launch
1. **Public leaderboard** on landing (top 10 per ladder; cache 60 s).
2. **Weekly board**: `rating_week(week_id, nickname, delta, games)`; badge for top 3 stored in `badges`.
3. **Profile API** `GET /api/profile?nick=…`: rating, rank, games, win%, favourite strike (from `strike_use`), last 5 results.
4. **Anti-abuse**: reject bouts shorter than 20 s unless KO by core rules; detect repeated identical recordings (same input hash); cap rating gain per day against the same opponent level; flag outliers (rating gain > 200/day).
5. **Name change**: once per 30 days with the claim token.
6. **Deletion**: `DELETE /api/profile` with claim token removes nickname data.

### 8.4.4 Tests
- Existing: `rating_test.mjs`, `rating_store_test.mjs`, `rating_e2e.js`, `release_api_smoke.mjs`.
- New: profile/weekly/abuse tests using the in-memory store; load test with 100 simulated submissions (no external service).

## 8.5 Social features

### 8.5.1 Ghost challenge links
- Encode recording (IER2 rows, ≤ 22 B each; a 3-min bout at 10 events/s ≈ 40 KB raw) → compress (CompressionStream deflate) → base64url; for long bouts upload to Supabase Storage `ghosts/<id>` and use `?ghost=<id>`; short ones inline in the URL fragment (≤ 6 KB).
- Table `ghosts(id, nickname, rating, created_at, size)`; TTL 30 days.
- Playback: the ghost drives the opponent robot using recorded **player** inputs (mirror positions) while the challenger controls the player; the core is deterministic, so identical seeds recreate the same bot-less duel. (Implementation detail: use the two-player match setup with scripted inputs for slot B.)
- Result screen shows "Ты против призрака <nick>".

### 8.5.2 Clip / result card
- Client-only (file 02, 2.6). Telemetry `share_click`.
- Optional hosted clips: not in v1 (storage and moderation cost).

### 8.5.3 Friends / invite
- "Позвать друга": copy link with `?ref=<nick>`; reward: both get a cosmetic if the friend completes a bout (server-side check via `ref` event join). Keep simple; no accounts.

## 8.6 Online duel

State: working in tests with local broker; public PeerJS broker for introduction; NAT traversal via STUN only.

### 8.6.1 v1 scope
- Private rooms via code/link only. "Beta" label.
- Cameras or keyboards; show peer's control type.
- Disconnect handling: leaver forfeits after 10 s.
- Telemetry: `net_stats`, `net_fail`.

### 8.6.2 Acceptance for keeping it in the demo
- 5 real pairs × 5 bouts, zero hash mismatches, median rollback depth ≤ 3 frames at ≤ 80 ms RTT; ≥ 85 % of room joins succeed (telemetry).
- If NAT failures > 15 %: plan TURN (owner decision; free-tier quotas) or hide the feature.

### 8.6.3 Later (not v1)
Quick match queue (needs a signalling server we control), spectators, tournaments.

## 8.7 Privacy, legal, compliance pages (drafts for owner approval)

### 8.7.1 Privacy policy (outline to fill in `Docs/PRIVACY_DRAFT.md`, then `/privacy`)
1. Who we are (owner name/contact).
2. What the camera does: processes video locally in your browser; video is never uploaded.
3. What we store: anonymous random id; gameplay stats; nickname and rating if you join the ladder; optional skeleton recordings (numbers, no images) if you consent; feedback text if you send.
4. What we do not collect: names, emails, IP addresses (hashed temporarily for abuse control only), cookies, precise location.
5. Third parties: Vercel (hosting), Supabase (database), PeerJS public broker (online connection setup; exchanges connection data), MediaPipe model files served from our domain.
6. Retention: events 180 days; ratings until deletion; recordings until deletion request.
7. Your rights: delete data (button + email), opt-out of analytics, export.
8. Children: not directed to under 13.
9. Changes and contact.
Owner must review; a lawyer review is recommended before commercial launch/monetisation (not performed by the AI).

### 8.7.2 Terms (short)
Use at your own risk (physical movement: clear space, stop if pain), no cheating/abuse of the ladder, nickname rules, service as is.

### 8.7.3 Health and safety notice
First camera session: "Освободи место вокруг, не бей слишком сильно, остановись при боли. Игра не заменяет тренировку." (no medical claims).

### 8.7.4 Credits and licences (`/credits`, `Docs/Licenses.md`)
List: MediaPipe (Apache-2.0), Three.js (MIT), PeerJS (MIT), qrcode lib (check), fonts (Barlow Condensed OFL, Inter OFL), any CC0 audio; include licence texts and URLs. Verify every vendored library's licence from its package metadata; do not guess.

### 8.7.5 Cookie/consent banner
Not required if no cookies/trackers; keep a small privacy notice link on first load; camera consent is a separate explicit step.

## 8.8 Admin and operations

- `Docs/RUNBOOK.md`: how to release, roll back, rotate keys, read the health page, handle abuse (ban nickname: SQL snippet), delete data on request, backup (Supabase daily backups on paid plans; otherwise export script `Tools/Ops/export.mjs` weekly).
- Alerts: simple — health page flag if errors/min > N; the owner checks daily during the first weeks. (No pager services.)
- Cost watch: Supabase free tier limits (500 MB DB, 1 GB storage, 2 GB egress/month at the time of writing — verify in the dashboard); Vercel hobby limits (bandwidth 100 GB/month, function invocations); estimate: 1,000 players/day × 8 MB first load = 8 GB/day → **bandwidth risk** → service worker caching and splitting (file 06) are cost controls; plan CDN-friendly immutable assets; inform the owner of limits before launch (Hobby plan is for non-commercial use — check terms if monetising).

## 8.9 Data model summary

| Table | Purpose | Key columns |
|---|---|---|
| `ratings` | players and Elo per ladder | nickname, ladder, rating, games, wins, claim_hash |
| `bouts` | verified bouts | id, nickname, ladder, result, hash, ts |
| `events` | telemetry | see 8.2.2 |
| `feedback` | user reports | category, text, tech, trace_id |
| `trace_index` | optional uploaded recordings | id, participant, size, game |
| `ghosts` | challenge links | id, nickname, rating, size |
| `badges` | weekly top-3 etc. | nickname, badge, week |
| `career_progress` | optional sync | nickname, node, stars |
Migrations are SQL files in `Tools/Build/Web/api/migrations/NNN_name.sql`, applied via Supabase MCP `apply_migration` to the iron-echo project only, each recorded in `Docs/RUNBOOK.md`.

## 8.10 Acceptance for Phase 5 (platform)

- [ ] `/api/events` live; events visible in Supabase; opt-out and DNT tested.
- [ ] Health page shows funnel with real data from the closed test.
- [ ] Rating live with leaderboard on landing; weekly board; profile page.
- [ ] Ghost links work across browsers; clip/card share work on Chrome/Edge.
- [ ] Feedback button creates rows (and trace when consented).
- [ ] Privacy/terms/credits pages drafted and reviewed by the owner.
- [ ] Online duel acceptance (8.6.2) or hidden.
