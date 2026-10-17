# 02 — PRODUCT AND MARKETING

Think like a marketer at every step. A feature is worth building only if it moves a number in the funnel (4.3) or removes a reason to leave.

## 2.1 Positioning

### 2.1.1 Core promise
"Become the boxer. Your body is the controller." Honest delivery: instant fun on keyboard, "wow" with camera when conditions allow.

### 2.1.2 One-liner candidates (test with 10 people, pick by comprehension and curiosity)
| ID | RU | EN |
|---|---|---|
| P1 | Бей робота своими руками — только камера | Punch a robot with your real hands — just a camera |
| P2 | Бокс против робота. Без контроллера | Robot boxing without a controller |
| P3 | Встань перед камерой. Стань боксёром | Step in front of the camera. Become a boxer |
| P4 | Тень-бокс, который бьёт в ответ | Shadow boxing that hits back |
Rule: the line must be understood in 3 seconds, mention the camera, promise fun not fitness.

### 2.1.3 What we are NOT
Not a fitness/health app (no calorie claims), not an "AI coach", not a realistic sim of professional boxing rules for experts.
We are an arcade-skill game with real-body control and a competitive ladder.

### 2.1.4 Comparable products (to study, not copy)
- Browser camera games (Fruit-Ninja-style hand tracking demos) — the "no install" magic.
- Boxing VR/console titles — depth of counters, telegraphed AI.
- Casual competitive web games — ladders, short rounds, share loops.
Task: spend one session playing 5 such games (owner or via descriptions), list what makes the first 30 seconds work; add notes to `Docs/BUSINESS.md`.

## 2.2 Audiences (ranked for launch)

| # | Audience | Why they come | What they need in the first minute | Risk |
|---|---|---|---|---|
| A1 | Curious gamers / streamers | "does this actually track me?" | camera wow within 90 s, shareable moment | camera fails → instant churn |
| A2 | Office/student break | 3-minute fun | one click to fight on keyboard | boring if bot too hard/easy |
| A3 | Home-fitness casuals | sweat a bit, no equipment | effort feedback, short sessions | expects medical-grade tracking |
| A4 | Boxing/MMA fans | realism and depth | counters, combos, stats | picks apart unrealism |
Design priority: A2 + A1 first, A3 via "effort score" (non-medical), A4 via stats.

## 2.3 Value proposition per audience (copy blocks)
- A1: "Твоя камера видит каждый удар. Покажи друзьям нокаут." (shareable clip button)
- A2: "Нажми — и бой. Три уровня, три минуты." 
- A3: "5 минут тень-бокса, который отвечает. Считаем усилие."
- A4: "Хуки, апперкоты, нырки, контрудары. Бот запоминает, как ты защищаешься."

## 2.4 The funnel — events, definitions, hypotheses

| # | Stage | Event name | Definition | Launch hypothesis |
|---|---|---|---|---|
| 1 | Visit | `page_open` | landing loaded | — |
| 2 | Intent | `cta_click` | pressed "ИГРАТЬ" | 35–50 % of visits |
| 3 | Loaded | `game_loaded` | menu interactive; `ms` | median ≤ 8 s first visit |
| 4 | Start | `bout_start` | fight begins (`mode`,`control`,`level`) | ≥ 60 % of loaded |
| 5 | Activation | `first_punch` | first punch thrown; `ms_since_start` | ≥ 85 % of starters |
| 6 | Completion | `bout_end` | bout finished (`result`,`rounds`,`duration`) | ≥ 70 % of starters |
| 7 | Retry | `rematch` / second `bout_start` | second bout in session | ≥ 50 % of completers |
| 8 | Camera interest | `camera_try` | chose camera | 20–40 % of starters |
| 9 | Camera success | `camera_calibrated` | calibration finished | ≥ 80 % of tries |
| 10 | Camera bout | `bout_end` with `control=camera` | | ≥ 60 % of calibrated |
| 11 | Ladder | `rating_join` | set nickname | ≥ 15 % of completers |
| 12 | Return D1 | `return_day{n:1}` | | ≥ 20 % |
| 13 | Return D7 | `return_day{n:7}` | | ≥ 8 % |
| 14 | Share | `share_click` | pressed share (clip/card/link) | ≥ 5 % of completers |
All numbers are hypotheses. After the closed test, replace them by measured values and set honest targets.

## 2.5 Diagnosing drop-offs (decision table)

