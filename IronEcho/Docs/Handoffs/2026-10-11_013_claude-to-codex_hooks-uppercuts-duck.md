# Хуки, апперкоты, нырок (контракты ввода 1.7 и визуальный 2.3)

## Статус

open — нужна анимация в Unreal. Предыдущий `012` (локти, колени, слияние нативной сборки) тоже ещё открыт.

## Контекст

Ветка `claude/wizardly-pascal-e4ggdg`. Автор попросил сделать упор на механику и качество боя. Главный пробел был в том, что из ударов руками
были только прямые, а защита была однобокой: блок останавливал всё, уклон работал только вбок. Теперь каждая защита чему-то проигрывает:

| Удар / защита | Работает против | Проигрывает |
|---|---|---|
| Хук | уклона (дуга достаёт голову) | нырка, блока |
| Апперкот | блока (половина проходит), нырка (контрудар) | уклона |
| Нырок | прямых и хуков, если сделан поздно | апперкота |

## Что сделано Claude

1. **Правила** (`Source/IronEchoRules`, тесты `Tests/CoreRules/TestBoxingDepth.cpp`, всего 126):
   - `AttackKind::Hook` и `AttackKind::Uppercut` (значения 4 и 5, добавлены в конец);
   - нырок: `FighterIntent.bDuck`, `InputFrame.DuckAmount`; голова опускается на 0.30 м с конечной скоростью, промах считается по смещению
     поперёк линии удара и вниз;
   - бот защищается от каждого вида удара тем, что его бьёт, и запоминает, как защищается игрок.

   Подробности — в журнале `Docs/Contracts/INPUT_CONTRACT.md` (1.7).
2. **Визуальный контракт 2.3** (только добавления): `bHook`, `bUppercut`, `bDucking`, `HeadDrop` (см) в `FIronEchoFighterVisualState`;
   `bHook`, `bUppercut`, `bDucked`, `bThroughGuard` в событии боя; `DuckStarted` / `DuckEnded` в конце `EIronEchoCombatEventType`
   (static_assert в `IronEchoConversions.h` теперь проверяет `DuckEnded`). Файлы: `Source/IronEcho/Public/IronEchoTypes.h`,
   `Source/IronEcho/Private/IronEchoGameMode.cpp`, `Source/IronEcho/Private/IronEchoConversions.h`.
3. **Веб:** клавиши, сенсор, распознавание камерой, анимация роботов. Эталон движения — `Tools/Build/Web/site/src/anim.js`: ветка
   `f.kind === 4 || f.kind === 5` и блок «duck (1.7)»; поворот локтя у хука — `rig.js` (`lead_hook` / `rear_hook`).

## Что нужно от Codex

1. **Анимация в Unreal** для `bHook`, `bUppercut` и нырка (`HeadDrop`). Описание — журнал `ROBOT_VISUAL_CONTRACT.md`, 2.3.
   Без неё хук и апперкот выглядят как прямой, а нырок не виден; правила при этом работают. Телеграф бота обязателен: у хука замах на 0.03 с,
   у апперкота на 0.04 с длиннее прямого, и отвод руки в сторону или просадку плеча человек должен успеть прочитать.
2. **Реакции:** `bThroughGuard` — голова вверх при перчатках на месте; `bDucked` у `Dodged` — удар проходит над головой.
3. **Клавиатура Unreal** (`IronEchoPlayerController.cpp`, файл Claude) пока без хуков, апперкотов и нырка: клавиша C там занята, а U/I — удары
   ногой. Раскладку как в вебе (U/I хуки, N/M апперкоты, «,»/«.» ноги, нырок) сделаю сам после слияния нативных исправлений из `012`, чтобы
   не плодить конфликты.
4. Ответ — handoff `*_codex-to-claude_*`.

## Файлы и блокировки

Изменены Claude: `Source/IronEchoRules/**`, `Source/IronEcho/Public/IronEchoTypes.h`, `Source/IronEcho/Private/{IronEchoGameMode.cpp,IronEchoConversions.h}`,
`Tests/CoreRules/**`, `Tests/Web/**`, `Tools/Build/Web/**`, `Docs/Contracts/{INPUT,ROBOT_VISUAL}_CONTRACT.md`. `LOCKS.md` не менялся.
Unreal-слой этих правок **не компилировался**: сборка возможна только на ПК автора.

## Запрос изменения контракта

Нет.
