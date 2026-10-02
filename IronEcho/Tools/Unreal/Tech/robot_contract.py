"""ROBOT_VISUAL_CONTRACT v1 checks as pure Python (no `unreal` import), so they are unit-tested outside the editor.

validate_robot.py (editor) collects facts about a skeletal mesh and passes them here.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional

CONTRACT_VERSION = 1

REQUIRED_BONES = (
    "root", "pelvis", "spine_01", "spine_02", "spine_03", "neck_01", "head",
    "clavicle_l", "upperarm_l", "lowerarm_l", "hand_l",
    "clavicle_r", "upperarm_r", "lowerarm_r", "hand_r",
    "thigh_l", "calf_l", "foot_l", "thigh_r", "calf_r", "foot_r",
)
REQUIRED_SOCKETS = ("fist_l", "fist_r", "hit_head", "hit_body")

# (min, max) in cm, ROBOT_VISUAL_CONTRACT §3
HEIGHT_RANGE = (190.0, 230.0)
SHOULDER_RANGE = (155.0, 185.0)
ARM_RANGE = (55.0, 80.0)
MAX_BODY_RADIUS = 35.0  # half depth/width of the torso so robots never overlap at 100 cm


@dataclass
class Finding:
    level: str  # error | warning | info
    code: str
    message: str


def check_robot(facts: Dict) -> List[Finding]:
    """facts: bones (list[str]), sockets (list[str]), bounds_min/bounds_max ([x,y,z] cm, component space),
    optional: shoulder_height, head_height, arm_length (cm), torso_half_width (cm)."""
    findings: List[Finding] = []
    bones = set(facts.get("bones") or [])
    sockets = set(facts.get("sockets") or [])

    if not bones:
        findings.append(Finding("error", "no-bones", "bone list unavailable or empty"))
    for bone in REQUIRED_BONES:
        if bones and bone not in bones:
            findings.append(Finding("error", "missing-bone", f"missing bone '{bone}'"))
    for socket in REQUIRED_SOCKETS:
        if socket not in sockets:
            level = "warning" if socket == "hit_body" else "error"
            findings.append(Finding(level, "missing-socket", f"missing socket '{socket}'"))

    lo = facts.get("bounds_min")
    hi = facts.get("bounds_max")
    if lo and hi:
        height = hi[2] - lo[2]
        _range(findings, "height", height, HEIGHT_RANGE, "warning")
        if abs(lo[2]) > 5.0:
            findings.append(Finding("error", "root-not-on-floor", f"mesh bottom at z={lo[2]:.1f} cm; root must sit on the floor (z=0)"))
        depth_x = max(abs(lo[0]), abs(hi[0]))
        if depth_x > MAX_BODY_RADIUS + 60.0:  # arms in ref pose may stick out forward; only flag gross violations
            findings.append(Finding("warning", "deep-mesh", f"mesh extends {depth_x:.0f} cm along X; check facing +X and ref pose"))
        if (hi[1] - lo[1]) > 1.5 * (hi[0] - lo[0]) and (hi[1] - lo[1]) > 150.0:
            findings.append(Finding("info", "t-pose", "wide along Y: T/A-pose reference is fine; facing must still be +X"))
    else:
        findings.append(Finding("warning", "no-bounds", "bounds unavailable"))

    _optional_range(findings, facts, "shoulder_height", SHOULDER_RANGE)
    _optional_range(findings, facts, "arm_length", ARM_RANGE)
    head = facts.get("head_height")
    shoulder = facts.get("shoulder_height")
    if head is not None and shoulder is not None and head <= shoulder:
        findings.append(Finding("error", "upside-down", "head is not above shoulders: check Z-up and import rotation"))
    half_width = facts.get("torso_half_width")
    if half_width is not None and half_width > MAX_BODY_RADIUS:
        findings.append(Finding("warning", "wide-torso", f"torso half width {half_width:.0f} cm > {MAX_BODY_RADIUS:.0f} cm"))
    fist_l = facts.get("fist_l_y")
    fist_r = facts.get("fist_r_y")
    if fist_l is not None and fist_r is not None and fist_l >= fist_r:
        findings.append(Finding("error", "mirrored-sides", "fist_l is not on -Y relative to fist_r: left/right swapped or mesh not facing +X"))
    return findings


def _range(findings: List[Finding], name: str, value: float, bounds, level: str) -> None:
    if not (bounds[0] <= value <= bounds[1]):
        findings.append(Finding(level, f"{name}-range", f"{name} {value:.0f} cm outside {bounds[0]:.0f}-{bounds[1]:.0f} cm"))


def _optional_range(findings: List[Finding], facts: Dict, key: str, bounds) -> None:
    value: Optional[float] = facts.get(key)
    if value is not None:
        _range(findings, key, float(value), bounds, "warning")


def is_ok(findings: Iterable[Finding]) -> bool:
    return not any(f.level == "error" for f in findings)


def format_report(name: str, findings: List[Finding]) -> str:
    lines = [f"Robot '{name}' vs ROBOT_VISUAL_CONTRACT v{CONTRACT_VERSION}: {'OK' if is_ok(findings) else 'FAIL'}"]
    for f in findings:
        lines.append(f"  [{f.level.upper()}] {f.code}: {f.message}")
    return "\n".join(lines)
