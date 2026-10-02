"""Unit tests for the editor-independent robot contract checks (python -m pytest Tests/Tools)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "Tools" / "Unreal" / "Tech"))

import robot_contract as rc  # noqa: E402


def good_robot(**overrides):
    facts = {
        "bones": list(rc.REQUIRED_BONES) + ["ik_hand_root", "jaw"],
        "sockets": list(rc.REQUIRED_SOCKETS),
        "bounds_min": [-30.0, -90.0, 0.0],
        "bounds_max": [30.0, 90.0, 210.0],
        "shoulder_height": 168.0,
        "head_height": 195.0,
        "arm_length": 66.0,
        "torso_half_width": 24.0,
        "fist_l_y": -70.0,
        "fist_r_y": 70.0,
    }
    facts.update(overrides)
    return facts


def codes(findings):
    return {f.code for f in findings}


def test_contract_compliant_robot_passes():
    findings = rc.check_robot(good_robot())
    assert rc.is_ok(findings), rc.format_report("good", findings)
    assert "t-pose" in codes(findings)  # informational only


def test_bone_list_matches_cpp_contract():
    cpp = (Path(__file__).resolve().parents[2] / "Source" / "IronEcho" / "Private" / "IronEchoFighter.cpp").read_text(encoding="utf-8")
    for bone in rc.REQUIRED_BONES:
        assert f'TEXT("{bone}")' in cpp, bone
    for socket in rc.REQUIRED_SOCKETS:
        assert f'TEXT("{socket}")' in cpp, socket


def test_missing_bones_and_sockets_are_errors():
    facts = good_robot(bones=[b for b in rc.REQUIRED_BONES if b != "hand_l"], sockets=["fist_r", "hit_head"])
    findings = rc.check_robot(facts)
    assert not rc.is_ok(findings)
    messages = " ".join(f.message for f in findings)
    assert "hand_l" in messages and "fist_l" in messages
    assert any(f.code == "missing-socket" and f.level == "warning" and "hit_body" in f.message for f in findings)


def test_root_off_floor_and_upside_down():
    findings = rc.check_robot(good_robot(bounds_min=[-30, -90, -105], bounds_max=[30, 90, 105], head_height=40.0, shoulder_height=80.0))
    assert {"root-not-on-floor", "upside-down"} <= codes(findings)


def test_mirrored_sides_detected():
    findings = rc.check_robot(good_robot(fist_l_y=70.0, fist_r_y=-70.0))
    assert "mirrored-sides" in codes(findings) and not rc.is_ok(findings)


def test_scale_warnings_do_not_fail():
    findings = rc.check_robot(good_robot(bounds_max=[30, 90, 400], arm_length=120.0, torso_half_width=50.0))
    assert {"height-range", "arm_length-range", "wide-torso"} <= codes(findings)
    assert rc.is_ok(findings)
