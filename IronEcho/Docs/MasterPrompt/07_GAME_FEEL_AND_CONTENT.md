# 07 — GAME FEEL, DEPTH, CONTENT, BALANCE

Goal: every punch should *feel* fair, readable and satisfying — with a keyboard in the first second and with a camera when it works.
Everything here is web-first (the shipped product); Unreal items are listed separately (7.12).

## 7.1 Feel checklist (what makes a hit satisfying)

| Layer | Implementation target | Where |
|---|---|---|
| Hit-stop | freeze both robots 40–80 ms scaled by damage; for blocks 30 ms | `main.js` step: scale dt for animation only, not the core |
| Camera punch-in | 2–4 % FOV pulse for heavy hits; return in 200 ms | `arena.js`/camera rig |
| Screen shake | amplitude ∝ damage, 120–200 ms decay; respects reduced-motion | `fx.js`, `Shake` |
| Impact particles | sparks (metal), dust; pool-based | `fx.js` |
| Sound layers | glove whoosh (on wind-up), impact (3 variants), metal ring, crowd gasp, block thud | `audio.js` |
| Slow-mo | 0.3× for 250 ms on knockdown/final KO | step scaling |
| Hit flash | robot emissive pulse at contact point | materials |
| Damage readout | health bar trail (exists) + small number optional | `hud.js` |
| Rumble (gamepad) | strong at KO | Gamepad API vibration |
| Telegraph | bot wind-up readable; colour tell on glove for hooks/uppercuts at Easy | `anim.js` |

Acceptance: a blind A/B (feel on/off) with 5 testers: ≥ 4 prefer "on" and describe hits as satisfying.

## 7.2 Readability and fairness

- **Telegraph timing**: bot wind-up durations (core): straights ≥ 0.20 s, hooks +0.03 s, uppercuts +0.04 s. Human reaction ~0.25–0.35 s + camera latency. Keep Easy telegraph ≥ 0.40 s so a camera player can react; verify with `HumanModel` profiles (ReactMin/Max) and real testers.
- **Counters visible**: the feed says what happened ("ХУК ДОГНАЛ УКЛОН", "НЫРНУЛ — БЕЙ АППЕРКОТ") — teach through play.
- **Never feel cheated**: if a hit lands while the player was clearly blocking in the replay, investigate (tick-level event log, ghost replay). Provide a debug command to dump the last exchange (`IRONECHO_APP.core.debugLastExchange()` – add if missing).
- **Input leniency**: 80 ms buffer for attack intents during recovery (check core `IntentConfig`); coyote window for block (guard raised within 60 ms after the hit frame counts at Easy only? — decide with data; default off).

## 7.3 Bot design (existing + roadmap)

Existing: three levels, footwork, adaptive habit reading, hook/uppercut/duck use.
Roadmap for career opponents (parameter profiles on top of `BotConfig`):

| # | Name | Style | Distinct parameters (examples, tune with balance harness) | Arena |
|---|---|---|---|---|
| 1 | Тренер Кусок | passive, teaches | attackRate 0.2×, telegraph +50 % | Тренировочный зал |
| 2 | Ржавый | brawler, straights only | straights 100 %, no defence on right | Подвал |
| 3 | Игла | jab-focused, circles | jab 70 %, footwork high | Ринг-1 |
| 4 | Молот | hooks, slow wind-ups | hooks 60 %, windup +60 ms, power ×1.2 | Склад |
| 5 | Тень | counter-puncher | waits, punishes recoveries, low attack rate | Ринг-2 |
| 6 | Призма | mixes everything, reads habits | habit reading strength ×1.5 | Неон |
| 7 | Клещ | clinch, elbows/knees at close range | closes distance, uses lunge | Ринг-1 |
| 8 | Ураган | high volume, low defence | attackRate 1.5×, defence 0.6× | Арена |
| 9 | Зеркало | copies the player's last 3 attacks | mirroring logic (new) | Ринг-2 |
| 10 | ECHO | boss: adaptive + all tools | all features, Hard base | Чемпионская арена |
Each opponent: portrait (robot colourway), 2-line bio, win reward (cosmetic unlock).
Implementation: `career.js` data table → `MatchSetup.Bot` params; no rules changes unless a new behaviour is needed (then C++ + tests).