| Symptom in data | Likely cause | Action |
|---|---|---|
| high `page_open`, low `cta_click` | landing copy/visual weak | rewrite headline, move CTA above fold, A/B P1–P4 |
| high `cta_click`, low `game_loaded` | slow load / error | check `game_loaded.ms`, errors, weight budget (file 06) |
| low `bout_start` after load | menu confusion | simplify to one button (file 03) |
| low `first_punch` | controls unclear | tutorial/hints, key overlay |
| low `bout_end` | too hard / too long / lag | difficulty default, round length, FPS tier |
| low `rematch` | no hook | result screen: tip + rematch primary + next opponent |
| high `camera_try`, low `camera_calibrated` | camera onboarding | light/distance guidance, fallback to keyboard |
| low D1 | no reason to return | daily goal, ladder reset, new opponent unlock |

## 2.6 Shareability (growth built into the product)

### 2.6.1 Auto highlight clip
- Record the game canvas only (`canvas.captureStream(30)` + `MediaRecorder`, WebM/VP9 or MP4 where supported), **never the webcam**.
- Keep a rolling buffer of the last ~12 s in memory (chunks of 1 s). On knockdown/combo/win, mark a highlight; button "Поделиться клипом".
- Output 6–10 s, 720p max, watermark "iron-echo-boxing.vercel.app" bottom-right, file ≤ 8 MB.
- Share via Web Share API (files) when available, else download.
- Acceptance: clip generated on Chrome/Edge in < 2 s after click, file plays in a phone gallery.

### 2.6.2 Result card
- Canvas-generated PNG 1080×1350: win/lose, rating delta, best combo, strikes landed, robot art, URL.
- Share/download. Text variants RU/EN.

### 2.6.3 Ghost challenge link
- A finished bout is already a deterministic recording (`replay.js`, IER2). Encode the player's inputs (compressed, ≤ 4 KB for a 3-minute bout) in the URL fragment: `/#ghost=<base64>`.
- The friend opens it and fights the **ghost** (replayed player inputs drive the robot) — instant PvP feeling with zero server cost.
- Show "Побей мой рекорд: 42 удара, рейтинг 1280".
- Abuse: ghost data is just inputs; validated by the same core; no code execution.

### 2.6.4 Profile pages
- `/p/<nickname>` static shell + API fetch: rating, record, favourite strike, last 5 results, "Challenge me" ghost link. Open Graph tags generated per profile by a Vercel function.

## 2.7 Retention design (ethical)

| Mechanic | Spec | Cost |
|---|---|---|
| Career ladder | 10 named opponents unlocked in order; each with a style and an arena (file 07) | content only |
| Daily goal | one rotating goal ("land 15 hooks", "win without taking a body shot"); reward = cosmetic | low |
| Streak | consecutive days played; shown on the menu, never punishing (no guilt copy) | low |
| Weekly ladder | rating snapshot resets weekly top-10; badge | medium (API) |
| Unlockables | robot colourways, glove skins, arenas — earned, never bought | content |
| Session recap | after each bout: effort score, best combo, one coaching tip | low |
No notifications, no dark patterns, no energy timers.

## 2.8 Monetisation (design only; no implementation without owner approval)

Launch free, no ads, no paywall. Decide later with data between:
1. Cosmetic packs (skins/arenas) via a hosted checkout.
2. Supporter pack (name on a wall, golden glove) — optional donation.
3. Sponsored arena (brand placement) — only with explicit owner decision.
Never sell power or accuracy. Criteria to start monetising: D7 retention ≥ 10 % and ≥ 1,000 weekly players. Record this in `Docs/BUSINESS.md`.

## 2.9 Launch assets (prepare, do not publish without owner approval)

| Asset | Spec | Source |
|---|---|---|
| 30 s trailer, horizontal 1920×1080 | hook in first 3 s (camera → robot punches), combos, knockdown, URL end card | capture via `debugAdvance` + frames |
| 15 s vertical 1080×1920 | same, text overlays | same |
| 5 GIFs ≤ 4 MB | hook, uppercut, duck-counter, knockdown, camera calibration | frames → ffmpeg |
| Thumbnails | 1280×720, three variants (robot closeup, knockdown, camera split-screen) | render |
| Screenshots | 1280×720 ×6, 1080×1920 ×4 | `qa` capture |
| Press kit page `/press` | logo, screenshots, facts, contact, download links, short & long description | static page |
| OG image | 1200×630 | render |
| Changelog `/changelog` | human-readable per version | generated from git tags |

## 2.10 Channels and tactics

