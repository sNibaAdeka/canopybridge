"""Public website (called by build_web.py public): Build/Web/public, ready for any static host (Netlify).

    /                     landing page (site/../public/index.html): hero, gameplay video, controls, download
    /play/                the game, Build/Web/standalone (camera included; no third-party hosts at run time)
    /download/IronEcho-Windows.zip   the Windows app (Tools/Build/Desktop/build_desktop.py), if built
    /media/               hero image, icon, gameplay video (IRONECHO_GAMEPLAY_FRAMES=<folder of frames> -> mp4)

Order: build_web.py site -> Tools/Build/Desktop/build_desktop.py -> build_web.py public.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path

HEADERS = """/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin

/play/*
  Permissions-Policy: camera=(self), microphone=(), geolocation=()

/play/vendor/*
  Cache-Control: public, max-age=604800

/play/assets/*
  Cache-Control: public, max-age=86400

/download/*
  Content-Disposition: attachment
"""


def gameplay_video(frames: Path, media: Path) -> str:
    """Frames (f000.jpg ...) at 30 fps -> H.264 MP4 + poster. Returns the <video> markup, or '' without ffmpeg."""
    ffmpeg = shutil.which("ffmpeg")
    files = sorted(frames.glob("f*.jpg")) or sorted(frames.glob("f*.png"))
    if not ffmpeg or not files:
        return ""
    pattern = str(frames / ("f%03d" + files[0].suffix))
    subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-framerate", "30", "-i", pattern, "-c:v", "libx264", "-preset",
                    "slow", "-crf", "24", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an",
                    str(media / "gameplay.mp4")], check=True)
    shutil.copy2(files[len(files) // 3], media / ("gameplay" + files[0].suffix))
    return (f'<video autoplay muted loop playsinline preload="metadata" poster="media/gameplay{files[0].suffix}">'
            '<source src="media/gameplay.mp4" type="video/mp4"></video>')


def build_public(project: Path, here: Path, out_root: Path) -> Path:
    standalone = out_root / "standalone"
    if not (standalone / "index.html").exists():
        raise SystemExit("Build/Web/standalone is missing: run build_web.py site with IRONECHO_WEBDEPS set")
    out = out_root / "public"
    shutil.rmtree(out, ignore_errors=True)  # generated folder: rebuilt from scratch every time
    media = out / "media"
    media.mkdir(parents=True)
    shutil.copytree(standalone, out / "play")

    from PIL import Image

    hero = project / "Docs" / "Reports" / "2026-10-04_head_gloves_v3" / "hero.jpg"
    Image.open(hero).convert("RGB").save(media / "hero.jpg", "JPEG", quality=84, optimize=True, progressive=True)
    icon = Image.open(project / "Build" / "Desktop" / "icon.png")  # written by build_desktop.py
    icon.resize((192, 192), Image.LANCZOS).save(media / "icon.png", optimize=True)

    frames = os.environ.get("IRONECHO_GAMEPLAY_FRAMES")
    video = gameplay_video(Path(frames), media) if frames else ""
    if not video:
        video = '<img src="media/hero.jpg" alt="IRON ECHO: Forge против Ember на ринге">'

    zip_src = project / "Build" / "Desktop" / "IronEcho-Windows.zip"
    zip_mb = "—"
    if zip_src.exists():
        (out / "download").mkdir()
        shutil.copy2(zip_src, out / "download" / zip_src.name)
        zip_mb = f"{zip_src.stat().st_size / 1e6:.0f}"
    else:
        print("[public] no Build/Desktop/IronEcho-Windows.zip: run Tools/Build/Desktop/build_desktop.py first")

    from site_build import GAME_VERSION  # noqa: E402 (sibling module)

    version = GAME_VERSION
    page = (here / "public" / "index.html").read_text(encoding="utf-8")
    page = page.replace("@@VIDEO@@", video).replace("@@ZIP_MB@@", zip_mb).replace("@@VERSION@@", version)
    if "@@" in page:
        raise SystemExit("public/index.html: unfilled placeholder")
    (out / "index.html").write_text(page, encoding="utf-8")
    (out / "_headers").write_text(HEADERS, encoding="utf-8")
    shutil.copy2(here / "public" / "netlify.toml", out / "netlify.toml")
    size = sum(p.stat().st_size for p in out.rglob("*") if p.is_file())
    print(f"[public] {out} {size / 1e6:.0f} MB")
    return out


# ------------------------------------------------------------------------------------------------------------- release
# Tools/Build/Web/release: the deployable website, committed so a static host (Vercel, Netlify) can build it straight from
# the public GitHub repository. Lighter than Build/Web/public: /play is the single-file game (Build/Web/IronEcho-Public.html,
# assets inlined; three.js/MediaPipe from their CDNs), the Windows app is in /download.
VERCEL_JSON = {
    "functions": {"api/ratings.mjs": {"maxDuration": 30, "memory": 1024}},  # replays a whole bout on the rules core: about a second
    "headers": [
        {"source": "/play/(.*)", "headers": [{"key": "Permissions-Policy", "value": "camera=(self), microphone=()"}]},
        {"source": "/phone/(.*)", "headers": [{"key": "Permissions-Policy", "value": "camera=(self), microphone=()"}, {"key": "Cache-Control", "value": "no-cache"}]},
        {"source": "/download/(.*)", "headers": [{"key": "Content-Disposition", "value": "attachment"}]},
        {"source": "/(.*)", "headers": [{"key": "X-Content-Type-Options", "value": "nosniff"}]},
    ],
}
RELEASE_DOWNLOAD_URL = "/download/IronEcho-Windows.zip"


def build_rating_server(here: Path, out_root: Path, out: Path, game: Path) -> None:
    """release/api + release/lib: the rating server (a Vercel function). The very files the tests run, with the page's own modules
    (core, replay, rating rules) next to them and the WebAssembly core as text, so that the server replays bouts on the exact core the
    page was built with."""
    import base64
    import json

    wasm = out_root / "core" / "ironecho_core.wasm"
    b64 = base64.b64encode(wasm.read_bytes()).decode("ascii")
    if b64 not in game.read_text(encoding="utf-8"):
        raise SystemExit("the page was built with another core than Build/Web/core/ironecho_core.wasm: rebuild (build_web.py core, then site)")
    api, lib = out / "api", out / "lib"
    api.mkdir()
    lib.mkdir()
    for name in ("ratings.mjs", "rating_api.mjs", "rating_store.mjs"):
        text = (here / "api" / name).read_text(encoding="utf-8").replace("'../site/src/", "'../lib/")
        (api / name).write_text(text, encoding="utf-8")
    (api / "core_build.mjs").write_text(f'export const CORE_WASM_B64 = "{b64}";\n', encoding="utf-8")
    shutil.copy2(here / "api" / "rating_schema.sql", out / "rating_schema.sql")
    for name in ("core.js", "replay.js", "ratingrules.js", "rating.js"):
        shutil.copy2(here / "site" / "src" / name, lib / name)
    # the page modules are ES modules: the function's package says so
    (out / "package.json").write_text(json.dumps({"name": "iron-echo-site", "private": True, "type": "module", "engines": {"node": "22.x"}}, indent=2) + "\n", encoding="utf-8")


def build_release(project: Path, here: Path, out_root: Path) -> Path:
    import json

    from site_build import CDN_FONTS  # noqa: E402 (sibling module)

    public = out_root / "public"
    game = out_root / "IronEcho-Public.html"
    if not (public / "index.html").exists():
        raise SystemExit("run build_web.py public first")
    if not game.exists() or RELEASE_DOWNLOAD_URL not in game.read_text(encoding="utf-8"):
        raise SystemExit(f"build the single page with IRONECHO_DOWNLOAD_URL={RELEASE_DOWNLOAD_URL} (build_web.py site)")
    out = here / "release"
    out.mkdir(exist_ok=True)
    for p in list(out.iterdir()):  # generated content; README.md stays
        if p.name == "README.md":
            continue
        shutil.rmtree(p) if p.is_dir() else p.unlink()
    landing = (public / "index.html").read_text(encoding="utf-8")
    local_fonts = '<link rel="stylesheet" href="play/vendor/fonts/fonts.css">'
    if local_fonts not in landing:
        raise SystemExit("landing page: fonts link not found")
    (out / "index.html").write_text(landing.replace(local_fonts, CDN_FONTS), encoding="utf-8")
    (out / "play").mkdir()
    shutil.copy2(game, out / "play" / "index.html")
    shutil.copy2(public / "play" / "vendor" / "peerjs" / "peerjs.min.js", out / "play" / "peerjs.min.js")  # online duel
    shutil.copy2(public / "play" / "vendor" / "qrcode" / "qrcode.mjs", out / "play" / "qrcode.mjs")  # QR code of the phone camera
    shutil.copy2(public / "play" / "vendor" / "mediapipe" / "vision_bundle_worker.js", out / "play" / "vision_bundle_worker.js")  # pose Web Worker
    phone = (here / "site" / "phone.template.html").read_text(encoding="utf-8").replace("@@PEERJS@@", "../play/peerjs.min.js")
    (out / "phone").mkdir()
    (out / "phone" / "index.html").write_text(phone, encoding="utf-8")  # the phone's side of the second camera
    shutil.copytree(public / "media", out / "media")
    shutil.copytree(public / "download", out / "download")
    (out / "vercel.json").write_text(json.dumps(VERCEL_JSON, indent=2) + "\n", encoding="utf-8")
    build_rating_server(here, out_root, out, game)
    (out / "_headers").write_text(HEADERS, encoding="utf-8")
    shutil.copy2(here / "public" / "netlify.toml", out / "netlify.toml")
    size = sum(p.stat().st_size for p in out.rglob("*") if p.is_file())
    print(f"[release] {out} {size / 1e6:.0f} MB")
    return out
