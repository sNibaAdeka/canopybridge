# 04 — THE REAL-DATA PROGRAM (the gate for all camera work)

Why this exists: every threshold in `pose.js` was tuned on `Tests/Web/pose_sim.mjs`, a synthetic fighter. A synthetic body
has clean noise, no clothing, no mis-detections, no fatigue, no personal style. The owner's real-world reports (poorly seen,
glitchy strikes, weak elbows/knees) are what that gap looks like. **You cannot fix by thought what you cannot measure.**
This program converts a few human sessions into measurable truth, then keeps it measurable forever (golden set in CI).

## 4.1 Principles

1. **Label at capture time.** A guided session that cues each strike yields ground truth without manual annotation.
2. **Skeleton only.** No video, no audio, no face. Consent screen first.
3. **Held-out evaluation.** Tune on some people, report on others (leave-one-person-out). Never report training accuracy as accuracy.
4. **Conditions matter.** Light, distance, camera type, clothing. Report by condition.
5. **Regressions are visible.** A fixed golden set runs in CI; thresholds cannot silently get worse.

## 4.2 Collection Mode — functional spec

### 4.2.1 Entry
- URL `?collect=1` and a menu link "Помочь улучшить камеру" (Settings → Лаборатория and, after launch, the result screen footer).
- Works fully offline in the browser; upload is optional (4.2.8).

### 4.2.2 Screens
1. **Consent** (RU/EN): what is recorded (33 skeleton points per frame + timing + labels), what is not (video, audio, face), purpose, how to delete (button "Удалить мою запись" which clears local data; upload deletion by id), age ≥ 16 (or 13 with a guardian).
   Buttons: [Согласен, начать] [Назад]. Store consent timestamp in the file.
2. **Participant form** (all optional except camera auto-fields): height range (<160, 160–175, 175–190, >190), build (slim/medium/broad), glasses (y/n), clothing (fitted/loose), experience (none/hobby/trained), dominant hand. Free text "комментарий" (max 200 chars). No name, no email.
3. **Setup check**: reuse camera setup check (file 03, 3.6 step 2). Block start until Свет/Тело/Скорость are not red. Show the current condition label A/B/C.
4. **Protocol runner** (big text, optional speech via `speechSynthesis`):
   - header: condition, block name, counter "7 из 10".
   - cue: "Левый хук — через 3… 2… 1… ДАВАЙ!" then a 1.4–2.0 s random wait before the next cue (random so the player cannot pre-anticipate timing).
   - after each cue the runner marks `cue_time` (performance.now at "ДАВАЙ") and waits for a "response window" of 1.2 s; next cue after the window plus rest.
   - controls: `Пропустить` (skip this cue, mark `skipped`), `Повторить` (redo, mark previous as `redo`), `Пауза`.
   - automatic quality flags: if the player is not visible during a cue window, mark `invisible`.
5. **Idle blocks**: "Постой 30 секунд, переминайся, качайся" (false-positive set), "Пошагай на месте 20 секунд", "Потянись/почеши нос 10 секунд" (hand-to-face confounders for blocks/uppercuts).
6. **Free fight block**: a 60 s fight vs Easy bot with camera control, recording everything; labels = the game's own events (what the game thought) plus player self-report at the end ("Что не сработало?" checklist: прямые/хуки/апперкоты/локти/колени/ноги/блок/нырок/всё нормально).
7. **Finish**: summary (number of cues, % visible), download button for the session file, optional upload button, thank-you screen with the owner's contact for feedback.

### 4.2.3 Protocol (per condition; ~12 min)

Order is fixed but counterbalanced across participants (rotate the order of blocks by participant index to spread fatigue).

