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


FORGE = Livery("Forge", (0.56, 0.57, 0.58), (0.015, 0.09, 0.42), (0.085, 0.09, 0.10), (0.006, 0.03, 0.24),
               (0.25, 0.6, 1.0), "07", 0.45)
EMBER = Livery("Ember", (0.045, 0.047, 0.052), (0.55, 0.035, 0.012), (0.16, 0.16, 0.17), (0.3, 0.012, 0.008),
               (1.0, 0.28, 0.05), "13", 0.6)

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
        self.shell = R.mat_painted(f"{p}_Shell", lv.shell, wear=lv.wear)
        self.accent = R.mat_painted(f"{p}_Accent", lv.accent, wear=lv.wear * 0.8, rough=0.3)
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


# ------------------------------------------------------------------------------------------------------------- parts
# Torso/head/pelvis/feet are modelled in rest-pose world space; limbs in their bone frame (z along the bone, x forward;
# outward side of a limb is -s*y, s = +1 left / -1 right).

D = math.radians


def _head(k: Kit, lv: Livery):
    """Armoured combat head: a helmet dome over the back and top, a separate face mask in front (deep-set dark visor
    under a brow ridge, faceted jaw with vents), cheek guards bridging dome and mask, short crest, flush slit sensors.
    Reads like a fighter's helmet on an electric humanoid; no round cartoon eyes."""
    z = 1.81
    p = [R.blob("skull_core", (0.165, 0.142, 0.19), (-0.012, 0, z - 0.005), mat=k.frame, cuboid=0.4),
         R.blob("dome", (0.19, 0.166, 0.14), (-0.034, 0, z + 0.042), mat=k.shell, cuboid=0.62),
         R.curved_plate("visor", 0.088, 112, 0.07, 0.012, (-0.02, 0, z + 0.004), mat=k.glass, lean=0.016,
                        bulge=0.003, bevel=0.004),
         R.curved_plate("visor_line", 0.0915, 64, 0.004, 0.002, (-0.02, 0, z + 0.012), mat=k.led, lean=0.004,
                        bevel=0.0005),
         R.curved_plate("brow", 0.095, 104, 0.026, 0.012, (-0.02, 0, z + 0.05), mat=k.shell, lean=-0.003,
                        taper=1.03, bevel=0.006, screws=k.bolt),
         R.curved_plate("jaw", 0.086, 106, 0.056, 0.016, (-0.02, 0, z - 0.058), mat=k.frame, lean=0.026, taper=0.74,
                        bevel=0.005),
         R.fins("jaw_vent", 4, (0.004, 0.05, 0.006), 0.011, 2, (0.06, 0, z - 0.062), mat=k.plastic),
         R.box("crest", (0.13, 0.018, 0.026), (-0.05, 0, z + 0.122), mat=k.accent, bevel=0.006, taper=(0.7, 0.6)),
         R.fins("rear_vent", 4, (0.006, 0.08, 0.01), 0.018, 2, (-0.13, 0, z + 0.02), mat=k.plastic)]
    for s in (-1, 1):
        p.append(R.curved_plate(f"cheek{s}", 0.094, 44, 0.115, 0.016, (-0.02, 0, z - 0.012), (0, 0, s * D(58)),
                                k.accent, bulge=0.006, taper=0.72, lean=0.008, bevel=0.005, screws=k.bolt))
        p.append(R.box(f"slit{s}", (0.05, 0.006, 0.01), (-0.05, s * 0.083, z + 0.03), mat=k.plastic, bevel=0.002))
        p.append(R.box(f"slit_led{s}", (0.03, 0.002, 0.003), (-0.05, s * 0.0858, z + 0.03), mat=k.led, bevel=0.0006))
    return p


def _neck(k: Kit):
    p = [R.cylinder("neck_core", 0.04, 0.13, (0, 0, 1.64), mat=k.alu, verts=48),
         R.actuator("neck_act", 0.046, 0.09, k.frame, k.alu, k.bolt, (0, 0, 1.665), (D(90), 0, 0), 8)]
    for i in range(3):
        y = -0.03 + i * 0.03
        p.append(R.cable(f"neck_cable{i}", [(-0.05, y, 1.58), (-0.062, y, 1.64), (-0.045, y, 1.71)], 0.0065,
                         k.cablemat))
    return p


