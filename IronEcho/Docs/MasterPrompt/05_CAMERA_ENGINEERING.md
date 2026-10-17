# 05 — CAMERA ENGINEERING (how the pipeline works and how to improve it)

Audience: the AI engineer changing `Tools/Build/Web/site/src/pose.js`, `poseworker.js`, `fusion.js`, `main.js` camera parts.
Rule: **change one thing, measure on real data (file 04), keep the golden set green.**

## 5.1 Pipeline overview (as implemented in 1.6.2)

```
getUserMedia (640x480 @ ≤60 fps)
   └─ <video> ──requestVideoFrameCallback──▶ CameraInput._process()
        └─ PoseDetector.submit(video, captureTime) ──▶ Web Worker (poseworker.js)
              MediaPipe PoseLandmarker (VIDEO mode, GPU delegate, CPU fallback, numPoses=1,
              minPoseDetectionConfidence 0.35, minPosePresenceConfidence 0.3, minTrackingConfidence 0.3)
        ◀── { landmarks (image, normalised), worldLandmarks (metres, hip-centred), visibility } 
   └─ CameraInput._onResult → _feed(world, t, image)
        ├─ TraceRecorder.add (F4 recording)
        └─ PoseProcessor.process(world, t, image)
              bodyPose(): axes → game frame X forward, Y right, Z up  (p = [-z, -x, -y])
              calibration state machine (neutral → block → slip L → slip R → punch cal)
              OneEuro smoothing for lean
              detectors: PunchDetector×2, HandStrikeDetector×2 (hook/uppercut), ElbowDetector×2, KickDetector×2 (+knee-only),
                         duck (image-based, world fallback), block, lean
              output: status, lean, leanForward, block, duck, punchMask, kickMask, confidence   (poll())
   └─ main.js currentInput() → core.frame(dt, input)
```
Second camera (hidden by default): phone WebRTC stream → `PoseTap` (own worker) → `PoseFusion` → same `PoseProcessor`.

## 5.2 Coordinate systems and why depth is the weak axis

- MediaPipe **world landmarks**: metres, origin at the hip midpoint, x right, y down, z toward the camera (negative = closer). `bodyPose` converts to game axes: forward = `-z`.
- A single RGB camera infers depth from learned priors; error is roughly 3–4× the lateral error. A punch **toward** the camera is mostly motion in z, hence the weakest signal.
- **Image landmarks** (x,y normalised to the frame) are much more precise laterally and vertically. Their z is relative.
- Strategy: use world depth where fine, but add independent evidence for forward strikes from image-space geometry:
  - **Hand scale growth**: the apparent size of the hand/forearm in the image increases as it approaches the camera. Proxy: distance in image between wrist (15/16) and elbow (13/14), normalised by shoulder width in the image, and the index/pinky/thumb spread (19/20, 17/18, 21/22) if visible.
  - **Wrist y relative to shoulder** (image): jabs usually rise slightly; useful with scale growth.
  - **Occlusion cues**: the forearm foreshortens (elbow–wrist image distance *decreases* while the real arm extends toward the camera). Track `foreshortening = imageDist(elbow,wrist) / (armLength * imageScale)`; a straight punch at the camera shows rapid decrease then increase.

## 5.3 Existing detectors — what they do, where to look

