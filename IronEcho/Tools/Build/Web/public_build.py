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

    version = "0.2"
    try:
        src = (project / "Tools" / "Build" / "Desktop" / "build_desktop.py").read_text(encoding="utf-8")
        version = re.search(r'VERSION = "([^"]+)"', src).group(1)
    except (OSError, AttributeError):
        pass
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
