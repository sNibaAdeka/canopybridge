# Windows bootstrap и готовая нативная сборка

## Статус

done — локальная Win64 Shipping-сборка получена и проверена. Более широкий перенос всех браузерных функций в Unreal не заявляется завершённым.

## Контекст

Ветка `claude/wizardly-pascal-e4ggdg`, исходная база `0956b0e`. Первоначальная задача разрешала только bootstrap и коммит отчётов; позднее пользователь поручил собрать игру и «сделай всё сам … полноценную версию на комп», что разрешило необходимые локальные исправления. В Git отправляются только этот handoff и отчёт окружения; код/ассеты остаются в рабочей копии и в полном ZIP исходников.

Unreal: **5.8.3-58210709+++UE5+Release-5.8**.

## Что готово

Полный bootstrap завершился с ExitCode=0. Unreal Editor Development и Game Shipping собраны. Исправлены UHT shadowing Role, DLL API экспорты правил, зависимости UMG/InputCore, Windows CRLF-тесты, совместимость PowerShell 5.1 и пробника AssetRegistry. Из существующего локального проекта восстановлены рабочие нативные анимация/HUD/арена, доступны настоящее меню и финальный экран. Роботы сгенерированы Blender и импортированы с PBR-материалами/сокетами. Арена содержит ровно один ring anchor и не переопределяет GameMode.

Проверки: CoreRules 108, tracker 37, tools 6, Unreal Automation 5/5. Packaging Shipping: UAT ExitCode=0. Скопированная сборка проверяется отдельно через собственный launcher. Цифры FPS и ограничения приведены в полном отчёте ниже. VSM выключены после наблюдавшегося зависания RTX 3050; сохранены Lumen и TSR. Контракт v2 сохранён, физика ударов остаётся в правилах.

## Что нужно от получателя

Для продолжения принять локальные изменения из полного архива `IRON_ECHO_Unreal_source.zip`, сверить diff с базой 0956b0e и оформить технические коммиты Claude с LFS для бинарных ассетов. Для нативного паритета отдельно перенести онлайн, рейтинг и работу двух камер с критериями из браузерной реализации. Реальный игрок должен проверить калибровку и распознавание жестов перед камерой.

## Файлы и блокировки

Изменены Source, Config, Tracking, Tools/Build, Tools/Unreal, Tests, ArtSource и Content/Art. Полный список diff находится в архиве `DESKTOP_BUILD_NOTES.md`. Технические файлы Claude исправлены по прямому расширенному поручению пользователя; ownership check это отмечает, результаты не скрыты. Других агентов и параллельного редактирования не было. Контракты и LOCKS.md не изменены. Бинарные ассеты локальные, в Git не отправлены.

## Запрос изменения контракта

Нет. Проверка камеры использует существующий IRONECHO_VISUAL_CONTRACT_VERSION=2.

## Вопросы

Блокеров запуска готовой одиночной сборки нет. Калибровка реального игрока не может быть заменена автоматическим тестом.

## Полный отчёт окружения

# Окружение Windows: отчёт bootstrap 2026-10-10T00:21:31

Сгенерировано `Tools/Build/Bootstrap-Windows.ps1`. Пути машины не включены.

| Шаг | Статус | Детали |
|---|---|---|
| hardware | ok | Microsoft Windows 10 Pro 10.0.19045 build 19045 64-bit; 12th Gen Intel(R) Core(TM) i5-12400F (6C/12T); 31.8 GiB RAM |
| gpu NVIDIA GeForce RTX 3050 | ok | VRAM 8192 MiB via nvidia-smi, driver 595.79 |
| camera devices | ok | HD camera  |
| unreal | ok | 5.8.3 at C:\Program Files\Epic Games\UE_5.8 (launcher) |
| visual studio | ok | Visual Studio Build Tools 2022 17.14.37710.0; MSVC 14.44.35207 |
| game development workload | warn | IDE Game development workload absent; MSVC Build Tools detected, actual Unreal build verifies compiler support |
| .NET Framework SDK | ok | 4.6.2 at %USERPROFILE%\Documents\Codex\2026-10-03\iron-echo-https-github-com-snibaadeka\work\toolchain\autosdk\HostWin64\Win64\Windows Kits\NETFXSDK |
| windows sdk | ok | 10.0.22621.0 |
| blender | ok | Blender 5.2.2 LTS at C:\Program Files\Blender Foundation\Blender 5.2\blender.exe |
| python | ok | 3.12.10 at %USERPROFILE%\AppData\Local\Programs\Python\Python312\python.exe |
| git | ok | git version 2.53.0.windows.3 |
| git lfs | ok | git-lfs/3.7.1 (GitHub; windows amd64; go 1.25.1; git b84b3384) |
| local settings | ok | %USERPROFILE%\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Tools\local.settings.json |
| tracker deps | ok | requirements-dev.txt installed |
| models | ok | pose_landmarker lite/full/heavy verified (sha256) |
| opencv cameras | warn | OpenCV could not open any camera (is it used by another app?) |
| tests | ok | ownership + core rules + tracker |
| engine association | ok | 5.8 |
| build IronEchoEditor | ok | Development Win64 |
| editor python probe | ok | Saved/Probe/ue_probe_result.json |

## Финальная нативная сборка

- Unreal Engine 5.8.3, CL 58210709; Win64 Shipping; UAT `BUILD SUCCESSFUL`, ExitCode=0.
- Финальный полный `powershell -ExecutionPolicy Bypass -File Tools\Build\Bootstrap-Windows.ps1`: ExitCode=0.
- CoreRules: 108 тестов; tracker pytest: 37; инструменты: 6; Unreal Automation: 5/5.
- Обнаружены исходники Claude в актуальной ветке и локальный нативный проект от 2026-10-03; встроены арена, HUD, анимация, импорт и локальная цепочка SDK.
- Подключены Forge/Ember, PBR-материалы, арена с 48 источниками света, камера, русские меню/HUD, синтезированные звуки, клавиатура/трекер, три сложности, тренировка, результат/реванш.
- Установки ПО не выполнялись: использованы существующие Unreal, Build Tools, Python, Blender, Git LFS и локальная AutoSDK с .NET Framework SDK 4.6.2.
- Отсутствует полная Visual Studio IDE с workload Game development with C++; фактические Editor и Shipping собраны имеющимся MSVC Build Tools.
- WARN камеры при bootstrap означает занятость устройства параллельным игровым трекером. Отдельно подтверждены открытие HD camera, работа процесса и протокола; физическая калибровка/качество жестов реального игрока автоматически не проверены.
- Строка `tests: ownership + core rules + tracker` описывает проверку таблицы владения и технические тесты. Отдельный `ownership.py check --agent codex --base HEAD` сообщает технические пути Claude; это НЕ успешная проверка границ владения. Пользователь расширил первоначальную задачу прямым поручением «сделай всё сам … полноценную версию на комп». Контракты и таблица владения не менялись.
- Нативный режим — одиночная игра. Онлайн, рейтинг и две камеры из браузерной реализации не перенесены в Unreal.
- Shipping запускается собственным статически связанным launcher; рядом с игровым EXE находятся подписанные Microsoft CRT 14.50 из уже существующей локальной сборки. Системная установка CRT не выполнялась.
- Готовая папка игры: `outputs/IRON_ECHO_Unreal`, полный проект: `outputs/IRON_ECHO_Unreal_source.zip`.

### Проверка настоящего Shipping-процесса на этом ПК

Автоматическая 40-секундная проверка: 1787 измеренных кадров, среднее 59.57 FPS, p95 16.67 мс; 21 атак игрока, 8 попаданий, 14 атак бота, экран результата подтверждён. Только в процессе проверки раунд сокращён до 20 секунд; обычная игра сохраняет 3 раунда по 90 секунд. Клавиши передаются через настоящий PlayerController, изображение сохраняет сам Unreal.

Предыдущая проверка обычного боя: 59.39 FPS, p95 16.91 мс, 35 атак игрока / 19 попаданий / 29 атак бота. В обеих проверках игровой трекер работал; выбран режим клавиатуры. Это короткий замер, не длительный тест всех сценариев. Во время боя nvidia-smi показал 4092 MiB общего использования видеопамяти системой (не эксклюзивную память игры и не пик).

Повторная проверка конечной папки через launcher после переноса: 1790 кадров, 59.65 FPS, p95 16.67 мс, 23 атак / 10 попаданий / 15 атак бота, экран результата подтверждён. Игра и трекер завершились автоматически по команде QA; обычный запуск не содержит флагов проверки.

Скриншоты и JSON: `outputs/verification/final/`, `outputs/verification/copied/`, `outputs/verification/combat_performance.json`.

## Полные строки FAIL / WARN из сохранённых логов

Строки сохранены целиком; старые отказы отражают промежуточные попытки, а не состояние финальной сборки.

### bootstrap-final.log

```text
    [ WARN:0@0.730] global cap.cpp:477 cv::VideoCapture::open VIDEOIO(DSHOW): backend is generally available but can't be used to capture by index
    [ WARN:0@0.735] global cap.cpp:477 cv::VideoCapture::open VIDEOIO(DSHOW): backend is generally available but can't be used to capture by index
    [ WARN:0@0.738] global cap.cpp:477 cv::VideoCapture::open VIDEOIO(DSHOW): backend is generally available but can't be used to capture by index
    [ WARN:0@0.742] global cap.cpp:477 cv::VideoCapture::open VIDEOIO(DSHOW): backend is generally available but can't be used to capture by index
    [ WARN:0@0.745] global cap.cpp:477 cv::VideoCapture::open VIDEOIO(DSHOW): backend is generally available but can't be used to capture by index
    OK   opencv cameras : [ WARN:0@0.745] global cap.cpp:477 cv::VideoCapture::open VIDEOIO(DSHOW): backend is generally available but can't be used to capture by index
```

### bootstrap-fixed-skip-editor.log

```text
    [ WARN:0@0.724] global cap.cpp:477 cv::VideoCapture::open VIDEOIO(DSHOW): backend is generally available but can't be used to capture by index
    [ WARN:0@0.731] global cap.cpp:477 cv::VideoCapture::open VIDEOIO(DSHOW): backend is generally available but can't be used to capture by index
    [ WARN:0@0.736] global cap.cpp:477 cv::VideoCapture::open VIDEOIO(DSHOW): backend is generally available but can't be used to capture by index
    [ WARN:0@0.744] global cap.cpp:477 cv::VideoCapture::open VIDEOIO(DSHOW): backend is generally available but can't be used to capture by index
    [ WARN:0@0.749] global cap.cpp:477 cv::VideoCapture::open VIDEOIO(DSHOW): backend is generally available but can't be used to capture by index
    OK   opencv cameras : [ WARN:0@0.749] global cap.cpp:477 cv::VideoCapture::open VIDEOIO(DSHOW): backend is generally available but can't be used to capture by index
    FAIL failed: core-rules  logs: C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Saved\Logs\Tests\20261009-232048
    FAIL tests : see Saved/Logs/Tests
    FAIL blocking: tests
```

### bootstrap-prereq-audit-final.log

```text
    FAIL game development workload : Visual Studio 2022 Game development with C++ workload not found
    FAIL .NET Framework SDK : .NET Framework SDK 4.6+ not found (add .NET Framework 4.8 SDK in Visual Studio Installer)
    [ WARN:0@0.746] global cap.cpp:477 cv::VideoCapture::open VIDEOIO(DSHOW): backend is generally available but can't be used to capture by index
    [ WARN:0@0.750] global cap.cpp:477 cv::VideoCapture::open VIDEOIO(DSHOW): backend is generally available but can't be used to capture by index
    [ WARN:0@0.754] global cap.cpp:477 cv::VideoCapture::open VIDEOIO(DSHOW): backend is generally available but can't be used to capture by index
    [ WARN:0@0.758] global cap.cpp:477 cv::VideoCapture::open VIDEOIO(DSHOW): backend is generally available but can't be used to capture by index
    [ WARN:0@0.762] global cap.cpp:477 cv::VideoCapture::open VIDEOIO(DSHOW): backend is generally available but can't be used to capture by index
    OK   opencv cameras : [ WARN:0@0.762] global cap.cpp:477 cv::VideoCapture::open VIDEOIO(DSHOW): backend is generally available but can't be used to capture by index
    FAIL blocking: game development workload, .NET Framework SDK
```

### bootstrap-prereq-audit.log

```text
    FAIL game development workload : Visual Studio 2022 Game development with C++ workload not found
    FAIL .NET Framework SDK : .NET Framework SDK 4.6+ not found (add .NET Framework 4.8 SDK in Visual Studio Installer)
    [ WARN:0@0.794] global cap.cpp:477 cv::VideoCapture::open VIDEOIO(DSHOW): backend is generally available but can't be used to capture by index
    [ WARN:0@0.802] global cap.cpp:477 cv::VideoCapture::open VIDEOIO(DSHOW): backend is generally available but can't be used to capture by index
    [ WARN:0@0.806] global cap.cpp:477 cv::VideoCapture::open VIDEOIO(DSHOW): backend is generally available but can't be used to capture by index
    [ WARN:0@0.810] global cap.cpp:477 cv::VideoCapture::open VIDEOIO(DSHOW): backend is generally available but can't be used to capture by index
    [ WARN:0@0.814] global cap.cpp:477 cv::VideoCapture::open VIDEOIO(DSHOW): backend is generally available but can't be used to capture by index
    OK   opencv cameras : [ WARN:0@0.814] global cap.cpp:477 cv::VideoCapture::open VIDEOIO(DSHOW): backend is generally available but can't be used to capture by index
    FAIL blocking: game development workload, .NET Framework SDK
```

### bootstrap-pwsh.log

```text
    [ WARN:0@1.915] global cap.cpp:477 cv::VideoCapture::open VIDEOIO(DSHOW): backend is generally available but can't be used to capture by index
    [ WARN:0@1.933] global cap.cpp:477 cv::VideoCapture::open VIDEOIO(DSHOW): backend is generally available but can't be used to capture by index
    [ WARN:0@1.946] global cap.cpp:477 cv::VideoCapture::open VIDEOIO(DSHOW): backend is generally available but can't be used to capture by index
    [ WARN:0@1.957] global cap.cpp:477 cv::VideoCapture::open VIDEOIO(DSHOW): backend is generally available but can't be used to capture by index
    [ WARN:0@1.965] global cap.cpp:477 cv::VideoCapture::open VIDEOIO(DSHOW): backend is generally available but can't be used to capture by index
    OK   opencv cameras : [ WARN:0@1.965] global cap.cpp:477 cv::VideoCapture::open VIDEOIO(DSHOW): backend is generally available but can't be used to capture by index
    FAIL failed: core-rules, pytest  logs: C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Saved\Logs\Tests\20261009-231916
    FAIL tests : see Saved/Logs/Tests
    FAIL build IronEchoEditor : exit 6, see C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Saved\Bootstrap\20261009-231843\build-editor.log
    FAIL blocking: tests, build IronEchoEditor
```

### bootstrap-success.log

```text
    WARN game development workload : IDE Game development workload absent; MSVC Build Tools detected, actual Unreal build verifies compiler support
    [ WARN:0@0.792] global cap.cpp:477 cv::VideoCapture::open VIDEOIO(DSHOW): backend is generally available but can't be used to capture by index
    [ WARN:0@0.799] global cap.cpp:477 cv::VideoCapture::open VIDEOIO(DSHOW): backend is generally available but can't be used to capture by index
    [ WARN:0@0.803] global cap.cpp:477 cv::VideoCapture::open VIDEOIO(DSHOW): backend is generally available but can't be used to capture by index
    [ WARN:0@0.806] global cap.cpp:477 cv::VideoCapture::open VIDEOIO(DSHOW): backend is generally available but can't be used to capture by index
    [ WARN:0@0.810] global cap.cpp:477 cv::VideoCapture::open VIDEOIO(DSHOW): backend is generally available but can't be used to capture by index
    OK   opencv cameras : [ WARN:0@0.810] global cap.cpp:477 cv::VideoCapture::open VIDEOIO(DSHOW): backend is generally available but can't be used to capture by index
    FAIL probe reported problems; see C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Saved\Probe\ue_probe_result.json
    FAIL editor python probe : exit 2
    FAIL blocking: editor python probe
```

### bootstrap-verified-final.log

```text
    WARN game development workload : IDE Game development workload absent; MSVC Build Tools detected, actual Unreal build verifies compiler support
    [ WARN:0@0.378] global cap.cpp:477 cv::VideoCapture::open VIDEOIO(DSHOW): backend is generally available but can't be used to capture by index
    [ WARN:0@0.385] global cap.cpp:477 cv::VideoCapture::open VIDEOIO(DSHOW): backend is generally available but can't be used to capture by index
    [ WARN:0@0.388] global cap.cpp:477 cv::VideoCapture::open VIDEOIO(DSHOW): backend is generally available but can't be used to capture by index
    [ WARN:0@0.392] global cap.cpp:477 cv::VideoCapture::open VIDEOIO(DSHOW): backend is generally available but can't be used to capture by index
    [ WARN:0@0.399] global cap.cpp:477 cv::VideoCapture::open VIDEOIO(DSHOW): backend is generally available but can't be used to capture by index
    [ WARN:0@0.402] global cap.cpp:477 cv::VideoCapture::open VIDEOIO(DSHOW): backend is generally available but can't be used to capture by index
    WARN opencv cameras : OpenCV could not open any camera (is it used by another app?)
```

### desktop-package-development.log

```text
    17138 INFO: Warnings written to C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Build\Tracker\work\IronEchoTracker\warn-IronEchoTracker.txt
    WARN game package folder not found (C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Build\Package\Windows\IronEcho); tracker not staged
```

### game-package-attempt.log

```text
    FAIL UAT failed, see C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Saved\Logs\Package\20261009-232738\uat.log
```

### tracker-package.log

```text
    45077 INFO: Warnings written to C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Build\Tracker\work\IronEchoTracker\warn-IronEchoTracker.txt
    WARN game package folder not found (C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Build\Package\Windows\IronEcho); tracker not staged
```

## Полные логи компилятора и исходных отказов

Без сокращения сообщений, notes и путей. Исправления локальные; финальные успешные результаты приведены выше.

### bootstrap-final.log