| Detector | Class / function | Signal | Key constants (see top of `pose.js`) |
|---|---|---|---|
| Straight punch | `PunchDetector` | wrist forward speed (extVel/fwdVel), height above guard, progress along arm | `PUNCH_CFG`, `PUNCH_CAL` (share 0.45, ampShare 0.6, perSide 2) |
| Hook / uppercut | `HandStrikeDetector` | wrist lateral sweep vs shoulder, vertical rise, elbow bend | `STRIKE_CFG` |
| Elbow | `ElbowDetector` + `pendingElbow` confirmation (open ≤ 0.62, asym ≥ 0.05) | elbow forward with tight arm; distinguished from hook | `ELBOW_CFG` |
| Knee / kick | `KickDetector`, `updateKneeOnly` | knee/ankle rise and extension; leg length normalisation | `KICK_CFG` |
| Duck | `_duck()` | head image-y drop vs `neutralImg` (fallback world) | `DUCK_CFG` (fullTorso 0.5, fullMetres 0.25) |
| Block | block pose vs calibrated guard + delta | wrists to face height and proximity | `BLOCK_CAL` |
| Slip/lean | `OneEuro` on head lateral/forward vs calibrated range | `lean`, `leanForward` | `CAL_CFG` |
| Loss hold | `_holding(t)`, `LOSS_HOLD = 0.35` | keep tracking through short drops | — |
| Hips unseen | `hipMid()` fallback `[0,0,0]` | works for desk cameras | — |

Mutual exclusion logic: `lastHand`, `lastOther`, `lastElbow` timestamps prevent a hook being read as a straight, etc. This logic is a big source of subtle bugs; any change must keep `pose_strikes_test` green **and** golden green.

## 5.4 Known weaknesses to attack (hypotheses until real data confirms)

1. **Straight punches at the camera** rely on world depth speed. Real depth jitter may cause misses at low speed and false positives when leaning.
2. **Hook vs elbow vs block** confusion: arm geometry overlaps when the glove stays near the face.
3. **Uppercut vs block raise**: both move wrists up; distinguish by start below the elbow and the path.
4. **Knee**: knee rises also during walking/shifting; threshold relative to leg length; legs often out of frame.
5. **Fast motion blur** → low visibility on wrists; hold logic needs tuning from data.
6. **Loose clothing**, long sleeves hide elbows; hoods; glasses reflections (head only).
7. **Multiple people / mirrors / posters** in view (MediaPipe `numPoses: 1` picks one; the chosen person can flip).
8. **Camera auto-exposure/gain** flicker under fluorescent lights.
9. **Webcam field of view** differences (wide-angle distort limbs at the edges).
10. **Latency** from confirmation frames (see 5.8).

## 5.5 Capture improvements (lever 1)

### 5.5.1 Resolution and frame rate
- Experiment matrix: 640×480@30, 640×480@60, 960×540@30, 1280×720@30. Record in the evaluator: wrist visibility, miss rate, latency, GPU ms.
- Implementation: `getUserMedia` constraints with `ideal` and `max`; read actual `track.getSettings()`; store in the trace meta; allow the setting to be chosen automatically (start 960×540@30 if device handles ≥ 25 fps, else 640×480).
- MediaPipe internally resizes; the benefit is landmark crop quality at distance. Verify empirically.

### 5.5.2 Exposure
- Existing: if the player is missing in ≥ 60 % of 100 results, drop to 30 fps once. Extend: use `track.getCapabilities()` to check `exposureMode`, `exposureCompensation`, `brightness`, `frameRate`; try `exposureMode='continuous'` and a +0.5 EV compensation in dim light (non-standard on many cameras → try/catch).
- Show the user the light advice (done) with a "Test light" button in the setup screen.

### 5.5.3 Mirroring
- The preview is mirrored for the user; the processing uses the unmirrored frame; keep consistent (left/right strikes mapping verified by tests with a flipped fixture).

### 5.5.4 Region of interest
- If the person occupies a small part of the frame, crop to a padded box around the last detected bounding box and upscale (ROI tracking). MediaPipe already tracks internally in VIDEO mode, but giving a tighter crop increases effective resolution. Try only after measuring.

## 5.6 Filtering (lever 3)

