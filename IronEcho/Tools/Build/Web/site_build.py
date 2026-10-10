"""Assemble the browser game into Build/Web/site (called by build_web.py site|all).

Output:
  Build/Web/site/index.html          page fragment for the claude.ai artifact (the host adds <!doctype>/<head>/<body>)
  Build/Web/site/play.html           the same page as a full document, for a local web server
  Build/Web/site/assets/*            robots (GLB + JPEG textures), ring canvas, venue panorama
  Build/Web/IronEcho-Camera.html     single self-contained file (assets inlined) with the webcam mode; opens from disk
                                     (a copy goes to site/, where the page offers it as a download)
"""
from __future__ import annotations

import base64
import json
import os
import re
import shutil
import subprocess
from pathlib import Path

GAME_VERSION = "1.5.0"  # shown in the menu, the Windows app and the website
HEAD_RENDER = Path(__file__).resolve().parents[3] / "Docs" / "Reports" / "2026-10-04_head_gloves_v3" / "head_closeup.jpg"
MODULES = ["core", "rig", "anim", "arena", "fx", "audio", "input", "hud", "main"]
CAMERA_MODULES = ["pose"]
# the full game (everything the browser page runs), in bundling order
GAME_BUNDLE = ["meshopt", "ratingrules", "replay", "core", "rig", "anim", "arena", "fx", "audio", "input", "hud", "net", "rating", "camlink", "fusion", "poseworker", "pose", "main"]
# where the Windows app sends a phone to pair as a second camera (the phone needs an https page; the app's own server is http)
PUBLIC_SITE = os.environ.get("IRONECHO_PUBLIC_URL", "https://iron-echo-boxing.vercel.app").rstrip("/")
# the rating server (api/ratings on the public site); the Windows app and the downloadable pages rate through it too
RATING_API = os.environ.get("IRONECHO_RATING_API", f"{PUBLIC_SITE}/api/ratings")

# name in the page -> (source in Build/Web/assets, max size, JPEG quality)
TEXTURES = {
    "T_Venue_Pano.jpg": ("T_Venue_Pano.png", 4096, 84),
    "T_Ring_Canvas.jpg": ("T_Ring_Canvas.png", 2048, 86),
}
for _lv in ("Forge", "Ember"):
    TEXTURES.update({
        f"T_IE1_{_lv}_BaseColor.jpg": (f"T_IE1_{_lv}_BaseColor.png", 2048, 88),
        f"T_IE1_{_lv}_Normal.jpg": (f"T_IE1_{_lv}_Normal.png", 2048, 92),
        f"T_IE1_{_lv}_ORM.jpg": (f"T_IE1_{_lv}_ORM.png", 1024, 88),
        f"T_IE1_{_lv}_Emissive.jpg": (f"T_IE1_{_lv}_Emissive.png", 1024, 90),
    })
MESHES = ["IE1_Forge.glb", "IE1_Ember.glb"]

IMPORT_RE = re.compile(r"^import\s.+?from\s+['\"](.+?)['\"];\s*$", re.M)


def bundle(src_dir: Path, names: list[str]) -> str:
    """Concatenate ES modules (top-level names are unique by convention): local imports dropped, `export` stripped,
    external (three) imports hoisted once."""
    externals: list[str] = []
    parts: list[str] = []
    for name in names:
        text = (src_dir / f"{name}.js").read_text(encoding="utf-8")
        for m in IMPORT_RE.finditer(text):
            line, spec = m.group(0).strip(), m.group(1)
            if not spec.startswith(".") and line not in externals:
                externals.append(line)
        text = IMPORT_RE.sub("", text)
        text = re.sub(r"^export\s+(?=(const|let|function|async|class)\b)", "", text, flags=re.M)
        if re.search(r"^\s*(import|export)\b", text, flags=re.M):
            raise SystemExit(f"{name}.js: unsupported import/export form for the bundler")
        parts.append(f"// ---- {name}.js\n{text.strip()}\n")
    return "\n".join(externals) + "\n\n" + "\n".join(parts)


def convert_textures(assets: Path, out: Path) -> list[str]:
    from PIL import Image

    done = []
    for dst, (src, size, quality) in TEXTURES.items():
        path = assets / src
        if not path.exists():
            print(f"  [skip] {src} (not built yet)")
            continue
        img = Image.open(path).convert("RGB")
        if max(img.size) > size:
            ratio = size / max(img.size)
            img = img.resize((round(img.size[0] * ratio), round(img.size[1] * ratio)), Image.LANCZOS)
        img.save(out / dst, "JPEG", quality=quality, optimize=True, progressive=True)
        done.append(dst)
    return done


