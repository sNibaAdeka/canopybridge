"""Calibration and gesture interpretation on synthetic bodies.

Synthetic data proves the logic and guards regressions; thresholds must still be validated on real
recordings (Docs/Testing/HUMAN_TRIALS.md, `run --record`).
"""

import numpy as np
import pytest

from iron_echo_tracker import synth
from iron_echo_tracker.body import BodyPose, mirror_correct, mirror_raw, to_body_frame
from iron_echo_tracker.calibration import CalibrationData
from iron_echo_tracker.config import TrackerConfig
from iron_echo_tracker.pipeline import TrackerPipeline
from iron_echo_tracker.protocol import CalibrationFailure, CalibrationState, CalibrationStep, TrackerState


def run(script, fps=30, seed=1, calibrate="full", calibration=None, **body):
    pipe = TrackerPipeline(TrackerConfig(), calibration)
    if calibrate:
        pipe.start_calibration(calibrate)
    outputs = []
    for t, sample in synth.stream(script, fps=fps, seed=seed, **body):
        outputs.append(pipe.process(sample, t))
    return pipe, outputs


def punches(outputs):
    return [(round(o.t, 3), p.hand) for o in outputs for p in o.punches]


def test_axes_conversion_and_mirror_roundtrip():
    rng = np.random.default_rng(0)
    world = rng.normal(size=(33, 3))
    vis = rng.uniform(size=33)
    body = to_body_frame(world)
    assert np.allclose(body[:, 0], -world[:, 2]) and np.allclose(body[:, 1], -world[:, 0]) and np.allclose(body[:, 2], -world[:, 1])
    mirrored_world, mirrored_vis = mirror_raw(world, vis)
    fixed, fixed_vis = mirror_correct(to_body_frame(mirrored_world), mirrored_vis)
    assert np.allclose(fixed, body) and np.allclose(fixed_vis, vis)


@pytest.mark.parametrize("mirror", [False, True])
@pytest.mark.parametrize("fps", [30, 60])
def test_full_calibration(mirror, fps):
    pipe, outputs = run(synth.calibration_script(), fps=fps, mirror=mirror)
    steps = []
    for out in outputs:
        if not steps or steps[-1] != out.step:
            steps.append(out.step)
    assert steps == [CalibrationStep.NEUTRAL, CalibrationStep.RAISE_RIGHT_HAND, CalibrationStep.SLIP_LEFT,
                     CalibrationStep.SLIP_RIGHT, CalibrationStep.DONE]
    c = pipe.calibration
    assert c is not None and c.mode == "full"
    assert c.mirror == mirror
    assert c.arm_length[0] == pytest.approx(0.57, abs=0.03) and c.arm_length[1] == pytest.approx(0.57, abs=0.03)
    assert 0.12 < c.slip_range_left < 0.25 and 0.12 < c.slip_range_right < 0.25
    assert c.guard_wrist_height[0] == pytest.approx(0.16, abs=0.03)
    # No punches are reported while calibrating.
    assert punches([o for o in outputs if o.calibration == CalibrationState.IN_PROGRESS]) == []


def test_quick_calibration_keeps_previous_mirror_and_ranges():
    previous = CalibrationData(mode="full", mirror=True, slip_range_left=0.21, slip_range_right=0.19)
    script = synth.Script().idle(0, 3.0)
    pipe, outputs = run(script, calibrate="quick", calibration=previous, mirror=True)
    c = pipe.calibration
    assert c.mode == "quick" and c.mirror is True
    assert (c.slip_range_left, c.slip_range_right) == (0.21, 0.19)
    assert outputs[-1].calibration == CalibrationState.VALID


def test_calibration_times_out_without_person():
    script = synth.Script().hide(0, 25.0)
    pipe, outputs = run(script, fps=15)
    assert pipe.calibration is None
    assert outputs[-1].calibration == CalibrationState.FAILED
    assert outputs[-1].failure == CalibrationFailure.LOW_VISIBILITY


def test_neutral_waits_for_stillness():
    script = synth.Script()
    for k in range(6):  # restless player: slips every 0.6 s for ~3.6 s
        script.slip(k * 0.6, 0.4, 0.15 if k % 2 else -0.15)
    script.idle(3.6, 3.0)
    pipe, outputs = run(script)
    neutral_done = next(o.t for o in outputs if o.step != CalibrationStep.NEUTRAL)
    last_motion_end = 5 * 0.6 + 0.4
    assert last_motion_end + 1.4 < neutral_done < last_motion_end + 1.8


