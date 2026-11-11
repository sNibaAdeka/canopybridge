"""IE-2 fighting robots, designed from scratch (2026-11): an athletic humanoid built like a prize-fighter. A dark inner frame
with exposed hydraulics carries layered armour plates with gaps between them; the shoulders are broad, the waist is a narrow
mechanical spine, the forearms and the fists are heavy. No boxing gloves: armoured mechanical fists with knuckle caps.

Two original designs on the same contract skeleton (robot.py BONES; nothing about the bones changes):
  "sparring"  FORGE - a rounded headguard helmet, two round eyes behind a grille, a round chest core, smooth pauldrons.
  "champion"  EMBER - an angular crested helm with a V visor, finned pauldrons, vented angular chest, bladed shins and forearms.

Conventions as in robot.py: torso, head, pelvis, clavicles and feet are modelled in rest-pose world space (robot faces +X,
left = +Y); limbs in their bone frame (z along the bone, x forward, the limb's outer side is -s*y, s = +1 left / -1 right);
the hand frame has z = punch direction, +x = back of the hand, thumb side = +s*y.
"""

from __future__ import annotations

import math

import bpy
from mathutils import Vector

import rlib as R

D = math.radians
V = Vector


# ------------------------------------------------------------------------------------------------------------ primitives
def _sup(c: float, p: float) -> float:
    return math.copysign(abs(c) ** (2.0 / p), c)


def _catmull(a, b, c, d, t):
    return 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t)


def hull(name, secs, mat, p=2.8, n=32, arc=None, thick=0.0, bevel=0.004, sub=3, caps=True):
    """Lofted shell: superellipse cross-sections stacked along local Z.

    secs: [(z, cx, cy, rx_front, rx_back, ry), ...] with z increasing; p = superellipse power (2 round .. 5 boxy);
    arc=(a0, a1) degrees (0 = +X, 90 = +Y) makes an open armour plate over that angle, solidified inward by `thick`;
    sub = smooth in-between rings per section (Catmull-Rom), 1 = straight facets."""
    if R.game():
        n = max(12, int(n * 0.6))
        sub = max(1, sub - 1)
    rows = []
    m = len(secs)
    for i in range(m - 1):
        a, b, c, d = secs[max(i - 1, 0)], secs[i], secs[i + 1], secs[min(i + 2, m - 1)]
        for k in range(sub):
            t = k / sub
            rows.append(tuple(_catmull(a[j], b[j], c[j], d[j], t) if j else b[0] + (c[0] - b[0]) * t for j in range(6)))
    rows.append(tuple(secs[-1][:6]))
    closed = arc is None
    if closed:
        angs = [2 * math.pi * i / n for i in range(n)]
    else:
        a0, a1 = D(arc[0]), D(arc[1])
        cnt = max(4, int(round(n * (a1 - a0) / (2 * math.pi))))
        angs = [a0 + (a1 - a0) * i / cnt for i in range(cnt + 1)]
    w = len(angs)
    v, f = [], []
    for (z, cx, cy, rxf, rxb, ry) in rows:
        for a in angs:
            c, s = math.cos(a), math.sin(a)
            v.append((cx + (rxf if c >= 0 else rxb) * _sup(c, p), cy + ry * _sup(s, p), z))
    for j in range(len(rows) - 1):
        for i in range(w if closed else w - 1):
            i2 = (i + 1) % w
            f.append((j * w + i, j * w + i2, (j + 1) * w + i2, (j + 1) * w + i))
    if closed and caps:
        f.append(tuple(reversed(range(w))))
        f.append(tuple((len(rows) - 1) * w + i for i in range(w)))
    obj = R.mesh_object(name, v, f, mat, 0.0, smooth=True)
    for mod in list(obj.modifiers):
        obj.modifiers.remove(mod)
    if thick > 0:
        sol = obj.modifiers.new("Solidify", "SOLIDIFY")
        sol.thickness = thick
        sol.offset = -1
        sol.use_even_offset = True
    if bevel > 0:
        b = obj.modifiers.new("Bevel", "BEVEL")
        b.width = min(bevel, thick * 0.45) if thick > 0 else bevel
        b.segments = 1 if R.game() else 3
        b.limit_method = "ANGLE"
        b.angle_limit = D(40)
        b.harden_normals = True
    obj.modifiers.new("WeightedNormal", "WEIGHTED_NORMAL").keep_sharp = True
    return obj


