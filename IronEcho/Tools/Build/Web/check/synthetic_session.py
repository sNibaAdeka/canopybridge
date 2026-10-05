"""Synthetic camera session for the release QA (Tests/Web/qa.js, camera check).

    python Tools/Build/Web/check/synthetic_session.py out.json

A scripted person from Tracking/iron_echo_tracker/synth.py: full calibration (neutral, slip left, slip right) and then
40 punches, sampled at 60 fps as MediaPipe world landmarks [x, y, z, visibility] - exactly what the browser's pose
module receives from PoseLandmarker.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[4] / "Tracking"))

from iron_echo_tracker import synth  # noqa: E402


def main() -> None:
    script = synth.training_session(40, gap=0.9)
    frames = []
    for t, sample in synth.stream(script, fps=60.0, seed=7):
        world = None
        if sample is not None:
            world = [[round(float(v), 5) for v in row] + [round(float(vis), 3)] for row, vis in zip(sample.world, sample.visibility)]
        frames.append({"t": round(t, 5), "w": world})
    Path(sys.argv[1]).write_text(json.dumps(frames), encoding="utf-8")
    print(f"{len(frames)} frames, {frames[-1]['t']} s")


if __name__ == "__main__":
    main()