@pytest.mark.parametrize("fps", [30, 60])
@pytest.mark.parametrize("seed", [1, 2, 3])
def test_jab_cross_detected_with_low_latency(fps, seed):
    script = synth.training_session(punches=6, start=8.5, gap=0.7)
    _, outputs = run(script, fps=fps, seed=seed)
    found = punches(outputs)
    assert [h for _, h in found] == [0, 1, 0, 1, 0, 1]
    starts = [8.5 + k * 0.7 for k in range(6)]
    latencies = [t - s for (t, _), s in zip(found, starts)]
    assert all(0 < lat <= 0.12 for lat in latencies), latencies


def test_one_two_combo_both_detected():
    script = synth.calibration_script()
    script.punch(8.5, 0)
    script.punch(8.85, 1)
    script.idle(9.5, 1.0)
    _, outputs = run(script)
    assert [h for _, h in punches(outputs)] == [0, 1]


def test_no_false_punches_from_block_slip_lean_or_hand_drop():
    script = synth.calibration_script()
    script.block(8.5, 1.5)
    script.slip(10.5, 0.8, -0.22)
    script.slip(11.6, 0.8, 0.22)
    script.lean_forward(12.8, 0.8, 0.15)
    script.hands_down(14.0, 1.2)
    script.idle(15.5, 4.0)
    for seed in range(5):
        _, outputs = run(script, seed=seed)
        assert punches([o for o in outputs if o.t > 8.0]) == [], seed


def test_block_and_lean_values():
    script = synth.calibration_script()
    script.block(8.5, 1.4)
    script.slip(10.4, 0.9, -0.2)
    script.slip(11.6, 0.9, 0.2)
    script.idle(12.6, 1.0)
    _, outputs = run(script)
    block = [o.block for o in outputs if 8.8 < o.t < 9.6]
    idle_block = [o.block for o in outputs if 7.5 < o.t < 8.4]
    assert min(block) > 0.8 and max(idle_block) < 0.1
    left = min(o.lean_lateral for o in outputs if 10.6 < o.t < 11.1)
    right = max(o.lean_lateral for o in outputs if 11.8 < o.t < 12.3)
    idle = [abs(o.lean_lateral) for o in outputs if 7.5 < o.t < 8.4]
    assert left < -0.8 and right > 0.8 and max(idle) < 0.25


def test_mirrored_camera_reports_anatomical_sides():
    script = synth.training_session(punches=4)
    _, outputs = run(script, mirror=True)
    assert [h for _, h in punches(outputs)] == [0, 1, 0, 1]
    assert outputs[-1].mirror is True
    script = synth.calibration_script()
    script.slip(8.5, 0.8, -0.2)
    _, outputs = run(script, mirror=True)
    assert min(o.lean_lateral for o in outputs if 8.7 < o.t < 9.2) < -0.8  # player's LEFT stays negative


def test_lost_person_and_low_confidence_states():
    script = synth.calibration_script()
    script.hide(8.5, 0.5)
    script.idle(9.0, 1.0)
    _, outputs = run(script)
    assert any(o.state == TrackerState.NO_PERSON for o in outputs if 8.6 < o.t < 8.9)
    assert outputs[-1].state == TrackerState.TRACKING
    _, low = run(synth.Script().idle(0, 1.0), visibility=0.3, calibrate=None)
    assert all(o.state == TrackerState.LOW_CONFIDENCE for o in low)
    assert punches(low) == []


def test_calibration_file_roundtrip(tmp_path):
    data = CalibrationData(mode="full", mirror=True, arm_length=(0.6, 0.58))
    path = tmp_path / "c.json"
    data.save(path)
    loaded = CalibrationData.load(path)
    assert loaded == data
    path.write_text('{"version": 1, "mode": "full", "arm_length": [5.0, 5.0]}')
    assert CalibrationData.load(path) is None  # insane values rejected
    path.write_text("not json")
    assert CalibrationData.load(path) is None


def test_body_pose_helpers_on_synth():
    sample = synth.SynthBody(seed=0, noise=0.0, depth_noise=0.0).sample(synth.Script().idle(0, 1), 0.0)
    pose = BodyPose.from_sample(sample, False)
    assert pose.p[11][1] < 0 < pose.p[12][1]  # left shoulder on -Y
    assert pose.head()[2] > pose.shoulder_mid()[2] > pose.hip_mid()[2]
    assert pose.arm_length(0) == pytest.approx(0.57, abs=1e-3)
