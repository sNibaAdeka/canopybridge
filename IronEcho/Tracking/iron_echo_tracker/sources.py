"""Frame sources: live camera + MediaPipe, recorded JSONL sessions, synthetic scripts."""

from __future__ import annotations

import json
import os
import sys
import threading
import time
from pathlib import Path
from typing import Iterator, List, Optional, Tuple

import numpy as np

from .body import NUM_LANDMARKS, PoseSample

RECORDING_FORMAT = "iron-echo-pose-recording"
RECORDING_VERSION = 1


# ----------------------------------------------------------------------------- model files

MODELS = {
    # name -> (file, sha256) ; Apache-2.0 models from storage.googleapis.com/mediapipe-models (verified 2026-10-02)
    "lite": ("pose_landmarker_lite.task", "59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a"),
    "full": ("pose_landmarker_full.task", "4eaa5eb7a98365221087693fcc286334cf0858e2eb6e15b506aa4a7ecdcec4ad"),
    "heavy": ("pose_landmarker_heavy.task", "64437af838a65d18e5ba7a0d39b465540069bc8aae8308de3e318aad31fcbc7b"),
}
MODEL_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_{name}/float16/latest/pose_landmarker_{name}.task"


def models_dir() -> Path:
    """Packaged (PyInstaller) builds carry models next to the code; dev builds use Tracking/models."""
    bundle = getattr(sys, "_MEIPASS", None)
    if bundle:
        return Path(bundle) / "models"
    return Path(__file__).resolve().parent.parent / "models"


def resolve_model(name_or_path: str) -> Path:
    candidate = Path(name_or_path)
    if candidate.suffix == ".task" and candidate.exists():
        return candidate
    if name_or_path not in MODELS:
        raise FileNotFoundError(f"unknown model '{name_or_path}' (use lite/full/heavy or a .task path)")
    path = models_dir() / MODELS[name_or_path][0]
    if not path.exists():
        raise FileNotFoundError(f"model file missing: {path} (run: python -m iron_echo_tracker fetch-models)")
    return path


# ----------------------------------------------------------------------------- camera


def list_cameras(max_index: int = 6, backend: str = "auto") -> List[Tuple[int, int, int, float]]:
    import cv2

    found = []
    for index in range(max_index):
        cap = cv2.VideoCapture(index, _backend_id(backend))
        if cap.isOpened():
            ok, frame = cap.read()
            if ok and frame is not None:
                found.append((index, frame.shape[1], frame.shape[0], float(cap.get(cv2.CAP_PROP_FPS) or 0.0)))
        cap.release()
    return found


def _backend_id(backend: str) -> int:
    import cv2

    if backend == "auto":
        return cv2.CAP_DSHOW if sys.platform == "win32" else cv2.CAP_ANY
    return {"dshow": cv2.CAP_DSHOW, "msmf": cv2.CAP_MSMF, "v4l2": cv2.CAP_V4L2, "any": cv2.CAP_ANY}[backend]


