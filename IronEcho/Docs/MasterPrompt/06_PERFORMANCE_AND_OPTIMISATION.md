# 06 — PERFORMANCE AND OPTIMISATION

Rule zero: **measure first, optimise second, re-measure third.** Every optimisation is a hypothesis with a number attached.
Keep a log in `Docs/Testing/PERFORMANCE_LOG.md`: date, change, device, before, after.

## 6.1 Performance targets (hypotheses until measured on real devices)

| Metric | Target | How measured |
|---|---|---|
| Time to menu, first visit, home broadband | ≤ 8 s | telemetry `game_loaded.ms` (p50), Playwright with throttling as proxy |
| Time to menu, repeat visit (service worker) | ≤ 2 s | telemetry (flag `cached=true`) |
| Transfer size before menu | ≤ 6 MB | network panel / Playwright `request.sizes` |
| FPS, no camera, weakest laptop (integrated GPU) | ≥ 40 | `fps_sample` telemetry by GPU class |
| FPS, camera on, weakest laptop | ≥ 30 | same |
| Pose inference | ≤ 25 ms GPU / ≤ 45 ms CPU | detector `inferMs` |
| Camera end-to-end latency | p50 ≤ 150 ms, p95 ≤ 250 ms | flash test (file 04) |
| Worst frame | ≤ 50 ms (99th percentile) | `perfOverlay` worst-frame stat → telemetry |
| Memory growth over 20 bouts | ≤ 10 % | soak test + `performance.memory` where available |
| JS heap at idle menu | ≤ 150 MB | devtools |
| CPU on main thread during bout | ≤ 50 % of one core | performance trace |
| Battery | ≤ 25 % per hour on a typical laptop (informal) | owner test |

## 6.2 Device matrix (what we must try; owner and testers supply)

| Class | Example | Purpose |
|---|---|---|
| D1 weak laptop | 4-core CPU, integrated Intel UHD, 8 GB RAM, 1366×768 | defines the floor |
| D2 mid laptop | integrated Iris Xe / AMD Vega, 16 GB | typical |
| D3 gaming laptop/desktop | discrete NVIDIA/AMD | ceiling, check 144 Hz handling |
| D4 MacBook | M-series, Safari + Chrome | WebKit differences, high DPR |
| D5 Chromebook | low-end ARM | extreme floor; likely keyboard-only |
| D6 phone | mid Android, iPhone | touch mode |
Browser matrix: Chrome (latest, latest-1), Edge, Firefox, Safari (macOS/iOS). Each combination gets a short smoke checklist (file 09).

GPU class detection for telemetry: `WEBGL_debug_renderer_info` renderer string → hashed to a family (`intel-uhd`, `intel-iris`, `amd`, `nvidia`, `apple`, `mali`, `adreno`, `swiftshader`, `other`); never send raw strings.

## 6.3 Measurement toolkit

### 6.3.1 In-game
- F3 overlay (exists): game fps, worst frame, resolution scale, camera fps/ms/delegate.
- New `fps_sample` event every 30 s: `{avg, p5, worst, scale, tier, control, gpuClass, dpr, cores, mem}`.
- A 10-second **benchmark** at first run (before the menu) is NOT used; instead sample live during the tutorial (no extra wait).

### 6.3.2 In CI (headless)
- Playwright + SwiftShader: relative measurements only (compare before/after on the same machine). Record load time, JS evaluation time, frame time in a fixed scripted bout (`debugAdvance`).
- Budget file `Tests/Web/perf_budget.json` with maxima (e.g. `htmlBytes`, `menuReadyMs`, `frameMsP95`); CI fails if exceeded by > 10 %.

### 6.3.3 Manual traces
- Chrome DevTools Performance trace of a 20 s bout (owner or tester machine); share the JSON. Look for long tasks, GC, GPU idle gaps. `Tools/Eval/trace_summary.mjs` can parse the trace and print long tasks (optional).

## 6.4 Loading performance (workstream 4a)

### 6.4.1 Current state
- `play/index.html` is a single file 7–8 MB (inlined JS, WASM, textures base64?, GLB as separate assets? verify with `ls -la Tools/Build/Web/release/play`). Landing is small. First visit pays for everything before the menu.

