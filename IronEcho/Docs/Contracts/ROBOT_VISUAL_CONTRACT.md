# ROBOT_VISUAL_CONTRACT — геймплей ↔ графика

| | |
|---|---|
| Версия | **1.1** (`IRONECHO_VISUAL_CONTRACT_VERSION = 1`, `IRONECHO_VISUAL_CONTRACT_MINOR = 1`; поля `SchemaVersion`/`SchemaMinor`) |
| Писатель | Claude (Codex запрашивает изменения через `Docs/Handoffs` или берёт блокировку в `LOCKS.md`) |
| Читатель | Codex |
| C++ API | `Source/IronEcho/Public/`: `IronEchoTypes.h`, `IronEchoVisualConfig.h`, `IronEchoRobotAnimInstance.h`, `IronEchoGameState.h`, `IronEchoGameMode.h`, `IronEchoFighter.h`, `IronEchoRingAnchor.h`, `IronEchoPunchingBag.h` |

Художественные решения (силуэт, стиль, материалы, свет, композиция, VFX, звук-в-визуале, UI-дизайн) — за Codex.
Этот документ фиксирует только то, на что опирается геймплей.

## 1. Как подключается графика (без правки кода и чужих карт)

1. Codex создаёт data asset `/Game/Art/Config/DA_IronEchoVisuals` класса `UIronEchoVisualConfig`
   (путь задан в `DefaultGame.ini` → `UIronEchoSettings::VisualConfig`).
2. Поля (все необязательные; без них работают технические заглушки):

| Поле | Тип | Требование |
|---|---|---|
| `PlayerRobotMesh` | SkeletalMesh | §3–§4 |
| `OpponentRobotMesh` | SkeletalMesh | если пусто — используется PlayerRobotMesh |
| `RobotAnimClass` | AnimInstance class | родитель **`UIronEchoRobotAnimInstance`** |
| `PunchingBagMesh` | StaticMesh | §9 |
| `GameCameraClass` | Actor class | §8 |
| `HudWidgetClass` | UserWidget class | создаётся и добавляется на экран игрой |
| `MenuWidgetClass` | UserWidget class | зарезервировано для меню (v1: подключим при интеграции) |
| `bHideDebugOverlay` | bool | скрыть теховерлей, когда есть HUD Codex (F3 всё равно переключает) |

3. Арена — отдельная карта Codex (§10). Её делает стартовой Claude при интеграции (`DefaultEngine.ini`).

## 2. Единицы, оси, порядок обновления

- 1 uu = 1 см, Z вверх. Робот в пространстве компонента меша **смотрит в +X**, правая сторона робота — +Y.
- Корень (`root`) — на полу между стопами. Позицию и поворот актора задаёт только геймплей: **root motion запрещён**,
  перемещать актор нельзя, коллизии у роботов нет (NoCollision).
- Линия боя — ось +X якоря ринга: игрок на −X смотрит в +X, соперник на +X смотрит в −X.
- Каждый кадр (TG_PrePhysics) GameMode шагает правила (120 Гц), затем вызывает `AIronEchoFighter::ApplyVisualState`,
  затем рассылает события; AnimBP читает состояние в `NativeUpdateAnimation` того же кадра.

## 3. Масштаб и пропорции (для честного контакта)

| Параметр | Значение геймплея | Требование к роботу |
|---|---|---|
| Дистанция между центрами | 135 см (мин. 100 см) | радиус корпуса ≤ 35 см, чтобы не пересекаться на 100 см |
| Дальность прямого | 145–150 см от центра до центра | вытянутый `fist_*` должен доставать до `hit_head` соперника на 135 см (через IK, см. `DistanceToOpponent`) |
| Рост | — | рекомендовано 190–230 см (голова), плечи 155–185 см |
| Длина руки (upperarm→hand) | измеряется `UIronEchoRobotAnimInstance::ArmLengthCm` | 55–80 см |
| Свободная линия | ±260 см от центра ринга | см. §10 |

## 4. Скелет и сокеты

Обязательные кости (имена совместимы с UE5 Manny; дополнительные кости разрешены):
`root, pelvis, spine_01, spine_02, spine_03, neck_01, head, clavicle_l, upperarm_l, lowerarm_l, hand_l,
clavicle_r, upperarm_r, lowerarm_r, hand_r, thigh_l, calf_l, foot_l, thigh_r, calf_r, foot_r`.
При загрузке меша игра пишет в лог `LogIronEcho: Error ... violates ROBOT_VISUAL_CONTRACT: missing bone` для каждой отсутствующей.