| Block | Cue text | Count | Notes |
|---|---|---|---|
| Stance | "Встань в стойку" | 3 × 3 s | baseline |
| Block | "Блок" hold 2 s | 5 | |
| Slip L / R | "Уклон влево/вправо" | 5 + 5 | |
| Duck | "Нырок" | 10 | head down 20–30 cm |
| Lean forward | "Наклон к экрану" | 5 | for footwork |
| Straight L head | "Прямой левой в голову" | 10 | forward, toward the screen |
| Straight R head | | 10 | |
| Straight body L / R | "Прямой в корпус" | 5 + 5 | lower |
| Hook L / R | "Хук левой/правой" | 10 + 10 | 4 of each to body |
| Uppercut L / R | | 10 + 10 | |
| Elbow L / R | | 8 + 8 | |
| Knee L / R | | 8 + 8 | needs legs visible; skip block if knees not seen |
| Kick mid L / R | | 6 + 6 | |
| Kick low L / R | | 6 + 6 | |
| Idle shuffle | 60 s | 1 | false positives |
| Confounders | hand to face, scratch, drink, wave | 4 × 5 s | false positives |
| Free fight | 60 s | 1 | |

Total cues ≈ 190 per condition → ~9–12 min at 2.5–3.5 s per cue.

### 4.2.4 Conditions

| ID | Description | How the participant sets it up |
|---|---|---|
| A | good light, 2 m, centred | lamp in front or daylight from the side; stand ~2 m |
| B | dim light, 2 m | switch off the main light; only a screen glow; (the app measures luma and records it) |
| C | 3 m, off-centre | step back to ~3 m; stand ~0.5 m to the side of centre |
Optional D (second device): phone camera through browser, if supported.
The recorder stores measured luma, estimated distance (body height fraction), and camera settings per condition; the *label* is not trusted, the measurement is.

### 4.2.5 Session file format (JSON, gzip)

```jsonc
{
  "format": "ironecho-session", "formatVersion": 1,
  "game": "версия 1.6.3", "savedAt": "2026-10-20T12:00:00Z",
  "consent": { "at": "...", "version": 1 },
  "participant": { "id": "p_8f3c2a", "height": "175-190", "build": "medium", "glasses": false, "clothing": "fitted", "experience": "hobby", "hand": "right", "comment": "" },
  "device": { "userAgent": "...", "camera": { "label": "", "width": 640, "height": 480, "frameRate": 60 }, "detector": "worker/GPU", "model": "full", "fpsMean": 52, "inferMsMean": 14 },
  "conditions": [
    { "id": "A", "luma": 0.41, "bodyHeightFrac": 0.62, "start": 0.0, "end": 702.1 }
  ],
  "frames": [ { "t": 12.345, "c": "A", "w": [[x,y,z,v] * 33], "i": [[x,y] * 33] }, ... ],
  "cues": [ { "t": 15.200, "c": "A", "kind": "hook", "side": "L", "target": "head", "status": "ok|skipped|redo|invisible", "window": [15.2, 16.4] } ],
  "gameEvents": [ { "t": 15.390, "punch": 64, "kick": 0 } ],   // what the shipped detectors produced live
  "selfReport": { "problems": ["hooks","knees"], "text": "" }
}
```
- Size estimate: ~9 min × 30 fps × (33×4 + 33×2 numbers) → ~35 MB raw JSON per condition → must compress: keep 3 decimals, drop unseen landmarks to `null`, delta-encode time; gzip ≈ 3–4 MB per condition. Target ≤ 12 MB per participant (3 conditions). If larger, store frames at 30 fps max and image landmarks only for 11 key points.
- Reuse `TraceRecorder` encoding rules where possible; add `cues` and `conditions`.

### 4.2.6 Implementation plan (files)
- `Tools/Build/Web/site/src/collect.js` (runner UI + state machine), `collect_protocol.json` (blocks, counts, texts RU/EN), hooks into `CameraInput` (`rec` already records frames), `main.js` route `?collect=1`.
- Tests: `Tests/Web/collect_test.mjs` runs the runner headless with the synthetic fighter driven by cues (`pose_sim` Script generating the cued strike at the cue time) and verifies the output file validates against the schema and that the evaluator reproduces ~synthetic accuracy.

