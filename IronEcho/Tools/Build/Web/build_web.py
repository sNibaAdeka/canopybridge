"""Build the browser version of IRON ECHO (the real rules core in WebAssembly + three.js page).

  python Tools/Build/Web/build_web.py core     # core -> ironecho_core.wasm + wasm2js fallback, verified vs native
  python Tools/Build/Web/build_web.py site     # assemble Build/Web/site (needs core; robots/ring assets if built)
  python Tools/Build/Web/build_web.py all

Tools: zig 0.13 (pip install ziglang==0.13.0, or IRONECHO_ZIG=path\\to\\zig), binaryen (wasm-opt, wasm2js:
npm i binaryen, or IRONECHO_BINARYEN=dir with the binaries), node (for the bit-identity check), a host C++ compiler
(g++/clang++/cl via IRONECHO_HOSTCXX) for the native twin. Output goes to Build/Web (gitignored).
"""
from __future__ import annotations

import argparse
import os
import random
import re
import shutil
import struct
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROJECT = HERE.parents[2]
CORE = PROJECT / "Source" / "IronEchoRules"
OUT = PROJECT / "Build" / "Web"
CORE_SOURCES = ["BotBrain", "CombatConfig", "CombatSim", "Fighter", "InputFrame", "Match"]  # no protocol/packet code in the page


def run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    print("  $", " ".join(str(c) for c in cmd)[:240])
    return subprocess.run([str(c) for c in cmd], check=True, **kw)


def zig() -> list[str]:
    exe = os.environ.get("IRONECHO_ZIG")
    if exe:
        return [exe]
    return [sys.executable, "-m", "ziglang"]


def binaryen(tool: str) -> str:
    base = os.environ.get("IRONECHO_BINARYEN")
    candidates = []
    if base:
        candidates.append(Path(base) / tool)
        candidates.append(Path(base) / (tool + ".exe"))
    candidates.append(PROJECT / "node_modules" / "binaryen" / "bin" / tool)
    for c in candidates:
        if c.exists():
            return str(c)
    found = shutil.which(tool)
    if found:
        return found
    raise SystemExit(f"{tool} not found: npm i binaryen or set IRONECHO_BINARYEN")


def host_cxx() -> str:
    for c in (os.environ.get("IRONECHO_HOSTCXX"), "g++", "clang++"):
        if c and shutil.which(c):
            return c
    raise SystemExit("no host C++ compiler for the native twin (set IRONECHO_HOSTCXX)")


def to_classic_script(esm: str) -> str:
    """wasm2js emits an ES module; the page loads a classic script (works from file:// and strict CSPs)."""
    names = re.findall(r"^export var (\w+) = retasmFunc\.\w+;$", esm, flags=re.M)
    body = re.sub(r"^export var (\w+) = retasmFunc\.(\w+);$", r"var \1 = retasmFunc.\2;", esm, flags=re.M)
    if re.search(r"^\s*(import|export)\b", body, flags=re.M):
        raise SystemExit("unexpected import/export left in wasm2js output")
    exports = ", ".join(names)
    return ("// IRON ECHO rules core, wasm2js build of ironecho_core.wasm (fallback when WebAssembly is unavailable).\n"
            "(function () {\n" + body + f"\nglobalThis.IronEchoCoreJS = {{ {exports} }};\n}})();\n")


def make_input_script(path: Path, seed: int = 20261004, frames: int = 7200) -> None:
    """Deterministic input: mixed frame rates, punches (head and body), blocks, slips, footwork, a tracking dropout."""
    rng = random.Random(seed)
    values = [0.0, 1.0, 7.0, 3.0, 40.0, float(frames)]  # bout, Normal, seed 7, 3 x 40 s
    block_until = slip_until = move_until = -1
    slip = 0.0
    move = (0.0, 0.0)
    for f in range(frames):
        dt = rng.choice([1 / 60, 1 / 60, 1 / 60, 1 / 144, 1 / 30, 1 / 240])
        status = 7.0 if not (2400 <= f < 2460) else 3.0  # one tracking loss
        mask = 0
        if rng.random() < 0.035:
            mask |= 1
        if rng.random() < 0.02:
            mask |= 2
        if rng.random() < 0.01:
            mask |= rng.choice([4, 8])  # body jab / body cross
        kicks = rng.choice([1, 2, 4, 8]) if rng.random() < 0.006 else 0  # mid / low kicks of either leg
        if f >= block_until and rng.random() < 0.01:
            block_until = f + rng.randint(10, 50)
        if f >= slip_until and rng.random() < 0.006:
            slip_until = f + rng.randint(8, 40)
            slip = rng.choice([-1.0, 1.0])
        if f >= move_until and rng.random() < 0.01:
            move_until = f + rng.randint(20, 120)
            move = (rng.choice([-1.0, 0.0, 0.5, 1.0]), rng.choice([-1.0, 0.0, 0.0, 1.0]))
        block = 1.0 if f < block_until else 0.0
        lean = slip if f < slip_until else 0.0
        fwd, side = move if f < move_until else (0.0, 0.0)
        values += [dt, status, lean, block, float(mask), fwd, side, float(kicks)]
    path.write_bytes(struct.pack(f"<{len(values)}d", *values))


