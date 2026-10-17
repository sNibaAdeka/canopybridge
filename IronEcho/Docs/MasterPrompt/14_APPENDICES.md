# 14 — APPENDICES (copy deck, data, templates, glossary)

## A. Copy deck — Russian / English (seed for `strings.*.json`)

### A.1 Menu and navigation
| Key | RU | EN |
|---|---|---|
| menu.play | В РИНГ | FIGHT |
| menu.camera | Камера (бета) | Camera (beta) |
| menu.settings | Настройки | Settings |
| menu.career | Карьера | Career |
| menu.quick | Быстрый бой | Quick fight |
| menu.ladder | Рейтинг | Ladder |
| menu.online | Онлайн-дуэль (бета) | Online duel (beta) |
| menu.training | Тренировка | Training |
| menu.version | версия {v} | version {v} |
| menu.fullscreen | Во весь экран | Fullscreen |
| menu.sound.on | Звук: вкл | Sound: on |
| menu.sound.off | Звук: выкл | Sound: off |

### A.2 Tutorial
| Key | RU | EN |
|---|---|---|
| tut.jabL | Ударь левой: J | Throw a left: J |
| tut.crossR | Теперь правой: K | Now a right: K |
| tut.block | Блок: держи Пробел | Block: hold Space |
| tut.slip | Уклон: Q или E | Slip: Q or E |
| tut.hook | Хук: U | Hook: U |
| tut.step | Шаг вперёд: W | Step in: W |
| tut.ok | Отлично! | Nice! |
| tut.hint.jab | Нажми J — левая рука | Press J — left hand |
| tut.ready | Готов? Первый бой! | Ready? First fight! |
| tut.skip | Пропустить | Skip |
| tut.cam.jabL | Ударь левой рукой вперёд | Punch forward with your left |
| tut.cam.block | Подними руки к лицу | Bring your hands to your face |
| tut.cam.slip | Наклони голову вбок | Lean your head to the side |

### A.3 Camera onboarding
| Key | RU | EN |
|---|---|---|
| cam.title | Включим камеру | Let's turn on the camera |
| cam.privacy | Игра увидит твоё тело и повторит удары. Видео остаётся на твоём устройстве. | The game sees your body and mirrors your punches. Video stays on your device. |
| cam.need | Нужно: свет спереди, 2–3 метра до камеры, видно голову и руки. | You need: light in front, 2–3 m from the camera, head and hands visible. |
| cam.enable | Включить камеру | Enable camera |
| cam.keyboard | Играть с клавиатуры | Play with keyboard |
| cam.setup.light | Свет | Light |
| cam.setup.distance | Дистанция | Distance |
| cam.setup.body | Тело в кадре | Body in frame |
| cam.setup.legs | Ноги | Legs |
| cam.setup.speed | Скорость | Speed |
| cam.tip.dark | Темно (яркость {p} %): включи свет перед собой | Too dark ({p} %): turn on a light in front of you |
| cam.tip.backlit | Свет сзади: повернись лицом к свету | Light behind you: face the light |
| cam.tip.dim | Тусклый свет: добавь освещения | Dim light: add more light |
| cam.tip.far | Отойди на шаг назад | Step back |
| cam.tip.close | Подойди ближе | Come closer |
| cam.tip.center | Встань по центру кадра | Stand in the middle of the frame |
| cam.tip.legs | Ног не видно: колени и удары ногой — с клавиатуры | Legs not visible: knees and kicks via keyboard |
| cam.step | Шаг {n} из {m} | Step {n} of {m} |
| cam.step.stance | Встань как боксёр и замри | Stand like a boxer and hold still |
| cam.step.block | Подними перчатки к лицу | Raise your gloves to your face |
| cam.step.slipL | Наклони голову влево | Lean your head left |
| cam.step.slipR | Наклони голову вправо | Lean your head right |
| cam.step.punch | Два быстрых удара левой, два правой — в экран | Two fast lefts, two rights — toward the screen |
| cam.step.skip | Пропустить шаг | Skip step |
| cam.practice | Потренируйся на груше | Warm up on the bag |
| cam.counted | Засчитано: {strike} | Counted: {strike} |
| cam.lost | Не вижу тебя | I can't see you |
| cam.lost.weak | Плохо вижу тебя | I can barely see you |
| cam.quality.good | Камера: хорошо | Camera: good |
| cam.quality.mid | Камера: средне | Camera: fair |
| cam.quality.bad | Камера: плохо | Camera: poor |
| cam.switch | Сменить на клавиатуру | Switch to keyboard |

