"""Bake the procedural IE-1 materials (paint, scratches, chips, dust, grime, carbon, leather) into one PBR texture
set per robot and export a game-ready FBX that Unreal can use as is.

    python bake_robot.py --out ArtSource/Realistic/Export [--livery Forge,Ember] [--res 4096] [--samples 16]

Output per livery: SK_IE1_<L>.fbx (one material M_IE1_<L>, UV0 atlas), T_IE1_<L>_BaseColor.png (sRGB),
T_IE1_<L>_Normal.png (tangent space, OpenGL +Y, Unreal: tick "Flip Green Channel"), T_IE1_<L>_ORM.png
(R = AO, G = Roughness, B = Metallic, linear), T_IE1_<L>_Emissive.png (LEDs), bake_check_<L>.png (Cycles render of
the baked result for comparison). Contract checks as in export_robot.py.
"""

import argparse
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "..", "Unreal", "Tech"))

import bpy  # noqa: E402
import numpy as np  # noqa: E402

import export_robot as EX  # noqa: E402
import rlib as R  # noqa: E402
import robot as RB  # noqa: E402
import robot_contract as RC  # noqa: E402

CHANNELS = ("Base Color", "Roughness", "Metallic", "Emission")


def join_robot(arm):
    meshes = [o for o in arm.children if o.type == "MESH"]
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    for m in [m for m in obj.modifiers if m.type == "ARMATURE"][1:]:
        obj.modifiers.remove(m)
    return obj


def unwrap(obj, margin):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=margin, area_weight=0.6,
                             correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.select_all(action="SELECT")
    try:  # tight packing: smart_project alone leaves ~40 % of the atlas empty
        bpy.ops.uv.pack_islands(udim_source="CLOSEST_UDIM", rotate=True, rotate_method="ANY", scale=True,
                                merge_overlap=False, margin_method="SCALED", margin=margin, shape_method="CONCAVE")
    except TypeError:
        bpy.ops.uv.pack_islands(rotate=True, margin=margin)
    bpy.ops.object.mode_set(mode="OBJECT")


def new_image(name, res, non_color):
    img = bpy.data.images.new(name, res, res, alpha=False, float_buffer=False)
    img.colorspace_settings.name = "Non-Color" if non_color else "sRGB"
    img.generated_color = (0.5, 0.5, 1.0, 1.0) if "Normal" in name else (0, 0, 0, 1)
    return img


def set_target(materials, img):
    for mat in materials:
        nt = mat.node_tree
        node = nt.nodes.get("__bake__") or nt.nodes.new("ShaderNodeTexImage")
        node.name = "__bake__"
        node.image = img
        nt.nodes.active = node


def rewire(mat, channel):
    """Temporarily route one BSDF input into an emission shader -> output. Returns an undo closure."""
    nt = mat.node_tree
    out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
    bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    old = out.inputs["Surface"].links[0].from_socket if out.inputs["Surface"].is_linked else None
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Strength"].default_value = 1.0
    if bsdf is None:
        em.inputs["Color"].default_value = (0, 0, 0, 1)
    else:
        src = bsdf.inputs["Emission Color" if channel == "Emission" else channel]
        if src.is_linked:
            nt.links.new(src.links[0].from_socket, em.inputs["Color"])
        else:
            v = src.default_value
            em.inputs["Color"].default_value = (v[0], v[1], v[2], 1) if hasattr(v, "__len__") else (v, v, v, 1)
        if channel == "Emission":
            em.inputs["Strength"].default_value = min(bsdf.inputs["Emission Strength"].default_value, 1.0)
    nt.links.new(em.outputs[0], out.inputs["Surface"])

    def undo():
        if old is not None:
            nt.links.new(old, out.inputs["Surface"])
        nt.nodes.remove(em)
    return undo


def bake(kind, obj, margin_px):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    kw = dict(type=kind, margin=margin_px, use_clear=True)
    if kind == "NORMAL":
        kw.update(normal_space="TANGENT")
    bpy.ops.object.bake(**kw)


def pixels(img):
    a = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(-1, 4)


def save(img, path):
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()


def game_material(name, out, livery):
    mat = bpy.data.materials.new(name)
    nt, bsdf = R._nodes(mat)

    def tex(key, non_color):
        n = nt.nodes.new("ShaderNodeTexImage")
        n.image = bpy.data.images.load(os.path.join(out, f"T_IE1_{livery}_{key}.png"), check_existing=False)
        n.image.colorspace_settings.name = "Non-Color" if non_color else "sRGB"
        return n

    bc = tex("BaseColor", False)
    orm = tex("ORM", True)
    nm = tex("Normal", True)
    em = tex("Emissive", False)
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(orm.outputs["Color"], sep.inputs[0])
    ao_mul = nt.nodes.new("ShaderNodeMix")
    ao_mul.data_type = "RGBA"
    ao_mul.blend_type = "MULTIPLY"
    ao_mul.inputs[0].default_value = 1.0
    nt.links.new(bc.outputs["Color"], ao_mul.inputs[6])
    nt.links.new(sep.outputs[0], ao_mul.inputs[7])
    nt.links.new(ao_mul.outputs[2], bsdf.inputs["Base Color"])
    nt.links.new(sep.outputs[1], bsdf.inputs["Roughness"])
    nt.links.new(sep.outputs[2], bsdf.inputs["Metallic"])
    nmap = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(nm.outputs["Color"], nmap.inputs["Color"])
    nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    nt.links.new(em.outputs["Color"], bsdf.inputs["Emission Color"])
    bsdf.inputs["Emission Strength"].default_value = 12.0
    return mat


