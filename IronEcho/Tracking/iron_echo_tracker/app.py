"""Tracker main loop: frame provider -> pipeline -> UDP link, plus control commands, status and watchdog."""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterator, List, Optional, Tuple

import numpy as np

from . import protocol as P
from .body import PoseSample
from .calibration import CalibrationData, default_calibration_path
from .config import TrackerConfig
from .net import TrackerLink, monotonic_us
from .pipeline import FrameOutput, TrackerPipeline
from .sources import CameraSource, MediaPipePose, Recorder, parent_alive

log = logging.getLogger("iron_echo_tracker")


@dataclass
class ProviderFrame:
    capture_s: float  # wire clock (time.perf_counter seconds) at capture
    source_t: float  # time base used by the pipeline (camera: same as capture_s; synthetic: script time)
    sample: Optional[PoseSample]
    image: Optional[np.ndarray] = None
    image_landmarks: Optional[np.ndarray] = None


class FrameProvider:
    state = P.TrackerState.STARTING
    error = P.TrackerError.NO_ERROR
    camera_index = 255
    width = 0
    height = 0
    model_name = "none"
    inference_ms = 0.0

    def next(self) -> Optional[ProviderFrame]:
        raise NotImplementedError

    @property
    def fps(self) -> float:
        return 0.0

    def finished(self) -> bool:
        return False

    def close(self) -> None:
        pass


class IterProvider(FrameProvider):
    """Plays (t, sample) pairs from a recording or a synthetic script in (scaled) real time."""

    def __init__(self, frames: Iterator[Tuple[float, Optional[PoseSample]]], speed: float = 1.0, name: str = "synthetic"):
        self.frames = iter(frames)
        self.speed = max(0.01, speed)
        self.model_name = name
        self.state = P.TrackerState.TRACKING
        self._start_wall: Optional[float] = None
        self._start_t: Optional[float] = None
        self._done = False
        self._times: List[float] = []

    def next(self) -> Optional[ProviderFrame]:
        try:
            t, sample = next(self.frames)
        except StopIteration:
            self._done = True
            return None
        if self._start_wall is None:
            self._start_wall = time.perf_counter()
            self._start_t = t
        target = self._start_wall + (t - (self._start_t or 0.0)) / self.speed
        delay = target - time.perf_counter()
        if delay > 0:
            time.sleep(delay)
        now = time.perf_counter()
        self._times.append(now)
        while self._times and now - self._times[0] > 1.0:
            self._times.pop(0)
        return ProviderFrame(capture_s=now, source_t=t, sample=sample)

    @property
    def fps(self) -> float:
        return float(max(0, len(self._times) - 1))

    def finished(self) -> bool:
        return self._done


class CameraProvider(FrameProvider):
    def __init__(self, camera_index: int, model: Path, width: int, height: int, fps: int, backend: str, keep_image: bool):
        self.camera_index = camera_index
        self.model_path = model
        self.request = (width, height, fps, backend)
        self.keep_image = keep_image
        self.camera: Optional[CameraSource] = None
        self.pose: Optional[MediaPipePose] = None
        self._next_retry = 0.0
        try:
            self.pose = MediaPipePose(model)
            self.model_name = self.pose.model_name
        except Exception as error:  # noqa: BLE001 - report any native load failure to the game
            log.error("model load failed: %s", error)
            self.error = P.TrackerError.MODEL_LOAD_FAILED
        self._open_camera()

    def _open_camera(self) -> None:
        width, height, fps, backend = self.request
        try:
            self.camera = CameraSource(self.camera_index, width, height, fps, backend)
            self.width, self.height = self.camera.width, self.camera.height
            self.state = P.TrackerState.NO_PERSON
            if self.error == P.TrackerError.CAMERA_OPEN_FAILED:
                self.error = P.TrackerError.NO_ERROR
            log.info("camera %d opened at %dx%d", self.camera_index, self.width, self.height)
        except Exception as error:  # noqa: BLE001
            log.warning("camera %d open failed: %s", self.camera_index, error)
            self.camera = None
            self.state = P.TrackerState.NO_CAMERA
            self.error = P.TrackerError.CAMERA_OPEN_FAILED
            self._next_retry = time.perf_counter() + 2.0

    def next(self) -> Optional[ProviderFrame]:
        if self.camera is None:
            if time.perf_counter() >= self._next_retry:
                self._open_camera()
            time.sleep(0.1)
            now = time.perf_counter()
            return ProviderFrame(capture_s=now, source_t=now, sample=None)
        frame, captured = self.camera.latest(timeout=0.5)
        if frame is None:
            self.state = P.TrackerState.NO_CAMERA
            self.error = P.TrackerError.CAMERA_READ_FAILED
            now = time.perf_counter()
            return ProviderFrame(capture_s=now, source_t=now, sample=None)
        if self.error == P.TrackerError.CAMERA_READ_FAILED:
            self.error = P.TrackerError.NO_ERROR
        sample = None
        landmarks = None
        if self.pose is not None:
            started = time.perf_counter()
            sample = self.pose.detect(frame, captured)
            self.inference_ms = 0.9 * self.inference_ms + 0.1 * (time.perf_counter() - started) * 1000.0
        self.state = P.TrackerState.TRACKING if sample is not None else P.TrackerState.NO_PERSON
        return ProviderFrame(capture_s=captured, source_t=captured, sample=sample,
                             image=frame if self.keep_image else None, image_landmarks=landmarks)

    @property
    def fps(self) -> float:
        return self.camera.fps if self.camera is not None else 0.0

    def close(self) -> None:
        if self.camera is not None:
            self.camera.close()
        if self.pose is not None:
            self.pose.close()