### 7.3.1 Balance procedure
1. Use `Tests/Tools/Balance` with `HumanModel` profiles (casual/average/skilled/spammer) for each opponent; targets (win rate for the average human): opponents 1–2: 85–95 %; 3–4: 70–80 %; 5–6: 50–60 %; 7–8: 35–45 %; 9: 25–35 %; 10: 15–25 %.
2. Compare against the **human reality**: closed-test win rates by opponent from telemetry (`bout_end` with `opponent_id`). Update targets from data.
3. Spammer profile must lose or draw to all but opponent 1–2 (exploit guard).
4. Document each profile in `Docs/Balance.md` with the measured table; regenerate after each rules change.

## 7.4 Player progression (career, unlocks, goals)

### 7.4.1 Career flow
- Menu → Карьера → map of 10 nodes. Node unlocks after winning the previous. Rewards: unlock item; star rating 1–3 by performance (stars: win; win without knockdown; win by KO).
- Save: `localStorage` + (if nickname set) synced via API `career_progress` table (ids and stars only).
- Retry freely; no energy; no losing items.

### 7.4.2 Cosmetics (no money)
- Robot colourways (primary/secondary/emissive) — implement as material parameter sets from a palette table; unlocked by career, streaks, ladder tier.
- Glove styles (texture variant).
- Arena variants: reuse the existing generators with different lighting presets (warm/cold/neon) to avoid new assets.
- Titles/badges next to nickname on the ladder.

### 7.4.3 Daily goals
- 3 goals/day from a table (e.g., "Land 15 hooks", "Win without being hit by a straight", "3 bouts completed", "Win a bout using only body shots"). Server-free: generated from date seed; progress local.
- Reward: 1 cosmetic token per day; 7 tokens = a colourway (choose).

### 7.4.4 Player stats
- Lifetime: bouts, wins, strikes by type, best combo, favourite strike, knockdowns, accuracy. Displayed on the profile page and in settings → "Моя статистика".

## 7.5 Training room (also a camera warm-up)

- Heavy bag (exists) + **combo trainer**: shows a target combo (e.g., "Л-П-Хук Л") with highlighted gloves; scores timing; works with keyboard and camera. Camera mode shows detection feedback after each strike (type recognised), thereby exposing misrecognition early — and making the owner's reports concrete.
- **Reaction trainer**: dummy throws telegraphed strikes; player must block/slip/duck; score by success.
- **Footwork drill** (keyboard): move around cones.

## 7.6 Round structure and match rules (keep, verify)

- Default bout: 3 rounds × 2 min (check `RoundTicks`), 30 s breaks, short mode 1 round × 90 s for quick play. Verify total time from tutorial to result ≤ 5 min for default "Быстрый бой".
- Knockdown: count to 10, player getting up mechanic; TKO after 3 knockdowns/round; judges' decision.
- Draw handling and results text.
- Verify all via `Tests/CoreRules` (exists); add tests for any change.

## 7.7 Audio (workstream)

Current: procedural WebAudio sounds (`audio.js`). Plan:
1. Inventory events needing sound: ui click/hover, bell start/end, countdown ticks, whoosh (jab/cross/hook/uppercut/kick/knee/elbow), hit light/heavy/body/head, block thud, slip swish, duck, footsteps (soft), knockdown thud + count voice (optional TTS-free numbers via procedural), crowd ambience layers (idle, cheer, gasp), win/lose stinger, rating up.
2. Quality bar: layered procedural + optionally CC0 recorded samples (freesound CC0, kenney.nl assets) — record licences in `/credits` and `Docs/Licenses.md`. No paid assets.
3. Mixing: master limiter, ducking of crowd under impacts, separate sliders (Master/Music/Effects).
4. Music: optional low-key looping track (CC0) at 40 % default, off in tutorial; skip if file size budget breaks.
5. Acceptance: loudness consistent (±3 dB between events), no clipping, no sound when tab hidden.