def _along(obj, p0, p1):
    """Place an object modelled along local Z (centred) on the segment p0 -> p1."""
    p0, p1 = V(p0), V(p1)
    obj.location = (p0 + p1) * 0.5
    obj.rotation_euler = V((0, 0, 1)).rotation_difference((p1 - p0).normalized()).to_euler()
    return obj


def piston(name, p0, p1, r, k, body=0.56):
    """Hydraulic cylinder between two points: dark barrel, polished rod, a clevis at each end."""
    p0, p1 = V(p0), V(p1)
    mid = p0 + (p1 - p0) * body
    length = (p1 - p0).length
    return [
        _along(R.cylinder(f"{name}_barrel", r, length * body, mat=k.frame, verts=24, bevel=r * 0.18), p0, mid),
        _along(R.cylinder(f"{name}_gland", r * 1.12, r * 0.9, mat=k.alu, verts=24, bevel=r * 0.15), mid - (p1 - p0).normalized() * r * 0.45,
               mid + (p1 - p0).normalized() * r * 0.45),
        _along(R.cylinder(f"{name}_rod", r * 0.5, length * (1 - body), mat=k.chrome, verts=16, bevel=0.0), mid, p1),
        R.capsule(f"{name}_eye0", r * 1.15, r * 2.3, tuple(p0), mat=k.steel, verts=16),
        R.capsule(f"{name}_eye1", r * 0.95, r * 1.9, tuple(p1), mat=k.steel, verts=16),
    ]


def ball(name, r, loc, mat):
    return R.capsule(name, r, 2 * r, loc, mat=mat, verts=32)


def led_bar(name, size, loc, rot, k):
    return R.box(name, size, loc, rot, mat=k.led, bevel=min(size) * 0.25, segments=1)


def champion(lv) -> bool:
    return getattr(lv, "style", "sparring") == "champion"


