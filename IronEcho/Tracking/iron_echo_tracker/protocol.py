"""Wire protocol v1.x. Byte-for-byte twin of Source/IronEchoRules/Private/Protocol.cpp.

Normative description: Docs/Contracts/LOCAL_PROTOCOL.md. Little-endian, fixed layouts, CRC-32 (zlib) trailer.
"""

from __future__ import annotations

import enum
import math
import struct
import zlib
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

MAGIC = 0x48434549  # b"IECH"
SCHEMA_MAJOR = 1
SCHEMA_MINOR = 0
HEADER_SIZE = 48
CRC_SIZE = 4
MAX_DATAGRAM = 1200
MAX_EVENTS = 4

POSE_PAYLOAD_SIZE = 152
STATUS_PAYLOAD_SIZE = 48
CONTROL_PAYLOAD_SIZE = 8
ACK_PAYLOAD_SIZE = 8
MODEL_NAME_SIZE = 24

POSE_FLAG_MIRROR_APPLIED = 1 << 0

_HEADER = struct.Struct("<IHHHHIIIII QQ".replace(" ", ""))
assert _HEADER.size == HEADER_SIZE


class PacketType(enum.IntEnum):
    POSE_FRAME = 1
    STATUS = 2
    CONTROL = 16
    CONTROL_ACK = 17


class TrackerState(enum.IntEnum):
    STARTING = 0
    NO_CAMERA = 1
    NO_PERSON = 2
    TRACKING = 3
    LOW_CONFIDENCE = 4


class CalibrationState(enum.IntEnum):
    NONE = 0
    IN_PROGRESS = 1
    VALID = 2
    FAILED = 3


class CalibrationStep(enum.IntEnum):
    IDLE = 0
    NEUTRAL = 1
    RAISE_RIGHT_HAND = 2
    SLIP_LEFT = 3
    SLIP_RIGHT = 4
    DONE = 5


class CalibrationFailure(enum.IntEnum):
    NO_FAILURE = 0
    TIMEOUT = 1
    LOW_VISIBILITY = 2
    UNSTABLE = 3
    CANCELLED = 4


class TrackerError(enum.IntEnum):
    NO_ERROR = 0
    CAMERA_OPEN_FAILED = 1
    MODEL_LOAD_FAILED = 2
    CAMERA_READ_FAILED = 3


class EventType(enum.IntEnum):
    PUNCH_START = 1


class Hand(enum.IntEnum):
    LEFT = 0
    RIGHT = 1


class ControlCommand(enum.IntEnum):
    PING = 1
    START_CALIBRATION_FULL = 2
    START_CALIBRATION_QUICK = 3
    CANCEL_CALIBRATION = 4
    SHUTDOWN = 5
    SET_PREVIEW = 6


class AckResult(enum.IntEnum):
    OK = 0
    REJECTED = 1
    UNSUPPORTED = 2


class DecodeError(Exception):
    """Raised with the same names as IronEchoCore::Protocol::DecodeError."""

    def __init__(self, name: str):
        super().__init__(name)
        self.name = name


@dataclass
class Header:
    session_token: int = 0
    tracker_instance: int = 0
    sequence: int = 0
    capture_time_us: int = 0
    send_time_us: int = 0
    flags: int = 0
    schema_major: int = SCHEMA_MAJOR
    schema_minor: int = SCHEMA_MINOR
    packet_type: PacketType = PacketType.POSE_FRAME
    payload_size: int = 0


@dataclass
class TrackerEvent:
    event_id: int
    hand: Hand
    age_us: int = 0
    strength: float = 0.0
    confidence: float = 0.0
    event_type: EventType = EventType.PUNCH_START


Vec3 = Tuple[float, float, float]


@dataclass
class PoseFrame:
    state: TrackerState = TrackerState.STARTING
    calibration: CalibrationState = CalibrationState.NONE
    flags: int = 0
    confidence: float = 0.0
    lean_lateral: float = 0.0
    lean_forward: float = 0.0
    crouch: float = 0.0
    block_amount: float = 0.0
    hand_pos: Tuple[Vec3, Vec3] = ((0.0, 0.0, 0.0), (0.0, 0.0, 0.0))
    hand_extension: Tuple[float, float] = (0.0, 0.0)
    hand_confidence: Tuple[float, float] = (0.0, 0.0)
    tracker_fps: float = 0.0
    last_event_id: int = 0
    events: List[TrackerEvent] = field(default_factory=list)


