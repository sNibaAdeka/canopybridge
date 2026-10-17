# 03 — UX SPECIFICATION (simple, clear, fast to start)

Design laws (apply to every screen):
1. **One decision per screen. One primary button.** Secondary actions are visually quieter text links.
2. **≤ 7 words per instruction.** Imperative verbs. No jargon.
3. **Show progress and a way out** on every multi-step flow ("Шаг 2 из 5", "Сменить на клавиатуру").
4. **Never a dead end.** Every error says what happened and offers one action.
5. **The game starts before the player is ready to read.** Teach by doing.
6. **First visit differs from later visits.** Remember choices; skip what was done.
7. **Camera is an upgrade, not a gate.**

## 3.1 First-run journey (target: ≤ 45 s to first punch)

```
Landing → [ИГРАТЬ] → Loading (≤ 8 s) → Menu → [В РИНГ] → Tutorial bout (dummy) → Real bout (Easy) → Results → [Реванш]
                                                    └→ [Камера (бета)] → Permission → Setup check → Calibration → Practice → Bout
```
Time budget (first visit, broadband): landing 3 s read → click → load 6 s → menu 2 s → bout starts 3 s → first punch ≤ 10 s later = ~25–35 s.

## 3.2 Landing page (`/`)

Layout (desktop 1280×720):
```
[logo IRON ECHO]                                   [Играть]  [Скачать для Windows]
-----------------------------------------------------------------------------
 H1:  Бей робота своими руками.            |  10 s muted looping gameplay video
 Sub: Бокс через веб-камеру. Бесплатно,    |  (poster = hero.jpg)
      без установки.                       |
 [ ИГРАТЬ СЕЙЧАС ]   (primary, large)      |
 Клавиатура или камера • Рейтинг • Онлайн  |
-----------------------------------------------------------------------------
 Как играть (3 icons)   Топ-10 недели   Отзывы/клипы
 footer: Конфиденциальность • Что нового • Discord • Для прессы
```
Rules:
- CTA above the fold at 1280×720 and at 390×844 (phone).
- No autoplay audio. Video muted, `playsinline`, `preload=metadata`.
- Show exactly two sentences about the camera: "Камера — бета. Видео остаётся на твоём устройстве."
- Weight of the landing ≤ 600 KB excluding video (video lazy).
- Copy variants P1–P4 (file 02) in a flag for A/B.

## 3.3 Loading screen

- Real progress: sum of bytes for core WASM, arena, robots, audio init; show percentage and a rotating tip every 3 s.
- Tips (RU): "Блок гасит прямые, но не апперкот.", "Хук догоняет уклон — нырни.", "Не бей в воздух: подойди ближе." "Камера: свет — спереди, не сзади."
- If load takes > 15 s: show "Медленное соединение. Попробуй лёгкую версию" button → loads `?lite=1` (fewer textures).
- On failure: "Не получилось загрузить игру. Проверь интернет." + [Повторить] + link "Скачать офлайн-версию".

## 3.4 Main menu (first visit)

Visible: **one** primary button `В РИНГ`. Below: text links `Камера (бета)` · `Настройки`. Footer: version, sound toggle, fullscreen.
Hidden by default (Settings): level, mode (bout/short/training), tracking accuracy, graphics, second camera, rating nickname, online duel.
Exception: nickname prompt appears once **after the first completed bout** (not before), as a result-screen card: "Назови себя — попадёшь в рейтинг" [Сохранить] [Не сейчас].
Returning visit: menu remembers last mode; shows `Продолжить карьеру`, `Быстрый бой`, `Рейтинг`, `Онлайн`.

Menu acceptance: at 1280×720 and 390×844 no scrolling, primary button ≥ 56 px tall, tab order correct, Enter starts.

## 3.5 Tutorial bout (first visit only; skippable with `Пропустить`)

Stage 0: ring with a **passive dummy** (bot level "Тренировка": no attacks).
Prompts (one at a time; each completes on success, shows ✓ and a short "good" sound):

| # | Prompt (RU) | Keyboard detection | Camera detection | Fail hint after 8 s |
|---|---|---|---|---|
| 1 | Ударь: нажми J | straight left | straight left | "Нажми J — левая рука" |
| 2 | Теперь правой: K | straight right | straight right | "K — правая рука" |
| 3 | Блок: держи Space | block ≥ 0.4 s | block pose ≥ 0.4 s | "Подними руки к лицу" |
| 4 | Уклон: Q или E | slip | head lateral | "Наклони голову вбок" |
| 5 | Хук: U | hook | hook | "Дугой сбоку, локоть вверх" |
| 6 | Шаг вперёд: W | move | lean forward | "Наклонись к экрану" |
Then: "Готов? Первый бой!" → Easy bot, one short round (60 s). Tutorial state saved in `localStorage` (`ironecho.tutorial=done`).
Camera tutorial shows the same steps but with body wording ("Ударь левой рукой вперёд").
Key overlay (small chips: `J K Q E U Space`) in the lower left during tutorial and the first bout only.

