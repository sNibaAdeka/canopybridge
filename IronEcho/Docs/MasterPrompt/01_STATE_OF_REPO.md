# 01 — STATE OF THE REPOSITORY (verified inventory, version 1.6.2)

Everything below was true at the end of the last working session (2026-10-17). Treat it as a baseline:
re-verify the numbers with the commands in section 1.9 before relying on them.

## 1.1 Top-level layout

```
canopybridge/                 repository root (CanopyBridge archive: DO NOT TOUCH)
  README.md, canopybridge-reference.png
  IronEcho/                   the project
    CLAUDE.md, AGENTS.md      generated rules (ownership.json)
    PROJECT_STATE.md          living status; owner reads it
    Source/IronEchoRules/     C++20 rules core (pure, no Unreal)
    Source/IronEcho/          Unreal game module (never compiled in the cloud)
    Tests/CoreRules/          C++ tests (127)
    Tests/Web/                browser and node tests
    Tracking/                 Python tracker (separate process for Unreal), tests (37)
    Tools/Build/Web/          web build chain, site sources, release folder
    Tools/Build/Desktop/      Go launcher + Windows zip
    Tools/Build/ownership.py  file ownership checker
    Docs/                     contracts, handoffs, testing, plans, this folder
    Content/, ArtSource/      art (Codex)
    Config/, IronEcho.uproject  Unreal config
    Build/                    generated, gitignored
```

## 1.2 Rules core (`Source/IronEchoRules`)

- C++20, deterministic, fixed tick 120 Hz (`kTickRate`), no floating point nondeterminism across targets (verified by hash).
- Compiled three ways and compared bit for bit: native, WebAssembly, wasm2js (`Tools/Build/Web/check_core.mjs`, `bridge_check.cpp`).
- Attack kinds: Punch(straight), Kick, Elbow, Knee, Hook(4), Uppercut(5).
- Masks from camera/keyboard: `punchMask` bits 1/2 straight L/R head, 4/8 body, 16/32 elbow, 64/128 hook, 256/512 body hook, 1024/2048 uppercut;
  `kickMask` 1/2 mid kick L/R, 4/8 low kick, 16/32 knee.
- Defence: block, slip (lateral lean with cooldown), duck (head drop 0.30 m), footwork (forward/back/circle).
- Hit geometry: head offset across (slip) and down (duck); hook sweeps across; uppercut rises, half passes through guard, punishes duck.
- Close range: elbow/knee lunge (burst 2.6 m/s, up to 0.34 m beyond reach, +0.10 s recovery).
- Match flow: rounds, knockdown with count, TKO, judges' scoring, pause with ready-check and countdown.
- Bot: three levels, adaptive (reads how the player defends and shifts attacks), footwork, telegraphs.
- Balance tests: `Tests/Tools/Balance` with a scripted human model (profiles casual/average/skilled/spammer).
  Last numbers (average human, 384 bouts): Normal 66 % win for the human, Hard 12.8 %. (Easy ≥ 90 %.)
  **Hypothesis to revalidate with real players:** Easy 70 %+, Normal 35–50 %, Hard 10–20 % is the desired band; current Normal is easier than desired.

## 1.3 Web game (`Tools/Build/Web/site/src`)

| File | Role | Lines (approx) |
|---|---|---|
| `main.js` | game loop, menu wiring, input arbitration, rating UI hooks, F3/F4 | 1300 |
| `pose.js` | camera: `PoseProcessor` (detectors, calibration), `CameraInput` (capture, UI, second camera), `TraceRecorder` | 1900 |
| `poseworker.js` | MediaPipe PoseLandmarker in a Web Worker (GPU delegate, CPU fallback) | 160 |
| `fusion.js` | two-camera fusion (rotation fit, time offset, optimal merge, blend, drop) | 380 |
| `camlink.js` | PeerJS room for phone cameras | 80 |
| `anim.js`, `rig.js` | procedural animation, two-bone IK for 2 robots | 640 + 320 |
| `arena.js` | Three.js scene, ring, lights, venue | 310 |
| `core.js` | bridge to WASM core, snapshot/events | 155 |
| `net.js` | rollback netcode over WebRTC (PeerJS for introduction only) | 510 |
| `rating.js`, `ratingrules.js`, `replay.js` | solo Elo client, recording IER2 | 160+45+130 |
| `hud.js`, `audio.js`, `fx.js`, `input.js` | HUD, procedural audio, particles, keyboard/touch | 170, 185, 120, 130 |