@dataclass
class Status:
    state: TrackerState = TrackerState.STARTING
    calibration: CalibrationState = CalibrationState.NONE
    step: CalibrationStep = CalibrationStep.IDLE
    progress: int = 0
    failure: CalibrationFailure = CalibrationFailure.NO_FAILURE
    mirror_applied: bool = False
    camera_index: int = 255
    last_error: TrackerError = TrackerError.NO_ERROR
    camera_fps: float = 0.0
    inference_ms: float = 0.0
    pipeline_latency_ms: float = 0.0
    camera_width: int = 0
    camera_height: int = 0
    model_name: str = ""


@dataclass
class Control:
    command: ControlCommand = ControlCommand.PING
    arg: int = 0
    command_id: int = 0


@dataclass
class ControlAck:
    command: ControlCommand = ControlCommand.PING
    result: AckResult = AckResult.OK
    command_id: int = 0


@dataclass
class Decoded:
    header: Header
    body: object
    values_clamped: bool = False


# --------------------------------------------------------------------------- encode


def _f32(value: float) -> float:
    """Round-trip through float32 so Python and C++ agree on the bytes."""
    return struct.unpack("<f", struct.pack("<f", float(value)))[0]


def _frame(header: Header, packet_type: PacketType, payload: bytes) -> bytes:
    header.packet_type = packet_type
    header.payload_size = len(payload)
    head = _HEADER.pack(
        MAGIC,
        header.schema_major,
        header.schema_minor,
        int(packet_type),
        HEADER_SIZE,
        len(payload),
        header.session_token & 0xFFFFFFFF,
        header.tracker_instance & 0xFFFFFFFF,
        header.sequence & 0xFFFFFFFF,
        header.flags & 0xFFFFFFFF,
        header.capture_time_us & 0xFFFFFFFFFFFFFFFF,
        header.send_time_us & 0xFFFFFFFFFFFFFFFF,
    )
    body = head + payload
    data = body + struct.pack("<I", zlib.crc32(body) & 0xFFFFFFFF)
    if len(data) > MAX_DATAGRAM:
        raise ValueError("datagram too large")
    return data


def encode_pose(header: Header, pose: PoseFrame) -> bytes:
    events = pose.events[:MAX_EVENTS]
    payload = bytearray(POSE_PAYLOAD_SIZE)
    struct.pack_into("<BBBB", payload, 0, int(pose.state), int(pose.calibration), pose.flags & 0xFF, len(events))
    struct.pack_into(
        "<fffff", payload, 4, pose.confidence, pose.lean_lateral, pose.lean_forward, pose.crouch, pose.block_amount
    )
    for side in range(2):
        struct.pack_into("<fff", payload, 24 + side * 12, *pose.hand_pos[side])
    struct.pack_into("<ff", payload, 48, *pose.hand_extension)
    struct.pack_into("<ff", payload, 56, *pose.hand_confidence)
    struct.pack_into("<fI", payload, 64, pose.tracker_fps, pose.last_event_id & 0xFFFFFFFF)
    for index, event in enumerate(events):
        struct.pack_into(
            "<IBBHIff",
            payload,
            72 + index * 20,
            event.event_id & 0xFFFFFFFF,
            int(event.event_type),
            int(event.hand),
            0,
            max(0, min(int(event.age_us), 0xFFFFFFFF)),
            event.strength,
            event.confidence,
        )
    return _frame(header, PacketType.POSE_FRAME, bytes(payload))


def encode_status(header: Header, status: Status) -> bytes:
    payload = bytearray(STATUS_PAYLOAD_SIZE)
    struct.pack_into(
        "<BBBBBBBB",
        payload,
        0,
        int(status.state),
        int(status.calibration),
        int(status.step),
        max(0, min(100, int(status.progress))),
        int(status.failure),
        1 if status.mirror_applied else 0,
        status.camera_index & 0xFF,
        int(status.last_error),
    )
    struct.pack_into("<fff", payload, 8, status.camera_fps, status.inference_ms, status.pipeline_latency_ms)
    struct.pack_into("<HH", payload, 20, status.camera_width & 0xFFFF, status.camera_height & 0xFFFF)
    name = status.model_name.encode("ascii", "replace")[: MODEL_NAME_SIZE - 1]
    payload[24 : 24 + len(name)] = name
    return _frame(header, PacketType.STATUS, bytes(payload))


