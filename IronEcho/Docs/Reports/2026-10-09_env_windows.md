# Окружение Windows: отчёт bootstrap 2026-10-09T23:31:08

Сгенерировано `Tools/Build/Bootstrap-Windows.ps1`. Пути машины не включены.

| Шаг | Статус | Детали |
|---|---|---|
| hardware | ok | Microsoft Windows 10 Pro 10.0.19045 build 19045 64-bit; 12th Gen Intel(R) Core(TM) i5-12400F (6C/12T); 31.8 GiB RAM |
| gpu NVIDIA GeForce RTX 3050 | ok | VRAM 8192 MiB via nvidia-smi, driver 595.79 |
| camera devices | ok | HD camera  |
| unreal | ok | 5.8.3 at C:\Program Files\Epic Games\UE_5.8 (launcher) |
| visual studio | ok | Visual Studio Build Tools 2022 17.14.37710.0; MSVC 14.44.35207 |
| game development workload | fail | Visual Studio 2022 Game development with C++ workload not found |
| .NET Framework SDK | fail | .NET Framework SDK 4.6+ not found (add .NET Framework 4.8 SDK in Visual Studio Installer) |
| windows sdk | ok | 10.0.22621.0 |
| blender | ok | Blender 5.2.2 LTS at C:\Program Files\Blender Foundation\Blender 5.2\blender.exe |
| python | ok | 3.12.10 at %USERPROFILE%\AppData\Local\Programs\Python\Python312\python.exe |
| git | ok | git version 2.53.0.windows.3 |
| git lfs | ok | git-lfs/3.7.1 (GitHub; windows amd64; go 1.25.1; git b84b3384) |
| local settings | ok | %USERPROFILE%\Documents\Codex\2026-10-09\windows-1-ironecho-canopybridge-claude-wizardly\work\canopybridge-check\IronEcho\Tools\local.settings.json |
| tracker deps | ok | requirements-dev.txt installed |
| models | ok | pose_landmarker lite/full/heavy verified (sha256) |
| opencv cameras | ok | [ WARN:0@0.762] global cap.cpp:477 cv::VideoCapture::open VIDEOIO(DSHOW): backend is generally available but can't be used to capture by index |
| tests | ok | ownership + core rules + tracker |
| engine association | ok | 5.8 |
