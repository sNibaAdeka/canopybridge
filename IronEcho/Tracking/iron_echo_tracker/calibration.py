"""Per-player calibration: neutral guard, camera mirroring, slip ranges.

Full:  NEUTRAL (hold guard) -> RAISE_RIGHT_HAND (detects mirrored camera) -> SLIP_LEFT -> SLIP_RIGHT -> DONE
Quick: NEUTRAL only (mirror flag and slip ranges are kept from the previous calibration or defaults).
"""

from __future__ import annotations

import json
import os
import sys
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import List, Optional, Tuple

import numpy as np

from .body import KEY_POINTS, LEFT_WRIST, NOSE, RIGHT_WRIST, SHOULDER, WRIST, BodyPose, PoseSample
from .config import CalibrationConfig
from .protocol import CalibrationFailure, CalibrationState, CalibrationStep

CALIBRATION_FORMAT_VERSION = 1


@dataclass
class CalibrationData:
    version: int = CALIBRATION_FORMAT_VERSION
    mode: str = "default"  # default | quick | full
    mirror: bool = False
    shoulder_width: float = 0.38
    arm_length: Tuple[float, float] = (0.57, 0.57)
    neutral_head_lateral: float = 0.0
    neutral_head_forward: float = 0.0
    guard_extension: Tuple[float, float] = (0.52, 0.52)
    guard_wrist_height: Tuple[float, float] = (0.16, 0.16)  # wrist Z above shoulder centre, metres
    slip_range_left: float = 0.18
    slip_range_right: float = 0.18
    created_utc: str = ""

    @property
    def is_real(self) -> bool:
        return self.mode in ("quick", "full")

    def mean_arm_length(self) -> float:
        return 0.5 * (self.arm_length[0] + self.arm_length[1])

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(asdict(self), indent=2), encoding="utf-8")
        os.replace(tmp, path)

    @staticmethod
    def load(path: Path) -> Optional["CalibrationData"]:
        try:
            data = json.loads(Path(path).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        if data.get("version") != CALIBRATION_FORMAT_VERSION:
            return None
        known = CalibrationData.__dataclass_fields__.keys()
        cleaned = {k: (tuple(v) if isinstance(v, list) else v) for k, v in data.items() if k in known}
        try:
            result = CalibrationData(**cleaned)
        except TypeError:
            return None
        sane = 0.2 < result.mean_arm_length() < 1.2 and 0.02 < result.slip_range_left < 0.6 and 0.02 < result.slip_range_right < 0.6
        return result if sane else None


def default_calibration_path() -> Path:
    if sys.platform == "win32":
        base = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
    else:
        base = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share"))
    return base / "IronEcho" / "calibration.json"


@dataclass
class CalibrationProgress:
    state: CalibrationState = CalibrationState.NONE
    step: CalibrationStep = CalibrationStep.IDLE
    progress: int = 0
    failure: CalibrationFailure = CalibrationFailure.NO_FAILURE


class Calibrator:
    def __init__(self, config: CalibrationConfig, mode: str, previous: Optional[CalibrationData]):
        if mode not in ("full", "quick"):
            raise ValueError(mode)
        self.cfg = config
        self.mode = mode
        self.previous = previous
        self.status = CalibrationProgress(state=CalibrationState.IN_PROGRESS, step=CalibrationStep.NEUTRAL)
        self.result: Optional[CalibrationData] = None
        self.mirror = previous.mirror if (previous is not None and previous.is_real) else False
        self._step_started: Optional[float] = None
        self._visible_time = 0.0
        self._total_time = 0.0
        self._last_t: Optional[float] = None
        self._window: List[PoseSample] = []
        self._neutral: List[PoseSample] = []
        self._hold_started: Optional[float] = None
        self._extreme = 0.0
        self._neutral_lat = 0.0
        self._slip_left = previous.slip_range_left if previous else config.default_slip_range
        self._slip_right = previous.slip_range_right if previous else config.default_slip_range

    @property
    def active(self) -> bool:
        return self.status.state == CalibrationState.IN_PROGRESS

    def cancel(self) -> None:
        if self.active:
            self._fail(CalibrationFailure.CANCELLED)

    def update(self, sample: Optional[PoseSample], t: float) -> CalibrationProgress:
        if not self.active:
            return self.status
        if self._step_started is None:
            self._step_started = t
        dt = 0.0 if self._last_t is None else max(0.0, t - self._last_t)
        self._last_t = t
        self._total_time += dt

        visible = sample is not None and BodyPose.from_sample(sample, False).visibility_of(KEY_POINTS) >= self.cfg.min_visibility
        if visible:
            self._visible_time += dt

        if t - self._step_started > self.cfg.step_timeout:
            low_vis = self._total_time > 0 and self._visible_time < 0.5 * self._total_time
            self._fail(CalibrationFailure.LOW_VISIBILITY if low_vis else CalibrationFailure.TIMEOUT)
            return self.status

        step = self.status.step
        if step == CalibrationStep.NEUTRAL:
            self._update_neutral(sample if visible else None, t)
        elif step == CalibrationStep.RAISE_RIGHT_HAND:
            self._update_raise(sample if visible else None, t)
        elif step in (CalibrationStep.SLIP_LEFT, CalibrationStep.SLIP_RIGHT):
            self._update_slip(sample if visible else None, t, left=step == CalibrationStep.SLIP_LEFT)
        return self.status

    # ------------------------------------------------------------------ steps

    def _next(self, step: CalibrationStep, t: float) -> None:
        self.status.step = step
        self.status.progress = 0
        self._step_started = t
        self._visible_time = 0.0
        self._total_time = 0.0
        self._hold_started = None
        self._extreme = 0.0

    def _fail(self, failure: CalibrationFailure) -> None:
        self.status.state = CalibrationState.FAILED
        self.status.failure = failure

    def _update_neutral(self, sample: Optional[PoseSample], t: float) -> None:
        if sample is None:
            self._window.clear()
            self.status.progress = 0
            return
        self._window.append(sample)
        while self._window and t - self._window[0].t > self.cfg.neutral_seconds:
            self._window.pop(0)
        poses = [BodyPose.from_sample(s, False) for s in self._window]
        heads = np.array([p.head() - p.hip_mid() for p in poses])
        wrists = np.array([np.concatenate([p.p[LEFT_WRIST] - p.shoulder_mid(), p.p[RIGHT_WRIST] - p.shoulder_mid()]) for p in poses])
        stable = len(poses) < 3 or (
            float(np.max(np.std(heads[:, :2], axis=0))) <= self.cfg.neutral_max_head_std
            and float(np.max(np.std(wrists, axis=0))) <= self.cfg.neutral_max_wrist_std
        )
        if not stable:
            # Moving: restart the window from the current frame.
            self._window = [sample]
            self.status.progress = 0
            return
        span = t - self._window[0].t
        self.status.progress = int(min(100, 100 * span / self.cfg.neutral_seconds))
        if span >= self.cfg.neutral_seconds * 0.98 and len(self._window) >= 5:
            self._neutral = list(self._window)
            if self.mode == "quick":
                self._finish(t)
            else:
                self._next(CalibrationStep.RAISE_RIGHT_HAND, t)

    def _update_raise(self, sample: Optional[PoseSample], t: float) -> None:
        if sample is None:
            self._hold_started = None
            self.status.progress = 0
            return
        pose = BodyPose.from_sample(sample, False)
        nose_z = pose.p[NOSE][2]
        up = [pose.p[WRIST[side]][2] > nose_z + self.cfg.raise_hand_margin for side in (0, 1)]
        if up[0] == up[1]:
            self._hold_started = None
            self.status.progress = 0
            return
        if self._hold_started is None:
            self._hold_started = t
        held = t - self._hold_started
        self.status.progress = int(min(100, 100 * held / self.cfg.raise_hold_seconds))
        if held >= self.cfg.raise_hold_seconds:
            # The player raised their RIGHT hand. If MediaPipe calls it "left", the camera image is mirrored.
            self.mirror = bool(up[0])
            neutral_poses = [BodyPose.from_sample(s, self.mirror) for s in self._neutral]
            self._neutral_lat = float(np.median([p.head()[1] - p.hip_mid()[1] for p in neutral_poses]))
            self._next(CalibrationStep.SLIP_LEFT, t)

    def _update_slip(self, sample: Optional[PoseSample], t: float, left: bool) -> None:
        if sample is None:
            self._hold_started = None
            self.status.progress = 0
            return
        pose = BodyPose.from_sample(sample, self.mirror)
        offset = float(pose.head()[1] - pose.hip_mid()[1] - self._neutral_lat)
        directed = -offset if left else offset
        if directed < self.cfg.slip_min_offset:
            self._hold_started = None
            self.status.progress = 0
            return
        if self._hold_started is None:
            self._hold_started = t
            self._extreme = directed
        self._extreme = max(self._extreme, directed)
        held = t - self._hold_started
        self.status.progress = int(min(100, 100 * held / self.cfg.slip_hold_seconds))
        if held >= self.cfg.slip_hold_seconds:
            measured = max(self.cfg.slip_min_offset, self._extreme * self.cfg.slip_range_fraction)
            if left:
                self._slip_left = measured
                self._next(CalibrationStep.SLIP_RIGHT, t)
            else:
                self._slip_right = measured
                self._finish(t)

    def _finish(self, t: float) -> None:
        poses = [BodyPose.from_sample(s, self.mirror) for s in self._neutral]
        arm = tuple(float(np.median([p.arm_length(side) for p in poses])) for side in (0, 1))
        guard_ext = tuple(
            float(np.median([np.linalg.norm(p.p[WRIST[side]] - p.p[SHOULDER[side]]) / arm[side] for p in poses])) for side in (0, 1)
        )
        guard_h = tuple(float(np.median([p.p[WRIST[side]][2] - p.shoulder_mid()[2] for p in poses])) for side in (0, 1))
        self.result = CalibrationData(
            mode=self.mode,
            mirror=self.mirror,
            shoulder_width=float(np.median([p.shoulder_width() for p in poses])),
            arm_length=arm,  # type: ignore[arg-type]
            neutral_head_lateral=float(np.median([p.head()[1] - p.hip_mid()[1] for p in poses])),
            neutral_head_forward=float(np.median([p.head()[0] - p.hip_mid()[0] for p in poses])),
            guard_extension=guard_ext,  # type: ignore[arg-type]
            guard_wrist_height=guard_h,  # type: ignore[arg-type]
            slip_range_left=self._slip_left,
            slip_range_right=self._slip_right,
            created_utc=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        )
        self.status.state = CalibrationState.VALID
        self.status.step = CalibrationStep.DONE
        self.status.progress = 100
