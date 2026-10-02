"""Professional boxing ring + TV arena (realistic). Ring centre at the origin, canvas top at z = 0 (robots' floor),
arena floor at z = -RING_HEIGHT. Fight line along X: blue corner on -X/-Y, red corner on +X/+Y.

Real-world spec: 20 ft (6.10 m) inside the ropes, ~0.6 m apron, 4 ropes at 46/76/107/137 cm, padded turnbuckles
(red, blue, two white neutral), rope spacers, stretched canvas with logos, printed apron skirt, steps.
"""

from __future__ import annotations

import math
import random

import bmesh
import bpy
from mathutils import Vector

import rlib as R

D = math.radians
INSIDE = 6.10
HALF = INSIDE / 2
POST = HALF + 0.30
APRON = HALF + 0.62
RING_HEIGHT = 1.0
ROPE_Z = (0.46, 0.76, 1.07, 1.37)
BLUE = (0.01, 0.07, 0.42)
RED = (0.48, 0.015, 0.01)


def _canvas_material():
    mat = bpy.data.materials.new("Canvas")
    nt, bsdf = R._nodes(mat)
    base = (0.32, 0.33, 0.34)
    stains = R._noise(nt, 2.2, 6.0, 0.62)
    scuff = R._noise(nt, 18.0, 8.0, 0.7, stretch=(1, 4, 1))
    st = R._maprange(nt, stains.outputs["Fac"], 0.5, 0.75, 0.0, 0.35)
    sc = R._maprange(nt, scuff.outputs["Fac"], 0.55, 0.75, 0.0, 0.25)
    dirt = R._math(nt, "MINIMUM", R._math(nt, "ADD", st, sc), 0.6)
    # wear towards the centre where fighters move
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(geo.outputs["Position"], sep.inputs[0])
    rad = R._math(nt, "SQRT", R._math(nt, "ADD", R._math(nt, "MULTIPLY", sep.outputs[0], sep.outputs[0]),
                                      R._math(nt, "MULTIPLY", sep.outputs[1], sep.outputs[1])))
    centre = R._maprange(nt, rad, 3.0, 0.5, 0.0, 1.0)
    dirt = R._math(nt, "MULTIPLY", dirt, R._math(nt, "ADD", 0.5, centre))
    col = R._mix_rgb(nt, dirt, base, (0.16, 0.15, 0.14))
    nt.links.new(col, bsdf.inputs["Base Color"])
    nt.links.new(R._maprange(nt, dirt, 0, 0.6, 0.86, 0.7), bsdf.inputs["Roughness"])
    bsdf.inputs["Sheen Weight"].default_value = 0.3
    tc = nt.nodes.new("ShaderNodeTexCoord")
    w = nt.nodes.new("ShaderNodeTexWave")
    w.inputs["Scale"].default_value = 700.0
    nt.links.new(tc.outputs["Object"], w.inputs["Vector"])
    wr = R._noise(nt, 1.4, 3.0, 0.5)  # stretch wrinkles over the padding
    h = R._math(nt, "ADD", R._math(nt, "MULTIPLY", w.outputs["Fac"], 0.25), wr.outputs["Fac"])
    R._bump(nt, bsdf, h, 0.12, 0.003)
    return mat


