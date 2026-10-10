"""Pure processing pipeline: PoseSample stream -> per-frame tracker output. No I/O, fully testable."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional, Tuple

import numpy as np

from .body import KEY_POINTS, SHOULDER, WRIST, ELBOW, BodyPose, PoseSample
from .calibration import CalibrationData, Calibrator
from .config import TrackerConfig
from .gestures import OneEuro, PunchDetection, PunchDetector, arm_measures, block_amount, lean
from .protocol import CalibrationFailure, CalibrationState, CalibrationStep, TrackerState


@dataclass
class FrameOutput:
    t: float
    state: TrackerState
    calibration: CalibrationState
    step: CalibrationStep = CalibrationStep.IDLE
    progress: int = 0
    failure: CalibrationFailure = CalibrationFailure.NO_FAILURE
    mirror: bool = False
    confidence: float = 0.0
    lean_lateral: float = 0.0
    lean_forward: float = 0.0
    block: float = 0.0
    hand_pos: Tuple[Tuple[float, float, float], Tuple[float, float, float]] = ((0.0, 0.0, 0.0), (0.0, 0.0, 0.0))
    extension: Tuple[float, float] = (0.0, 0.0)
    hand_confidence: Tuple[float, float] = (0.0, 0.0)
    punches: List[PunchDetection] = field(default_factory=list)


class TrackerPipeline:
    def __init__(self, config: TrackerConfig, calibration: Optional[CalibrationData] = None):
        self.cfg = config
        self.calibration = calibration if (calibration is not None and calibration.is_real) else None
        self.calibrator: Optional[Calibrator] = None
        self.last_failure = CalibrationFailure.NO_FAILURE
        self.last_failed_step = CalibrationStep.IDLE
        self.detectors = [PunchDetector(config.punch, 0), PunchDetector(config.punch, 1)]
        self.smooth = OneEuro(config.smoothing_min_cutoff, config.smoothing_beta)

    # ---------------------------------------------------------------- calibration control
    def start_calibration(self, mode: str) -> None:
        self.calibrator = Calibrator(self.cfg.calibration, mode, self.calibration)
        self.last_failure = CalibrationFailure.NO_FAILURE
        self._reset_detectors()

    def cancel_calibration(self) -> bool:
        if self.calibrator is not None and self.calibrator.active:
            self.calibrator.cancel()
            self.last_failure = CalibrationFailure.CANCELLED
            self.last_failed_step = self.calibrator.status.step
            self.calibrator = None
            return True
        return False

    @property
    def calibrating(self) -> bool:
        return self.calibrator is not None and self.calibrator.active

    def _reset_detectors(self) -> None:
        for detector in self.detectors:
            detector.reset()
        self.smooth.reset()

    def _active_calibration(self) -> CalibrationData:
        return self.calibration if self.calibration is not None else CalibrationData()

    # ---------------------------------------------------------------- main entry
    def process(self, sample: Optional[PoseSample], t: float) -> FrameOutput:
        out = FrameOutput(t=t, state=TrackerState.NO_PERSON, calibration=CalibrationState.NONE)

        if self.calibrator is not None:
            progress = self.calibrator.update(sample, t)
            if progress.state == CalibrationState.VALID and self.calibrator.result is not None:
                self.calibration = self.calibrator.result
                self.calibrator = None
                self._reset_detectors()
            elif progress.state == CalibrationState.FAILED:
                self.last_failure = progress.failure
                self.last_failed_step = progress.step
                self.calibrator = None

        if self.calibrating:
            assert self.calibrator is not None
            out.calibration = CalibrationState.IN_PROGRESS
            out.step = self.calibrator.status.step
            out.progress = self.calibrator.status.progress
            out.mirror = self.calibrator.mirror
        elif self.calibration is not None:
            out.calibration = CalibrationState.VALID
            out.step = CalibrationStep.DONE
            out.progress = 100
            out.failure = self.last_failure
            out.mirror = self.calibration.mirror
        elif self.last_failure != CalibrationFailure.NO_FAILURE:
            out.calibration = CalibrationState.FAILED
            out.step = self.last_failed_step
            out.failure = self.last_failure

        if sample is None:
            self._reset_detectors()
            return out

        calibration = self._active_calibration()
        mirror = out.mirror
        pose = BodyPose.from_sample(sample, mirror)
        confidence = pose.visibility_of(KEY_POINTS)
        out.confidence = confidence
        if confidence < self.cfg.min_confidence:
            out.state = TrackerState.LOW_CONFIDENCE
            self._reset_detectors()
            return out
        out.state = TrackerState.TRACKING

        lean_lat, lean_fwd = lean(pose, calibration, self.cfg.forward_lean_range)
        arm = calibration.mean_arm_length()
        shoulder_mid = pose.shoulder_mid()
        hands = [(pose.p[WRIST[side]] - shoulder_mid) / arm for side in (0, 1)]
        raw = np.concatenate([[lean_lat, lean_fwd], hands[0], hands[1]])
        smooth = self.smooth(raw, t)
        out.lean_lateral = float(np.clip(smooth[0], -2.0, 2.0))
        out.lean_forward = float(np.clip(smooth[1], -2.0, 2.0))
        out.hand_pos = (
            tuple(float(v) for v in np.clip(smooth[2:5], -3, 3)),  # type: ignore[assignment]
            tuple(float(v) for v in np.clip(smooth[5:8], -3, 3)),
        )
        out.block = block_amount(pose, calibration, self.cfg.block)

        extensions = []
        confidences = []
        for side in (0, 1):
            extension, forward = arm_measures(pose, calibration, side)
            # shoulder -> wrist only: in a punch straight at the camera the glove hides the elbow (low visibility), and the
            # extension does not use it
            hand_vis = float(min(pose.vis[WRIST[side]], pose.vis[SHOULDER[side]]))
            extensions.append(float(min(2.0, extension)))
            confidences.append(hand_vis)
            if self.calibrating:
                continue
            detection = self.detectors[side].update(t, extension, forward, hand_vis, calibration.guard_extension[side])
            if detection is not None:
                out.punches.append(detection)
        out.extension = (extensions[0], extensions[1])
        out.hand_confidence = (confidences[0], confidences[1])
        return out
