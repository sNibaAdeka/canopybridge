"""Command line entry point (also the entry of the packaged IronEchoTracker.exe)."""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import sys
import time
import urllib.request
from pathlib import Path
from typing import List, Optional

from . import __version__
from . import protocol as P
from .config import TrackerConfig
from .sources import MODEL_URL, MODELS, models_dir


def _setup_logging(log_dir: Optional[str], verbose: bool) -> None:
    handlers: List[logging.Handler] = [logging.StreamHandler(sys.stderr)]
    if log_dir:
        path = Path(log_dir)
        path.mkdir(parents=True, exist_ok=True)
        handlers.append(logging.FileHandler(path / "IronEchoTracker.log", mode="w", encoding="utf-8"))
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        handlers=handlers,
        force=True,
    )


def _app_options(args):
    from .app import AppOptions

    return AppOptions(
        game_port=args.game_port,
        control_port=args.control_port,
        token=args.token,
        parent_pid=args.parent_pid,
        managed=args.managed,
        calibration_path=Path(args.calibration) if args.calibration else None,
        use_saved_calibration=not args.no_saved_calibration,
        calibrate_on_start=None if args.calibrate == "none" else args.calibrate,
        preview=getattr(args, "preview", False),
        record=Path(args.record) if getattr(args, "record", None) else None,
        max_seconds=args.max_seconds,
    )


def _add_link_args(parser: argparse.ArgumentParser, calibrate_default: str = "none") -> None:
    parser.add_argument("--game-port", type=int, default=47810)
    parser.add_argument("--control-port", type=int, default=47811)
    parser.add_argument("--token", type=int, default=0, help="session token issued by the game (0 = developer mode)")
    parser.add_argument("--parent-pid", type=int, default=0, help="exit when this process exits")
    parser.add_argument("--managed", action="store_true", help="exit if the game stops sending Ping for 10 s")
    parser.add_argument("--calibration", help="calibration file (default: per-user app data)")
    parser.add_argument("--no-saved-calibration", action="store_true")
    parser.add_argument("--calibrate", choices=["none", "quick", "full"], default=calibrate_default)
    parser.add_argument("--config", help="JSON overrides for TrackerConfig")
    parser.add_argument("--max-seconds", type=float)
    parser.add_argument("--log-dir")
    parser.add_argument("--verbose", action="store_true")


def cmd_run(args) -> int:
    from .app import CameraProvider, TrackerApp
    from .sources import resolve_model

    _setup_logging(args.log_dir, args.verbose)
    config = TrackerConfig.load(Path(args.config) if args.config else None)
    try:
        model = resolve_model(args.model)
    except FileNotFoundError as error:
        logging.error("%s", error)
        model = Path(args.model)
    provider = CameraProvider(args.camera, model, args.width, args.height, args.fps, args.backend, keep_image=True)
    stats = TrackerApp(provider, config, _app_options(args)).run()
    print(json.dumps({"frames": stats.frames, "punches": len(stats.punches), "exit": stats.exit_reason}))
    return 0


def cmd_simulate(args) -> int:
    from . import synth
    from .app import IterProvider, TrackerApp

    _setup_logging(args.log_dir, args.verbose)
    config = TrackerConfig.load(Path(args.config) if args.config else None)
    script = synth.SCRIPTS[args.script]()

    def frames():
        offset = 0.0
        while True:
            for t, sample in synth.stream(script, fps=args.fps, seed=args.seed, start_time=offset, mirror=args.mirror):
                yield t, sample
            if not args.loop:
                return
            offset += script.duration + 1.0 / args.fps

    provider = IterProvider(frames(), speed=args.speed, name=f"synthetic:{args.script}")
    stats = TrackerApp(provider, config, _app_options(args)).run()
    print(json.dumps({"frames": stats.frames, "punches": [[round(t, 3), h] for t, h in stats.punches],
                      "calibration": stats.calibration_state.name, "exit": stats.exit_reason}))
    return 0


def cmd_replay(args) -> int:
    from .app import IterProvider, TrackerApp
    from .sources import read_recording

    _setup_logging(args.log_dir, args.verbose)
    config = TrackerConfig.load(Path(args.config) if args.config else None)
    provider = IterProvider(read_recording(Path(args.file)), speed=args.speed, name="replay")
    stats = TrackerApp(provider, config, _app_options(args)).run()
    print(json.dumps({"frames": stats.frames, "punches": [[round(t, 3), h] for t, h in stats.punches],
                      "calibration": stats.calibration_state.name, "exit": stats.exit_reason}))
    return 0