def _crowd(count_rows=16, seats_per_side=110, start=9.5, row_depth=0.8, row_rise=0.45, seed=7):
    """Tiered stands on 4 sides filled with low-poly spectators. Built with numpy in one mesh (fast):
    every box is 8 verts / 6 quads; colour per person via a face-corner colour attribute."""
    import numpy as np

    rnd = np.random.default_rng(seed)
    unit = np.array([(-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1), (-1, -1, 1), (1, -1, 1), (1, 1, 1),
                     (-1, 1, 1)], dtype=np.float32) * 0.5
    quads = np.array([(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)])
    shirts = np.array([(0.02, 0.02, 0.025), (0.05, 0.05, 0.06), (0.12, 0.12, 0.13), (0.25, 0.02, 0.02),
                       (0.02, 0.05, 0.2), (0.3, 0.3, 0.3), (0.08, 0.06, 0.04), (0.5, 0.5, 0.5), (0.02, 0.1, 0.04)])
    skins = np.array([(0.45, 0.3, 0.22), (0.25, 0.15, 0.1), (0.6, 0.43, 0.33), (0.12, 0.08, 0.06)])
    people, steps = [], []  # (cx, cy, cz, sx, sy, sz, yaw, r, g, b)
    floor_z = -RING_HEIGHT
    for side in range(4):
        rot = side * math.pi / 2
        c, s = math.cos(rot), math.sin(rot)
        for row in range(count_rows):
            d = start + row * row_depth
            z = floor_z + row * row_rise
            half_len = d + 0.5
            steps.append((d * c, d * s, z - 0.23, row_depth, 2 * half_len, 0.5, rot, 0, 0, 0))
            n = int(seats_per_side * (half_len / (start + 0.5)))
            u = -half_len + (np.arange(n) + rnd.uniform(0.2, 0.8, n)) * (2 * half_len / n)
            keep = rnd.random(n) > 0.08
            u = u[keep]
            px = d + rnd.uniform(-0.12, 0.12, u.size)
            wx, wy = px * c - u * s, px * s + u * c
            h = rnd.uniform(0.95, 1.12, u.size)
            yaw = rot + math.pi + rnd.uniform(-0.3, 0.3, u.size)
            shirt = shirts[rnd.integers(0, len(shirts), u.size)]
            skin = skins[rnd.integers(0, len(skins), u.size)]
            pants = np.array([(0.03, 0.03, 0.04), (0.05, 0.06, 0.1), (0.1, 0.09, 0.08)])[rnd.integers(0, 3, u.size)]
            for i in range(u.size):
                hh = h[i]
                fx, fy = math.cos(yaw[i]), math.sin(yaw[i])
                people.append((wx[i] + fx * 0.12, wy[i] + fy * 0.12, z + 0.16, 0.42, 0.36, 0.26, yaw[i], *pants[i]))
                people.append((wx[i], wy[i], z + 0.52 * hh, 0.22, 0.34, 0.44 * hh, yaw[i], *shirt[i]))
                people.append((wx[i], wy[i], z + 0.76 * hh, 0.2, 0.44, 0.1, yaw[i], *shirt[i]))
                people.append((wx[i], wy[i], z + 0.86 * hh, 0.09, 0.09, 0.08, yaw[i], *skin[i]))
                people.append((wx[i], wy[i], z + 0.98 * hh, 0.16, 0.14, 0.2, yaw[i], *skin[i]))
            arms = rnd.random(u.size) < 0.18
            for i in np.nonzero(arms)[0]:
                people.append((wx[i] + rnd.uniform(-0.15, 0.15), wy[i] + rnd.uniform(-0.15, 0.15), z + 1.05 * h[i],
                               0.07, 0.07, 0.38, yaw[i], *shirt[i]))

    def boxes_mesh(name, rows, with_color):
        arr = np.array(rows, dtype=np.float32)
        n = len(arr)
        v = unit[None, :, :] * arr[:, None, 3:6]
        cy, sy = np.cos(arr[:, 6])[:, None], np.sin(arr[:, 6])[:, None]
        x = v[:, :, 0] * cy - v[:, :, 1] * sy
        y = v[:, :, 0] * sy + v[:, :, 1] * cy
        v = np.stack((x + arr[:, None, 0], y + arr[:, None, 1], v[:, :, 2] + arr[:, None, 2]), axis=-1)
        faces = (quads[None, :, :] + (np.arange(n) * 8)[:, None, None]).reshape(-1, 4)
        me = bpy.data.meshes.new(name)
        me.vertices.add(n * 8)
        me.vertices.foreach_set("co", v.reshape(-1))
        me.loops.add(faces.size)
        me.loops.foreach_set("vertex_index", faces.reshape(-1).astype(np.int32))
        me.polygons.add(len(faces))
        me.polygons.foreach_set("loop_start", (np.arange(len(faces)) * 4).astype(np.int32))
        me.polygons.foreach_set("loop_total", np.full(len(faces), 4, dtype=np.int32))
        me.update(calc_edges=True)
        if with_color:
            attr = me.color_attributes.new("Col", "FLOAT_COLOR", "CORNER")
            col = np.repeat(np.concatenate((arr[:, 7:10], np.ones((n, 1), np.float32)), axis=1), 24, axis=0)
            attr.data.foreach_set("color", col.reshape(-1))
        return R._link(bpy.data.objects.new(name, me))

    crowd = boxes_mesh("Crowd", people, True)
    mat = bpy.data.materials.new("CrowdMat")
    nt, bsdf = R._nodes(mat)
    attr = nt.nodes.new("ShaderNodeVertexColor")
    attr.layer_name = "Col"
    dim = nt.nodes.new("ShaderNodeMix")
    dim.data_type = "RGBA"
    dim.blend_type = "MULTIPLY"
    dim.inputs[0].default_value = 1.0
    nt.links.new(attr.outputs["Color"], dim.inputs[6])
    dim.inputs[7].default_value = (0.45, 0.45, 0.45, 1)
    nt.links.new(dim.outputs[2], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.8
    bsdf.inputs["Sheen Weight"].default_value = 0.5
    crowd.data.materials.append(mat)
    st = boxes_mesh("Stands", steps, False)
    st.data.materials.append(R.mat_rough("StandConcrete", (0.035, 0.035, 0.04), 0.7))
    return crowd, st


def _truss_beam(name, a: Vector, b: Vector, mat, w=0.32):
    """Box truss (4 chords + zig-zag lacing, like real 12" aluminium truss) built as one bmesh for speed."""
    from mathutils import Matrix

    bm = bmesh.new()
    L = (b - a).length
    m = R.frame_matrix(a, b, Vector((0, 0, 1)))

    def rod(p0, p1, r, segs):
        d = (p1 - p0).length
        mat_rod = m @ R.frame_matrix(p0, p1) @ Matrix.Translation((0, 0, d / 2))
        bmesh.ops.create_cone(bm, cap_ends=False, segments=segs, radius1=r, radius2=r, depth=d, matrix=mat_rod)

    chords = ((-w / 2, -w / 2), (-w / 2, w / 2), (w / 2, w / 2), (w / 2, -w / 2))
    for cx, cy in chords:
        rod(Vector((cx, cy, 0)), Vector((cx, cy, L)), 0.024, 12)
    n = max(1, int(L / w))
    for i in range(n):
        z0, z1 = i * L / n, (i + 0.5) * L / n
        for k in range(4):
            (x0, y0), (x1, y1) = chords[k], chords[(k + 1) % 4]
            rod(Vector((x0, y0, z0)), Vector((x1, y1, z1)), 0.009, 6)
            rod(Vector((x1, y1, z1)), Vector((x0, y0, z1 + 0.5 * L / n)), 0.009, 6)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    obj = R._link(bpy.data.objects.new(name, me))
    obj.data.shade_smooth()
    return obj


def build_ring(blue_corner_pad=BLUE, red_corner_pad=RED, with_arena=True):
    col = R.collection("Ring")
    R.set_collection(col)
    steel = R.mat_metal("PostSteel", (0.04, 0.04, 0.045), rough=0.35, brushed=False)
    chrome = R.mat_metal("Turnbuckle", (0.8, 0.8, 0.82), rough=0.12, brushed=False)
    apron_mat = R.mat_cloth("ApronVinyl", (0.012, 0.012, 0.014), 0.5, 300)
    rope_mat = R.mat_rough("RopeVinyl", (0.62, 0.62, 0.63), 0.35, coat=0.3, spec=0.6)
    tie_mat = R.mat_rough("RopeTie", (0.02, 0.02, 0.025), 0.6)
    white_txt = R.mat_rough("RingPrint", (0.75, 0.75, 0.76), 0.6)
    blue_print = R.mat_rough("BluePrint", (0.008, 0.035, 0.22), 0.6)
    red_print = R.mat_rough("RedPrint", (0.5, 0.02, 0.02), 0.6)
    pads = {"blue": R.mat_leather("PadBlue", blue_corner_pad, 0.45), "red": R.mat_leather("PadRed", red_corner_pad, 0.45),
            "white": R.mat_leather("PadWhite", (0.62, 0.62, 0.62), 0.5)}

    # platform + canvas
    R.box("platform", (2 * APRON, 2 * APRON, RING_HEIGHT - 0.06), (0, 0, -RING_HEIGHT / 2 - 0.03), mat=apron_mat,
          bevel=0.01)
    cv = R.box("canvas", (2 * APRON + 0.04, 2 * APRON + 0.04, 0.06), (0, 0, -0.03), mat=_canvas_material(),
               bevel=0.03, segments=4)
    sub = cv.modifiers.new("Subsurf", "SUBSURF")
    sub.levels = sub.render_levels = 1
    # logos on the canvas
    R.text_mesh("canvas_logo", "IRON ECHO", 0.78, blue_print, (0, 0, 0.0012), (0, 0, D(90)), extrude=0.0004)
    ring_logo = R.tube("canvas_circle", 1.55, 0.06, 0.0008, (0, 0, 0.0006), mat=blue_print, verts=128)
    R.text_mesh("canvas_sub", "ROBOT BOXING CHAMPIONSHIP", 0.16, red_print, (0.62, 0, 0.0012), (0, 0, D(90)),
                extrude=0.0004)
    R.text_mesh("canvas_sub2", "WORLD SERIES  ·  ROUND OF STEEL", 0.13, red_print, (-0.6, 0, 0.0012),
                (0, 0, D(-90)), extrude=0.0004)
    for sx, sy, m, t in ((-1, -1, blue_print, "BLUE"), (1, 1, red_print, "RED")):
        R.text_mesh(f"corner_{t}", f"{t} CORNER", 0.18, m, (sx * 2.35, sy * 2.35, 0.0012),
                    (0, 0, D(45 if sx > 0 else -135) + D(90)), extrude=0.0004)
    del ring_logo
    # apron skirt print
    for i in range(4):
        rot = i * math.pi / 2
        c, s = math.cos(rot), math.sin(rot)
        R.text_mesh(f"apron_txt{i}", "IRON ECHO", 0.42, white_txt, ((APRON + 0.002) * c, (APRON + 0.002) * s, -0.5),
                    (D(90), 0, rot + D(90)), extrude=0.0005)
        R.box(f"apron_band{i}", (0.004, 2 * APRON - 0.1, 0.05), ((APRON + 0.001) * c, (APRON + 0.001) * s, -0.12),
              (0, 0, rot), mat=blue_print if i % 2 else red_print, bevel=0.001)

    # posts + turnbuckle pads
    corners = {(-1, -1): "blue", (1, 1): "red", (1, -1): "white", (-1, 1): "white"}
    for (sx, sy), pad in corners.items():
        px, py = sx * POST, sy * POST
        R.cylinder(f"post{sx}{sy}", 0.055, 1.62, (px, py, 0.81 - 0.06), mat=steel, verts=32, bevel=0.01)
        R.cylinder(f"postcap{sx}{sy}", 0.07, 0.05, (px, py, 1.57), mat=steel, verts=32, bevel=0.012)
        ang = math.atan2(-sy, -sx)
        cxp, cyp = px + 0.17 * math.cos(ang), py + 0.17 * math.sin(ang)
        padobj = R.blob(f"pad{sx}{sy}", (0.2, 0.26, 1.08), (cxp, cyp, 0.92), (0, 0, ang), pads[pad], cuboid=0.5)
        del padobj
        for z in ROPE_Z:
            R.cylinder(f"tb{sx}{sy}{z}", 0.014, 0.16, (px + 0.09 * math.cos(ang), py + 0.09 * math.sin(ang), z),
                       (0, D(90), ang), chrome, 16, bevel=0.002)

    # ropes with slight sag + spacers
    for side in range(4):
        rot = side * math.pi / 2
        c, s = math.cos(rot), math.sin(rot)
        for z in ROPE_Z:
            pts = []
            for k in range(9):
                u = -HALF - 0.12 + k * (2 * HALF + 0.24) / 8
                sag = 0.035 * (1 - (u / (HALF + 0.12)) ** 2)
                x, y = HALF + 0.04, u
                pts.append((x * c - y * s, x * s + y * c, z - sag))
            R.cable(f"rope{side}{z}", pts, 0.026, rope_mat, resolution=12)
        for u in (-HALF / 3, HALF / 3):
            x, y = HALF + 0.06, u
            R.box(f"tie{side}{u}", (0.03, 0.05, ROPE_Z[-1] - ROPE_Z[0] + 0.08),
                  (x * c - y * s, x * s + y * c, (ROPE_Z[0] + ROPE_Z[-1]) / 2 - 0.02), (0, 0, rot), tie_mat,
                  bevel=0.006)

    # steps at the blue and red corners
    for sx, sy in ((-1, -1), (1, 1)):
        for i in range(3):
            d = APRON + 0.25 + i * 0.3
            R.box(f"step{sx}{i}", (0.9, 0.3, RING_HEIGHT - i * 0.32), (sx * (APRON - 0.6), sy * d,
                                                                         -RING_HEIGHT + (RING_HEIGHT - i * 0.32) / 2),
                  mat=steel, bevel=0.01)
    if with_arena:
        build_arena()
    return col


def build_arena():
    col = R.collection("Arena")
    R.set_collection(col)
    fz = -RING_HEIGHT
    floor = R.mat_rough("ArenaFloor", (0.02, 0.02, 0.022), 0.55, coat=0.2)
    R.box("arena_floor", (60, 60, 0.02), (0, 0, fz - 0.01), mat=floor, bevel=0)
    led = R.mat_emissive("LEDBoard", (0.03, 0.12, 0.6), 1.1)
    led_red = R.mat_emissive("LEDBoardRed", (0.6, 0.04, 0.02), 1.1)
    led_txt = R.mat_emissive("LEDText", (0.9, 0.9, 1.0), 8.0)
    table = R.mat_rough("TableCloth", (0.01, 0.01, 0.012), 0.7)
    screen = R.mat_emissive("Monitor", (0.25, 0.35, 0.45), 1.5)
    chair = R.mat_rough("Chair", (0.03, 0.03, 0.035), 0.5)
    # LED barrier boards around ringside
    for side in range(4):
        rot = side * math.pi / 2
        c, s = math.cos(rot), math.sin(rot)
        d = 6.6
        R.box(f"board{side}", (0.12, 11.5, 0.85), (d * c, d * s, fz + 0.425), (0, 0, rot),
              led if side % 2 else led_red, bevel=0.01)
        R.text_mesh(f"board_txt{side}", "IRON ECHO  ·  ROBOT BOXING  ·  IRON ECHO", 0.32, led_txt,
                    ((d - 0.065) * c, (d - 0.065) * s, fz + 0.42), (D(90), 0, rot - D(90)), extrude=0.0005)
        # judges' / press tables
        if side in (1, 3):
            for j in range(-2, 3):
                x, y = 5.6, j * 1.6
                wx, wy = x * c - y * s, x * s + y * c
                R.box(f"table{side}{j}", (0.7, 1.4, 0.75), (wx, wy, fz + 0.375), (0, 0, rot), table, bevel=0.01)
                R.box(f"mon{side}{j}", (0.03, 0.5, 0.3), (wx - 0.15 * c, wy - 0.15 * s, fz + 0.92), (0, D(-12), rot),
                      screen, bevel=0.005)
                R.box(f"chair{side}{j}", (0.5, 0.5, 0.9), ((x + 0.65) * c - y * s, (x + 0.65) * s + y * c,
                                                           fz + 0.45), (0, 0, rot), chair, bevel=0.03)
    crowd, stands = _crowd()
    del crowd, stands
    # lighting truss over the ring
    alu = R.mat_metal("TrussAlu", (0.55, 0.56, 0.58), rough=0.4)
    tz = 6.2
    h = 3.9
    corners = [Vector((-h, -h, tz)), Vector((h, -h, tz)), Vector((h, h, tz)), Vector((-h, h, tz))]
    for i in range(4):
        _truss_beam(f"truss{i}", corners[i], corners[(i + 1) % 4], alu)
    for cnr in corners:
        R.cylinder("chain", 0.01, 12.0, (cnr.x, cnr.y, tz + 6.0), mat=alu, verts=8, bevel=0)
    # centre-hung screen
    scr = R.mat_emissive("JumboScreen", (0.08, 0.12, 0.3), 1.2)
    R.box("jumbo", (3.2, 3.2, 1.8), (0, 0, tz + 3.0), mat=R.mat_rough("JumboFrame", (0.01, 0.01, 0.01), 0.4),
          bevel=0.03)
    for i in range(4):
        rot = i * math.pi / 2
        c, s = math.cos(rot), math.sin(rot)
        R.box(f"jumbo_face{i}", (0.02, 3.0, 1.6), (1.61 * c, 1.61 * s, tz + 3.0), (0, 0, rot), scr, bevel=0)
        R.text_mesh(f"jumbo_txt{i}", "IRON ECHO", 0.42, led_txt, (1.625 * c, 1.625 * s, tz + 3.0),
                    (D(90), 0, rot + D(90)), extrude=0.0005)
    return col


def light_arena(strength=1.0, haze=0.0008):
    """TV boxing lighting: bright soft top from the over-ring rig, hard spots from the truss, dark house."""
    col = R.collection("Lights")
    R.set_collection(col)
    R.world((0.004, 0.0045, 0.006), 1.0, haze=haze, haze_box=((0, 0, 3.0), (26, 26, 9.0)))
    tz = 6.1
    R.area_light("top_softbox", (0, 0, tz - 0.1), (0, 0, 0), 700 * strength, 4.0, (1.0, 0.97, 0.93), spread=50)
    fixture = R.mat_rough("FixtureBody", (0.02, 0.02, 0.022), 0.4)
    lens = R.mat_emissive("FixtureLens", (1.0, 0.95, 0.88), 40.0)
    h = 3.9
    for side in range(4):
        rot = side * math.pi / 2
        c, s = math.cos(rot), math.sin(rot)
        for u in (-2.6, -0.9, 0.9, 2.6):
            x, y = h, u
            p = Vector((x * c - y * s, x * s + y * c, tz - 0.35))
            target = Vector((0.45 * (x * c - y * s) * 0.2, 0.45 * (x * s + y * c) * 0.2, 1.2))
            R.spot_light(f"spot{side}{u}", p, target, 1500 * strength, angle=30, blend=0.35, radius=0.05,
                         color=(1.0, 0.95, 0.88))
            body = R.cylinder(f"fixture{side}{u}", 0.14, 0.32, p, mat=fixture, verts=24, bevel=0.01)
            body.rotation_euler = (target - p).to_track_quat("Z", "Y").to_euler()
            lensobj = R.cylinder(f"lens{side}{u}", 0.12, 0.01, p + (target - p).normalized() * 0.165, mat=lens,
                                 verts=24, bevel=0)
            lensobj.rotation_euler = body.rotation_euler
            lensobj.visible_shadow = False
    # cool rim lights from two house corners (broadcast look)
    R.area_light("rim_blue", (-9, -9, 7), (0, 0, 1.2), 1400 * strength, 2.0, (0.55, 0.7, 1.0), spread=30)
    R.area_light("rim_red", (9, 9, 7), (0, 0, 1.2), 1200 * strength, 2.0, (1.0, 0.62, 0.45), spread=30)
    # dim house fill so the crowd is just readable
    R.area_light("house", (0, 0, 14), (0, 0, 0), 90 * strength, 30, (0.6, 0.65, 0.8), spread=160)
    return col
