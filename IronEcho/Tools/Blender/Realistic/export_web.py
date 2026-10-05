"""Assets for the browser version (Tools/Build/Web): the same realistic IE-1 robots, ring and venue as the Unreal
pipeline, packed for three.js.

    python export_web.py --out Build/Web/assets [--what robots,canvas,venue] [--res 2048] [--pano 4096]

robots  per livery: IE1_<L>.glb (game mesh + contract skeleton, rigid skin, UV atlas; no material) and the baked PBR
        set T_IE1_<L>_{BaseColor,Normal,ORM,Emissive}.png (ORM: R = AO, G = roughness, B = metallic, which is exactly
        what three.js aoMap / roughnessMap / metalnessMap read). glTF is Y-up: Blender (x, y, z) -> (x, z, -y).
canvas  T_Ring_Canvas.png: albedo of the canvas with its prints (orthographic top view, Diffuse Color pass, the
        whole canvas square 2 * APRON + 0.04 m), T_Ring_Apron.png: one printed apron side (front view).
venue   T_Venue_Pano.png: equirectangular Cycles render of the lit hall without the ring, from the game camera height;
        the page uses it as background and as the environment for reflections. Centre of the image looks along +X
        (toward the opponent), left edge = -X behind.
"""

import argparse
import json
import math
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "..", "Unreal", "Tech"))

import bpy  # noqa: E402
import numpy as np  # noqa: E402

import bake_robot as BK  # noqa: E402
import export_robot as EX  # noqa: E402
import rlib as R  # noqa: E402
import ring as RG  # noqa: E402
import robot as RB  # noqa: E402
import robot_contract as RC  # noqa: E402

PANO_EYE = (0.0, 0.0, 1.75)  # above the canvas; the page keeps the background centred on the camera


def bake_set(obj, lv, out, res, samples):
    mats = [m for m in obj.data.materials if m is not None]
    s = bpy.context.scene
    s.render.engine = "CYCLES"
    s.cycles.device = "CPU"
    s.cycles.samples = samples
    margin = max(4, res // 256)

    img_n = BK.new_image(f"T_IE1_{lv.name}_Normal", res, True)
    BK.set_target(mats, img_n)
    BK.bake("NORMAL", obj, margin)
    BK.save(img_n, os.path.join(out, f"T_IE1_{lv.name}_Normal.png"))

    img_ao = BK.new_image(f"T_IE1_{lv.name}_AO", res, True)
    BK.set_target(mats, img_ao)
    BK.bake("AO", obj, margin)

    baked = {}
    for ch in BK.CHANNELS:
        img = BK.new_image(f"T_IE1_{lv.name}_{ch.replace(' ', '')}", res, ch in ("Roughness", "Metallic"))
        BK.set_target(mats, img)
        undos = [BK.rewire(m, ch) for m in mats]
        BK.bake("EMIT", obj, margin)
        for u in undos:
            u()
        baked[ch] = img
    BK.save(baked["Base Color"], os.path.join(out, f"T_IE1_{lv.name}_BaseColor.png"))
    BK.save(baked["Emission"], os.path.join(out, f"T_IE1_{lv.name}_Emissive.png"))
    orm = np.ones((res * res, 4), dtype=np.float32)
    orm[:, 0] = BK.pixels(img_ao)[:, 0]
    orm[:, 1] = BK.pixels(baked["Roughness"])[:, 0]
    orm[:, 2] = BK.pixels(baked["Metallic"])[:, 0]
    img_orm = BK.new_image(f"T_IE1_{lv.name}_ORM", res, True)
    img_orm.pixels.foreach_set(orm.reshape(-1))
    BK.save(img_orm, os.path.join(out, f"T_IE1_{lv.name}_ORM.png"))


def export_glb(arm, obj, path):
    obj.data.materials.clear()
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True, export_yup=True, export_apply=False,
        export_texcoords=True, export_normals=True, export_tangents=False, export_materials="NONE",
        export_skins=True, export_all_influences=False, export_def_bones=False, export_animations=False,
        export_morph=False, export_extras=False, export_cameras=False, export_lights=False)