def cmd_list_cameras(args) -> int:
    from .sources import list_cameras

    cameras = list_cameras(args.max_index, args.backend)
    print(json.dumps([{"index": i, "width": w, "height": h, "fps": f} for i, w, h, f in cameras]))
    return 0 if cameras else 1


def cmd_golden(args) -> int:
    from .golden import write_vectors

    for path in write_vectors(Path(args.out)):
        print(path)
    return 0


def cmd_fetch_models(args) -> int:
    names = list(MODELS) if args.name == "all" else [args.name]
    target = Path(args.out) if args.out else models_dir()
    target.mkdir(parents=True, exist_ok=True)
    for name in names:
        filename, expected = MODELS[name]
        path = target / filename
        if path.exists() and hashlib.sha256(path.read_bytes()).hexdigest() == expected:
            print(f"{path} ok")
            continue
        url = MODEL_URL.format(name=name)
        data = urllib.request.urlopen(url, timeout=120).read()  # noqa: S310 - fixed https URL
        digest = hashlib.sha256(data).hexdigest()
        if digest != expected:
            print(f"{name}: sha256 mismatch {digest} != {expected}", file=sys.stderr)
            return 2
        path.write_bytes(data)
        print(f"{path} downloaded")
    return 0


def cmd_probe_image(args) -> int:
    """Runs PoseLandmarker on one image and prints the body-frame summary (axis sanity check)."""
    import mediapipe as mp
    from mediapipe.tasks.python import BaseOptions, vision

    from .body import BodyPose
    from .sources import pose_sample_from_result, resolve_model

    options = vision.PoseLandmarkerOptions(base_options=BaseOptions(model_asset_path=str(resolve_model(args.model))),
                                           running_mode=vision.RunningMode.IMAGE, num_poses=1)
    with vision.PoseLandmarker.create_from_options(options) as landmarker:
        image = mp.Image.create_from_file(args.image)
        started = time.perf_counter()
        result = landmarker.detect(image)
        elapsed = (time.perf_counter() - started) * 1000.0
    sample = pose_sample_from_result(result, 0.0)
    report = {"image": args.image, "model": args.model, "ms": round(elapsed, 1), "person": sample is not None}
    if sample is not None:
        pose = BodyPose.from_sample(sample, False)
        report.update({
            "left_shoulder_body_y": round(float(pose.p[11][1]), 3),
            "right_shoulder_body_y": round(float(pose.p[12][1]), 3),
            "head_above_hips_z": round(float(pose.head()[2] - pose.hip_mid()[2]), 3),
            "shoulder_width_m": round(pose.shoulder_width(), 3),
            "axes_ok": bool(pose.p[11][1] < pose.p[12][1] and pose.head()[2] > pose.hip_mid()[2]),
        })
    print(json.dumps(report))
    return 0 if sample is not None and report.get("axes_ok") else 1


