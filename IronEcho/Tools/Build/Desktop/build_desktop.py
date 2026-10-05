"""Build the IRON ECHO desktop app: one IronEcho.exe with the whole browser game inside (Build/Web/standalone).

    python Tools/Build/Web/build_web.py site      # first: the game (writes Build/Web/standalone)
    python Tools/Build/Desktop/build_desktop.py   # then: Build/Desktop/IronEcho.exe + IronEcho-Windows.zip

Works on Windows and Linux (Go cross-compiles; no C compiler needed). Needs Go >= 1.22 (IRONECHO_GO=path to go, or go
on PATH) and, for the icon and version info, network access to the Go module proxy once (go-winres). Also builds a
native launcher (Build/Desktop/ironecho-<os>) used by tests: `ironecho-linux --serve 127.0.0.1:8799`.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROJECT = HERE.parents[2]
OUT = PROJECT / "Build" / "Desktop"
STANDALONE = PROJECT / "Build" / "Web" / "standalone"
WINRES = "github.com/tc-hib/go-winres@v0.3.3"

README = """IRON ECHO — бокс роботов
=========================

Запуск: двойной щелчок по IronEcho.exe. Игра откроется в отдельном окне (через Microsoft Edge или Google Chrome,
которые уже есть в Windows). Интернет не нужен.

Windows может показать «Система Windows защитила ваш компьютер» — у игры пока нет платной цифровой подписи.
Нажмите «Подробнее» → «Выполнить в любом случае».

Управление
  Клавиатура: J — джеб, K — кросс, Пробел — блок, A / D — уклоны, Esc — пауза. Мышь: ЛКМ/ПКМ — удары.
  Камера: в меню «Управление → КАМЕРА». Встаньте в 2–3 м от камеры, чтобы было видно от головы до пояса,
  и пройдите короткую калибровку на экране. Разрешение на камеру спросят один раз.

Настройки и разрешение камеры хранятся в %LOCALAPPDATA%\\IronEcho.
Версия {version}.
"""


sys.path.insert(0, str(HERE.parent / "Web"))
from site_build import GAME_VERSION, make_icon  # noqa: E402 (one version and one icon for game, app and site)


def go() -> str:
    exe = os.environ.get("IRONECHO_GO") or shutil.which("go")
    if not exe:
        raise SystemExit("Go not found: install Go >= 1.22 or set IRONECHO_GO")
    return exe


def git_rev() -> str:
    try:
        return subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=PROJECT, capture_output=True, text=True,
                              check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return "local"


def main() -> int:
    if not (STANDALONE / "index.html").exists():
        raise SystemExit("Build/Web/standalone is missing: run Tools/Build/Web/build_web.py site first "
                         "(with IRONECHO_WEBDEPS set)")
    src = OUT / "src"
    shutil.rmtree(src, ignore_errors=True)  # generated staging folder
    src.mkdir(parents=True)
    for f in (HERE / "launcher").iterdir():
        if f.suffix in (".go", ".mod"):
            shutil.copy2(f, src / f.name)
    shutil.copytree(STANDALONE, src / "game")

    version = f"{GAME_VERSION}+{git_rev()}"
    env = dict(os.environ, CGO_ENABLED="0")
    # icon + version info + manifest (DPI aware, common controls) as a .syso the Go linker picks up
    icon = OUT / "icon.png"
    make_icon(512).save(icon)
    winres = [go(), "run", WINRES, "simply", "--icon", str(icon), "--manifest", "gui",
              "--product-name", "IRON ECHO", "--file-description", "IRON ECHO — robot boxing",
              "--product-version", GAME_VERSION, "--file-version", GAME_VERSION, "--copyright", "IRON ECHO",
              "--original-filename", "IronEcho.exe", "--arch", "amd64", "--out", "rsrc"]
    try:
        subprocess.run(winres, cwd=src, env=env, check=True)
    except subprocess.CalledProcessError:
        print("[desktop] go-winres unavailable: building without icon/version info")

    ldflags = f"-s -w -X main.version={version}"
    exe = OUT / "IronEcho.exe"
    subprocess.run([go(), "build", "-trimpath", "-ldflags", ldflags + " -H windowsgui", "-o", str(exe), "."],
                   cwd=src, env=dict(env, GOOS="windows", GOARCH="amd64"), check=True)
    native = OUT / f"ironecho-{sys.platform}"
    if sys.platform != "win32":
        subprocess.run([go(), "build", "-trimpath", "-ldflags", ldflags, "-o", str(native), "."], cwd=src, env=env,
                       check=True)

    archive = OUT / "IronEcho-Windows.zip"
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        z.write(exe, "IronEcho/IronEcho.exe")
        z.writestr("IronEcho/Как играть.txt", README.format(version=version).replace("\n", "\r\n").encode("utf-8-sig"))
    mb = lambda p: f"{p.stat().st_size / 1e6:.1f} MB"  # noqa: E731
    print(f"[desktop] {exe} {mb(exe)}; {archive} {mb(archive)} (version {version})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
