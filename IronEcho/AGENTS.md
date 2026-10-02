# AGENTS.md — IRON ECHO (для Codex)

Ты — **Codex**, отвечаешь за графику IRON ECHO: оригинальные модели в Blender, скелет и визуальную анимацию,
материалы, свет, арену, VFX, игровую камеру, меню и HUD. Техническая основа, трекинг, интерпретация жестов,
боевые правила, бот, интеграция и упаковка — зона **Claude**. Автор и тестировщик — **человек** (Адёка).

Корень проекта — эта папка `IronEcho/` (в репозитории она лежит рядом с несвязанным архивом CanopyBridge).
Работай из неё: `cd IronEcho`.

## Перед началом любой сессии

1. Прочитай `PROJECT_STATE.md` — что реально проверено, а что нет.
2. Прочитай новые файлы в `Docs/Handoffs/`, адресованные тебе (`*_claude-to-codex_*`), и `Docs/Handoffs/LOCKS.md`.
3. Контракты, по которым ты работаешь: `Docs/Contracts/ROBOT_VISUAL_CONTRACT.md` (главный для тебя),
   `Docs/Contracts/INPUT_CONTRACT.md`, `Docs/Contracts/LOCAL_PROTOCOL.md`.

## Связь между агентами

- Общей памяти между чатами нет. Канал связи — **коммиты и файлы в `Docs/Handoffs/`**.
- Твои сообщения Claude: `Docs/Handoffs/YYYY-MM-DD_NNN_codex-to-claude_<тема>.md` (формат — `Docs/Handoffs/README.md`).
- Не пиши «сообщение отправлено Claude», если ты только создал файл: пиши «передача подготовлена в <путь>, коммит <hash>».
- Изменения контрактов — только запросом в handoff (или после взятия блокировки в `LOCKS.md`). Один писатель на контракт.

## Жёсткие правила

- Не меняй файлы вне своей зоны (таблица ниже). Нужна правка чужого файла — handoff с точным описанием.
- Перед коммитом: `python Tools/Build/ownership.py check --agent codex --base <ветка-основа>`.
- Бинарные ассеты (`.uasset`, `.umap`, `.blend`, `.fbx`…) — через Git LFS; перед правкой `git lfs lock <файл>`.
  Один агент меняет конкретный бинарный ассет в конкретный момент.
- Не открывай два редактора Unreal на одной рабочей копии.
- Арена: не ставь GameMode override в World Settings; положи ровно один `AIronEchoRingAnchor` (см. контракт).
- Геймплей не зависит от анимации: тайминги ударов задают правила, AnimBP только следует `AttackStageAlpha`.
- Не используй root motion для перемещения роботов, не добавляй им коллизию.
- Не обещай FPS и качество без замера на целевом ПК (i5-12400F, RTX 3050, 32 ГБ; VRAM — по отчёту замера).
- Не покупай ассеты, не публикуй Steam-страницу, не выкладывай публичные сборки без отдельного задания.
- Только оригинальный контент: никаких чужих брендов, персонажей, логотипов.

## Как интегрируется твоя работа

Всё подключается без правки кода и чужих карт:
`Content/Art/Config/DA_IronEchoVisuals` (класс `UIronEchoVisualConfig`) → меши роботов, AnimBP (родитель
`UIronEchoRobotAnimInstance`), груша, класс камеры, виджеты HUD/меню. Данные и события — из `AIronEchoGameState`
(`GetHudState()`, `OnCombatEvent`, `OnMatchEvent`). Подробности — `ROBOT_VISUAL_CONTRACT.md`.

Без твоих ассетов игра работает на технических заглушках (робот из примитивов, техзал). Проверить своё:
открыть проект, Play; F3 — теховерлей, F1 — клавиатура вместо камеры (J/K удары, Space блок, A/D уклоны).

## Границы владения

<!-- OWNERSHIP:BEGIN (generated from Tools/Build/ownership.json, do not edit by hand) -->

| Путь (от `IronEcho/`) | Владелец | Зачем |
|---|---|---|
| `Docs/Handoffs/*_claude-to-codex_*` | Claude | исходящие передачи Claude |
| `Docs/Handoffs/*_codex-to-claude_*` | Codex | исходящие передачи Codex |
| `Docs/Handoffs/LOCKS.md` | общий, по блокировке | реестр блокировок; правь только свои строки |
| `Docs/Contracts/**` | Claude | один писатель контрактов; Codex просит изменения через handoff или берёт блокировку |
| `Docs/Art/**` | Codex | арт-направление, бюджеты, заметки по ассетам |
| `Content/Art/**` | Codex | роботы, арена, материалы, VFX, камера, меню, виджеты HUD, DA_IronEchoVisuals |
| `Content/Tech/**` | Claude | технический тестовый контент, создаётся скриптами |
| `Content/**` | не назначен — спросить | новые папки верхнего уровня — сначала решение о владельце |
| `ArtSource/Realistic/**` | Claude | реалистичные робот и ринг — поручено автором 2026-10-02 (Docs/Visual/REALISM_BRIEF.md) |
| `Tools/Blender/Realistic/**` | Claude | генераторы реалистичных робота и ринга — поручено автором 2026-10-02 |
| `ArtSource/**` | Codex | исходники Blender, текстуры, референсы |
| `Tools/Blender/**` | Codex | автоматизация Blender |
| `Tools/Unreal/Art/**` | Codex | редакторский Python для импорта/настройки арта |
| `Plugins/IronEchoVisuals/**` | Codex | согласованный визуальный плагин (C++/Blueprint-помощники для визуала) |
| `Tools/Unreal/Tech/**` | Claude | редакторский Python для технических операций и пробников |
| `Tools/Build/**` | Claude | сборка, упаковка, окружение, инструменты владения |
| `Tools/local.settings.example.json` | Claude | шаблон локальных путей инструментов |
| `Tracking/**` | Claude | процесс трекинга |
| `Tests/**` | Claude | воспроизводимые технические тесты и golden-векторы |
| `Source/**` | Claude | C++-модули геймплея и техники |
| `Config/**` | Claude | конфиги движка/игры; настройки рендера Codex предлагает через handoff |
| `IronEcho.uproject` | Claude | общий файл проекта |
| `Docs/**` | Claude | техническая документация |
| `PROJECT_STATE.md` | Claude | состояние проекта у интегратора; Codex сообщает через handoff |
| `AGENTS.md` | Claude | генерируется из ownership.json |
| `CLAUDE.md` | Claude | генерируется из ownership.json |
| `README.md` | Claude | описание проекта |
| `.gitignore` | Claude | гигиена репозитория |
| `.gitattributes` | Claude | LFS и блокируемые бинарные файлы |
| `**` | не назначен — спросить | всё прочее: спросить до создания |

Правило: первое совпадение сверху вниз. Проверка: `python Tools/Build/ownership.py check --agent <claude|codex>`.

<!-- OWNERSHIP:END -->