# ------------------------------------------------------------------------------------------------------------------ head
def head(k, lv):
    z = 1.83  # eye line
    p = [hull("skull", [(1.700, -0.010, 0, 0.066, 0.072, 0.066), (1.745, -0.010, 0, 0.088, 0.092, 0.084),
                        (1.810, -0.012, 0, 0.094, 0.100, 0.090), (1.880, -0.016, 0, 0.090, 0.098, 0.086),
                        (1.930, -0.020, 0, 0.062, 0.074, 0.060)], k.plastic, p=2.6, n=28)]
    if champion(lv):
        # tall angular helm open at the face, a swept crest, a V of light for the eyes, bladed cheeks
        p += [hull("helm", [(1.735, -0.012, 0, 0.100, 0.108, 0.098), (1.800, -0.014, 0, 0.108, 0.116, 0.104),
                            (1.880, -0.020, 0, 0.104, 0.114, 0.100), (1.945, -0.028, 0, 0.076, 0.094, 0.072),
                            (1.975, -0.034, 0, 0.034, 0.052, 0.030)], k.shell, p=3.6, n=36, arc=(48, 312), thick=0.014, sub=2),
              R.curved_plate("brow", 0.104, 112, 0.050, 0.014, (-0.014, 0, 1.892), mat=k.shell, lean=0.022, taper=0.8, bevel=0.004),
              R.curved_plate("mask", 0.097, 96, 0.090, 0.012, (-0.012, 0, 1.775), mat=k.frame, lean=-0.004, taper=1.12, bevel=0.004),
              R.box("nose", (0.020, 0.016, 0.105), (0.090, 0, 1.800), (0, D(-6), 0), mat=k.accent, bevel=0.004, taper=(0.6, 0.5)),
              R.box("chin", (0.050, 0.070, 0.040), (0.068, 0, 1.722), (0, D(18), 0), mat=k.shell, bevel=0.008, taper=(0.75, 0.55))]
        for s in (1, -1):
            p += [led_bar(f"eye{s}", (0.008, 0.058, 0.011), (0.0925, s * 0.036, z + 0.008), (D(s * 16), 0, D(s * 14)), k),
                  R.box(f"cheek{s}", (0.085, 0.012, 0.060), (0.045, s * 0.094, 1.770), (D(s * -10), D(-18), D(s * 8)), mat=k.accent,
                        bevel=0.004, taper=(0.55, 1.0)),
                  R.cylinder(f"ear{s}", 0.026, 0.022, (-0.016, s * 0.112, 1.820), (D(90), 0, 0), mat=k.trim, verts=6, bevel=0.003)]
        for i, (dy, h) in enumerate(((0.0, 0.085), (0.017, 0.062), (-0.017, 0.062))):
            p.append(R.box(f"crest{i}", (0.190, 0.007, h), (-0.045, dy, 1.948 + h * 0.36), (0, D(-13), 0),
                           mat=k.accent if i == 0 else k.trim, bevel=0.002, taper=(0.42, 1.0)))
    else:
        # rounded headguard helmet, a black face with two round eyes over a grille (a sparring bot's honest face)
        p += [hull("helm", [(1.740, -0.012, 0, 0.098, 0.106, 0.096), (1.810, -0.014, 0, 0.106, 0.114, 0.103),
                            (1.890, -0.018, 0, 0.100, 0.110, 0.097), (1.940, -0.024, 0, 0.068, 0.084, 0.066),
                            (1.957, -0.026, 0, 0.030, 0.044, 0.028)], k.shell, p=2.5, n=36, arc=(54, 306), thick=0.014),
              R.curved_plate("brow", 0.103, 118, 0.044, 0.014, (-0.014, 0, 1.893), mat=k.shell, lean=0.020, taper=0.85, bevel=0.005),
              R.curved_plate("jaw", 0.099, 134, 0.046, 0.013, (-0.012, 0, 1.728), mat=k.shell, lean=-0.010, taper=0.9, bevel=0.005),
              R.box("chin_bar", (0.022, 0.060, 0.030), (0.092, 0, 1.722), mat=k.accent, bevel=0.007),
              R.box("crest", (0.150, 0.026, 0.012), (-0.030, 0, 1.957), (0, D(-8), 0), mat=k.warn, bevel=0.004)]
        for i in range(4):  # mouth grille
            p.append(R.curved_plate(f"grille{i}", 0.0955, 78, 0.0055, 0.006, (-0.012, 0, 1.762 + i * 0.012), mat=k.alu, bevel=0.0015))
        for s in (1, -1):
            p += [R.cylinder(f"eye{s}", 0.0185, 0.010, (0.0905, s * 0.036, z + 0.004), (0, D(90), D(s * 20)), mat=k.led, verts=24, bevel=0.002),
                  R.tube(f"eye_ring{s}", 0.0245, 0.006, 0.016, (0.0895, s * 0.036, z + 0.004), (0, D(90), D(s * 20)), mat=k.alu, verts=24),
                  R.actuator(f"ear{s}", 0.033, 0.030, k.frame, k.alu, k.bolt, (-0.014, s * 0.108, 1.825), (D(90), 0, 0), 6)]
    return p


def neck(k, lv):
    p = [R.cylinder("neck_core", 0.040, 0.150, (-0.012, 0, 1.650), mat=k.frame, verts=24)]
    for i in range(4):
        p.append(R.tube(f"neck_ring{i}", 0.049 - i * 0.002, 0.010, 0.014, (-0.012, 0, 1.600 + i * 0.030), mat=k.steel, verts=32, bevel=0.002))
    for s in (1, -1):
        p += piston(f"neck_p{s}", (0.028, s * 0.050, 1.585), (0.022, s * 0.046, 1.712), 0.0075, k)
    return p