```text

==> Hardware
{
    "measured_utc":  "2026-10-09T18:26:45Z",
    "os":  "Microsoft Windows 10 Pro 10.0.19045 build 19045 64-bit",
    "cpu":  "12th Gen Intel(R) Core(TM) i5-12400F (6C/12T)",
    "ram_gib":  31.8,
    "gpus":  [
                 {
                     "name":  "NVIDIA GeForce RTX 3050",
                     "vram_mib":  8192,
                     "driver":  "595.79",
                     "source":  "nvidia-smi"
                 }
             ],
    "displays":  [
                     {
                         "adapter":  "NVIDIA GeForce RTX 3050",
                         "resolution":  "1920x1080",
                         "refresh_hz":  165
                     }
                 ],
    "cameras":  [
                    {
                        "name":  "HD camera ",
                        "status":  "OK",
                        "class":  "Camera"
                    }
                ]
}
    OK   hardware written to C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Saved\Bootstrap\20261009-232643\hardware.json
    OK   hardware : Microsoft Windows 10 Pro 10.0.19045 build 19045 64-bit; 12th Gen Intel(R) Core(TM) i5-12400F (6C/12T); 31.8 GiB RAM
    OK   gpu NVIDIA GeForce RTX 3050 : VRAM 8192 MiB via nvidia-smi, driver 595.79
    OK   camera devices : HD camera 

==> Unreal Engine
    OK   unreal : 5.8.3 at C:\Program Files\Epic Games\UE_5.8 (launcher)

==> Visual Studio / MSVC / Windows SDK
    OK   visual studio : Visual Studio Build Tools 2022 17.14.37710.0; MSVC 14.44.35207
    OK   windows sdk : 10.0.22621.0

==> Blender
    OK   blender : Blender 5.2.2 LTS at C:\Program Files\Blender Foundation\Blender 5.2\blender.exe

==> Python 3.12 (tracker development)
    OK   python : 3.12.10 at C:\Users\user\AppData\Local\Programs\Python\Python312\python.exe

==> Git / LFS
    OK   git : git version 2.53.0.windows.3
    OK   git lfs : git-lfs/3.7.1 (GitHub; windows amd64; go 1.25.1; git b84b3384)

==> Local settings
    OK   local settings : C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Tools\local.settings.json

==> Tracker virtual environment
    Requirement already satisfied: mediapipe==1.0.1 in c:\users\user\documents\codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\ironecho\tracking\.venv\lib\site-packages (from -r C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Tracking\requirements.txt (line 3)) (1.0.1)
    Requirement already satisfied: numpy==2.5.3 in c:\users\user\documents\codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\ironecho\tracking\.venv\lib\site-packages (from -r C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Tracking\requirements.txt (line 4)) (2.5.3)
    Requirement already satisfied: opencv-contrib-python==5.0.0.93 in c:\users\user\documents\codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\ironecho\tracking\.venv\lib\site-packages (from -r C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Tracking\requirements.txt (line 5)) (5.0.0.93)
    Requirement already satisfied: pytest==9.1.1 in c:\users\user\documents\codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\ironecho\tracking\.venv\lib\site-packages (from -r Tracking\requirements-dev.txt (line 2)) (9.1.1)
    Requirement already satisfied: pyinstaller==6.22.3 in c:\users\user\documents\codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\ironecho\tracking\.venv\lib\site-packages (from -r Tracking\requirements-dev.txt (line 3)) (6.22.3)
    Requirement already satisfied: absl-py~=2.3 in c:\users\user\documents\codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\ironecho\tracking\.venv\lib\site-packages (from mediapipe==1.0.1->-r C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Tracking\requirements.txt (line 3)) (2.5.1)
    Requirement already satisfied: certifi in c:\users\user\documents\codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\ironecho\tracking\.venv\lib\site-packages (from mediapipe==1.0.1->-r C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Tracking\requirements.txt (line 3)) (2026.7.22)
    Requirement already satisfied: sounddevice~=0.5 in c:\users\user\documents\codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\ironecho\tracking\.venv\lib\site-packages (from mediapipe==1.0.1->-r C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Tracking\requirements.txt (line 3)) (0.5.6)
    Requirement already satisfied: flatbuffers~=25.9 in c:\users\user\documents\codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\ironecho\tracking\.venv\lib\site-packages (from mediapipe==1.0.1->-r C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Tracking\requirements.txt (line 3)) (25.12.19)
    Requirement already satisfied: matplotlib in c:\users\user\documents\codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\ironecho\tracking\.venv\lib\site-packages (from mediapipe==1.0.1->-r C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Tracking\requirements.txt (line 3)) (3.11.2)
    Requirement already satisfied: colorama>=0.4 in c:\users\user\documents\codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\ironecho\tracking\.venv\lib\site-packages (from pytest==9.1.1->-r Tracking\requirements-dev.txt (line 2)) (0.4.6)
    Requirement already satisfied: iniconfig>=1.0.1 in c:\users\user\documents\codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\ironecho\tracking\.venv\lib\site-packages (from pytest==9.1.1->-r Tracking\requirements-dev.txt (line 2)) (2.3.1)
    Requirement already satisfied: packaging>=22 in c:\users\user\documents\codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\ironecho\tracking\.venv\lib\site-packages (from pytest==9.1.1->-r Tracking\requirements-dev.txt (line 2)) (26.3)
    Requirement already satisfied: pluggy<2,>=1.5 in c:\users\user\documents\codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\ironecho\tracking\.venv\lib\site-packages (from pytest==9.1.1->-r Tracking\requirements-dev.txt (line 2)) (1.6.0)
    Requirement already satisfied: pygments>=2.7.2 in c:\users\user\documents\codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\ironecho\tracking\.venv\lib\site-packages (from pytest==9.1.1->-r Tracking\requirements-dev.txt (line 2)) (2.21.0)
    Requirement already satisfied: altgraph in c:\users\user\documents\codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\ironecho\tracking\.venv\lib\site-packages (from pyinstaller==6.22.3->-r Tracking\requirements-dev.txt (line 3)) (0.17.5)
    Requirement already satisfied: pefile>=2022.5.30 in c:\users\user\documents\codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\ironecho\tracking\.venv\lib\site-packages (from pyinstaller==6.22.3->-r Tracking\requirements-dev.txt (line 3)) (2024.8.26)
    Requirement already satisfied: pyinstaller-hooks-contrib>=2026.7 in c:\users\user\documents\codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\ironecho\tracking\.venv\lib\site-packages (from pyinstaller==6.22.3->-r Tracking\requirements-dev.txt (line 3)) (2026.8)
    Requirement already satisfied: pywin32-ctypes>=0.2.1 in c:\users\user\documents\codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\ironecho\tracking\.venv\lib\site-packages (from pyinstaller==6.22.3->-r Tracking\requirements-dev.txt (line 3)) (0.2.3)
    Requirement already satisfied: setuptools>=42.0.0 in c:\users\user\documents\codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\ironecho\tracking\.venv\lib\site-packages (from pyinstaller==6.22.3->-r Tracking\requirements-dev.txt (line 3)) (84.0.0)
    Requirement already satisfied: cffi in c:\users\user\documents\codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\ironecho\tracking\.venv\lib\site-packages (from sounddevice~=0.5->mediapipe==1.0.1->-r C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Tracking\requirements.txt (line 3)) (2.1.1)
    Requirement already satisfied: contourpy>=1.0.1 in c:\users\user\documents\codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\ironecho\tracking\.venv\lib\site-packages (from matplotlib->mediapipe==1.0.1->-r C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Tracking\requirements.txt (line 3)) (1.4.0)
    Requirement already satisfied: cycler>=0.10 in c:\users\user\documents\codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\ironecho\tracking\.venv\lib\site-packages (from matplotlib->mediapipe==1.0.1->-r C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Tracking\requirements.txt (line 3)) (0.12.1)
    Requirement already satisfied: fonttools>=4.28.2 in c:\users\user\documents\codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\ironecho\tracking\.venv\lib\site-packages (from matplotlib->mediapipe==1.0.1->-r C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Tracking\requirements.txt (line 3)) (4.66.1)
    Requirement already satisfied: kiwisolver>=1.3.1 in c:\users\user\documents\codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\ironecho\tracking\.venv\lib\site-packages (from matplotlib->mediapipe==1.0.1->-r C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Tracking\requirements.txt (line 3)) (1.5.1)
    Requirement already satisfied: pillow>=9 in c:\users\user\documents\codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\ironecho\tracking\.venv\lib\site-packages (from matplotlib->mediapipe==1.0.1->-r C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Tracking\requirements.txt (line 3)) (12.3.0)
    Requirement already satisfied: pyparsing>=3 in c:\users\user\documents\codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\ironecho\tracking\.venv\lib\site-packages (from matplotlib->mediapipe==1.0.1->-r C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Tracking\requirements.txt (line 3)) (3.3.3)
    Requirement already satisfied: python-dateutil>=2.7 in c:\users\user\documents\codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\ironecho\tracking\.venv\lib\site-packages (from matplotlib->mediapipe==1.0.1->-r C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Tracking\requirements.txt (line 3)) (2.9.0.post0)
    Requirement already satisfied: six>=1.5 in c:\users\user\documents\codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\ironecho\tracking\.venv\lib\site-packages (from python-dateutil>=2.7->matplotlib->mediapipe==1.0.1->-r C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Tracking\requirements.txt (line 3)) (1.17.0)
    Requirement already satisfied: pycparser in c:\users\user\documents\codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\ironecho\tracking\.venv\lib\site-packages (from cffi->sounddevice~=0.5->mediapipe==1.0.1->-r C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Tracking\requirements.txt (line 3)) (3.11)
    OK   tracker deps : requirements-dev.txt installed
    C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Tracking\models\pose_landmarker_lite.task ok
    C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Tracking\models\pose_landmarker_full.task ok
    C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Tracking\models\pose_landmarker_heavy.task ok
    OK   models : pose_landmarker lite/full/heavy verified (sha256)
    [{"index": 0, "width": 640, "height": 480, "fps": -1.0}]
    [ WARN:0@0.730] global cap.cpp:477 cv::VideoCapture::open VIDEOIO(DSHOW): backend is generally available but can't be used to capture by index
    [ WARN:0@0.735] global cap.cpp:477 cv::VideoCapture::open VIDEOIO(DSHOW): backend is generally available but can't be used to capture by index
    [ WARN:0@0.738] global cap.cpp:477 cv::VideoCapture::open VIDEOIO(DSHOW): backend is generally available but can't be used to capture by index
    [ WARN:0@0.742] global cap.cpp:477 cv::VideoCapture::open VIDEOIO(DSHOW): backend is generally available but can't be used to capture by index
    [ WARN:0@0.745] global cap.cpp:477 cv::VideoCapture::open VIDEOIO(DSHOW): backend is generally available but can't be used to capture by index
    OK   opencv cameras : [ WARN:0@0.745] global cap.cpp:477 cv::VideoCapture::open VIDEOIO(DSHOW): backend is generally available but can't be used to capture by index

==> Technical tests

==> Ownership blocks
    ownership blocks up to date

==> Core rules (CMake)
    -- Selecting Windows SDK version 10.0.22621.0 to target Windows 10.0.19045.
    -- Configuring done (0.0s)
    -- Generating done (0.0s)
    -- Build files have been written to: C:/Users/user/AppData/Local/Temp/IronEchoCoreRulesTests
    MSBuild version 17.14.60+43b635718 for .NET Framework
    
    C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Microsoft\VC\v170\Microsoft.CppBuild.targets(548,5): warning MSB8029: The Intermediate directory or Output directory cannot reside under the Temporary directory as it could lead to issues with incremental build. [C:\Users\user\AppData\Local\Temp\IronEchoCoreRulesTests\ZERO_CHECK.vcxproj]
      Checking File Globs
    C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Microsoft\VC\v170\Microsoft.CppBuild.targets(548,5): warning MSB8029: The Intermediate directory or Output directory cannot reside under the Temporary directory as it could lead to issues with incremental build. [C:\Users\user\AppData\Local\Temp\IronEchoCoreRulesTests\IronEchoRulesCore.vcxproj]
      IronEchoRulesCore.vcxproj -> C:\Users\user\AppData\Local\Temp\IronEchoCoreRulesTests\Release\IronEchoRulesCore.lib
    C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Microsoft\VC\v170\Microsoft.CppBuild.targets(548,5): warning MSB8029: The Intermediate directory or Output directory cannot reside under the Temporary directory as it could lead to issues with incremental build. [C:\Users\user\AppData\Local\Temp\IronEchoCoreRulesTests\CoreRulesTests.vcxproj]
      CoreRulesTests.vcxproj -> C:\Users\user\AppData\Local\Temp\IronEchoCoreRulesTests\Release\CoreRulesTests.exe
    C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Microsoft\VC\v170\Microsoft.CppBuild.targets(548,5): warning MSB8029: The Intermediate directory or Output directory cannot reside under the Temporary directory as it could lead to issues with incremental build. [C:\Users\user\AppData\Local\Temp\IronEchoCoreRulesTests\ALL_BUILD.vcxproj]
    [ OK ] Crc32_KnownVector
    [ OK ] Protocol_PoseRoundTrip
    [ OK ] Protocol_StatusControlAckRoundTrip
    [ OK ] Protocol_RejectsMalformed
    [ OK ] Protocol_ClampsOutOfRangeValues
    [ OK ] Protocol_ForwardCompatibleMinorVersion
    [ OK ] Protocol_FuzzNeverCrashes
    [ OK ] Protocol_GoldenVectorsFromPython
    [ OK ] Gate_AcceptsInOrderAndRejectsReplay
    [ OK ] Gate_RejectsWrongSessionStaleAndClockRegression
    [ OK ] Gate_DeveloperTokenZeroAcceptsAny
    [ OK ] Gate_LivenessTimeout
    [ OK ] Gate_InstanceSwitchNeedsSilence
    [ OK ] Gate_EventsDeduplicatedAcrossRepeats
    [ OK ] Gate_LostFirstPacketEventRecoveredFromRepeat
    [ OK ] Gate_StaleEventsDropped
    [ OK ] Gate_StatusMapping
    [ OK ] Gate_RejectsControlPacketsAndGarbage
    [ OK ] Gate_AckLookup
    [ OK ] Intent_DodgeHysteresis
    [ OK ] Intent_BlockHysteresisAndPunchCancels
    [ OK ] Intent_NotLiveIsNeutral
    [ OK ] Intent_LowConfidencePunchFiltered
    [ OK ] Fighter_JabTimelineIsExact
    [ OK ] Fighter_ComboCancelOtherHandOnly
    [ OK ] Fighter_InputBufferStartsWhenFreeOrExpires
    [ OK ] Fighter_BlockReducesDamageCostsStaminaNeverKOs
    [ OK ] Fighter_GuardBreaksWithoutStamina
    [ OK ] Fighter_DodgeEvadesAndPunishesWithPenalty
    [ OK ] Fighter_DodgeReturningToCentreGetsHit
    [ OK ] Fighter_HeldDodgeExpires
    [ OK ] Fighter_OutOfRangeWhiffs
    [ OK ] Fighter_TradeIsSymmetric
    [ OK ] Fighter_CounterHitBonusAndInterrupt
    [ OK ] Fighter_StaminaSpendRegenAndTiredPunch
    [ OK ] Fighter_KnockOutWhenKnockdownsDisabled
    [ OK ] Fighter_TrainingBagTakesHitsForever
    [ OK ] Fighter_KnockdownAndGetUpRecovery
    [ OK ] Fighter_ComboCountsConsecutiveCleanHits
    [ OK ] Fighter_DefenseStatsCountBlocksAndDodges
    [ OK ] Fighter_CoverUpFromHitStunKeepsPunchesLocked
    [ OK ] Fighter_TiredPunchIsAWeakArmPunch
    [ OK ] Fighter_GuardDrainScalesWithPowerAndKeepsRegen
    [ OK ] Fighter_EmptyingStaminaCostsABreath
    [ OK ] Ring_StartsFacingAtEngageDistance
    [ OK ] Ring_StepsHaveWeight
    [ OK ] Ring_StepInStopsAtClinchStepBackOpens
    [ OK ] Ring_CirclingKeepsDistanceAndTurnsTheFightLine
    [ OK ] Ring_RopesStopTheRetreat
    [ OK ] Ring_CornerHoldsBothAxes
    [ OK ] Ring_CameraPlayerIsBroughtBackIntoRange
    [ OK ] Ring_StunnedLegsDoNotWalk
    [ OK ] Ring_KnockbackFollowsTheFightLine
    [ OK ] Precision_SlipInTimeMakesTheCrossMiss
    [ OK ] Precision_TooLateSlipStillGetsHit
    [ OK ] Precision_SlipHeldFromBeforeIsTracked
    [ OK ] Precision_HalfSlipIsAGlancingBlow
    [ OK ] Precision_FullPowerAtTheEndOfTheArmSmotheredInTheClinch
    [ OK ] Precision_StepBackOutOfATelegraphedPunch
    [ OK ] Precision_CirclingTargetIsLed
    [ OK ] Precision_ChangeOfDirectionBeatsACommittedPunch
    [ OK ] Body_ShotCannotBeSlippedAndTakesTheWind
    [ OK ] Body_ShotsAreShorter
    [ OK ] Body_GuardPaysMoreForABodyShot
    [ OK ] Intent_CameraLeanStepsWithHysteresisDirectInputWins
    [ OK ] Kick_TimelineReachAndPower
    [ OK ] Kick_ReachesWherePunchesDoNot
    [ OK ] Kick_StepBackOutOfIt_MissCostsMore
    [ OK ] Kick_GuardBlocksMidKickButNotLowKick_SlipDoesNotHelpEither
    [ OK ] Kick_LowKickSlowsTheLegsAndStacks
    [ OK ] Kick_RecoveryCannotBeCancelledButPunchRecoveryCanBeKicked
    [ OK ] Kick_KickingFighterBarelyMoves
    [ OK ] Kick_IntentKeepsKindAndLowPunchBecomesBody
    [ OK ] Match_WaitsForStableInputThenCountsDown
      info: result=3 fight=20.0s bot_punches=22 landed=31 score=19-19
    [ OK ] Match_FullBoutReachesResultWithInvariants
    [ OK ] Match_DecisionScoringAndRoundBreakRecovery
    [ OK ] Match_StayingDownForTenIsKnockOut
    [ OK ] Match_TrackingLossPausesAfterGraceAndResumesWhenStable
    [ OK ] Match_ManualPauseNeedsResumeRequest
    [ OK ] Match_RematchResetsEverything
    [ OK ] Match_TrainingCountsConfirmedBagHits
    [ OK ] Match_DeterministicForSeed
      info: bot hits on scripted player: easy=29 hard=52
    [ OK ] Match_BotDifficultyOrdering
    [ OK ] Match_PlayerBeatsCountByHoldingGuard
    [ OK ] Match_ReleasingGuardResetsGetUp
    [ OK ] Match_ThirdKnockdownInRoundIsTechnicalKnockOut
    [ OK ] Match_TrackingLossDuringCountPausesAndResumesCount
    [ OK ] Judges_ScoreRoundWithStylesAndKnockdowns
    [ OK ] Judges_DecisionKinds
    [ OK ] Versus_NeedsBothHumansReady
    [ OK ] Versus_BothFightersUseTheSameRulesAndTheSecondIsHuman
    [ OK ] Versus_SecondHumanBeatsTheCountByHoldingTheGuard
    [ OK ] Versus_TwoRunsOfTheSameInputsAreBitIdentical
    [ OK ] Versus_RewindFromAByteCopyAndReplayIsBitIdentical
    [ OK ] Versus_FullBoutEndsWithAResultAndInvariantsHold
      info: jabs defended of 40: easy=0 normal=30 hard=32
    [ OK ] Bot_ReadsTheJabAtNormalAndHardButNotEasy
    [ OK ] Bot_RetriesAPlannedAttackRightAfterAStun
    [ OK ] Bot_BlocksThenCounters
      info: flurry punches blocked of 60: plain=37 read=43
    [ OK ] Bot_ReadsAFlurryAndCoversUp
      info: bot punches in 30 s: fresh player=28 gassed player=33
    [ OK ] Bot_PressesAGassedPlayer
    [ OK ] Bot_WalksBackIntoItsWorkingDistance
    [ OK ] Bot_StepsInToLandAPlannedPunch
    [ OK ] Bot_SlidesOffTheRopes
    [ OK ] Bot_CirclesBetweenExchanges
      info: bot body-shot share: open=0.13 guard=0.36
    [ OK ] Bot_GoesToTheBodyMoreAgainstAGuard
      info: bot kicks in 40 s at kick range: 12
    [ OK ] Bot_KicksWhenThePlayerStandsJustOutOfPunchReach
      info: average human wins easy=16 normal=10 hard=2 of 16; normal: decisions=7 r1 stoppages=0 rounds=3.00
    [ OK ] Balance_BoutsLastAndLevelsAreOrdered
      info: flailing wins normal=5 hard=1 of 16 (measured boxing: 10)
    [ OK ] Balance_FlailingDoesNotWin
    
    108 test cases, 0 failed expectations

==> Tracker (pytest + selftest)
    ...
    {"version": "0.1.0", "protocol": "1.0", "frames": 370, "packets_received": 377, "pose_frames": 370, "calibration": "VALID", "punch_events": 4, "hands": [0, 1, 0, 1], "sequence_monotonic": true, "model": "pose_landmarker_full", "model_inference_ms": 12.4, "ok": true}
    2026-10-09 23:27:03,122 INFO iron_echo_tracker: calibration saved to C:\Users\user\AppData\Local\Temp\tmpoxx24otm\calibration.json
    2026-10-09 23:27:03,670 INFO iron_echo_tracker: punch LEFT strength=0.78
    2026-10-09 23:27:03,837 INFO iron_echo_tracker: punch RIGHT strength=0.65
    2026-10-09 23:27:04,012 INFO iron_echo_tracker: punch LEFT strength=0.64
    2026-10-09 23:27:04,195 INFO iron_echo_tracker: punch RIGHT strength=0.89
    2026-10-09 23:27:04,622 INFO iron_echo_tracker: tracker exit: source finished
    INFO: Created TensorFlow Lite XNNPACK delegate for CPU.
    WARNING: Logging before InitGoogle() is written to STDERR
    W0000 00:00:1791570425.450538    7368 inference_feedback_manager.cc:121] Feedback manager requires a model with a single signature inference. Disabling support for feedback tensors.
    W0000 00:00:1791570425.467204   12760 inference_feedback_manager.cc:121] Feedback manager requires a model with a single signature inference. Disabling support for feedback tensors.

==> Tool tests (robot contract checks)
    ......                                                                   [100%]
    6 passed in 0.02s
    OK   all tests passed; logs: C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Saved\Logs\Tests\20261009-232648
    OK   tests : ownership + core rules + tracker

==> Unreal project
    OK   engine association : 5.8

==> Report: C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Docs\Reports\2026-10-09_env_windows.md
    OK   bootstrap complete
```

### bootstrap-pwsh.log