def pack_meshes(assets: Path, out: Path) -> list[str]:
    """Quantise vertex data (KHR_mesh_quantization, read natively by three.js GLTFLoader; no decoder, no wasm)."""
    gltfpack = os.environ.get("IRONECHO_GLTFPACK") or shutil.which("gltfpack")
    done = []
    for name in MESHES:
        src = assets / name
        if not src.exists():
            print(f"  [skip] {name} (not built yet)")
            continue
        dst = out / name
        if gltfpack:
            # -kv: keep UVs although the GLB carries no material (the page builds it); -vtf: float UVs (no texture
            # transform needed); -vn 10: 10-bit normals, smooth highlights on the curved armour.
            # Plain (quantised, read natively by GLTFLoader) + .mo.glb (meshopt, needs the WebAssembly decoder).
            base = [gltfpack, "-i", str(src), "-kn", "-kv", "-vtf", "-vn", "10"]
            if gltfpack.endswith(".js"):
                base.insert(0, "node")
            subprocess.run(base + ["-o", str(dst)], check=True)
            subprocess.run(base + ["-cc", "-o", str(out / name.replace(".glb", ".mo.glb"))], check=True)
        else:
            shutil.copy2(src, dst)
        done.append(name)
    return done


def compress_for_camera(assets: Path, site_assets: Path, out: Path) -> None:
    from PIL import Image

    for name in MESHES:
        mo = name.replace(".glb", ".mo.glb")
        if (site_assets / mo).exists():
            shutil.copy2(site_assets / mo, out / mo)
    for p in site_assets.glob("*.jpg"):
        if "_BaseColor" in p.name:
            Image.open(p).convert("RGB").save(out / p.name, "JPEG", quality=80, optimize=True, progressive=True)
        else:
            shutil.copy2(p, out / p.name)


FONTS_CSS_URL = ("https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800"
                 "&family=Inter:wght@400;500;600&display=swap")
CDN_FONTS = ('<link rel="preconnect" href="https://fonts.googleapis.com">\n'
             '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
             f'<link rel="stylesheet" href="{FONTS_CSS_URL}">')
THREE_VERSION = "0.170.0"
CDN_IMPORTMAP = ('<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@%s/build/three.module.min.js",'
                 '"three/addons/":"https://cdn.jsdelivr.net/npm/three@%s/examples/jsm/"}}</script>') % (THREE_VERSION, THREE_VERSION)
LOCAL_IMPORTMAP = ('<script type="importmap">{"imports":{"three":"./vendor/three/three.module.min.js",'
                   '"three/addons/":"./vendor/three/addons/"}}</script>')


def make_icon(size: int = 512):
    """IRON ECHO icon: Forge's head from the committed render, rounded square with a blue rim (RGBA PIL image)."""
    from PIL import Image, ImageDraw

    s = 512
    head = Image.open(HEAD_RENDER).convert("RGB").crop((250, 40, 770, 560)).resize((s, s), Image.LANCZOS)
    tile = Image.new("RGBA", (s, s), (14, 17, 24, 255))
    tile.paste(head, (0, 0))
    ImageDraw.Draw(tile).rounded_rectangle((8, 8, s - 9, s - 9), radius=96, outline=(64, 118, 255, 255), width=14)
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle((8, 8, s - 9, s - 9), radius=96, fill=255)
    icon = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    icon.paste(tile, (0, 0), mask)
    return icon if size == s else icon.resize((size, size), Image.LANCZOS)


def favicon_data_uri() -> str:
    import io

    buf = io.BytesIO()
    make_icon(64).save(buf, "PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def page(template: str, core_dir: Path, game_js: str, *, assets_script: str = "", camera_menu: str = "",
         fonts: str = CDN_FONTS, importmap: str = CDN_IMPORTMAP, download_menu: str = "") -> str:
    wasm_b64 = base64.b64encode((core_dir / "ironecho_core.wasm").read_bytes()).decode("ascii")
    core_js = (core_dir / "ironecho_core.js").read_text(encoding="utf-8")
    for bad in ("</script", "<!--"):
        if bad in core_js or bad in game_js:
            raise SystemExit(f"inline script contains {bad!r}")
    return (template.replace("@@CORE_WASM_B64@@", wasm_b64).replace("@@CORE_JS@@", core_js)
            .replace("@@ASSETS_SCRIPT@@", assets_script).replace("@@CAMERA_MENU@@", camera_menu)
            .replace("@@FONTS@@", fonts).replace("@@IMPORTMAP@@", importmap)
            .replace("@@FAVICON@@", favicon_data_uri()).replace("@@VERSION@@", GAME_VERSION)
            .replace("@@DOWNLOAD_MENU@@", download_menu)
            .replace("@@GAME_JS@@", game_js))


