# LOCAL_PROTOCOL — трекер ↔ игра

| | |
|---|---|
| Версия схемы | **1.0** (`kSchemaMajor = 1`, `kSchemaMinor = 0`) |
| Владелец | Claude |
| Реализации | C++ `Source/IronEchoRules/{Public/IronEchoRules/Protocol.h,Private/Protocol.cpp,PacketGate.*}`; Python `Tracking/iron_echo_tracker/protocol.py`, `net.py` |
| Совместимость | golden-векторы `Tests/Golden/protocol_v1` читают оба набора тестов; C++ перекодирует и сверяет байты с Python |

## 1. Транспорт

- UDP только на `127.0.0.1`. Игра слушает `GameListenPort` (47810), трекер — `TrackerControlPort` (47811).
  Если порт занят, игра пробует +1…+9 и передаёт выбранные порты трекеру в аргументах.
- Один датаграмм = один пакет ≤ 1200 байт. Little-endian, без выравнивания, CRC-32 (IEEE, как `zlib.crc32`) в конце.
- Игра запускает трекер сама: `run --camera N --model full --game-port P --control-port C --token T --parent-pid PID --managed --log-dir ...`.
  Трекер завершается, если родительский процесс умер или 10 с нет Ping (`--managed`).
- `SessionToken` — случайное ненулевое число на запуск игры. Токен 0 (принимать любой) — только в не-Shipping
  сборках при ручном запуске трекера (режим External).

## 2. Заголовок (48 байт)

| Смещ. | Тип | Поле | Примечание |
|---|---|---|---|
| 0 | u32 | magic | `0x48434549` = байты `IECH` |
| 4 | u16 | schema_major | 1 |
| 6 | u16 | schema_minor | 0 |
| 8 | u16 | packet_type | 1 PoseFrame, 2 Status, 16 Control, 17 ControlAck |
| 10 | u16 | header_size | 48 |
| 12 | u32 | payload_size | |
| 16 | u32 | session_token | |
| 20 | u32 | tracker_instance | случайный на запуск трекера |
| 24 | u32 | sequence | общий счётчик отправителя, с 1, строго растёт |
| 28 | u32 | flags | 0 |
| 32 | u64 | capture_time_us | монотонные часы отправителя (захват кадра) |
| 40 | u64 | send_time_us | монотонные часы отправителя (отправка) |
| 48+N | u32 | crc32 | от байтов [0, 48+N) |

## 3. Полезные нагрузки

**PoseFrame (152 байта)** — на каждый обработанный кадр камеры (это же heartbeat):

| Смещ. | Тип | Поле |
|---|---|---|
| 0 | u8 | tracker_state: 0 Starting, 1 NoCamera, 2 NoPerson, 3 Tracking, 4 LowConfidence |
| 1 | u8 | calibration: 0 None, 1 InProgress, 2 Valid, 3 Failed |
| 2 | u8 | flags: bit0 MirrorApplied |
| 3 | u8 | event_count 0..4 |
| 4 | f32 | confidence 0..1 |
| 8 | f32 | lean_lateral (клип ±2) |
| 12 | f32 | lean_forward (клип ±2) |
| 16 | f32 | crouch (резерв, 0) |
| 20 | f32 | block_amount 0..1 |
| 24 / 36 | 3×f32 | hand_l / hand_r, AL, body frame (клип ±3) |
| 48 / 52 | f32 | extension_l / _r 0..2 |
| 56 / 60 | f32 | hand_conf_l / _r 0..1 |
| 64 | f32 | tracker_fps |
| 68 | u32 | last_event_id |
| 72 + 20·i | event | `u32 event_id (≥1, растёт)`, `u8 type (1 PunchStart)`, `u8 hand (0 L, 1 R)`, `u16 0`, `u32 age_us`, `f32 strength`, `f32 confidence` |

Каждое событие повторяется в пакетах 0.2 с (до 4 последних): потеря одного датаграмма не теряет удар.
`age_us` = `capture_time_us` пакета − время захвата кадра, в котором удар распознан. Неиспользуемые слоты — нули.