class CameraSource:
    """Background capture thread that always exposes only the newest frame (no queueing latency)."""

    def __init__(self, index: int, width: int = 640, height: int = 480, fps: int = 60, backend: str = "auto", mjpg: bool = True):
        import cv2

        self.cv2 = cv2
        self.index = index
        self.cap = cv2.VideoCapture(index, _backend_id(backend))
        if not self.cap.isOpened():
            raise RuntimeError(f"camera {index} could not be opened")
        if mjpg:
            self.cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
        self.cap.set(cv2.CAP_PROP_FPS, fps)
        self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        self.width = int(self.cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        self.height = int(self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        self._lock = threading.Lock()
        self._frame: Optional[np.ndarray] = None
        self._frame_t = 0.0
        self._frame_id = 0
        self._consumed_id = 0
        self._fps_times: List[float] = []
        self.read_failures = 0
        self._running = True
        self._thread = threading.Thread(target=self._run, name="camera", daemon=True)
        self._thread.start()

    def _run(self) -> None:
        while self._running:
            ok, frame = self.cap.read()
            t = time.perf_counter()
            if not ok or frame is None:
                self.read_failures += 1
                time.sleep(0.01)
                continue
            with self._lock:
                self._frame = frame
                self._frame_t = t
                self._frame_id += 1
                self._fps_times.append(t)
                while self._fps_times and t - self._fps_times[0] > 1.0:
                    self._fps_times.pop(0)

    @property
    def fps(self) -> float:
        with self._lock:
            return float(max(0, len(self._fps_times) - 1))

    def latest(self, timeout: float = 0.5) -> Tuple[Optional[np.ndarray], float]:
        deadline = time.perf_counter() + timeout
        while time.perf_counter() < deadline:
            with self._lock:
                if self._frame is not None and self._frame_id != self._consumed_id:
                    self._consumed_id = self._frame_id
                    return self._frame, self._frame_t
            time.sleep(0.001)
        return None, 0.0

    def close(self) -> None:
        self._running = False
        self._thread.join(timeout=1.0)
        self.cap.release()


class MediaPipePose:
    """PoseLandmarker in VIDEO mode (temporal tracking, monotonic timestamps)."""

    def __init__(self, model_path: Path, num_threads: int = 0):
        import mediapipe as mp
        from mediapipe.tasks.python import BaseOptions, vision

        self.mp = mp
        options = vision.PoseLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(model_path)),
            running_mode=vision.RunningMode.VIDEO,
            num_poses=1,
            min_pose_detection_confidence=0.5,
            min_pose_presence_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        self.landmarker = vision.PoseLandmarker.create_from_options(options)
        self.model_name = Path(model_path).stem
        self._last_ms = -1

    def detect(self, frame_bgr: np.ndarray, t: float) -> Optional[PoseSample]:
        import cv2

        rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        image = self.mp.Image(image_format=self.mp.ImageFormat.SRGB, data=rgb)
        ms = max(self._last_ms + 1, int(t * 1000))
        self._last_ms = ms
        result = self.landmarker.detect_for_video(image, ms)
        return pose_sample_from_result(result, t)

    def close(self) -> None:
        self.landmarker.close()


def pose_sample_from_result(result, t: float) -> Optional[PoseSample]:
    if not result.pose_world_landmarks:
        return None
    world = result.pose_world_landmarks[0]
    if len(world) != NUM_LANDMARKS:
        return None
    points = np.array([[lm.x, lm.y, lm.z] for lm in world], dtype=np.float64)
    visibility = np.array([lm.visibility if lm.visibility is not None else 0.0 for lm in world], dtype=np.float64)
    return PoseSample(t=t, world=points, visibility=visibility)


# ----------------------------------------------------------------------------- recordings


class Recorder:
    def __init__(self, path: Path, meta: dict):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.file = self.path.open("w", encoding="utf-8", newline="\n")
        self.file.write(json.dumps({"format": RECORDING_FORMAT, "version": RECORDING_VERSION, **meta}) + "\n")

    def write(self, t: float, sample: Optional[PoseSample]) -> None:
        line = sample.to_json() if sample is not None else {"t": round(t, 6), "world": None}
        self.file.write(json.dumps(line, separators=(",", ":")) + "\n")

    def close(self) -> None:
        self.file.close()


def read_recording(path: Path) -> Iterator[Tuple[float, Optional[PoseSample]]]:
    with Path(path).open("r", encoding="utf-8") as handle:
        header = json.loads(handle.readline())
        if header.get("format") != RECORDING_FORMAT or header.get("version") != RECORDING_VERSION:
            raise ValueError(f"{path}: not an IRON ECHO pose recording v{RECORDING_VERSION}")
        for line in handle:
            if not line.strip():
                continue
            obj = json.loads(line)
            yield float(obj["t"]), PoseSample.from_json(obj)


def parent_alive(pid: int) -> bool:
    if pid <= 0:
        return True
    if sys.platform == "win32":
        import ctypes

        SYNCHRONIZE = 0x00100000
        kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
        handle = kernel32.OpenProcess(SYNCHRONIZE, False, pid)
        if not handle:
            return False
        try:
            return kernel32.WaitForSingleObject(handle, 0) == 0x00000102  # WAIT_TIMEOUT -> still running
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True
