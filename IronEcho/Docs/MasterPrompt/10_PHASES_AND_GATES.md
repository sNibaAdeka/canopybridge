# 10 — PHASES, TASKS, GATES (day-level plan)

Total: about 9–11 weeks with an engaged owner; can compress if recordings arrive fast, expand if camera targets are hard.
**Gate = a condition that must be true (shown by numbers) before the next phase's feature work starts.**
Never skip a gate silently; if you must, state it and why in `PROJECT_STATE.md`.

## Phase 0 — Instruments (days 1–6)

Goal: be able to measure the camera on real people and the product in the wild.

| Day | Task | Output | Proof |
|---|---|---|---|
| 1 | Recreate environment; run baseline suites; commit `env.example.sh` | baseline numbers | table in PROJECT_STATE |
| 1 | Fix stale test `check_fusion_session.mjs` (update scenario or delete) | green or removed | CI list |
| 1–2 | Telemetry client + `api/events.mjs` + migration + test | `telemetry.js`, SQL, tests | `telemetry_test.mjs` green; manual POST 204 |
| 2–3 | Collection Mode (UI + runner + protocol JSON + file writer) | `collect.js`, `collect_protocol.json` | `collect_test.mjs` green with synthetic fighter |
| 3–4 | Evaluation harness (`eval_camera.mjs`) + schema + plotting | `Tools/Eval/*` | unit tests; synthetic session yields expected recall |
| 4 | Latency test mode + internal timeline log + analysis script | `?latency=1`, `latency_from_video.py` | synthetic video test (generated frames with flash) yields known latency |
| 5 | Health page skeleton, feedback button, flags.json | `/admin/health`, UI | manual run with synthetic events |
| 5–6 | CI skeleton + `verify.py` | workflow, script | `verify.py --fast` green locally |
| 6 | Owner scripts (file 11) polished; build and release 1.7.0-alpha with Collection Mode | release | live site shows version; owner can open `?collect=1` |

