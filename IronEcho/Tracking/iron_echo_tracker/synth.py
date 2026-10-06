"""Synthetic MediaPipe-like pose streams for tests and for driving the game without a camera.

This is a kinematic stick model with noise, NOT a substitute for real camera trials: thresholds tuned on it
must be re-validated on recordings of a real person (Docs/Testing/HUMAN_TRIALS.md).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Callable, Iterator, List, Optional, Tuple

import numpy as np

from . import body as B
from .body import PoseSample

UPPER_ARM = 0.30
FOREARM = 0.27
SHOULDER_Z = 0.50
HEAD_Z = 0.66

# Wrist targets relative to the shoulder in the body frame: (forward, inward, up). inward = toward the midline.
POSES = {
    "guard": (0.24, 0.07, 0.16),
    "punch": (0.54, 0.06, 0.06),
    "block": (0.17, 0.12, 0.30),
    "down": (0.05, 0.0, -0.50),
    "raise": (0.05, -0.05, 0.52),
}


def _smooth(x: float) -> float:
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


@dataclass
class Segment:
    start: float
    end: float
    kind: str  # punch | block | slip | raise | down | hide | lean_fwd | kick
    side: int = 0  # arm side or slip direction (-1 left / +1 right stored in amount sign)
    amount: float = 0.0

    def weight(self, t: float, ramp: float = 0.15) -> float:
        if t < self.start or t > self.end:
            return 0.0
        rise = _smooth((t - self.start) / ramp) if ramp > 0 else 1.0
        fall = _smooth((self.end - t) / ramp) if ramp > 0 else 1.0
        return min(rise, fall)


@dataclass
class Script:
    segments: List[Segment] = field(default_factory=list)
    duration: float = 0.0

    def _extend(self, end: float) -> None:
        self.duration = max(self.duration, end)

    def idle(self, start: float, seconds: float) -> "Script":
        self._extend(start + seconds)
        return self

    def punch(self, start: float, side: int, extend_time: float = 0.16, hold: float = 0.06, retract: float = 0.22) -> "Script":
        self.segments.append(Segment(start, start + extend_time + hold + retract, "punch", side, extend_time))
        self._extend(start + extend_time + hold + retract)
        return self

    def block(self, start: float, seconds: float) -> "Script":
        self.segments.append(Segment(start, start + seconds, "block"))
        self._extend(start + seconds)
        return self

    def slip(self, start: float, seconds: float, metres: float) -> "Script":
        """metres < 0 slips to the player's left, > 0 to the right."""
        self.segments.append(Segment(start, start + seconds, "slip", amount=metres))
        self._extend(start + seconds)
        return self

    def raise_hand(self, start: float, seconds: float, side: int) -> "Script":
        self.segments.append(Segment(start, start + seconds, "raise", side))
        self._extend(start + seconds)
        return self

    def hands_down(self, start: float, seconds: float) -> "Script":
        self.segments.append(Segment(start, start + seconds, "down"))
        self._extend(start + seconds)
        return self

    def hide(self, start: float, seconds: float) -> "Script":
        """Person leaves the frame (no detection)."""
        self.segments.append(Segment(start, start + seconds, "hide"))
        self._extend(start + seconds)
        return self

    def kick(self, start: float, side: int, peak: float = 0.55, up: float = 0.16, hold: float = 0.08, down: float = 0.26) -> "Script":
        """A leg kick: the ankle of `side` (0 left, 1 right) rises by `peak` metres and comes back."""
        self.segments.append(Segment(start, start + up + hold + down, "kick", side, amount=peak))
        self._extend(start + up + hold + down)
        return self

    def lean_forward(self, start: float, seconds: float, metres: float) -> "Script":
        self.segments.append(Segment(start, start + seconds, "lean_fwd", amount=metres))
        self._extend(start + seconds)
        return self


def _punch_extension(seg: Segment, t: float) -> float:
    extend = seg.amount
    retract = 0.22
    total = seg.end - seg.start
    local = t - seg.start
    if local < 0 or local > total:
        return 0.0
    if local < extend:
        return _smooth(local / extend)
    if local < total - retract:
        return 1.0
    return _smooth((total - local) / retract)


def _punch_extension_kick(seg: "Segment", t: float) -> float:
    up = 0.16
    total = seg.end - seg.start
    local = t - seg.start
    if local < 0 or local > total:
        return 0.0
    down = 0.26
    if local < up:
        return _smooth(local / up)
    if local < total - down:
        return 1.0
    return _smooth((total - local) / down)