| Channel | Format | When | Notes |
|---|---|---|---|
| Reddit (r/WebGames, r/IndieGaming, r/playmygame, r/gamedev Showoff Saturday) | post + GIF + link | after closed test | follow each sub's self-promo rules; reply to every comment in 24 h |
| Hacker News "Show HN" | tech story: "deterministic C++→WASM rollback netcode + in-browser pose tracking" | when camera ≥ target accuracy | technical honesty wins; list limitations |
| itch.io | web build page + devlog | at launch | embed iframe, enable "mobile friendly" off |
| Game portals (CrazyGames, Poki, Newgrounds) | submission | after stability proven | read each portal's camera/permissions policy first; may require SDK |
| YouTube/TikTok shorts | real people playing | week 1–4 | ask 5 friends to film themselves; subtitles |
| Telegram/Discord game communities | post + invite | launch | RU audience first (owner's language), then EN |
| Streamers/creators | personal outreach | after v1.1 | free, no payment without owner approval |
| Press (gaming blogs) | press kit | after 1,000 players | short pitch with GIF |
Each external post is approved by the owner. Draft all text in advance (RU + EN) in `Docs/Launch/`.

## 2.11 SEO and discoverability

- Landing: `<title>` ≤ 60 chars with keyword ("Бокс с роботом через камеру — играть онлайн бесплатно"), meta description ≤ 155 chars, one `h1`.
- Structured data `VideoGame` JSON-LD; OpenGraph/Twitter cards; `sitemap.xml`, `robots.txt`; canonical URL.
- Performance: LCP ≤ 2.5 s on 4G for the landing (the heavy game loads only after click).
- Content pages: `/how-to-play`, `/camera-tips` (lighting, distance), `/privacy`, `/changelog`, `/press`, `/credits`.
- Keywords (RU/EN): "бокс камера игра", "играть боксёрские перчатки через камеру", "webcam boxing game", "motion boxing browser".

## 2.12 Community and feedback

- Discord server (or GitHub Discussions) with channels: #announcements, #feedback, #bugs, #clips.
- In-game "Сообщить о проблеме" and "Предложить идею" (file 08).
- Weekly public changelog. Reply to every bug report with status within 48 h.
- "Wall of fame": top-10 weekly ladder displayed on landing.

## 2.13 Messaging guardrails

- Always label camera as "бета" until criteria in file 04 are met per strike.
- No health/medical claims; effort score is "усилие", not calories.
- No "AI coach" claims. "Бот запоминает, как ты защищаешься" is a factual description.
- Privacy line on every camera screen: "Видео остаётся на твоём устройстве".
- Do not compare with named competitors in ads.

## 2.14 Launch calendar template (fill dates after closed test)

| T-minus | Task |
|---|---|
| T-14 d | closed test starts; collect clips of real players |
| T-10 d | press kit, trailer, GIFs ready |
| T-7 d | landing final; analytics verified with real events; load test |
| T-3 d | owner approves posts; schedule |
| T-1 d | freeze; final release; rollback tag |
| T-0 | post to 2 channels; watch dashboard hourly |
| T+1 d | fix top-1 issue; reply to comments |
| T+3 d | post to next channel with improvements |
| T+7 d | retrospective; decide v1.1 scope from data |

## 2.15 Competitive intelligence tasks (cheap, do once)

1. List 10 comparable games with live URLs (owner supplies or search); note load time, onboarding steps, camera handling, monetisation.
2. Screenshot their first screen; compare with ours; list three things to copy and three to avoid.
3. Record in `Docs/BUSINESS.md` with date.

## 2.16 Naming, branding, assets

- Name: IRON ECHO (keep). Tagline from section 2.1.2 after test.
- Visual identity: dark industrial palette (graphite, ember orange, steel blue), condensed display type (Barlow Condensed in use), clean sans body (Inter). Do not introduce new brand fonts without checking licences.
- Logo/icon: existing icon in `Build/Desktop/icon.png`; make a vector version later (owner/Codex).
- Sound identity: bell, glove impact layers, crowd (procedural audio today; consider recorded CC0 samples with licence list in `/credits`).

## 2.17 Metrics dashboard spec (see file 08 for implementation)

Panels: funnel (counts and conversion), time-to-first-punch histogram, camera success rate by browser/GPU class, FPS distribution by tier, error top-10, D1/D7, share clicks, ladder size, bouts per player, difficulty win-rates by level (balance feedback), strike usage mix (which strikes players actually use).

## 2.18 Experiment plan (A/B, privacy-safe)

- Assignment: hash of anon id → bucket; stored locally.
- Candidate experiments in order: (1) headline P1–P4; (2) default level Easy vs Normal; (3) tutorial on/off; (4) camera button label ("Камера" vs "Играть своим телом"); (5) result screen primary action.
- Rule: one experiment at a time; minimum 200 visitors per arm before reading; record decisions in `Docs/BUSINESS.md`.
