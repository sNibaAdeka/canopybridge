"""Gesture interpretation: straight punches (events), block amount and lean (continuous).

Punch onset is detected early (rising extension + forward velocity) so the game can start its own
game-processed punch with minimal latency; the robot does not copy the arm 1:1 (INPUT_CONTRACT.md).
"""

from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass
from typing import Deque, Optional, Tuple

import numpy as np

from .body import SHOULDER, WRIST, BodyPose
from .calibration import CalibrationData
from .config import BlockConfig, PunchConfig


@dataclass
class PunchDetection:
    hand: int
    strength: float
    confidence: float
    t: float  # capture time of the frame that triggered the detection


class PunchDetector:
    def __init__(self, config: PunchConfig, side: int):
        self.cfg = config
        self.side = side
        self.history: Deque[Tuple[float, float, float]] = deque()
        self.armed = True
        self.peak = 0.0
        self.fired_at = -1e9

    def reset(self) -> None:
        self.history.clear()
        self.armed = True
        self.peak = 0.0

    def update(self, t: float, extension: float, forward: float, visibility: float, guard_extension: float) -> Optional[PunchDetection]:
        cfg = self.cfg
        if visibility < cfg.min_visibility or not math.isfinite(extension):
            self.history.clear()
            return None
        self.history.append((t, extension, forward))
        while self.history and t - self.history[0][0] > max(cfg.progress_window, 0.3):
            self.history.popleft()

        if not self.armed:
            self.peak = max(self.peak, extension)
            retracted = extension <= guard_extension + cfg.rearm_fraction * (self.peak - guard_extension)
            if retracted or t - self.fired_at > cfg.rearm_timeout:
                self.armed = True
            return None

        if len(self.history) < 3 or t - self.fired_at < cfg.min_interval:
            return None

        # Velocity over ~2 frames (more robust to MediaPipe depth jitter than a 1-frame difference).
        reference = None
        for sample in self.history:
            if t - sample[0] <= 0.075 and sample[0] < t:
                reference = sample
                break
        if reference is None:
            reference = self.history[-2]
        dt = t - reference[0]
        if dt <= 1e-4:
            return None
        ext_velocity = (extension - reference[1]) / dt
        fwd_velocity = (forward - reference[2]) / dt
        window = [s[1] for s in self.history if t - s[0] <= cfg.progress_window]
        progress = extension - min(window)

        if (
            ext_velocity >= cfg.trigger_ext_velocity
            and fwd_velocity >= cfg.trigger_fwd_velocity
            and extension >= guard_extension + cfg.min_ext_above_guard
            and progress >= cfg.min_progress
        ):
            self.armed = False
            self.peak = extension
            self.fired_at = t
            span = max(1e-3, cfg.strength_velocity_max - cfg.trigger_fwd_velocity)
            strength = 0.3 + 0.7 * min(1.0, max(0.0, (fwd_velocity - cfg.trigger_fwd_velocity) / span))
            confidence = min(1.0, visibility)
            return PunchDetection(hand=self.side, strength=float(strength), confidence=float(confidence), t=t)
        return None


def arm_measures(pose: BodyPose, calibration: CalibrationData, side: int) -> Tuple[float, float]:
    """(extension, forward) of one arm in arm lengths."""
    arm = calibration.arm_length[side]
    delta = pose.p[WRIST[side]] - pose.p[SHOULDER[side]]
    return float(np.linalg.norm(delta) / arm), float(delta[0] / arm)


def block_amount(pose: BodyPose, calibration: CalibrationData, config: BlockConfig) -> float:
    head = pose.head()
    shoulder_mid = pose.shoulder_mid()
    covers = []
    for side in (0, 1):
        wrist = pose.p[WRIST[side]]
        raised = (wrist[2] - shoulder_mid[2]) - calibration.guard_wrist_height[side]
        cover_height = min(1.0, max(0.0, (raised - config.raise_above_guard) / config.raise_full))
        distance = float(np.linalg.norm(wrist - head)) / calibration.arm_length[side]
        cover_face = 1.0 if distance <= config.max_face_distance else max(0.0, 1.0 - (distance - config.max_face_distance) / 0.15)
        covers.append(cover_height * cover_face)
    return float(min(covers))


def lean(pose: BodyPose, calibration: CalibrationData, forward_range: float) -> Tuple[float, float]:
    head = pose.head()
    hips = pose.hip_mid()
    lateral = float(head[1] - hips[1] - calibration.neutral_head_lateral)
    scale = calibration.slip_range_left if lateral < 0 else calibration.slip_range_right
    forward = float(head[0] - hips[0] - calibration.neutral_head_forward)
    return lateral / scale, forward / forward_range


class OneEuro:
    """One Euro filter (Casiez et al. 2012) for jitter-free yet responsive continuous outputs."""

    def __init__(self, min_cutoff: float, beta: float, d_cutoff: float = 1.0):
        self.min_cutoff = min_cutoff
        self.beta = beta
        self.d_cutoff = d_cutoff
        self.x_prev: Optional[np.ndarray] = None
        self.dx_prev: Optional[np.ndarray] = None
        self.t_prev: Optional[float] = None

    @staticmethod
    def _alpha(cutoff: float, dt: float) -> float:
        tau = 1.0 / (2.0 * math.pi * cutoff)
        return 1.0 / (1.0 + tau / dt)

    def reset(self) -> None:
        self.x_prev = None
        self.dx_prev = None
        self.t_prev = None

    def __call__(self, x, t: float) -> np.ndarray:
        x = np.asarray(x, dtype=np.float64)
        if self.x_prev is None or self.t_prev is None or t <= self.t_prev:
            self.x_prev = x
            self.dx_prev = np.zeros_like(x)
            self.t_prev = t
            return x
        dt = t - self.t_prev
        dx = (x - self.x_prev) / dt
        a_d = self._alpha(self.d_cutoff, dt)
        dx_hat = a_d * dx + (1 - a_d) * self.dx_prev
        cutoff = self.min_cutoff + self.beta * np.abs(dx_hat)
        tau = 1.0 / (2.0 * math.pi * cutoff)
        a = 1.0 / (1.0 + tau / dt)
        x_hat = a * x + (1 - a) * self.x_prev
        self.x_prev, self.dx_prev, self.t_prev = x_hat, dx_hat, t
        return x_hat