### 4.2.7 Quality gates inside Collection Mode
- Refuse to continue a block if mean visibility of wrists < 0.5 for 3 consecutive cues: show tip and offer to retry the block.
- Warn if FPS < 20: "Слишком медленно для записи: закрой другие вкладки".
- Auto-pause on tab hide.

### 4.2.8 Upload (optional, with consent)
- Endpoint `POST /api/trace` (Vercel function) → signed upload to private Supabase Storage bucket `traces`; limit 12 MB; rate-limit; store row in `trace_index(id, participant_id, size, game, created_at)`.
- Owner can also receive files by other means (file drop); the evaluator reads any local folder.
- Deletion: `DELETE /api/trace?id=…&token=…` (token shown at upload).

## 4.3 Recruiting plan (owner-facing; see file 11 for scripts)

| Wave | Who | Count | Goal |
|---|---|---|---|
| W0 | Owner (self) | 1 × 3 conditions | validate the tool, first table |
| W1 | friends/family with laptops | 3–4 | variety of bodies and cameras |
| W2 | colleagues / online community volunteers | 4–8 | more cameras, clothing, rooms |
| W3 | closed-test players using F4 / free-fight | 10+ | in-the-wild noise |
Target minimum for decisions: 8 participants, ≥ 3 camera models, ≥ 2 with glasses or loose clothing.
Incentive: credit in the game ("Первопроходцы" list), early access, a special robot colourway. No money without owner's approval.

## 4.4 Evaluation harness — spec (`Tools/Build/Eval/eval_camera.mjs`)

### 4.4.1 Inputs
- Folder of `ironecho-session-*.json(.gz)` and/or `ironecho-trace-*.json(.gz)` (traces without cues are evaluated only for false positives and loss).
- Options: `--model-from <pose.js path>` (default current), `--participants a,b`, `--condition A`, `--json`, `--md out.md`.

### 4.4.2 Replay
1. Load frames; for each condition segment create a **fresh** `PoseProcessor` (same options as the game).
2. Feed calibration frames (the session's own stance/block/slip/punch cues are the calibration; the evaluator must run the real calibration state machine by feeding the frames recorded during the game's calibration step; if the session was collected without the game calibration, run a **synthetic calibration**: take the Stance block frames as neutral, Block block as block pose, Slip blocks as slip extremes, first two straight cues per side as punch calibration). Document this mapping in the tool README and keep it identical for all sessions.
3. For every frame call `process(world, t, image)` then `poll()`; record decisions with the frame time.

### 4.4.3 Alignment and scoring
- For each cue with status ok: window `[cue_time - 0.2, cue_time + 1.4]`.
- A detection inside the window with the **correct type and side** = HIT; the **earliest** counts; extra detections in the same window = DUPLICATE (counted separately).
- A detection inside the window with a different type = WRONG_TYPE (record which).
- No detection = MISS.
- Detections outside every cue window = FALSE_POSITIVE; report per minute of idle/confounder blocks and per minute overall.
- **Latency estimate**: time from motion onset to detection, where onset = first frame where wrist speed (in image space, normalised) exceeds 15 % of its peak within the window.
- Duck/block/slip: scored as state detection (status/lean/duck thresholds) within window, with hold duration.

### 4.4.4 Outputs
- Per participant × condition × strike table: n cues, hit %, miss %, wrong-type %, duplicate %, median latency.
- Aggregate table: mean and 95 % bootstrap CI over participants for each strike and condition.
- Confusion matrix: rows = cued type, columns = detected type (including "none").
- False-positive rate per idle minute with example timestamps.
- A markdown file `Docs/Testing/CAMERA_ACCURACY.md` with: date, game version, git commit, participants (anonymous ids), table, top-3 failures with the worst timestamps and a link to plotting command.
- Machine-readable `eval.json` for CI and plotting.

### 4.4.5 Plotting helper (`Tools/Build/Eval/plot_cue.py`)
Given a session and a cue index, plot (matplotlib): wrist/elbow/shoulder image coordinates, world depth, speed, hand scale, and the detector states with the cue window highlighted. Use it for every failure analysis. Saves PNG to the scratchpad.