def _chest(k: Kit, lv: Livery):
    p = [R.soft_box("core", (0.22, 0.30, 0.30), (-0.01, 0, 1.42), mat=k.frame, roundness=0.25),
         R.fins("rib_l", 6, (0.12, 0.012, 0.01), 0.03, 2, (0.0, 0.15, 1.40), mat=k.alu),
         R.fins("rib_r", 6, (0.12, 0.012, 0.01), 0.03, 2, (0.0, -0.15, 1.40), mat=k.alu),
         R.curved_plate("collar", 0.165, 130, 0.045, 0.02, (0, 0, 1.565), mat=k.accent, bulge=0.004, lean=0.02),
         R.box("sternum", (0.03, 0.035, 0.17), (0.152, 0, 1.45), mat=k.frame, bevel=0.008),
         R.curved_plate("back", 0.155, 125, 0.27, 0.024, (0, 0, 1.43), (0, 0, D(180)), k.shell, bulge=0.012,
                        taper=1.08, screws=k.bolt),
         R.soft_box("battery", (0.055, 0.2, 0.17), (-0.178, 0, 1.40), mat=k.frame, roundness=0.3),
         R.fins("bat_fins", 7, (0.012, 0.16, 0.004), 0.019, 2, (-0.208, 0, 1.40), mat=k.alu),
         R.box("bat_led", (0.004, 0.12, 0.006), (-0.207, 0, 1.495), mat=k.led, bevel=0.0015),
         R.box("bat_warn", (0.003, 0.05, 0.018), (-0.2065, 0.06, 1.33), mat=k.warn, bevel=0.001)]
    pecs = {}
    for s in (-1, 1):
        pecs[s] = R.curved_plate(f"pec{s}", 0.15, 72, 0.18, 0.026, (0.0, s * 0.06, 1.465), (0, 0, s * D(14)),
                                 k.shell, bulge=0.018, taper=1.12, lean=0.008, screws=k.bolt)
        p.append(pecs[s])
        p.append(R.curved_plate(f"pec_trim{s}", 0.17, 60, 0.012, 0.008, (0.0, s * 0.06, 1.37), (0, 0, s * D(14)),
                                k.accent, bevel=0.003))
        p.append(R.curved_plate(f"lat{s}", 0.16, 48, 0.22, 0.02, (0, 0, 1.40), (0, 0, s * D(90)), k.frame,
                                bulge=0.01, taper=1.15))
    for s, body, size in ((-1, lv.number, 0.06), (1, "IRON ECHO", 0.016)):
        ang = s * D(14)
        n = (math.cos(ang), math.sin(ang), 0.0)
        p.append(R.text_mesh(f"pec_txt{s}", body, size, k.decal, (0.19 * n[0], s * 0.06 + 0.19 * n[1], 1.475),
                             R.orient(n, (0, 0, 1)), extrude=0.0008, wrap=pecs[s]))
    back = [o for o in p if o.name.startswith("back")][0]
    p.append(R.text_mesh("back_name", lv.name.upper(), 0.03, k.decal, (-0.175, 0, 1.535), R.orient((-1, 0, 0), (0, 0, 1)),
                         extrude=0.0008, wrap=back))
    p.append(R.text_mesh("bat_txt", "HV 400V", 0.011, k.warn, (-0.2065, -0.04, 1.33), (D(90), 0, -D(90)),
                         extrude=0.0005))
    return p