# ----------------------------------------------------------------------------------------------------------------- torso
def chest(k, lv):
    ch = champion(lv)
    pw = 4.6 if ch else 3.0
    rib = [(1.300, 0.000, 0, 0.082, 0.078, 0.112), (1.360, 0.004, 0, 0.102, 0.090, 0.150), (1.450, 0.008, 0, 0.122, 0.104, 0.186),
           (1.530, 0.008, 0, 0.128, 0.110, 0.204), (1.585, 0.000, 0, 0.104, 0.100, 0.188), (1.618, -0.006, 0, 0.066, 0.076, 0.128)]
    p = [hull("ribcage", rib, k.frame, p=3.0, n=40)]
    pec = [(1.388, 0.010, 0, 0.124, 0.10, 0.170), (1.450, 0.014, 0, 0.160, 0.11, 0.210), (1.535, 0.014, 0, 0.166, 0.11, 0.228),
           (1.594, 0.004, 0, 0.122, 0.10, 0.202)]
    back = [(1.350, 0.004, 0, 0.10, 0.104, 0.160), (1.450, 0.008, 0, 0.11, 0.120, 0.198), (1.535, 0.008, 0, 0.11, 0.126, 0.216),
            (1.595, 0.000, 0, 0.10, 0.112, 0.196)]
    for s in (1, -1):
        a = (5, 94) if s > 0 else (-94, -5)
        p.append(hull(f"pec{s}", pec, k.shell, p=pw, n=44, arc=a, thick=0.024, bevel=0.006, sub=2 if ch else 3))
        b = (112, 174) if s > 0 else (186, 248)
        p.append(hull(f"lat{s}", back, k.shell, p=3.2, n=44, arc=b, thick=0.020, bevel=0.005))
        # ribs showing between the chest plate and the back plate, a vent stack under each pec
        p.append(R.fins(f"ribs{s}", 4, (0.060, 0.070, 0.007), 0.017, 2, (0.062, s * 0.118, 1.347), (0, 0, D(s * 28)), k.steel))
        p += piston(f"lat_p{s}", (-0.020, s * 0.168, 1.330), (-0.010, s * 0.196, 1.520), 0.010, k)
        if ch:
            for i in range(3):  # glowing gills on the angular pecs
                p.append(led_bar(f"gill{s}{i}", (0.006, 0.052, 0.007), (0.160, s * (0.072 + i * 0.004), 1.452 + i * 0.022),
                                 (D(s * -12), 0, D(s * 24)), k))
    # sternum: the glowing core in the gap between the pecs
    if ch:
        p += [R.cylinder("core", 0.030, 0.016, (0.152, 0, 1.520), (0, D(90), 0), mat=k.led, verts=6, bevel=0.002),
              R.cylinder("core_bezel", 0.041, 0.024, (0.144, 0, 1.520), (0, D(90), 0), mat=k.trim, verts=6, bevel=0.004),
              R.box("sternum", (0.030, 0.034, 0.150), (0.140, 0, 1.420), (0, D(-10), 0), mat=k.accent, bevel=0.006, taper=(1.0, 0.5))]
    else:
        p += [R.cylinder("core", 0.034, 0.014, (0.156, 0, 1.478), (0, D(90), 0), mat=k.led, verts=32, bevel=0.002),
              R.tube("core_bezel", 0.046, 0.011, 0.030, (0.146, 0, 1.478), (0, D(90), 0), mat=k.alu, verts=40, bevel=0.003),
              R.bolt_ring("core_bolts", 0.0405, 8, 0.0045, 0.004, k.bolt, (0.162, 0, 1.478), (0, D(90), 0)),
              R.box("sternum", (0.026, 0.030, 0.070), (0.142, 0, 1.560), mat=k.accent, bevel=0.006)]
        for i in range(3):
            p.append(R.box(f"core_bar{i}", (0.006, 0.066, 0.005), (0.163, 0, 1.478), (D(i * 60), 0, 0), mat=k.alu, bevel=0.001, segments=1))
    # back: spine ridge and the power pack with exhaust stacks
    p += [R.box("spine_ridge", (0.034, 0.050, 0.270), (-0.118, 0, 1.455), mat=k.accent, bevel=0.008),
          R.soft_box("pack", (0.080, 0.230, 0.200), (-0.150, 0, 1.468), mat=k.frame, roundness=0.26)]
    plate = R.box("pack_plate", (0.012, 0.190, 0.120), (-0.194, 0, 1.500), mat=k.shell, bevel=0.006)
    p += [plate,
          R.text_mesh("number", lv.number, 0.100, k.decal, (-0.2012, 0, 1.462), R.orient((-1, 0, 0), (0, 0, 1)), extrude=0.0008),
          R.fins("pack_vents", 3, (0.012, 0.170, 0.008), 0.018, 2, (-0.192, 0, 1.398), mat=k.steel),
          R.tube("collar", 0.078, 0.016, 0.034, (-0.010, 0, 1.612), mat=k.accent, verts=40, bevel=0.004)]
    for s in (1, -1):
        p += [R.cylinder(f"stack{s}", 0.019, 0.110, (-0.168, s * 0.070, 1.585), (0, D(-14), 0), mat=k.steel, verts=20, bevel=0.003),
              R.tube(f"stack_tip{s}", 0.022, 0.005, 0.020, (-0.182, s * 0.070, 1.640), (0, D(-14), 0), mat=k.chrome, verts=20)]
    return p


