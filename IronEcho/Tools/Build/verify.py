"""One command for the checks a contributor runs before a commit (and the release script runs before a release).

    python Tools/Build/verify.py            # fast: core, tracker, node suites, ownership (~5 min)
    python Tools/Build/verify.py --browser  # + browser suites on Build/Web/standalone (needs playwright; ~40 min with software rendering)
    python Tools/Build/verify.py --only core,strikes

Prints a table (suite, result, seconds, last line of output) and writes Build/verify_report.md. Exit code 0 only if everything ran green.
Environment for the browser suites (see Tools/Build/env.example.sh): NODE_PATH with playwright (and peer), IRONECHO_STANDALONE (default
Build/Web/standalone), IRONECHO_SYNTHETIC (a synthetic session for the camera group; generated if missing).
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[2]
PY = sys.executable


def suites(browser: bool) -> list[tuple[str, list[str], str | None]]:
    """(name, command, working directory relative to the project)"""
    s: list[tuple[str, list[str], str | None]] = [
        ("core", ["bash", "-c", "cmake -S Tests/CoreRules -B Build/CoreRulesTests >/dev/null && cmake --build Build/CoreRulesTests -j8 >/dev/null && Build/CoreRulesTests/CoreRulesTests"], None),
        ("tracker", [PY, "-m", "pytest", "-q"], "Tracking"),
        ("strikes", ["node", "Tests/Web/pose_strikes_test.mjs"], None),
        ("trace", ["node", "Tests/Web/trace_test.mjs"], None),
        ("collect", ["node", "Tests/Web/collect_eval_test.mjs"], None),
        ("telemetry", ["node", "Tests/Web/telemetry_test.mjs"], None),
        ("tutorial", ["node", "Tests/Web/tutorial_test.mjs"], None),
        ("fusion", ["node", "Tools/Build/Web/check/check_fusion.mjs"], None),
        ("rating", ["node", "Tests/Web/rating_test.mjs"], None),
        ("store", ["node", "Tests/Web/rating_store_test.mjs"], None),
        ("latency", [PY, "Tools/Build/Eval/latency_from_video.py", "--selftest"], None),
        # changes since the branch's upstream (what this commit would add); falls back to the plain check without one
        ("ownership", ["bash", "-c", "python3 Tools/Build/ownership.py verify && b=$(git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null) "
                       "&& python3 Tools/Build/ownership.py check --agent claude --base \"$b\" || { [ -z \"$b\" ] && python3 Tools/Build/ownership.py check --agent claude; }"], None),
    ]
    if (PROJECT / "Build" / "Web" / "core" / "ironecho_core.wasm").exists():
        s.append(("rollback", ["node", "Tests/Web/rollback_net.mjs"], None))
    if browser:
        s += [
            ("qa", ["node", "Tests/Web/qa.js"], None),
            ("camera2", ["node", "Tests/Web/camera2_e2e.js"], None),
        ]
    return s


def run(name: str, cmd: list[str], cwd: str | None, env: dict) -> tuple[bool, float, str]:
    t = time.time()
    try:
        p = subprocess.run(cmd, cwd=PROJECT / cwd if cwd else PROJECT, env=env, capture_output=True, text=True, timeout=5400)
        out = (p.stdout.strip() or p.stderr.strip()).splitlines()
        ok = p.returncode == 0
    except (subprocess.TimeoutExpired, FileNotFoundError) as err:
        out, ok = [str(err)], False
    last = next((line for line in reversed(out) if line.strip() and not line.startswith("I0000")), "")
    return ok, time.time() - t, last[:140]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--browser", action="store_true")
    ap.add_argument("--only", default="")
    a = ap.parse_args()
    env = dict(os.environ)
    env.setdefault("IRONECHO_STANDALONE", str(PROJECT / "Build" / "Web" / "standalone"))
    if a.browser and not env.get("IRONECHO_SYNTHETIC"):
        synth = PROJECT / "Build" / "Web" / "check" / "synthetic_session.json"
        if not synth.exists():
            synth.parent.mkdir(parents=True, exist_ok=True)
            subprocess.run([PY, "Tools/Build/Web/check/synthetic_session.py", str(synth)], cwd=PROJECT, check=False)
        env["IRONECHO_SYNTHETIC"] = str(synth)
    only = {x for x in a.only.split(",") if x}
    rows = []
    for name, cmd, cwd in suites(a.browser):
        if only and name not in only:
            continue
        if cmd[0] in ("node", "cmake") and not shutil.which(cmd[0]):
            rows.append((name, None, 0.0, f"{cmd[0]} not installed"))
            continue
        print(f"… {name}", flush=True)
        ok, secs, last = run(name, cmd, cwd, env)
        rows.append((name, ok, secs, last))
        print(f"{'PASS' if ok else 'FAIL'}  {name:10s} {secs:6.1f} s  {last}", flush=True)
    lines = ["| suite | result | seconds | last line |", "|---|---|---|---|"]
    for name, ok, secs, last in rows:
        lines.append(f"| {name} | {'ok' if ok else ('skipped' if ok is None else 'FAIL')} | {secs:.0f} | {last.replace('|', '/')} |")
    report = PROJECT / "Build" / "verify_report.md"
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text("\n".join(lines) + "\n", encoding="utf-8")
    failed = [r for r in rows if r[1] is False]
    print(f"\n{len(rows) - len(failed)}/{len(rows)} suites green; report: {report.relative_to(PROJECT)}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