| Сокет | Кость | Где | Используется для |
|---|---|---|---|
| `fist_l`, `fist_r` | hand_l / hand_r | центр ударной поверхности кулака, +X — направление удара | VFX удара, `GetFistLocation` |
| `hit_head` | head | центр головы | точка попадания (`ImpactLocation`) |
| `hit_body` | spine_03 | центр груди | резерв (удары в корпус после v1) |
| `fx_core`, `cam_focus` | любые | по желанию | свободно для Codex |

## 5. AnimBP: что приходит и что обязан делать

Родитель — `UIronEchoRobotAnimInstance`. Доступно (только чтение):

- `VisualState` (`FIronEchoFighterVisualState`):

| Поле | Смысл |
|---|---|
| `Role`, `MatchPhase` | игрок/соперник; фаза матча (для idle, празднования, поражения) |
| `ActionState` | Guard, Attack, Block, HitStun, BlockStun, KnockedOut, **KnockedDown** (1.1) |
| `AttackStage`, `AttackHand` | None/Windup/Active/Recovery; рука |
| `AttackStageAlpha` | 0→1 внутри текущей стадии — **единственный источник времени удара** |
| `AttackStageDuration` | длительность стадии, с (уже с учётом усталости/промаха) |
| `AttackId`, `bAttackTired` | новый удар = новый id; «вялый» удар |
| `StunRemaining` | сколько осталось стана |
| `bBlocking`, `BlockAlpha` | блок и сглаженный вес |
| `Dodge`, `bDodgeEffective` | направление уклона; действует ли он |
| `LeanLateral`, `LeanForward` | непрерывное повторение корпуса игрока (−1..1); у бота уклон ±0.8 |
| `HandTargetLeft/Right`, `HandTrackingAlphaLeft/Right` | цели кистей в длинах руки и вес следования |
| `Health01`, `Stamina01`, `bKnockedOut` | |
| `bKnockedDown`, `KnockdownsSuffered` (1.1) | на настиле во время счёта; число нокдаунов в бою |
| `ComboCount` (1.1) | текущая серия чистых попаданий этого бойца |
| `DistanceToOpponent` | см, для IK дотягивания |
| `LastHitTakenTime`, `LastHitTakenFromHand`, `HitsTaken`, `LastBlockTime` | реакции: изменение времени = новое событие |

- `HandIKTargetLeft/Right` — те же цели, переведённые в компонентное пространство (см) по длине руки скелета.
- `ArmLengthCm`, `bHasGameplayState`.

Обязательства AnimBP:
1. Тайминг ударов — из `AttackStageAlpha` (например, Sequence Evaluator с явным временем или монтаж с play rate
   = длина клипа / `AttackStageDuration`). Свои таймеры для решения «попал/не попал» не использовать: попадание
   решают правила в первом тике `Active`.
2. **Телеграф бота**: замах соперника (0.32–0.65 с по сложности) должен читаться за ~0.25 с до удара
   (отвод плеча, подсветка, звук — на выбор Codex). Иначе человек не сможет уклониться — это геймплейное требование.
3. Стойка игрока: при `HandTrackingAlpha* = 1` кисти следуют `HandIKTarget*` (Two Bone IK или аналог),
   корпус — `LeanLateral/LeanForward`. Во время своего удара, стана и KO вес 0.
4. Реакции на попадание/блок — по изменению `LastHitTakenTime` / `LastBlockTime` (или событиям §7).
6. (1.1) Нокдаун: при `bKnockedDown` — падение и поза на настиле, по событию `GotUp` — подъём (≈1 с, столько длится
   «бокс!»-пауза `ResumeIn`). Нокаут (`bKnockedOut`) — финальное падение без подъёма.
5. Без root motion; позицию по линии задаёт геймплей.

## 6. Данные HUD

