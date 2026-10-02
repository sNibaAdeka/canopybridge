# PyInstaller spec for the standalone tracker (no Python needed on the player's PC).
#   pyinstaller --noconfirm --clean IronEchoTracker.spec      (run from Tracking/, models fetched first)
# Output: dist/IronEchoTracker/IronEchoTracker(.exe) + _internal/ ; staged by Tools/Build/Package-Windows.ps1
# into <Package>/IronEcho/Tracker/.
import os
import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules

import mediapipe

ROOT = Path(SPECPATH)
MP_DIR = Path(mediapipe.__file__).parent
LIB = {"win32": "libmediapipe.dll", "darwin": "libmediapipe.dylib"}.get(sys.platform, "libmediapipe.so")

# MediaPipe 1.x loads its C library via importlib.resources from the package "mediapipe.tasks.c",
# so the library must keep that relative location inside the bundle.
binaries = [(str(MP_DIR / "tasks" / "c" / LIB), "mediapipe/tasks/c")]

models = []
for name in ("pose_landmarker_full.task", "pose_landmarker_lite.task"):
    path = ROOT / "models" / name
    if not path.exists():
        raise SystemExit(f"missing {path}: run 'python -m iron_echo_tracker fetch-models' first")
    models.append((str(path), "models"))

hiddenimports = collect_submodules("mediapipe.tasks.python") + ["mediapipe.tasks.c"]

a = Analysis(
    [str(ROOT / "iron_echo_tracker" / "__main__.py")],
    pathex=[str(ROOT)],
    binaries=binaries,
    datas=models,
    hiddenimports=hiddenimports,
    # matplotlib stays: "import mediapipe" imports its drawing utilities.
    excludes=["tkinter", "pytest", "IPython", "jax", "tensorflow"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="IronEchoTracker",
    console=True,  # the game launches it hidden; a console helps manual diagnostics
    upx=False,
)
coll = COLLECT(exe, a.binaries, a.datas, name="IronEchoTracker", upx=False)
