"""Pose samples and the body frame.

MediaPipe world landmarks (verified on a real image, mediapipe 1.0.1, see Docs/Reports):
  origin = hip midpoint, metres, +x = person's LEFT, +y = DOWN, +z = AWAY from the camera.
Body frame used everywhere else (also by Unreal, see INPUT_CONTRACT.md):
  origin = hip midpoint, metres, camera aligned, X = forward (toward camera / screen), Y = person's RIGHT, Z = UP.
  => X = -z, Y = -x, Z = -y. This matches Unreal's axes (X forward, Y right, Z up).

Mirrored cameras swap MediaPipe's left/right labels AND mirror the geometry; mirror correction swaps the
label pairs and negates Y. The calibration step "raise your RIGHT hand" decides whether it is needed.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import numpy as np

NUM_LANDMARKS = 33

NOSE = 0
LEFT_EYE = 2
RIGHT_EYE = 5
LEFT_EAR = 7
RIGHT_EAR = 8
LEFT_SHOULDER = 11
RIGHT_SHOULDER = 12
LEFT_ELBOW = 13
RIGHT_ELBOW = 14
LEFT_WRIST = 15
RIGHT_WRIST = 16
LEFT_PINKY = 17
RIGHT_PINKY = 18
LEFT_INDEX = 19
RIGHT_INDEX = 20
LEFT_THUMB = 21
RIGHT_THUMB = 22
LEFT_HIP = 23
RIGHT_HIP = 24

# (left, right) label pairs of the 33-point MediaPipe pose topology.
MIRROR_PAIRS = [(1, 4), (2, 5), (3, 6), (7, 8), (9, 10)] + [(i, i + 1) for i in range(11, 33, 2)]

SHOULDER = (LEFT_SHOULDER, RIGHT_SHOULDER)
ELBOW = (LEFT_ELBOW, RIGHT_ELBOW)
WRIST = (LEFT_WRIST, RIGHT_WRIST)
KEY_POINTS = (NOSE, LEFT_SHOULDER, RIGHT_SHOULDER, LEFT_ELBOW, RIGHT_ELBOW, LEFT_WRIST, RIGHT_WRIST, LEFT_HIP, RIGHT_HIP)

_PERMUTATION = list(range(NUM_LANDMARKS))
for _left, _right in MIRROR_PAIRS:
    _PERMUTATION[_left], _PERMUTATION[_right] = _right, _left


@dataclass
class PoseSample:
    """One camera frame of pose data in MediaPipe world convention."""

    t: float  # capture time, seconds (monotonic)
    world: np.ndarray  # (33, 3) metres, MediaPipe world axes
    visibility: np.ndarray  # (33,) 0..1

    def to_json(self) -> dict:
        return {
            "t": round(self.t, 6),
            "world": [[round(float(v), 5) for v in row] + [round(float(vis), 3)] for row, vis in zip(self.world, self.visibility)],
        }

    @staticmethod
    def from_json(obj: dict) -> Optional["PoseSample"]:
        if obj.get("world") is None:
            return None
        data = np.asarray(obj["world"], dtype=np.float64)
        return PoseSample(t=float(obj["t"]), world=data[:, :3].copy(), visibility=data[:, 3].copy())


def to_body_frame(world: np.ndarray) -> np.ndarray:
    """MediaPipe world (x left, y down, z away) -> body frame (X fwd, Y right, Z up)."""
    out = np.empty_like(world)
    out[:, 0] = -world[:, 2]
    out[:, 1] = -world[:, 0]
    out[:, 2] = -world[:, 1]
    return out


def mirror_correct(points: np.ndarray, visibility: np.ndarray):
    """Undo a mirrored camera in the body frame: swap left/right labels and negate Y."""
    fixed = points[_PERMUTATION].copy()
    fixed[:, 1] = -fixed[:, 1]
    return fixed, visibility[_PERMUTATION].copy()


def mirror_raw(world: np.ndarray, visibility: np.ndarray):
    """What MediaPipe reports for a mirrored camera, given the true MediaPipe-world pose (used by synth/tests)."""
    flipped = world[_PERMUTATION].copy()
    flipped[:, 0] = -flipped[:, 0]
    return flipped, visibility[_PERMUTATION].copy()


@dataclass
class BodyPose:
    """A PoseSample converted to the body frame (optionally mirror corrected)."""

    t: float
    p: np.ndarray  # (33, 3) body frame metres
    vis: np.ndarray  # (33,)
    mirrored: bool

    @staticmethod
    def from_sample(sample: PoseSample, mirror: bool) -> "BodyPose":
        points = to_body_frame(np.asarray(sample.world, dtype=np.float64))
        vis = np.asarray(sample.visibility, dtype=np.float64)
        if mirror:
            points, vis = mirror_correct(points, vis)
        return BodyPose(t=sample.t, p=points, vis=vis, mirrored=mirror)

    # --- derived anatomy ---
    def hip_mid(self) -> np.ndarray:
        return 0.5 * (self.p[LEFT_HIP] + self.p[RIGHT_HIP])

    def shoulder_mid(self) -> np.ndarray:
        return 0.5 * (self.p[LEFT_SHOULDER] + self.p[RIGHT_SHOULDER])

    def head(self) -> np.ndarray:
        return (self.p[NOSE] + self.p[LEFT_EAR] + self.p[RIGHT_EAR]) / 3.0

    def shoulder_width(self) -> float:
        return float(np.linalg.norm(self.p[LEFT_SHOULDER] - self.p[RIGHT_SHOULDER]))

    def arm_length(self, side: int) -> float:
        s, e, w = self.p[SHOULDER[side]], self.p[ELBOW[side]], self.p[WRIST[side]]
        return float(np.linalg.norm(e - s) + np.linalg.norm(w - e))

    def visibility_of(self, indices) -> float:
        return float(np.mean(self.vis[list(indices)]))
