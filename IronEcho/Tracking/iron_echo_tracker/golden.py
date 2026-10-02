"""Golden protocol vectors shared by the Python and C++ implementations.

    python -m iron_echo_tracker golden --out ../Tests/Golden/protocol_v1

The C++ test (Tests/CoreRules/TestProtocol.cpp) decodes every file, checks the manifest fields and
re-encodes valid packets to prove both sides produce identical bytes.
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path
from typing import Dict, List, Tuple

from . import protocol as P


def _fix_crc(data: bytearray) -> bytes:
    body = bytes(data[:-P.CRC_SIZE])
    data[-P.CRC_SIZE :] = struct.pack("<I", zlib.crc32(body) & 0xFFFFFFFF)
    return bytes(data)


def _basic_header(sequence: int) -> P.Header:
    return P.Header(
        session_token=0x12345678,
        tracker_instance=0xABCDEF01,
        sequence=sequence,
        capture_time_us=1_000_000,
        send_time_us=1_012_000,
    )


def _basic_pose() -> P.PoseFrame:
    return P.PoseFrame(
        state=P.TrackerState.TRACKING,
        calibration=P.CalibrationState.VALID,
        confidence=0.875,
        lean_lateral=-0.25,
        lean_forward=0.125,
        block_amount=0.5,
        hand_pos=((0.3125, -0.25, 0.125), (0.375, 0.25, 0.15625)),
        hand_extension=(0.5, 0.4375),
        hand_confidence=(0.9375, 0.875),
        tracker_fps=30.0,
        last_event_id=12,
        events=[
            P.TrackerEvent(event_id=11, hand=P.Hand.LEFT, age_us=33_000, strength=0.75, confidence=0.875),
            P.TrackerEvent(event_id=12, hand=P.Hand.RIGHT, age_us=0, strength=0.5, confidence=0.9375),
        ],
    )


def build_vectors() -> List[Tuple[str, bytes, str, Dict[str, float]]]:
    vectors: List[Tuple[str, bytes, str, Dict[str, float]]] = []

    basic = P.encode_pose(_basic_header(7), _basic_pose())
    vectors.append(
        (
            "pose_basic.bin",
            basic,
            "Ok",
            {
                "type": 1, "seq": 7, "token": 0x12345678, "instance": 0xABCDEF01, "capture_us": 1_000_000,
                "send_us": 1_012_000, "state": 3, "calib": 2, "events": 2, "lean": -0.25, "lean_fwd": 0.125,
                "block": 0.5, "conf": 0.875, "hand_l_x": 0.3125, "hand_r_y": 0.25, "ext_r": 0.4375,
                "last_event": 12, "ev0_id": 11, "ev0_hand": 0, "ev0_age_us": 33000, "ev0_strength": 0.75,
                "ev1_id": 12, "ev1_hand": 1, "clamped": 0,
            },
        )
    )

    no_person = P.PoseFrame(state=P.TrackerState.NO_PERSON, calibration=P.CalibrationState.NONE, tracker_fps=29.5)
    vectors.append(
        ("pose_no_person.bin", P.encode_pose(_basic_header(8), no_person), "Ok", {"state": 2, "calib": 0, "events": 0})
    )

    mirrored = _basic_pose()
    mirrored.flags = P.POSE_FLAG_MIRROR_APPLIED
    mirrored.lean_lateral = 3.0  # outside +-2: receiver clamps
    mirrored.events = []
    vectors.append(
        (
            "pose_mirror_clamped.bin",
            P.encode_pose(_basic_header(9), mirrored),
            "Ok",
            {"flags": 1, "lean": 2.0, "clamped": 1, "events": 0},
        )
    )

    status = P.Status(
        state=P.TrackerState.TRACKING,
        calibration=P.CalibrationState.IN_PROGRESS,
        step=P.CalibrationStep.SLIP_LEFT,
        progress=40,
        camera_index=0,
        camera_fps=30.0,
        inference_ms=12.5,
        pipeline_latency_ms=21.25,
        camera_width=640,
        camera_height=480,
        model_name="pose_landmarker_full",
    )
    vectors.append(
        (
            "status_calibrating.bin",
            P.encode_status(_basic_header(10), status),
            "Ok",
            {"type": 2, "status_step": 3, "status_progress": 40, "status_fps": 30.0, "status_width": 640},
        )
    )

    control = P.Control(command=P.ControlCommand.START_CALIBRATION_FULL, arg=0, command_id=99)
    vectors.append(
        (
            "control_calibrate.bin",
            P.encode_control(_basic_header(1), control),
            "Ok",
            {"type": 16, "control_cmd": 2, "control_arg": 0, "control_id": 99},
        )
    )

    ack = P.ControlAck(command=P.ControlCommand.START_CALIBRATION_FULL, result=P.AckResult.OK, command_id=99)
    vectors.append(
        ("ack_ok.bin", P.encode_ack(_basic_header(11), ack), "Ok", {"type": 17, "ack_cmd": 2, "ack_result": 0, "ack_id": 99})
    )

    # Minor version 1 with 8 extra payload bytes: a 1.0 receiver accepts and ignores them.
    extra = bytearray(basic[: -P.CRC_SIZE])
    struct.pack_into("<H", extra, 6, 1)
    struct.pack_into("<I", extra, 12, P.POSE_PAYLOAD_SIZE + 8)
    extra += b"\xee" * 8 + b"\x00" * P.CRC_SIZE
    vectors.append(("pose_minor1_extra.bin", _fix_crc(extra), "Ok", {"minor": 1, "events": 2, "ev1_id": 12}))

    bad_crc = bytearray(basic)
    bad_crc[60] ^= 0x01
    vectors.append(("bad_crc.bin", bytes(bad_crc), "BadCrc", {}))

    bad_major = bytearray(basic)
    struct.pack_into("<H", bad_major, 4, 2)
    vectors.append(("bad_major.bin", _fix_crc(bad_major), "UnsupportedMajor", {}))

    vectors.append(("truncated.bin", basic[:-1], "SizeMismatch", {}))

    nan = bytearray(basic)
    struct.pack_into("<f", nan, P.HEADER_SIZE + 8, float("nan"))
    vectors.append(("pose_nan.bin", _fix_crc(nan), "NonFinite", {}))

    too_many = bytearray(basic)
    too_many[P.HEADER_SIZE + 3] = 5
    vectors.append(("too_many_events.bin", _fix_crc(too_many), "TooManyEvents", {}))

    return vectors


def _fmt(value: float) -> str:
    if float(value).is_integer():
        return str(int(value))
    return repr(float(value))


def write_vectors(out_dir: Path) -> List[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    lines = [
        "# IRON ECHO protocol v1 golden vectors. Generated by: python -m iron_echo_tracker golden",
        "# <file> <expected DecodeError name> [field=value ...]",
    ]
    written: List[Path] = []
    for name, data, expected, fields in build_vectors():
        path = out_dir / name
        path.write_bytes(data)
        written.append(path)
        lines.append(" ".join([name, expected] + [f"{key}={_fmt(value)}" for key, value in fields.items()]))
    manifest = out_dir / "manifest.txt"
    manifest.write_text("\n".join(lines) + "\n", encoding="ascii", newline="\n")
    written.append(manifest)
    return written
