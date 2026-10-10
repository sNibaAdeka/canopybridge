"""Synthetic camera session for the release QA (Tests/Web/qa.js, camera check).

    python Tools/Build/Web/check/synthetic_session.py out.json

A scripted person from Tracking/iron_echo_tracker/synth.py: the web calibration (neutral, block, slip left, slip right) and then
40 punches, four kicks, a block and a 2.5 s lean toward the screen (the camera step-in), sampled at 60 fps as MediaPipe world
landmarks [x, y, z, visibility] - exactly what the browser pose
module receives from PoseLandmarker.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[4] / "Tracking"))

from iron_echo_tracker import synth  # noqa: E402


def main() -> None:
    # the web calibration: neutral -> block -> slip left -> slip right -> two jabs and two crosses at the screen (1.6)
    # (the tracker process has neither the block nor the punch step)
    script = synth.Script()
    script.idle(0.0, 2.2)
    script.block(2.2, 1.6)
    script.idle(3.8, 0.4)
    script.slip(4.2, 1.1, -0.20)
    script.idle(5.3, 0.4)
    script.slip(5.7, 1.1, 0.20)
    script.idle(6.8, 1.0)
    for index, side in enumerate((0, 0, 1, 1)):  # the punch calibration step
        script.punch(7.8 + index * 0.9, side)
    start = 7.8 + 4 * 0.9 + 0.6
    for index in range(40):
        script.punch(start + index * 0.9, index % 2)
    t = start + 40 * 0.9 + 0.8
    for index, (side, peak) in enumerate([(0, 0.75), (1, 0.75), (0, 0.30), (1, 0.30)]):  # mid, mid, low, low kicks
        script.kick(t + index * 1.1, side, peak=peak)
    t += 4 * 1.1 + 0.5
    script.block(t, 1.4)  # a block after calibration: the personal block pose must read it
    t += 1.8
    script.lean_forward(t, 2.5, 0.30)  # 30 cm toward the camera: leanForward ~1.2
    script.idle(script.duration, 1.0)
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