def full_document(fragment: str) -> str:
    return ("<!doctype html><html lang=\"ru\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" "
            "content=\"width=device-width,initial-scale=1,viewport-fit=cover\"></head><body>\n" + fragment + "\n</body></html>\n")


CAMERA_MENU = """<div class="opt" data-group="control"><span>Управление</span><div class="seg">
      <button type="button" data-value="keys">КЛАВИАТУРА<small>и мышь</small></button>
      <button type="button" data-value="camera">КАМЕРА<small>бокс телом</small></button>
      <button type="button" data-value="phone" hidden>ТЕЛЕФОН<small>как камера</small></button>
    </div></div>
    <div class="opt" data-group="tracking"><span>Точность камеры</span><div class="seg">
      <button type="button" data-value="full">ОБЫЧНАЯ<small>быстрее</small></button>
      <button type="button" data-value="heavy">ВЫСОКАЯ<small>точнее, ~30 МБ</small></button>
    </div></div>
    <div class="opt" data-group="camera2" hidden><span>Вторая камера</span><div class="seg">
      <button type="button" data-value="off">НЕТ<small>одна камера</small></button>
      <button type="button" data-value="phone">+ ТЕЛЕФОН<small>точнее удары</small></button>
      <button type="button" data-value="phone-fast">+ ТЕЛЕФОН<small>меньше задержка</small></button>
      <button type="button" data-value="phones">2 ТЕЛЕФОНА<small>без веб-камеры</small></button>
    </div></div>"""


def build_site(project: Path, here: Path, out_root: Path) -> None:
    core_dir = out_root / "core"
    assets = out_root / "assets"
    site = out_root / "site"
    site_assets = site / "assets"
    site_assets.mkdir(parents=True, exist_ok=True)
    if not (core_dir / "ironecho_core.wasm").exists():
        raise SystemExit("build the core first: build_web.py core")
    print("[site] textures -> JPEG")
    tex = convert_textures(assets, site_assets)
    print("[site] meshes")
    meshes = pack_meshes(assets, site_assets)
    src = here / "site" / "src"
    template = (here / "site" / "index.template.html").read_text(encoding="utf-8")

    # artifact hosts serve no .glb: wrap every GLB as {"glb": base64} JSON next to it
    for glb in site_assets.glob("*.glb"):
        (site_assets / (glb.name + ".json")).write_text(json.dumps({"glb": base64.b64encode(glb.read_bytes()).decode("ascii")}), encoding="utf-8")

    game = bundle(src, MODULES)
    fragment = page(template, core_dir, game)
    (site / "index.html").write_text(fragment, encoding="utf-8")
    (site / "play.html").write_text(full_document(fragment), encoding="utf-8")
    sizes = {p.name: p.stat().st_size for p in sorted(site_assets.iterdir())}
    print(f"[site] index.html {len(fragment.encode()) // 1024} KB; assets: " +
          ", ".join(f"{k} {v // 1024} KB" for k, v in sizes.items()))

    # single file with the camera: assets as data URIs (no fetch), so it also works when opened from disk. Its robots
    # are meshopt-compressed (decoded by three's MeshoptDecoder, WebAssembly is available in a normal browser) and the
    # colour maps re-encoded, to stay well under the 16 MB file limit of the artifact.
    if all((src / f"{m}.js").exists() for m in CAMERA_MODULES) and len(tex) == len(TEXTURES) and len(meshes) == len(MESHES):
        cam_assets = out_root / "camera_assets"
        shutil.rmtree(cam_assets, ignore_errors=True)  # generated folder: rebuilt from scratch every time
        cam_assets.mkdir()
        compress_for_camera(assets, site_assets, cam_assets)
        mime = {".jpg": "image/jpeg", ".glb": "model/gltf-binary"}
        data = {p.name: f"data:{mime[p.suffix]};base64," + base64.b64encode(p.read_bytes()).decode("ascii")
                for p in sorted(cam_assets.iterdir()) if p.suffix in mime}
        assets_script = "<script>globalThis.IRONECHO_ASSETS = " + json.dumps(data) + ";</script>"
        game_cam = bundle(src, GAME_BUNDLE)
        single = full_document(page(template, core_dir, game_cam, assets_script=assets_script, camera_menu=CAMERA_MENU))
        (out_root / "IronEcho-Camera.html").write_text(single, encoding="utf-8")
        # public single page (one HTML that a host can import from a URL): the same game plus a link to the Windows app
        download_url = os.environ.get("IRONECHO_DOWNLOAD_URL")
        if download_url:
            menu = (f'<a class="ghost dl-win" href="{download_url}" download>СКАЧАТЬ ДЛЯ WINDOWS<small>IronEcho.exe, '
                    'без интернета</small></a>')
            public = full_document(page(template, core_dir, game_cam, assets_script=PUBLIC_DEPS + assets_script, camera_menu=CAMERA_MENU,
                                        download_menu=menu))
            (out_root / "IronEcho-Public.html").write_text(public, encoding="utf-8")
            print(f"[site] IronEcho-Public.html {len(public.encode()) // (1024 * 1024)} MB (camera + Windows download link)")
        shutil.copy2(out_root / "IronEcho-Camera.html", site / "IronEcho-Camera.html")  # the page offers it as a download
        print(f"[site] IronEcho-Camera.html {len(single.encode()) // (1024 * 1024)} MB (self-contained, webcam)")
    build_standalone(project, here, out_root)