def _abdomen(k: Kit):
    p = [R.actuator("waist_act", 0.08, 0.07, k.frame, k.alu, k.bolt, (-0.01, 0, 1.2), (0, 0, 0), 12),
         R.cylinder("spine_col", 0.045, 0.22, (-0.04, 0, 1.18), mat=k.alu)]
    for i in range(6):
        p.append(R.tube(f"bellow{i}", 0.112 - 0.006 * (i % 2), 0.016, 0.02, (0.0, 0, 1.10 + i * 0.023), mat=k.rubber,
                        verts=64))
    for i, z in enumerate((1.16, 1.222, 1.284)):
        p.append(R.curved_plate(f"abs{i}", 0.118 + 0.006 * i, 86, 0.054, 0.018, (0.0, 0, z), mat=k.shell,
                                bulge=0.006, taper=1.04))
    for s in (-1, 1):
        p.append(R.box(f"obl{s}", (0.05, 0.03, 0.18), (-0.06, s * 0.125, 1.18), mat=k.alu, bevel=0.006))
        p.append(R.cable(f"abd_cable{s}", [(-0.11, s * 0.06, 1.08), (-0.14, s * 0.07, 1.18), (-0.11, s * 0.07, 1.28)],
                         0.008, k.cablemat))
    return p


def _pelvis(k: Kit):
    p = [R.blob("hip_shell", (0.23, 0.31, 0.14), (-0.01, 0, 1.0), mat=k.shell, cuboid=0.45),
         R.tube("belt", 0.142, 0.016, 0.034, (-0.005, 0, 1.075), mat=k.frame, verts=64, bevel=0.004),
         R.box("belt_led", (0.004, 0.09, 0.006), (0.137, 0, 1.075), mat=k.led, bevel=0.0015),
         R.curved_plate("groin", 0.11, 60, 0.11, 0.02, (0.0, 0, 0.93), mat=k.accent, taper=0.65, lean=-0.01)]
    p[1].scale = (1.0, 1.12, 1.0)
    for s in (-1, 1):
        p.append(R.actuator(f"hip_act{s}", 0.078, 0.09, k.frame, k.alu, k.bolt, (0, s * 0.17, 0.955),
                            (D(90), 0, 0), 12))
    return p


def _clavicle(k: Kit, s):
    return [R.blob(f"trap{s}", (0.15, 0.13, 0.075), (-0.015, s * 0.14, 1.565), mat=k.shell, cuboid=0.35)]


def _upperarm(k: Kit, s):
    L = 0.359
    out = -s * D(90)
    return [R.actuator("shoulder", 0.074, 0.11, k.frame, k.alu, k.bolt, (0, 0, 0.0), (D(90), 0, 0), 12),
            R.curved_plate("deltoid", 0.084, 175, 0.17, 0.026, (0, 0, 0.035), (0, 0, out * 0.66), k.accent,
                           bulge=0.022, taper=0.7, bevel=0.006),
            R.box("humerus", (0.055, 0.05, 0.26), (-0.005, 0, 0.19), mat=k.alu, bevel=0.008),
            R.curved_plate("bicep", 0.06, 190, 0.22, 0.022, (0, 0, 0.205), mat=k.shell, bulge=0.014, taper=0.85,
                           screws=k.bolt),
            R.curved_plate("tricep", 0.058, 130, 0.2, 0.018, (0, 0, 0.205), (0, 0, D(180)), k.frame, bulge=0.01),
            R.actuator("elbow", 0.052, 0.10, k.frame, k.alu, k.bolt, (0, 0, L), (D(90), 0, 0), 10),
            R.cable("ua_cable", [(-0.06, -s * 0.03, 0.06), (-0.07, -s * 0.03, 0.17), (-0.055, -s * 0.03, 0.32)],
                    0.007, k.cablemat)]


def _lowerarm(k: Kit, s):
    L = 0.337
    return [R.curved_plate("forearm", 0.056, 215, 0.26, 0.02, (0, 0, 0.155), mat=k.carbon, bulge=0.01, taper=0.8),
            R.box("radius", (0.03, 0.04, 0.27), (-0.035, 0, 0.165), mat=k.alu, bevel=0.006),
            R.cylinder("piston_body", 0.015, 0.13, (-0.06, 0, 0.09), mat=k.frame, verts=32),
            R.cylinder("piston_rod", 0.008, 0.13, (-0.06, 0, 0.21), mat=k.chrome, verts=32, bevel=0.001),
            R.tube("wrist_ring", 0.047, 0.012, 0.03, (0, 0, L - 0.02), mat=k.frame, verts=64),
            R.curved_plate("fa_led", 0.0595, 14, 0.07, 0.003, (0, 0, 0.14), (0, 0, -s * D(60)), k.led, bevel=0.001)]


