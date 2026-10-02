# IRON ECHO

Оригинальная игра о боксе роботов: игрок управляет роботом своим телом через одну веб-камеру.

Состояние и что проверено — `PROJECT_STATE.md`. Роли: `CLAUDE.md` (техника), `AGENTS.md` (графика, Codex).

## Архитектура

```
Камера ─► IronEchoTracker (отдельный процесс: OpenCV + MediaPipe PoseLandmarker, калибровка, жесты)
        ─► UDP 127.0.0.1, бинарный протокол v1 (Docs/Contracts/LOCAL_PROTOCOL.md)
        ─► Unreal: UIronEchoTrackingSubsystem (процесс + сокет) ─► PacketGate ─► InputFrame
        ─► AIronEchoGameMode ─► IronEchoRules::Match (120 Гц: бойцы, бот, раунды, пауза)
        ─► AIronEchoFighter / AIronEchoPunchingBag (+ AnimBP Codex) и AIronEchoGameState (HUD, события)
```

## Структура

| Путь | Что |
|---|---|
| `Source/IronEchoRules` | правила, протокол, защита пакетов — чистый C++20 (без Unreal) |
| `Source/IronEcho` | интеграция в Unreal: трекинг-подсистема, GameMode, бойцы, груша, AnimInstance, HUD-данные |
| `Tracking/` | процесс трекера (Python 3.12), тесты, spec PyInstaller |
| `Tests/CoreRules`, `Tests/Golden` | тесты ядра (CMake), golden-векторы протокола |
| `Tools/Build` | bootstrap/сборка/тесты/упаковка Windows, владение файлами |
| `Tools/Unreal/Tech` | редакторский Python (пробник) |
| `Docs/Contracts` | INPUT_CONTRACT, LOCAL_PROTOCOL, ROBOT_VISUAL_CONTRACT |
| `Docs/Handoffs` | передачи между Claude и Codex, блокировки |
| `Content/Art`, `ArtSource`, `Tools/Blender` | зона Codex (появятся с его работой) |

## Быстрый старт (Windows)

```powershell
cd IronEcho
powershell -ExecutionPolicy Bypass -File Tools\Build\Bootstrap-Windows.ps1   # всё: замер, venv, модели, тесты, сборка, пробник
# открыть IronEcho.uproject, Play. F3 — теховерлей, F1 — клавиатура (J/K, Space, A/D), F2 — тренировка/бой
powershell -ExecutionPolicy Bypass -File Tools\Build\Package-Windows.ps1     # сборка для игрока (без Python/Editor)
```

## Без Windows (Linux/macOS, разработка ядра и трекера)

```bash
cmake -S Tests/CoreRules -B Build/CoreRulesTests && cmake --build Build/CoreRulesTests && Build/CoreRulesTests/CoreRulesTests
cd Tracking && python3.12 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m iron_echo_tracker fetch-models && .venv/bin/python -m pytest -q
.venv/bin/python -m iron_echo_tracker selftest
```