### 4.4.6 Tests for the evaluator
- Unit: synthetic session from `pose_sim` with known truth → evaluator reproduces expected recall within tolerance.
- Fault injection: shift cue times by +0.5 s → evaluator reports misses; verify alignment logic.
- Determinism: same input → identical `eval.json` (sorted keys).

## 4.5 Golden set

- From the first 8 participants choose ~10 segments (20 s each) covering: each strike type, hard cases (loose clothing, dim light, off-centre), and idle false-positive segments.
- Store as `Tests/Web/golden/*.json.gz` (≤ 2 MB total). Include a `manifest.json` with expected minimal hits per segment from the **current accepted** build.
- CI test `golden_test.mjs`: runs evaluator on golden; fails if aggregate recall for any strike drops by > 1 point or false positives per idle minute rise.
- Update procedure: only with a recorded reason in `CAMERA_ACCURACY.md` and the owner informed.
- Privacy: golden files contain only skeleton numbers of consenting participants; no names.

## 4.6 The improvement loop (repeat until targets are met)

```
1. Run eval on all sessions (held-out discipline: develop on sessions D, report on sessions H).
2. List the worst 3 strike×condition cells by (1 - hit%) weighted by importance (straights, hooks, uppercuts first).
3. For each: plot 10 failing cues → hypothesis (what signal differs?) → write the hypothesis in CAMERA_ACCURACY.md.
4. Implement ONE change (feature, threshold, filter, calibration, model option).
5. Re-run: dev set must improve, held-out set must not worsen, golden + synthetic suites must pass.
6. Commit with the before/after table in the message body.
7. Go to 1.
```
Stop conditions: targets met, or three consecutive iterations with < 0.5 pt improvement on the worst cell (then change strategy: new signal or demote the strike).

### 4.6.1 Ordered levers (try in this order; each has a measurement)

| # | Lever | Hypothesis | Measure |
|---|---|---|---|
| 1 | Capture quality: 960×540, exposure fallback, light advice | more pixels on hands at 3 m; fewer dark frames | hand landmark visibility, miss rate in B and C |
| 2 | Image-space features | straight punch toward camera = forearm/hand scale growth in image; hook/uppercut = image-plane arcs; both less noisy than world depth | recall of straights in A/B/C |
| 3 | Per-part filtering | wrist needs low lag, head/shoulders can be smoother | latency vs jitter FP |
| 4 | Automatic threshold fitting | choose thresholds maximizing F1 with FP ≤ 1/min on dev set | dev/held-out gap |
| 5 | Longer personal calibration | 3–4 reps give better per-person scale | hit% by person |
| 6 | Model choice lite/full/heavy | heavy more accurate on wrists, costlier | accuracy per ms |
| 7 | Hand landmarks model (MediaPipe HandLandmarker) for fists/forearm orientation | helps elbow vs hook vs block; high cost | only if 1–6 insufficient |
| 8 | Learned window classifier | features: 0.5 s window of normalised joints + velocities → strike class | leave-one-person-out vs rules |
| 9 | Hybrid control suggestion | camera for strikes, keyboard for footwork | task completion and fun in closed test |

### 4.6.2 Learned classifier decision rule (lever 8)

Preconditions: ≥ 10 participants and ≥ 3000 labelled strikes; rules plateau.
- Features: per frame normalised (hip-centred, shoulder-width scaled) world+image coordinates of wrists, elbows, shoulders, head, knees, ankles; velocities; hand scale; window 24 frames at 30 fps (0.8 s) ending at the current frame.
- Models to try in order: gradient-boosted trees (export to JS arrays), tiny MLP (≤ 20k params) in plain JS or ONNX Runtime Web (WASM), 1D-CNN (≤ 50k params). Quantise to int8 if needed.
- Training in Python (venv in scratchpad); data split leave-one-person-out; class weights for rare strikes; calibration of probabilities; threshold per class for FP ≤ 1/min.
- Ship only if: held-out recall ≥ rules + 3 pts at equal FP, latency +≤ 10 ms, bundle +≤ 300 KB. Otherwise keep rules.
- Keep rules as fallback and as a gate (classifier proposes, rules veto impossible poses).

