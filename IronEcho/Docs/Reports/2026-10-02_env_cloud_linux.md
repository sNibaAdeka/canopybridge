# Окружение сессии 2026-10-02: облачный Linux-контейнер

Это **не** целевой ПК. Здесь нет Windows, Unreal Engine, Blender, GPU и камеры; проверено только то, что указано.

## Фактическое окружение

| Что | Значение |
|---|---|
| ОС | Ubuntu 24.04.4 LTS, x86_64, 4 vCPU, 15 GiB RAM |
| Компиляторы | GCC 13.3.0, Clang 18.1.3, CMake (системный) |
| Python | 3.12 (venv), MediaPipe 1.0.1, NumPy 2.5.3, OpenCV-contrib 5.0.0.93, PyInstaller 6.22.3, pytest 9.1.1 |
| PowerShell | 7.5.3 (только синтаксический разбор скриптов Windows) |
| Unreal / Blender / GPU / камера | **отсутствуют** (`/dev/video*` нет, `nvidia-smi` нет) |
| Исходные спецификации | `robot-boxing-master-prompt.md`, `robot-boxing-team-plan.md` **не найдены** (репозиторий, Google Drive, Gmail) |

## Проверки и результаты

| Проверка | Команда | Результат |
|---|---|---|
| MediaPipe на реальном фото человека (1000×667) | `probe-image` | человек найден; lite 27.9 мс, full 28.2 мс, heavy 69.9 мс на кадр (CPU контейнера) |
| Оси world-координат | там же | левое плечо Y = −0.168, правое Y = +0.159, голова над тазом +0.608 м → `axes_ok` |
| Модели pose_landmarker | `fetch-models` | скачаны, sha256 закреплены в `sources.py` |
| Ядро правил, GCC + ASan/UBSan | `Tests/CoreRules` | 49 тестов, 0 ошибок |
| Ядро правил, Clang 18 Release | то же | 49 тестов, 0 ошибок |
| Ядро под «враждебными» макросами Unreal/Windows | `-include Tests/CoreRules/HostileMacros.h` | компилируется |
| Трекер | `python -m pytest` | 37 тестов, 0 ошибок |
| Golden-векторы Python ↔ C++ | `Protocol_GoldenVectorsFromPython` | 12 файлов, байты совпадают |
| Между процессами: трекер (синтетика) → UDP → C++ ядро → груша | `IronEchoHeadless --mode training` + `simulate --script training` | 420/420 пакетов, 0 отказов, 6 ударов → 6 подтверждённых попаданий, ACK управления получен |
| Упакованный трекер без Python | PyInstaller → `IronEchoTracker selftest` с `env -i` | OK; модель грузится, 14 мс на пустой кадр; размер 439 МБ (Linux) |
| Скрипты PowerShell | `Parser::ParseFile` | 7 скриптов разобраны без ошибок |

Колёса для Windows x64 существуют (PyPI, 2026-10-02): `mediapipe-1.0.1-py3-none-win_amd64`, `numpy-2.5.3-cp312-win_amd64`,
`opencv_contrib_python-5.0.0.93-cp37-abi3-win_amd64`, `pyinstaller-6.22.3-win_amd64`.

## Что не проверено здесь

Компиляция Unreal-модуля, редакторский Python (`ue_connection_probe.py`), реальная камера и человек, задержка на целевом
ПК, VRAM, упаковка игры, сборка трекера под Windows.
