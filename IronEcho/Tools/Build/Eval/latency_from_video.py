"""End-to-end delay of the camera controls from a phone video (game opened with ?latency=1).

The player throws clear punches from a still stance; the game flashes the top-left corner of the screen white at the moment it accepts each
strike. A phone films the player and the screen together at 60 fps. For every flash this script finds the start of the movement before it
(frame-difference energy in the player's area rising above its resting level) and reports the delay in milliseconds: p50, p95, all.

    python Tools/Build/Eval/latency_from_video.py video.mp4 [--motion-roi x,y,w,h] [--flash-roi x,y,w,h] [--fps 60]
    python Tools/Build/Eval/latency_from_video.py --selftest

ROIs are fractions of the frame (0..1). Without --flash-roi the flash is found automatically (the grid cell with the most short bright
pulses); without --motion-roi the movement is measured over the whole frame minus the flash area (works when the screen does not move much
before the flash; pass the player's area if it does). Needs opencv-python and numpy.
"""
from __future__ import annotations

import argparse
import sys

import numpy as np

GRID = 8
PULSE_JUMP = 40.0       # grey levels a flash adds to its cell
PULSE_MAX_FRAMES = 8    # a flash lasts two game frames: a few camera frames
SEARCH_BEFORE_S = 0.9   # the movement starts at most this long before the flash
REST_FROM_S = 1.6       # resting level measured in [flash - REST_FROM, flash - SEARCH_BEFORE]
ONSET_FACTOR = 3.0
CHANGE_LEVEL = 25       # grey levels: a pixel that changes more than this between frames is moving (sensor noise stays below)
MIN_CHANGED = 0.0008    # share of the area that must move for an onset (about 50 pixels at 240 px wide)


def _roi(arg: str | None):
    if not arg:
        return None
    x, y, w, h = (float(v) for v in arg.split(","))
    return x, y, w, h


def _crop(frame: np.ndarray, roi):
    if roi is None:
        return frame
    h, w = frame.shape[:2]
    x, y, rw, rh = roi
    return frame[int(y * h): int((y + rh) * h), int(x * w): int((x + rw) * w)]