## 4.7 Targets (initial hypotheses; replace with measured values after W1)

| Class | Recall (held-out) | False positives |
|---|---|---|
| Straight (head/body) | ≥ 90 % | ≤ 1 per idle minute |
| Hook (head/body) | ≥ 85 % at first ship, ≥ 90 % goal | same |
| Uppercut | ≥ 85 % / 90 % | same |
| Elbow | ≥ 85 % or beta | same |
| Knee | ≥ 85 % or beta (legs visible) | same |
| Kick (mid/low) | ≥ 85 % or beta | same |
| Block | ≥ 90 % state accuracy | ≤ 2 spurious/min |
| Slip L/R | ≥ 90 % | ≤ 1 per min |
| Duck | ≥ 90 % | ≤ 1 per min |
| Wrong type | ≤ 5 % of cues | — |
| Latency (internal) | p50 ≤ 90 ms, p95 ≤ 160 ms from onset to decision | — |
Decision matrix per strike (applied after table exists):
- meets target in A and B → ship in camera mode;
- meets target only in A → ship with a visible "нужен хороший свет" hint;
- 70–85 % → "beta" label next to the strike in the help;
- < 70 % → keyboard-only for this strike; the camera does not trigger it (never trigger something unreliable).

## 4.8 Latency measurement program (end-to-end)

### 4.8.1 Test mode
`?latency=1`: when the game accepts a strike from the camera, the top-left 80×80 px square flashes white for one frame and the game plays a click. A short warning about flashing is shown. The pose overlay stays visible.

### 4.8.2 Procedure for the owner (file 11 has the script)
1. Put a phone on a tripod so it sees both the owner (arms) and the screen. Record 60 fps video (slow-mo mode if available).
2. Perform 20 slow-start, clear straight punches toward the screen with ~3 s rest.
3. Send the video (or analyse it yourself by uploading to the scratchpad).

### 4.8.3 Analysis script (`Tools/Build/Eval/latency_from_video.py`)
- Extract frames (ffmpeg), detect flash events (brightness jump in the screen region), detect punch onset (frame difference in the arm region exceeds threshold), compute the difference in frames × 1000/fps.
- Output p50/p95 and histogram; compare with internal `decision_time - capture_time` from the game log to estimate the unmeasured portion (display + camera exposure).

### 4.8.4 Internal timeline log
In the game, each strike decision records: `captureTime` (video frame timestamp), `workerDone`, `processedAt`, `maskPolledAt`, `coreAppliedAt`, `animStartAt`, `renderedAt` (first render with the new state). Put them in the trace `decisions` entries (extend `TraceRecorder.note`).

## 4.9 Data governance

- Store sessions outside git (`Data/Traces/` ignored by `.gitignore`; add entry); keep an `index.csv` (participant id, camera, date, conditions, size).
- Only skeleton numbers; strip UA hashes beyond family/major version in the public golden set.
- Retention: delete on request within 7 days; document in `PRIVACY_DRAFT.md`.
- Never commit full sessions; only trimmed golden segments with consent.

## 4.10 Deliverables checklist for Phase 0–2

- [ ] `collect.js` + protocol JSON + route, tested headless
- [ ] session schema JSON (`Docs/Testing/session.schema.json`) + validator in the evaluator
- [ ] `Tools/Build/Eval/eval_camera.mjs` + README + unit tests
- [ ] `Tools/Build/Eval/plot_cue.py`, `latency_from_video.py`
- [ ] one-page owner script for recording (file 11)
- [ ] `CAMERA_ACCURACY.md` generated from real data
- [ ] golden set + CI job
- [ ] decision per strike: ship / beta / keyboard-only (owner informed)