def clavicle(k, lv, s):
    ch = champion(lv)
    return [R.box(f"trap{s}", (0.150, 0.120, 0.034), (-0.014, s * 0.128, 1.622), (D(s * 13), 0, 0), mat=k.shell, bevel=0.010,
                  taper=(0.82, 0.9)),
            R.box(f"trap_trim{s}", (0.160, 0.016, 0.038), (-0.014, s * 0.066, 1.634), (D(s * 13), 0, 0), mat=k.trim if ch else k.accent,
                  bevel=0.005),
            R.cylinder(f"sh_mount{s}", 0.052, 0.075, (0.0, s * 0.190, 1.570), (D(90), 0, 0), mat=k.frame, verts=28, bevel=0.005)]


def abdomen(k, lv):
    p = [R.cylinder("spine", 0.040, 0.290, (-0.022, 0, 1.190), mat=k.frame, verts=24)]
    for i in range(7):
        p.append(R.tube(f"vert{i}", 0.051, 0.012, 0.016, (-0.022, 0, 1.080 + i * 0.038), mat=k.steel, verts=32, bevel=0.002))
    for i, (r, arc, zc) in enumerate(((0.100, 124, 1.276), (0.095, 114, 1.208), (0.089, 104, 1.140))):
        p.append(R.curved_plate(f"ab{i}", r, arc, 0.060, 0.018, (-0.008, 0, zc), mat=k.shell, taper=0.93, bulge=0.006, bevel=0.005))
        p.append(R.curved_plate(f"lumbar{i}", r - 0.012, 96, 0.056, 0.014, (-0.020, 0, zc), (0, 0, D(180)), mat=k.frame, bevel=0.004))
    p.append(R.box("ab_line", (0.012, 0.014, 0.200), (0.092, 0, 1.208), mat=k.trim if champion(lv) else k.warn, bevel=0.004))
    for s in (1, -1):
        p += piston(f"oblique{s}", (0.010, s * 0.104, 1.066), (0.030, s * 0.132, 1.318), 0.0115, k)
    return p


def pelvis(k, lv):
    ch = champion(lv)
    p = [hull("hips", [(0.895, 0, 0, 0.066, 0.072, 0.096), (0.950, 0, 0, 0.094, 0.096, 0.142), (1.030, 0, 0, 0.100, 0.100, 0.150),
                       (1.078, 0, 0, 0.082, 0.084, 0.120)], k.frame, p=3.2, n=36),
         R.curved_plate("belt_f", 0.118, 150, 0.044, 0.014, (-0.010, 0, 1.058), mat=k.accent, bevel=0.004),
         R.curved_plate("belt_b", 0.118, 150, 0.044, 0.014, (0.010, 0, 1.058), (0, 0, D(180)), mat=k.accent, bevel=0.004),
         R.box("buckle", (0.022, 0.070, 0.050), (0.110, 0, 1.058), mat=k.trim if ch else k.alu, bevel=0.006),
         R.box("cod", (0.060, 0.120, 0.140), (0.084, 0, 0.962), (D(180), D(8), 0), mat=k.shell, bevel=0.010, taper=(0.55, 0.42)),
         R.curved_plate("seat", 0.112, 138, 0.120, 0.016, (0.012, 0, 0.985), (0, 0, D(180)), mat=k.shell, taper=0.9, bevel=0.005)]
    for s in (1, -1):
        p += [ball(f"hip{s}", 0.066, (0, s * 0.122, 0.950), k.frame),
              R.curved_plate(f"tasset{s}", 0.166, 62, 0.130, 0.016, (0, 0, 0.990), (0, 0, D(s * 90)), mat=k.shell, taper=0.8, bulge=0.004,
                             bevel=0.005, screws=k.bolt),
              R.curved_plate(f"tasset_trim{s}", 0.169, 56, 0.018, 0.006, (0, 0, 1.030), (0, 0, D(s * 90)), mat=k.trim if ch else k.accent,
                             bevel=0.002)]
    return p