### 6.4.2 Plan
1. **Measure the breakdown** by resource: HTML+JS, WASM core (~90 KB?), Three.js, MediaPipe bundle (large, lazy), model files (`.task` full ~9 MB, heavy ~30 MB), robots GLB (~3.5 MB ×2 + meshopt variants), textures (JPEG ~2 MB), audio (procedural, none), fonts.
2. **Split by need**:
   - Phase A (to menu): HTML shell, CSS, menu JS, core WASM, minimal audio, fonts (subset).
   - Phase B (during menu idle / on "В РИНГ" click): Three.js, arena, robots (meshopt GLB `.mo.glb`), textures.
   - Phase C (only on Camera click): MediaPipe vision bundle + worker + `pose_landmarker_full.task`.
3. **Prefer the already-built meshopt GLBs** (`IE1_*.mo.glb` ~750 KB each vs 3.5 MB) for web; keep high-detail for the desktop app.
4. **Textures**: JPEG now; evaluate KTX2/Basis (GPU compressed) for 2–4× smaller upload and faster decode; needs `basisu` tooling → only if textures > 2 MB after JPEG tuning.
5. **Fonts**: subset Barlow Condensed and Inter to Latin+Cyrillic used glyphs; `font-display: swap`; preload critical weights; target ≤ 80 KB.
6. **Caching**: hashed filenames + `Cache-Control: public, max-age=31536000, immutable` for assets; HTML `no-cache`. Vercel headers in `vercel.json`.
7. **Preconnect/prefetch**: `<link rel="preload">` for WASM and menu CSS; `prefetch` Phase B resources on landing CTA hover.
8. **Service worker** (`sw.js`): precache Phase A + Phase B on first successful load; runtime cache for Phase C after first use; versioned cache name = game version; offline fallback page for navigation; `skipWaiting` + `clients.claim` guarded by a "new version available" toast (never reload mid-bout).
9. **Compression**: ensure Brotli for HTML/JS/WASM; check Vercel `Content-Encoding`; for `.glb`/`.task` already compressed → skip.
10. **Lite mode**: `?lite=1` loads reduced textures (1K) and no shadows; auto-suggested if load > 15 s.

### 6.4.3 Acceptance
- Network throttling "Fast 4G": menu ≤ 10 s; "Slow 4G": ≤ 25 s with progress and tips.
- Lighthouse performance score ≥ 85 on the landing (mobile), ≥ 70 on /play.

## 6.5 Runtime performance (workstream 4b)

### 6.5.1 Render loop
- Single `requestAnimationFrame`; fixed-step core accumulation (`core.frame(dt)`); render once per frame.
- Pixel ratio: min(devicePixelRatio, cap) × adaptive `resScale` (0.6–1.0). Already exists; extend tiers:

| Tier | Shadows | Pixel cap | Particles | Post | Target |
|---|---|---|---|---|---|
| high | key light 2048 PCFSoft + 2 spot shadows | 2 | full | AgX tone mapping | D3/D4 |
| low | key light 1024, no spot shadows | 1.25 | 60 % | AgX | D2 |
| minimum | no shadows | 1.0 | 30 % | none | D1/D5 |
- Auto tier: start `low` on integrated GPU classes, `high` on discrete/Apple; step down if p5 fps < 30 for 4 s; step up never during a bout, only in the menu with a "Попробовать выше" suggestion.
- Existing special rule (1.6.2): camera on and fps < 40 at min scale → `low`. Replace with generalised governor.

### 6.5.2 CPU hot spots to inspect
- `anim.js`/`rig.js` per-frame two-bone IK for 2 robots: ensure no allocations (use preallocated vectors).
- `pose.js` `PoseProcessor.process`: `bodyPose` builds `p` array of 33 arrays per frame (allocation churn). Optimise with typed arrays reuse if profiling shows GC pauses ≥ 4 ms.
- `drawConnectors`/`drawLandmarks` per result on the preview canvas: limit to 20 Hz, 320×240 canvas.
- HUD DOM updates: batch, avoid layout thrash (use `transform`/`opacity`).
- Audio: WebAudio nodes reuse; avoid creating nodes per hit beyond a pool.

### 6.5.3 GPU contention (camera on)
Inputs: MediaPipe GPU delegate (WebGL in a worker) + Three.js WebGL in main thread share the GPU.
Experiments (measure fps and pose ms each):
1. Pose on GPU vs CPU (WASM SIMD) at 640×480; likely CPU 35–60 ms on weak laptops → worse latency but frees GPU. Choose per device class by a short probe (3 s) at calibration.
2. Pose at 15 fps while render 60 fps (skip every 2nd frame at low tier): reduces load, increases latency 33 ms; combine with pre-wind-up to hide.
3. Lower render resolution during camera calibration (no fight yet).
4. Use `OffscreenCanvas` rendering in a worker for the 3D (big refactor) — only if D1 cannot reach targets; likely not worth it.
5. `powerPreference: 'high-performance'` (exists) — verify hybrid-GPU laptops actually select the discrete GPU (user-side setting for Chrome). Document in tips.

