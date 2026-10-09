# Окружение Windows: неуспешный запуск bootstrap 2026-10-09

Этот отчёт составлен Codex вручную по фактическому запуску и отдельным проверкам только для чтения.
Bootstrap НЕ сгенерировал штатный отчёт: Windows PowerShell завершился на этапе разбора файла,
до выполнения первого шага. Таблица ниже не является результатом шагов bootstrap.

- Ветка: `claude/wizardly-pascal-e4ggdg`, исходный коммит `a745b4ce36d4351f6f74b62ebd054f4759428c2c`.
- `git pull --ff-only --progress`: `Already up to date.`
- Команда из `IronEcho/`: `powershell -ExecutionPolicy Bypass -File Tools\Build\Bootstrap-Windows.ps1`.
- Код завершения: `1`.
- Отдельные проверки окружения: `2026-10-09T22:59:13`, Asia/Yekaterinburg (UTC+05:00).

| Компонент / этап | Фактическое состояние |
|---|---|
| Windows PowerShell | 5.1.19041.6456 |
| Unreal Engine | 5.8.3, changelist 58210709, `++UE5+Release-5.8`; проверены `Engine/Build/Build.version` и наличие `UnrealEditor.exe` |
| Visual Studio | Visual Studio Build Tools 2022, 17.14.41 / installationVersion 17.14.37710.0; полноценная Visual Studio IDE не обнаружена `vswhere -all -products *` |
| Game development with C++ | Рабочая нагрузка `Microsoft.VisualStudio.Workload.NativeGame` не обнаружена; `vswhere -all -products * -requires Microsoft.VisualStudio.Workload.NativeGame` возвращает пустой результат |
| Компилятор C++ | Компонент `Microsoft.VisualStudio.Component.VC.Tools.x86.x64` есть в Build Tools; MSVC 14.44.35207 |
| Windows SDK | 10.0.22621.0 |
| Python | Python 3.12.10 (`py -3.12 --version`) |
| Git | git version 2.53.0.windows.3 |
| Git LFS | git-lfs/3.7.1 (GitHub; windows amd64; go 1.25.1; git b84b3384) |
| Bootstrap | Ошибка разбора PowerShell на строках 211–222; `MissingEndParenthesisInMethodCall` |
| Оборудование / камеры / Blender | Штатные измерения bootstrap не выполнялись |
| Tracking venv, зависимости и модели | Не создавались / не устанавливались этим запуском |
| Тесты ядра и трекера | Не запускались |
| Компиляция Unreal / UBT / UHT | Не запускалась |
| Редакторский Python probe | Не запускался |

## Блокер и предпосылки

Фактический блокер запуска — ошибка синтаксического разбора `Bootstrap-Windows.ps1` в Windows PowerShell 5.1.
Первое сообщение: `Missing ')' in method call.` на строке 211; затем ошибки на строках 218, 220, 222.
Полный вывод процесса без сокращения помещён в `Docs/Handoffs/2026-10-09_codex-to-claude_bootstrap.md`.

Отдельно не обнаружены полная Visual Studio 2022 и её рабочая нагрузка Game development with C++.
При этом установлен C++ toolchain Build Tools 2022: его пригодность для проекта сборкой не проверена.
Unreal 5.x, Python 3.12 и Git LFS присутствуют. Никакие недостающие инструменты не устанавливались.

Файл bootstrap сохранён в UTF-8 без BOM; в исходном выводе PowerShell кириллица отображается искажённо.
Это наблюдение для расследования Claude, а не подтверждённая причина всех ошибок.
Код, настройки проекта и скрипты не исправлялись; повторный запуск через другой интерпретатор не выполнялся.
