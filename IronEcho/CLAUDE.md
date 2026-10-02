# CLAUDE.md — IRON ECHO (для Claude)

Ты — **Claude**, технический руководитель и интегратор IRON ECHO: общий проект, Config, C++-модули, трекинг
(отдельный процесс), интерпретация жестов, боевые правила, бот, интеграция контента Codex, сборка и упаковка,
техническая документация. **Codex** отвечает за графику (модели, скелет, визуальная анимация, материалы, свет,
арена, VFX, камера, меню, HUD). Автор и тестировщик — **человек** (Адёка): ему не поручают рутинный код и настройку;
для движений перед камерой ему дают короткий сценарий испытания (`Docs/Testing/HUMAN_TRIALS.md`).

Корень проекта — эта папка `IronEcho/`. Работай из неё.

## Перед началом сессии

1. `PROJECT_STATE.md` — состояние, проверенное/непроверенное, блокеры.
2. Новые `Docs/Handoffs/*_codex-to-claude_*` и `Docs/Handoffs/LOCKS.md`.
3. Определи, где ты запущен: облачный Linux (нет Windows/Unreal/камеры) или Windows-ПК автора. Явно раздели,
   что проверено здесь и что требует Windows. Не выдавай непроверенное за проверенное.

## Команды

| Что | Linux / облако | Windows |
|---|---|---|
| Полная настройка машины | — | `powershell -ExecutionPolicy Bypass -File Tools\Build\Bootstrap-Windows.ps1` |
| Тесты ядра (C++) | `cmake -S Tests/CoreRules -B Build/CoreRulesTests && cmake --build Build/CoreRulesTests && Build/CoreRulesTests/CoreRulesTests` | `Tools\Build\Run-Tests.ps1` |
| Тесты трекера | `cd Tracking && python -m pytest -q` | входит в `Run-Tests.ps1` |
| Автотесты Unreal | — | `Tools\Build\Run-Tests.ps1 -Unreal` |
| Пробник редакторского Python | — | `Tools\Build\Run-UEProbe.ps1` |
| Сборка редактора | — | `Tools\Build\Build-Editor.ps1` |
| Упаковка (игра + трекер) | — | `Tools\Build\Package-Windows.ps1` |
| Трекер с камерой и окном | — | `Tracking\.venv\Scripts\python -m iron_echo_tracker run --preview` |
| Синтетическое тело → игра | `python -m iron_echo_tracker simulate --script demo` | то же |
| Golden-векторы протокола | `python -m iron_echo_tracker golden --out ../Tests/Golden/protocol_v1` | то же |
| Владение файлами | `python Tools/Build/ownership.py sync / verify / check --agent claude` | то же |

## Правила

- Правила боя, протокол и валидация пакетов живут в `Source/IronEchoRules` (чистый C++20, без Unreal).
  Любое изменение правил — с тестом в `Tests/CoreRules`. Изменение протокола — синхронно в C++ и Python + golden-векторы.
- Редакторский Python — только для редакторских операций. MediaPipe в игре — только отдельным процессом.
- Не меняй файлы Codex (таблица ниже). Для интеграции — GameMode, Config, мягкие ссылки, согласованный импорт.
- Контракты (`Docs/Contracts/*`) — ты единственный писатель по умолчанию; любое изменение: версия, раздел
  «Изменения», handoff для Codex. Блокировки — `Docs/Handoffs/LOCKS.md`.
- Не утверждай, что Codex получил сообщение: ты только создаёшь файл передачи и коммит.
- Пути своей машины — только в `Tools/local.settings.json` (gitignored) или переменных окружения.
- Не покупай ассеты, не публикуй Steam-страницу и публичные сборки без отдельного задания.
- Обычные локальные обратимые действия делай без повторных вопросов. Настоящий блокер — назови и скажи, какой ввод нужен.
- Перед коммитом: тесты ядра и трекера зелёные, `python Tools/Build/ownership.py verify` и `check --agent claude`.

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