```text

==> Hardware
{
  "measured_utc": "2026-10-09T18:18:46Z",
  "os": "Microsoft Windows 10 Pro 10.0.19045 build 19045 64-bit",
  "cpu": "12th Gen Intel(R) Core(TM) i5-12400F (6C/12T)",
  "ram_gib": 31.8,
  "gpus": [
    {
      "name": "NVIDIA GeForce RTX 3050",
      "vram_mib": 8192,
      "driver": "595.79",
      "source": "nvidia-smi"
    }
  ],
  "displays": [
    {
      "adapter": "NVIDIA GeForce RTX 3050",
      "resolution": "1920x1080",
      "refresh_hz": 165
    }
  ],
  "cameras": [
    {
      "name": "HD camera ",
      "status": "OK",
      "class": "Camera"
    }
  ]
}
    OK   hardware written to C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Saved\Bootstrap\20261009-231843\hardware.json
    OK   hardware : Microsoft Windows 10 Pro 10.0.19045 build 19045 64-bit; 12th Gen Intel(R) Core(TM) i5-12400F (6C/12T); 31.8 GiB RAM
    OK   gpu NVIDIA GeForce RTX 3050 : VRAM 8192 MiB via nvidia-smi, driver 595.79
    OK   camera devices : HD camera 

==> Unreal Engine
    OK   unreal : 5.8.3 at C:\Program Files\Epic Games\UE_5.8 (launcher)

==> Visual Studio / MSVC / Windows SDK
    OK   visual studio : Visual Studio Build Tools 2022 17.14.37710.0; MSVC 14.44.35207
    OK   windows sdk : 10.0.22621.0

==> Blender
    OK   blender : Blender 5.2.2 LTS at C:\Program Files\Blender Foundation\Blender 5.2\blender.exe

==> Python 3.12 (tracker development)
    OK   python : 3.12.10 at C:\Users\user\AppData\Local\Programs\Python\Python312\python.exe

==> Git / LFS
    OK   git : git version 2.53.0.windows.3
    OK   git lfs : git-lfs/3.7.1 (GitHub; windows amd64; go 1.25.1; git b84b3384)

==> Local settings
    OK   local settings : C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Tools\local.settings.json

==> Tracker virtual environment
    Collecting mediapipe==1.0.1 (from -r C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Tracking\requirements.txt (line 3))
      Using cached mediapipe-1.0.1-py3-none-win_amd64.whl.metadata (10 kB)
    Collecting numpy==2.5.3 (from -r C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Tracking\requirements.txt (line 4))
      Using cached numpy-2.5.3-cp312-cp312-win_amd64.whl.metadata (6.6 kB)
    Collecting opencv-contrib-python==5.0.0.93 (from -r C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Tracking\requirements.txt (line 5))
      Using cached opencv_contrib_python-5.0.0.93-cp37-abi3-win_amd64.whl.metadata (20 kB)
    Collecting pytest==9.1.1 (from -r Tracking\requirements-dev.txt (line 2))
      Using cached pytest-9.1.1-py3-none-any.whl.metadata (7.6 kB)
    Collecting pyinstaller==6.22.3 (from -r Tracking\requirements-dev.txt (line 3))
      Using cached pyinstaller-6.22.3-py3-none-win_amd64.whl.metadata (8.5 kB)
    Collecting absl-py~=2.3 (from mediapipe==1.0.1->-r C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Tracking\requirements.txt (line 3))
      Downloading absl_py-2.5.1-py3-none-any.whl.metadata (3.3 kB)
    Collecting certifi (from mediapipe==1.0.1->-r C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Tracking\requirements.txt (line 3))
      Using cached certifi-2026.7.22-py3-none-any.whl.metadata (2.5 kB)
    Collecting sounddevice~=0.5 (from mediapipe==1.0.1->-r C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Tracking\requirements.txt (line 3))
      Using cached sounddevice-0.5.6-py3-none-win_amd64.whl.metadata (1.4 kB)
    Collecting flatbuffers~=25.9 (from mediapipe==1.0.1->-r C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Tracking\requirements.txt (line 3))
      Using cached flatbuffers-25.12.19-py2.py3-none-any.whl.metadata (1.0 kB)
    Collecting matplotlib (from mediapipe==1.0.1->-r C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Tracking\requirements.txt (line 3))
      Using cached matplotlib-3.11.2-cp312-cp312-win_amd64.whl.metadata (80 kB)
    Collecting colorama>=0.4 (from pytest==9.1.1->-r Tracking\requirements-dev.txt (line 2))
      Using cached colorama-0.4.6-py2.py3-none-any.whl.metadata (17 kB)
    Collecting iniconfig>=1.0.1 (from pytest==9.1.1->-r Tracking\requirements-dev.txt (line 2))
      Downloading iniconfig-2.3.1-py3-none-any.whl.metadata (2.8 kB)
    Collecting packaging>=22 (from pytest==9.1.1->-r Tracking\requirements-dev.txt (line 2))
      Using cached packaging-26.3-py3-none-any.whl.metadata (3.5 kB)
    Collecting pluggy<2,>=1.5 (from pytest==9.1.1->-r Tracking\requirements-dev.txt (line 2))
      Using cached pluggy-1.6.0-py3-none-any.whl.metadata (4.8 kB)
    Collecting pygments>=2.7.2 (from pytest==9.1.1->-r Tracking\requirements-dev.txt (line 2))
      Using cached pygments-2.21.0-py3-none-any.whl.metadata (2.5 kB)
    Collecting altgraph (from pyinstaller==6.22.3->-r Tracking\requirements-dev.txt (line 3))
      Using cached altgraph-0.17.5-py2.py3-none-any.whl.metadata (7.5 kB)
    Collecting pefile>=2022.5.30 (from pyinstaller==6.22.3->-r Tracking\requirements-dev.txt (line 3))
      Using cached pefile-2024.8.26-py3-none-any.whl.metadata (1.4 kB)
    Collecting pyinstaller-hooks-contrib>=2026.7 (from pyinstaller==6.22.3->-r Tracking\requirements-dev.txt (line 3))
      Using cached pyinstaller_hooks_contrib-2026.8-py3-none-any.whl.metadata (16 kB)
    Collecting pywin32-ctypes>=0.2.1 (from pyinstaller==6.22.3->-r Tracking\requirements-dev.txt (line 3))
      Using cached pywin32_ctypes-0.2.3-py3-none-any.whl.metadata (3.9 kB)
    Collecting setuptools>=42.0.0 (from pyinstaller==6.22.3->-r Tracking\requirements-dev.txt (line 3))
      Using cached setuptools-84.0.0-py3-none-any.whl.metadata (6.6 kB)
    Collecting cffi (from sounddevice~=0.5->mediapipe==1.0.1->-r C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Tracking\requirements.txt (line 3))
      Using cached cffi-2.1.1-cp312-cp312-win_amd64.whl.metadata (2.6 kB)
    Collecting contourpy>=1.0.1 (from matplotlib->mediapipe==1.0.1->-r C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Tracking\requirements.txt (line 3))
      Using cached contourpy-1.4.0-cp312-cp312-win_amd64.whl.metadata (3.8 kB)
    Collecting cycler>=0.10 (from matplotlib->mediapipe==1.0.1->-r C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Tracking\requirements.txt (line 3))
      Using cached cycler-0.12.1-py3-none-any.whl.metadata (3.8 kB)
    Collecting fonttools>=4.28.2 (from matplotlib->mediapipe==1.0.1->-r C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Tracking\requirements.txt (line 3))
      Using cached fonttools-4.66.1-cp312-cp312-win_amd64.whl.metadata (132 kB)
    Collecting kiwisolver>=1.3.1 (from matplotlib->mediapipe==1.0.1->-r C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Tracking\requirements.txt (line 3))
      Using cached kiwisolver-1.5.1-cp312-cp312-win_amd64.whl.metadata (5.2 kB)
    Collecting pillow>=9 (from matplotlib->mediapipe==1.0.1->-r C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Tracking\requirements.txt (line 3))
      Using cached pillow-12.3.0-cp312-cp312-win_amd64.whl.metadata (9.3 kB)
    Collecting pyparsing>=3 (from matplotlib->mediapipe==1.0.1->-r C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Tracking\requirements.txt (line 3))
      Using cached pyparsing-3.3.3-py3-none-any.whl.metadata (5.9 kB)
    Collecting python-dateutil>=2.7 (from matplotlib->mediapipe==1.0.1->-r C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Tracking\requirements.txt (line 3))
      Using cached python_dateutil-2.9.0.post0-py2.py3-none-any.whl.metadata (8.4 kB)
    Collecting six>=1.5 (from python-dateutil>=2.7->matplotlib->mediapipe==1.0.1->-r C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Tracking\requirements.txt (line 3))
      Using cached six-1.17.0-py2.py3-none-any.whl.metadata (1.7 kB)
    Collecting pycparser (from cffi->sounddevice~=0.5->mediapipe==1.0.1->-r C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Tracking\requirements.txt (line 3))
      Downloading pycparser-3.11-py3-none-any.whl.metadata (8.2 kB)
    Using cached mediapipe-1.0.1-py3-none-win_amd64.whl (20.1 MB)
    Using cached numpy-2.5.3-cp312-cp312-win_amd64.whl (12.6 MB)
    Using cached opencv_contrib_python-5.0.0.93-cp37-abi3-win_amd64.whl (53.8 MB)
    Using cached pytest-9.1.1-py3-none-any.whl (386 kB)
    Using cached pyinstaller-6.22.3-py3-none-win_amd64.whl (1.5 MB)
    Downloading absl_py-2.5.1-py3-none-any.whl (137 kB)
    Using cached colorama-0.4.6-py2.py3-none-any.whl (25 kB)
    Using cached flatbuffers-25.12.19-py2.py3-none-any.whl (26 kB)
    Downloading iniconfig-2.3.1-py3-none-any.whl (7.6 kB)
    Using cached packaging-26.3-py3-none-any.whl (129 kB)
    Using cached pefile-2024.8.26-py3-none-any.whl (74 kB)
    Using cached pluggy-1.6.0-py3-none-any.whl (20 kB)
    Using cached pygments-2.21.0-py3-none-any.whl (1.3 MB)
    Using cached pyinstaller_hooks_contrib-2026.8-py3-none-any.whl (462 kB)
    Using cached pywin32_ctypes-0.2.3-py3-none-any.whl (30 kB)
    Using cached setuptools-84.0.0-py3-none-any.whl (818 kB)
    Using cached sounddevice-0.5.6-py3-none-win_amd64.whl (1.0 MB)
    Using cached altgraph-0.17.5-py2.py3-none-any.whl (21 kB)
    Using cached certifi-2026.7.22-py3-none-any.whl (136 kB)
    Using cached matplotlib-3.11.2-cp312-cp312-win_amd64.whl (9.3 MB)
    Using cached contourpy-1.4.0-cp312-cp312-win_amd64.whl (234 kB)
    Using cached cycler-0.12.1-py3-none-any.whl (8.3 kB)
    Using cached fonttools-4.66.1-cp312-cp312-win_amd64.whl (2.5 MB)
    Using cached kiwisolver-1.5.1-cp312-cp312-win_amd64.whl (70 kB)
    Using cached pillow-12.3.0-cp312-cp312-win_amd64.whl (7.2 MB)
    Using cached pyparsing-3.3.3-py3-none-any.whl (126 kB)
    Using cached python_dateutil-2.9.0.post0-py2.py3-none-any.whl (229 kB)
    Using cached cffi-2.1.1-cp312-cp312-win_amd64.whl (185 kB)
    Using cached six-1.17.0-py2.py3-none-any.whl (11 kB)
    Downloading pycparser-3.11-py3-none-any.whl (51 kB)
    Installing collected packages: flatbuffers, altgraph, six, setuptools, pywin32-ctypes, pyparsing, pygments, pycparser, pluggy, pillow, pefile, packaging, numpy, kiwisolver, iniconfig, fonttools, cycler, colorama, certifi, absl-py, python-dateutil, pytest, pyinstaller-hooks-contrib, opencv-contrib-python, contourpy, cffi, sounddevice, pyinstaller, matplotlib, mediapipe
    Successfully installed absl-py-2.5.1 altgraph-0.17.5 certifi-2026.7.22 cffi-2.1.1 colorama-0.4.6 contourpy-1.4.0 cycler-0.12.1 flatbuffers-25.12.19 fonttools-4.66.1 iniconfig-2.3.1 kiwisolver-1.5.1 matplotlib-3.11.2 mediapipe-1.0.1 numpy-2.5.3 opencv-contrib-python-5.0.0.93 packaging-26.3 pefile-2024.8.26 pillow-12.3.0 pluggy-1.6.0 pycparser-3.11 pygments-2.21.0 pyinstaller-6.22.3 pyinstaller-hooks-contrib-2026.8 pyparsing-3.3.3 pytest-9.1.1 python-dateutil-2.9.0.post0 pywin32-ctypes-0.2.3 setuptools-84.0.0 six-1.17.0 sounddevice-0.5.6
    OK   tracker deps : requirements-dev.txt installed
    C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Tracking\models\pose_landmarker_lite.task downloaded
    C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Tracking\models\pose_landmarker_full.task downloaded
    C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Tracking\models\pose_landmarker_heavy.task downloaded
    OK   models : pose_landmarker lite/full/heavy verified (sha256)
    [{"index": 0, "width": 640, "height": 480, "fps": -1.0}]
    [ WARN:0@1.915] global cap.cpp:477 cv::VideoCapture::open VIDEOIO(DSHOW): backend is generally available but can't be used to capture by index
    [ WARN:0@1.933] global cap.cpp:477 cv::VideoCapture::open VIDEOIO(DSHOW): backend is generally available but can't be used to capture by index
    [ WARN:0@1.946] global cap.cpp:477 cv::VideoCapture::open VIDEOIO(DSHOW): backend is generally available but can't be used to capture by index
    [ WARN:0@1.957] global cap.cpp:477 cv::VideoCapture::open VIDEOIO(DSHOW): backend is generally available but can't be used to capture by index
    [ WARN:0@1.965] global cap.cpp:477 cv::VideoCapture::open VIDEOIO(DSHOW): backend is generally available but can't be used to capture by index
    OK   opencv cameras : [ WARN:0@1.965] global cap.cpp:477 cv::VideoCapture::open VIDEOIO(DSHOW): backend is generally available but can't be used to capture by index

==> Technical tests

==> Ownership blocks
    ownership blocks up to date

==> Core rules (CMake)
    -- Building for: Visual Studio 17 2022
    -- Selecting Windows SDK version 10.0.22621.0 to target Windows 10.0.19045.
    -- The CXX compiler identification is MSVC 19.44.35229.0
    -- Detecting CXX compiler ABI info
    -- Detecting CXX compiler ABI info - failed
    -- Check for working CXX compiler: C:/Program Files (x86)/Microsoft Visual Studio/2022/BuildTools/VC/Tools/MSVC/14.44.35207/bin/Hostx64/x64/cl.exe
    -- Check for working CXX compiler: C:/Program Files (x86)/Microsoft Visual Studio/2022/BuildTools/VC/Tools/MSVC/14.44.35207/bin/Hostx64/x64/cl.exe - broken
    -- Configuring incomplete, errors occurred!
    CMake Error at C:/Program Files (x86)/Microsoft Visual Studio/2022/BuildTools/Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/share/cmake-3.31/Modules/CMakeTestCXXCompiler.cmake:73 (message):
      The C++ compiler
    
        "C:/Program Files (x86)/Microsoft Visual Studio/2022/BuildTools/VC/Tools/MSVC/14.44.35207/bin/Hostx64/x64/cl.exe"
    
      is not able to compile a simple test program.
    
      It fails with the following output:
    
        Change Dir: 'C:/Users/user/Documents/Codex/2026-10-09/windows-1-ironecho-canopybridge-claude-wizardly/work/canopybridge-check/IronEcho/Build/CoreRulesTests/CMakeFiles/CMakeScratch/TryCompile-ct7u9f'
        
        Run Build Command(s): "C:/Program Files (x86)/Microsoft Visual Studio/2022/BuildTools/MSBuild/Current/Bin/amd64/MSBuild.exe" cmTC_b1349.vcxproj /p:Configuration=Debug /p:Platform=x64 /p:VisualStudioVersion=17.0 /v:n
        MSBuild version 17.14.60+43b635718 for .NET Framework
        Build started 10/9/2026 11:19:19 PM.
        
        Project "C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Build\CoreRulesTests\CMakeFiles\CMakeScratch\TryCompile-ct7u9f\cmTC_b1349.vcxproj" on node 1 (default targets).
        PrepareForBuild:
          Creating directory "cmTC_b1349.dir\Debug\".
          Structured output is enabled. The formatting of compiler diagnostics will reflect the error hierarchy. See https://aka.ms/cpp/structured-output for more details.
          Creating directory "C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Build\CoreRulesTests\CMakeFiles\CMakeScratch\TryCompile-ct7u9f\Debug\".
          Creating directory "cmTC_b1349.dir\Debug\cmTC_b1349.tlog\".
        InitializeBuildStatus:
          Creating "cmTC_b1349.dir\Debug\cmTC_b1349.tlog\unsuccessfulbuild" because "AlwaysCreate" was specified.
          Touching "cmTC_b1349.dir\Debug\cmTC_b1349.tlog\unsuccessfulbuild".
        ClCompile:
          C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\14.44.35207\bin\HostX64\x64\CL.exe /c /Zi /W1 /WX- /diagnostics:column /Od /Ob0 /D _MBCS /D WIN32 /D _WINDOWS /D "CMAKE_INTDIR=\"Debug\"" /EHsc /RTC1 /MDd /GS /fp:precise /Zc:wchar_t /Zc:forScope /Zc:inline /Fo"cmTC_b1349.dir\Debug\\" /Fd"cmTC_b1349.dir\Debug\vc143.pdb" /external:W1 /Gd /TP /errorReport:queue "C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Build\CoreRulesTests\CMakeFiles\CMakeScratch\TryCompile-ct7u9f\testCXXCompiler.cxx"
          Microsoft (R) C/C++ Optimizing Compiler Version 19.44.35229 for x64
          Copyright (C) Microsoft Corporation.  All rights reserved.
          cl /c /Zi /W1 /WX- /diagnostics:column /Od /Ob0 /D _MBCS /D WIN32 /D _WINDOWS /D "CMAKE_INTDIR=\"Debug\"" /EHsc /RTC1 /MDd /GS /fp:precise /Zc:wchar_t /Zc:forScope /Zc:inline /Fo"cmTC_b1349.dir\Debug\\" /Fd"cmTC_b1349.dir\Debug\vc143.pdb" /external:W1 /Gd /TP /errorReport:queue "C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Build\CoreRulesTests\CMakeFiles\CMakeScratch\TryCompile-ct7u9f\testCXXCompiler.cxx"
          testCXXCompiler.cxx
        C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Microsoft\VC\v170\Microsoft.CppCommon.targets(787,5): error MSB6003: The specified task executable "CL.exe" could not be run. System.IO.DirectoryNotFoundException: Could not find a part of the path 'C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Build\CoreRulesTests\CMakeFiles\CMakeScratch\TryCompile-ct7u9f\cmTC_b1349.dir\Debug\cmTC_b1349.tlog'. [C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Build\CoreRulesTests\CMakeFiles\CMakeScratch\TryCompile-ct7u9f\cmTC_b1349.vcxproj]
        C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Microsoft\VC\v170\Microsoft.CppCommon.targets(787,5): error MSB6003:    at System.IO.__Error.WinIOError(Int32 errorCode, String maybeFullPath) [C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Build\CoreRulesTests\CMakeFiles\CMakeScratch\TryCompile-ct7u9f\cmTC_b1349.vcxproj]
        C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Microsoft\VC\v170\Microsoft.CppCommon.targets(787,5): error MSB6003:    at System.IO.FileSystemEnumerableIterator`1.CommonInit() [C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Build\CoreRulesTests\CMakeFiles\CMakeScratch\TryCompile-ct7u9f\cmTC_b1349.vcxproj]
        C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Microsoft\VC\v170\Microsoft.CppCommon.targets(787,5): error MSB6003:    at System.IO.FileSystemEnumerableIterator`1..ctor(String path, String originalUserPath, String searchPattern, SearchOption searchOption, SearchResultHandler`1 resultHandler, Boolean checkHost) [C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Build\CoreRulesTests\CMakeFiles\CMakeScratch\TryCompile-ct7u9f\cmTC_b1349.vcxproj]
        C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Microsoft\VC\v170\Microsoft.CppCommon.targets(787,5): error MSB6003:    at System.IO.Directory.GetFiles(String path, String searchPattern) [C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Build\CoreRulesTests\CMakeFiles\CMakeScratch\TryCompile-ct7u9f\cmTC_b1349.vcxproj]
        C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Microsoft\VC\v170\Microsoft.CppCommon.targets(787,5): error MSB6003:    at Microsoft.Build.Utilities.TrackedDependencies.ExpandWildcards(ITaskItem[] expand, TaskLoggingHelper log) [C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Build\CoreRulesTests\CMakeFiles\CMakeScratch\TryCompile-ct7u9f\cmTC_b1349.vcxproj]
        C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Microsoft\VC\v170\Microsoft.CppCommon.targets(787,5): error MSB6003:    at Microsoft.Build.Utilities.CanonicalTrackedOutputFiles.InternalConstruct(ITask ownerTask, ITaskItem[] tlogFiles, Boolean constructOutputsFromTLogs) [C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Build\CoreRulesTests\CMakeFiles\CMakeScratch\TryCompile-ct7u9f\cmTC_b1349.vcxproj]
        C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Microsoft\VC\v170\Microsoft.CppCommon.targets(787,5): error MSB6003:    at Microsoft.Build.CPPTasks.CL.PostExecuteTool(Int32 exitCode) [C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Build\CoreRulesTests\CMakeFiles\CMakeScratch\TryCompile-ct7u9f\cmTC_b1349.vcxproj]
        C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Microsoft\VC\v170\Microsoft.CppCommon.targets(787,5): error MSB6003:    at Microsoft.Build.CPPTasks.TrackedVCToolTask.ExecuteTool(String pathToTool, String responseFileCommands, String commandLineCommands) [C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Build\CoreRulesTests\CMakeFiles\CMakeScratch\TryCompile-ct7u9f\cmTC_b1349.vcxproj]
        C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Microsoft\VC\v170\Microsoft.CppCommon.targets(787,5): error MSB6003:    at Microsoft.Build.CPPTasks.CL.ExecuteTool(String pathToTool, String responseFileCommands, String commandLineCommands) [C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Build\CoreRulesTests\CMakeFiles\CMakeScratch\TryCompile-ct7u9f\cmTC_b1349.vcxproj]
        C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Microsoft\VC\v170\Microsoft.CppCommon.targets(787,5): error MSB6003:    at Microsoft.Build.Utilities.ToolTask.Execute() [C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Build\CoreRulesTests\CMakeFiles\CMakeScratch\TryCompile-ct7u9f\cmTC_b1349.vcxproj]
        Done Building Project "C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Build\CoreRulesTests\CMakeFiles\CMakeScratch\TryCompile-ct7u9f\cmTC_b1349.vcxproj" (default targets) -- FAILED.
        
        Build FAILED.
        
        "C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Build\CoreRulesTests\CMakeFiles\CMakeScratch\TryCompile-ct7u9f\cmTC_b1349.vcxproj" (default target) (1) ->
        (ClCompile target) -> 
          C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Microsoft\VC\v170\Microsoft.CppCommon.targets(787,5): error MSB6003: The specified task executable "CL.exe" could not be run. System.IO.DirectoryNotFoundException: Could not find a part of the path 'C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Build\CoreRulesTests\CMakeFiles\CMakeScratch\TryCompile-ct7u9f\cmTC_b1349.dir\Debug\cmTC_b1349.tlog'. [C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Build\CoreRulesTests\CMakeFiles\CMakeScratch\TryCompile-ct7u9f\cmTC_b1349.vcxproj]
        C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Microsoft\VC\v170\Microsoft.CppCommon.targets(787,5): error MSB6003:    at System.IO.__Error.WinIOError(Int32 errorCode, String maybeFullPath) [C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Build\CoreRulesTests\CMakeFiles\CMakeScratch\TryCompile-ct7u9f\cmTC_b1349.vcxproj]
        C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Microsoft\VC\v170\Microsoft.CppCommon.targets(787,5): error MSB6003:    at System.IO.FileSystemEnumerableIterator`1.CommonInit() [C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Build\CoreRulesTests\CMakeFiles\CMakeScratch\TryCompile-ct7u9f\cmTC_b1349.vcxproj]
        C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Microsoft\VC\v170\Microsoft.CppCommon.targets(787,5): error MSB6003:    at System.IO.FileSystemEnumerableIterator`1..ctor(String path, String originalUserPath, String searchPattern, SearchOption searchOption, SearchResultHandler`1 resultHandler, Boolean checkHost) [C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Build\CoreRulesTests\CMakeFiles\CMakeScratch\TryCompile-ct7u9f\cmTC_b1349.vcxproj]
        C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Microsoft\VC\v170\Microsoft.CppCommon.targets(787,5): error MSB6003:    at System.IO.Directory.GetFiles(String path, String searchPattern) [C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Build\CoreRulesTests\CMakeFiles\CMakeScratch\TryCompile-ct7u9f\cmTC_b1349.vcxproj]
        C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Microsoft\VC\v170\Microsoft.CppCommon.targets(787,5): error MSB6003:    at Microsoft.Build.Utilities.TrackedDependencies.ExpandWildcards(ITaskItem[] expand, TaskLoggingHelper log) [C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Build\CoreRulesTests\CMakeFiles\CMakeScratch\TryCompile-ct7u9f\cmTC_b1349.vcxproj]
        C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Microsoft\VC\v170\Microsoft.CppCommon.targets(787,5): error MSB6003:    at Microsoft.Build.Utilities.CanonicalTrackedOutputFiles.InternalConstruct(ITask ownerTask, ITaskItem[] tlogFiles, Boolean constructOutputsFromTLogs) [C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Build\CoreRulesTests\CMakeFiles\CMakeScratch\TryCompile-ct7u9f\cmTC_b1349.vcxproj]
        C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Microsoft\VC\v170\Microsoft.CppCommon.targets(787,5): error MSB6003:    at Microsoft.Build.CPPTasks.CL.PostExecuteTool(Int32 exitCode) [C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Build\CoreRulesTests\CMakeFiles\CMakeScratch\TryCompile-ct7u9f\cmTC_b1349.vcxproj]
        C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Microsoft\VC\v170\Microsoft.CppCommon.targets(787,5): error MSB6003:    at Microsoft.Build.CPPTasks.TrackedVCToolTask.ExecuteTool(String pathToTool, String responseFileCommands, String commandLineCommands) [C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Build\CoreRulesTests\CMakeFiles\CMakeScratch\TryCompile-ct7u9f\cmTC_b1349.vcxproj]
        C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Microsoft\VC\v170\Microsoft.CppCommon.targets(787,5): error MSB6003:    at Microsoft.Build.CPPTasks.CL.ExecuteTool(String pathToTool, String responseFileCommands, String commandLineCommands) [C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Build\CoreRulesTests\CMakeFiles\CMakeScratch\TryCompile-ct7u9f\cmTC_b1349.vcxproj]
        C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Microsoft\VC\v170\Microsoft.CppCommon.targets(787,5): error MSB6003:    at Microsoft.Build.Utilities.ToolTask.Execute() [C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Build\CoreRulesTests\CMakeFiles\CMakeScratch\TryCompile-ct7u9f\cmTC_b1349.vcxproj]
        
            0 Warning(s)
            1 Error(s)
        
        Time Elapsed 00:00:00.25
        
        
    
      
    
      CMake will not be able to correctly generate this project.
    Call Stack (most recent call first):
      CMakeLists.txt:5 (project)
    
    

==> Tracker (pytest + selftest)
    ...
    ================================== FAILURES ===================================
    _____________________ test_golden_vectors_are_up_to_date ______________________
    
    tmp_path = WindowsPath('C:/Users/user/AppData/Local/Temp/pytest-of-user/pytest-2/test_golden_vectors_are_up_to_0')
    
        def test_golden_vectors_are_up_to_date(tmp_path):
            """Committed golden files must equal a fresh generation (the C++ test consumes the committed ones)."""
            written = golden.write_vectors(tmp_path)
            assert len(written) >= 7
            for path in written:
                committed = GOLDEN_DIR / path.name
                assert committed.exists(), f"missing {committed}; run: python -m iron_echo_tracker golden --out {GOLDEN_DIR}"
    >           assert committed.read_bytes() == path.read_bytes(), f"{path.name} differs from the committed golden file"
    E           AssertionError: manifest.txt differs from the committed golden file
    E           assert b'# IRON ECHO...anyEvents\r\n' == b'# IRON ECHO...oManyEvents\n'
    E             
    E             At index 88 diff: b'\r' != b'\n'
    E             Use -v to get more diff
    
    tests\test_protocol.py:60: AssertionError
    =========================== short test summary info ===========================
    FAILED tests/test_protocol.py::test_golden_vectors_are_up_to_date - Assertion...
    {"version": "0.1.0", "protocol": "1.0", "frames": 370, "packets_received": 377, "pose_frames": 370, "calibration": "VALID", "punch_events": 4, "hands": [0, 1, 0, 1], "sequence_monotonic": true, "model": "pose_landmarker_full", "model_inference_ms": 12.2, "ok": true}
    2026-10-09 23:19:33,238 INFO iron_echo_tracker: calibration saved to C:\Users\user\AppData\Local\Temp\tmpu2y4pl6q\calibration.json
    2026-10-09 23:19:33,786 INFO iron_echo_tracker: punch LEFT strength=0.78
    2026-10-09 23:19:33,952 INFO iron_echo_tracker: punch RIGHT strength=0.65
    2026-10-09 23:19:34,127 INFO iron_echo_tracker: punch LEFT strength=0.64
    2026-10-09 23:19:34,311 INFO iron_echo_tracker: punch RIGHT strength=0.89
    2026-10-09 23:19:34,972 INFO iron_echo_tracker: tracker exit: source finished
    INFO: Created TensorFlow Lite XNNPACK delegate for CPU.
    WARNING: Logging before InitGoogle() is written to STDERR
    W0000 00:00:1791569977.038534   24072 inference_feedback_manager.cc:121] Feedback manager requires a model with a single signature inference. Disabling support for feedback tensors.
    W0000 00:00:1791569977.059478   10720 inference_feedback_manager.cc:121] Feedback manager requires a model with a single signature inference. Disabling support for feedback tensors.

==> Tool tests (robot contract checks)
    ......                                                                   [100%]
    6 passed in 0.21s
    FAIL failed: core-rules, pytest  logs: C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Saved\Logs\Tests\20261009-231916
    FAIL tests : see Saved/Logs/Tests

==> Unreal project
    OK   engine association : 5.8
    Using bundled DotNet SDK version: 10.0 win-x64
    Running UnrealBuildTool: dotnet "..\..\Engine\Binaries\DotNET\UnrealBuildTool\UnrealBuildTool.dll" IronEchoEditor Win64 Development -Project="@{FileVersion=3; EngineAssociation=5.8; Category=; Description=IRON ECHO: camera-controlled robot boxing. See README.md and PROJECT_STATE.md.; Modules=System.Object[]; Plugins=System.Object[]; TargetPlatforms=System.Object[]}" -WaitMutex -NoHotReloadFromIDE
    Unhandled exception: Exception: Unable to find project file based on argument @{FileVersion=3; EngineAssociation=5.8; Category=; Description=IRON ECHO: camera-controlled robot boxing. See README.md and PROJECT_STATE.md.; Modules=System.Object[]; Plugins=System.Object[]; TargetPlatforms=System.Object[]}
       at UnrealBuildTool.Utils.TryParseProjectFileArgument(CommandLineArguments Arguments, ILogger Logger, FileReference& ProjectFile, Boolean MarkArgumentAsUsed)
       at UnrealBuildTool.UnrealBuildTool.Main(String[] ArgumentsArray)
    
    Result: Failed (OtherCompilationError)
    Total execution time: 0.15 seconds
    Trace written to file C:\Users\user\AppData\Local\UnrealBuildTool\Trace.uba with size 246b
    FAIL build IronEchoEditor : exit 6, see C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Saved\Bootstrap\20261009-231843\build-editor.log

==> Report: C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Docs\Reports\2026-10-09_env_windows.md
    FAIL blocking: tests, build IronEchoEditor
```

### unreal-editor-build.log

```text
Using bundled DotNet SDK version: 10.0 win-x64
Running UnrealBuildTool: dotnet "..\..\Engine\Binaries\DotNET\UnrealBuildTool\UnrealBuildTool.dll" IronEchoEditor Win64 Development -Project=C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\IronEcho.uproject -WaitMutex -NoHotReloadFromIDE
Log file: C:\Users\user\AppData\Local\UnrealBuildTool\Log.txt
Determining max actions to execute in parallel (6 physical cores, 12 logical cores)
  Executing up to 6 processes, one per physical core
Using 'git status' to determine working set for adaptive non-unity build (C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check).
Creating makefile for IronEchoEditor (no existing makefile)
UbaServer - Listening on 0.0.0.0:1345
Unable to instantiate module 'SwarmInterface': Could not find NetFxSDK install dir; this will prevent SwarmInterface from installing.  Install a version of .NET Framework SDK at 4.6.0 or higher.
(referenced via IronEchoEditor -> Launch.Build.cs -> SessionServices.Build.cs -> Core.Build.cs -> Virtualization.Build.cs -> SourceControl.Build.cs -> RenderCore.Build.cs -> RHI.Build.cs -> D3D11RHI.Build.cs -> Engine.Build.cs -> AssetRegistry.Build.cs -> TargetPlatform.Build.cs -> TurnkeySupport.Build.cs -> LauncherServices.Build.cs -> TurnkeyIO.Build.cs -> ToolWidgets.Build.cs -> AppFramework.Build.cs -> SlateReflector.Build.cs -> PropertyEditor.Build.cs -> EditorConfig.Build.cs -> UnrealEd.Build.cs)

Result: Failed (RulesError)
Total execution time: 9.01 seconds
Trace written to file C:\Users\user\AppData\Local\UnrealBuildTool\Trace.uba with size 2.4kb
```

### game-development-build.log

```text
Using bundled DotNet SDK version: 10.0 win-x64
Running UnrealBuildTool: dotnet "..\..\Engine\Binaries\DotNET\UnrealBuildTool\UnrealBuildTool.dll" IronEcho Win64 Development -Project=C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\IronEcho.uproject -WaitMutex
Log file: C:\Users\user\AppData\Local\UnrealBuildTool\Log.txt
Determining max actions to execute in parallel (6 physical cores, 12 logical cores)
  Executing up to 6 processes, one per physical core
Using 'git status' to determine working set for adaptive non-unity build (C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check).
Creating makefile for IronEcho (no existing makefile)
UbaServer - Listening on 0.0.0.0:1345
UHT compiled-in object format Default
C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Source\IronEcho\Public\IronEchoGameState.h(31): Error: Function parameter: 'Role' cannot be defined in 'GetFighter' as it is already defined in scope 'AActor' (shadowing is not allowed)
C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Source\IronEchoContractVisuals\Public\IEContractCameraRig.h(26): Error: Function parameter: 'Role' cannot be defined in 'GetDefenderReactionPlayRate' as it is already defined in scope 'AActor' (shadowing is not allowed)
C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Source\IronEcho\Public\IronEchoGameMode.h(43): Error: Function parameter: 'Role' cannot be defined in 'GetFighter' as it is already defined in scope 'AActor' (shadowing is not allowed)
Unhandled 1 aggregate exceptions

Result: Failed (OtherCompilationError)
Total execution time: 5.27 seconds
Trace written to file C:\Users\user\AppData\Local\UnrealBuildTool\Trace.uba with size 2.4kb
```

### game-development-build-2.log

```text
Using bundled DotNet SDK version: 10.0 win-x64
Running UnrealBuildTool: dotnet "..\..\Engine\Binaries\DotNET\UnrealBuildTool\UnrealBuildTool.dll" IronEcho Win64 Development -Project=C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\IronEcho.uproject -WaitMutex
Log file: C:\Users\user\AppData\Local\UnrealBuildTool\Log.txt
Determining max actions to execute in parallel (6 physical cores, 12 logical cores)
  Executing up to 6 processes, one per physical core
Using 'git status' to determine working set for adaptive non-unity build (C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check).
UbaServer - Listening on 0.0.0.0:1345
Invalidating makefile for IronEcho (working set of source files changed)
UHT compiled-in object format Default
Building IronEcho...
===== Toolchain Information =====
Using ISPC compiler (C:\Program Files\Epic Games\UE_5.8\Engine\Source\ThirdParty\Intel\ISPC\bin\Windows\ispc.exe)
  Intel(r) Implicit SPMD Program Compiler (Intel(r) ISPC), 1.24.0 (build commit  @ 20250404, LLVM 18.1.2) 
Using Visual Studio 14.44.35229 toolchain (C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\14.44.35207) and Windows 10.0.22621.0 SDK (C:\Program Files (x86)\Windows Kits\10).
[Adaptive Build] Excluded from IronEchoContractVisuals unity file: IEContractCameraRig.cpp
[Adaptive Build] Excluded from IronEcho unity file: IronEchoGameMode.cpp, IronEchoGameState.cpp
=================================
Using Unreal Build Accelerator local executor to run 38 action(s)
  CPU 6 physical cores, 12 logical cores
  Memory 31.85 GB physical, 22.34 GB/33.85 GB committed
  UBA Storage capacity 40 GB
[1/38] Copy IronEcho-Default.rc2
[2/38] Copy tbb12.dll
[3/38] Copy D3D12Core.dll
[4/38] Copy d3d12SDKLayers.dll
[5/38] Copy tbbmalloc.dll
[6/38] Copy DirectML.dll
[7/38] Compile Resource [x64] IronEcho-Default.rc2
[8/38] Compile [x64] SharedPCH.Core.Project.ValApi.ValExpApi.Cpp20.cpp
[9/38] Compile [x64] Crc32.cpp
[10/38] Compile [x64] CombatConfig.cpp
[11/38] Compile [x64] Fighter.cpp
[12/38] Compile [x64] BotBrain.cpp
[13/38] Compile [x64] IronEchoRulesModule.cpp
[14/38] Compile [x64] CombatSim.cpp
[15/38] Compile [x64] InputFrame.cpp
[16/38] Compile [x64] PacketGate.cpp
[17/38] Compile [x64] Protocol.cpp
[18/38] Compile [x64] Match.cpp
[19/38] Compile [x64] SharedPCH.Engine.Project.ValApi.ValExpApi.Cpp20.cpp
[20/38] Compile [x64] IronEchoContractVisualsModule.cpp
[21/38] Compile [x64] Module.IronEchoContractVisuals.gen.cpp
[22/38] Compile [x64] IEContractCameraRig.cpp
[23/38] Compile [x64] IronEchoAutomationTests.cpp
[24/38] Compile [x64] IronEchoDebugHUD.cpp
[25/38] Compile [x64] IronEchoFighter.cpp
[26/38] Compile [x64] IronEchoGameState.cpp
[27/38] Compile [x64] IronEchoGameMode.cpp
[28/38] Compile [x64] IronEchoModule.cpp
[29/38] Compile [x64] IronEchoPlayerController.cpp
[30/38] Compile [x64] IronEchoPunchingBag.cpp
[31/38] Compile [x64] IronEchoRingAnchor.cpp
[32/38] Compile [x64] IronEchoRobotAnimInstance.cpp
[33/38] Compile [x64] IronEchoSettings.cpp
[34/38] Compile [x64] IronEchoTrackingSubsystem.cpp
[35/38] Compile [x64] Module.IronEcho.gen.cpp
[36/38] Compile [x64] Module.IronEchoVisuals.cpp
[37/38] Link [x64] IronEcho.exe
[38/38] WriteMetadata IronEcho.target [NoUba]

Total time in Unreal Build Accelerator local executor: 85.37 seconds
Output binary: C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Binaries\Win64\IronEcho.exe

Result: Succeeded
Total execution time: 88.27 seconds
Trace written to file C:\Users\user\AppData\Local\UnrealBuildTool\Trace.uba with size 19.7kb
```

### game-package-attempt.log

```text

==> Game package (Development)
    Running AutomationTool...
    Using bundled DotNet SDK version: 10.0 win-x64
    Starting AutomationTool...
    Parsing command line: BuildCookRun -project=C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\IronEcho.uproject -noP4 -platform=Win64 -clientconfig=Development -build -cook -stage -pak -iostore -package -archive -archivedirectory=C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Build\Package -prereqs -utf8output -nodebuginfo
    Initializing script modules...
    Total script module initialization time: 0.30 s.
    Using C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Current\Bin\MSBuild.exe
    Executing commands...
    Setting up ProjectParams for C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\IronEcho.uproject
    ********** BUILD COMMAND STARTED **********
    Running: C:\Program Files\Epic Games\UE_5.8\Engine\Binaries\ThirdParty\DotNet\10.0\win-x64\dotnet.exe "C:\Program Files\Epic Games\UE_5.8\Engine\Binaries\DotNET\UnrealBuildTool\UnrealBuildTool.dll" -Target="IronEchoEditor Win64 Development -Project=C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\IronEcho.uproject" -Target="IronEcho Win64 Development -Project=C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\IronEcho.uproject  -remoteini=\"C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\"  -skipdeploy " -log="C:\Users\user\AppData\Roaming\Unreal Engine\AutomationTool\Logs\C+Program+Files+Epic+Games+UE_5.8\UBA-IronEchoEditor-Win64-Development.txt"
    Log file: C:\Users\user\AppData\Roaming\Unreal Engine\AutomationTool\Logs\C+Program+Files+Epic+Games+UE_5.8\UBA-IronEchoEditor-Win64-Development.txt
    Determining max actions to execute in parallel (6 physical cores, 12 logical cores)
      Executing up to 6 processes, one per physical core
    Using 'git status' to determine working set for adaptive non-unity build (C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check).
    Creating makefile for IronEchoEditor (no existing makefile)
    UbaServer - Listening on 0.0.0.0:1345
    Creating makefile for IronEcho (command line arguments changed)
    Unable to instantiate module 'SwarmInterface': Could not find NetFxSDK install dir; this will prevent SwarmInterface from installing.  Install a version of .NET Framework SDK at 4.6.0 or higher.
    (referenced via IronEchoEditor -> Launch.Build.cs -> SessionServices.Build.cs -> Core.Build.cs -> Virtualization.Build.cs -> SourceControl.Build.cs -> RenderCore.Build.cs -> RHI.Build.cs -> D3D11RHI.Build.cs -> Engine.Build.cs -> AssetRegistry.Build.cs -> TargetPlatform.Build.cs -> TurnkeySupport.Build.cs -> LauncherServices.Build.cs -> TurnkeyIO.Build.cs -> ToolWidgets.Build.cs -> AppFramework.Build.cs -> SlateReflector.Build.cs -> PropertyEditor.Build.cs -> EditorConfig.Build.cs -> UnrealEd.Build.cs)
    
    Result: Failed (RulesError)
    Total execution time: 1.65 seconds
    Trace written to file C:\Users\user\AppData\Local\UnrealBuildTool\Trace.uba with size 2.4kb
    Took 1.87s to run dotnet.exe, ExitCode=8
    UnrealBuildTool failed. See log for more details. (C:\Users\user\AppData\Roaming\Unreal Engine\AutomationTool\Logs\C+Program+Files+Epic+Games+UE_5.8\UBA-IronEchoEditor-Win64-Development.txt)
    AutomationTool executed for 0h 0m 3s
    AutomationTool exiting with ExitCode=8 (8)
    BUILD FAILED
    FAIL UAT failed, see C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Saved\Logs\Package\20261009-232738\uat.log
```

### editor-with-sdk.log

```text
Using bundled DotNet SDK version: 10.0 win-x64
Running UnrealBuildTool: dotnet "..\..\Engine\Binaries\DotNET\UnrealBuildTool\UnrealBuildTool.dll" IronEchoEditor Win64 Development -Project=C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\IronEcho.uproject -WaitMutex -NoHotReloadFromIDE
Log file: C:\Users\user\AppData\Local\UnrealBuildTool\Log.txt
Determining max actions to execute in parallel (6 physical cores, 12 logical cores)
  Executing up to 6 processes, one per physical core
Using 'git status' to determine working set for adaptive non-unity build (C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check).
Creating makefile for IronEchoEditor (no existing makefile)
UbaServer - Listening on 0.0.0.0:1345
UHT compiled-in object format Default
Building IronEchoEditor...
===== Toolchain Information =====
Using ISPC compiler (C:\Program Files\Epic Games\UE_5.8\Engine\Source\ThirdParty\Intel\ISPC\bin\Windows\ispc.exe)
  Intel(r) Implicit SPMD Program Compiler (Intel(r) ISPC), 1.24.0 (build commit  @ 20250404, LLVM 18.1.2) 
Using Visual Studio 14.44.35229 toolchain (C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\14.44.35207) and Windows 10.0.22621.0 SDK (C:\Program Files (x86)\Windows Kits\10).
[Adaptive Build] Excluded from IronEchoContractVisuals unity file: IEContractCameraRig.cpp, IEGameplayHudWidget.cpp, IEPresentationCapture.cpp, IERealisticRobotAnimInstance.cpp, IEVisualImportLibrary.cpp, IEGameplayHudTests.cpp, IERealisticRobotTests.cpp
[Adaptive Build] Excluded from IronEcho unity file: IronEchoGameMode.cpp, IronEchoGameState.cpp
=================================
Using Unreal Build Accelerator local executor to run 51 action(s)
  CPU 6 physical cores, 12 logical cores
  Memory 31.85 GB physical, 23.26 GB/33.85 GB committed
  UBA Storage capacity 40 GB
[1/51] Compile Resource [x64] Default.rc2
[2/51] Compile Resource [x64] Default.rc2
[3/51] Compile Resource [x64] Default.rc2
[4/51] Compile Resource [x64] Default.rc2
[5/51] Compile [x64] SharedPCH.Core.Project.ValApi.ValExpApi.Cpp20.cpp
[6/51] Compile [x64] Crc32.cpp
[7/51] Compile [x64] CombatConfig.cpp
[8/51] Compile [x64] Fighter.cpp
[9/51] Compile [x64] CombatSim.cpp
[10/51] Compile [x64] IronEchoRulesModule.cpp
[11/51] Compile [x64] BotBrain.cpp
[12/51] Compile [x64] InputFrame.cpp
[13/51] Compile [x64] PerModuleInline.gen.cpp
[14/51] Compile [x64] PacketGate.cpp
[15/51] Compile [x64] Protocol.cpp
[16/51] Compile [x64] Match.cpp
[17/51] Link [x64] UnrealEditor-IronEchoRules.lib
[18/51] Link [x64] UnrealEditor-IronEchoRules.dll
[19/51] Compile [x64] SharedPCH.UnrealEd.Project.ValApi.ValExpApi.Cpp20.cpp
[20/51] Compile [x64] IronEchoAutomationTests.cpp
[21/51] Compile [x64] IronEchoDebugHUD.cpp
[22/51] Compile [x64] IronEchoFighter.cpp
[23/51] Compile [x64] IronEchoGameMode.cpp
[24/51] Compile [x64] IronEchoGameState.cpp
[25/51] Compile [x64] IronEchoModule.cpp
[26/51] Compile [x64] IronEchoPlayerController.cpp
[27/51] Compile [x64] IronEchoPunchingBag.cpp
[28/51] Compile [x64] IronEchoRingAnchor.cpp
[29/51] Compile [x64] IronEchoRobotAnimInstance.cpp
[30/51] Compile [x64] IronEchoSettings.cpp
[31/51] Compile [x64] IronEchoTrackingSubsystem.cpp
[32/51] Compile [x64] Module.IronEcho.gen.cpp
[33/51] Compile [x64] PerModuleInline.gen.cpp
[34/51] Link [x64] UnrealEditor-IronEcho.lib
[35/51] Link [x64] UnrealEditor-IronEcho.dll
IronEchoTrackingSubsystem.cpp.obj : error LNK2019: unresolved external symbol "unsigned __int64 __cdecl IronEchoCore::Protocol::EncodeControl(struct IronEchoCore::Protocol::Header,struct IronEchoCore::Protocol::ControlPayload const &,unsigned char *,unsigned __int64)" (?EncodeControl@Protocol@IronEchoCore@@YA_KUHeader@12@AEBUControlPayload@12@PEAE_K@Z) referenced in function "private: void __cdecl UIronEchoTrackingSubsystem::SendCommand(struct UIronEchoTrackingSubsystem::FPendingCommand &,double)" (?SendCommand@UIronEchoTrackingSubsystem@@AEAAXAEAUFPendingCommand@1@N@Z)
IronEchoTrackingSubsystem.cpp.obj : error LNK2019: unresolved external symbol "public: enum IronEchoCore::GateVerdict __cdecl IronEchoCore::PacketGate::Submit(unsigned char const *,unsigned __int64,double)" (?Submit@PacketGate@IronEchoCore@@QEAA?AW4GateVerdict@2@PEBE_KN@Z) referenced in function "public: void __cdecl UIronEchoTrackingSubsystem::Poll(void)" (?Poll@UIronEchoTrackingSubsystem@@QEAAXXZ)
IronEchoTrackingSubsystem.cpp.obj : error LNK2019: unresolved external symbol "public: struct IronEchoCore::InputFrame __cdecl IronEchoCore::PacketGate::BuildFrame(double)" (?BuildFrame@PacketGate@IronEchoCore@@QEAA?AUInputFrame@2@N@Z) referenced in function "public: struct IronEchoCore::InputFrame __cdecl UIronEchoTrackingSubsystem::BuildInputFrame(void)" (?BuildInputFrame@UIronEchoTrackingSubsystem@@QEAA?AUInputFrame@IronEchoCore@@XZ)
IronEchoTrackingSubsystem.cpp.obj : error LNK2019: unresolved external symbol "public: bool __cdecl IronEchoCore::PacketGate::FindAck(unsigned int,struct IronEchoCore::Protocol::ControlAckPayload &)const " (?FindAck@PacketGate@IronEchoCore@@QEBA_NIAEAUControlAckPayload@Protocol@2@@Z) referenced in function "public: void __cdecl UIronEchoTrackingSubsystem::Poll(void)" (?Poll@UIronEchoTrackingSubsystem@@QEAAXXZ)
IronEchoAutomationTests.cpp.obj : error LNK2019: unresolved external symbol "struct IronEchoCore::FighterConfig __cdecl IronEchoCore::MakeDefaultFighterConfig(void)" (?MakeDefaultFighterConfig@IronEchoCore@@YA?AUFighterConfig@1@XZ) referenced in function "public: __cdecl IronEchoCore::MatchSetup::MatchSetup(void)" (??0MatchSetup@IronEchoCore@@QEAA@XZ)
IronEchoGameMode.cpp.obj : error LNK2001: unresolved external symbol "struct IronEchoCore::FighterConfig __cdecl IronEchoCore::MakeDefaultFighterConfig(void)" (?MakeDefaultFighterConfig@IronEchoCore@@YA?AUFighterConfig@1@XZ)
IronEchoAutomationTests.cpp.obj : error LNK2019: unresolved external symbol "struct IronEchoCore::FighterConfig __cdecl IronEchoCore::MakeBotFighterConfig(enum IronEchoCore::BotLevel)" (?MakeBotFighterConfig@IronEchoCore@@YA?AUFighterConfig@1@W4BotLevel@1@@Z) referenced in function "public: __cdecl IronEchoCore::MatchSetup::MatchSetup(void)" (??0MatchSetup@IronEchoCore@@QEAA@XZ)
IronEchoGameMode.cpp.obj : error LNK2001: unresolved external symbol "struct IronEchoCore::FighterConfig __cdecl IronEchoCore::MakeBotFighterConfig(enum IronEchoCore::BotLevel)" (?MakeBotFighterConfig@IronEchoCore@@YA?AUFighterConfig@1@W4BotLevel@1@@Z)
IronEchoAutomationTests.cpp.obj : error LNK2019: unresolved external symbol "struct IronEchoCore::FighterConfig __cdecl IronEchoCore::MakeTrainingBagConfig(void)" (?MakeTrainingBagConfig@IronEchoCore@@YA?AUFighterConfig@1@XZ) referenced in function "public: __cdecl IronEchoCore::MatchSetup::MatchSetup(void)" (??0MatchSetup@IronEchoCore@@QEAA@XZ)
IronEchoGameMode.cpp.obj : error LNK2001: unresolved external symbol "struct IronEchoCore::FighterConfig __cdecl IronEchoCore::MakeTrainingBagConfig(void)" (?MakeTrainingBagConfig@IronEchoCore@@YA?AUFighterConfig@1@XZ)
IronEchoAutomationTests.cpp.obj : error LNK2019: unresolved external symbol "struct IronEchoCore::BotConfig __cdecl IronEchoCore::MakeBotConfig(enum IronEchoCore::BotLevel)" (?MakeBotConfig@IronEchoCore@@YA?AUBotConfig@1@W4BotLevel@1@@Z) referenced in function "public: __cdecl IronEchoCore::MatchSetup::MatchSetup(void)" (??0MatchSetup@IronEchoCore@@QEAA@XZ)
IronEchoGameMode.cpp.obj : error LNK2001: unresolved external symbol "struct IronEchoCore::BotConfig __cdecl IronEchoCore::MakeBotConfig(enum IronEchoCore::BotLevel)" (?MakeBotConfig@IronEchoCore@@YA?AUBotConfig@1@W4BotLevel@1@@Z)
IronEchoAutomationTests.cpp.obj : error LNK2019: unresolved external symbol "public: __cdecl IronEchoCore::Match::Match(struct IronEchoCore::MatchSetup const &)" (??0Match@IronEchoCore@@QEAA@AEBUMatchSetup@1@@Z) referenced in function "protected: virtual bool __cdecl FIronEchoBoutSmokeTest::RunTest(class FString const &)" (?RunTest@FIronEchoBoutSmokeTest@@MEAA_NAEBVFString@@@Z)
IronEchoGameMode.cpp.obj : error LNK2001: unresolved external symbol "public: __cdecl IronEchoCore::Match::Match(struct IronEchoCore::MatchSetup const &)" (??0Match@IronEchoCore@@QEAA@AEBUMatchSetup@1@@Z)
IronEchoAutomationTests.cpp.obj : error LNK2019: unresolved external symbol "public: void __cdecl IronEchoCore::Match::Tick(struct IronEchoCore::MatchInput const &,class IronEchoCore::EventBuffer<struct IronEchoCore::CombatEvent,256> &,class IronEchoCore::EventBuffer<struct IronEchoCore::MatchEvent,64> &)" (?Tick@Match@IronEchoCore@@QEAAXAEBUMatchInput@2@AEAV?$EventBuffer@UCombatEvent@IronEchoCore@@$0BAA@@2@AEAV?$EventBuffer@UMatchEvent@IronEchoCore@@$0EA@@2@@Z) referenced in function "protected: virtual bool __cdecl FIronEchoBoutSmokeTest::RunTest(class FString const &)" (?RunTest@FIronEchoBoutSmokeTest@@MEAA_NAEBVFString@@@Z)
IronEchoGameMode.cpp.obj : error LNK2001: unresolved external symbol "public: void __cdecl IronEchoCore::Match::Tick(struct IronEchoCore::MatchInput const &,class IronEchoCore::EventBuffer<struct IronEchoCore::CombatEvent,256> &,class IronEchoCore::EventBuffer<struct IronEchoCore::MatchEvent,64> &)" (?Tick@Match@IronEchoCore@@QEAAXAEBUMatchInput@2@AEAV?$EventBuffer@UCombatEvent@IronEchoCore@@$0BAA@@2@AEAV?$EventBuffer@UMatchEvent@IronEchoCore@@$0EA@@2@@Z)
IronEchoAutomationTests.cpp.obj : error LNK2019: unresolved external symbol "char const * __cdecl IronEchoCore::Protocol::DecodeErrorName(enum IronEchoCore::Protocol::DecodeError)" (?DecodeErrorName@Protocol@IronEchoCore@@YAPEBDW4DecodeError@12@@Z) referenced in function "protected: virtual bool __cdecl FIronEchoGoldenVectorsTest::RunTest(class FString const &)" (?RunTest@FIronEchoGoldenVectorsTest@@MEAA_NAEBVFString@@@Z)
IronEchoAutomationTests.cpp.obj : error LNK2019: unresolved external symbol "enum IronEchoCore::Protocol::DecodeError __cdecl IronEchoCore::Protocol::Decode(unsigned char const *,unsigned __int64,struct IronEchoCore::Protocol::DecodedPacket &)" (?Decode@Protocol@IronEchoCore@@YA?AW4DecodeError@12@PEBE_KAEAUDecodedPacket@12@@Z) referenced in function "protected: virtual bool __cdecl FIronEchoGoldenVectorsTest::RunTest(class FString const &)" (?RunTest@FIronEchoGoldenVectorsTest@@MEAA_NAEBVFString@@@Z)
IronEchoGameMode.cpp.obj : error LNK2019: unresolved external symbol "public: struct IronEchoCore::FighterIntent __cdecl IronEchoCore::IntentMapper::Map(struct IronEchoCore::InputFrame const &)" (?Map@IntentMapper@IronEchoCore@@QEAA?AUFighterIntent@2@AEBUInputFrame@2@@Z) referenced in function "private: void __cdecl AIronEchoGameMode::StepSimulation(float,struct IronEchoCore::InputFrame const &)" (?StepSimulation@AIronEchoGameMode@@AEAAXMAEBUInputFrame@IronEchoCore@@@Z)
IronEchoGameMode.cpp.obj : error LNK2019: unresolved external symbol "public: void __cdecl IronEchoCore::IntentMapper::Reset(void)" (?Reset@IntentMapper@IronEchoCore@@QEAAXXZ) referenced in function "private: void __cdecl AIronEchoGameMode::RebuildMatch(enum IronEchoCore::MatchMode,enum EIronEchoBotLevel)" (?RebuildMatch@AIronEchoGameMode@@AEAAXW4MatchMode@IronEchoCore@@W4EIronEchoBotLevel@@@Z)
IronEchoGameMode.cpp.obj : error LNK2019: unresolved external symbol "char const * __cdecl IronEchoCore::BotLevelName(enum IronEchoCore::BotLevel)" (?BotLevelName@IronEchoCore@@YAPEBDW4BotLevel@1@@Z) referenced in function "private: void __cdecl AIronEchoGameMode::RebuildMatch(enum IronEchoCore::MatchMode,enum EIronEchoBotLevel)" (?RebuildMatch@AIronEchoGameMode@@AEAAXW4MatchMode@IronEchoCore@@W4EIronEchoBotLevel@@@Z)
IronEchoGameMode.cpp.obj : error LNK2019: unresolved external symbol "char const * __cdecl IronEchoCore::MatchPhaseName(enum IronEchoCore::MatchPhase)" (?MatchPhaseName@IronEchoCore@@YAPEBDW4MatchPhase@1@@Z) referenced in function "private: void __cdecl AIronEchoGameMode::DispatchEvents(void)" (?DispatchEvents@AIronEchoGameMode@@AEAAXXZ)
IronEchoGameMode.cpp.obj : error LNK2019: unresolved external symbol "public: float __cdecl IronEchoCore::CombatSim::Gap(void)const " (?Gap@CombatSim@IronEchoCore@@QEBAMXZ) referenced in function "private: struct FIronEchoFighterVisualState __cdecl AIronEchoGameMode::MakeVisualState(enum IronEchoCore::FighterSlot,struct IronEchoCore::InputFrame const &)const " (?MakeVisualState@AIronEchoGameMode@@AEBA?AUFIronEchoFighterVisualState@@W4FighterSlot@IronEchoCore@@AEBUInputFrame@4@@Z)
C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Binaries\Win64\UnrealEditor-IronEcho.dll : fatal error LNK1120: 17 unresolved externals
[36/51] Compile [x64] Module.IronEchoVisuals.cpp
[37/51] Link [x64] UnrealEditor-IronEchoVisuals.lib
[38/51] Link [x64] UnrealEditor-IronEchoVisuals.dll
[39/51] Compile [x64] IEContractCameraRig.cpp
[40/51] Compile [x64] IEGameplayHudTests.cpp
[41/51] Compile [x64] IEGameplayHudWidget.cpp
[42/51] Compile [x64] IEPresentationCapture.cpp
[43/51] Compile [x64] IERealisticRobotAnimInstance.cpp
[44/51] Compile [x64] IERealisticRobotTests.cpp
[45/51] Compile [x64] IEVisualImportLibrary.cpp
[46/51] Compile [x64] IronEchoContractVisualsModule.cpp
[47/51] Compile [x64] Module.IronEchoContractVisuals.gen.cpp
[48/51] Compile [x64] PerModuleInline.gen.cpp
[49/51] Link [x64] UnrealEditor-IronEchoContractVisuals.lib
[50/51] Link [x64] UnrealEditor-IronEchoContractVisuals.dll
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2019: unresolved external symbol "__declspec(dllimport) private: static struct UE::FieldNotification::IClassDescriptor const & __cdecl UWidget::FFieldNotificationClassDescriptor::GetDescriptor(void)" (__imp_?GetDescriptor@FFieldNotificationClassDescriptor@UWidget@@CAAEBUIClassDescriptor@FieldNotification@UE@@XZ) referenced in function "public: virtual struct UE::FieldNotification::IClassDescriptor const & __cdecl UWidget::GetFieldNotificationDescriptor(void)const " (?GetFieldNotificationDescriptor@UWidget@@UEBAAEBUIClassDescriptor@FieldNotification@UE@@XZ)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2019: unresolved external symbol "__declspec(dllimport) class UClass * __cdecl Z_Construct_UClass_UUserWidget(enum ETypeConstructPhase)" (__imp_?Z_Construct_UClass_UUserWidget@@YAPEAVUClass@@W4ETypeConstructPhase@@@Z) referenced in function "void __cdecl `dynamic initializer for 'public: static class UObject * (__cdecl** Z_Construct_UClass_UIEGameplayHudWidget_Statics::DependentSingletons)(enum ETypeConstructPhase)''(void)" (??__E?DependentSingletons@Z_Construct_UClass_UIEGameplayHudWidget_Statics@@2PAP6APEAVUObject@@W4ETypeConstructPhase@@@ZA@@YAXXZ)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2019: unresolved external symbol "__declspec(dllimport) public: __cdecl UUserWidget::UUserWidget(class FVTableHelper &)" (__imp_??0UUserWidget@@QEAA@AEAVFVTableHelper@@@Z) referenced in function "public: __cdecl UIEGameplayHudWidget::UIEGameplayHudWidget(class FVTableHelper &)" (??0UIEGameplayHudWidget@@QEAA@AEAVFVTableHelper@@@Z)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2019: unresolved external symbol "__declspec(dllimport) public: virtual __cdecl UUserWidget::~UUserWidget(void)" (__imp_??1UUserWidget@@UEAA@XZ) referenced in function "public: virtual __cdecl UIEGameplayHudWidget::~UIEGameplayHudWidget(void)" (??1UIEGameplayHudWidget@@UEAA@XZ)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2019: unresolved external symbol "__declspec(dllimport) public: __cdecl UUserWidget::UUserWidget(class FObjectInitializer const &)" (__imp_??0UUserWidget@@QEAA@AEBVFObjectInitializer@@@Z) referenced in function "void __cdecl InternalConstructor<class UIEGameplayHudWidget>(class FObjectInitializer const &)" (??$InternalConstructor@VUIEGameplayHudWidget@@@@YAXAEBVFObjectInitializer@@@Z)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2019: unresolved external symbol "__declspec(dllimport) protected: static void __cdecl UUserWidget::AddReferencedObjects(class UObject *,class FReferenceCollector &)" (__imp_?AddReferencedObjects@UUserWidget@@KAXPEAVUObject@@AEAVFReferenceCollector@@@Z) referenced in function "class UClass * __cdecl Z_Construct_UClass_UIEGameplayHudWidget(enum ETypeConstructPhase)" (?Z_Construct_UClass_UIEGameplayHudWidget@@YAPEAVUClass@@W4ETypeConstructPhase@@@Z)
  Hint on symbols that are defined and could potentially match:
    "__declspec(dllimport) public: static void __cdecl AActor::AddReferencedObjects(class UObject *,class FReferenceCollector &)" (__imp_?AddReferencedObjects@AActor@@SAXPEAVUObject@@AEAVFReferenceCollector@@@Z)
    "__declspec(dllimport) protected: virtual void __cdecl FAnimInstanceProxy::AddReferencedObjects(class UAnimInstance *,class FReferenceCollector &)" (__imp_?AddReferencedObjects@FAnimInstanceProxy@@MEAAXPEAVUAnimInstance@@AEAVFReferenceCollector@@@Z)
    "__declspec(dllimport) public: static void __cdecl UAnimInstance::AddReferencedObjects(class UObject *,class FReferenceCollector &)" (__imp_?AddReferencedObjects@UAnimInstance@@SAXPEAVUObject@@AEAVFReferenceCollector@@@Z)
    "__declspec(dllimport) public: static void __cdecl UObject::AddReferencedObjects(class UObject *,class FReferenceCollector &)" (__imp_?AddReferencedObjects@UObject@@SAXPEAV1@AEAVFReferenceCollector@@@Z)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "public: virtual void __cdecl UUserWidget::SetContentForSlot(class FName,class UWidget *)" (?SetContentForSlot@UUserWidget@@UEAAXVFName@@PEAVUWidget@@@Z)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "public: virtual class UWidget * __cdecl UUserWidget::GetContentForSlot(class FName)const " (?GetContentForSlot@UUserWidget@@UEBAPEAVUWidget@@VFName@@@Z)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "public: virtual void __cdecl UUserWidget::GetSlotNames(class TArray<class FName,class TSizedDefaultAllocator<32> > &)const " (?GetSlotNames@UUserWidget@@UEBAXAEAV?$TArray@VFName@@V?$TSizedDefaultAllocator@$0CA@@@@@@Z)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "public: virtual void __cdecl UWidget::BroadcastFieldValueChanged(struct UE::FieldNotification::FFieldId)" (?BroadcastFieldValueChanged@UWidget@@UEAAXUFFieldId@FieldNotification@UE@@@Z)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "public: virtual int __cdecl UWidget::RemoveAllFieldValueChangedDelegates(void const *)" (?RemoveAllFieldValueChangedDelegates@UWidget@@UEAAHPEBX@Z)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "public: virtual int __cdecl UWidget::RemoveAllFieldValueChangedDelegates(struct UE::FieldNotification::FFieldId,void const *)" (?RemoveAllFieldValueChangedDelegates@UWidget@@UEAAHUFFieldId@FieldNotification@UE@@PEBX@Z)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "public: virtual bool __cdecl UWidget::RemoveFieldValueChangedDelegate(struct UE::FieldNotification::FFieldId,class FDelegateHandle)" (?RemoveFieldValueChangedDelegate@UWidget@@UEAA_NUFFieldId@FieldNotification@UE@@VFDelegateHandle@@@Z)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "public: virtual class FDelegateHandle __cdecl UWidget::AddFieldValueChangedDelegate(struct UE::FieldNotification::FFieldId,class TDelegate<void __cdecl(class UObject *,struct UE::FieldNotification::FFieldId),struct FNotThreadSafeNotCheckedDelegateUserPolicy>)" (?AddFieldValueChangedDelegate@UWidget@@UEAA?AVFDelegateHandle@@UFFieldId@FieldNotification@UE@@V?$TDelegate@$$A6AXPEAVUObject@@UFFieldId@FieldNotification@UE@@@ZUFNotThreadSafeNotCheckedDelegateUserPolicy@@@@@Z)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "protected: virtual void __cdecl UUserWidget::DestroyInputComponent(void)" (?DestroyInputComponent@UUserWidget@@MEAAXXZ)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "protected: virtual void __cdecl UUserWidget::StopProcessingInputScriptDelegates(void)" (?StopProcessingInputScriptDelegates@UUserWidget@@MEAAXXZ)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "protected: virtual void __cdecl UUserWidget::StartProcessingInputScriptDelegates(void)" (?StartProcessingInputScriptDelegates@UUserWidget@@MEAAXXZ)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "protected: virtual void __cdecl UUserWidget::CreateInputComponent(void)" (?CreateInputComponent@UUserWidget@@MEAAXXZ)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "protected: virtual void __cdecl UUserWidget::InitializeInputComponent(void)" (?InitializeInputComponent@UUserWidget@@MEAAXXZ)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "protected: virtual void __cdecl UUserWidget::NativeOnMouseCaptureLost(struct FCaptureLostEvent const &)" (?NativeOnMouseCaptureLost@UUserWidget@@MEAAXAEBUFCaptureLostEvent@@@Z)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "protected: virtual class FCursorReply __cdecl UUserWidget::NativeOnCursorQuery(struct FGeometry const &,struct FPointerEvent const &)" (?NativeOnCursorQuery@UUserWidget@@MEAA?AVFCursorReply@@AEBUFGeometry@@AEBUFPointerEvent@@@Z)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "protected: virtual class FReply __cdecl UUserWidget::NativeOnTouchFirstMove(struct FGeometry const &,struct FPointerEvent const &)" (?NativeOnTouchFirstMove@UUserWidget@@MEAA?AVFReply@@AEBUFGeometry@@AEBUFPointerEvent@@@Z)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "protected: virtual class FReply __cdecl UUserWidget::NativeOnTouchForceChanged(struct FGeometry const &,struct FPointerEvent const &)" (?NativeOnTouchForceChanged@UUserWidget@@MEAA?AVFReply@@AEBUFGeometry@@AEBUFPointerEvent@@@Z)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "protected: virtual class FReply __cdecl UUserWidget::NativeOnMotionDetected(struct FGeometry const &,struct FMotionEvent const &)" (?NativeOnMotionDetected@UUserWidget@@MEAA?AVFReply@@AEBUFGeometry@@AEBUFMotionEvent@@@Z)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "protected: virtual class FReply __cdecl UUserWidget::NativeOnTouchEnded(struct FGeometry const &,struct FPointerEvent const &)" (?NativeOnTouchEnded@UUserWidget@@MEAA?AVFReply@@AEBUFGeometry@@AEBUFPointerEvent@@@Z)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "protected: virtual class FReply __cdecl UUserWidget::NativeOnTouchMoved(struct FGeometry const &,struct FPointerEvent const &)" (?NativeOnTouchMoved@UUserWidget@@MEAA?AVFReply@@AEBUFGeometry@@AEBUFPointerEvent@@@Z)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "protected: virtual class FReply __cdecl UUserWidget::NativeOnTouchStarted(struct FGeometry const &,struct FPointerEvent const &)" (?NativeOnTouchStarted@UUserWidget@@MEAA?AVFReply@@AEBUFGeometry@@AEBUFPointerEvent@@@Z)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "protected: virtual class FReply __cdecl UUserWidget::NativeOnTouchGesture(struct FGeometry const &,struct FPointerEvent const &)" (?NativeOnTouchGesture@UUserWidget@@MEAA?AVFReply@@AEBUFGeometry@@AEBUFPointerEvent@@@Z)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "protected: virtual void __cdecl UUserWidget::NativeOnDragCancelled(class FDragDropEvent const &,class UDragDropOperation *)" (?NativeOnDragCancelled@UUserWidget@@MEAAXAEBVFDragDropEvent@@PEAVUDragDropOperation@@@Z)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "protected: virtual bool __cdecl UUserWidget::NativeOnDrop(struct FGeometry const &,class FDragDropEvent const &,class UDragDropOperation *)" (?NativeOnDrop@UUserWidget@@MEAA_NAEBUFGeometry@@AEBVFDragDropEvent@@PEAVUDragDropOperation@@@Z)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "protected: virtual bool __cdecl UUserWidget::NativeOnDragOver(struct FGeometry const &,class FDragDropEvent const &,class UDragDropOperation *)" (?NativeOnDragOver@UUserWidget@@MEAA_NAEBUFGeometry@@AEBVFDragDropEvent@@PEAVUDragDropOperation@@@Z)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "protected: virtual void __cdecl UUserWidget::NativeOnDragLeave(class FDragDropEvent const &,class UDragDropOperation *)" (?NativeOnDragLeave@UUserWidget@@MEAAXAEBVFDragDropEvent@@PEAVUDragDropOperation@@@Z)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "protected: virtual void __cdecl UUserWidget::NativeOnDragEnter(struct FGeometry const &,class FDragDropEvent const &,class UDragDropOperation *)" (?NativeOnDragEnter@UUserWidget@@MEAAXAEBUFGeometry@@AEBVFDragDropEvent@@PEAVUDragDropOperation@@@Z)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "protected: virtual void __cdecl UUserWidget::NativeOnDragDetected(struct FGeometry const &,struct FPointerEvent const &,class UDragDropOperation * &)" (?NativeOnDragDetected@UUserWidget@@MEAAXAEBUFGeometry@@AEBUFPointerEvent@@AEAPEAVUDragDropOperation@@@Z)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "protected: virtual class FReply __cdecl UUserWidget::NativeOnMouseButtonDoubleClick(struct FGeometry const &,struct FPointerEvent const &)" (?NativeOnMouseButtonDoubleClick@UUserWidget@@MEAA?AVFReply@@AEBUFGeometry@@AEBUFPointerEvent@@@Z)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "protected: virtual class FReply __cdecl UUserWidget::NativeOnMouseWheel(struct FGeometry const &,struct FPointerEvent const &)" (?NativeOnMouseWheel@UUserWidget@@MEAA?AVFReply@@AEBUFGeometry@@AEBUFPointerEvent@@@Z)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "protected: virtual void __cdecl UUserWidget::NativeOnMouseLeave(struct FPointerEvent const &)" (?NativeOnMouseLeave@UUserWidget@@MEAAXAEBUFPointerEvent@@@Z)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "protected: virtual void __cdecl UUserWidget::NativeOnMouseEnter(struct FGeometry const &,struct FPointerEvent const &)" (?NativeOnMouseEnter@UUserWidget@@MEAAXAEBUFGeometry@@AEBUFPointerEvent@@@Z)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "protected: virtual class FReply __cdecl UUserWidget::NativeOnMouseMove(struct FGeometry const &,struct FPointerEvent const &)" (?NativeOnMouseMove@UUserWidget@@MEAA?AVFReply@@AEBUFGeometry@@AEBUFPointerEvent@@@Z)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "protected: virtual class FReply __cdecl UUserWidget::NativeOnMouseButtonUp(struct FGeometry const &,struct FPointerEvent const &)" (?NativeOnMouseButtonUp@UUserWidget@@MEAA?AVFReply@@AEBUFGeometry@@AEBUFPointerEvent@@@Z)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "protected: virtual class FReply __cdecl UUserWidget::NativeOnPreviewMouseButtonDown(struct FGeometry const &,struct FPointerEvent const &)" (?NativeOnPreviewMouseButtonDown@UUserWidget@@MEAA?AVFReply@@AEBUFGeometry@@AEBUFPointerEvent@@@Z)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "protected: virtual class FReply __cdecl UUserWidget::NativeOnMouseButtonDown(struct FGeometry const &,struct FPointerEvent const &)" (?NativeOnMouseButtonDown@UUserWidget@@MEAA?AVFReply@@AEBUFGeometry@@AEBUFPointerEvent@@@Z)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "protected: virtual class FReply __cdecl UUserWidget::NativeOnAnalogValueChanged(struct FGeometry const &,struct FAnalogInputEvent const &)" (?NativeOnAnalogValueChanged@UUserWidget@@MEAA?AVFReply@@AEBUFGeometry@@AEBUFAnalogInputEvent@@@Z)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "protected: virtual class FReply __cdecl UUserWidget::NativeOnKeyUp(struct FGeometry const &,struct FKeyEvent const &)" (?NativeOnKeyUp@UUserWidget@@MEAA?AVFReply@@AEBUFGeometry@@AEBUFKeyEvent@@@Z)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "protected: virtual class FReply __cdecl UUserWidget::NativeOnKeyDown(struct FGeometry const &,struct FKeyEvent const &)" (?NativeOnKeyDown@UUserWidget@@MEAA?AVFReply@@AEBUFGeometry@@AEBUFKeyEvent@@@Z)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "protected: virtual class FReply __cdecl UUserWidget::NativeOnPreviewKeyDown(struct FGeometry const &,struct FKeyEvent const &)" (?NativeOnPreviewKeyDown@UUserWidget@@MEAA?AVFReply@@AEBUFGeometry@@AEBUFKeyEvent@@@Z)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "protected: virtual class FReply __cdecl UUserWidget::NativeOnKeyChar(struct FGeometry const &,struct FCharacterEvent const &)" (?NativeOnKeyChar@UUserWidget@@MEAA?AVFReply@@AEBUFGeometry@@AEBUFCharacterEvent@@@Z)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "protected: virtual class FNavigationReply __cdecl UUserWidget::NativeOnNavigation(struct FGeometry const &,struct FNavigationEvent const &,class FNavigationReply const &)" (?NativeOnNavigation@UUserWidget@@MEAA?AVFNavigationReply@@AEBUFGeometry@@AEBUFNavigationEvent@@AEBV2@@Z)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "protected: virtual class FNavigationReply __cdecl UUserWidget::NativeOnNavigation(struct FGeometry const &,struct FNavigationEvent const &)" (?NativeOnNavigation@UUserWidget@@MEAA?AVFNavigationReply@@AEBUFGeometry@@AEBUFNavigationEvent@@@Z)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "protected: virtual void __cdecl UUserWidget::NativeOnRemovedFromFocusPath(struct FFocusEvent const &)" (?NativeOnRemovedFromFocusPath@UUserWidget@@MEAAXAEBUFFocusEvent@@@Z)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "protected: virtual void __cdecl UUserWidget::NativeOnAddedToFocusPath(struct FFocusEvent const &)" (?NativeOnAddedToFocusPath@UUserWidget@@MEAAXAEBUFFocusEvent@@@Z)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "protected: virtual void __cdecl UUserWidget::NativeOnFocusChanging(class FWeakWidgetPath const &,class FWidgetPath const &,struct FFocusEvent const &)" (?NativeOnFocusChanging@UUserWidget@@MEAAXAEBVFWeakWidgetPath@@AEBVFWidgetPath@@AEBUFFocusEvent@@@Z)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "protected: virtual void __cdecl UUserWidget::NativeOnFocusLost(struct FFocusEvent const &)" (?NativeOnFocusLost@UUserWidget@@MEAAXAEBUFFocusEvent@@@Z)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "protected: virtual class FReply __cdecl UUserWidget::NativeOnFocusReceived(struct FGeometry const &,struct FFocusEvent const &)" (?NativeOnFocusReceived@UUserWidget@@MEAA?AVFReply@@AEBUFGeometry@@AEBUFFocusEvent@@@Z)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "protected: virtual bool __cdecl UUserWidget::NativeSupportsKeyboardFocus(void)const " (?NativeSupportsKeyboardFocus@UUserWidget@@MEBA_NXZ)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "protected: virtual bool __cdecl UUserWidget::NativeIsInteractable(void)const " (?NativeIsInteractable@UUserWidget@@MEBA_NXZ)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "protected: virtual void __cdecl UUserWidget::NativeTick(struct FGeometry const &,float)" (?NativeTick@UUserWidget@@MEAAXAEBUFGeometry@@M@Z)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "protected: virtual void __cdecl UUserWidget::NativeDestruct(void)" (?NativeDestruct@UUserWidget@@MEAAXXZ)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "protected: virtual void __cdecl UUserWidget::NativePreConstruct(void)" (?NativePreConstruct@UUserWidget@@MEAAXXZ)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "protected: virtual void __cdecl UUserWidget::NativeOnInitialized(void)" (?NativeOnInitialized@UUserWidget@@MEAAXXZ)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "protected: virtual void __cdecl UUserWidget::OnAnimationFinished_Implementation(class UWidgetAnimation const *)" (?OnAnimationFinished_Implementation@UUserWidget@@MEAAXPEBVUWidgetAnimation@@@Z)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "protected: virtual void __cdecl UUserWidget::OnAnimationStarted_Implementation(class UWidgetAnimation const *)" (?OnAnimationStarted_Implementation@UUserWidget@@MEAAXPEBVUWidgetAnimation@@@Z)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "public: virtual bool __cdecl UUserWidget::Initialize(void)" (?Initialize@UUserWidget@@UEAA_NXZ)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "protected: virtual class TSharedPtr<class SWidget,1> __cdecl UWidget::GetAccessibleWidget(void)const " (?GetAccessibleWidget@UWidget@@MEBA?AV?$TSharedPtr@VSWidget@@$00@@XZ)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "protected: virtual class TSharedRef<class SWidget,1> __cdecl UWidget::RebuildDesignWidget(class TSharedRef<class SWidget,1>)" (?RebuildDesignWidget@UWidget@@MEAA?AV?$TSharedRef@VSWidget@@$00@@V2@@Z)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "protected: virtual void __cdecl UUserWidget::OnWidgetRebuilt(void)" (?OnWidgetRebuilt@UUserWidget@@MEAAXXZ)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "protected: virtual class TSharedRef<class SWidget,1> __cdecl UUserWidget::RebuildWidget(void)" (?RebuildWidget@UUserWidget@@MEAA?AV?$TSharedRef@VSWidget@@$00@@XZ)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "protected: virtual void __cdecl UWidget::OnBindingChanged(class FName const &)" (?OnBindingChanged@UWidget@@MEAAXAEBVFName@@@Z)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "public: virtual void __cdecl UUserWidget::OnDesignerChanged(struct FDesignerChangedEventArgs const &)" (?OnDesignerChanged@UUserWidget@@UEAAXAEBUFDesignerChangedEventArgs@@@Z)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "public: virtual class FText const __cdecl UUserWidget::GetPaletteCategory(void)" (?GetPaletteCategory@UUserWidget@@UEAA?BVFText@@XZ)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "public: virtual class FString __cdecl UWidget::GetLabelMetadata(void)const " (?GetLabelMetadata@UWidget@@UEBA?AVFString@@XZ)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "public: virtual void __cdecl UUserWidget::SetDesignerFlags(enum EWidgetDesignFlags)" (?SetDesignerFlags@UUserWidget@@UEAAXW4EWidgetDesignFlags@@@Z)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "public: virtual void __cdecl UUserWidget::SynchronizeProperties(void)" (?SynchronizeProperties@UUserWidget@@UEAAXXZ)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "public: virtual class ULocalPlayer * __cdecl UUserWidget::GetOwningLocalPlayer(void)const " (?GetOwningLocalPlayer@UUserWidget@@UEBAPEAVULocalPlayer@@XZ)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "public: virtual class APlayerController * __cdecl UUserWidget::GetOwningPlayer(void)const " (?GetOwningPlayer@UUserWidget@@UEBAPEAVAPlayerController@@XZ)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "public: virtual void __cdecl UWidget::RemoveFromParent(void)" (?RemoveFromParent@UWidget@@UEAAXXZ)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "public: virtual bool __cdecl UWidget::IsHovered(void)const " (?IsHovered@UWidget@@UEBA_NXZ)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "public: virtual void __cdecl UUserWidget::SetVisibility(enum ESlateVisibility)" (?SetVisibility@UUserWidget@@UEAAXW4ESlateVisibility@@@Z)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "public: virtual void __cdecl UWidget::SetIsEnabled(bool)" (?SetIsEnabled@UWidget@@UEAAX_N@Z)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "public: virtual void __cdecl UUserWidget::ReleaseSlateResources(bool)" (?ReleaseSlateResources@UUserWidget@@UEAAX_N@Z)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "public: virtual bool __cdecl UUserWidget::IsAsset(void)const " (?IsAsset@UUserWidget@@UEBA_NXZ)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "public: virtual class UWorld * __cdecl UUserWidget::GetWorld(void)const " (?GetWorld@UUserWidget@@UEBAPEAVUWorld@@XZ)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "public: virtual bool __cdecl UVisual::NeedsLoadForServer(void)const " (?NeedsLoadForServer@UVisual@@UEBA_NXZ)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "public: virtual void __cdecl UUserWidget::PostDuplicate(bool)" (?PostDuplicate@UUserWidget@@UEAAX_N@Z)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "public: virtual void __cdecl UUserWidget::PostEditChangeProperty(struct FPropertyChangedEvent &)" (?PostEditChangeProperty@UUserWidget@@UEAAXAEAUFPropertyChangedEvent@@@Z)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "public: virtual void __cdecl UWidget::FinishDestroy(void)" (?FinishDestroy@UWidget@@UEAAXXZ)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "public: virtual void __cdecl UUserWidget::BeginDestroy(void)" (?BeginDestroy@UUserWidget@@UEAAXXZ)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "public: virtual void __cdecl UUserWidget::PostLoad(void)" (?PostLoad@UUserWidget@@UEAAXXZ)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "public: virtual bool __cdecl UWidget::Modify(bool)" (?Modify@UWidget@@UEAA_N_N@Z)
Module.IronEchoContractVisuals.gen.cpp.obj : error LNK2001: unresolved external symbol "public: virtual void __cdecl UUserWidget::PreSave(class FObjectPreSaveContext)" (?PreSave@UUserWidget@@UEAAXVFObjectPreSaveContext@@@Z)
IEGameplayHudWidget.cpp.obj : error LNK2019: unresolved external symbol "__declspec(dllimport) protected: __cdecl FSlateBrush::FSlateBrush(enum ESlateBrushDrawType::Type,class FName,struct FMargin const &,enum ESlateBrushTileType::Type,enum ESlateBrushImageType::Type,struct UE::Slate::FDeprecateVector2DParameter const &,struct FLinearColor const &,class UObject *,bool)" (__imp_??0FSlateBrush@@IEAA@W4Type@ESlateBrushDrawType@@VFName@@AEBUFMargin@@W41ESlateBrushTileType@@W41ESlateBrushImageType@@AEBUFDeprecateVector2DParameter@Slate@UE@@AEBUFLinearColor@@PEAVUObject@@_N@Z) referenced in function "protected: virtual int __cdecl UIEGameplayHudWidget::NativePaint(class FPaintArgs const &,struct FGeometry const &,class FSlateRect const &,class FSlateWindowElementList &,int,class FWidgetStyle const &,bool)const " (?NativePaint@UIEGameplayHudWidget@@MEBAHAEBVFPaintArgs@@AEBUFGeometry@@AEBVFSlateRect@@AEAVFSlateWindowElementList@@HAEBVFWidgetStyle@@_N@Z)
IEGameplayHudWidget.cpp.obj : error LNK2019: unresolved external symbol "__declspec(dllimport) public: static void __cdecl FSlateDrawElement::MakeBox(class FSlateWindowElementList &,unsigned int,struct FPaintGeometry const &,struct FSlateBrush const *,enum ESlateDrawEffect,struct FLinearColor const &)" (__imp_?MakeBox@FSlateDrawElement@@SAXAEAVFSlateWindowElementList@@IAEBUFPaintGeometry@@PEBUFSlateBrush@@W4ESlateDrawEffect@@AEBUFLinearColor@@@Z) referenced in function "public: __cdecl `protected: virtual int __cdecl UIEGameplayHudWidget::NativePaint(class FPaintArgs const &,struct FGeometry const &,class FSlateRect const &,class FSlateWindowElementList &,int,class FWidgetStyle const &,bool)const '::`2'::<lambda_1>::operator()(float,float,float,float,struct FLinearColor,int)const " (??R<lambda_1>@?1??NativePaint@UIEGameplayHudWidget@@MEBAHAEBVFPaintArgs@@AEBUFGeometry@@AEBVFSlateRect@@AEAVFSlateWindowElementList@@HAEBVFWidgetStyle@@_N@Z@QEBA@MMMMUFLinearColor@@H@Z)
IEGameplayHudWidget.cpp.obj : error LNK2019: unresolved external symbol "__declspec(dllimport) public: static void __cdecl FSlateDrawElement::MakeText(class FSlateWindowElementList &,unsigned int,struct FPaintGeometry const &,class FString const &,struct FSlateFontInfo const &,enum ESlateDrawEffect,struct FLinearColor const &)" (__imp_?MakeText@FSlateDrawElement@@SAXAEAVFSlateWindowElementList@@IAEBUFPaintGeometry@@AEBVFString@@AEBUFSlateFontInfo@@W4ESlateDrawEffect@@AEBUFLinearColor@@@Z) referenced in function "public: __cdecl `protected: virtual int __cdecl UIEGameplayHudWidget::NativePaint(class FPaintArgs const &,struct FGeometry const &,class FSlateRect const &,class FSlateWindowElementList &,int,class FWidgetStyle const &,bool)const '::`2'::<lambda_2>::operator()(class FString const &,float,float,int,struct FLinearColor,bool)const " (??R<lambda_2>@?1??NativePaint@UIEGameplayHudWidget@@MEBAHAEBVFPaintArgs@@AEBUFGeometry@@AEBVFSlateRect@@AEAVFSlateWindowElementList@@HAEBVFWidgetStyle@@_N@Z@QEBA@AEBVFString@@MMHUFLinearColor@@5@Z)
IEGameplayHudWidget.cpp.obj : error LNK2019: unresolved external symbol "__declspec(dllimport) public: class TSharedRef<class FSlateFontMeasure,1> __cdecl FSlateFontServices::GetFontMeasureService(void)const " (__imp_?GetFontMeasureService@FSlateFontServices@@QEBA?AV?$TSharedRef@VFSlateFontMeasure@@$00@@XZ) referenced in function "public: __cdecl `protected: virtual int __cdecl UIEGameplayHudWidget::NativePaint(class FPaintArgs const &,struct FGeometry const &,class FSlateRect const &,class FSlateWindowElementList &,int,class FWidgetStyle const &,bool)const '::`2'::<lambda_2>::operator()(class FString const &,float,float,int,struct FLinearColor,bool)const " (??R<lambda_2>@?1??NativePaint@UIEGameplayHudWidget@@MEBAHAEBVFPaintArgs@@AEBUFGeometry@@AEBVFSlateRect@@AEAVFSlateWindowElementList@@HAEBVFWidgetStyle@@_N@Z@QEBA@AEBVFString@@MMHUFLinearColor@@5@Z)
IEGameplayHudWidget.cpp.obj : error LNK2019: unresolved external symbol "__declspec(dllimport) public: static struct FSlateFontInfo __cdecl FCoreStyle::GetDefaultFontStyle(class FName,float,struct FFontOutlineSettings const &)" (__imp_?GetDefaultFontStyle@FCoreStyle@@SA?AUFSlateFontInfo@@VFName@@MAEBUFFontOutlineSettings@@@Z) referenced in function "public: __cdecl `protected: virtual int __cdecl UIEGameplayHudWidget::NativePaint(class FPaintArgs const &,struct FGeometry const &,class FSlateRect const &,class FSlateWindowElementList &,int,class FWidgetStyle const &,bool)const '::`2'::<lambda_2>::operator()(class FString const &,float,float,int,struct FLinearColor,bool)const " (??R<lambda_2>@?1??NativePaint@UIEGameplayHudWidget@@MEBAHAEBVFPaintArgs@@AEBUFGeometry@@AEBVFSlateRect@@AEAVFSlateWindowElementList@@HAEBVFWidgetStyle@@_N@Z@QEBA@AEBVFString@@MMHUFLinearColor@@5@Z)
IEGameplayHudWidget.cpp.obj : error LNK2019: unresolved external symbol "__declspec(dllimport) protected: virtual void __cdecl UUserWidget::NativeConstruct(void)" (__imp_?NativeConstruct@UUserWidget@@MEAAXXZ) referenced in function "protected: virtual void __cdecl UIEGameplayHudWidget::NativeConstruct(void)" (?NativeConstruct@UIEGameplayHudWidget@@MEAAXXZ)
IEGameplayHudWidget.cpp.obj : error LNK2019: unresolved external symbol "__declspec(dllimport) protected: virtual int __cdecl UUserWidget::NativePaint(class FPaintArgs const &,struct FGeometry const &,class FSlateRect const &,class FSlateWindowElementList &,int,class FWidgetStyle const &,bool)const " (__imp_?NativePaint@UUserWidget@@MEBAHAEBVFPaintArgs@@AEBUFGeometry@@AEBVFSlateRect@@AEAVFSlateWindowElementList@@HAEBVFWidgetStyle@@_N@Z) referenced in function "protected: virtual int __cdecl UIEGameplayHudWidget::NativePaint(class FPaintArgs const &,struct FGeometry const &,class FSlateRect const &,class FSlateWindowElementList &,int,class FWidgetStyle const &,bool)const " (?NativePaint@UIEGameplayHudWidget@@MEBAHAEBVFPaintArgs@@AEBUFGeometry@@AEBVFSlateRect@@AEAVFSlateWindowElementList@@HAEBVFWidgetStyle@@_N@Z)
IEGameplayHudWidget.cpp.obj : error LNK2019: unresolved external symbol "__declspec(dllimport) public: struct FDeprecateSlateVector2D __cdecl FSlateFontMeasure::Measure(class TStringView<wchar_t>,struct FSlateFontInfo const &,float)const " (__imp_?Measure@FSlateFontMeasure@@QEBA?AUFDeprecateSlateVector2D@@V?$TStringView@_W@@AEBUFSlateFontInfo@@M@Z) referenced in function "public: __cdecl `protected: virtual int __cdecl UIEGameplayHudWidget::NativePaint(class FPaintArgs const &,struct FGeometry const &,class FSlateRect const &,class FSlateWindowElementList &,int,class FWidgetStyle const &,bool)const '::`2'::<lambda_2>::operator()(class FString const &,float,float,int,struct FLinearColor,bool)const " (??R<lambda_2>@?1??NativePaint@UIEGameplayHudWidget@@MEBAHAEBVFPaintArgs@@AEBUFGeometry@@AEBVFSlateRect@@AEAVFSlateWindowElementList@@HAEBVFWidgetStyle@@_N@Z@QEBA@AEBVFString@@MMHUFLinearColor@@5@Z)
IEGameplayHudWidget.cpp.obj : error LNK2019: unresolved external symbol "__declspec(dllimport) private: static class TSharedPtr<class FSlateApplication,1> FSlateApplication::CurrentApplication" (__imp_?CurrentApplication@FSlateApplication@@0V?$TSharedPtr@VFSlateApplication@@$00@@A) referenced in function "public: __cdecl `protected: virtual int __cdecl UIEGameplayHudWidget::NativePaint(class FPaintArgs const &,struct FGeometry const &,class FSlateRect const &,class FSlateWindowElementList &,int,class FWidgetStyle const &,bool)const '::`2'::<lambda_2>::operator()(class FString const &,float,float,int,struct FLinearColor,bool)const " (??R<lambda_2>@?1??NativePaint@UIEGameplayHudWidget@@MEBAHAEBVFPaintArgs@@AEBUFGeometry@@AEBVFSlateRect@@AEAVFSlateWindowElementList@@HAEBVFWidgetStyle@@_N@Z@QEBA@AEBVFString@@MMHUFLinearColor@@5@Z)
C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Binaries\Win64\UnrealEditor-IronEchoContractVisuals.dll : fatal error LNK1120: 99 unresolved externals
Total time in Unreal Build Accelerator local executor: 114.64 seconds

Result: Failed (OtherCompilationError)
Total execution time: 120.31 seconds
Trace written to file C:\Users\user\AppData\Local\UnrealBuildTool\Trace.uba with size 65.8kb
```

### editor-integrated.log

```text
Using bundled DotNet SDK version: 10.0 win-x64
Running UnrealBuildTool: dotnet "..\..\Engine\Binaries\DotNET\UnrealBuildTool\UnrealBuildTool.dll" IronEchoEditor Win64 Development -Project=C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\IronEcho.uproject -WaitMutex -NoHotReloadFromIDE
Log file: C:\Users\user\AppData\Local\UnrealBuildTool\Log.txt
Determining max actions to execute in parallel (6 physical cores, 12 logical cores)
  Executing up to 6 processes, one per physical core
Using 'git status' to determine working set for adaptive non-unity build (C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check).
UbaServer - Listening on 0.0.0.0:1345
Invalidating makefile for IronEchoEditor (IronEchoContractVisuals.Build.cs modified)
UHT compiled-in object format Default
Building IronEchoEditor...
===== Toolchain Information =====
Using ISPC compiler (C:\Program Files\Epic Games\UE_5.8\Engine\Source\ThirdParty\Intel\ISPC\bin\Windows\ispc.exe)
  Intel(r) Implicit SPMD Program Compiler (Intel(r) ISPC), 1.24.0 (build commit  @ 20250404, LLVM 18.1.2) 
Using Visual Studio 14.44.35229 toolchain (C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\14.44.35207) and Windows 10.0.22621.0 SDK (C:\Program Files (x86)\Windows Kits\10).
[Adaptive Build] Excluded from IronEchoContractVisuals unity file: IEContractCameraRig.cpp, IEDesktopMenuWidget.cpp, IEGameplayHudWidget.cpp, IEPresentationCapture.cpp, IERealisticRobotAnimInstance.cpp, IEVisualImportLibrary.cpp, IEGameplayHudTests.cpp, IERealisticRobotTests.cpp
[Adaptive Build] Excluded from IronEchoRules unity file: BotBrain.cpp, CombatConfig.cpp, CombatSim.cpp, Crc32.cpp, Fighter.cpp, InputFrame.cpp, Match.cpp, PacketGate.cpp, Protocol.cpp
[Adaptive Build] Excluded from IronEcho unity file: IronEchoGameMode.cpp, IronEchoGameState.cpp
=================================
Using Unreal Build Accelerator local executor to run 33 action(s)
  CPU 6 physical cores, 12 logical cores
  Memory 31.85 GB physical, 23.29 GB/33.85 GB committed
  UBA Storage capacity 40 GB
[1/33] Compile [x64] Crc32.cpp
[2/33] Compile [x64] InputFrame.cpp
[3/33] Compile [x64] CombatConfig.cpp
[4/33] Compile [x64] Fighter.cpp
[5/33] Compile [x64] CombatSim.cpp
[6/33] Compile [x64] BotBrain.cpp
[7/33] Compile [x64] PacketGate.cpp
[8/33] Compile [x64] Protocol.cpp
[9/33] Compile [x64] Match.cpp
[10/33] Link [x64] UnrealEditor-IronEchoRules.lib
[11/33] Link [x64] UnrealEditor-IronEchoRules.dll
[12/33] Compile [x64] IronEchoAutomationTests.cpp
[13/33] Compile [x64] IronEchoDebugHUD.cpp
[14/33] Compile [x64] IronEchoPlayerController.cpp
[15/33] Compile [x64] IronEchoGameMode.cpp
[16/33] Compile [x64] IronEchoTrackingSubsystem.cpp
[17/33] Compile [x64] Module.IronEcho.gen.cpp
[18/33] Link [x64] UnrealEditor-IronEcho.lib
[19/33] Link [x64] UnrealEditor-IronEcho.dll
[20/33] Compile [x64] IEContractCameraRig.cpp
[21/33] Compile [x64] IEDesktopMenuWidget.cpp
C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Source\IronEchoContractVisuals\Private\IEDesktopMenuWidget.cpp(27,23): error C4458: declaration of 'Slot' hides class member
        UOverlaySlot* Slot = Overlay->AddChildToOverlay(Width);
                      ^
C:\Program Files\Epic Games\UE_5.8\Engine\Source\Runtime\UMG\Public\Components\Widget.h(264,25): note: see declaration of 'UWidget::Slot'
	TObjectPtr<UPanelSlot> Slot;
	                       ^
[22/33] Compile [x64] IEGameplayHudTests.cpp
[23/33] Compile [x64] IEGameplayHudWidget.cpp
[24/33] Compile [x64] IEPresentationCapture.cpp
[25/33] Compile [x64] IERealisticRobotAnimInstance.cpp
[26/33] Compile [x64] IERealisticRobotTests.cpp
[27/33] Compile [x64] IEVisualImportLibrary.cpp
[28/33] Compile [x64] IronEchoContractVisualsModule.cpp
[29/33] Compile [x64] Module.IronEchoContractVisuals.gen.cpp
[30/33] Compile [x64] PerModuleInline.gen.cpp
Total time in Unreal Build Accelerator local executor: 31.35 seconds

Result: Failed (OtherCompilationError)
Total execution time: 36.88 seconds
Trace written to file C:\Users\user\AppData\Local\UnrealBuildTool\Trace.uba with size 14.8kb
```

### editor-integrated-2.log

```text
Using bundled DotNet SDK version: 10.0 win-x64
Running UnrealBuildTool: dotnet "..\..\Engine\Binaries\DotNET\UnrealBuildTool\UnrealBuildTool.dll" IronEchoEditor Win64 Development -Project=C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\IronEcho.uproject -WaitMutex -NoHotReloadFromIDE
Log file: C:\Users\user\AppData\Local\UnrealBuildTool\Log.txt
Determining max actions to execute in parallel (6 physical cores, 12 logical cores)
  Executing up to 6 processes, one per physical core
Using 'git status' to determine working set for adaptive non-unity build (C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check).
UbaServer - Listening on 0.0.0.0:1345
Building IronEchoEditor...
===== Toolchain Information =====
Using ISPC compiler (C:\Program Files\Epic Games\UE_5.8\Engine\Source\ThirdParty\Intel\ISPC\bin\Windows\ispc.exe)
  Intel(r) Implicit SPMD Program Compiler (Intel(r) ISPC), 1.24.0 (build commit  @ 20250404, LLVM 18.1.2) 
Using Visual Studio 14.44.35229 toolchain (C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\14.44.35207) and Windows 10.0.22621.0 SDK (C:\Program Files (x86)\Windows Kits\10).
[Adaptive Build] Excluded from IronEchoContractVisuals unity file: IEContractCameraRig.cpp, IEDesktopMenuWidget.cpp, IEGameplayHudWidget.cpp, IEPresentationCapture.cpp, IERealisticRobotAnimInstance.cpp, IEVisualImportLibrary.cpp, IEGameplayHudTests.cpp, IERealisticRobotTests.cpp
[Adaptive Build] Excluded from IronEchoRules unity file: BotBrain.cpp, CombatConfig.cpp, CombatSim.cpp, Crc32.cpp, Fighter.cpp, InputFrame.cpp, Match.cpp, PacketGate.cpp, Protocol.cpp
[Adaptive Build] Excluded from IronEcho unity file: IronEchoGameMode.cpp, IronEchoGameState.cpp
=================================
Using Unreal Build Accelerator local executor to run 4 action(s)
  CPU 6 physical cores, 12 logical cores
  Memory 31.85 GB physical, 22.7 GB/33.85 GB committed
  UBA Storage capacity 40 GB
[1/4] Compile [x64] IEDesktopMenuWidget.cpp
[2/4] Link [x64] UnrealEditor-IronEchoContractVisuals.lib
[3/4] Link [x64] UnrealEditor-IronEchoContractVisuals.dll
IEGameplayHudWidget.cpp.obj : error LNK2019: unresolved external symbol "__declspec(dllimport) public: static struct FKey const EKeys::Escape" (__imp_?Escape@EKeys@@2UFKey@@B) referenced in function "protected: virtual void __cdecl UIEGameplayHudWidget::NativeTick(struct FGeometry const &,float)" (?NativeTick@UIEGameplayHudWidget@@MEAAXAEBUFGeometry@@M@Z)
C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Binaries\Win64\UnrealEditor-IronEchoContractVisuals.dll : fatal error LNK1120: 1 unresolved externals
Total time in Unreal Build Accelerator local executor: 3.93 seconds

Result: Failed (OtherCompilationError)
Total execution time: 4.97 seconds
Trace written to file C:\Users\user\AppData\Local\UnrealBuildTool\Trace.uba with size 6.0kb
```

### windows-tests.log

```text

==> Ownership blocks
    ownership blocks up to date

==> Core rules (CMake)
    -- Selecting Windows SDK version 10.0.22621.0 to target Windows 10.0.19045.
    -- Configuring done (0.0s)
    -- Generating done (0.0s)
    -- Build files have been written to: C:/Users/user/AppData/Local/Temp/IronEchoCoreRulesTests
    MSBuild version 17.14.60+43b635718 for .NET Framework
    
    C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Microsoft\VC\v170\Microsoft.CppBuild.targets(548,5): warning MSB8029: The Intermediate directory or Output directory cannot reside under the Temporary directory as it could lead to issues with incremental build. [C:\Users\user\AppData\Local\Temp\IronEchoCoreRulesTests\ZERO_CHECK.vcxproj]
      Checking File Globs
      1>Checking Build System
    C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Microsoft\VC\v170\Microsoft.CppBuild.targets(548,5): warning MSB8029: The Intermediate directory or Output directory cannot reside under the Temporary directory as it could lead to issues with incremental build. [C:\Users\user\AppData\Local\Temp\IronEchoCoreRulesTests\IronEchoRulesCore.vcxproj]
      Building Custom Rule C:/Users/user/Documents/Codex/2026-10-09/windows-1-ironecho-canopybridge-claude-wizardly/work/canopybridge-check/IronEcho/Tests/CoreRules/CMakeLists.txt
      IronEchoRulesCore.vcxproj -> C:\Users\user\AppData\Local\Temp\IronEchoCoreRulesTests\Release\IronEchoRulesCore.lib
    C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Microsoft\VC\v170\Microsoft.CppBuild.targets(548,5): warning MSB8029: The Intermediate directory or Output directory cannot reside under the Temporary directory as it could lead to issues with incremental build. [C:\Users\user\AppData\Local\Temp\IronEchoCoreRulesTests\CoreRulesTests.vcxproj]
      Building Custom Rule C:/Users/user/Documents/Codex/2026-10-09/windows-1-ironecho-canopybridge-claude-wizardly/work/canopybridge-check/IronEcho/Tests/CoreRules/CMakeLists.txt
    cl : command line  warning D9025: overriding '/EHs' with '/EHs-' [C:\Users\user\AppData\Local\Temp\IronEchoCoreRulesTests\CoreRulesTests.vcxproj]
    cl : command line  warning D9025: overriding '/EHc' with '/EHc-' [C:\Users\user\AppData\Local\Temp\IronEchoCoreRulesTests\CoreRulesTests.vcxproj]
      TestProtocol.cpp
      CoreRulesTests.vcxproj -> C:\Users\user\AppData\Local\Temp\IronEchoCoreRulesTests\Release\CoreRulesTests.exe
    C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Microsoft\VC\v170\Microsoft.CppBuild.targets(548,5): warning MSB8029: The Intermediate directory or Output directory cannot reside under the Temporary directory as it could lead to issues with incremental build. [C:\Users\user\AppData\Local\Temp\IronEchoCoreRulesTests\ALL_BUILD.vcxproj]
      Building Custom Rule C:/Users/user/Documents/Codex/2026-10-09/windows-1-ironecho-canopybridge-claude-wizardly/work/canopybridge-check/IronEcho/Tests/CoreRules/CMakeLists.txt
    [ OK ] Crc32_KnownVector
    [ OK ] Protocol_PoseRoundTrip
    [ OK ] Protocol_StatusControlAckRoundTrip
    [ OK ] Protocol_RejectsMalformed
    [ OK ] Protocol_ClampsOutOfRangeValues
    [ OK ] Protocol_ForwardCompatibleMinorVersion
    [ OK ] Protocol_FuzzNeverCrashes
    [ OK ] Protocol_GoldenVectorsFromPython
    [ OK ] Gate_AcceptsInOrderAndRejectsReplay
    [ OK ] Gate_RejectsWrongSessionStaleAndClockRegression
    [ OK ] Gate_DeveloperTokenZeroAcceptsAny
    [ OK ] Gate_LivenessTimeout
    [ OK ] Gate_InstanceSwitchNeedsSilence
    [ OK ] Gate_EventsDeduplicatedAcrossRepeats
    [ OK ] Gate_LostFirstPacketEventRecoveredFromRepeat
    [ OK ] Gate_StaleEventsDropped
    [ OK ] Gate_StatusMapping
    [ OK ] Gate_RejectsControlPacketsAndGarbage
    [ OK ] Gate_AckLookup
    [ OK ] Intent_DodgeHysteresis
    [ OK ] Intent_BlockHysteresisAndPunchCancels
    [ OK ] Intent_NotLiveIsNeutral
    [ OK ] Intent_LowConfidencePunchFiltered
    [ OK ] Fighter_JabTimelineIsExact
    [ OK ] Fighter_ComboCancelOtherHandOnly
    [ OK ] Fighter_InputBufferStartsWhenFreeOrExpires
    [ OK ] Fighter_BlockReducesDamageCostsStaminaNeverKOs
    [ OK ] Fighter_GuardBreaksWithoutStamina
    [ OK ] Fighter_DodgeEvadesAndPunishesWithPenalty
    [ OK ] Fighter_DodgeReturningToCentreGetsHit
    [ OK ] Fighter_HeldDodgeExpires
    [ OK ] Fighter_OutOfRangeWhiffs
    [ OK ] Fighter_TradeIsSymmetric
    [ OK ] Fighter_CounterHitBonusAndInterrupt
    [ OK ] Fighter_StaminaSpendRegenAndTiredPunch
    [ OK ] Fighter_KnockOutWhenKnockdownsDisabled
    [ OK ] Fighter_TrainingBagTakesHitsForever
    [ OK ] Fighter_KnockdownAndGetUpRecovery
    [ OK ] Fighter_ComboCountsConsecutiveCleanHits
    [ OK ] Fighter_DefenseStatsCountBlocksAndDodges
    [ OK ] Fighter_CoverUpFromHitStunKeepsPunchesLocked
    [ OK ] Fighter_TiredPunchIsAWeakArmPunch
    [ OK ] Fighter_GuardDrainScalesWithPowerAndKeepsRegen
    [ OK ] Fighter_EmptyingStaminaCostsABreath
    [ OK ] Ring_StartsFacingAtEngageDistance
    [ OK ] Ring_StepsHaveWeight
    [ OK ] Ring_StepInStopsAtClinchStepBackOpens
    [ OK ] Ring_CirclingKeepsDistanceAndTurnsTheFightLine
    [ OK ] Ring_RopesStopTheRetreat
    [ OK ] Ring_CornerHoldsBothAxes
    [ OK ] Ring_CameraPlayerIsBroughtBackIntoRange
    [ OK ] Ring_StunnedLegsDoNotWalk
    [ OK ] Ring_KnockbackFollowsTheFightLine
    [ OK ] Precision_SlipInTimeMakesTheCrossMiss
    [ OK ] Precision_TooLateSlipStillGetsHit
    [ OK ] Precision_SlipHeldFromBeforeIsTracked
    [ OK ] Precision_HalfSlipIsAGlancingBlow
    [ OK ] Precision_FullPowerAtTheEndOfTheArmSmotheredInTheClinch
    [ OK ] Precision_StepBackOutOfATelegraphedPunch
    [ OK ] Precision_CirclingTargetIsLed
    [ OK ] Precision_ChangeOfDirectionBeatsACommittedPunch
    [ OK ] Body_ShotCannotBeSlippedAndTakesTheWind
    [ OK ] Body_ShotsAreShorter
    [ OK ] Body_GuardPaysMoreForABodyShot
    [ OK ] Intent_CameraLeanStepsWithHysteresisDirectInputWins
    [ OK ] Kick_TimelineReachAndPower
    [ OK ] Kick_ReachesWherePunchesDoNot
    [ OK ] Kick_StepBackOutOfIt_MissCostsMore
    [ OK ] Kick_GuardBlocksMidKickButNotLowKick_SlipDoesNotHelpEither
    [ OK ] Kick_LowKickSlowsTheLegsAndStacks
    [ OK ] Kick_RecoveryCannotBeCancelledButPunchRecoveryCanBeKicked
    [ OK ] Kick_KickingFighterBarelyMoves
    [ OK ] Kick_IntentKeepsKindAndLowPunchBecomesBody
    [ OK ] Match_WaitsForStableInputThenCountsDown
      info: result=3 fight=20.0s bot_punches=22 landed=31 score=19-19
    [ OK ] Match_FullBoutReachesResultWithInvariants
    [ OK ] Match_DecisionScoringAndRoundBreakRecovery
    [ OK ] Match_StayingDownForTenIsKnockOut
    [ OK ] Match_TrackingLossPausesAfterGraceAndResumesWhenStable
    [ OK ] Match_ManualPauseNeedsResumeRequest
    [ OK ] Match_RematchResetsEverything
    [ OK ] Match_TrainingCountsConfirmedBagHits
    [ OK ] Match_DeterministicForSeed
      info: bot hits on scripted player: easy=29 hard=52
    [ OK ] Match_BotDifficultyOrdering
    [ OK ] Match_PlayerBeatsCountByHoldingGuard
    [ OK ] Match_ReleasingGuardResetsGetUp
    [ OK ] Match_ThirdKnockdownInRoundIsTechnicalKnockOut
    [ OK ] Match_TrackingLossDuringCountPausesAndResumesCount
    [ OK ] Judges_ScoreRoundWithStylesAndKnockdowns
    [ OK ] Judges_DecisionKinds
    [ OK ] Versus_NeedsBothHumansReady
    [ OK ] Versus_BothFightersUseTheSameRulesAndTheSecondIsHuman
    [ OK ] Versus_SecondHumanBeatsTheCountByHoldingTheGuard
    [ OK ] Versus_TwoRunsOfTheSameInputsAreBitIdentical
    [ OK ] Versus_RewindFromAByteCopyAndReplayIsBitIdentical
    [ OK ] Versus_FullBoutEndsWithAResultAndInvariantsHold
      info: jabs defended of 40: easy=0 normal=30 hard=32
    [ OK ] Bot_ReadsTheJabAtNormalAndHardButNotEasy
    [ OK ] Bot_RetriesAPlannedAttackRightAfterAStun
    [ OK ] Bot_BlocksThenCounters
      info: flurry punches blocked of 60: plain=37 read=43
    [ OK ] Bot_ReadsAFlurryAndCoversUp
      info: bot punches in 30 s: fresh player=28 gassed player=33
    [ OK ] Bot_PressesAGassedPlayer
    [ OK ] Bot_WalksBackIntoItsWorkingDistance
    [ OK ] Bot_StepsInToLandAPlannedPunch
    [ OK ] Bot_SlidesOffTheRopes
    [ OK ] Bot_CirclesBetweenExchanges
      info: bot body-shot share: open=0.13 guard=0.36
    [ OK ] Bot_GoesToTheBodyMoreAgainstAGuard
      info: bot kicks in 40 s at kick range: 12
    [ OK ] Bot_KicksWhenThePlayerStandsJustOutOfPunchReach
      info: average human wins easy=16 normal=10 hard=2 of 16; normal: decisions=7 r1 stoppages=0 rounds=3.00
    [ OK ] Balance_BoutsLastAndLevelsAreOrdered
      info: flailing wins normal=5 hard=1 of 16 (measured boxing: 10)
    [ OK ] Balance_FlailingDoesNotWin
    
    108 test cases, 0 failed expectations

==> Tracker (pytest + selftest)
    ...
    {"version": "0.1.0", "protocol": "1.0", "frames": 370, "packets_received": 377, "pose_frames": 370, "calibration": "VALID", "punch_events": 4, "hands": [0, 1, 0, 1], "sequence_monotonic": true, "model": "pose_landmarker_full", "model_inference_ms": 12.1, "ok": true}
    2026-10-09 23:21:53,791 INFO iron_echo_tracker: calibration saved to C:\Users\user\AppData\Local\Temp\tmpy9stv_vy\calibration.json
    2026-10-09 23:21:54,339 INFO iron_echo_tracker: punch LEFT strength=0.78
    2026-10-09 23:21:54,506 INFO iron_echo_tracker: punch RIGHT strength=0.65
    2026-10-09 23:21:54,681 INFO iron_echo_tracker: punch LEFT strength=0.64
    2026-10-09 23:21:54,864 INFO iron_echo_tracker: punch RIGHT strength=0.89
    2026-10-09 23:21:55,291 INFO iron_echo_tracker: tracker exit: source finished
    INFO: Created TensorFlow Lite XNNPACK delegate for CPU.
    WARNING: Logging before InitGoogle() is written to STDERR
    W0000 00:00:1791570116.125691   24856 inference_feedback_manager.cc:121] Feedback manager requires a model with a single signature inference. Disabling support for feedback tensors.
    W0000 00:00:1791570116.141945   24856 inference_feedback_manager.cc:121] Feedback manager requires a model with a single signature inference. Disabling support for feedback tensors.