Current: OneEuro for `lean` with `(2.5, 0.3)`; strike detectors operate on raw world points with their own gating.
Plan:
1. Add an optional OneEuro per landmark (`minCutoff`, `beta`, `dCutoff`) for wrists/elbows with high `beta` (low lag at speed) and for head/shoulders with higher smoothing.
2. Tune per part by minimising `jitter RMS at rest` + `lag at 3 m/s` on real traces; keep a table in `CAMERA_ACCURACY.md`.
3. Provide a **velocity estimator** based on a short Savitzky–Golay fit (window 5 at 30 fps) for wrist speeds; compare with finite differences on real data.
4. Avoid double smoothing (MediaPipe's own temporal smoothing exists in VIDEO mode). Test with smoothing off in the worker (`outputSegmentationMasks=false`, model parameters) if configurable.

## 5.7 Calibration redesign (lever 5, plus UX in file 03)

Goals: fewer steps, better thresholds, instant feedback.

- Keep the five steps; add live validation per step (e.g. block step shows wrists-to-face distance ring).
- Punch calibration: ask for 3 slow + 3 fast punches per hand ("как будто бьёшь грушу"). Use median of top peaks; derive `extVel`, `fwdVel`, `above`, `progress` thresholds (existing logic) plus new image-space `scaleGrowth`.
- Store calibration quality score 0–1 (stability of neutral, block separation, punch amplitude consistency). Use to set assist level:
  - ≥ 0.8 "Строгий"; 0.5–0.8 "Обычный"; < 0.5 "Прощающий" (lower thresholds, longer intent buffer).
- Allow quick **re-calibration** from Pause menu without restarting the bout.
- Persist calibration in `localStorage` for 24 h keyed by camera label + resolution; offer "Использовать прошлую настройку" (skips steps) when the same camera and similar framing are detected (check neutral stance similarity).

## 5.8 Latency engineering (see file 06 for budget)

Sources and fixes:
| Stage | Today | Improvement |
|---|---|---|
| Confirmation frames | detectors require 2 rising steps at low fps; a few frames at 60 | decide on first strong frame if speed ≥ 1.5× threshold; second frame only for marginal cases |
| OneEuro lag | for lean | reduce `beta` effect; measure |
| Worker queue | drop if busy (good) | ensure `submit` never queues; log drops |
| Main-thread work | overlay drawing at result rate | throttle to 20 Hz; skip when tab hidden |
| Animation start | after core applies attack | **pre-wind-up**: start glove pull-back on first motion cue (wrist speed > 30 % of threshold + direction) before decision; if no decision within 150 ms, retract smoothly |
| Core tick | 120 Hz; input applied next tick | already fine |
| Render | vsync | n/a |

### 5.8.1 Pre-wind-up design (careful: must not change rules determinism)
- It is **visual only**: the robot's arm animates toward a wind-up pose; the core attack still starts at the decision.
- Add a visual-intent channel from `CameraInput` to `anim.js`: `intent = { hand: 0|1, kind: 'straight'|'hook'|'upper'|null, strength: 0..1 }` updated every frame from raw wrist velocity.
- When the rules start the attack, `anim.js` blends from wind-up to the attack animation (which has its own wind-up phase of 0.05–0.15 s — shorten it for camera-driven attacks by the pre-wind amount).
- Acceptance: perceived latency in the flash test drops by ≥ 40 ms median without increasing false visual wind-ups > 1 per idle minute.

## 5.9 Forgiving mechanics (lever: game-side tolerance)

1. **Intent buffer** (80–120 ms): if the player starts a strike while the previous attack is in recovery, queue the intent and fire when allowed (this exists for keyboard? verify in `core`); apply the same to camera masks (core: `PunchIntent` buffering ticks).
2. **Auto-pick of strike type** when ambiguous between hook and straight, use geometry of the opponent: if the opponent's head is centred and the glove path is mostly forward → straight; if lateral → hook. Only when the classifier confidence difference < margin.
3. **Leg-less fallback**: if legs not visible, disable knee/kick triggers and show a persistent small chip "Ноги не видны".
4. **Duck/block hysteresis** and minimum hold durations to avoid flicker.
5. **Sensor loss grace**: if tracking lost during an opponent's attack wind-up, hold the last block/duck state for 0.35 s (exists) then fall to neutral.
6. **Assist levels** (Прощающий/Обычный/Строгий): scale detection thresholds ±20 % and buffer lengths. Default "Обычный"; calibration quality can suggest.
7. **Anti-cheat vs ladder**: forgiving mode must not give ladder advantage — use separate ladders per assist level or fix ladder assist to "Обычный".

## 5.10 Hybrid control (recommended default for camera mode in v1)

Camera controls strikes, block, slip, duck. **Keyboard/gamepad optional for footwork** (W/S/A/D) and for strikes the camera marks as beta. Rationale: footwork by leaning is the least reliable and most tiring. Implementation: input arbitration in `main.js` merges camera and keyboard per field (`status` remains camera; footwork axes from keyboard when pressed). Test in QA: simultaneous inputs.

## 5.11 Multi-person and mirror robustness

- If the pose jumps between two people (distance between hip midpoints > 0.5 m within 0.1 s), hold the previous person for 0.35 s and then accept the new person only if they are closer to frame centre.
- Warn "В кадре больше одного человека" when the detector reports a second pose (requires `numPoses: 2` on a lighter model for the first 5 s of setup only; evaluate cost).
- Mirror/poster false person: detect a static skeleton (movement < 1 cm over 3 s while the real player moves) — rare; log only.

## 5.12 Second camera policy (v1)

- Hidden behind `?lab=1`. Code stays (fusion, tests).
- Re-enable in a later version only if real data show a measurable benefit: compare accuracy of straights with and without the second camera on ≥ 4 participants; require ≥ +5 pts recall at equal FP and no extra lag > 20 ms.
- If enabled: keep the 1.6.2 safety rules (non-blocking, auto-drop, blend).

## 5.13 Using phones' IMU or other sensors (not in v1)

Out of scope; mention only as future: phone in pocket sending accelerometer via WebRTC for punch timing. Do not implement.

## 5.14 Debug tooling (keep and extend)

- F3 overlay: fps, detector ms, delegate, second-camera state, light, F4 hint.
- F4: save trace.
- New: `?debug=detectors` overlay: per-detector current score vs threshold bars for the last 2 s (helps the owner see why a strike did not fire). Display near the camera preview.
- Console API: `IRONECHO_APP.cameraInput.proc.explain()` returns last rejection reasons per detector (cheap string ring buffer).
- Trace replay: `node Tests/Web/replay_trace.mjs file` prints calibration and every detection.

## 5.15 Test strategy for camera code

| Layer | Test | Purpose |
|---|---|---|
| Unit | detectors on hand-written minimal sequences | edge cases (single frame spikes, drops) |
| Synthetic | `pose_strikes_test.mjs` (10 fault sets) | regressions in logic; never tune thresholds to make it pass if real data disagree |
| Golden real | `golden_test.mjs` (new) | prevents accuracy regression on real people |
| Parity | `check_pose.mjs` | JS vs Python tracker (Unreal path) |
| Browser | `qa.js camera`, `camera2_e2e.js` | UI flows |
| Soak | 5-min synthetic session at 60 fps | memory/time stability |
When real data contradicts the synthetic suite, **update the synthetic fighter** (add the real-world fault, e.g. noise spectrum, depth bias, sleeve occlusion) so it keeps catching regressions.

## 5.16 Python tracker parity (Unreal path)

The Python tracker (`Tracking/`) is a separate implementation used by the Unreal build. Whenever detector logic changes in JS, decide explicitly: port to Python (and update golden vectors) or mark the Unreal path as lagging in `PROJECT_STATE.md`. Do not let them diverge silently. `check_pose.mjs` compares the *shared subset*.

## 5.17 Risks specific to the camera work

| Risk | Mitigation |
|---|---|
| Overfitting to the first 3 participants | held-out set; recruit W2 early |
| Thresholds tuned for the owner's arm length | normalise by arm length/shoulder width everywhere |
| Fix for one condition breaks another | evaluate by condition; golden set covers all |
| Latency work introduces false visual wind-ups | acceptance FP bound; kill-switch flag |
| Browser updates change MediaPipe behaviour | pin MediaPipe version (already vendored), re-run eval after upgrades |
| GPU delegate unavailable | CPU fallback tested; message shows delegate |
