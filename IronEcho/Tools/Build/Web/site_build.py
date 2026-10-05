"""Assemble the browser game into Build/Web/site (called by build_web.py site|all).

Output:
  Build/Web/site/index.html          page fragment for the claude.ai artifact (the host adds <!doctype>/<head>/<body>)
  Build/Web/site/play.html           the same page as a full document, for a local web server
  Build/Web/site/assets/*            robots (GLB + JPEG textures), ring canvas, venue panorama
  Build/Web/IronEcho-Camera.html     single self-contained file (assets inlined) with the webcam mode; opens from disk
"""
from __future__ import annotations

import base64
import json
import os
import re
import shutil
import subprocess
from pathlib import Path

MODULES = ["core", "rig", "anim", "arena", "fx", "audio", "input", "hud", "main"]
CAMERA_MODULES = ["pose"]

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


def page(template: str, core_dir: Path, game_js: str, *, assets_script: str = "", camera_menu: str = "") -> str:
    wasm_b64 = base64.b64encode((core_dir / "ironecho_core.wasm").read_bytes()).decode("ascii")
    core_js = (core_dir / "ironecho_core.js").read_text(encoding="utf-8")
    for bad in ("</script", "<!--"):
        if bad in core_js or bad in game_js:
            raise SystemExit(f"inline script contains {bad!r}")
    return (template.replace("@@CORE_WASM_B64@@", wasm_b64).replace("@@CORE_JS@@", core_js)
            .replace("@@ASSETS_SCRIPT@@", assets_script).replace("@@CAMERA_MENU@@", camera_menu)
            .replace("@@GAME_JS@@", game_js))


def full_document(fragment: str) -> str:
    return ("<!doctype html><html lang=\"ru\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" "
            "content=\"width=device-width,initial-scale=1,viewport-fit=cover\"></head><body>\n" + fragment + "\n</body></html>\n")


CAMERA_MENU = """<div class="opt" data-group="control"><span>Управление</span><div class="seg">
      <button type="button" data-value="keys">КЛАВИАТУРА<small>и мышь</small></button>
      <button type="button" data-value="camera">КАМЕРА<small>бокс телом</small></button>
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
        game_cam = bundle(src, ["meshopt", "core", "rig", "anim", "arena", "fx", "audio", "input", "hud", "pose", "main"])
        single = full_document(page(template, core_dir, game_cam, assets_script=assets_script, camera_menu=CAMERA_MENU))
        (out_root / "IronEcho-Camera.html").write_text(single, encoding="utf-8")
        print(f"[site] IronEcho-Camera.html {len(single.encode()) // (1024 * 1024)} MB (self-contained, webcam)")