`AIronEchoGameState::GetHudState()` → `FIronEchoHudState`:
`Mode` (Bout/Training), `BotLevel`, `Phase`, `ResumePhase`, `PauseReason` (Manual/TrackingLost), `Round`, `Rounds`,
`RoundTimeRemaining`, `CountdownRemaining`, `BreakRemaining`, `ScorePlayer`, `ScoreOpponent`, `Result`
(KnockOut/Decision/Draw), `bHasWinner`, `Winner`, `TrainingHits`, `Player`/`Opponent` (`Health`, `MaxHealth`,
`Stamina`, `MaxStamina`, `ActionState`, `PunchesThrown`, `PunchesLanded`, `DodgesMade`, 1.1: `BlocksMade`, `CounterHits`,
`ComboCount`, `MaxCombo`, `KnockdownsSuffered`, `bKnockedDown`) и `Tracking`
(`InputSource`, `Status`, `CalibrationStep`, `CalibrationProgress`, `CalibrationFailure`, `bMirrorApplied`, `LastError`,
`bTrackerProcessRunning`, `CameraFps`, `InferenceMs`, `PipelineLatencyMs`, разрешение, модель, счётчики пакетов).

1.1: `Decision` (Unanimous/Split/Majority), `JudgeScoresPlayer[3]` / `JudgeScoresOpponent[3]` (судья 1 нейтральный — по урону,
2 — за объём попаданий, 3 — за защиту), `KnockdownCount` (0..10), `GetUpProgress` (0..100 — игрок держит защиту, чтобы встать),
`ResumeIn` (с до продолжения после подъёма).

Тексты калибровки и статусов — `INPUT_CONTRACT.md` §4 и §8 (RU/EN). Нокдаун игрока: «Поднимите руки в защиту и держите,
чтобы встать» / «Raise and hold your guard to get up». Обязательно показывать: шаг калибровки с прогрессом,
причину паузы (особенно «Встаньте в кадр»), отсчёт, раунд/время/счёт, итог и подсказку реванша.

## 7. События

`AIronEchoGameState::OnCombatEvent(FIronEchoCombatEvent)`. Для контактных событий (HitConfirmed, Blocked, GuardBroken,
Dodged, Whiffed) `Actor` — атакующий, `Target` — защитник: эффект и реакцию рисовать на `Target`.
GuardBroken всегда сопровождается HitConfirmed того же удара — эффект рисовать один раз (по HitConfirmed).

| Type | Когда | Рекомендуемая реакция (решает Codex) |
|---|---|---|
| AttackStarted / AttackActive / AttackRecovery / AttackFinished / AttackCancelled | стадии удара (`Actor`, `Hand`, `AttackId`) | свисты, след кулака, телеграф бота на AttackStarted |
| **HitConfirmed** | подтверждённый контакт (`ImpactLocation`, `ImpactDirection`, `Damage`, `bCounterHit`, `TargetHealthAfter`) | удар, искры, тряска камеры |
| Blocked / GuardBroken | блок / пробитие блока | блок-VFX / пробитие |
| Dodged / Whiffed | уклон / недотянулся | «промах»-VFX |
| KnockedOut | нокаут | финальная камера |
| StaminaExhausted | выносливость 0 | индикатор усталости |
| BlockStarted/Ended, DodgeStarted/Ended | начало/конец защиты | |
| **KnockedDown** (1.1) | здоровье 0 → нокдаун (`KnockdownNumber`) | падение, замедление, «вспышка» |
| **GotUp** (1.1) | встал до счёта 10 | подъём, реакция зала |
| InputDropped | буферизованный удар истёк | (по желанию) |

`OnMatchEvent(FIronEchoMatchEvent)`: `PhaseChanged`, `RoundStarted`, `RoundEnded` (счёт, победитель раунда),
`MatchEnded` (Method: KnockOut / TechnicalKnockOut / Decision / Draw; Winner; Decision), `Paused` (Reason), `Resumed`,
`CountdownTick` (3, 2, 1), **`KnockdownCount`** (1.1: `CountdownSeconds` = 1..10, `Downed` = кто на настиле).
`HitConfirmed` несёт `ComboCount` (1 = одиночный, 2+ = серия) — для «3-HIT COMBO» и нарастающих эффектов.
В тренировке `HitConfirmed` по груше приходит с `Target = Opponent`, `ImpactLocation` = точка груши.

## 8. Команды для меню и камера