## 7.8 Visual polish (web)

- Robots: 2 IE-1 variants exist (Forge, Ember). Add colourways (material tint). Keep triangle budget.
- Ring/venue: existing pano + ring; add crowd silhouettes (instanced billboards, cheap) to avoid an empty hall; add subtle camera sway at round start.
- Lighting: confirm shadows readable; ensure robot silhouettes pop against the background (rim light).
- UI: consistent design tokens (colours, radius, type scale) in one CSS block; check dark industrial theme; remove any UI debris from the prototype.
- Animations: IK glitches were fixed; keep `qa.js animation` green; add test for new moves.
- Screenshot contract: marketing screenshots auto-generated via a script (`Tools/Build/Web/shots.js`) from fixed seeds for reproducibility.

## 7.9 Text and tips content

- 40 loading tips (RU/EN) in `tips.json`; tips avoid repetition (shuffle without repeats).
- Result tips: map of "what hurt most" → tip: e.g. `hook_hits >= 3` → "Хуки догоняют уклон. Нырни или блокируй".
- Opponent bios (career), tutorial prompts (file 03), error strings.

## 7.10 Balance of camera vs keyboard

- Keyboard is faster/more precise; camera is physical/imprecise. To avoid camera players being disadvantaged on the shared ladder: **separate ladders** (exists) and slightly more forgiving telegraph defaults in camera mode only if measured need (do not change core rules per control; use bot parameters for Easy/Normal with `control` hint? Prefer same rules, different ladders).
- Online duels: pair camera vs camera or keyboard vs keyboard by default; allow mixed with a label.

## 7.11 Retention features checklist (build only after Phase 4 gate)

- [ ] Streak counter (local)
- [ ] Daily goals (3/day)
- [ ] Career (10 opponents)
- [ ] Unlock colourways
- [ ] Weekly ladder reset + badges
- [ ] Ghost challenge link
- [ ] Clip share

## 7.12 Unreal and Codex coordination (not on the critical path of the web launch)

- Open handoffs: `Docs/Handoffs/2026-10-11_013_claude-to-codex_hooks-uppercuts-duck.md` (animation of hook/uppercut/duck, reactions `bThroughGuard`, `bDucked`), `012` (close-range animation + native merge).
- Unreal keyboard controller (`IronEchoPlayerController.cpp`, Claude-owned): add hooks (U/I), uppercuts (N/M), kicks (`,`/`.`), duck — after native fixes from 012 are merged, to avoid conflicts.
- Any new rule or field → contract version bump + journal + handoff; Unreal layer remains "uncompiled here".
- The web build is the shipped product for the demo; Unreal is a longer-term track (Steam). Do not let Unreal work delay the web launch.

## 7.13 Content production pipeline (cheap, repeatable)

| Content | Source | Command / tool | Output |
|---|---|---|---|
| Robot colourways | material parameter table | JS only | runtime tint |
| Arena variants | existing Blender generators (`Tools/Blender/Realistic`) | `blender -b -P ...` | panos/textures |
| Opponent portraits | render robot heads with colourway at 512×512 | headless Chromium capture script | PNG ≤ 40 KB |
| Trailer frames | `debugAdvance` fixed-step captures | `Tools/Build/Web/capture.js` (create) | frames → ffmpeg |
| Icons/OG images | canvas/PIL scripts | `Tools/Build/Web/brand.py` (create) | PNG |
All scripts must be deterministic; commit scripts, not large outputs (outputs go through the release build).

## 7.14 Acceptance for Phase 4 (experience)

- [ ] Tutorial + first bout flow measured on 5 strangers (≤ 45 s to first punch).
- [ ] Feel layers implemented behind a "Эффекты" setting; reduced-motion respected.
- [ ] Career with ≥ 5 opponents ready (all 10 desirable), balance table recorded.
- [ ] Training room with combo trainer.
- [ ] Audio inventory complete and mixed.
- [ ] Screenshots/trailer frames reproducible by script.