def cmd_selftest(args) -> int:
    """Self-contained smoke test: synthetic session -> UDP -> local listener; optional model load check."""
    from . import synth
    from .app import AppOptions, IterProvider, TrackerApp
    from .net import GameListener

    _setup_logging(None, False)
    report = {"version": __version__, "protocol": f"{P.SCHEMA_MAJOR}.{P.SCHEMA_MINOR}"}
    ok = True
    listener = GameListener(0)
    try:
        script = synth.training_session(punches=4)
        provider = IterProvider(synth.stream(script, fps=30, seed=11), speed=args.speed, name="selftest")
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            options = AppOptions(game_port=listener.port, control_port=0, token=777, calibrate_on_start="full",
                                 calibration_path=Path(tmp) / "calibration.json")
            stats = TrackerApp(provider, TrackerConfig(), options).run()
        packets = listener.receive_all(0.3)
        poses = [p for p in packets if p.header.packet_type == P.PacketType.POSE_FRAME]
        event_ids = sorted({e.event_id for p in poses for e in p.body.events})
        sequences = [p.header.sequence for p in packets]
        report.update({
            "frames": stats.frames,
            "packets_received": len(packets),
            "pose_frames": len(poses),
            "calibration": stats.calibration_state.name,
            "punch_events": len(event_ids),
            "hands": [h for _, h in stats.punches],
            "sequence_monotonic": sequences == sorted(sequences),
        })
        ok &= stats.calibration_state == P.CalibrationState.VALID
        ok &= len(event_ids) == 4 and [h for _, h in stats.punches] == [0, 1, 0, 1]
        ok &= report["sequence_monotonic"] and len(poses) > 0.8 * stats.frames
    finally:
        listener.close()

    if args.model != "none":
        try:
            import numpy as np

            from .sources import MediaPipePose, resolve_model

            pose = MediaPipePose(resolve_model(args.model))
            blank = np.zeros((480, 640, 3), dtype=np.uint8)
            started = time.perf_counter()
            pose.detect(blank, 0.0)
            pose.detect(blank, 0.033)
            report["model"] = pose.model_name
            report["model_inference_ms"] = round((time.perf_counter() - started) * 500.0, 1)
            pose.close()
        except Exception as error:  # noqa: BLE001
            report["model_error"] = str(error)
            ok = False
    report["ok"] = bool(ok)
    print(json.dumps(report))
    return 0 if ok else 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="IronEchoTracker", description="IRON ECHO camera tracker")
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__} (protocol {P.SCHEMA_MAJOR}.{P.SCHEMA_MINOR})")
    sub = parser.add_subparsers(dest="command", required=True)

    run = sub.add_parser("run", help="track a live camera")
    run.add_argument("--camera", type=int, default=0)
    run.add_argument("--width", type=int, default=640)
    run.add_argument("--height", type=int, default=480)
    run.add_argument("--fps", type=int, default=60)
    run.add_argument("--backend", default="auto", choices=["auto", "dshow", "msmf", "v4l2", "any"])
    run.add_argument("--model", default="full", help="lite | full | heavy | path to .task")
    run.add_argument("--preview", action="store_true", help="show the tracker debug window")
    run.add_argument("--record", help="write a JSONL pose recording for offline tuning")
    _add_link_args(run)
    run.set_defaults(func=cmd_run)

    simulate = sub.add_parser("simulate", help="drive the game with a synthetic body (debug only)")
    simulate.add_argument("--script", default="demo", choices=sorted(__import__("iron_echo_tracker.synth", fromlist=["SCRIPTS"]).SCRIPTS))
    simulate.add_argument("--fps", type=float, default=30.0)
    simulate.add_argument("--speed", type=float, default=1.0)
    simulate.add_argument("--seed", type=int, default=1)
    simulate.add_argument("--mirror", action="store_true")
    simulate.add_argument("--loop", action="store_true")
    _add_link_args(simulate, calibrate_default="full")
    simulate.set_defaults(func=cmd_simulate)

    replay = sub.add_parser("replay", help="replay a JSONL recording into the game")
    replay.add_argument("file")
    replay.add_argument("--speed", type=float, default=1.0)
    _add_link_args(replay)
    replay.set_defaults(func=cmd_replay)

    cams = sub.add_parser("list-cameras")
    cams.add_argument("--max-index", type=int, default=6)
    cams.add_argument("--backend", default="auto", choices=["auto", "dshow", "msmf", "v4l2", "any"])
    cams.set_defaults(func=cmd_list_cameras)

    golden = sub.add_parser("golden", help="write protocol golden vectors")
    golden.add_argument("--out", required=True)
    golden.set_defaults(func=cmd_golden)

    fetch = sub.add_parser("fetch-models", help="download MediaPipe pose models (sha256 verified)")
    fetch.add_argument("--name", default="all", choices=["all", *MODELS])
    fetch.add_argument("--out")
    fetch.set_defaults(func=cmd_fetch_models)

    probe = sub.add_parser("probe-image", help="pose on a still image + axis sanity check")
    probe.add_argument("image")
    probe.add_argument("--model", default="full")
    probe.set_defaults(func=cmd_probe_image)

    selftest = sub.add_parser("selftest", help="packaging / environment smoke test")
    selftest.add_argument("--model", default="full", help="model to load-test, or 'none'")
    selftest.add_argument("--speed", type=float, default=4.0)
    selftest.set_defaults(func=cmd_selftest)
    return parser


def main(argv: Optional[List[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    return int(args.func(args))
