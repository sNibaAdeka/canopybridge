"""Ownership tooling for the two-agent workflow (Claude = technical, Codex = visuals).

  python Tools/Build/ownership.py sync            regenerate the ownership block in AGENTS.md and CLAUDE.md
  python Tools/Build/ownership.py verify          fail if the blocks are stale or differ
  python Tools/Build/ownership.py check --agent codex [--base origin/main]
                                                  fail if the agent's changes touch files it does not own
  python Tools/Build/ownership.py who <path>...   print the owner of paths

Only the Python standard library is used (works with any Python 3.10+, no venv needed).
"""

from __future__ import annotations

import argparse
import fnmatch
import json
import subprocess
import sys
from pathlib import Path
from typing import List, Optional, Tuple

PROJECT = Path(__file__).resolve().parents[2]
RULES_FILE = PROJECT / "Tools" / "Build" / "ownership.json"
AGENT_DOCS = [PROJECT / "AGENTS.md", PROJECT / "CLAUDE.md"]
BEGIN = "<!-- OWNERSHIP:BEGIN (generated from Tools/Build/ownership.json, do not edit by hand) -->"
END = "<!-- OWNERSHIP:END -->"


def load_rules() -> List[dict]:
    return json.loads(RULES_FILE.read_text(encoding="utf-8"))["rules"]


def _match(pattern: str, path: str) -> bool:
    if pattern.endswith("/**"):
        prefix = pattern[:-3]
        return path == prefix or path.startswith(prefix + "/")
    if "**" in pattern:
        return fnmatch.fnmatch(path, pattern.replace("**", "*"))
    return fnmatch.fnmatchcase(path, pattern)


def owner_of(path: str, rules: Optional[List[dict]] = None) -> Tuple[str, str]:
    path = path.replace("\\", "/")
    while path.startswith("./"):
        path = path[2:]
    for rule in rules or load_rules():
        if _match(rule["pattern"], path):
            return rule["owner"], rule["pattern"]
    return "unassigned", "**"


def render_block(rules: List[dict]) -> str:
    lines = [BEGIN, "", "| Путь (от `IronEcho/`) | Владелец | Зачем |", "|---|---|---|"]
    for rule in rules:
        owner = {"claude": "Claude", "codex": "Codex", "shared-lock": "общий, по блокировке", "unassigned": "не назначен — спросить"}[rule["owner"]]
        lines.append(f"| `{rule['pattern']}` | {owner} | {rule['why']} |")
    lines += ["", "Правило: первое совпадение сверху вниз. Проверка: `python Tools/Build/ownership.py check --agent <claude|codex>`.", "", END]
    return "\n".join(lines)


def sync(write: bool) -> int:
    block = render_block(load_rules())
    stale = []
    for doc in AGENT_DOCS:
        text = doc.read_text(encoding="utf-8")
        if BEGIN not in text or END not in text:
            print(f"{doc.name}: ownership markers missing", file=sys.stderr)
            return 2
        start = text.index(BEGIN)
        end = text.index(END) + len(END)
        updated = text[:start] + block + text[end:]
        if updated != text:
            stale.append(doc.name)
            if write:
                doc.write_text(updated, encoding="utf-8", newline="\n")
    if stale and not write:
        print("stale ownership block in: " + ", ".join(stale) + " (run: python Tools/Build/ownership.py sync)", file=sys.stderr)
        return 1
    print("ownership blocks " + ("updated: " + ", ".join(stale) if stale and write else "up to date"))
    return 0


def changed_files(base: str) -> List[str]:
    root = subprocess.run(["git", "rev-parse", "--show-toplevel"], cwd=PROJECT, capture_output=True, text=True, check=True).stdout.strip()
    prefix = PROJECT.relative_to(Path(root)).as_posix()
    out = subprocess.run(["git", "diff", "--name-only", f"{base}...HEAD"], cwd=root, capture_output=True, text=True, check=True).stdout
    out += subprocess.run(["git", "diff", "--name-only", "HEAD"], cwd=root, capture_output=True, text=True, check=True).stdout
    out += subprocess.run(["git", "ls-files", "--others", "--exclude-standard"], cwd=root, capture_output=True, text=True, check=True).stdout
    files = set()
    for line in out.splitlines():
        line = line.strip()
        if line.startswith(prefix + "/"):
            files.add(line[len(prefix) + 1 :])
    return sorted(files)


def check(agent: str, base: str) -> int:
    rules = load_rules()
    violations = []
    for path in changed_files(base):
        owner, pattern = owner_of(path, rules)
        if owner not in (agent, "shared-lock"):
            violations.append((path, owner, pattern))
    for path, owner, pattern in violations:
        print(f"NOT {agent.upper()}'S: {path}  (owner: {owner}, rule {pattern})")
    if violations:
        print("Hand the change over via Docs/Handoffs or take a lock in Docs/Handoffs/LOCKS.md.", file=sys.stderr)
        return 1
    print(f"ownership ok for {agent}")
    return 0


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("sync")
    sub.add_parser("verify")
    chk = sub.add_parser("check")
    chk.add_argument("--agent", required=True, choices=["claude", "codex"])
    chk.add_argument("--base", default="origin/main")
    who = sub.add_parser("who")
    who.add_argument("paths", nargs="+")
    args = parser.parse_args(argv)
    if args.command == "sync":
        return sync(write=True)
    if args.command == "verify":
        return sync(write=False)
    if args.command == "check":
        return check(args.agent, args.base)
    for path in args.paths:
        owner, pattern = owner_of(path)
        print(f"{path}: {owner} ({pattern})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