GameMode (BlueprintCallable): `StartBout(BotLevel)`, `StartTraining()`, `TogglePause()`, `RequestPause()`,
`RequestResume()`, `RequestRematch()`, `RequestCalibration(bFull)`, `SetInputSource(Tracker|Keyboard)`;
чтение: `GetHudState()`, `GetFighter(Role)`. Трекинг: `UIronEchoTrackingSubsystem` (`RequestCalibration`,
`CancelCalibration`, `SetTrackerPreview`, `GetTrackingHud`).

Камера (`GameCameraClass`): актор с `UCameraComponent`, спавнится в трансформе ринга и становится view target.
Читает `GameState->GetRingTransform()` и `GetFighter(...)`, не двигает бойцов и не влияет на геймплей.
Рекомендация для игры камерой тела: вид из-за плеча игрока, оба робота и груша в кадре.

## 9. Груша (тренировка)

`PunchingBagMesh`: pivot в точке подвеса сверху, висит вдоль −Z, высота подвеса 260 см над полом, ударная зона на
высоте головы (~150–190 см). Качание делает C++ (маятник по событию HitConfirmed), коллизия не нужна.

## 10. Карта арены

- Путь: `/Game/Art/Maps/L_Arena` (Codex). Ровно один `AIronEchoRingAnchor` в центре ринга, +X вдоль линии боя,
  `UsableHalfLength` ≥ 260 см (меньше — геймплей сократит линию и запишет предупреждение).
- В World Settings **не** ставить GameMode override.
- Свободная зона: ±(UsableHalfLength + 40) см по X и ±120 см по Y от якоря, высота 260 см (груша, головы роботов).
- Геймплейных акторов (роботов, грушу, PlayerStart) на карту не ставить — их создаёт GameMode.
- Без якоря игра строит техзал (пол, 4 стойки, свет) в начале координат.

## 11. Производительность

Цель — 60 fps в 1080p на целевом ПК (i5-12400F, RTX 3050, 32 ГБ). **VRAM не измерена** (у RTX 3050 бывают 8 ГБ и 6 ГБ);
бюджет появится после `Tools/Build/Measure-Hardware.ps1` в `PROJECT_STATE.md`. Трекер занимает ≈ 1 ядро CPU
(MediaPipe full) — CPU-бюджет игры меньше обычного. До замера никакие цифры не обещаются.

## 12. Проверка соответствия

- **Самопроверка робота до коммита:** в редакторе `py "<путь>/Tools/Unreal/Tech/validate_robot.py" /Game/Art/Robots/<меш>`
  (без аргумента — меши из `DA_IronEchoVisuals`). Проверяет кости, сокеты, рост, пол, Z-вверх, левую/правую сторону;
  результат — `Saved/Probe/robot_validation.json` и строки `IRONECHO_ROBOT` в логе. Ошибки = нарушение контракта.
- В логе при загрузке меша: ошибки об отсутствующих костях, предупреждения об отсутствующих сокетах.
- Автотест `IronEcho.Contract.EnumsAndSettings`, пробник `Tools/Unreal/Tech/ue_connection_probe.py`
  (видит ли редактор `DA_IronEchoVisuals`).
- Проверка в игре: F3 — теховерлей; F1 — клавиатура (J/K, Space, A/D) для просмотра анимаций без камеры.

## 13. Изменения контракта

- MAJOR: переименование/удаление полей, костей, сокетов, смена осей/единиц. MINOR: новые поля/события/сокеты.
- Запрос Codex → handoff `*_codex-to-claude_*` с секцией «Запрос изменения контракта» (что, зачем, совместимость).
- Claude вносит изменение (C++ + документ + журнал), поднимает версию, пишет ответный handoff.

## Журнал

| Версия | Дата | Изменение |
|---|---|---|
| 1.0 | 2026-10-02 | Первая версия |
| 1.1 | 2026-10-02 | Нокдауны и счёт (ActionState KnockedDown, Phase Knockdown, события KnockedDown/GotUp/KnockdownCount), TKO, три судьи и тип решения, комбо и расширенная статистика. Только добавления в конец перечислений — совместимо с 1.0 |
| 1.1 (уточнение) | 2026-10-04 | Без изменения API: явно записано, что в контактных событиях Actor = атакующий, Target = защитник, и что GuardBroken дублируется HitConfirmed (так уже работало; найдено при интеграции адаптера камеры Codex) |
