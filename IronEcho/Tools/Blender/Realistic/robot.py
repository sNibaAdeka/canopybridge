"""IE-1 realistic boxing humanoid: geometry, contract skeleton (ROBOT_VISUAL_CONTRACT §4), rigid skinning, liveries
and analytic posing (guard / jab / slip) used for renders. Robot faces +X, left side is +Y (Blender, right-handed);
FBX export to Unreal maps this to +X forward, right side +Y (contract §2).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Dict, Tuple

import bpy
from mathutils import Matrix, Vector

import rlib as R

V = Vector


@dataclass
class Livery:
    name: str
    shell: Tuple[float, float, float]
    accent: Tuple[float, float, float]
    frame: Tuple[float, float, float]
    glove: Tuple[float, float, float]
    led: Tuple[float, float, float]
    number: str
    wear: float
    style: str = "sparring"                          # robot2.py: "sparring" (rounded) or "champion" (angular, crested)
    trim: Tuple[float, float, float] = (0.62, 0.63, 0.65)  # bare-metal trim (brass on the champion)


# IE-2 (robot2.py). FORGE: worn steel-blue armour over a dark frame, off-white markings, cold blue lights.
# EMBER: black armour, crimson plates, brass trim, ember-orange lights.
FORGE = Livery("Forge", (0.016, 0.070, 0.290), (0.300, 0.310, 0.320), (0.060, 0.064, 0.072), (0.006, 0.03, 0.24),
               (0.20, 0.62, 1.0), "07", 0.42, "sparring", (0.62, 0.63, 0.65))
EMBER = Livery("Ember", (0.022, 0.022, 0.026), (0.380, 0.022, 0.014), (0.080, 0.076, 0.076), (0.3, 0.012, 0.008),
               (1.0, 0.26, 0.04), "13", 0.45, "champion", (0.560, 0.390, 0.130))

# Rest pose (A-pose), metres. name: (head, tail, parent)
BONES: Dict[str, Tuple[Tuple[float, float, float], Tuple[float, float, float], str]] = {
    "root": ((0, 0, 0), (0, 0.25, 0), ""),
    "pelvis": ((0, 0, 0.97), (0, 0, 1.08), "root"),
    "spine_01": ((0, 0, 1.08), (0, 0, 1.21), "pelvis"),
    "spine_02": ((0, 0, 1.21), (0, 0, 1.35), "spine_01"),
    "spine_03": ((0, 0, 1.35), (0, 0, 1.55), "spine_02"),
    "neck_01": ((0, 0, 1.58), (0, 0, 1.70), "spine_03"),
    "head": ((0, 0, 1.70), (0, 0, 1.96), "neck_01"),
    "thigh_l": ((0, 0.12, 0.95), (0, 0.13, 0.52), "pelvis"),
    "calf_l": ((0, 0.13, 0.52), (0, 0.14, 0.10), "thigh_l"),
    "foot_l": ((0, 0.14, 0.10), (0.17, 0.14, 0.03), "calf_l"),
    "thigh_r": ((0, -0.12, 0.95), (0, -0.13, 0.52), "pelvis"),
    "calf_r": ((0, -0.13, 0.52), (0, -0.14, 0.10), "thigh_r"),
    "foot_r": ((0, -0.14, 0.10), (0.17, -0.14, 0.03), "calf_r"),
    "clavicle_l": ((0, 0.05, 1.53), (0, 0.20, 1.57), "spine_03"),
    "upperarm_l": ((0, 0.235, 1.57), (0, 0.335, 1.225), "clavicle_l"),
    "lowerarm_l": ((0, 0.335, 1.225), (0, 0.405, 0.895), "upperarm_l"),
    "hand_l": ((0, 0.405, 0.895), (0, 0.425, 0.795), "lowerarm_l"),
    "clavicle_r": ((0, -0.05, 1.53), (0, -0.20, 1.57), "spine_03"),
    "upperarm_r": ((0, -0.235, 1.57), (0, -0.335, 1.225), "clavicle_r"),
    "lowerarm_r": ((0, -0.335, 1.225), (0, -0.405, 0.895), "upperarm_r"),
    "hand_r": ((0, -0.405, 0.895), (0, -0.425, 0.795), "lowerarm_r"),
    # extra leaf bones: glove striking surface; the Unreal import step turns them into sockets fist_l/fist_r on hand_*
    "fist_tip_l": ((0, 0.458, 0.63), (0, 0.466, 0.59), "hand_l"),
    "fist_tip_r": ((0, -0.458, 0.63), (0, -0.466, 0.59), "hand_r"),
}
LIMB_BONES = ("upperarm_l", "lowerarm_l", "hand_l", "fist_tip_l", "upperarm_r", "lowerarm_r", "hand_r", "fist_tip_r",
              "thigh_l", "calf_l", "foot_l", "thigh_r", "calf_r", "foot_r")


def rest_frame(bone: str) -> Matrix:
    h, t, _ = BONES[bone]
    return R.frame_matrix(V(h), V(t))


class Kit:
    """Materials for one livery."""

    def __init__(self, lv: Livery):
        p = lv.name
        self.shell = R.mat_painted(f"{p}_Shell", lv.shell, wear=lv.wear, scratch=0.3)
        self.accent = R.mat_painted(f"{p}_Accent", lv.accent, wear=lv.wear * 0.8, rough=0.3, scratch=0.3)
        self.frame = R.mat_metal(f"{p}_Frame", lv.frame, rough=0.36, aniso=0.5)
        self.alu = R.mat_metal("RawAluminium", (0.62, 0.63, 0.65), rough=0.28, aniso=0.7)
        self.steel = R.mat_metal("DarkSteel", (0.18, 0.18, 0.19), rough=0.4, brushed=False)
        self.chrome = R.mat_metal("Chrome", (0.9, 0.9, 0.92), rough=0.07, aniso=0.0, brushed=False, grime=0.2)
        self.bolt = R.mat_metal("Bolt", (0.35, 0.35, 0.36), rough=0.35, brushed=False)
        self.carbon = R.mat_carbon()
        self.rubber = R.mat_rough("Rubber", (0.025, 0.025, 0.027), 0.82, bump_scale=900, bump=0.08)
        self.plastic = R.mat_rough("BlackPlastic", (0.03, 0.031, 0.034), 0.45, bump_scale=1500, bump=0.03)
        self.cablemat = R.mat_cloth("BraidedSleeve", (0.02, 0.02, 0.022), 0.6, 1400)
        self.glass = R.mat_glass_dark()
        self.led = R.mat_emissive(f"{p}_LED", lv.led, 18.0)
        self.lens = R.mat_emissive(f"{p}_Lens", (lv.led[0] * 0.6, lv.led[1] * 0.6, lv.led[2] * 0.6), 6.0)
        self.glove = R.mat_leather(f"{p}_Glove", lv.glove)
        self.tape = R.mat_cloth("Tape", (0.62, 0.62, 0.6), 0.85, 600)
        self.decal = R.mat_rough(f"{p}_Decal", (0.85, 0.85, 0.85) if sum(lv.shell) < 1.0 else (0.02, 0.02, 0.025),
                                 0.4)
        self.warn = R.mat_rough("WarnYellow", (0.75, 0.48, 0.02), 0.45)
        self.trim = R.mat_metal(f"{p}_Trim", lv.trim, rough=0.3, aniso=0.2, brushed=False, grime=0.35)


def _in_frame(objs, bone):
    """Objects modelled in a bone frame (z along bone, x forward) -> placed in rest pose."""
    m = rest_frame(bone)
    for o in objs:
        o.matrix_world = m @ o.matrix_basis  # matrix_world is stale until a depsgraph update
    return objs


def _assign(objs, bone, arm, prefix):
    obj = R.join(objs, f"{prefix}_{bone}")
    vg = obj.vertex_groups.new(name=bone)
    vg.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
    obj.parent = arm
    mod = obj.modifiers.new("Armature", "ARMATURE")
    mod.object = arm
    return obj


# ------------------------------------------------------------------------------------------------------------ build


def build_armature(prefix: str) -> bpy.types.Object:
    data = bpy.data.armatures.new(f"{prefix}_Skeleton")
    arm = R._link(bpy.data.objects.new(f"{prefix}_Rig", data))
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    for name, (h, t, parent) in BONES.items():
        eb = data.edit_bones.new(name)
        eb.head, eb.tail = h, t
        eb.roll = 0.0
        if parent:
            eb.parent = data.edit_bones[parent]
            eb.use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    data.display_type = "STICK"
    arm.show_in_front = True
    return arm


def build_robot(lv: Livery, prefix: str = None) -> bpy.types.Object:
    """IE-2: the parts come from robot2.py (designed from scratch in 2026-11); the skeleton and the contract are the same."""
    import robot2 as P

    prefix = prefix or f"IE1_{lv.name}"
    col = R.collection(prefix)
    R.set_collection(col)
    k = Kit(lv)
    arm = build_armature(prefix)
    world_parts = {
        "head": P.head(k, lv), "neck_01": P.neck(k, lv), "spine_03": P.chest(k, lv), "spine_01": P.abdomen(k, lv),
        "pelvis": P.pelvis(k, lv), "clavicle_l": P.clavicle(k, lv, 1), "clavicle_r": P.clavicle(k, lv, -1),
        "foot_l": P.foot(k, lv, 1), "foot_r": P.foot(k, lv, -1),
    }
    for bone, objs in world_parts.items():
        _assign(objs, bone, arm, prefix)
    for s, side in ((1, "l"), (-1, "r")):
        for bone, make in (("upperarm", P.upperarm), ("lowerarm", P.lowerarm), ("hand", P.fist), ("thigh", P.thigh), ("calf", P.calf)):
            _assign(_in_frame(make(k, lv, s), f"{bone}_{side}"), f"{bone}_{side}", arm, prefix)
    return arm


# ----------------------------------------------------------------------------------------------------------- posing


def _two_bone(root: Vector, target: Vector, a: float, b: float, pole: Vector) -> Tuple[Vector, Vector]:
    d = target - root
    dist = min(d.length, (a + b) * 0.999)
    d.normalize()
    target = root + d * dist
    cos_a = (a * a + dist * dist - b * b) / (2 * a * dist)
    ang = math.acos(max(-1.0, min(1.0, cos_a)))
    n = pole - d * pole.dot(d)
    n.normalize()
    mid = root + (d * math.cos(ang) + n * math.sin(ang)) * a
    return mid, target


def _chain_frames(p0: Vector, p1: Vector, p2: Vector, prev_y: Vector):
    """Frames for a two-bone chain; the hinge axis keeps the sign of the rest lateral axis prev_y."""
    z1 = (p1 - p0).normalized()
    z2 = (p2 - p1).normalized()
    y = z1.cross(z2)
    if y.length < 1e-3:
        y = prev_y.copy()
    y.normalize()
    if y.dot(prev_y) < 0:
        y = -y
    f1 = Matrix((y.cross(z1), y, z1)).transposed().to_4x4()
    f1.translation = p0
    f2 = Matrix((y.cross(z2), y, z2)).transposed().to_4x4()
    f2.translation = p1
    return f1, f2, y


def _set(arm, bone, deform: Matrix):
    pb = arm.pose.bones[bone]
    pb.matrix = deform @ arm.data.bones[bone].matrix_local
    bpy.context.view_layer.update()


def pose(arm, lead_hand=(0.30, 0.10, 1.50), rear_hand=(0.22, -0.09, 1.49), crouch=0.06, yaw=-22.0, lean=8.0,
         twist=-8.0, nod=10.0, lateral=0.0, lead_foot=(0.24, 0.17), rear_foot=(-0.22, -0.15), foot_yaw=(10.0, 35.0),
         elbow_out=0.25, lead_extended=False):
    """Orthodox boxing stance in armature space (+X forward). Hands are wrist targets."""
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()

    hip = V((0, 0, 0.97))
    t_pelvis = (Matrix.Translation((0, lateral * 0.08, -crouch)) @ Matrix.Translation(hip) @
                Matrix.Rotation(math.radians(yaw), 4, "Z") @ Matrix.Rotation(math.radians(-lateral * 6), 4, "X") @
                Matrix.Translation(-hip))
    waist = V((0, 0, 1.08))
    t_chest = (t_pelvis @ Matrix.Translation(waist) @ Matrix.Rotation(math.radians(twist), 4, "Z") @
               Matrix.Rotation(math.radians(lean), 4, "Y") @ Matrix.Rotation(math.radians(-lateral * 14), 4, "X") @
               Matrix.Translation(-waist))
    neck = V((0, 0, 1.62))
    t_head = (t_chest @ Matrix.Translation(neck) @ Matrix.Rotation(math.radians(-twist - yaw * 0.6), 4, "Z") @
              Matrix.Rotation(math.radians(nod), 4, "Y") @ Matrix.Translation(-neck))

    _set(arm, "pelvis", t_pelvis)
    _set(arm, "spine_01", t_pelvis @ Matrix.Translation(waist) @ Matrix.Rotation(math.radians(twist * 0.5), 4, "Z") @
         Matrix.Rotation(math.radians(lean * 0.5), 4, "Y") @ Matrix.Translation(-waist))
    for b in ("spine_02", "spine_03", "clavicle_l", "clavicle_r", "neck_01"):
        _set(arm, b, t_chest)
    _set(arm, "head", t_head)

    # arms (analytic two-bone IK; elbows down and slightly out)
    for side, s, target in (("l", 1, lead_hand), ("r", -1, rear_hand)):
        sh = t_chest @ V(BONES[f"upperarm_{side}"][0])
        a = (V(BONES[f"upperarm_{side}"][1]) - V(BONES[f"upperarm_{side}"][0])).length
        b = (V(BONES[f"lowerarm_{side}"][1]) - V(BONES[f"lowerarm_{side}"][0])).length
        pole = V((-0.35, s * elbow_out, -1.0))
        if lead_extended and side == "l":
            pole = V((0.0, s * 0.2, -1.0))
        elbow, wrist = _two_bone(sh, V(target), a, b, pole)
        f_up, f_lo, y = _chain_frames(sh, elbow, wrist, rest_frame(f"upperarm_{side}").col[1].to_3d())
        _set(arm, f"upperarm_{side}", f_up @ rest_frame(f"upperarm_{side}").inverted())
        _set(arm, f"lowerarm_{side}", f_lo @ rest_frame(f"lowerarm_{side}").inverted())
        # fist: continue forearm direction, rolled so the back of the glove faces up-out
        f_hand = f_lo.copy()
        f_hand.translation = wrist
        rest_h = rest_frame(f"hand_{side}")
        _set(arm, f"hand_{side}", f_hand @ rest_h.inverted())
        _set(arm, f"fist_tip_{side}", f_hand @ rest_h.inverted())

    # legs
    for side, s, (fx, fy), fyaw in (("l", 1, lead_foot, foot_yaw[0]), ("r", -1, rear_foot, foot_yaw[1])):
        hp = t_pelvis @ V(BONES[f"thigh_{side}"][0])
        ankle = V((fx, fy, 0.10))
        a = (V(BONES[f"thigh_{side}"][1]) - V(BONES[f"thigh_{side}"][0])).length
        b = (V(BONES[f"calf_{side}"][1]) - V(BONES[f"calf_{side}"][0])).length
        fdir = Matrix.Rotation(math.radians(-s * fyaw), 3, "Z") @ V((1, 0, 0))
        knee, ankle = _two_bone(hp, ankle, a, b, fdir + V((0, 0, 0.0)))
        f_th, f_ca, _ = _chain_frames(hp, knee, ankle, rest_frame(f"thigh_{side}").col[1].to_3d())
        # keep the knee axis lateral: rebuild x from the foot direction
        _set(arm, f"thigh_{side}", f_th @ rest_frame(f"thigh_{side}").inverted())
        _set(arm, f"calf_{side}", f_ca @ rest_frame(f"calf_{side}").inverted())
        toe = ankle + fdir * 0.17 + V((0, 0, -0.07))
        f_foot = R.frame_matrix(ankle, toe, fdir)
        _set(arm, f"foot_{side}", f_foot @ rest_frame(f"foot_{side}").inverted())


STANCES = {
    "guard": dict(),
    "jab": dict(lead_hand=(0.95, 0.05, 1.56), rear_hand=(0.22, -0.08, 1.50), yaw=-32.0, twist=-14.0, lean=12.0,
                crouch=0.07, lead_extended=True),
    "slip": dict(lead_hand=(0.26, 0.16, 1.40), rear_hand=(0.18, -0.02, 1.38), lateral=1.0, crouch=0.10, lean=14.0,
                 nod=16.0),
    "block": dict(lead_hand=(0.20, 0.08, 1.66), rear_hand=(0.19, -0.08, 1.66), crouch=0.08, lean=12.0, nod=18.0,
                  elbow_out=0.05),
}