def decimate(obj, ratio):
    """Web level of detail: collapse decimation before the UV unwrap, so the bake lands on the final mesh. The
    materials are procedural (object-space wear), so their detail survives; silhouettes get coarser."""
    if ratio >= 0.999:
        return
    mod = obj.modifiers.new("WebLOD", "DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = ratio
    mod.use_collapse_triangulate = True
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_move_to_index(modifier=mod.name, index=0)
    bpy.ops.object.modifier_apply(modifier=mod.name)


def robots(out, res, samples, liveries, lod):
    report = {}
    for name in liveries:
        t0 = time.time()
        R.reset_scene()
        R.QUALITY["mode"] = "game"
        lv = {"Forge": RB.FORGE, "Ember": RB.EMBER}[name]
        arm = RB.build_robot(lv)
        facts = EX.facts_for(arm)
        findings = RC.check_robot(facts)
        obj = BK.join_robot(arm)
        obj.name = f"IE1_{lv.name}"
        decimate(obj, lod)
        BK.unwrap(obj, 0.002)
        bake_set(obj, lv, out, res, samples)
        tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
        export_glb(arm, obj, os.path.join(out, f"IE1_{lv.name}.glb"))
        report[name] = {"triangles": tris, "contract_errors": [f.__dict__ for f in findings if f.level == "error"],
                        "seconds": round(time.time() - t0, 1)}
        print(f"[robots] {name}: {tris} triangles, {time.time() - t0:.0f}s", flush=True)
    return report


def _diffcol_render(path, res_x, res_y):
    """Render the Diffuse Color pass (pure albedo, no lighting) of the active camera to a PNG."""
    s = bpy.context.scene
    s.render.engine = "CYCLES"
    s.cycles.device = "CPU"
    s.cycles.samples = 16
    s.cycles.use_denoising = False
    s.render.resolution_x, s.render.resolution_y = res_x, res_y
    s.render.resolution_percentage = 100
    s.view_settings.view_transform = "Standard"
    s.view_settings.look = "None"
    s.view_settings.exposure = 0.0
    s.render.film_transparent = False
    vl = s.view_layers[0]
    vl.use_pass_diffuse_color = True
    s.use_nodes = True
    nt = s.node_tree
    nt.nodes.clear()
    rl = nt.nodes.new("CompositorNodeRLayers")
    comp = nt.nodes.new("CompositorNodeComposite")
    nt.links.new(rl.outputs["DiffCol"], comp.inputs["Image"])
    s.render.image_settings.file_format = "PNG"
    s.render.image_settings.color_mode = "RGB"
    s.render.filepath = path
    bpy.ops.render.render(write_still=True)


def canvas(out, res):
    R.reset_scene()
    RG.build_ring(with_arena=False)
    R.set_collection(bpy.context.scene.collection)
    R.world((1.0, 1.0, 1.0), 1.0)
    size = 2 * RG.APRON + 0.04
    # top view: everything that is not the canvas or a print on it would only occlude
    keep = ("canvas", "canvas_logo", "canvas_circle", "canvas_sub", "canvas_sub2", "corner_")
    for o in bpy.data.objects:  # ropes are curves: hide by name, not by type
        if o.type in ("MESH", "CURVE", "FONT") and not o.name.startswith(keep):
            o.hide_render = True
    cam = R.camera("TopCam", (0, 0, 6.0), (0, 0, 0), lens=50)
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = size
    cam.rotation_euler = (0, 0, 0)
    bpy.context.scene.camera = cam
    _diffcol_render(os.path.join(out, "T_Ring_Canvas.png"), res, res)

    # one apron side, seen from +X
    for o in bpy.data.objects:
        if o.type in ("MESH", "CURVE", "FONT"):
            o.hide_render = not (o.name.startswith(("platform", "apron_txt0", "apron_band0")))
    cam2 = R.camera("SideCam", (RG.APRON + 5.0, 0, -RG.RING_HEIGHT / 2), (0, 0, -RG.RING_HEIGHT / 2), lens=50)
    cam2.data.type = "ORTHO"
    cam2.data.ortho_scale = 2 * RG.APRON
    bpy.context.scene.camera = cam2
    h = int(res * RG.RING_HEIGHT / (2 * RG.APRON))
    _diffcol_render(os.path.join(out, "T_Ring_Apron.png"), res, max(64, h))
    print("[canvas] done", flush=True)


def venue(out, res, samples):
    t0 = time.time()
    R.reset_scene()
    RG.build_arena()
    RG.light_arena()
    R.set_collection(bpy.context.scene.collection)
    R.setup_render(res, res // 2, samples, exposure=-0.15)
    s = bpy.context.scene
    s.cycles.volume_step_rate = 4.0
    cam_data = bpy.data.cameras.new("Pano")
    cam_data.type = "PANO"
    cam_data.panorama_type = "EQUIRECTANGULAR"
    cam = bpy.data.objects.new("Pano", cam_data)
    s.collection.objects.link(cam)
    cam.location = PANO_EYE
    cam.rotation_euler = (math.pi / 2, 0, -math.pi / 2)  # looks along +X, Z up
    s.camera = cam
    s.render.image_settings.file_format = "PNG"
    s.render.image_settings.color_mode = "RGB"
    s.render.filepath = os.path.join(out, "T_Venue_Pano.png")
    bpy.ops.render.render(write_still=True)
    print(f"[venue] {res}x{res // 2} in {time.time() - t0:.0f}s", flush=True)


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--what", default="robots,canvas,venue")
    ap.add_argument("--livery", default="Forge,Ember")
    ap.add_argument("--res", type=int, default=2048, help="robot texture size")
    ap.add_argument("--samples", type=int, default=16, help="bake samples")
    ap.add_argument("--pano", type=int, default=4096, help="venue panorama width")
    ap.add_argument("--pano-samples", type=int, default=64)
    ap.add_argument("--lod", type=float, default=0.55, help="robot decimation ratio for the web (1 = game mesh)")
    args = ap.parse_args(argv)
    out = os.path.abspath(args.out)
    os.makedirs(out, exist_ok=True)
    what = set(args.what.split(","))
    report = {}
    if "robots" in what:
        report["robots"] = robots(out, args.res, args.samples, args.livery.split(","), args.lod)
    if "canvas" in what:
        canvas(out, 2048)
    if "venue" in what:
        venue(out, args.pano, args.pano_samples)
    path = os.path.join(out, "web_assets_report.json")
    old = {}
    if os.path.exists(path):
        with open(path, encoding="utf-8") as fh:
            old = json.load(fh)
    old.update(report)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(old, fh, indent=2)
    errors = [e for r in report.get("robots", {}).values() for e in r["contract_errors"]]
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]))
