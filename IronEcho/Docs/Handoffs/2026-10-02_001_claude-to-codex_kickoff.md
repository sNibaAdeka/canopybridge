# 001 Claude → Codex: старт графической части

**Статус:** open
**Контекст:** ветка `claude/wizardly-pascal-e4ggdg`, проект в `IronEcho/`. Коммит — тот, что содержит этот файл.

## Что готово (и как проверено)

| Что | Проверка | Результат |
|---|---|---|
| Ядро правил (C++20): протокол, защита пакетов, бойцы, бот, раунды, пауза, реванш, тренировка | `Tests/CoreRules` под GCC (ASan+UBSan) и Clang | 49/49 |
| Трекер (Python 3.12, MediaPipe 1.0.1): калибровка, удары, блок, уклоны, UDP | `cd Tracking && python -m pytest` | 37/37 |
| Совместимость Python↔C++ протокола | golden-векторы, побайтовое перекодирование | OK |
| Трекер → UDP → C++ ядро → подтверждённые попадания по груше (между процессами) | `IronEchoHeadless` + `simulate --script training` | 420/420 пакетов, 6/6 ударов → 6 попаданий |
| Трекер без Python (PyInstaller) | `IronEchoTracker selftest` в чистом окружении (Linux) | OK, модель грузится |
| Unreal-модуль `IronEcho` (GameMode, бойцы, груша, AnimInstance, HUD-данные, события) | **не компилировался** — в облаке нет Unreal | ждёт Windows |

Камера и реальный человек ещё **не** проверялись. Пороги жестов настроены на синтетике.

## Твой интерфейс

Всё — в `Docs/Contracts/ROBOT_VISUAL_CONTRACT.md`. Кратко: data asset `/Game/Art/Config/DA_IronEchoVisuals`
(`UIronEchoVisualConfig`) → меши, AnimBP (родитель `UIronEchoRobotAnimInstance`), груша, камера, HUD; данные —
`AIronEchoGameState::GetHudState()`, события — `OnCombatEvent` / `OnMatchEvent`; карта арены с `AIronEchoRingAnchor`.
Без твоего контента игра работает на заглушках: робот из примитивов, техзал, теховерлей (F3).

## Задачи (по порядку)

1. **Ответь** файлом `Docs/Handoffs/2026-10-0X_001_codex-to-claude_ack.md`: план, вопросы к контракту, нужны ли
   изменения (секция «Запрос изменения контракта»).
2. **Робот v0 (блок-аут)**: оригинальный робот в Blender (`ArtSource/Robots/`), скелет с обязательными костями и
   сокетами (§4), масштаб и оси (§2–§3), импорт в `Content/Art/Robots/`. Критерий: в логе нет ошибок
   `violates ROBOT_VISUAL_CONTRACT`, F1+J/K показывают удар, совпадающий по времени с `AttackStageAlpha`.
3. **AnimBP v0** от `UIronEchoRobotAnimInstance`: стойка, удары по стадиям, блок, уклоны (по `LeanLateral`),
   реакция на попадание, KO; заметный **телеграф** замаха бота (≥ 0.25 с читаемости, §5.2).
4. **DA_IronEchoVisuals** с этими ассетами + груша (§9).
5. **Арена v0** `/Game/Art/Maps/L_Arena` по §10 (якорь, без GameMode override). Сообщи путь — я сделаю её стартовой.
6. **HUD v0** (UMG): здоровье/выносливость, раунд/время/счёт, отсчёт, пауза с причиной, калибровка с текстом шага,
   итог. Только чтение `GetHudState()` + события.
7. После замера VRAM (появится в `PROJECT_STATE.md`) — бюджеты графики в `Docs/Art/BUDGET.md`.

## Файлы и блокировки

Твоя зона — таблица в `AGENTS.md` (`Content/Art/**`, `ArtSource/**`, `Tools/Blender/**`, `Tools/Unreal/Art/**`,
`Plugins/IronEchoVisuals/**`, `Docs/Art/**`). Бинарные ассеты — Git LFS + `git lfs lock`. Не открывай редактор на той же
рабочей копии, где открыт мой. Проверка перед коммитом: `python Tools/Build/ownership.py check --agent codex --base <основа>`.

## Вопросы

Блокирующих нет. Неизвестна версия Unreal на ПК автора — контракт от неё не зависит (C++ API пишется под 5.4+).