def build_core() -> None:
    out = OUT / "core"
    obj = out / "obj"
    obj.mkdir(parents=True, exist_ok=True)
    flags = ["-target", "wasm32-wasi", "-O2", "-std=c++20", "-fno-exceptions", "-fno-rtti", "-Wall", "-Wextra", "-Werror", f"-I{CORE / 'Public'}"]
    sources = [CORE / "Private" / f"{n}.cpp" for n in CORE_SOURCES] + [HERE / "bridge" / "IronEchoWeb.cpp"]
    objects = []
    print("[core] compile C++ -> wasm32 objects (zig; libc++ headers only, no libc++ runtime)")
    for src in sources:
        o = obj / (src.stem + ".o")
        run(zig() + ["c++", *flags, "-c", src, "-o", o])
        objects.append(o)
    raw = out / "core_raw.wasm"
    print("[core] link reactor module (C linker: wasi-libc only)")
    run(zig() + ["cc", "-target", "wasm32-wasi", "-O2", "-s", "-mexec-model=reactor", "-Wl,-z,stack-size=262144", *objects, "-o", raw])
    wasm = out / "ironecho_core.wasm"
    run([binaryen("wasm-opt"), "-Oz", "--strip-debug", raw, "-o", wasm])
    esm = out / "ironecho_core.wasm2js.mjs"
    run([binaryen("wasm2js"), wasm, "-O2", "-o", esm])
    js = out / "ironecho_core.js"
    js.write_text(to_classic_script(esm.read_text(encoding="utf-8")), encoding="utf-8")
    print(f"[core] {wasm.name} {wasm.stat().st_size // 1024} KB, {js.name} {js.stat().st_size // 1024} KB")

    print("[core] verify: native twin vs WebAssembly vs wasm2js on the same input script")
    script = out / "check_input.bin"
    make_input_script(script)
    twin = out / ("bridge_check.exe" if os.name == "nt" else "bridge_check")
    cxx = host_cxx()
    native_sources = [CORE / "Private" / f"{n}.cpp" for n in CORE_SOURCES] + [HERE / "bridge" / "IronEchoWeb.cpp", HERE / "bridge" / "bridge_check.cpp"]
    run([cxx, "-std=c++20", "-O2", "-fno-exceptions", "-fno-rtti", f"-I{CORE / 'Public'}", *native_sources, "-o", twin])
    native_out = out / "check_native.txt"
    with open(script, "rb") as fin, open(native_out, "w") as fout:
        run([twin], stdin=fin, stdout=fout)
    run(["node", HERE / "check_core.mjs", wasm, js, script, native_out])


def check_pose() -> None:
    """The browser port of the tracker (site/src/pose.js) must match Tracking/iron_echo_tracker on synthetic sessions."""
    ref = OUT / "check" / "pose_reference.json"
    ref.parent.mkdir(parents=True, exist_ok=True)
    py = os.environ.get("IRONECHO_TRACKER_PYTHON", sys.executable)  # needs the tracker's deps (numpy)
    run([py, HERE / "check" / "pose_reference.py", ref])
    run(["node", HERE / "check" / "check_pose.mjs", ref])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("step", choices=["core", "site", "check", "all", "public", "release"])
    args = parser.parse_args()
    if args.step in ("core", "all"):
        build_core()
    if args.step in ("check", "all"):
        check_pose()
    if args.step in ("site", "all"):
        from site_build import build_site  # noqa: E402 (sibling module)
        build_site(PROJECT, HERE, OUT)
    if args.step == "public":
        from public_build import build_public  # noqa: E402 (sibling module)
        build_public(PROJECT, HERE, OUT)
    if args.step == "release":
        from public_build import build_release  # noqa: E402 (sibling module)
        build_release(PROJECT, HERE, OUT)
    return 0


if __name__ == "__main__":
    sys.path.insert(0, str(HERE))
    raise SystemExit(main())