def encode_control(header: Header, control: Control) -> bytes:
    payload = struct.pack("<BBHI", int(control.command), control.arg & 0xFF, 0, control.command_id & 0xFFFFFFFF)
    return _frame(header, PacketType.CONTROL, payload)


def encode_ack(header: Header, ack: ControlAck) -> bytes:
    payload = struct.pack("<BBHI", int(ack.command), int(ack.result), 0, ack.command_id & 0xFFFFFFFF)
    return _frame(header, PacketType.CONTROL_ACK, payload)


# --------------------------------------------------------------------------- decode


class _Floats:
    def __init__(self, data: bytes):
        self.data = data
        self.non_finite = False
        self.clamped = False

    def read(self, offset: int, lo: float, hi: float) -> float:
        (value,) = struct.unpack_from("<f", self.data, offset)
        if not math.isfinite(value):
            self.non_finite = True
            return 0.0
        if value < lo:
            self.clamped = True
            return lo
        if value > hi:
            self.clamped = True
            return hi
        return value


def _enum(enum_type, raw: int):
    try:
        return enum_type(raw)
    except ValueError:
        raise DecodeError("BadEnum") from None


def decode(data: bytes) -> Decoded:
    if len(data) < HEADER_SIZE + CRC_SIZE:
        raise DecodeError("TooShort")
    if len(data) > MAX_DATAGRAM:
        raise DecodeError("TooLong")
    fields = _HEADER.unpack_from(data, 0)
    magic, major, minor, type_raw, header_size, payload_size = fields[:6]
    if magic != MAGIC:
        raise DecodeError("BadMagic")
    if major != SCHEMA_MAJOR:
        raise DecodeError("UnsupportedMajor")
    if header_size != HEADER_SIZE:
        raise DecodeError("BadHeaderSize")
    if HEADER_SIZE + payload_size + CRC_SIZE != len(data):
        raise DecodeError("SizeMismatch")
    (crc,) = struct.unpack_from("<I", data, HEADER_SIZE + payload_size)
    if zlib.crc32(data[: HEADER_SIZE + payload_size]) & 0xFFFFFFFF != crc:
        raise DecodeError("BadCrc")
    header = Header(
        session_token=fields[6],
        tracker_instance=fields[7],
        sequence=fields[8],
        flags=fields[9],
        capture_time_us=fields[10],
        send_time_us=fields[11],
        schema_major=major,
        schema_minor=minor,
        payload_size=payload_size,
    )
    payload = data[HEADER_SIZE : HEADER_SIZE + payload_size]
    if type_raw == PacketType.POSE_FRAME:
        header.packet_type = PacketType.POSE_FRAME
        body, clamped = _decode_pose(payload)
    elif type_raw == PacketType.STATUS:
        header.packet_type = PacketType.STATUS
        body, clamped = _decode_status(payload)
    elif type_raw == PacketType.CONTROL:
        header.packet_type = PacketType.CONTROL
        body, clamped = _decode_control(payload), False
    elif type_raw == PacketType.CONTROL_ACK:
        header.packet_type = PacketType.CONTROL_ACK
        body, clamped = _decode_ack(payload), False
    else:
        raise DecodeError("UnknownType")
    return Decoded(header=header, body=body, values_clamped=clamped)