Key facts:
- **Camera input** in the browser: `getUserMedia` 640×480 @ up to 60 fps → worker → MediaPipe PoseLandmarker (`numPoses:1`, thresholds 0.35/0.3/0.3) →
  world landmarks (metres, hip-centred) + image landmarks → `PoseProcessor` → `punchMask/kickMask/lean/block/duck` → core.
- **Calibration**: neutral stance, block pose, slip L/R, punch step (2 reps per hand) → personal thresholds (45 % of measured speed, 60 % of heights).
- **Loss handling**: hold 0.35 s; hips unseen → origin fallback; camera exposure fallback 60→30 fps; light measurement (32×24 thumbnail).
- **Second camera**: non-blocking; blend 0.6 s; auto-drop (15 s no match, 6 s lost, <8 fps, main camera slowed ≥40 %); hidden in demo (`?lab=1`).
- **Diagnostics**: F3 overlay (fps, ms, delegate, second-camera state, light), F4 saves `ironecho-trace-*.json.gz` (calibration tape + last 25 s).
- **Graphics**: tiers `high`/`low`; adaptive pixel ratio 0.6–1.0; auto step to `low` if camera on and fps<40 at min scale.
- **Online**: deterministic rollback; input = 11 fields; room code or link; PeerJS public broker only for introduction (no TURN relay: strict NATs can fail).
- **Rating**: client records the bout (IER2 22-byte rows), server re-simulates on the same WASM core and applies Elo; separate ladders `keys` and `camera`.

## 1.4 Build chain

```
python Tools/Build/Web/build_web.py core        # WASM core (+ parity check)
IRONECHO_DOWNLOAD_URL=/download/IronEcho-Windows.zip python Tools/Build/Web/build_web.py site   # Build/Web/standalone, IronEcho-*.html
python Tools/Build/Desktop/build_desktop.py     # Build/Desktop/IronEcho.exe + IronEcho-Windows.zip (Go cross-compile)
IRONECHO_GAMEPLAY_FRAMES=<frames dir> python Tools/Build/Web/build_web.py public   # landing + media + download
python Tools/Build/Web/build_web.py release     # Tools/Build/Web/release (tracked; Vercel serves this)
```
- Environment variables used in the cloud: `IRONECHO_BINARYEN`, `IRONECHO_WEBDEPS`, `IRONECHO_GLTFPACK`, `NODE_PATH` (playwright), `PYTHONPATH` (zig package).
  They were defined in a scratchpad `webenv.sh` that is **not** in the repository — recreate it (section 9.1).
- `GAME_VERSION` lives in `Tools/Build/Web/site_build.py` (currently `1.6.2`), shown in the menu (`.ver`) and the Windows app.
- Release folder content: `index.html` (landing), `play/index.html` (single-file game 7–8 MB), `download/IronEcho-Windows.zip` (~51 MB), `media/*`, `api/*` (rating server), `vercel.json`, `_headers`.
- Pitfall (already hit once): running `release` without `public` first, or `public` without the gameplay frames, silently drops/changes media.
  The frames used previously are in the old scratchpad (`motion/video3`, 240 jpgs); regenerate with the Blender/Chromium capture tools if lost.

## 1.5 Hosting and services

- Vercel project serves `IronEcho/Tools/Build/Web/release` from the branch (production branch is the work branch — `main` holds only the CanopyBridge archive). **Not verifiable from the cloud** (Vercel connector returned 403 for team scope `snibaadekas-projects`). After each release ask the owner to open the site and read "версия X.Y.Z".
- Supabase project `iron-echo` (id `tboqtclodnlzqcllaaij`): schema applied; ratings API ready; **needs `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` in Vercel env**.
- GitHub repo `sNibaAdeka/canopybridge`; no PRs; `main` is the archive.

## 1.6 Tests (counts at end of last session)