# ------------------------------------------------------------------------------------------------------------------ arms
def upperarm(k, lv, s):
    L = 0.359
    ch = champion(lv)
    out = -s  # sign of the limb's outer side on the frame's y axis
    p = [ball("sh_ball", 0.064, (0, 0, 0), k.frame),
         R.cylinder("humerus", 0.033, 0.300, (0, 0, 0.190), mat=k.frame, verts=20),
         hull("bicep", [(0.095, 0.002, 0, 0.056, 0.048, 0.052), (0.180, 0.004, 0, 0.066, 0.054, 0.060), (0.262, 0.002, 0, 0.056, 0.048, 0.052),
                        (0.300, 0, 0, 0.046, 0.042, 0.044)], k.shell, p=3.4 if ch else 2.7, n=28),
         R.curved_plate("bicep_band", 0.0575, 360, 0.014, 0.004, (0.002, 0, 0.268), mat=k.trim if ch else k.warn, bevel=0.001),
         R.actuator("elbow", 0.046, 0.108, k.frame, k.alu, k.bolt, (0, 0, L), (D(90), 0, 0), 8)]
    p += piston("tricep", (-0.060, 0, 0.060), (-0.052, 0, 0.330), 0.011, k)
    if ch:
        # stepped angular pauldron with two fins
        p += [R.box("pauldron", (0.214, 0.200, 0.160), (0.0, out * 0.034, 0.016), (D(180), 0, 0), mat=k.shell, bevel=0.016, taper=(0.72, 0.66)),
              R.box("pauldron_step", (0.166, 0.166, 0.052), (0.0, out * 0.048, -0.070), (D(180), 0, 0), mat=k.accent, bevel=0.010,
                    taper=(0.7, 0.7)),
              R.box("pauldron_rim", (0.222, 0.208, 0.020), (0.0, out * 0.034, 0.100), mat=k.trim, bevel=0.006)]
        for i in (-1, 1):
            p.append(R.box(f"fin{i}", (0.110, 0.008, 0.075), (i * 0.038, out * 0.136, -0.024), (D(out * -24), D(90), 0), mat=k.trim, bevel=0.002,
                           taper=(0.35, 1.0)))
    else:
        p += [R.blob("pauldron", (0.222, 0.204, 0.186), (0.0, out * 0.032, 0.004), mat=k.shell, cuboid=0.42),
              R.blob("pauldron_cap", (0.150, 0.130, 0.060), (0.0, out * 0.040, -0.074), mat=k.accent, cuboid=0.5),
              R.bolt_ring("pauldron_bolts", 0.060, 6, 0.006, 0.005, k.bolt, (0, out * 0.134, 0.010), (D(out * -90), 0, 0)),
              R.box("pauldron_mark", (0.090, 0.006, 0.018), (0.0, out * 0.134, 0.058), mat=k.warn, bevel=0.002)]
    return p


def lowerarm(k, lv, s):
    L = 0.337
    ch = champion(lv)
    out = -s
    a0 = out * 90
    p = [R.cylinder("radius", 0.030, 0.300, (0, 0, 0.170), mat=k.frame, verts=20),
         hull("gauntlet", [(0.045, 0, 0, 0.048, 0.046, 0.048), (0.120, 0.002, 0, 0.076, 0.064, 0.072), (0.215, 0.002, 0, 0.072, 0.062, 0.068),
                           (0.300, 0, 0, 0.054, 0.050, 0.054)], k.shell, p=3.6 if ch else 2.9, n=30),
         hull("guard", [(0.070, 0, 0, 0.070, 0.064, 0.070), (0.125, 0.002, 0, 0.090, 0.078, 0.086), (0.215, 0.002, 0, 0.086, 0.076, 0.082),
                        (0.275, 0, 0, 0.068, 0.064, 0.068)], k.accent, p=3.4, n=40, arc=(a0 - 58, a0 + 58), thick=0.012, bevel=0.004),
         R.tube("wrist_ring", 0.053, 0.012, 0.030, (0, 0, L - 0.016), mat=k.alu, verts=32, bevel=0.003),
         R.blob("elbow_cap", (0.074, 0.092, 0.080), (-0.044, 0, 0.004), mat=k.trim if ch else k.alu, cuboid=0.5)]
    p += piston("flexor", (0.022, s * 0.052, 0.040), (0.016, s * 0.046, 0.270), 0.009, k)
    for i in range(3):  # status lights along the guard
        p.append(led_bar(f"fa_led{i}", (0.034, 0.005, 0.010), (0.004, out * 0.0875, 0.135 + i * 0.030), (0, 0, 0), k))
    if ch:  # a blade along the outside of the forearm
        p.append(R.box("blade", (0.014, 0.060, 0.210), (-0.010, out * 0.110, 0.170), (D(out * 4), 0, 0), mat=k.trim, bevel=0.003,
                       taper=(1.0, 0.25)))
    return p


