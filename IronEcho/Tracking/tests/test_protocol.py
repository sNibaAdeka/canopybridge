import struct
import zlib
from pathlib import Path

import pytest

from iron_echo_tracker import golden
from iron_echo_tracker import protocol as P

GOLDEN_DIR = Path(__file__).resolve().parents[2] / "Tests" / "Golden" / "protocol_v1"


def test_header_layout_is_48_bytes():
    assert P.HEADER_SIZE == 48
    data = P.encode_control(P.Header(sequence=1), P.Control())
    assert len(data) == P.HEADER_SIZE + P.CONTROL_PAYLOAD_SIZE + P.CRC_SIZE
    assert data[:4] == b"IECH"


def test_crc_matches_zlib_known_vector():
    assert zlib.crc32(b"123456789") == 0xCBF43926


def test_pose_roundtrip():
    pose = P.PoseFrame(
        state=P.TrackerState.TRACKING,
        calibration=P.CalibrationState.VALID,
        lean_lateral=-0.5,
        hand_pos=((0.1, 0.2, 0.3), (0.4, 0.5, 0.6)),
        events=[P.TrackerEvent(3, P.Hand.RIGHT, age_us=1000, strength=0.5, confidence=0.75)],
    )
    decoded = P.decode(P.encode_pose(P.Header(session_token=9, tracker_instance=5, sequence=2, capture_time_us=10, send_time_us=20), pose))
    assert decoded.header.sequence == 2 and decoded.header.session_token == 9
    assert decoded.body.lean_lateral == -0.5
    assert decoded.body.events[0].hand == P.Hand.RIGHT
    assert decoded.body.hand_pos[1][2] == pytest.approx(0.6, abs=1e-6)


@pytest.mark.parametrize(
    "mutate,expected",
    [
        (lambda d: d[:10], "TooShort"),
        (lambda d: d[:-1], "SizeMismatch"),
        (lambda d: b"XECH" + d[4:], "BadMagic"),
    ],
)
def test_rejects_malformed(mutate, expected):
    data = P.encode_pose(P.Header(sequence=1), P.PoseFrame())
    decoded, error = P.try_decode(mutate(data))
    assert decoded is None and error == expected


def test_golden_vectors_are_up_to_date(tmp_path):
    """Committed golden files must equal a fresh generation (the C++ test consumes the committed ones)."""
    written = golden.write_vectors(tmp_path)
    assert len(written) >= 7
    for path in written:
        committed = GOLDEN_DIR / path.name
        assert committed.exists(), f"missing {committed}; run: python -m iron_echo_tracker golden --out {GOLDEN_DIR}"
        assert committed.read_bytes() == path.read_bytes(), f"{path.name} differs from the committed golden file"


def test_golden_manifest_expectations_hold_in_python():
    for line in (GOLDEN_DIR / "manifest.txt").read_text().splitlines():
        if not line or line.startswith("#"):
            continue
        name, expected = line.split()[:2]
        _, error = P.try_decode((GOLDEN_DIR / name).read_bytes())
        assert error == expected, name


def test_minor_version_extension_is_accepted():
    data = bytearray(P.encode_pose(P.Header(sequence=1), P.PoseFrame()))[: -P.CRC_SIZE]
    struct.pack_into("<H", data, 6, 3)
    struct.pack_into("<I", data, 12, P.POSE_PAYLOAD_SIZE + 4)
    data += b"\x01\x02\x03\x04"
    data += struct.pack("<I", zlib.crc32(bytes(data)) & 0xFFFFFFFF)
    decoded = P.decode(bytes(data))
    assert decoded.header.schema_minor == 3
