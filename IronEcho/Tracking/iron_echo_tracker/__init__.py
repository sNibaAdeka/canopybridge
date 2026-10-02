"""IRON ECHO camera tracker: separate process that turns a webcam into game input.

Pipeline: camera -> MediaPipe PoseLandmarker -> body frame -> calibration -> gestures -> UDP (LOCAL_PROTOCOL v1).
"""

__version__ = "0.1.0"
PROTOCOL_MAJOR = 1
PROTOCOL_MINOR = 0
INPUT_CONTRACT_VERSION = 1
