"""Reference run of the Python tracker (Tracking/iron_echo_tracker) on synthetic sessions, for the browser port.

    python Tools/Build/Web/check/pose_reference.py out.json

Writes the raw MediaPipe-world frames and what the real TrackerPipeline made of them (punch events, block, lean) so
check_pose.mjs can replay the same frames through the JS port (site/src/pose.js) and compare.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[4] / "Tracking"))

from iron_echo_tracker import synth  # noqa: E402
from iron_echo_tracker.config import TrackerConfig  # noqa: E402
from iron_echo_tracker.pipeline import TrackerPipeline  # noqa: E402
from iron_echo_tracker.protocol import CalibrationState  # noqa: E402


def session(name, script, fps, seed):
    pipe = TrackerPipeline(TrackerConfig())
    pipe.start_calibration("full")
    frames, punches, cont = [], [], []
    for t, sample in synth.stream(script, fps=fps, seed=seed):
        out = pipe.process(sample, t)
        frames.append({"t": t, "world": None if sample is None else [[float(v) for v in row] + [float(vis)] for row, vis in zip(sample.world, sample.visibility)]})
        calibrated = out.calibration == CalibrationState.VALID
        for p in out.punches:
            punches.append([round(p.t, 6), p.hand])
        cont.append([round(t, 6), calibrated, round(out.block, 5), round(out.lean_lateral, 5), round(out.lean_forward, 5)])
    return {"name": name, "fps": fps, "frames": frames, "punches": punches, "continuous": cont}


def main():
    out = Path(sys.argv[1])
    sessions = [session("demo-30fps", synth.demo_session(), 30.0, 1), session("demo-60fps", synth.demo_session(), 60.0, 2),
                session("training-30fps", synth.training_session(8), 30.0, 3)]
    out.write_text(json.dumps(sessions), encoding="utf-8")
    for s in sessions:
        print(f"{s['name']}: {len(s['frames'])} frames, python punches: {len(s['punches'])}")


if __name__ == "__main__":
    main()
