# 09 — QA, CI, RELEASE ENGINEERING

## 9.1 Rebuilding the test environment (the cloud scratchpad is ephemeral)

The previous sessions used a scratchpad `webenv.sh`. It is not in the repository. Recreate it (and commit a version of it as `Tools/Build/env.example.sh` with placeholders only).

```bash
# Tools/Build/env.example.sh — source this, adjusting SP to your scratch directory
export SP=<session scratchpad>                         # e.g. /tmp/claude-.../scratchpad
export IRONECHO_WEBDEPS=$SP/webdeps/node_modules        # three, mediapipe, peerjs, qrcode, binaryen, gltfpack, playwright?, peer
export IRONECHO_BINARYEN=$IRONECHO_WEBDEPS/binaryen/bin
export IRONECHO_GLTFPACK=$IRONECHO_WEBDEPS/gltfpack/cli.js
export NODE_PATH=/opt/node-tools/node_modules:$IRONECHO_WEBDEPS   # playwright lives in /opt/node-tools in the cloud image
export PYTHONPATH=$SP/zigpkg                             # python-zig / ziglang package for wasm compile
```
Install steps (network permitting; the cloud proxy allows npm/pypi):
```
mkdir -p $SP/webdeps && cd $SP/webdeps && npm init -y >/dev/null
npm i three@0.170.0 @mediapipe/tasks-vision peerjs@1.5.4 peer@1.0.2 qrcode-generator binaryen gltfpack
python3 -m venv $SP/venv && $SP/venv/bin/pip install mediapipe opencv-python numpy matplotlib pytest
```
Model files: `pose_landmarker_{lite,full,heavy}.task` (from the vendored `Tools/Build/Web/...` or `storage.googleapis.com/mediapipe-models/...` which is reachable from the cloud).
Chromium for Playwright is preinstalled (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`); never run `playwright install`.
GPU: none; use SwiftShader flags: `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`; fake camera: `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`.

## 9.2 Test pyramid

```
                      human trials (owner, testers)      ← few, expensive, irreplaceable
                   browser e2e (qa.js, camera2_e2e.js, online_e2e.js, rating_e2e.js)
                golden real-data replay (golden_test.mjs)   ← NEW, the camera truth
             node suites (pose_strikes, trace, fusion, rollback, rating, telemetry, collect, eval)
          core C++ tests (127) + native==wasm==wasm2js parity + tracker pytest (37)
```
Rule: a bug found by a higher layer gets a regression test at the lowest layer that can express it.

## 9.3 What each suite protects

| Suite | Protects against | Run time (cloud) |
|---|---|---|
| Core C++ | rules regressions | ~10 s |
| Parity (bridge_check, check_core) | native/WASM drift | ~30 s |
| Tracker pytest | Python tracker | ~30 s |
| `pose_strikes_test.mjs` | detector logic regressions on synthetic body | ~2 min |
| `golden_test.mjs` (new) | real-data accuracy regressions | ~30 s |
| `trace_test.mjs`, `collect_test.mjs` (new), `eval_test.mjs` (new) | recording/eval tooling | ~20 s |
| `check_fusion.mjs` | fusion maths | ~10 s |
| `rollback_net.mjs` | netcode determinism under latency | ~1 min |
| `rating_test.mjs`, `rating_store_test.mjs`, `telemetry_test.mjs` (new) | server logic | ~10 s |
| `qa.js` | full-browser flows, UI, animation continuity, memory soak | ~15 min (SwiftShader) |
| `camera2_e2e.js` | second camera, F4 | ~10 min |
| `online_e2e.js` | two pages duel | ~5 min |
| `rating_e2e.js` | rating UI vs real server code | ~5 min |
| `release_api_smoke.mjs` + release site smoke | built artifact works | ~2 min |

## 9.4 One-command verification (create `Tools/Build/verify.py`)

```
python Tools/Build/verify.py --fast      # core, parity, tracker, node suites, ownership (≈5 min)
python Tools/Build/verify.py --browser   # + qa.js, camera2_e2e.js, rating_e2e.js (≈35 min)
python Tools/Build/verify.py --release   # + build chain + smoke on the release folder
```
It prints a table (suite, result, time), exits non-zero on any failure, and writes `Build/verify_report.md` for pasting into commit messages/PROJECT_STATE.

## 9.5 CI (GitHub Actions) — `.github/workflows/ci.yml` skeleton

```yaml
name: ci
on:
  push: { branches: [claude/wizardly-pascal-e4ggdg] }
  pull_request:
  schedule: [{ cron: '0 3 * * *' }]    # nightly browser suites
jobs:
  fast:
    runs-on: ubuntu-24.04
    defaults: { run: { working-directory: IronEcho } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: sudo apt-get update && sudo apt-get install -y cmake g++ ninja-build
      - run: cmake -S Tests/CoreRules -B Build/CoreRulesTests && cmake --build Build/CoreRulesTests -j && Build/CoreRulesTests/CoreRulesTests
      - uses: actions/setup-python@v5
        with: { python-version: '3.12' }
      - run: pip install -r Tracking/requirements.txt pytest && (cd Tracking && python -m pytest -q)
      - run: node Tests/Web/pose_strikes_test.mjs
      - run: node Tests/Web/trace_test.mjs
      - run: node Tests/Web/golden_test.mjs
      - run: node Tools/Build/Web/check/check_fusion.mjs
      - run: node Tests/Web/rollback_net.mjs   # needs Build/Web/core: run build_web.py core first (cache)
      - run: python Tools/Build/ownership.py verify
  browser:
    if: github.event_name == 'schedule' || contains(github.event.head_commit.message, '[browser]')
    runs-on: ubuntu-24.04
    timeout-minutes: 90
    steps:
      - uses: actions/checkout@v4
      - run: npm i playwright peer && npx playwright install --with-deps chromium
      - run: python Tools/Build/Web/build_web.py site
      - run: node Tests/Web/qa.js
      - run: node Tests/Web/camera2_e2e.js
  perf:
    runs-on: ubuntu-24.04
    steps:
      - run: node Tests/Web/perf_budget_test.mjs
```
Notes:
- The repo has the work branch as production; CI must not deploy without owner approval. Add an optional `deploy` job later using Vercel CLI with a token the owner stores as a GitHub secret (`VERCEL_TOKEN`).
- Cache `Build/Web/core` and npm to speed jobs.
- The AI cannot see GitHub Actions results through the current tools if the GitHub connector is down; read the status via MCP when available, else ask the owner for a screenshot.

## 9.6 Browser matrix and smoke charter

Per browser (Chrome, Edge, Firefox, Safari), 10-minute smoke (owner/tester or Playwright where possible):
1. Landing loads, video plays muted, CTA works.
2. Menu loads ≤ 8 s; `В РИНГ` starts a bout; keyboard controls work; sound plays after first click.
3. Pause/resume; fullscreen.
4. Camera flow (permission → calibration → one bout) — Chrome/Edge required; Firefox/Safari: record behaviour, mark limitations on the page.
5. Rating: join with nickname, finish a bout, row appears.
6. Online duel: create room, second browser joins, play 1 round.
7. Resize window 1280×720 → 800×600 → phone; no overlap.
8. Console has no errors; network has no 4xx/5xx (except known).
Record results in `Docs/Testing/BROWSER_MATRIX.md` (table with date/version/pass/notes).

## 9.7 Manual test charters (human trials) — keep `Docs/Testing/HUMAN_TRIALS.md` as the source

Add/update:
- **T12 First-time player** (strangers): stopwatch from page open to first punch; think-aloud; quotes.
- **T13 Collection Mode** (owner): 12 min per condition; confirm tool usability.
- **T14 Latency flash test**: 20 punches, video analysis.
- **T15 Weak laptop**: FPS/tier behaviour, camera on; fan/heat notes.
- **T16 Online pair**: 5 bouts; desync/lag notes.
- **T17 Mobile touch**: controls comfort.
Each charter has: purpose, setup, steps, what to record, pass/fail numbers.

## 9.8 Defect process

- Severity: S0 data loss/security/unplayable for everyone; S1 core flow broken for a browser class; S2 degraded experience; S3 cosmetic.
- SLA during launch weeks: S0 same day, S1 within 24 h, S2 batch weekly, S3 backlog.
- Every fix: regression test or a recorded reason why not; link the telemetry/report that revealed it in the commit body.
- Keep `Docs/KNOWN_ISSUES.md` for the public list ("Safari camera limited", "Windows SmartScreen warning").

## 9.9 Release engineering

### 9.9.1 Versioning
- Semantic: `MAJOR.MINOR.PATCH`. Demo = `1.7.0`? (increment from 1.6.2); public launch = `1.8.0` or `2.0.0` (owner decides). Every user-visible change bumps PATCH at least.
- `GAME_VERSION` in `site_build.py`; `/version.json` generated at build: `{version, commit, date}`; footer shows it.
- Tag releases: `git tag release-X.Y.Z` (local + push tags only if the owner allows; otherwise record the commit hash in `CHANGELOG.md`).

### 9.9.2 The release script `Tools/Build/release_all.py` (create)

Steps (stop on first failure):
1. Preconditions: clean tree; branch correct; version bumped; `CHANGELOG.md` entry exists.
2. `verify.py --fast`.
3. Build core + parity: `build_web.py core` (+ `check`).
4. Build site with `IRONECHO_DOWNLOAD_URL`: `build_web.py site`.
5. `verify.py --browser` (unless `--skip-browser` with explicit reason in the commit).
6. Build desktop: `build_desktop.py`.
7. Build public with frames: `IRONECHO_GAMEPLAY_FRAMES=<dir> build_web.py public` (fail if frames dir missing and the previous media exists — never silently change media).
8. `build_web.py release`.
9. Smoke: `release_api_smoke.mjs`, release site smoke (landing links, video present, download button, game starts bout).
10. Compare release folder diff summary (files changed, sizes) — abort if media deleted unexpectedly.
11. Print the commit message template with verified numbers; do **not** commit automatically unless `--commit`.

### 9.9.3 Post-release checks
1. Push; wait for Vercel (owner confirms or the AI polls the site if network allows).
2. Open the live site: version string equals; load a bout; check `/api/ratings`; check `/api/events` accepted (health page shows `page_open`).
3. If anything is wrong: roll back (9.9.4).
4. Announce in changelog.

### 9.9.4 Rollback
- The previous good release commit hash is recorded in `CHANGELOG.md`.
- Procedure: `git revert <release commit>` (preferred; keeps history) then push → Vercel redeploys; or Vercel dashboard → Deployments → Promote the previous deployment (owner).
- After rollback write an incident note in `Docs/Incidents/YYYY-MM-DD.md`: what broke, detection, time to fix, prevention test.

### 9.9.5 Feature flags
- `flags.json` served next to the app: `{ "career": true, "online": true, "secondCamera": false, "collectMode": true, "tutorial": true }`; URL overrides `?flag=name:on`.
- Use flags to ship dark and enable gradually; remove flags after two stable releases.

### 9.9.6 Windows app
- Built by `build_desktop.py` (Go). Unsigned `.exe` → SmartScreen shows a warning; provide a "Как запустить" note. Code-signing certificate costs money → ask the owner before pursuing.
- Smoke on a real Windows machine is required before announcing the download: install, run offline, camera, update path. Owner or tester script in file 11.
- Auto-update: not in v1; the site shows "Доступна новая версия" when `/version.json` differs.

## 9.10 Security checklist (before launch)

- [ ] No secrets in repo/bundles (grep for `SUPABASE_SERVICE_KEY`, `sb_secret`, JWT patterns).
- [ ] CORS limited to the site origin on APIs that mutate.
- [ ] Input validation on all API bodies (schemas), size limits, JSON parse errors handled.
- [ ] Rate limiting on events, ratings, feedback, trace upload.
- [ ] Output escaping for nicknames/feedback in the admin pages and profile pages (text nodes only).
- [ ] Content-Security-Policy header: scripts from self only (+ blob for workers); `connect-src` self + broker host; `media-src` self + blob; no inline eval (check Three/MediaPipe needs `wasm-unsafe-eval`).
- [ ] `Permissions-Policy: camera=(self)` (exists), microphone denied.
- [ ] Service worker scope limited; no caching of API responses with PII.
- [ ] Dependencies pinned; `npm audit` on vendored libs recorded.
- [ ] Supabase RLS enabled on all tables; only the service key writes; no anon policies.
- [ ] Admin tokens compared in constant time; tokens never in logs.

## 9.11 Accessibility and compliance checks (automatable bits)

- Axe-core via Playwright on landing, menu, results (violations ≤ 0 serious).
- Contrast script on CSS tokens.
- Keyboard-only walkthrough scripted in Playwright (Tab order reaches primary buttons).

## 9.12 Documentation upkeep (part of "done")

After each phase update: `PROJECT_STATE.md` (what is verified; blockers), `CHANGELOG.md`, `HUMAN_TRIALS.md`, `CAMERA_ACCURACY.md`, `PERFORMANCE_LOG.md`, `BROWSER_MATRIX.md`, this folder if the plan changed, handoffs if the contract changed.