Acceptance: 5 first-time testers complete steps 1–3 without help in ≤ 40 s (record in `Docs/Testing/ONBOARDING_TESTS.md`).

## 3.6 Camera path (the most fragile flow — spend design effort here)

### Step 1 — Permission explainer (before the browser prompt)
```
Заголовок: Включим камеру
Текст:    Игра увидит твоё тело и повторит удары. Видео не покидает устройство.
          Нужно: свет спереди, 2–3 метра до камеры, видно голову и руки.
Кнопки:   [ Включить камеру ] (primary)    [ Играть с клавиатуры ] (secondary)
```
If permission denied → screen: "Доступ к камере закрыт. Нажми значок камеры в адресной строке → Разрешить. [Повторить] [С клавиатуры]".
If camera busy/not found → specific messages (section 3.10).

### Step 2 — Setup check (live preview, large 460 px)
Traffic-light chips, each updated live:
| Chip | Green | Yellow | Red | Tip text |
|---|---|---|---|---|
| Свет | centre luma ≥ 30 % | 20–30 % | < 20 % or backlit | "Включи свет перед собой / повернись к свету" |
| Дистанция | body height 45–85 % of frame | 35–45 / 85–95 | outside | "Отойди ещё на шаг / подойди ближе" |
| Тело в кадре | head, shoulders, elbows, wrists seen | wrists drop | head missing | "Встань по центру: нужны голова и руки" |
| Ноги | knees seen | — | not seen | "Ноги не видны: колени и удары ногой — с клавиатуры (можно отойти)" |
| Скорость | ≥ 24 к/с | 15–24 | < 15 | "Закрой лишние вкладки / включи лёгкую графику" |
A framing guide (dashed rectangle with "голова" and "бёдра" labels) is drawn over the preview.
Continue button `Дальше` becomes enabled when Свет, Тело, Скорость are not red. Otherwise show the first red tip in a large banner.

### Step 3 — Calibration (≤ 5 steps, ≤ 25 s total)
Header "Шаг N из 5". Each step shows: icon, one-line instruction, circular progress, ✓ when done.
1. Стойка: "Встань как боксёр и замри" (1.5 s hold)
2. Блок: "Подними перчатки к лицу" (0.7 s hold)
3. Уклон влево: "Наклони голову влево"
4. Уклон вправо
5. Удары: "Два быстрых удара левой, два правой — в экран"
If a step stalls for 10 s: gentle hint + `Пропустить шаг` (uses default thresholds, marks calibration as "basic").
Every step has `Назад` and `С клавиатуры`.

### Step 4 — Practice (10 s)
A heavy bag; live "засчитано ✓" flash per detected strike with the strike name; a mini panel shows how many of the last 5 movements were counted (confidence ring). If detection rate looks low (heuristic: ≥ 3 big arm movements with 0 detections), show "Бей резче и дальше вперёд" once.

### Step 5 — Go
"Готов? Бой!" → bout with a visible "Камера: хорошо / средне / плохо" chip in the corner (green/yellow/red) that links to tips.
Always-available keys: Esc pause; `Tab` toggles keyboard assist (arrow keys for movement while camera does strikes — "гибридный режим", see file 05).

## 3.7 In-bout UI (HUD) rules

- Top: both health bars, round timer, round number; centre: round score.
- Feed (bottom centre): short callouts (≤ 3 words): "ХУК!", "КОНТРУДАР", "НОКДАУН". Max two visible; auto-fade 1.3 s.
- Combo counter left; stamina not present (keep simple).
- Warnings (camera): "Не вижу тебя" center when lost > 1.5 s; "Темно" small chip.
- Pause overlay: Resume (primary), Restart, Menu, Settings, Report problem.
- Do not cover the robots; HUD within safe margins; text ≥ 16 px on 720p.

## 3.8 Results screen

Elements, in order:
1. Banner: ПОБЕДА / ПОРАЖЕНИЕ / НИЧЬЯ + method (KO, TKO, решение судей).
2. Rating: "1243 → 1268 (+25)" (if signed in), rank change.
3. Stats chips: ударов/попаданий, лучшая серия, нокдауны.
4. One tip based on what hurt most: e.g. "Тебя часто били хуками: нырни или уклонись в другую сторону."
5. Primary: `Реванш`. Secondary: `Поделиться`, `Следующий соперник` (career), `В меню`.
6. First time only: nickname card (3.4).

## 3.9 Settings screen (second level)

