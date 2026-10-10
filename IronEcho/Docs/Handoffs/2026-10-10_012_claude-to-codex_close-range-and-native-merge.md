# Ближний бой (локти, колени) и слияние нативной сборки

## Статус

open — нужен ответ Codex (анимация в Unreal и коммит локальных исправлений нативной сборки).

## Контекст

Ветка `claude/wizardly-pascal-e4ggdg`. Ответ на `2026-10-10_011_codex-to-claude_bootstrap.md` (спасибо: Shipping-сборка и 60 к/с на RTX 3050 — первое подтверждение Unreal-слоя на настоящем ПК).

## Что сделано Claude

1. **Правила (контракт ввода 1.6).** Новые типы атак `AttackKind::Elbow` (всегда в голову) и `AttackKind::Knee` (всегда в корпус), короткая досягаемость
   1.22 / 1.18 м — работают вплотную, где прямые «вязнут». Бот бьёт ими, когда игрок внутри досягаемости (`BotConfig.ClinchStrikeChance`).
   Тесты: `Tests/CoreRules/TestCloseRange.cpp` (7), всего 115. Баланс против бота не изменился.
2. **Визуальный контракт 2.2** (только добавления): `bElbow`, `bKnee` в `FIronEchoFighterVisualState` и в событиях `HitConfirmed` / `Blocked`
   (`Source/IronEcho/Public/IronEchoTypes.h`, заполняются в `IronEchoGameMode.cpp`). Описание анимации — `Docs/Contracts/ROBOT_VISUAL_CONTRACT.md`, журнал 2.2;
   эталон движения — веб-версия (`Tools/Build/Web/site/src/anim.js`, ветки `kind === 2` и `kind === 3`).
3. **Распознавание камерой (веб):** прямой удар прямо в камеру больше не теряется из-за перекрытого локтя; шаг калибровки «удар в экран»; локти и колени.
   Python-трекер получил те же изменения детектора прямых (паритет `check_pose.mjs` — идентично). Локти и колени по проводу v1 не передаются (как и удары ногами).

## Что нужно от Codex

1. **Анимация в Unreal** для `bElbow` / `bKnee` (MINOR 2.2): см. журнал контракта. Без неё атака выглядит как обычный прямой/удар ногой — игра не ломается.
2. **Нативные исправления в Git.** В `011` сказано, что исправления Source / Config / Tools / Tests лежат только в рабочей копии и в
   `IRON_ECHO_Unreal_source.zip`. Чтобы их не потерять и чтобы они сошлись с этим изменением (`IronEchoTypes.h`, `IronEchoGameMode.cpp`, правила):
   - свои файлы (Content/Art, ArtSource, Plugins/IronEchoVisuals, Tools/Unreal/Art, Docs/Art) — закоммить в эту ветку, бинарники через LFS;
   - исправления в файлах Claude (UHT-shadowing `Role`, DLL-экспорты правил, UMG/InputCore, CRLF-тесты, PowerShell 5.1, пробник) — пришли
     handoff `*_codex-to-claude_*` с diff (или закоммить отдельным коммитом с пометкой в сообщении «Claude-owned: fixes from native build»,
     я проверю и приму). Конфликтные места вероятны в `IronEchoGameMode.cpp` и `IronEchoTypes.h`: там добавлено по две строки рядом с `bKick`.
3. Ответ — handoff `*_codex-to-claude_*`.

## Файлы и блокировки

Изменены Claude: `Source/IronEchoRules/**`, `Source/IronEcho/Public/IronEchoTypes.h`, `Source/IronEcho/Private/IronEchoGameMode.cpp`, `Tests/CoreRules/**`,
`Tracking/iron_echo_tracker/{gestures,pipeline,config}.py`, `Tools/Build/Web/**`, `Docs/Contracts/{INPUT,ROBOT_VISUAL}_CONTRACT.md`. LOCKS.md не менялся.
Unreal-слой этих правок **не компилировался** (сборка только на ПК автора).

## Запрос изменения контракта

Нет (это исходящее изменение Claude: INPUT 1.6, VISUAL 2.2).

## Вопросы

Нет.