| Suite | Command (from `IronEcho/`) | Result |
|---|---|---|
| Core rules | `cmake -S Tests/CoreRules -B Build/CoreRulesTests && cmake --build Build/CoreRulesTests && Build/CoreRulesTests/CoreRulesTests` | 127 / 0 failed |
| Tracker (Python) | `cd Tracking && python -m pytest -q` | 37 passed |
| Camera strikes (synthetic) | `node Tests/Web/pose_strikes_test.mjs` | 112/112, 10 fault sets |
| Trace round trip | `node Tests/Web/trace_test.mjs` | 13/13 |
| Fusion math | `node Tools/Build/Web/check/check_fusion.mjs` | 13 checks ok |
| JS vs Python pose parity | `node Tools/Build/Web/check/check_pose.mjs <ref.json>` | identical |
| Rollback netcode | `node Tests/Web/rollback_net.mjs` | 32/32 |
| Rating logic | `node Tests/Web/rating_test.mjs` / `rating_store_test.mjs` | 36 / 27 |
| Browser QA | `node Tests/Web/qa.js` (needs playwright, `IRONECHO_SYNTHETIC`) | 49/49 |
| Second camera e2e | `node Tests/Web/camera2_e2e.js` (needs playwright + peer) | 27/27 |
| Online e2e | `node Tests/Web/online_e2e.js` | 16/16 (earlier) |
| Rating e2e | `node Tests/Web/rating_e2e.js` | 18/18 (earlier) |
| Release API smoke | `node Tests/Web/release_api_smoke.mjs` | 11/11 |
| Stale (red before and after) | `check_fusion_session.mjs` | old scenario, kicks 0/4 — fix or delete |

## 1.7 Known gaps (be honest about these in every plan)

1. **No real human data** beyond owner's informal trials. All detector thresholds are tuned on `Tests/Web/pose_sim.mjs` (synthetic).
2. **No latency measurement** on a real device. Budget in file 06 is a model, not a measurement.
3. **FPS on real GPUs unknown.** SwiftShader numbers only.
4. **Second camera** unverified with real phones/bodies; hidden from the demo.
5. **Unreal layer** (flags for hooks/uppercuts/duck, `IronEchoTypes.h` MINOR 3) uncompiled; Unreal keyboard lacks hooks/uppercuts/duck; handoffs 012 and 013 to Codex are open.
6. **Windows app** (`IronEcho.exe`) never run on real Windows; only under Wine.
7. **Live site version** not verifiable from the cloud.
8. **Telemetry absent.** Nothing tells us how people actually use the game.
9. **Onboarding heavy:** first screen has many options; no tutorial.
10. **Mobile/touch** acceptable but not tuned; camera on phones not supported.
11. **Task #41** (rating system) is "in progress" only because storage is not connected.
12. **Localization**: Russian only, strings hard-coded in templates and JS.

## 1.8 Facts about the owner's reports (the real-world signal so far)

- "Camera constantly does not see me." → fixed hip requirement, added light tips; **unverified**.
- "Strikes glitch, elbows and knees not working." → lunge in core and detectors; **unverified with a human**.
- "Second camera does not calibrate and only adds lag." → made non-blocking and auto-dropping; **unverified with a phone**.
- "Game still feels weak." → this document set.

## 1.9 Commands to re-verify the baseline (copy/paste)

```
cd IronEcho
cmake -S Tests/CoreRules -B Build/CoreRulesTests && cmake --build Build/CoreRulesTests -j8 && Build/CoreRulesTests/CoreRulesTests | tail -2
(cd Tracking && python -m pytest -q | tail -2)
node Tests/Web/pose_strikes_test.mjs | tail -1
node Tests/Web/trace_test.mjs | tail -1
(cd Tools/Build/Web/check && node check_fusion.mjs | tail -1)
python Tools/Build/ownership.py verify
git status --short; git log --oneline | head -5
```

## 1.10 Files you will create (new, expected paths)

```
IronEcho/Tools/Eval/eval_camera.mjs            evaluation harness (file 04)
IronEcho/Tools/Eval/README.md
IronEcho/Tests/Web/golden/*.json.gz            golden traces
IronEcho/Docs/Testing/CAMERA_ACCURACY.md       generated table
IronEcho/Docs/Testing/ONBOARDING_TESTS.md      onboarding timings
IronEcho/Docs/ARCHITECTURE.md, RUNBOOK.md, BUSINESS.md, PRIVACY_DRAFT.md
IronEcho/Tools/Build/Web/site/src/telemetry.js, collect.js, tutorial.js, strings.*.json, share.js, career.js
IronEcho/Tools/Build/Web/api/events.mjs, health.mjs, profile.mjs
IronEcho/Tools/Build/release_all.py
IronEcho/.github/workflows/ci.yml (path relative to repo root: .github/workflows)
```
(The ownership checker must accept each new path as Claude's; if not, ask the owner before creating.)