### A.4 Bout and results
| Key | RU | EN |
|---|---|---|
| bout.round | Раунд {n} | Round {n} |
| bout.knockdown | НОКДАУН | KNOCKDOWN |
| bout.ko | НОКАУТ | KNOCKOUT |
| bout.tko | ТЕХНИЧЕСКИЙ НОКАУТ | TKO |
| bout.decision | РЕШЕНИЕ СУДЕЙ | DECISION |
| bout.win | ПОБЕДА | VICTORY |
| bout.lose | ПОРАЖЕНИЕ | DEFEAT |
| bout.draw | НИЧЬЯ | DRAW |
| res.rating | Рейтинг {a} → {b} ({d}) | Rating {a} → {b} ({d}) |
| res.rematch | Реванш | Rematch |
| res.share | Поделиться | Share |
| res.next | Следующий соперник | Next opponent |
| res.menu | В меню | Menu |
| res.nick.title | Назови себя — попадёшь в рейтинг | Pick a name — join the ladder |
| res.nick.save | Сохранить | Save |
| res.nick.later | Не сейчас | Not now |
| feed.hook | ХУК! | HOOK! |
| feed.upper | АППЕРКОТ! | UPPERCUT! |
| feed.counter | КОНТРУДАР | COUNTER |
| feed.dodged | МИМО | MISSED |
| feed.blocked | БЛОК | BLOCKED |
| feed.hookCatchesSlip | ХУК ДОГНАЛ УКЛОН | HOOK CAUGHT THE SLIP |
| feed.duckedUpper | НЫРНУЛ ПОД АППЕРКОТ | DUCKED INTO UPPERCUT |

### A.5 Errors
(See file 03 §3.10; keys `err.webgl`, `err.camera.denied`, `err.camera.busy`, `err.camera.none`, `err.model`, `err.slow`, `err.offline`, `err.storage`, `err.peer.left`, `err.rating`.)

### A.6 Tips (rotating on loading; 40 items — seed list of 20)
1. Блок гасит прямые, но половина апперкота проходит.
2. Хук догоняет уклон — нырни или поставь блок.
3. Нырок спасает от хука, но апперкот накажет.
4. Не бей в воздух: подойди ближе.
5. Бот запоминает, как ты защищаешься. Меняй защиту.
6. Камера: свет спереди, не сзади.
7. Камера: отойди на 2–3 метра, чтобы были видны руки.
8. Бей резко и возвращай руку к лицу.
9. Уклон работает вбок, нырок — вниз.
10. Колени и локти — только вплотную.
11. Нокдаун — не конец: вставай, держа блок.
12. Телеграф бота виден за долю секунды до удара.
13. Контрудар сильнее, если соперник промахнулся.
14. Быстрая серия лучше одного сильного удара.
15. Устал? Сделай шаг назад и отдышись.
16. Фон за спиной лучше без окна.
17. Ник в рейтинге можно сменить раз в 30 дней.
18. F3 покажет, почему камера тормозит.
19. F4 сохранит запись камеры для разбора.
20. Играй в Chrome или Edge — камера там стабильнее.

## B. Event JSON examples (for tests and documentation)

