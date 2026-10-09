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