**Status (48 байт)**, ~2 Гц: `u8 state, u8 calibration, u8 step (0 Idle,1 Neutral,2 RaiseRightHand,3 SlipLeft,4 SlipRight,5 Done),
u8 progress 0..100, u8 failure (0 None,1 Timeout,2 LowVisibility,3 Unstable,4 Cancelled), u8 mirror, u8 camera_index (255 нет),
u8 last_error (0 None,1 CameraOpenFailed,2 ModelLoadFailed,3 CameraReadFailed)`, `f32 camera_fps, f32 inference_ms, f32 pipeline_latency_ms`,
`u16 width, u16 height`, `char[24] model_name` (ASCII, нули в конце).

**Control (8 байт)**, игра → трекер: `u8 command (1 Ping, 2 StartCalibrationFull, 3 StartCalibrationQuick, 4 CancelCalibration, 5 Shutdown, 6 SetPreview)`,
`u8 arg (SetPreview: 0/1)`, `u16 0`, `u32 command_id`.

**ControlAck (8 байт)**, трекер → игра: `u8 command, u8 result (0 Ok, 1 Rejected, 2 Unsupported), u16 0, u32 command_id`.

## 4. Декодирование (обе стороны одинаково)

Отказ с именем ошибки: `TooShort`, `TooLong`, `BadMagic`, `UnsupportedMajor`, `BadHeaderSize`, `SizeMismatch`
(длина ≠ 48+N+4), `BadCrc`, `UnknownType`, `PayloadTooSmall`, `BadEnum`, `NonFinite` (NaN/Inf), `TooManyEvents`.
Конечные значения вне диапазона **зажимаются** и помечаются `bValuesClamped`. Никаких чтений за границами
(фаззинг 50 000 мутаций под ASan/UBSan).

## 5. Приёмник (PacketGate)

| Правило | Вердикт |
|---|---|
| packet_type = Control | `NotTrackerPacket` |
| ожидается токен и он не совпал | `WrongSession` |
| send < capture | `ClockRegression` |
| send − capture > 0.25 с | `StalePipeline` |
| другой tracker_instance, тишина от текущего < 0.5 с | `ConflictingInstance`; иначе — перепривязка (перезапуск трекера), сброс счётчиков |
| sequence ≤ последнего | `DuplicateOrOld` |
| capture_time меньше последнего | `ClockRegression` |
| пропуск sequence | принимается, `LostPackets += gap` |

Живость: последний принятый пакет ≤ 0.35 с назад, иначе статус `Offline`. События: дубликаты по `event_id`
отбрасываются; событие старше 0.25 с (возраст в кадре + конвейер + ожидание в игре) не исполняется (`EventsStale`).
Время приёма — `FPlatformTime::Seconds()` игры; часы процессов не сравниваются напрямую.

## 6. Управление

Команда повторяется каждые 0.25 с до ACK (сдаётся через 3 с): датаграмм, отправленный до старта трекера, теряется —
проверено сквозным тестом. Ping — раз в секунду, без ожидания ACK. Shutdown при выходе: ждём 0.5 с, затем
принудительно завершаем процесс. Упавший трекер перезапускается до 3 раз (пауза 2/4/6 с).

## 7. Версии

- Добавление полей в конец payload — MINOR: старый приёмник принимает `payload_size ≥` своего размера и игнорирует хвост
  (тест `pose_minor1_extra.bin`). Новый тип пакета — MINOR (старый вернёт `UnknownType`).
- Иное (смещения, смысл, единицы, заголовок) — MAJOR, старый приёмник отвергнет (`UnsupportedMajor`).
- Любое изменение: C++ + Python + `python -m iron_echo_tracker golden --out ../Tests/Golden/protocol_v1` + оба набора тестов + журнал.

## Журнал

| Версия | Дата | Изменение |
|---|---|---|
| 1.0 | 2026-10-02 | Первая версия |