### 6.5.4 Memory
- Dispose geometries/materials/textures when leaving arenas; QA soak exists (3 bouts). Extend to 20 bouts and track `renderer.info.memory` + `performance.memory.usedJSHeapSize` (Chromium).
- Replay buffers: bound sizes; clip recorder rolling buffer ≤ 12 s × bitrate (cap 10 MB).
- Trace recorder: ring 25 s ≈ 1.2 MB; tape ≤ 60 s ≈ 3 MB → OK; free when camera off.

### 6.5.5 Battery and thermal
- Cap FPS to 60 (not 144) unless the user chooses; use `requestAnimationFrame` timestamps.
- Eco mode (30 fps) when `navigator.getBattery().charging === false && level < 0.3` (where supported) — suggest, don't force.
- Pause everything when `document.hidden` (exists: pause on blur).

### 6.5.6 Input latency (keyboard)
- Keyboard events processed at event time into the next core tick; check there is no extra frame of buffering; measure with `performance.now()` between `keydown` and the first render showing the glove move (target ≤ 50 ms at 60 fps).

## 6.6 Network performance (online duel and API)

- Input packet: 11 fields per frame; measure bytes/s (< 3 KB/s). Rollback depth histogram in telemetry (`net_stats` every 30 s: rtt, rollbacks per min, max depth).
- If NAT failures exceed 15 % (events `net_fail{reason}`), evaluate a TURN relay; free tiers exist but have quotas; ask owner before signing up.
- API calls (rating) use `fetch` with timeouts (5 s), retry with backoff, and queue offline (exists for rating).
- Use HTTP/2 push via `<link rel=preload>`; no third-party fonts at runtime (self-host).

## 6.7 Build-size tactics (repo and release)

| Item | Now (approx) | Action |
|---|---|---|
| `release/play/index.html` | 7.8 MB | split per 6.4; target shell ≤ 400 KB |
| `release/download/IronEcho-Windows.zip` | 51 MB | fine (download); consider Brotli-compressed assets or dropping duplicate `.json` sidecars |
| Git history size | grows with each release commit (zip + html binary diffs) | move large generated artifacts to GitHub Releases/Vercel blob and keep only small index in git; discuss with owner (needs deploy pipeline change) |
| Vercel deploy time | depends on release size | after split, upload only changed hashed files |
Warning: tracked binary release artifacts bloat the repository by ~60 MB per release. Plan a migration to **CI-built releases** (GitHub Actions builds and deploys to Vercel with the Vercel CLI/API using a token the owner provides as a GitHub secret) so the repo stops growing. Record decision in `Docs/BUSINESS.md`.

## 6.8 Optimisation workflow (procedure for each suspected bottleneck)

1. State the symptom with a number (e.g. "p95 frame 38 ms on D1 with camera").
2. Capture a trace (6.3.3) or reproduce under SwiftShader + CPU throttle (4×) in Playwright.
3. Identify top 3 costs (scripting, rendering, GPU, GC).
4. Hypothesise a fix; implement behind a flag if risky.
5. Measure on the same machine, same script, 3 runs, median.
6. Keep if gain ≥ 5 % or ≥ 2 ms on target metric and no visual/regression change (screenshot diff, QA green).
7. Log in `PERFORMANCE_LOG.md`.

## 6.9 Visual regression guard

- Keep reference screenshots for: menu, arena idle, hit moment, knockdown, results, camera calibration (1280×720).
- Playwright `toHaveScreenshot`-like comparison with a tolerance (pixelmatch) on SwiftShader; update intentionally with a note in the commit.
- Use for performance changes that alter tiers (shadows off) to ensure nothing else broke.

## 6.10 Performance acceptance checklist (end of Phase 3)

- [ ] Budget file in CI; current numbers recorded.
- [ ] Phase A/B/C loading split; service worker live; versioned cache.
- [ ] Auto tier selection; D1 and D2 results in `PERFORMANCE_LOG.md`.
- [ ] GPU-contention decision recorded (GPU vs CPU pose by class).
- [ ] 20-bout soak green; battery/thermal informal test done.
- [ ] Latency p50/p95 measured on at least 2 machines.