==> Tool tests (robot contract checks)
    ......                                                                   [100%]
    6 passed in 0.04s
    OK   all tests passed; logs: C:\Users\user\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Saved\Logs\Tests\20261009-232136
```

### ownership-final.log

```text
NOT CODEX'S: ArtSource/Realistic/Export/SK_IE1_Ember.fbx  (owner: claude, rule ArtSource/Realistic/**)
Hand the change over via Docs/Handoffs or take a lock in Docs/Handoffs/LOCKS.md.
NOT CODEX'S: ArtSource/Realistic/Export/SK_IE1_Forge.fbx  (owner: claude, rule ArtSource/Realistic/**)
NOT CODEX'S: ArtSource/Realistic/Export/SM_IE_Ring.fbx  (owner: claude, rule ArtSource/Realistic/**)
NOT CODEX'S: ArtSource/Realistic/Export/T_IE1_Ember_BaseColor.png  (owner: claude, rule ArtSource/Realistic/**)
NOT CODEX'S: ArtSource/Realistic/Export/T_IE1_Ember_Emissive.png  (owner: claude, rule ArtSource/Realistic/**)
NOT CODEX'S: ArtSource/Realistic/Export/T_IE1_Ember_Normal.png  (owner: claude, rule ArtSource/Realistic/**)
NOT CODEX'S: ArtSource/Realistic/Export/T_IE1_Ember_ORM.png  (owner: claude, rule ArtSource/Realistic/**)
NOT CODEX'S: ArtSource/Realistic/Export/T_IE1_Forge_BaseColor.png  (owner: claude, rule ArtSource/Realistic/**)
NOT CODEX'S: ArtSource/Realistic/Export/T_IE1_Forge_Emissive.png  (owner: claude, rule ArtSource/Realistic/**)
NOT CODEX'S: ArtSource/Realistic/Export/T_IE1_Forge_Normal.png  (owner: claude, rule ArtSource/Realistic/**)
NOT CODEX'S: ArtSource/Realistic/Export/T_IE1_Forge_ORM.png  (owner: claude, rule ArtSource/Realistic/**)
NOT CODEX'S: ArtSource/Realistic/Export/bake_check_Ember.png  (owner: claude, rule ArtSource/Realistic/**)
NOT CODEX'S: ArtSource/Realistic/Export/bake_check_Forge.png  (owner: claude, rule ArtSource/Realistic/**)
NOT CODEX'S: ArtSource/Realistic/Export/bake_report.json  (owner: claude, rule ArtSource/Realistic/**)
NOT CODEX'S: ArtSource/Realistic/Export/ring_export_report.json  (owner: claude, rule ArtSource/Realistic/**)
NOT CODEX'S: Config/DefaultEngine.ini  (owner: claude, rule Config/**)
NOT CODEX'S: Config/DefaultGame.ini  (owner: claude, rule Config/**)
NOT CODEX'S: Config/DefaultGameUserSettings.ini  (owner: claude, rule Config/**)
NOT CODEX'S: Docs/Reports/2026-10-10_env_windows.md  (owner: claude, rule Docs/**)
NOT CODEX'S: Docs/Reports/ue_probe_log_20261010-001331.txt  (owner: claude, rule Docs/**)
NOT CODEX'S: Docs/Reports/ue_probe_result_20261010-001331.json  (owner: claude, rule Docs/**)
NOT CODEX'S: Source/IronEcho/Private/IronEchoGameMode.cpp  (owner: claude, rule Source/**)
NOT CODEX'S: Source/IronEcho/Private/IronEchoGameState.cpp  (owner: claude, rule Source/**)
NOT CODEX'S: Source/IronEcho/Public/IronEchoGameMode.h  (owner: claude, rule Source/**)
NOT CODEX'S: Source/IronEcho/Public/IronEchoGameState.h  (owner: claude, rule Source/**)
NOT CODEX'S: Source/IronEcho/Public/IronEchoPlayerController.h  (owner: claude, rule Source/**)
NOT CODEX'S: Source/IronEchoContractVisuals/IronEchoContractVisuals.Build.cs  (owner: claude, rule Source/**)
NOT CODEX'S: Source/IronEchoContractVisuals/Private/IEContractCameraRig.cpp  (owner: claude, rule Source/**)
NOT CODEX'S: Source/IronEchoContractVisuals/Private/IEDesktopMenuWidget.cpp  (owner: claude, rule Source/**)
NOT CODEX'S: Source/IronEchoContractVisuals/Private/IEDesktopVerificationActor.cpp  (owner: claude, rule Source/**)
NOT CODEX'S: Source/IronEchoContractVisuals/Private/IEGameplayHudWidget.cpp  (owner: claude, rule Source/**)
NOT CODEX'S: Source/IronEchoContractVisuals/Private/IEPresentationCapture.cpp  (owner: claude, rule Source/**)
NOT CODEX'S: Source/IronEchoContractVisuals/Private/IERealisticRobotAnimInstance.cpp  (owner: claude, rule Source/**)
NOT CODEX'S: Source/IronEchoContractVisuals/Private/IEVisualImportLibrary.cpp  (owner: claude, rule Source/**)
NOT CODEX'S: Source/IronEchoContractVisuals/Private/Tests/IEGameplayHudTests.cpp  (owner: claude, rule Source/**)
NOT CODEX'S: Source/IronEchoContractVisuals/Private/Tests/IERealisticRobotTests.cpp  (owner: claude, rule Source/**)
NOT CODEX'S: Source/IronEchoContractVisuals/Public/IEContractCameraRig.h  (owner: claude, rule Source/**)
NOT CODEX'S: Source/IronEchoContractVisuals/Public/IEDesktopMenuWidget.h  (owner: claude, rule Source/**)
NOT CODEX'S: Source/IronEchoContractVisuals/Public/IEDesktopVerificationActor.h  (owner: claude, rule Source/**)
NOT CODEX'S: Source/IronEchoContractVisuals/Public/IEGameplayHudWidget.h  (owner: claude, rule Source/**)
NOT CODEX'S: Source/IronEchoContractVisuals/Public/IERealisticRobotAnimInstance.h  (owner: claude, rule Source/**)
NOT CODEX'S: Source/IronEchoContractVisuals/Public/IEVisualImportLibrary.h  (owner: claude, rule Source/**)
NOT CODEX'S: Source/IronEchoRules/Public/IronEchoRules/BotBrain.h  (owner: claude, rule Source/**)
NOT CODEX'S: Source/IronEchoRules/Public/IronEchoRules/CombatConfig.h  (owner: claude, rule Source/**)
NOT CODEX'S: Source/IronEchoRules/Public/IronEchoRules/CombatEvents.h  (owner: claude, rule Source/**)
NOT CODEX'S: Source/IronEchoRules/Public/IronEchoRules/CombatSim.h  (owner: claude, rule Source/**)
NOT CODEX'S: Source/IronEchoRules/Public/IronEchoRules/Crc32.h  (owner: claude, rule Source/**)
NOT CODEX'S: Source/IronEchoRules/Public/IronEchoRules/Export.h  (owner: claude, rule Source/**)
NOT CODEX'S: Source/IronEchoRules/Public/IronEchoRules/Fighter.h  (owner: claude, rule Source/**)
NOT CODEX'S: Source/IronEchoRules/Public/IronEchoRules/InputFrame.h  (owner: claude, rule Source/**)
NOT CODEX'S: Source/IronEchoRules/Public/IronEchoRules/Match.h  (owner: claude, rule Source/**)
NOT CODEX'S: Source/IronEchoRules/Public/IronEchoRules/PacketGate.h  (owner: claude, rule Source/**)
NOT CODEX'S: Source/IronEchoRules/Public/IronEchoRules/Protocol.h  (owner: claude, rule Source/**)
NOT CODEX'S: Tests/CoreRules/TestProtocol.cpp  (owner: claude, rule Tests/**)
NOT CODEX'S: Tools/Blender/Realistic/rlib.py  (owner: claude, rule Tools/Blender/Realistic/**)
NOT CODEX'S: Tools/Blender/Realistic/robot.py  (owner: claude, rule Tools/Blender/Realistic/**)
NOT CODEX'S: Tools/Build/Bootstrap-Windows.ps1  (owner: claude, rule Tools/Build/**)
NOT CODEX'S: Tools/Build/Common.ps1  (owner: claude, rule Tools/Build/**)
NOT CODEX'S: Tools/Build/Package-Windows.ps1  (owner: claude, rule Tools/Build/**)
NOT CODEX'S: Tools/Build/Run-Tests.ps1  (owner: claude, rule Tools/Build/**)
NOT CODEX'S: Tools/Unreal/Tech/ue_connection_probe.py  (owner: claude, rule Tools/Unreal/Tech/**)
NOT CODEX'S: Tracking/iron_echo_tracker/app.py  (owner: claude, rule Tracking/**)
NOT CODEX'S: Tracking/iron_echo_tracker/cli.py  (owner: claude, rule Tracking/**)
NOT CODEX'S: Tracking/tests/test_protocol.py  (owner: claude, rule Tracking/**)
```