def fist(k, lv, s):
    """Armoured mechanical fist, clenched: about 21 cm from the wrist to the knuckle face. The fingers are curled, so the front is
    four knuckle blocks with grooves between them, the fingertips tucked under onto the palm, the thumb locked across the side."""
    ch = champion(lv)
    cap = k.trim if ch else k.alu
    p = [R.cylinder("cuff", 0.048, 0.060, (0, 0, 0.024), mat=k.frame, verts=28, bevel=0.004),
         R.tube("cuff_ring", 0.051, 0.008, 0.016, (0, 0, 0.046), mat=k.steel, verts=28, bevel=0.002),
         R.soft_box("fist_core", (0.094, 0.126, 0.112), (0.000, 0, 0.112), mat=k.frame, roundness=0.34),
         R.soft_box("backplate", (0.026, 0.130, 0.100), (0.052, 0, 0.106), mat=k.shell, roundness=0.4),
         R.box("back_stripe", (0.006, 0.032, 0.086), (0.066, 0, 0.106), mat=k.warn if not ch else k.accent, bevel=0.002),
         _along(R.capsule("thumb", 0.020, 0.086, mat=k.steel, verts=16), (-0.024, s * 0.070, 0.112), (-0.010, s * 0.066, 0.186))]
    for i, y in enumerate((-0.0465, -0.0155, 0.0155, 0.0465)):
        p += [R.soft_box(f"finger{i}", (0.086, 0.0290, 0.046), (0.000, y, 0.184), mat=k.steel, roundness=0.45),      # knuckle face
              R.soft_box(f"fingertip{i}", (0.040, 0.0285, 0.070), (-0.046, y, 0.138), mat=k.steel, roundness=0.45),  # tucked under
              R.blob(f"knuckle{i}", (0.044, 0.0290, 0.044), (0.040, y, 0.176), mat=cap, cuboid=0.5)]
        if ch:
            p.append(R.cylinder(f"stud{i}", 0.009, 0.018, (0.020, y, 0.214), mat=cap, verts=10, bevel=0.0, radius_top=0.003))
    return p


# ------------------------------------------------------------------------------------------------------------------ legs
def thigh(k, lv, s):
    L = 0.43
    ch = champion(lv)
    out = -s
    a0 = out * 90
    quad = [(0.040, 0, 0, 0.098, 0.084, 0.094), (0.150, 0.006, 0, 0.114, 0.088, 0.102), (0.290, 0.004, 0, 0.092, 0.076, 0.084),
            (0.378, 0, 0, 0.070, 0.062, 0.068)]
    p = [R.actuator("hip_act", 0.058, 0.104, k.frame, k.alu, k.bolt, (0, 0, 0), (D(90), 0, 0), 10),
         R.cylinder("femur", 0.040, 0.360, (0, 0, 0.220), mat=k.frame, verts=20),
         hull("quad", quad, k.shell, p=3.6 if ch else 2.8, n=44, arc=(-102, 102), thick=0.024, bevel=0.006),
         hull("ham", [(0.070, 0, 0, 0.07, 0.084, 0.088), (0.170, 0, 0, 0.07, 0.094, 0.094), (0.300, 0, 0, 0.06, 0.074, 0.076),
                      (0.365, 0, 0, 0.055, 0.060, 0.064)], k.frame, p=3.0, n=44, arc=(116, 244), thick=0.020, bevel=0.005),
         hull("stripe", [(0.085, 0, 0, 0.104, 0.090, 0.103), (0.150, 0.006, 0, 0.118, 0.092, 0.109), (0.290, 0.004, 0, 0.096, 0.080, 0.090)],
              k.trim if ch else k.accent, p=3.2, n=60, arc=(a0 - 20, a0 + 20), thick=0.008, bevel=0.002),
         R.actuator("knee", 0.055, 0.116, k.frame, k.alu, k.bolt, (0, 0, L), (D(90), 0, 0), 10)]
    for i in (-1, 1):
        p += piston(f"ham_p{i}", (-0.070, i * 0.030, 0.050), (-0.054, i * 0.028, 0.385), 0.010, k)
    # a raised chevron over the knee end of the quad and three cooling slots above it
    p.append(hull("quad_chevron", [(0.262, 0.004, 0, 0.104, 0.08, 0.092), (0.320, 0.003, 0, 0.092, 0.07, 0.082), (0.384, 0, 0, 0.076, 0.064, 0.072)],
                  k.trim if ch else k.accent, p=3.2, n=60, arc=(-46, 46), thick=0.010, bevel=0.003))
    for i in range(3):
        p.append(R.box(f"slot{i}", (0.010, 0.060, 0.009), (0.112 - i * 0.0015, 0, 0.118 + i * 0.022), mat=k.plastic, bevel=0.002, segments=1))
    return p