# ---------------------------------------------------------------------------------------------------------- standalone
# Build/Web/standalone: the whole game with no third-party host at run time (three.js, MediaPipe, the pose model and
# the fonts sit next to the page). Served as /play on the public site and embedded in the Windows app
# (Tools/Build/Desktop). Needs the npm packages three@0.170.0 and @mediapipe/tasks-vision@0.10.18
# (IRONECHO_WEBDEPS=<node_modules>) and Tracking/models/pose_landmarker_full.task (Tracking setup downloads it).
THREE_ADDONS = ["loaders/GLTFLoader.js", "utils/BufferGeometryUtils.js", "libs/meshopt_decoder.module.js",
                "geometries/RoundedBoxGeometry.js"]
# SIMD build only (every Chrome/Edge/Firefox/Safari since 2021-2023); the no-SIMD twin would add 9 MB
MEDIAPIPE_FILES = ["vision_bundle.mjs", "wasm/vision_wasm_internal.js", "wasm/vision_wasm_internal.wasm"]
STANDALONE_DEPS = ('<script>globalThis.IRONECHO_DEPS = {"mediapipe": "./vendor/mediapipe", "mediapipeWorker": "./vendor/mediapipe/vision_bundle_worker.js", '
                   '"qrcode": "./vendor/qrcode/qrcode.mjs", '
                   f'"phonePage": "{PUBLIC_SITE}/phone/", "ratingApi": "{RATING_API}", '
                   '"poseModel": "./vendor/pose_landmarker_full.task", "poseModelHeavy": "./vendor/pose_landmarker_heavy.task", '
                   '"peerjs": "./vendor/peerjs/peerjs.min.js", "glb": "plain"};</script>')
# the single public page (the website's /play) keeps three.js / MediaPipe on their CDNs but serves PeerJS itself
PUBLIC_DEPS = ('<script>globalThis.IRONECHO_DEPS = {"peerjs": "./peerjs.min.js", "qrcode": "./qrcode.mjs", "phonePage": "../phone/", '
               f'"ratingApi": "{RATING_API}", "mediapipeWorker": "./vision_bundle_worker.js"}};</script>')


def local_fonts(cache: Path, dst: Path) -> str:
    """Google Fonts CSS + woff2 files copied locally (cached in Build/Web/fonts); system fonts if offline."""
    import urllib.request

    css_path = cache / "fonts.css"
    if not css_path.exists():
        try:
            cache.mkdir(parents=True, exist_ok=True)
            ua = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
                                "Chrome/130.0 Safari/537.36"}
            css = urllib.request.urlopen(urllib.request.Request(FONTS_CSS_URL, headers=ua), timeout=30).read().decode()
            for i, url in enumerate(dict.fromkeys(re.findall(r"url\((https://[^)]+\.woff2)\)", css))):
                name = f"f{i:02d}.woff2"
                (cache / name).write_bytes(urllib.request.urlopen(url, timeout=30).read())
                css = css.replace(url, name)
            css_path.write_text(css, encoding="utf-8")
        except OSError as err:
            print(f"  [fonts] offline ({err}); the page falls back to system fonts")
            return ""
    dst.mkdir(parents=True, exist_ok=True)
    for f in cache.iterdir():
        shutil.copy2(f, dst / f.name)
    return '<link rel="stylesheet" href="vendor/fonts/fonts.css">'


