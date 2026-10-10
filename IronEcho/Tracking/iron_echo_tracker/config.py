"""Tracker tuning. Defaults are the v1 baseline; a JSON file can override any field (--config)."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field, fields
from pathlib import Path
from typing import Optional


@dataclass
class PunchConfig:
    trigger_ext_velocity: float = 2.0  # arm lengths / s, extension speed
    trigger_fwd_velocity: float = 1.4  # arm lengths / s, toward the camera
    min_ext_above_guard: float = 0.10  # extension must exceed guard + this
    min_progress: float = 0.16  # net extension gain within progress_window
    progress_window: float = 0.25  # s
    rearm_fraction: float = 0.5  # retract this fraction of (peak - guard) before re-arming
    rearm_timeout: float = 0.6  # s, re-arm anyway after this
    min_interval: float = 0.15  # s between punches of the same hand
    min_visibility: float = 0.5
    vel_min_span: float = 0.05  # s: velocity over at least two frames at 30 fps...
    vel_max_span: float = 0.12  # ...and at most this far back
    gap_reset: float = 0.30  # s: a doubtful frame is skipped; only a longer gap forgets the motion
    strength_velocity_max: float = 5.0  # forward velocity mapped to strength 1.0


@dataclass
class BlockConfig:
    raise_above_guard: float = 0.03  # m above the calibrated guard wrist height before cover starts
    raise_full: float = 0.10  # m over which cover ramps 0 -> 1
    max_face_distance: float = 0.55  # arm lengths from wrist to head centre


@dataclass
class CalibrationConfig:
    neutral_seconds: float = 1.5
    neutral_max_head_std: float = 0.03  # m
    neutral_max_wrist_std: float = 0.05  # m
    raise_hand_margin: float = 0.08  # m above the nose
    raise_hold_seconds: float = 0.3
    slip_min_offset: float = 0.08  # m of head travel to accept a slip
    slip_hold_seconds: float = 0.4
    slip_range_fraction: float = 0.85  # lean 1.0 = this fraction of the measured extreme
    default_slip_range: float = 0.18  # m, used by quick calibration
    step_timeout: float = 20.0
    min_visibility: float = 0.6


@dataclass
class TrackerConfig:
    punch: PunchConfig = field(default_factory=PunchConfig)
    block: BlockConfig = field(default_factory=BlockConfig)
    calibration: CalibrationConfig = field(default_factory=CalibrationConfig)
    min_confidence: float = 0.5  # mean visibility of key points; below -> LowConfidence
    forward_lean_range: float = 0.25  # m of head travel mapped to lean_forward 1.0
    smoothing_min_cutoff: float = 2.5  # One Euro filter for continuous outputs (Hz)
    smoothing_beta: float = 0.3
    event_repeat_seconds: float = 0.2  # each event is repeated in packets for this long
    status_period: float = 0.5

    @staticmethod
    def load(path: Optional[Path]) -> "TrackerConfig":
        config = TrackerConfig()
        if path is None:
            return config
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        _apply(config, data)
        return config

    def to_dict(self) -> dict:
        return asdict(self)


def _apply(target, data: dict) -> None:
    known = {f.name: f for f in fields(target)}
    for key, value in data.items():
        if key not in known:
            raise ValueError(f"unknown config key: {key}")
        current = getattr(target, key)
        if hasattr(current, "__dataclass_fields__"):
            _apply(current, value)
        else:
            setattr(target, key, type(current)(value))
