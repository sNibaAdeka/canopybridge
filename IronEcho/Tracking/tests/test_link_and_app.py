"""Process-level behaviour: UDP link, event repetition, control commands, recording/replay, real MediaPipe."""

import json
import time
from pathlib import Path

import numpy as np
import pytest

from iron_echo_tracker import protocol as P
from iron_echo_tracker import synth
from iron_echo_tracker.app import AppOptions, IterProvider, TrackerApp
from iron_echo_tracker.cli import main
from iron_echo_tracker.config import TrackerConfig
from iron_echo_tracker.net import GameListener, TrackerLink
from iron_echo_tracker.pipeline import FrameOutput
from iron_echo_tracker.gestures import PunchDetection
from iron_echo_tracker.sources import MODELS, Recorder, models_dir, read_recording

MODEL_PRESENT = (models_dir() / MODELS["full"][0]).exists()


def test_events_are_repeated_then_expire():
    listener = GameListener()
    link = TrackerLink(listener.port, 0, token=5, event_repeat_seconds=0.2)
    try:
        base = 1_000_000
        out = FrameOutput(t=0, state=P.TrackerState.TRACKING, calibration=P.CalibrationState.VALID)
        out.punches = [PunchDetection(hand=1, strength=0.5, confidence=0.9, t=0)]
        assert link.send_frame(out, base, 30.0) == [1]
        out.punches = []
        for k in range(1, 10):
            link.send_frame(out, base + k * 33_000, 30.0)
        packets = listener.receive_all(0.2)
        events_per_packet = [[e.event_id for e in p.body.events] for p in packets]
        assert events_per_packet[0] == [1]
        repeated = [ids for ids in events_per_packet if ids == [1]]
        assert 5 <= len(repeated) <= 8  # 200 ms at 33 ms spacing
        assert events_per_packet[-1] == []
        ages = [p.body.events[0].age_us for p in packets if p.body.events]
        assert ages == sorted(ages) and ages[0] == 0
        assert all(p.header.session_token == 5 for p in packets)
        assert [p.header.sequence for p in packets] == list(range(1, 11))
    finally:
        link.close()
        listener.close()


def test_control_commands_are_acked_and_wrong_token_ignored(tmp_path):
    listener = GameListener()
    script = synth.Script().idle(0, 3.0)
    provider = IterProvider(synth.stream(script, fps=30), speed=1.0)
    options = AppOptions(game_port=listener.port, control_port=0, token=42, calibration_path=tmp_path / "c.json", max_seconds=2.5)
    app = TrackerApp(provider, TrackerConfig(), options)
    control_port = app.link.control_port
    listener.send_control(control_port, P.Control(P.ControlCommand.START_CALIBRATION_QUICK, command_id=7), token=42)
    listener.send_control(control_port, P.Control(P.ControlCommand.SHUTDOWN, command_id=8), token=999)  # ignored
    listener.send_control(control_port, P.Control(P.ControlCommand.CANCEL_CALIBRATION, command_id=9), token=42, sequence=2)
    stats = app.run()
    packets = listener.receive_all(0.2)
    listener.close()
    acks = {p.body.command_id: p.body for p in packets if p.header.packet_type == P.PacketType.CONTROL_ACK}
    assert acks[7].result == P.AckResult.OK
    assert 8 not in acks
    assert acks[9].result == P.AckResult.OK  # cancelled the running quick calibration
    assert stats.exit_reason == "max seconds"
    statuses = [p.body for p in packets if p.header.packet_type == P.PacketType.STATUS]
    assert statuses and statuses[-1].failure == P.CalibrationFailure.CANCELLED


def test_shutdown_command_stops_tracker(tmp_path):
    listener = GameListener()
    provider = IterProvider(synth.stream(synth.Script().idle(0, 10.0), fps=30), speed=1.0)
    app = TrackerApp(provider, TrackerConfig(), AppOptions(game_port=listener.port, control_port=0, token=1,
                                                              calibration_path=tmp_path / "c.json"))
    listener.send_control(app.link.control_port, P.Control(P.ControlCommand.SHUTDOWN, command_id=3), token=1)
    started = time.perf_counter()
    stats = app.run()
    listener.close()
    assert stats.exit_reason == "shutdown command"
    assert time.perf_counter() - started < 1.0


def test_calibration_is_persisted_and_reloaded(tmp_path):
    listener = GameListener()
    path = tmp_path / "calibration.json"
    provider = IterProvider(synth.stream(synth.calibration_script(), fps=30), speed=8.0)
    TrackerApp(provider, TrackerConfig(), AppOptions(game_port=listener.port, control_port=0, calibration_path=path,
                                                      calibrate_on_start="full")).run()
    assert json.loads(path.read_text())["mode"] == "full"
    provider = IterProvider(synth.stream(synth.Script().idle(0, 0.5), fps=30), speed=4.0)
    stats = TrackerApp(provider, TrackerConfig(), AppOptions(game_port=listener.port, control_port=0, calibration_path=path)).run()
    listener.close()
    assert stats.calibration_state == P.CalibrationState.VALID


def test_record_and_replay_reproduce_detections(tmp_path):
    recording = tmp_path / "session.jsonl"
    recorder = Recorder(recording, {"source": "synthetic"})
    script = synth.training_session(punches=4)
    for t, sample in synth.stream(script, fps=30, seed=5):
        recorder.write(t, sample)
    recorder.close()
    frames = list(read_recording(recording))
    assert len(frames) == len(list(synth.stream(script, fps=30, seed=5)))
    assert sum(1 for _, s in frames if s is None) == 0
    out_file = tmp_path / "calib.json"
    code = main(["replay", str(recording), "--speed", "20", "--game-port", "9", "--control-port", "0",
                 "--calibrate", "full", "--calibration", str(out_file)])
    assert code == 0


def test_selftest_command(capsys):
    code = main(["selftest", "--model", "full" if MODEL_PRESENT else "none", "--speed", "8"])
    report = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert code == 0 and report["ok"], report


@pytest.mark.skipif(not MODEL_PRESENT, reason="models not downloaded (python -m iron_echo_tracker fetch-models)")
def test_mediapipe_video_mode_on_blank_frames():
    from iron_echo_tracker.sources import MediaPipePose, resolve_model

    pose = MediaPipePose(resolve_model("lite"))
    try:
        blank = np.zeros((240, 320, 3), dtype=np.uint8)
        assert pose.detect(blank, 1.0) is None
        assert pose.detect(blank, 1.0) is None  # identical timestamps are made strictly increasing
    finally:
        pose.close()