```json
{"v":"1.7.0","a":"7f3c…","s":"a91e…","ua":"chrome-win","gpu":"intel-uhd","events":[
 {"type":"page_open","props":{"lang":"ru","cached":false},"t":1760700000000},
 {"type":"game_loaded","props":{"ms":6400,"cached":false,"bytes":5400000},"t":1760700006400},
 {"type":"bout_start","props":{"mode":"bout","control":"keys","level":0,"tutorial":true},"t":1760700012000},
 {"type":"first_punch","props":{"ms_since_start":4200,"control":"keys"},"t":1760700016200},
 {"type":"bout_end","props":{"result":"win","method":"ko","rounds":1,"duration":74,"control":"keys","level":0,"thrown":41,"landed":22,"knockdowns":1},"t":1760700090000}
]}
```

## C. SQL migrations (starter set)

`001_events.sql` (see file 08 §8.2.2), plus:
```sql
-- 002_feedback.sql
create table if not exists public.feedback (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  anon_id text, category text not null, text text not null check (char_length(text) <= 500),
  tech jsonb default '{}'::jsonb, trace_id text
);
alter table public.feedback enable row level security;

-- 003_trace_index.sql
create table if not exists public.trace_index (
  id text primary key, ts timestamptz not null default now(), participant text, size integer, game text, condition text
);
alter table public.trace_index enable row level security;

-- 004_ghosts.sql
create table if not exists public.ghosts (
  id text primary key, ts timestamptz not null default now(), nickname text, rating integer, size integer
);
alter table public.ghosts enable row level security;

-- 005_weekly.sql
create table if not exists public.rating_week (
  week text, nickname text, ladder text, delta integer not null default 0, games integer not null default 0,
  primary key (week, nickname, ladder)
);
alter table public.rating_week enable row level security;
```
Storage buckets (private): `traces`, `ghosts`. Policies: none for anon; service key only.

## D. Test case catalogue (to turn into automated tests where possible)

### D.1 Onboarding
1. Fresh profile (cleared storage): landing → CTA → menu shows exactly one primary button.
2. `Enter` on menu starts tutorial; tutorial prompt 1 visible within 1 s of ring appearing.
3. Completing steps via keys marks ✓; each hint appears after 8 s idle.
4. `Пропустить` leads to first bout; flag saved; reload skips tutorial.
5. Language switch RU↔EN changes menu, tutorial, results strings; no raw keys.
6. 390×844: all primary buttons visible without scrolling.

### D.2 Camera
1. Permission denied → message + keyboard fallback; no console errors.
2. No camera device (fake device off) → message.
3. Setup check red light blocks `Дальше` and shows the first tip.
4. Calibration with synthetic body completes in ≤ 25 s of video; step counter shows 1..5.
5. Lost player 2 s mid-bout → banner; 1 s → no banner; return clears banner.
6. Camera fps < 15 simulated (stub detector delay) → tier drop + message.
7. `?collect=1` end-to-end with synthetic fighter produces a valid session.
8. F4 saves trace; replay produces same calibration.

### D.3 Rules/UX
1. Pause/resume via Esc and button; blur pause.
2. Reduced-motion on → no shake/flash (DOM/camera offset assertions).
3. Reduce sound: master 0 → no AudioContext output (stub).
4. Rematch resets state; results card consistent with core snapshot.
5. Training room combo trainer: correct combos register timing.

### D.4 Platform
1. Telemetry opt-out stops requests (network assertion).
2. Rating: first bout → nickname card; second ladder isolation.
3. Offline during rating submit → queued, resubmitted when online.
4. Ghost link opens, plays, ends with comparison.
5. Feedback form posts; text > 500 rejected.

### D.5 Performance
1. Menu ready under budget (SwiftShader scaled).
2. Service worker serves 2nd load from cache; offline reload works.
3. Tier governor transitions under injected slow frames.
4. 20-bout soak: no growth in `renderer.info.memory` counts.