Groups (accordion, closed by default except first): Игра (level, mode), Камера (accuracy, assist level, test camera), Графика (auto/high/low/minimum, FPS cap), Звук (master, music, effects), Язык (RU/EN), Приватность (analytics on/off, delete my data), Лаборатория (`?lab=1` only: second camera).
Each setting has an auto default; "Сбросить" button.

## 3.10 Error and edge-case messages (RU / EN)

| Situation | RU message | Action |
|---|---|---|
| No WebGL | Браузер не поддерживает 3D. Открой в Chrome или Edge. | [Скопировать ссылку] |
| Camera denied | Доступ к камере закрыт. Разреши камеру в адресной строке. | [Повторить] [С клавиатуры] |
| Camera busy | Камеру использует другая программа. Закрой её. | [Повторить] [С клавиатуры] |
| No camera | Камера не найдена. Играй с клавиатуры. | [С клавиатуры] |
| Model failed to load | Не загрузилась модель распознавания. | [Повторить] [Лёгкая модель] |
| Slow camera (<15 fps) | Камера работает медленно. Включена лёгкая графика. | [Ок] |
| Lost player | Не вижу тебя. {причина} | — |
| Offline | Нет интернета. Рейтинг и онлайн недоступны, одиночная игра работает. | [Ок] |
| Storage blocked | Браузер блокирует сохранение. Настройки не запомнятся. | [Ок] |
| Online peer left | Соперник вышел. Победа засчитана? (rules decide) | [В меню] |
| Rating server error | Рейтинг временно недоступен. Бой не потерян, отправим позже. | — |
English parity for all (file `strings.en.json`).

## 3.11 Copywriting rules

- Voice: confident, friendly, short. "Бей." not "Вы можете нанести удар".
- Numbers as digits. Use thin spaces in thousands (1 243).
- Avoid: "калибровка" → "настроим камеру"; "детектор" → nothing; "задержка" → "отклик".
- Never blame the user: "Камера не видит ноги" not "Вы встали неправильно".
- Verbs for buttons: Играть, Продолжить, Повторить, Реванш, Поделиться.

## 3.12 Localization scheme

- `Tools/Build/Web/site/src/strings.ru.json`, `strings.en.json`; keys like `menu.play`, `camera.step.stance`.
- `t(key, params)` helper with `{name}` interpolation and plural rules (RU has 3 forms: 1, 2–4, 5+).
- Language: from `navigator.language` first visit, saved setting after; switch in Settings; no page reload.
- Build step verifies both files have the same keys; missing key fails the build.
- The single-file build embeds both languages (≤ 30 KB extra).

## 3.13 Accessibility

- Contrast ≥ 4.5:1 for text, ≥ 3:1 for large; check with automated script in QA.
- All menu actions reachable by keyboard; visible focus ring; `aria-label` on icon buttons; live region (`aria-live=polite`) for the feed.
- Reduced motion: respect `prefers-reduced-motion`: disable camera shake, screen flash; setting overrides.
- Colour-blind safe: hit indicator uses shape + colour (not red/green only).
- Audio cues for key events (bell, hit, knockdown count) so sound-off players still get text.
- Photosensitivity: no flashing > 3 Hz; the latency-flash test mode shows a warning.
- Touch targets ≥ 44 px; no hover-only actions.

## 3.14 Mobile and touch

- Phones: keyboard/touch pad only. Camera hidden on phones in v1 (show "Камера — на компьютере").
- Touch pad layout: left stick/footwork buttons, right: Jab, Cross, Hook, Uppercut, Block (hold), Slip left/right.
- 30 fps cap and `low` graphics by default; portrait → ask to rotate.
- Test on 360×640, 390×844, 412×915, tablets 768×1024; no horizontal scroll (QA already tests 390×844 and 844×390).

## 3.15 Game-start speed tricks

- Preload the menu scene first; stream the arena/robots after the menu is interactive; show the menu as soon as it is ready.
- Cache with service worker (file 06) so repeat visits go from click to menu in ≤ 2 s.
- Remember the last control choice; "Продолжить" skips the menu on return visits (setting: "Сразу в бой").

## 3.16 UX acceptance tests (write these as scripted playwright flows + human charters)

1. Landing → menu in ≤ 8 s (SwiftShader proxy ≤ 20 s).
2. Menu → `Enter` → fight starts; first punch by `J`.
3. Tutorial completes with scripted keys; state persisted; second visit skips tutorial.
4. Camera denied flow shows message and returns to menu with keyboard.
5. Settings persist across reload; reset works.
6. Language switch updates all visible strings (no key leaks like `menu.play`).
7. 390×844 and 1280×720: no scroll, no clipped text (existing QA + screenshot diff).
8. Human charter: 5 strangers, no help; stopwatch from page open to first punch; record quotes of confusion.