def _decode_pose(p: bytes) -> Tuple[PoseFrame, bool]:
    if len(p) < POSE_PAYLOAD_SIZE:
        raise DecodeError("PayloadTooSmall")
    state_raw, calib_raw, flags, count = struct.unpack_from("<BBBB", p, 0)
    if state_raw > TrackerState.LOW_CONFIDENCE or calib_raw > CalibrationState.FAILED:
        raise DecodeError("BadEnum")
    if count > MAX_EVENTS:
        raise DecodeError("TooManyEvents")
    f = _Floats(p)
    pose = PoseFrame(state=TrackerState(state_raw), calibration=CalibrationState(calib_raw), flags=flags)
    pose.confidence = f.read(4, 0.0, 1.0)
    pose.lean_lateral = f.read(8, -2.0, 2.0)
    pose.lean_forward = f.read(12, -2.0, 2.0)
    pose.crouch = f.read(16, 0.0, 1.0)
    pose.block_amount = f.read(20, 0.0, 1.0)
    hands = []
    for side in range(2):
        base = 24 + side * 12
        hands.append((f.read(base, -3.0, 3.0), f.read(base + 4, -3.0, 3.0), f.read(base + 8, -3.0, 3.0)))
    pose.hand_pos = (hands[0], hands[1])
    pose.hand_extension = (f.read(48, 0.0, 2.0), f.read(52, 0.0, 2.0))
    pose.hand_confidence = (f.read(56, 0.0, 1.0), f.read(60, 0.0, 1.0))
    pose.tracker_fps = f.read(64, 0.0, 1000.0)
    (pose.last_event_id,) = struct.unpack_from("<I", p, 68)
    for index in range(count):
        base = 72 + index * 20
        event_id, type_raw, hand_raw, _reserved, age_us = struct.unpack_from("<IBBHI", p, base)
        if type_raw != EventType.PUNCH_START or hand_raw > 1 or event_id == 0:
            raise DecodeError("BadEnum")
        pose.events.append(
            TrackerEvent(
                event_id=event_id,
                hand=Hand(hand_raw),
                age_us=age_us,
                strength=f.read(base + 12, 0.0, 1.0),
                confidence=f.read(base + 16, 0.0, 1.0),
            )
        )
    if f.non_finite:
        raise DecodeError("NonFinite")
    return pose, f.clamped


def _decode_status(p: bytes) -> Tuple[Status, bool]:
    if len(p) < STATUS_PAYLOAD_SIZE:
        raise DecodeError("PayloadTooSmall")
    raw = struct.unpack_from("<BBBBBBBB", p, 0)
    status = Status(
        state=_enum(TrackerState, raw[0]),
        calibration=_enum(CalibrationState, raw[1]),
        step=_enum(CalibrationStep, raw[2]),
        progress=min(100, raw[3]),
        failure=_enum(CalibrationFailure, raw[4]),
        mirror_applied=raw[5] != 0,
        camera_index=raw[6],
        last_error=_enum(TrackerError, raw[7]),
    )
    f = _Floats(p)
    status.camera_fps = f.read(8, 0.0, 1000.0)
    status.inference_ms = f.read(12, 0.0, 10000.0)
    status.pipeline_latency_ms = f.read(16, 0.0, 10000.0)
    if f.non_finite:
        raise DecodeError("NonFinite")
    status.camera_width, status.camera_height = struct.unpack_from("<HH", p, 20)
    name = bytes(p[24 : 24 + MODEL_NAME_SIZE])
    out = []
    for byte in name[: MODEL_NAME_SIZE - 1]:
        if byte < 0x20 or byte >= 0x7F:
            break
        out.append(chr(byte))
    status.model_name = "".join(out)
    return status, f.clamped or raw[3] > 100


def _decode_control(p: bytes) -> Control:
    if len(p) < CONTROL_PAYLOAD_SIZE:
        raise DecodeError("PayloadTooSmall")
    command, arg, _reserved, command_id = struct.unpack_from("<BBHI", p, 0)
    return Control(command=_enum(ControlCommand, command), arg=arg, command_id=command_id)


def _decode_ack(p: bytes) -> ControlAck:
    if len(p) < ACK_PAYLOAD_SIZE:
        raise DecodeError("PayloadTooSmall")
    command, result, _reserved, command_id = struct.unpack_from("<BBHI", p, 0)
    return ControlAck(command=_enum(ControlCommand, command), result=_enum(AckResult, result), command_id=command_id)


def try_decode(data: bytes) -> Tuple[Optional[Decoded], str]:
    try:
        return decode(data), "Ok"
    except DecodeError as error:
        return None, error.name


__all__ = [name for name in dir() if not name.startswith("_")] + ["_f32"]