@dataclass
class AppOptions:
    game_port: int = 47810
    control_port: int = 47811
    token: int = 0
    parent_pid: int = 0
    managed: bool = False  # exit when the game stops pinging
    ping_timeout: float = 10.0
    calibration_path: Optional[Path] = None
    use_saved_calibration: bool = True
    calibrate_on_start: Optional[str] = None  # None | quick | full
    preview: bool = False
    record: Optional[Path] = None
    max_seconds: Optional[float] = None


@dataclass
class AppStats:
    frames: int = 0
    punches: List[Tuple[float, int]] = field(default_factory=list)
    calibration_state: P.CalibrationState = P.CalibrationState.NONE
    commands: List[P.ControlCommand] = field(default_factory=list)
    exit_reason: str = ""


class TrackerApp:
    def __init__(self, provider: FrameProvider, config: TrackerConfig, options: AppOptions):
        self.provider = provider
        self.cfg = config
        self.opt = options
        self.calibration_path = options.calibration_path or default_calibration_path()
        saved = CalibrationData.load(self.calibration_path) if options.use_saved_calibration else None
        if saved is not None:
            log.info("loaded calibration %s (%s)", self.calibration_path, saved.mode)
        self.pipeline = TrackerPipeline(config, saved)
        self.link = TrackerLink(options.game_port, options.control_port, options.token, event_repeat_seconds=config.event_repeat_seconds)
        self.preview = options.preview
        self.recorder = Recorder(options.record, {"source": provider.model_name}) if options.record else None
        self.stats = AppStats()
        self._last_status = 0.0
        self._last_ping = time.perf_counter()
        self._latency_ms = 0.0
        self._last_out: Optional[FrameOutput] = None
        self._saved_calibration_id = id(saved) if saved else 0

    def _status(self) -> P.Status:
        out = self._last_out
        state = self.provider.state if out is None or self.provider.state in (P.TrackerState.NO_CAMERA, P.TrackerState.STARTING) else out.state
        return P.Status(
            state=state,
            calibration=out.calibration if out else P.CalibrationState.NONE,
            step=out.step if out else P.CalibrationStep.IDLE,
            progress=out.progress if out else 0,
            failure=out.failure if out else P.CalibrationFailure.NO_FAILURE,
            mirror_applied=bool(out.mirror) if out else False,
            camera_index=self.provider.camera_index,
            last_error=self.provider.error,
            camera_fps=self.provider.fps,
            inference_ms=self.provider.inference_ms,
            pipeline_latency_ms=self._latency_ms,
            camera_width=self.provider.width,
            camera_height=self.provider.height,
            model_name=self.provider.model_name,
        )

    def _handle_commands(self) -> bool:
        for command in self.link.poll_control():
            self.stats.commands.append(command.command)
            result = P.AckResult.OK
            if command.command == P.ControlCommand.PING:
                self._last_ping = time.perf_counter()
            elif command.command == P.ControlCommand.START_CALIBRATION_FULL:
                self.pipeline.start_calibration("full")
            elif command.command == P.ControlCommand.START_CALIBRATION_QUICK:
                self.pipeline.start_calibration("quick")
            elif command.command == P.ControlCommand.CANCEL_CALIBRATION:
                result = P.AckResult.OK if self.pipeline.cancel_calibration() else P.AckResult.REJECTED
            elif command.command == P.ControlCommand.SET_PREVIEW:
                self.preview = command.arg != 0
                if not self.preview:
                    _close_preview()
            elif command.command == P.ControlCommand.SHUTDOWN:
                self.link.send_ack(command, P.AckResult.OK)
                self.stats.exit_reason = "shutdown command"
                return False
            else:
                result = P.AckResult.UNSUPPORTED
            log.info("control %s id=%d -> %s", command.command.name, command.command_id, result.name)
            self.link.send_ack(command, result)
        return True

    def step(self) -> bool:
        frame = self.provider.next()
        if frame is None:
            self.stats.exit_reason = "source finished"
            return False
        out = self.pipeline.process(frame.sample, frame.sample.t if frame.sample is not None else frame.source_t)
        if self.provider.state in (P.TrackerState.NO_CAMERA, P.TrackerState.STARTING):
            out.state = self.provider.state
        self._last_out = out
        capture_us = int(frame.capture_s * 1e6)
        self.link.send_frame(out, capture_us, self.provider.fps)
        self._latency_ms = 0.9 * self._latency_ms + 0.1 * max(0.0, (monotonic_us() - capture_us) / 1000.0)
        self.stats.frames += 1
        self.stats.calibration_state = out.calibration
        for punch in out.punches:
            self.stats.punches.append((frame.source_t, punch.hand))
            log.info("punch %s strength=%.2f", "LEFT" if punch.hand == 0 else "RIGHT", punch.strength)
        if self.recorder is not None:
            self.recorder.write(frame.source_t, frame.sample)

        # Persist a newly finished calibration.
        calibration = self.pipeline.calibration
        if calibration is not None and id(calibration) != self._saved_calibration_id:
            self._saved_calibration_id = id(calibration)
            try:
                calibration.save(self.calibration_path)
                log.info("calibration saved to %s", self.calibration_path)
            except OSError as error:
                log.warning("could not save calibration: %s", error)

        now = time.perf_counter()
        if now - self._last_status >= self.cfg.status_period:
            self._last_status = now
            self.link.send_status(self._status())
        if self.preview and frame.image is not None:
            _show_preview(frame.image, out)
        return True

    def run(self) -> AppStats:
        started = time.perf_counter()
        if self.opt.calibrate_on_start:
            self.pipeline.start_calibration(self.opt.calibrate_on_start)
        try:
            while True:
                if not self._handle_commands():
                    break
                if not self.step():
                    break
                now = time.perf_counter()
                if self.opt.max_seconds is not None and now - started >= self.opt.max_seconds:
                    self.stats.exit_reason = "max seconds"
                    break
                if self.opt.parent_pid and not parent_alive(self.opt.parent_pid):
                    self.stats.exit_reason = "parent process exited"
                    break
                if self.opt.managed and now - self._last_ping > self.opt.ping_timeout:
                    self.stats.exit_reason = "no ping from game"
                    break
        except KeyboardInterrupt:
            self.stats.exit_reason = "interrupted"
        finally:
            self.provider.close()
            self.link.close()
            if self.recorder is not None:
                self.recorder.close()
            _close_preview()
        log.info("tracker exit: %s", self.stats.exit_reason)
        return self.stats


_PREVIEW_WINDOW = "IRON ECHO tracker"


def _show_preview(image: np.ndarray, out: FrameOutput) -> None:
    import cv2

    view = cv2.flip(image, 1)  # selfie view for the player; data itself is never mirrored here
    lines = [
        f"{out.state.name}  conf {out.confidence:.2f}",
        f"calib {out.calibration.name} {out.step.name} {out.progress}%  mirror={out.mirror}",
        f"lean {out.lean_lateral:+.2f}  block {out.block:.2f}  ext L {out.extension[0]:.2f} R {out.extension[1]:.2f}",
    ]
    if out.punches:
        lines.append("PUNCH " + " ".join("LEFT" if p.hand == 0 else "RIGHT" for p in out.punches))
    for index, text in enumerate(lines):
        cv2.putText(view, text, (10, 24 + 22 * index), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2)
    cv2.imshow(_PREVIEW_WINDOW, view)
    cv2.waitKey(1)


def _close_preview() -> None:
    try:
        import cv2

        cv2.destroyWindow(_PREVIEW_WINDOW)
    except Exception:  # noqa: BLE001 - window may not exist / headless OpenCV
        pass