def find_flash_cell(frames: list[np.ndarray]) -> tuple[int, int]:
    """grid cell whose brightness shows the most short upward pulses"""
    h, w = frames[0].shape
    means = np.array([[[f[r * h // GRID:(r + 1) * h // GRID, c * w // GRID:(c + 1) * w // GRID].mean() for c in range(GRID)] for r in range(GRID)] for f in frames])
    best, best_count = (0, 0), -1
    for r in range(GRID):
        for c in range(GRID):
            s = means[:, r, c]
            count = sum(1 for i in range(1, len(s)) if s[i] - s[i - 1] > PULSE_JUMP)
            if count > best_count:
                best, best_count = (r, c), count
    return best


def flash_frames(frames: list[np.ndarray], flash_roi) -> list[int]:
    if flash_roi is None:
        h, w = frames[0].shape
        r, c = find_flash_cell(frames)
        flash_roi = (c / GRID, r / GRID, 1 / GRID, 1 / GRID)
    s = np.array([_crop(f, flash_roi).mean() for f in frames])
    out, last = [], -10 ** 9
    for i in range(1, len(s)):
        if s[i] - s[i - 1] > PULSE_JUMP and i - last > PULSE_MAX_FRAMES:
            out.append(i)
            last = i
    return out, flash_roi


def motion_energy(frames: list[np.ndarray], motion_roi, exclude_roi) -> np.ndarray:
    e = np.zeros(len(frames))
    mask = None
    if motion_roi is None and exclude_roi is not None:
        h, w = frames[0].shape
        mask = np.ones((h, w), bool)
        x, y, rw, rh = exclude_roi
        mask[max(0, int((y - 0.05) * h)): int((y + rh + 0.05) * h), max(0, int((x - 0.05) * w)): int((x + rw + 0.05) * w)] = False
    for i in range(1, len(frames)):
        a = _crop(frames[i], motion_roi).astype(np.float32)
        b = _crop(frames[i - 1], motion_roi).astype(np.float32)
        d = np.abs(a - b) > CHANGE_LEVEL
        e[i] = d[mask].mean() if mask is not None else d.mean()
    return e


def analyse(frames: list[np.ndarray], fps: float, motion_roi=None, flash_roi=None) -> dict:
    flashes, flash_roi = flash_frames(frames, flash_roi)
    energy = motion_energy(frames, motion_roi, flash_roi)
    delays = []
    for f in flashes:
        lo = max(1, f - int(REST_FROM_S * fps))
        mid = max(1, f - int(SEARCH_BEFORE_S * fps))
        if mid - lo < 3:
            continue
        rest = float(np.median(energy[lo:mid]))
        onset = None
        for i in range(mid, f):
            if energy[i] > max(rest * ONSET_FACTOR, rest + MIN_CHANGED):
                onset = i
                break
        if onset is not None:
            delays.append((f - onset) * 1000.0 / fps)
    d = np.array(delays) if delays else np.array([])
    return {"flashes": len(flashes), "measured": len(delays), "p50": float(np.percentile(d, 50)) if len(d) else None,
            "p95": float(np.percentile(d, 95)) if len(d) else None, "delays": [round(x) for x in delays]}


def read_video(path: str, width: int = 240):
    import cv2  # noqa: E402 (optional dependency)

    cap = cv2.VideoCapture(path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 60.0
    frames = []
    while True:
        ok, img = cap.read()
        if not ok:
            break
        g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        h = int(g.shape[0] * width / g.shape[1])
        frames.append(cv2.resize(g, (width, h), interpolation=cv2.INTER_AREA))
    return frames, fps


def selftest() -> int:
    """a synthetic film: an 'arm' block starts moving, the corner flashes a known number of frames later"""
    rng = np.random.default_rng(3)
    fps = 60.0
    frames, truth = [], []
    h, w = 135, 240
    t = 0
    for event in range(20):
        rest = int(rng.integers(90, 130))
        delay = int(rng.integers(6, 15))  # 100-233 ms
        for k in range(rest + delay + 30):
            img = np.full((h, w), 60, np.uint8)
            img += rng.integers(0, 6, (h, w)).astype(np.uint8)  # sensor noise
            moving = k >= rest
            x = 120 + (min(k - rest, 20) * 3 if moving else 0)
            img[60:80, x:x + 20] = 200  # the arm
            if rest + delay <= k < rest + delay + 3:
                img[0:30, 0:30] = 255  # the flash (two game frames ~ three camera frames)
            frames.append(img)
        truth.append(delay * 1000.0 / fps)
        t += 1
    res = analyse(frames, fps)
    err = abs(res["p50"] - float(np.median(truth))) if res["p50"] is not None else 1e9
    ok = res["flashes"] == 20 and res["measured"] >= 18 and err <= 1000.0 / fps + 1
    print(f"selftest: flashes {res['flashes']}/20, measured {res['measured']}, p50 {res['p50']} ms vs true {np.median(truth):.0f} ms -> {'PASS' if ok else 'FAIL'}")
    return 0 if ok else 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("video", nargs="?")
    ap.add_argument("--motion-roi")
    ap.add_argument("--flash-roi")
    ap.add_argument("--fps", type=float)
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    if not a.video:
        ap.error("video file required (or --selftest)")
    frames, fps = read_video(a.video)
    res = analyse(frames, a.fps or fps, _roi(a.motion_roi), _roi(a.flash_roi))
    print(f"вспышек: {res['flashes']}, измерено: {res['measured']}")
    if res["p50"] is not None:
        print(f"задержка p50 {res['p50']:.0f} мс, p95 {res['p95']:.0f} мс")
        print("все:", ", ".join(str(x) for x in res["delays"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