**Gate 0**: Owner (or you with a synthetic run) can record a full condition (12 min), the file loads in the evaluator, the table is produced with no manual steps; telemetry events arrive in the DB (needs owner's env vars).

## Phase 1 — First truth (days 7–14; mostly waiting on people)

| Task | Owner involvement | Output |
|---|---|---|
| Owner records W0 (3 conditions) | 40 min | 3 files |
| First accuracy table → `CAMERA_ACCURACY.md` | none | ranked failures |
| Fix tool bugs found by real use (UI, timing, file size) | feedback | 1.7.1 |
| Owner recruits W1 (3–4 people) | recruiting + 15 min each | 9–12 files |
| Decision workshop (chat): per-strike ship/beta/keyboard-only for v1 | 15 min | recorded decision |
| Golden set v0 chosen | none | `Tests/Web/golden/` |

**Gate 1**: table exists on ≥ 4 people, ≥ 2 camera models; decision per strike recorded; golden test in CI.

## Phase 2 — Camera quality loop (weeks 3–5)

Iterations of 2–3 days each (see file 04 §4.6). Typical order:
1. Capture quality experiment (resolution/FPS/exposure) — decide.
2. Image-space features for straights (hand scale / foreshortening).
3. Hook/uppercut/elbow separation using image-space arcs and angles.
4. Per-part filtering and threshold fitting.
5. Calibration redesign + quality score + assist levels.
6. Pre-wind-up visual intent (latency hiding).
7. Block/slip/duck stability.
8. Knee/kick (legs visible only) — likely beta.
9. Optional: learned classifier if data volume allows.
Each iteration: before/after table in the commit; held-out check; golden green.

**Gate 2** (one of):
- (a) Targets in file 04 §4.7 met on ≥ 8 held-out participants for straights, hooks, uppercuts, block/slip/duck; others shipped/beta/keyboard-only per matrix.
- (b) Three consecutive iterations without ≥ 0.5 pt gain on the worst cell → the owner signs the fallback (those strikes keyboard-only or beta); proceed.

## Phase 3 — Speed and performance (weeks 4–6, parallel with Phase 2 after day 3)

| Task | Output | Proof |
|---|---|---|
| Measure load breakdown; split Phase A/B/C | smaller shell | transfer ≤ 6 MB to menu |
| Service worker + versioned caching | repeat ≤ 2 s | Playwright reload test |
| Tier governor (high/low/minimum) with telemetry | `fps_sample` | traces |
| GPU-vs-CPU pose probe | decision table | perf log |
| Allocation cleanup in hot loops | lower p99 frame | trace |
| Latency pre-wind-up (with Phase 2.6) | −40 ms | flash test |
| 20-bout soak | no growth | CI |
| Device tests (owner + friends) D1–D4 | results table | PERFORMANCE_LOG |

**Gate 3**: ≥ 40 fps no camera / ≥ 30 with camera on the weakest laptop available (or documented floor and automatic tier); latency p50 ≤ 150 ms, p95 ≤ 250 ms measured on ≥ 2 machines (or a signed fallback: "camera = beta, keyboard recommended" with numbers).

## Phase 4 — Experience (weeks 6–8)

| Task | Output | Proof |
|---|---|---|
| UX rebuild: menu, tutorial, camera onboarding, results (file 03) | new screens | scripted flows + 5 strangers |
| Localization RU/EN | strings files, `t()` | key parity check; screenshot |
| Feel layers (hit-stop, shake, audio) with settings | effects | A/B with 5 testers |
| Career (≥ 5 opponents), cosmetics, daily goals, stats | `career.js` | balance table |
| Training room: combo trainer | feature | camera feedback test |
| Clip recorder, result card, ghost link | share features | Chrome/Edge tests |
| Accessibility pass | fixes | axe + keyboard walkthrough |
| PWA manifest + install | installable | Lighthouse PWA checks |

**Gate 4**: 5 first-time players reach first punch ≤ 45 s without help (4/5), no one asks "how do I hit?"; all share features work; reduced-motion honoured.

## Phase 5 — Platform and reliability (weeks 8–9)

| Task | Output | Proof |
|---|---|---|
| Rating live + leaderboard + weekly + profile | API+UI | e2e on live site |
| Feedback + trace upload (consent) | rows in DB | manual |
| Online duel acceptance (5 pairs) or hide | decision | telemetry |
| Privacy/terms/credits/changelog/press pages | pages | owner review |
| CI nightly browser suite; CSP and security checklist | green CI | report |
| Browser matrix run | `BROWSER_MATRIX.md` | filled table |
| Windows app smoke on real Windows | notes | owner/tester |
| RUNBOOK, ARCHITECTURE, BUSINESS docs | docs | review |

**Gate 5**: all suites green in CI; security checklist ticked; legal pages approved by owner; rating live.

## Phase 6 — Closed test (week 9–10, features frozen)

Setup: 10–15 players (5+ never played), link + Discord/Telegram group, feedback form, health page open.
Daily loop (30–60 min):
1. Read health summary + feedback.
2. Pick top-2 problems; reproduce; fix; test; release patch.
3. Reply to testers.
4. Update `KNOWN_ISSUES.md`.
Mid-week: watch 3 players live (screen share), no help.
Exit criteria (measured, not guessed):
- ≥ 70 % of starters finish the first bout.
- ≥ 80 % of camera tries calibrate (or camera marked beta-hidden).
- ≥ 50 % of finishers play a second bout.
- Median time-to-first-punch ≤ 45 s.
- 0 S0, ≤ 2 S1 open.
- p50 FPS ≥ 40 (keys) and ≥ 30 (camera) across testers.

**Gate 6**: all criteria met, or the owner explicitly accepts specific misses (written).

## Phase 7 — Public launch (week 11)

| T | Task |
|---|---|
| −7 d | Press kit, trailer, GIFs, landing final, SEO tags, OG images (file 02) |
| −5 d | Load test of API (simulate 200 concurrent submissions; verify limits); Vercel/Supabase quota review with owner |
| −3 d | Owner approves post texts RU/EN; schedule |
| −1 d | Final release, tag, rollback point, freeze |
| 0 | Post to 2 channels; hourly watch (health page); reply to all comments |
| +1 d | Fix top issue; thank-you post |
| +3 d | Next channel; incorporate feedback |
| +7 d | Retrospective: funnel vs hypotheses; decide v1.1 scope from data |

Launch checklist (all ticked): version on site = repo; `/api/ratings` OK; events flowing; backups/export tested; privacy page live; changelog; Discord invite; `KNOWN_ISSUES`; rollback tested once on a staging deployment; owner has the admin token and the runbook.

## Phase 8 — Growth and hardening (ongoing)

Weekly cadence:
- Monday: metrics review → choose 3 improvements.
- Tue–Thu: build/test; ship on Thursday.
- Friday: content (new opponent/arena/colourway), community post.
Themes by month: M1 stability & onboarding fixes; M2 camera accuracy v2 from the larger dataset (ML classifier decision) and more strikes via camera; M3 social (friends, clips hosted, tournaments) if retention justifies; M4 platform expansion (Steam via Unreal or Tauri, mobile camera) — decision by data.

## Cross-phase management

### Risk register (review weekly)

| ID | Risk | Likelihood | Impact | Trigger | Response |
|---|---|---|---|---|---|
| R1 | Camera targets unreachable | M | H | Gate 2 stalls | ship camera strikes subset + keyboard; "beta" labels |
| R2 | Not enough participants | M | H | < 4 by day 14 | use closed-test traces (F4/free-fight); pay in cosmetics; owner posts a call |
| R3 | Performance floor too high for target audience | M | M | D1 < 30 fps | minimum tier; recommend Chrome on discrete GPU; hide camera on weak GPU |
| R4 | Vercel/Supabase limits | M | M | quota warnings | caching, split bundles, upgrade plan (owner) |
| R5 | Bandwidth costs from 8 MB first load | M | M | traffic spike | Phase A/B/C split, CDN, SW |
| R6 | Safari/Firefox camera issues | H | M | tests fail | declare Chrome/Edge, keyboard works elsewhere |
| R7 | Security/abuse (ladder cheating) | L | M | outliers | server re-sim exists; flags; ban tool |
| R8 | Scope creep | H | H | new ideas | rule 21: no features before launch gate |
| R9 | Owner availability | M | H | silence | batch requests; show value each report; keep gates short |
| R10 | Repo bloat from release binaries | H | L | clone > 500 MB | move to CI builds (file 06 §6.7) |
| R11 | Legal/privacy issues | L | H | complaint | policy, consent, deletion flow; lawyer review before monetising |
| R12 | Codex/art dependency | L | L | web independent | keep web self-contained |

### Reporting rhythm
- After each task: 6–12 lines (file 00 §0.7).
- Every Friday: weekly summary to the owner: done / numbers / next week / decisions needed.
- At each gate: a one-page gate report (criteria, measured values, pass/fail, owner sign-off).

### Decision log
Keep `Docs/DECISIONS.md`: date, decision, options considered, data, who decided. Examples: "hooks via camera = beta", "second camera hidden", "default control = keyboard".

### Budget (money) — default zero
No spend unless the owner approves. Potential spends to propose (with price ranges verified at the time): domain name, code-signing certificate for Windows, Vercel Pro (commercial use), Supabase Pro, TURN relay. Present cost/benefit, wait for approval.
