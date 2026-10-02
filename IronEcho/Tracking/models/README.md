# MediaPipe pose models

Model binaries are not committed. Download and verify (sha256 pinned in `iron_echo_tracker/sources.py`):

    python -m iron_echo_tracker fetch-models

Source: https://storage.googleapis.com/mediapipe-models/pose_landmarker/ (Apache-2.0).
The packaged tracker bundles `pose_landmarker_full.task` (default) and `pose_landmarker_lite.task`.