def build_standalone(project: Path, here: Path, out_root: Path) -> Path | None:
    deps = os.environ.get("IRONECHO_WEBDEPS")
    model = project / "Tracking" / "models" / "pose_landmarker_full.task"
    if not deps or not (Path(deps) / "three" / "package.json").exists() or not model.exists():
        print("[standalone] skipped: set IRONECHO_WEBDEPS=<node_modules with three, @mediapipe/tasks-vision> and "
              "download the tracker model (Tracking setup)")
        return None
    deps_dir = Path(deps)
    three_ver = json.loads((deps_dir / "three" / "package.json").read_text())["version"]
    if three_ver != THREE_VERSION:
        raise SystemExit(f"three {three_ver} in IRONECHO_WEBDEPS, need {THREE_VERSION}")
    src = here / "site" / "src"
    site_assets = out_root / "site" / "assets"
    out = out_root / "standalone"
    shutil.rmtree(out, ignore_errors=True)  # generated folder: rebuilt from scratch every time
    vendor = out / "vendor"
    (out / "assets").mkdir(parents=True)
    for p in site_assets.iterdir():
        if p.suffix in (".jpg", ".glb"):
            shutil.copy2(p, out / "assets" / p.name)
    (vendor / "three" / "addons").mkdir(parents=True)
    shutil.copy2(deps_dir / "three" / "build" / "three.module.min.js", vendor / "three" / "three.module.min.js")
    for a in THREE_ADDONS:
        (vendor / "three" / "addons" / a).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(deps_dir / "three" / "examples" / "jsm" / a, vendor / "three" / "addons" / a)
    mp = deps_dir / "@mediapipe" / "tasks-vision"
    for f in MEDIAPIPE_FILES:
        (vendor / "mediapipe" / f).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(mp / f, vendor / "mediapipe" / f)
    # the pose Web Worker is a classic worker and loads the CommonJS build; served as .js because workers insist on a JavaScript MIME type
    shutil.copy2(mp / "vision_bundle.cjs", vendor / "mediapipe" / "vision_bundle_worker.js")
    shutil.copy2(model, vendor / "pose_landmarker_full.task")
    peerjs = deps_dir / "peerjs" / "dist" / "peerjs.min.js"  # online duel: WebRTC rooms (MIT)
    if peerjs.exists():
        (vendor / "peerjs").mkdir(parents=True, exist_ok=True)
        shutil.copy2(peerjs, vendor / "peerjs" / "peerjs.min.js")
    else:
        print("  [standalone] peerjs missing in IRONECHO_WEBDEPS: the online duel loads it from the CDN")
    heavy = model.with_name("pose_landmarker_heavy.task")
    if heavy.exists():
        shutil.copy2(heavy, vendor / "pose_landmarker_heavy.task")
    else:
        print("  [standalone] pose_landmarker_heavy.task missing: the 'Высокая' accuracy needs the network (Google storage)")
    qr = deps_dir / "qrcode-generator" / "dist" / "qrcode.mjs"  # QR code for pairing the phone camera (MIT)
    if qr.exists():
        (vendor / "qrcode").mkdir(parents=True, exist_ok=True)
        shutil.copy2(qr, vendor / "qrcode" / "qrcode.mjs")
    else:
        print("  [standalone] qrcode-generator missing in IRONECHO_WEBDEPS: the phone pairing shows the link only")
    fonts = local_fonts(out_root / "fonts", vendor / "fonts")
    template = (here / "site" / "index.template.html").read_text(encoding="utf-8")
    game = bundle(src, GAME_BUNDLE)
    doc = full_document(page(template, out_root / "core", game, assets_script=STANDALONE_DEPS, camera_menu=CAMERA_MENU,
                             fonts=fonts, importmap=LOCAL_IMPORTMAP))
    (out / "index.html").write_text(doc, encoding="utf-8")
    size = sum(p.stat().st_size for p in out.rglob("*") if p.is_file())
    print(f"[standalone] {out} {size // (1024 * 1024)} MB (no third-party hosts at run time)")
    return out