def calf(k, lv, s):
    L = 0.42
    ch = champion(lv)
    p = [R.cylinder("tibia", 0.034, 0.360, (0, 0, 0.210), mat=k.frame, verts=20),
         R.blob("knee_cap", (0.074, 0.104, 0.110), (0.062, 0, 0.004), mat=k.trim if ch else k.alu, cuboid=0.5),
         hull("shin", [(0.060, 0, 0, 0.074, 0.060, 0.070), (0.160, 0.002, 0, 0.084, 0.064, 0.076), (0.290, 0, 0, 0.062, 0.052, 0.058),
                       (0.372, 0, 0, 0.052, 0.048, 0.050)], k.shell, p=3.8 if ch else 3.0, n=44, arc=(-88, 88), thick=0.022, bevel=0.006),
         hull("calf", [(0.050, 0, 0, 0.056, 0.072, 0.068), (0.150, 0, 0, 0.060, 0.106, 0.084), (0.270, 0, 0, 0.050, 0.066, 0.060),
                       (0.360, 0, 0, 0.044, 0.048, 0.046)], k.frame, p=2.8, n=44, arc=(100, 260), thick=0.020, bevel=0.005),
         R.actuator("ankle", 0.043, 0.104, k.frame, k.alu, k.bolt, (0, 0, L), (D(90), 0, 0), 8)]
    p += piston("achilles", (-0.070, 0, 0.215), (-0.050, 0, 0.405), 0.010, k)
    if ch:
        p.append(R.box("shin_blade", (0.030, 0.012, 0.250), (0.090, 0, 0.190), (0, D(3), 0), mat=k.trim, bevel=0.003, taper=(0.3, 1.0)))
    else:
        p.append(R.box("shin_ridge", (0.012, 0.030, 0.220), (0.086, 0, 0.190), (0, D(3), 0), mat=k.warn, bevel=0.004))
    return p


def foot(k, lv, s):
    y = s * 0.14
    ch = champion(lv)
    p = [R.soft_box("sole", (0.305, 0.122, 0.032), (0.068, y, 0.016), mat=k.rubber, roundness=0.3),
         R.soft_box("heel", (0.104, 0.112, 0.078), (-0.046, y, 0.068), mat=k.shell, roundness=0.35),
         R.soft_box("instep", (0.140, 0.104, 0.060), (0.056, y, 0.066), (0, D(12), 0), mat=k.frame, roundness=0.35),
         R.soft_box("toe", (0.110, 0.124, 0.062), (0.172, y, 0.052), (0, D(10), 0), mat=k.shell, roundness=0.4, taper=(0.8, 0.9)),
         R.box("toe_hinge", (0.012, 0.126, 0.050), (0.114, y, 0.058), mat=k.trim if ch else k.warn, bevel=0.003),
         R.curved_plate("ankle_guard", 0.058, 150, 0.074, 0.014, (0, y, 0.122), mat=k.accent, bevel=0.004),
         R.box("ankle_block", (0.080, 0.070, 0.060), (0.0, y, 0.098), mat=k.frame, bevel=0.010)]
    for i in range(5):
        p.append(R.box(f"tread{i}", (0.014, 0.116, 0.008), (-0.056 + i * 0.062, y, 0.002), mat=k.rubber, bevel=0.002))
    return p