def _two_bone_elbow(shoulder: np.ndarray, wrist: np.ndarray, pole: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    axis = wrist - shoulder
    distance = float(np.linalg.norm(axis))
    reach = UPPER_ARM + FOREARM - 1e-4
    if distance > reach:
        wrist = shoulder + axis * (reach / distance)
        axis = wrist - shoulder
        distance = reach
    u = axis / max(distance, 1e-6)
    along = (UPPER_ARM**2 - FOREARM**2 + distance**2) / (2 * distance)
    height = math.sqrt(max(UPPER_ARM**2 - along**2, 0.0))
    perp = pole - np.dot(pole, u) * u
    perp /= max(float(np.linalg.norm(perp)), 1e-6)
    return shoulder + along * u + height * perp, wrist


class SynthBody:
    def __init__(self, seed: int = 0, noise: float = 0.006, depth_noise: float = 0.010, mirror: bool = False,
                 visibility: float = 0.98, height_scale: float = 1.0):
        self.rng = np.random.default_rng(seed)
        self.noise = noise
        self.depth_noise = depth_noise
        self.mirror = mirror
        self.visibility = visibility
        self.scale = height_scale

    def sample(self, script: Script, t: float) -> Optional[PoseSample]:
        if any(seg.kind == "hide" and seg.start <= t <= seg.end for seg in script.segments):
            return None
        lean_lat = 0.012 * math.sin(2 * math.pi * 0.35 * t)  # idle sway
        lean_fwd = 0.008 * math.sin(2 * math.pi * 0.21 * t + 1.0)
        arm_pose = [dict(guard=1.0), dict(guard=1.0)]
        punch_ext = [0.0, 0.0]
        leg_lift = [0.0, 0.0]
        for seg in script.segments:
            if seg.kind == "slip":
                lean_lat += seg.amount * seg.weight(t)
            elif seg.kind == "lean_fwd":
                lean_fwd += seg.amount * seg.weight(t)
            elif seg.kind == "punch":
                punch_ext[seg.side] = max(punch_ext[seg.side], _punch_extension(seg, t))
            elif seg.kind == "kick":
                leg_lift[seg.side] = max(leg_lift[seg.side], seg.amount * _punch_extension_kick(seg, t))
            elif seg.kind == "block":
                w = seg.weight(t)
                for side in (0, 1):
                    arm_pose[side]["block"] = max(arm_pose[side].get("block", 0.0), w)
            elif seg.kind == "raise":
                arm_pose[seg.side]["raise"] = max(arm_pose[seg.side].get("raise", 0.0), seg.weight(t, 0.2))
            elif seg.kind == "down":
                w = seg.weight(t, 0.2)
                for side in (0, 1):
                    arm_pose[side]["down"] = max(arm_pose[side].get("down", 0.0), w)
        points = self._skeleton(lean_lat, lean_fwd, arm_pose, punch_ext, t, leg_lift)
        world = np.empty_like(points)  # body frame -> MediaPipe world
        world[:, 0] = -points[:, 1]
        world[:, 1] = -points[:, 2]
        world[:, 2] = -points[:, 0]
        world += self.rng.normal(0.0, self.noise, world.shape)
        world[B.LEFT_WRIST, 2] += self.rng.normal(0.0, self.depth_noise)
        world[B.RIGHT_WRIST, 2] += self.rng.normal(0.0, self.depth_noise)
        vis = np.full(B.NUM_LANDMARKS, self.visibility)
        if self.mirror:
            world, vis = B.mirror_raw(world, vis)
        return PoseSample(t=t, world=world, visibility=vis)

    def _skeleton(self, lean_lat: float, lean_fwd: float, arm_pose, punch_ext, t: float, leg_lift=(0.0, 0.0)) -> np.ndarray:
        s = self.scale
        p = np.zeros((B.NUM_LANDMARKS, 3))

        def put(index: int, x: float, y: float, z: float) -> None:
            p[index] = (x * s, y * s, z * s)

        # Lower body (stays put: world landmarks are hip centred).
        put(B.LEFT_HIP, 0.0, -0.11, 0.0)
        put(B.RIGHT_HIP, 0.0, 0.11, 0.0)
        put(25, 0.03, -0.12, -0.45)
        put(26, 0.03, 0.12, -0.45)
        put(27, 0.0, -0.13, -0.88)
        put(28, 0.0, 0.13, -0.88)
        put(29, -0.05, -0.13, -0.92)
        put(30, -0.05, 0.13, -0.92)
        put(31, 0.12, -0.14, -0.93)
        put(32, 0.12, 0.14, -0.93)
        for side in (0, 1):  # a kick lifts the ankle, the knee comes up and forward, the foot goes forward
            lift = leg_lift[side]
            if lift > 0:
                for knee, ankle, heel, toe in ((25, 27, 29, 31), (26, 28, 30, 32)):
                    if (knee == 25) != (side == 0):
                        continue
                    p[knee][2] += 0.55 * lift * s
                    p[knee][0] += 0.45 * lift * s
                    for index in (ankle, heel, toe):
                        p[index][2] += lift * s
                        p[index][0] += 0.55 * lift * s
        # Upper body before lean.
        put(B.LEFT_SHOULDER, 0.0, -0.19, SHOULDER_Z)
        put(B.RIGHT_SHOULDER, 0.0, 0.19, SHOULDER_Z)
        put(B.NOSE, 0.10, 0.0, HEAD_Z)
        put(1, 0.09, -0.02, 0.69)
        put(2, 0.09, -0.035, 0.69)
        put(3, 0.085, -0.05, 0.69)
        put(4, 0.09, 0.02, 0.69)
        put(5, 0.09, 0.035, 0.69)
        put(6, 0.085, 0.05, 0.69)
        put(B.LEFT_EAR, 0.0, -0.075, 0.67)
        put(B.RIGHT_EAR, 0.0, 0.075, 0.67)
        put(9, 0.085, -0.025, 0.62)
        put(10, 0.085, 0.025, 0.62)
        # Lean: shear the upper body proportionally to height.
        for index in list(range(0, 13)):
            z = p[index][2]
            p[index][1] += lean_lat * s * (z / (HEAD_Z * s))
            p[index][0] += lean_fwd * s * (z / (HEAD_Z * s))

        for side in (0, 1):
            sign = -1.0 if side == 0 else 1.0  # left arm is on -Y
            shoulder = p[B.SHOULDER[side]].copy()
            weights = arm_pose[side]
            target = np.array(POSES["guard"], dtype=float)
            for name in ("block", "down", "raise"):
                w = weights.get(name, 0.0)
                if w > 0:
                    target = (1 - w) * target + w * np.array(POSES[name])
            if punch_ext[side] > 0:
                target = (1 - punch_ext[side]) * target + punch_ext[side] * np.array(POSES["punch"])
            # small independent idle motion of the gloves
            target = target + 0.008 * np.array([math.sin(3.1 * t + side), math.sin(2.3 * t + 2 * side), math.sin(2.7 * t + side)])
            forward, inward, up = target * s
            wrist = shoulder + np.array([forward, -sign * inward, up])
            pole = np.array([0.0, sign * 0.6, -1.0])
            elbow, wrist = _two_bone_elbow(shoulder, wrist, pole)
            p[B.ELBOW[side]] = elbow
            p[B.WRIST[side]] = wrist
            direction = (wrist - elbow) / max(float(np.linalg.norm(wrist - elbow)), 1e-6)
            p[B.LEFT_PINKY + side] = wrist + 0.07 * direction + np.array([0, sign * 0.02, 0])
            p[B.LEFT_INDEX + side] = wrist + 0.08 * direction
            p[B.LEFT_THUMB + side] = wrist + 0.05 * direction + np.array([0, -sign * 0.02, 0])
        return p


def stream(script: Script, fps: float = 30.0, seed: int = 0, start_time: float = 0.0, **body_kwargs) -> Iterator[Tuple[float, Optional[PoseSample]]]:
    synth = SynthBody(seed=seed, **body_kwargs)
    frames = int(math.ceil(script.duration * fps)) + 1
    for index in range(frames):
        t = start_time + index / fps
        sample = synth.sample(script, t - start_time)
        if sample is not None:
            sample.t = t
        yield t, sample


def calibration_script(start: float = 0.0, slip: float = 0.20) -> Script:
    """Neutral 2.5 s -> raise right hand -> slip left -> slip right (matches the tracker's full calibration)."""
    s = Script()
    s.idle(start, 2.5)
    s.raise_hand(start + 2.5, 1.2, side=1)
    s.idle(start + 3.7, 0.6)
    s.slip(start + 4.3, 1.1, -slip)
    s.idle(start + 5.4, 0.5)
    s.slip(start + 5.9, 1.1, slip)
    s.idle(start + 7.0, 1.0)
    return s


def demo_session() -> Script:
    """Calibration followed by a short bout: jabs, crosses, a 1-2, blocks and slips."""
    s = calibration_script()
    t = 8.5
    s.punch(t, 0)
    s.punch(t + 0.8, 1)
    s.punch(t + 1.8, 0)
    s.punch(t + 2.15, 1)
    s.block(t + 3.0, 1.2)
    s.slip(t + 4.6, 0.7, -0.2)
    s.slip(t + 5.6, 0.7, 0.2)
    s.punch(t + 6.6, 0)
    s.punch(t + 7.4, 1)
    s.idle(t + 8.0, 1.0)
    return s


def training_session(punches: int = 6, start: float = 8.5, gap: float = 0.7) -> Script:
    s = calibration_script()
    for index in range(punches):
        s.punch(start + index * gap, index % 2)
    s.idle(start + punches * gap, 1.0)
    return s


SCRIPTS: dict[str, Callable[[], Script]] = {
    "demo": demo_session,
    "training": training_session,
    "calibration": calibration_script,
}