def _glove(k: Kit, s):
    """16 oz boxing glove as one continuous padded leather form (metaballs: fist, knuckle bulge, curled-finger palm,
    thumb tucked along the side, tapering cuff), with piping seams that follow the surface, a velcro strap and a
    logo. Hand frame: z = punch direction, +x = back of the hand, inner (thumb) side = +s*y. ~33 cm long."""
    g = k.glove
    D_ = D
    # elements in normalised units with generous overlap so they fuse into one surface; fit= sets real size
    body = R.metaball_mesh("glove_body", [
        ((0.0, 0.0, 0.55), 1.0, (0.92, 1.0, 1.15), (0, 0, 0)),            # fist mass
        ((0.12, 0.0, 0.95), 0.85, (0.95, 1.12, 0.72), (0, 0, 0)),         # knuckle bulge (striking face)
        ((-0.28, 0.0, 0.72), 0.72, (0.8, 1.0, 1.05), (0, 0, 0)),          # curled fingers / palm
        ((-0.2, s * 0.58, 0.32), 0.42, (0.8, 0.75, 1.7), (D_(-6), s * D_(12), 0)),  # thumb, tucked to the side
        ((0.0, 0.0, -0.3), 0.86, (0.95, 0.95, 1.15), (0, 0, 0)),          # cuff
        ((0.0, 0.0, -0.95), 0.76, (0.9, 0.9, 1.0), (0, 0, 0)),            # wrist opening
    ], mat=g, resolution=0.035, threshold=0.6, fit=(0.13, 0.14, 0.335))
    body.location = (0.0, 0.0, 0.085)  # fist front ends ~0.25 m past the wrist, cuff reaches back over the forearm
    bpy.context.view_layer.update()
    parts = [body]
    for nm, co, no in (("glove_seam_side", (0.0, 0.0, 0.0), (1.0, 0.0, 0.0)),        # top/palm panel seam
                       ("glove_seam_cuff", (0.0, 0.0, -0.035), (0.0, 0.0, 1.0))):   # cuff/fist seam
        seam = R.surface_seam(nm, body, co, no, 0.0024, g, offset=0.0012)
        if seam is not None:
            parts.append(seam)
    strap = R.curved_plate("glove_strap", 0.05, 250, 0.048, 0.005, (0, 0, 0.012), (0, 0, D_(180)), g, bevel=0.002,
                           segs=(40, 6), wrap=body)
    parts.append(strap)
    for i, zz in enumerate((0.035, -0.011)):
        parts.append(R.curved_plate(f"glove_strap_edge{i}", 0.05, 250, 0.003, 0.0018, (0, 0, zz), (0, 0, D_(180)),
                                    k.tape, bevel=0.0006, segs=(40, 2), wrap=body))
    parts.append(R.text_mesh("glove_logo", "IE", 0.034, k.tape, (0.075, 0, 0.165), R.orient((1, 0, 0), (0, 0, 1)),
                             extrude=0.0008, wrap=body))
    parts.append(R.text_mesh("glove_oz", "16 OZ", 0.012, k.tape, (0.062, 0, 0.01), R.orient((1, 0, 0), (0, 0, 1)),
                             extrude=0.0006, wrap=strap))
    return parts


def _thigh(k: Kit, s):
    L = 0.43
    out = -s * D(90)
    side = R.curved_plate("quad_side", 0.106, 60, 0.24, 0.016, (0, 0, 0.19), (0, 0, out), k.accent, bulge=0.018,
                          taper=0.8)
    return [R.curved_plate("quad", 0.092, 205, 0.32, 0.026, (0, 0, 0.2), mat=k.shell, bulge=0.026, taper=0.78,
                           screws=k.bolt),
            side,
            R.text_mesh("serial", "IE-1 SN0007", 0.014, k.decal, (0.0, -s * 0.125, 0.15),
                        R.orient((0, -s, 0), (0, 0, -1)), extrude=0.0005, wrap=side),
            R.curved_plate("hamstring", 0.086, 140, 0.29, 0.022, (0, 0, 0.2), (0, 0, D(180)), k.frame, bulge=0.016,
                           taper=0.8),
            R.box("femur", (0.06, 0.07, 0.36), (-0.02, 0, 0.21), mat=k.alu, bevel=0.01),
            R.actuator("knee", 0.066, 0.12, k.frame, k.alu, k.bolt, (0, 0, L), (D(90), 0, 0), 12),
            R.cable("th_cable", [(-0.09, -s * 0.05, 0.04), (-0.11, -s * 0.06, 0.2), (-0.09, -s * 0.05, 0.37)], 0.008,
                    k.cablemat)]