def check_render(obj, arm, path):
    R.set_collection(bpy.context.scene.collection)
    R.box("floor", (6, 6, 0.02), (0, 0, -0.01), mat=R.mat_rough("CheckFloor", (0.2, 0.2, 0.21), 0.6), bevel=0)
    R.world((0.02, 0.022, 0.026), 1.0)
    R.area_light("key", (2.6, -1.6, 3.2), (0, 0, 1.3), 900, 2.0, (1, 0.96, 0.9))
    R.area_light("rim", (-2.5, 1.5, 2.6), (0, 0, 1.4), 1100, 1.0, (0.75, 0.85, 1.0))
    R.camera("cam", (2.9, -2.1, 1.45), (0.0, 0, 1.05), lens=42, fstop=5.6)
    RB.pose(arm, **RB.STANCES["guard"])
    R.setup_render(900, 1200, 64)
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def bake_livery(lv, out, res, samples):
    R.reset_scene()
    R.QUALITY["mode"] = "game"
    arm = RB.build_robot(lv)
    facts = EX.facts_for(arm)
    findings = RC.check_robot(facts)
    obj = join_robot(arm)
    obj.name = f"SK_IE1_{lv.name}"
    unwrap(obj, 0.002)
    mats = [m for m in obj.data.materials if m is not None]
    s = bpy.context.scene
    s.render.engine = "CYCLES"
    s.cycles.device = "CPU"
    s.cycles.samples = samples
    s.render.bake.margin = 6
    margin = max(4, res // 256)

    img_n = new_image(f"T_IE1_{lv.name}_Normal", res, True)
    set_target(mats, img_n)
    bake("NORMAL", obj, margin)
    save(img_n, os.path.join(out, f"T_IE1_{lv.name}_Normal.png"))

    img_ao = new_image(f"T_IE1_{lv.name}_AO", res, True)
    set_target(mats, img_ao)
    bake("AO", obj, margin)

    baked = {}
    for ch in CHANNELS:
        img = new_image(f"T_IE1_{lv.name}_{ch.replace(' ', '')}", res, ch in ("Roughness", "Metallic"))
        set_target(mats, img)
        undos = [rewire(m, ch) for m in mats]
        bake("EMIT", obj, margin)
        for u in undos:
            u()
        baked[ch] = img
    save(baked["Base Color"], os.path.join(out, f"T_IE1_{lv.name}_BaseColor.png"))
    save(baked["Emission"], os.path.join(out, f"T_IE1_{lv.name}_Emissive.png"))
    orm = np.ones((res * res, 4), dtype=np.float32)
    orm[:, 0] = pixels(img_ao)[:, 0]
    orm[:, 1] = pixels(baked["Roughness"])[:, 0]
    orm[:, 2] = pixels(baked["Metallic"])[:, 0]
    img_orm = new_image(f"T_IE1_{lv.name}_ORM", res, True)
    img_orm.pixels.foreach_set(orm.reshape(-1))
    save(img_orm, os.path.join(out, f"T_IE1_{lv.name}_ORM.png"))

    gm = game_material(f"M_IE1_{lv.name}", out, lv.name)
    obj.data.materials.clear()
    obj.data.materials.append(gm)
    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    fbx = os.path.join(out, f"SK_IE1_{lv.name}.fbx")
    EX.export(arm, fbx)
    check_render(obj, arm, os.path.join(out, f"bake_check_{lv.name}.png"))
    return {"facts": facts, "findings": [f.__dict__ for f in findings], "triangles": tris, "fbx": fbx,
            "texture_res": res}


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--livery", default="Forge,Ember")
    ap.add_argument("--res", type=int, default=4096)
    ap.add_argument("--samples", type=int, default=16)
    args = ap.parse_args(argv)
    out = os.path.abspath(args.out)
    os.makedirs(out, exist_ok=True)
    report = {}
    for name in args.livery.split(","):
        lv = {"Forge": RB.FORGE, "Ember": RB.EMBER}[name]
        report[name] = bake_livery(lv, out, args.res, args.samples)
        errs = [f for f in report[name]["findings"] if f["level"] == "error"]
        print(f"{name}: triangles={report[name]['triangles']} contract_errors={len(errs)}", flush=True)
    with open(os.path.join(out, "bake_report.json"), "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2)
    return 1 if any(f["level"] == "error" for r in report.values() for f in r["findings"]) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]))