### D.6 Security
1. XSS strings in nickname/feedback rendered as text.
2. Oversized payloads → 400; malformed JSON → 400; rate limit → 429.
3. CORS from a foreign origin rejected on mutating endpoints.
4. Admin page without token → 401; wrong token → 401 with constant-time compare (timing test coarse).

## E. Glossary

| Term | Meaning |
|---|---|
| Core | deterministic C++ rules engine (`IronEchoRules`), 120 Hz |
| WASM | WebAssembly build of the core used in the browser |
| IER2 | the 22-byte-per-row input recording format for bouts |
| Rollback | netcode technique: simulate predicted inputs, re-simulate on correction |
| World landmarks | MediaPipe 3D joint positions in metres, hip-centred |
| Image landmarks | MediaPipe 2D normalised positions in the frame |
| OneEuro | adaptive low-pass filter balancing jitter and lag |
| Trace | skeleton recording saved with F4 |
| Session (collect) | labelled recording from Collection Mode |
| Golden set | small committed real-data segments guarding accuracy |
| Tier | graphics quality level (high/low/minimum) |
| Gate | measurable condition required to proceed to the next phase |
| Ladder | Elo ranking (keyboard and camera separate) |
| Ghost | replay of a recorded player used as an opponent |
| Handoff | markdown file sent to Codex through `Docs/Handoffs` |
| Lab flag | `?lab=1` unhides experimental features |

## F. Commit message template

```
<Short imperative summary, ≤ 72 chars>

Why: <1–3 lines about the problem or goal, including the owner's report if any>
What: <bullet list of changes>
Verified here: <suites with counts>; <numbers before → after>
Not verified: <real camera / device / browser…>

Co-Authored-By: <as given by the environment>
Claude-Session: <as given by the environment>
```

## G. Weekly report template (to the owner, Russian)

```
Неделя N — итоги
Сделано: …
Цифры: точность камеры (прямые/хуки/апперкоты) X/Y/Z %, задержка p50/p95 A/B мс, FPS на слабом ноутбуке C, воронка …
Проверено здесь: …
Не проверено / нужен человек: …
Решения для тебя: …
План на следующую неделю: …
Риски: …
```

## H. Gate report template

```
Gate K — <название>
Критерии: 1) … (цель X) → факт Y ✓/✗; 2) …
Решение: пройден / пройден с оговорками (какими) / не пройден (что делаем)
Подпись владельца: ______ (дата)
```

## I. Estimating effort (for sanity)

| Package | Typical effort (focused AI days) |
|---|---|
| Telemetry + API + tests | 1 |
| Collection Mode + schema + tests | 2 |
| Evaluation harness + plotting + golden | 2 |
| Latency mode + analysis | 1 |
| CI + verify.py + env | 1 |
| Camera loop (per iteration) | 2–3 |
| Pre-wind-up intent | 1 |
| Loading split + SW | 2 |
| Tier governor | 1 |
| UX rebuild (menu, tutorial, onboarding) | 3–4 |
| Localization | 1–2 |
| Feel layers + audio | 2–3 |
| Career + cosmetics + goals | 3–4 |
| Share (clip, card, ghost) | 3 |
| Profile/leaderboard/weekly | 2 |
| Legal/press/changelog pages | 1–2 |
| Release script + docs | 1–2 |
These are not promises; they exist to detect scope explosions early (if a package exceeds 2× its estimate, stop and report).

## J. Reference links (verify before use; they may change)

- MediaPipe Pose Landmarker (web): developers.google.com/mediapipe/solutions/vision/pose_landmarker/web_js
- One Euro Filter paper: cristal.univ-lille.fr/~casiez/1euro/
- Rollback netcode primer (GGPO): ggpo.net
- Web Share API, MediaRecorder, CompressionStream, Service Workers: MDN
- Supabase REST/Storage docs: supabase.com/docs
- Vercel functions docs: vercel.com/docs/functions
When you cite documentation, fetch it first (if the network allows) rather than recalling it from memory.
