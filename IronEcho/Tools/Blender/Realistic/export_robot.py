"""Export IE-1 robots to FBX for Unreal and check them against ROBOT_VISUAL_CONTRACT (same checks as the editor
validator, Tools/Unreal/Tech/robot_contract.py).

    python export_robot.py --out ArtSource/Realistic/Export [--livery Forge,Ember] [--blend]

Axes: the robot faces +X with its left on +Y in Blender. Unreal flips Y on FBX import (right-handed -> left-handed),
so in Unreal it faces +X with its right on +Y, as the contract requires. Units: metres in Blender, FBX unit scale
applied -> centimetres in Unreal. Verified here: bones, proportions, sides. Not verified: the Unreal import itself
(needs the Windows PC; run Tools/Unreal/Tech/validate_robot.py there).
"""

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "..", "Unreal", "Tech"))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import rlib as R  # noqa: E402
import robot as RB  # noqa: E402
import robot_contract as RC  # noqa: E402


def facts_for(arm) -> dict:
    """Facts in Unreal component space (cm, Y flipped)."""
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    torso_half = 0.0
    for obj in arm.children:
        if obj.type != "MESH":
            continue
        ev = obj.evaluated_get(dg)
        me = ev.to_mesh()
        bone = obj.vertex_groups[0].name if obj.vertex_groups else ""
        for v in me.vertices:
            w = obj.matrix_world @ v.co
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
            if bone in ("spine_02", "spine_03", "spine_01", "pelvis"):
                torso_half = max(torso_half, abs(w.y))
        ev.to_mesh_clear()

    def ue(v):
        return [v.x * 100.0, -v.y * 100.0, v.z * 100.0]

    bones = arm.data.bones
    sh = bones["upperarm_l"].head_local
    hand = bones["hand_l"].head_local
    ue_lo, ue_hi = ue(lo), ue(hi)
    return {
        "bones": [b.name for b in bones],
        "sockets": ["fist_l", "fist_r", "hit_head", "hit_body"],  # created from bones/heads by the UE import step
        "bounds_min": [min(a, b) for a, b in zip(ue_lo, ue_hi)],
        "bounds_max": [max(a, b) for a, b in zip(ue_lo, ue_hi)],
        "shoulder_height": sh.z * 100.0,
        "head_height": bones["head"].tail_local.z * 100.0,
        "arm_length": (hand - sh).length * 100.0,
        "torso_half_width": torso_half * 100.0,
        "fist_l_y": ue(bones["fist_tip_l"].head_local)[1],
        "fist_r_y": ue(bones["fist_tip_r"].head_local)[1],
    }


def export(arm, path):
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    for obj in arm.children:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.export_scene.fbx(
        filepath=path, use_selection=True, object_types={"ARMATURE", "MESH"}, apply_unit_scale=True,
        apply_scale_options="FBX_SCALE_UNITS", axis_forward="X", axis_up="Z", add_leaf_bones=False,
        primary_bone_axis="Y", secondary_bone_axis="X", use_armature_deform_only=False, bake_anim=False,
        mesh_smooth_type="FACE", use_mesh_modifiers=True, path_mode="STRIP")


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--livery", default="Forge,Ember")
    ap.add_argument("--blend", action="store_true", help="also save the source .blend")
    ap.add_argument("--quality", default="game", choices=("game", "render"))
    args = ap.parse_args(argv)
    os.makedirs(args.out, exist_ok=True)
    R.QUALITY["mode"] = args.quality
    report = {}
    for name in args.livery.split(","):
        R.reset_scene()
        lv = {"Forge": RB.FORGE, "Ember": RB.EMBER}[name]
        arm = RB.build_robot(lv)
        facts = facts_for(arm)
        findings = RC.check_robot(facts)
        report[name] = {"facts": facts, "findings": [f.__dict__ for f in findings]}
        tris = sum(len(p.vertices) - 2 for o in arm.children if o.type == "MESH" for p in o.data.polygons)
        report[name]["triangles"] = tris
        path = os.path.join(args.out, f"SK_IE1_{name}.fbx")
        export(arm, path)
        if args.blend:
            bpy.ops.wm.save_as_mainfile(filepath=os.path.join(args.out, f"IE1_{name}.blend"), compress=True)
        errors = [f for f in findings if f.level == "error"]
        print(f"{name}: {path} triangles={tris} errors={len(errors)} warnings="
              f"{len([f for f in findings if f.level == 'warning'])}", flush=True)
        for f in findings:
            print(f"  {f.level}: {f.code}: {f.message}", flush=True)
    with open(os.path.join(args.out, "contract_report.json"), "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2)
    return 1 if any(f["level"] == "error" for r in report.values() for f in r["findings"]) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]))