def _calf(k: Kit, s):
    L = 0.42
    return [R.curved_plate("shin", 0.062, 150, 0.30, 0.02, (0, 0, 0.2), mat=k.carbon, bulge=0.008, taper=0.72),
            R.blob("knee_cap", (0.06, 0.11, 0.09), (0.07, 0, 0.03), mat=k.accent, cuboid=0.35),
            R.curved_plate("calf_shell", 0.07, 175, 0.25, 0.022, (0, 0, 0.15), (0, 0, D(180)), k.shell,
                           bulge=0.026, taper=0.62, screws=k.bolt),
            R.box("tibia", (0.06, 0.06, 0.34), (0.0, 0, 0.2), mat=k.alu, bevel=0.01),
            R.cylinder("calf_piston", 0.017, 0.15, (-0.035, s * 0.06, 0.24), mat=k.frame, verts=32),
            R.cylinder("calf_rod", 0.009, 0.12, (-0.035, s * 0.06, 0.35), mat=k.chrome, verts=32, bevel=0.001),
            R.actuator("ankle", 0.048, 0.10, k.frame, k.alu, k.bolt, (0, 0, L), (D(90), 0, 0), 8)]


def _foot(k: Kit, s):
    """Robot foot: thick rubber sole with tread, machined ankle block, shell over the toes."""
    y = s * 0.14
    p = [R.blob("sole", (0.31, 0.125, 0.05), (0.05, y, 0.025), mat=k.rubber, cuboid=0.55),
         R.blob("midsole", (0.29, 0.115, 0.035), (0.05, y, 0.06), mat=k.frame, cuboid=0.5),
         R.blob("toe_cap", (0.13, 0.115, 0.07), (0.13, y, 0.075), mat=k.shell, cuboid=0.45),
         R.blob("heel", (0.09, 0.105, 0.08), (-0.06, y, 0.08), mat=k.accent, cuboid=0.45),
         R.box("ankle_block", (0.08, 0.07, 0.07), (0.0, y, 0.105), mat=k.alu, bevel=0.01)]
    for i in range(5):
        p.append(R.box(f"tread{i}", (0.012, 0.11, 0.008), (-0.07 + i * 0.055, y, 0.002), mat=k.rubber, bevel=0.002))
    return p


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
    prefix = prefix or f"IE1_{lv.name}"
    col = R.collection(prefix)
    R.set_collection(col)
    k = Kit(lv)
    arm = build_armature(prefix)
    world_parts = {
        "head": _head(k, lv), "neck_01": _neck(k), "spine_03": _chest(k, lv), "spine_02": [], "spine_01": _abdomen(k),
        "pelvis": _pelvis(k), "clavicle_l": _clavicle(k, 1), "clavicle_r": _clavicle(k, -1),
        "foot_l": _foot(k, 1), "foot_r": _foot(k, -1),
    }
    for bone, objs in world_parts.items():
        if objs:
            _assign(objs, bone, arm, prefix)
    for s, side in ((1, "l"), (-1, "r")):
        _assign(_in_frame(_upperarm(k, s), f"upperarm_{side}"), f"upperarm_{side}", arm, prefix)
        _assign(_in_frame(_lowerarm(k, s), f"lowerarm_{side}"), f"lowerarm_{side}", arm, prefix)
        _assign(_in_frame(_glove(k, s), f"hand_{side}"), f"hand_{side}", arm, prefix)
        _assign(_in_frame(_thigh(k, s), f"thigh_{side}"), f"thigh_{side}", arm, prefix)
        _assign(_in_frame(_calf(k, s), f"calf_{side}"), f"calf_{side}", arm, prefix)
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
