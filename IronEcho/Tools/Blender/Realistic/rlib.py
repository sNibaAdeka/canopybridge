"""Shared helpers for the realistic IRON ECHO assets (Blender 4.5, also works as `pip install bpy`).

Geometry: bevelled hard-surface primitives with weighted normals. Materials: physically plausible procedural PBR
(edge wear, cavity dirt, roughness breakup) built only from Blender nodes, so no external textures are needed and
everything can be baked to BaseColor/Normal/ORM for Unreal later. Units: metres, Z up.
"""

from __future__ import annotations

import math
from typing import Iterable, Optional, Sequence

import bpy
from mathutils import Matrix, Vector

# ---------------------------------------------------------------------------------------------------------------- scene


def reset_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _MATS.clear()  # cached materials die with the old file
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.curves, bpy.data.lights, bpy.data.cameras):
        for item in list(block):
            block.remove(item)


def collection(name: str, parent: Optional[bpy.types.Collection] = None) -> bpy.types.Collection:
    col = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    target = parent or bpy.context.scene.collection
    if col.name not in target.children:
        target.children.link(col)
    return col


_ACTIVE_COL: list = []

# Geometry density: "render" for Cycles showcase, "game" for the Unreal export (fewer bevel/subdivision segments).
QUALITY = {"mode": "render"}


def game() -> bool:
    return QUALITY["mode"] == "game"


def set_collection(col: bpy.types.Collection) -> None:
    _ACTIVE_COL[:] = [col]


def _link(obj: bpy.types.Object) -> bpy.types.Object:
    col = _ACTIVE_COL[0] if _ACTIVE_COL else bpy.context.scene.collection
    col.objects.link(obj)
    return obj


# ------------------------------------------------------------------------------------------------------------- geometry


def _finish(obj, mat, bevel: float, segments: int = 3, smooth: bool = True, angle: float = 35.0, weighted: bool = True):
    if mat is not None:
        obj.data.materials.append(mat)
    if smooth:
        obj.data.shade_smooth()
    if bevel > 0:
        mod = obj.modifiers.new("Bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 1 if game() else segments
        mod.limit_method = "ANGLE"
        mod.angle_limit = math.radians(angle)
        mod.harden_normals = True
        mod.miter_outer = "MITER_ARC"
    if weighted:
        wn = obj.modifiers.new("WeightedNormal", "WEIGHTED_NORMAL")
        wn.keep_sharp = True
    return obj


def mesh_object(name: str, verts, faces, mat=None, bevel=0.0, segments=3, smooth=True, angle=35.0) -> bpy.types.Object:
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    me.update()
    obj = _link(bpy.data.objects.new(name, me))
    return _finish(obj, mat, bevel, segments, smooth, angle)


def box(name, size, loc=(0, 0, 0), rot=(0, 0, 0), mat=None, bevel=0.006, segments=3, taper=None) -> bpy.types.Object:
    """Axis-aligned box of full size (sx, sy, sz). taper=(fx, fy) scales the +Z face for wedge/taper shapes."""
    sx, sy, sz = (s * 0.5 for s in size)
    tx, ty = taper or (1.0, 1.0)
    v = [(-sx, -sy, -sz), (sx, -sy, -sz), (sx, sy, -sz), (-sx, sy, -sz),
         (-sx * tx, -sy * ty, sz), (sx * tx, -sy * ty, sz), (sx * tx, sy * ty, sz), (-sx * tx, sy * ty, sz)]
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    obj = mesh_object(name, v, f, mat, bevel, segments, smooth=True)
    obj.location = loc
    obj.rotation_euler = rot
    return obj


def cylinder(name, radius, depth, loc=(0, 0, 0), rot=(0, 0, 0), mat=None, verts=48, bevel=0.003, segments=2,
             radius_top=None, cap=True) -> bpy.types.Object:
    """Cylinder along local Z, centred."""
    rt = radius if radius_top is None else radius_top
    if game():
        verts = max(8, verts // 2)
    v, f = [], []
    for ring, (z, r) in enumerate(((-depth / 2, radius), (depth / 2, rt))):
        for i in range(verts):
            a = 2 * math.pi * i / verts
            v.append((r * math.cos(a), r * math.sin(a), z))
    for i in range(verts):
        j = (i + 1) % verts
        f.append((i, j, verts + j, verts + i))
    if cap:
        f.append(tuple(reversed(range(verts))))
        f.append(tuple(range(verts, 2 * verts)))
    obj = mesh_object(name, v, f, mat, bevel, segments, smooth=True, angle=40)
    obj.location = loc
    obj.rotation_euler = rot
    return obj


def tube(name, radius, thickness, depth, loc=(0, 0, 0), rot=(0, 0, 0), mat=None, verts=48, bevel=0.002):
    obj = cylinder(name, radius, depth, loc, rot, mat, verts, bevel=0, cap=False)
    sol = obj.modifiers.new("Solidify", "SOLIDIFY")
    sol.thickness = thickness
    sol.offset = -1
    obj.modifiers.move(obj.modifiers.find("Solidify"), 0)
    if bevel:
        b = obj.modifiers.new("Bevel", "BEVEL")
        b.width = bevel
        b.segments = 2
        b.limit_method = "ANGLE"
        obj.modifiers.move(obj.modifiers.find("Bevel"), 1)
    return obj


def soft_box(name, size, loc=(0, 0, 0), rot=(0, 0, 0), mat=None, roundness=0.25, levels=2, taper=None):
    """Product-design shell: bevelled box + subdivision gives tight, smooth rounded corners."""
    obj = box(name, size, loc, rot, mat, bevel=0, taper=taper)
    for m in list(obj.modifiers):
        obj.modifiers.remove(m)
    b = obj.modifiers.new("Bevel", "BEVEL")
    b.width = min(size) * 0.5 * roundness
    b.segments = 2
    b.limit_method = "NONE"
    s = obj.modifiers.new("Subsurf", "SUBSURF")
    s.levels = s.render_levels = 1 if game() else levels
    return obj


def curved_plate(name, radius, arc_deg, height, thickness, loc=(0, 0, 0), rot=(0, 0, 0), mat=None, taper=1.0,
                 bulge=0.0, lean=0.0, segs=(28, 10), bevel=0.004, flare=0.0, screws=None):
    """Armour plate wrapped on a vertical cylinder (local Z axis), centred on +X. taper scales the arc at the top,
    bulge pushes the middle outward (muscle/padding), lean tilts the top inward (+) or outward (-), flare widens
    the radius at the top. Solidified inward with rounded edges: reads as a real moulded shell with thickness."""
    nu, nv = segs
    if game():
        nu, nv = max(8, nu // 2), max(4, nv // 2)
    v, f = [], []
    for j in range(nv + 1):
        t = j / nv
        z = (t - 0.5) * height
        arc = math.radians(arc_deg) * (1.0 + (taper - 1.0) * t)
        r = radius + bulge * math.sin(math.pi * t) + flare * t - lean * t
        for i in range(nu + 1):
            a = (i / nu - 0.5) * arc
            v.append((r * math.cos(a), r * math.sin(a), z))
    for j in range(nv):
        for i in range(nu):
            k = j * (nu + 1) + i
            f.append((k, k + 1, k + nu + 2, k + nu + 1))
    obj = mesh_object(name, v, f, mat, 0.0, smooth=True)
    for m in list(obj.modifiers):
        obj.modifiers.remove(m)
    sol = obj.modifiers.new("Solidify", "SOLIDIFY")
    sol.thickness = thickness
    sol.offset = -1
    sol.use_even_offset = True
    b = obj.modifiers.new("Bevel", "BEVEL")
    b.width = min(bevel, thickness * 0.45)
    b.segments = 1 if game() else 3
    b.limit_method = "ANGLE"
    b.angle_limit = math.radians(50)
    b.harden_normals = True
    obj.modifiers.new("WeightedNormal", "WEIGHTED_NORMAL").keep_sharp = True
    if screws is not None:  # 4 corner screws, `screws` = screw material
        pts = []
        for tz in (0.12, 0.88):
            z = (tz - 0.5) * height
            arc = math.radians(arc_deg) * (1.0 + (taper - 1.0) * tz)
            r = radius + bulge * math.sin(math.pi * tz) + flare * tz - lean * tz
            for side in (-1, 1):
                a = side * arc * 0.5 * 0.86
                n = Vector((math.cos(a), math.sin(a), 0.0))
                pts.append((n * r + Vector((0, 0, z)), n))
        heads = screw_heads(f"{name}_screws", pts, screws)
        obj = join([obj, heads], name)
    obj.location = loc
    obj.rotation_euler = rot
    return obj


def orient(normal, up):
    """Euler rotation that maps local +Z to `normal` and local +Y to `up` (for decals/text on a surface)."""
    n = Vector(normal).normalized()
    u = Vector(up)
    u = (u - n * u.dot(n)).normalized()
    x = u.cross(n)
    return Matrix((x, u, n)).transposed().to_euler()


def screw_heads(name, points, mat, r=0.0045, h=0.003):
    """Socket-cap screw heads at (position, outward normal) pairs, one mesh."""
    v, f = [], []
    seg = 10
    for (p, n) in points:
        p, n = Vector(p), Vector(n).normalized()
        a = n.orthogonal().normalized()
        b = n.cross(a)
        base = len(v)
        for k in range(2):
            for i in range(seg):
                t = 2 * math.pi * i / seg
                rr = r if k == 0 else r * 0.92
                v.append(tuple(p + (a * math.cos(t) + b * math.sin(t)) * rr + n * (h * k)))
        for i in range(seg):
            j = (i + 1) % seg
            f.append((base + i, base + j, base + seg + j, base + seg + i))
        f.append(tuple(base + seg + i for i in range(seg)))
        # hex socket
        c = len(v)
        for i in range(6):
            t = 2 * math.pi * i / 6
            v.append(tuple(p + (a * math.cos(t) + b * math.sin(t)) * r * 0.4 + n * (h * 1.01)))
        f.append(tuple(range(c, c + 6)))
    return mesh_object(name, v, f, mat, 0.0, smooth=True)


def blob(name, size, loc=(0, 0, 0), rot=(0, 0, 0), mat=None, cuboid=0.3, levels=2):
    """Rounded organic-industrial volume (padding, helmet, glove): UV-sphere cast toward a cuboid + subdivision."""
    obj = capsule(name, 0.5, 1.0, mat=mat, verts=32)
    obj.scale = size
    cast = obj.modifiers.new("Cast", "CAST")
    cast.cast_type = "CUBOID"
    cast.factor = cuboid
    sub = obj.modifiers.new("Subsurf", "SUBSURF")
    sub.levels = sub.render_levels = 1 if game() else levels
    obj.location = loc
    obj.rotation_euler = rot
    return obj


def capsule(name, radius, length, loc=(0, 0, 0), rot=(0, 0, 0), mat=None, scale=(1, 1, 1), verts=32):
    """Capsule along local Z (total length incl. caps)."""
    rings = 8 if game() else 12
    if game():
        verts = max(12, verts // 2)
    v, f = [], []
    half = max(length / 2 - radius, 0.0)
    pts = []
    for i in range(rings + 1):
        t = math.pi * i / rings  # 0..pi
        z = -math.cos(t) * radius + (-half if i <= rings // 2 else half)
        r = math.sin(t) * radius
        pts.append((z, r))
        if i == rings // 2 and half > 1e-6:
            pts.append((half, radius))
    for z, r in pts:
        for j in range(verts):
            a = 2 * math.pi * j / verts
            v.append((r * math.cos(a), r * math.sin(a), z))
    n = len(pts)
    for i in range(n - 1):
        for j in range(verts):
            k = (j + 1) % verts
            f.append((i * verts + j, i * verts + k, (i + 1) * verts + k, (i + 1) * verts + j))
    obj = mesh_object(name, v, f, mat, 0.0, smooth=True)
    for m in list(obj.modifiers):
        obj.modifiers.remove(m)
    obj.scale = scale
    obj.location = loc
    obj.rotation_euler = rot
    return obj


def bolt_ring(name, radius, count, head_r, head_h, mat, loc=(0, 0, 0), rot=(0, 0, 0)):
    """Hex-bolt heads on a circle in the local XY plane, facing +Z. Single object."""
    v, f = [], []
    for i in range(count):
        a = 2 * math.pi * i / count
        cx, cy = radius * math.cos(a), radius * math.sin(a)
        base = len(v)
        for z in (0.0, head_h):
            for k in range(6):
                b = 2 * math.pi * k / 6 + a
                v.append((cx + head_r * math.cos(b), cy + head_r * math.sin(b), z))
        for k in range(6):
            kk = (k + 1) % 6
            f.append((base + k, base + kk, base + 6 + kk, base + 6 + k))
        f.append(tuple(base + 6 + k for k in range(6)))
        f.append(tuple(base + k for k in reversed(range(6))))
    obj = mesh_object(name, v, f, mat, bevel=head_h * 0.25, segments=1, smooth=False)
    obj.location = loc
    obj.rotation_euler = rot
    return obj


def fins(name, count, size, pitch, axis, loc, rot=(0, 0, 0), mat=None):
    """Array of thin plates (cooling fins / vents) along local axis 0/1/2."""
    objs = []
    for i in range(count):
        off = [0.0, 0.0, 0.0]
        off[axis] = (i - (count - 1) / 2) * pitch
        objs.append(box(f"{name}_{i}", size, off, mat=mat, bevel=min(size) * 0.3, segments=1))
    obj = join(objs, name)
    obj.location = loc
    obj.rotation_euler = rot
    return obj


def actuator(name, radius, width, mat_housing, mat_cap, mat_bolt, loc=(0, 0, 0), rot=(0, 0, 0), bolts=10):
    """Rotary actuator: finned housing, machined end caps, bolt circle. Axis = local Z."""
    parts = [cylinder(f"{name}_h", radius, width * 0.78, mat=mat_housing, bevel=radius * 0.06, verts=64)]
    for s in (-1, 1):
        parts.append(cylinder(f"{name}_c{s}", radius * 0.86, width * 0.11, (0, 0, s * width * 0.44), mat=mat_cap,
                              bevel=radius * 0.05, verts=64, radius_top=radius * 0.78 if s > 0 else radius * 0.86))
        parts.append(cylinder(f"{name}_hub{s}", radius * 0.32, width * 0.06, (0, 0, s * width * 0.52), mat=mat_housing,
                              bevel=radius * 0.03, verts=32))
        bolts_obj = bolt_ring(f"{name}_b{s}", radius * 0.62, bolts, radius * 0.06, radius * 0.05, mat_bolt,
                              loc=(0, 0, s * width * 0.495), rot=(0 if s > 0 else math.pi, 0, 0))
        parts.append(bolts_obj)
    for k in (-1, 1):  # two machined steps on the housing (no spring-like grooves)
        parts.append(tube(f"{name}_g{k}", radius * 1.01, radius * 0.025, width * 0.05, (0, 0, k * width * 0.3),
                          mat=mat_cap, verts=64, bevel=radius * 0.008))
    obj = join(parts, name)
    obj.location = loc
    obj.rotation_euler = rot
    return obj


def cable(name, points: Sequence[Sequence[float]], radius, mat, resolution=8):
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = radius
    cu.bevel_resolution = 4
    cu.resolution_u = resolution
    sp = cu.splines.new("BEZIER")
    sp.bezier_points.add(len(points) - 1)
    for bp, p in zip(sp.bezier_points, points):
        bp.co = p
        bp.handle_left_type = bp.handle_right_type = "AUTO"
    cu.use_fill_caps = True
    obj = _link(bpy.data.objects.new(name, cu))
    obj.data.materials.append(mat)
    return obj


def text_mesh(name, body, size, mat, loc=(0, 0, 0), rot=(0, 0, 0), extrude=0.0005, font_bold=True, align="CENTER",
              wrap=None, wrap_offset=0.0007):
    """Text decal. wrap=<mesh object>: shrink-wrapped onto that surface so it follows curved armour."""
    cu = bpy.data.curves.new(name, "FONT")
    cu.body = body
    cu.size = size
    cu.extrude = extrude
    cu.align_x = align
    cu.align_y = "CENTER"
    try:
        cu.font = bpy.data.fonts.load("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if font_bold else
                                      "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", check_existing=True)
    except RuntimeError:
        pass
    obj = _link(bpy.data.objects.new(name, cu))
    obj.data.materials.append(mat)
    obj.location = loc
    obj.rotation_euler = rot
    if wrap is not None:
        cu.resolution_u = 6
        sw = obj.modifiers.new("Shrinkwrap", "SHRINKWRAP")
        sw.target = wrap
        sw.wrap_method = "NEAREST_SURFACEPOINT"
        sw.wrap_mode = "OUTSIDE_SURFACE"
        sw.offset = wrap_offset
    return obj


def apply_all(obj) -> bpy.types.Object:
    """Convert curves/text and apply modifiers -> plain mesh (needed before joining/skinning)."""
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    new = bpy.data.objects.new(obj.name, me)
    new.matrix_world = obj.matrix_world.copy()
    for col in obj.users_collection:
        col.objects.link(new)
    bpy.data.objects.remove(obj, do_unlink=True)
    return new


def join(objs: Iterable[bpy.types.Object], name: str) -> bpy.types.Object:
    """Bake each object's modifiers + transform and merge into one mesh object (materials kept per face)."""
    import bmesh

    objs = list(objs)
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    bm = bmesh.new()
    mats: list = []
    for o in objs:
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        me.transform(o.matrix_world)
        remap = []
        for m in me.materials:
            m = m.original if m is not None else None  # evaluated copies must never leak into original data
            if m not in mats:
                mats.append(m)
            remap.append(mats.index(m))
        offset = len(bm.faces)
        bm.from_mesh(me)
        bm.faces.ensure_lookup_table()
        for face in bm.faces[offset:]:
            if remap:
                face.material_index = remap[face.material_index] if face.material_index < len(remap) else remap[0]
        ev.to_mesh_clear()
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    for o in objs:
        bpy.data.objects.remove(o, do_unlink=True)
    return _link(bpy.data.objects.new(name, me))


def frame_matrix(head: Vector, tail: Vector, forward: Vector = Vector((1, 0, 0))) -> Matrix:
    """World matrix whose local Z runs head->tail and local X is as close to `forward` as possible."""
    z = (tail - head).normalized()
    x = forward - z * forward.dot(z)
    if x.length < 1e-4:
        x = Vector((0, 0, 1)) - z * z.z
    x.normalize()
    y = z.cross(x)
    m = Matrix((x, y, z)).transposed().to_4x4()
    m.translation = head
    return m


# ------------------------------------------------------------------------------------------------------------ materials


def _nodes(mat):
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return nt, bsdf


def _noise(nt, scale, detail=6.0, rough=0.6, coord="Object", stretch=(1, 1, 1)):
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = stretch
    nt.links.new(tc.outputs[coord], mp.inputs["Vector"])
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = scale
    nz.inputs["Detail"].default_value = detail
    nz.inputs["Roughness"].default_value = rough
    nt.links.new(mp.outputs["Vector"], nz.inputs["Vector"])
    return nz


def _maprange(nt, socket, a, b, c=0.0, d=1.0):
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = a
    mr.inputs["From Max"].default_value = b
    mr.inputs["To Min"].default_value = c
    mr.inputs["To Max"].default_value = d
    nt.links.new(socket, mr.inputs["Value"])
    return mr.outputs["Result"]


def _math(nt, op, a, b=None):
    m = nt.nodes.new("ShaderNodeMath")
    m.operation = op
    for i, val in enumerate((a, b)):
        if val is None:
            continue
        if isinstance(val, (int, float)):
            m.inputs[i].default_value = val
        else:
            nt.links.new(val, m.inputs[i])
    return m.outputs[0]


def _mix_rgb(nt, fac, a, b):
    mx = nt.nodes.new("ShaderNodeMix")
    mx.data_type = "RGBA"
    for sock, val in ((mx.inputs[0], fac),):
        if isinstance(val, (int, float)):
            sock.default_value = val
        else:
            nt.links.new(val, sock)
    for sock, val in ((mx.inputs[6], a), (mx.inputs[7], b)):
        if isinstance(val, tuple):
            sock.default_value = (*val[:3], 1.0)
        else:
            nt.links.new(val, sock)
    return mx.outputs[2]


def _edge_mask(nt, radius=0.004, sharp=0.06):
    """1 on convex edges, 0 on flats (Cycles Bevel node; bakeable)."""
    bev = nt.nodes.new("ShaderNodeBevel")
    bev.samples = 8
    bev.inputs["Radius"].default_value = radius
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    dot = nt.nodes.new("ShaderNodeVectorMath")
    dot.operation = "DOT_PRODUCT"
    nt.links.new(bev.outputs["Normal"], dot.inputs[0])
    nt.links.new(geo.outputs["Normal"], dot.inputs[1])
    return _maprange(nt, dot.outputs["Value"], 1.0, 1.0 - sharp)


def _cavity(nt, distance=0.03):
    ao = nt.nodes.new("ShaderNodeAmbientOcclusion")
    ao.samples = 8
    ao.inputs["Distance"].default_value = distance
    return _maprange(nt, ao.outputs["AO"], 0.35, 0.95)  # 0 in crevices -> 1 open


def _bump(nt, bsdf, height_socket, strength=0.15, distance=0.002, target="Normal"):
    bp = nt.nodes.new("ShaderNodeBump")
    bp.inputs["Strength"].default_value = strength
    bp.inputs["Distance"].default_value = distance
    nt.links.new(height_socket, bp.inputs["Height"])
    nt.links.new(bp.outputs["Normal"], bsdf.inputs[target])
    return bp


def _scratches(nt, scale=1.0, density=0.5):
    """Thin random scratches in two directions, clustered (object space, metres). Returns a 0..1 mask socket."""
    masks = []
    for k, (rot, sc) in enumerate((((0.3, 0.9, 0.2), (2.2, 2.2, 70.0)), ((1.1, -0.4, 1.3), (2.6, 60.0, 2.6)),
                                      ((-0.7, 0.2, 2.1), (55.0, 2.4, 2.4)))):
        tc = nt.nodes.new("ShaderNodeTexCoord")
        mp = nt.nodes.new("ShaderNodeMapping")
        mp.inputs["Rotation"].default_value = rot
        mp.inputs["Scale"].default_value = tuple(v * scale for v in sc)
        mp.inputs["Location"].default_value = (k * 3.7, k * 1.3, k * 2.1)
        nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
        nz = nt.nodes.new("ShaderNodeTexNoise")
        nz.inputs["Scale"].default_value = 1.0
        nz.inputs["Detail"].default_value = 3.0
        nz.inputs["Roughness"].default_value = 0.4
        nz.inputs["Distortion"].default_value = 0.35  # meandering, not ruler-straight
        nt.links.new(mp.outputs["Vector"], nz.inputs["Vector"])
        line = _maprange(nt, nz.outputs["Fac"], 0.63 - 0.05 * density, 0.665 - 0.05 * density)
        breaker = _noise(nt, 22.0 * scale, 2.0, 0.5)  # chop lines into short strokes of varying length
        masks.append(_math(nt, "MULTIPLY", line, _maprange(nt, breaker.outputs["Fac"], 0.5, 0.58)))
    m = _math(nt, "MAXIMUM", _math(nt, "MAXIMUM", masks[0], masks[1]), masks[2])
    cluster = _noise(nt, 4.0 * scale, 3.0, 0.5)
    return _math(nt, "MULTIPLY", m, _maprange(nt, cluster.outputs["Fac"], 0.38, 0.56))


def _dust(nt, amount=0.3):
    """Dust settles on upward-facing surfaces, broken up by noise. 0..1 mask."""
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(geo.outputs["Normal"], sep.inputs[0])
    up = _maprange(nt, sep.outputs[2], 0.35, 0.95)
    nz = _noise(nt, 9.0, 6.0, 0.65)
    return _math(nt, "MULTIPLY", _math(nt, "MULTIPLY", up, _maprange(nt, nz.outputs["Fac"], 0.4, 0.7)), amount)


_MATS: dict = {}


def mat_painted(name, color, wear=0.55, rough=0.34, coat=0.45, metal_under=(0.55, 0.56, 0.58)):
    """Painted metal/composite shell with clear coat, edge chipping to bare metal and cavity grime."""
    if name in _MATS:
        return _MATS[name]
    mat = bpy.data.materials.new(name)
    nt, bsdf = _nodes(mat)
    edge = _edge_mask(nt, 0.006, 0.08)
    chips = _noise(nt, 38.0, 8.0, 0.7)
    chip_mask = _math(nt, "MULTIPLY", edge, _maprange(nt, chips.outputs["Fac"], 0.48, 0.62))
    chip_mask = _math(nt, "MULTIPLY", chip_mask, wear * 1.6)
    chip_mask = _math(nt, "MINIMUM", chip_mask, 1.0)
    big = _noise(nt, 3.0, 4.0, 0.5)
    tint = _maprange(nt, big.outputs["Fac"], 0.3, 0.7, 0.86, 1.03)
    paint = nt.nodes.new("ShaderNodeMix")
    paint.data_type = "RGBA"
    paint.blend_type = "MULTIPLY"
    paint.inputs[0].default_value = 1.0
    paint.inputs[6].default_value = (*color, 1.0)
    comb = nt.nodes.new("ShaderNodeCombineColor")
    for i in range(3):
        nt.links.new(tint, comb.inputs[i])
    nt.links.new(comb.outputs[0], paint.inputs[7])
    cav = _cavity(nt, 0.04)
    grime = _mix_rgb(nt, _math(nt, "MULTIPLY", _math(nt, "SUBTRACT", 1.0, cav), 1.4), paint.outputs[2],
                     tuple(c * 0.22 for c in color))
    scr = _math(nt, "MULTIPLY", _scratches(nt, 1.0, wear), 0.35 + wear)
    chip_mask = _math(nt, "MINIMUM", _math(nt, "MAXIMUM", chip_mask, scr), 1.0)
    dust = _dust(nt, 0.22 + 0.2 * wear)
    grime = _mix_rgb(nt, dust, grime, (0.30, 0.28, 0.25))
    smudge_n = _noise(nt, 5.0, 8.0, 0.7)
    smudge = _math(nt, "MULTIPLY", _maprange(nt, smudge_n.outputs["Fac"], 0.56, 0.72), 0.25 + 0.4 * wear)
    grime = _mix_rgb(nt, smudge, grime, (0.07, 0.065, 0.06))  # grease / hand-off marks
    base = _mix_rgb(nt, chip_mask, grime, metal_under)
    nt.links.new(base, bsdf.inputs["Base Color"])
    nt.links.new(chip_mask, bsdf.inputs["Metallic"])
    rn = _noise(nt, 12.0, 6.0, 0.6)
    r = _maprange(nt, rn.outputs["Fac"], 0.3, 0.7, rough - 0.06, rough + 0.08)
    r = _math(nt, "ADD", r, _math(nt, "MULTIPLY", chip_mask, 0.12))
    r = _math(nt, "ADD", r, _math(nt, "MULTIPLY", _math(nt, "SUBTRACT", 1.0, cav), 0.25))
    r = _math(nt, "ADD", r, _math(nt, "MULTIPLY", dust, 0.4))
    nt.links.new(r, bsdf.inputs["Roughness"])
    nt.links.new(_math(nt, "MULTIPLY", _math(nt, "SUBTRACT", 1.0, chip_mask), coat), bsdf.inputs["Coat Weight"])
    bsdf.inputs["Coat Roughness"].default_value = 0.12
    fine = _noise(nt, 220.0, 4.0, 0.5)
    h = _math(nt, "SUBTRACT", _math(nt, "MULTIPLY", fine.outputs["Fac"], 0.25), scr)
    _bump(nt, bsdf, h, 0.12, 0.0006)
    _MATS[name] = mat
    return mat


def mat_metal(name, color=(0.60, 0.61, 0.63), rough=0.32, aniso=0.6, brushed=True, grime=0.5):
    if name in _MATS:
        return _MATS[name]
    mat = bpy.data.materials.new(name)
    nt, bsdf = _nodes(mat)
    bsdf.inputs["Metallic"].default_value = 1.0
    cav = _cavity(nt, 0.03)
    col = _mix_rgb(nt, _math(nt, "MULTIPLY", _math(nt, "SUBTRACT", 1.0, cav), grime), color,
                   tuple(c * 0.25 for c in color))
    nt.links.new(col, bsdf.inputs["Base Color"])
    streak = _noise(nt, 6.0, 10.0, 0.75, stretch=(1, 1, 60) if brushed else (1, 1, 1))
    r = _maprange(nt, streak.outputs["Fac"], 0.25, 0.75, rough - 0.08, rough + 0.10)
    nt.links.new(r, bsdf.inputs["Roughness"])
    bsdf.inputs["Anisotropic"].default_value = aniso if brushed else 0.0
    edge = _edge_mask(nt, 0.003, 0.08)
    scr = _scratches(nt, 1.3, 0.7)
    wearm = _math(nt, "MINIMUM", _math(nt, "ADD", _math(nt, "MULTIPLY", edge, 0.6), scr), 1.0)
    bright = _mix_rgb(nt, wearm, col, tuple(min(1.0, c * 1.45 + 0.08) for c in color))
    dust = _dust(nt, 0.25 * grime)
    nt.links.new(_mix_rgb(nt, dust, bright, (0.28, 0.26, 0.23)), bsdf.inputs["Base Color"])
    r2 = _math(nt, "SUBTRACT", r, _math(nt, "MULTIPLY", scr, 0.18))
    r2 = _math(nt, "ADD", r2, _math(nt, "MULTIPLY", dust, 0.4))
    nt.links.new(r2, bsdf.inputs["Roughness"])
    _bump(nt, bsdf, _math(nt, "MULTIPLY", scr, -1.0), 0.15, 0.0003)
    _MATS[name] = mat
    return mat


def mat_carbon(name="Carbon"):
    if name in _MATS:
        return _MATS[name]
    mat = bpy.data.materials.new(name)
    nt, bsdf = _nodes(mat)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (160, 160, 160)
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    chk = nt.nodes.new("ShaderNodeTexChecker")
    chk.inputs["Scale"].default_value = 1.0
    nt.links.new(mp.outputs["Vector"], chk.inputs["Vector"])
    wave = nt.nodes.new("ShaderNodeTexWave")
    wave.inputs["Scale"].default_value = 3.0
    wave.inputs["Distortion"].default_value = 0.5
    nt.links.new(mp.outputs["Vector"], wave.inputs["Vector"])
    shade = _maprange(nt, chk.outputs["Fac"], 0.0, 1.0, 0.018, 0.05)
    comb = nt.nodes.new("ShaderNodeCombineColor")
    for i in range(3):
        nt.links.new(shade, comb.inputs[i])
    nt.links.new(comb.outputs[0], bsdf.inputs["Base Color"])
    nt.links.new(_maprange(nt, chk.outputs["Fac"], 0, 1, 0.22, 0.38), bsdf.inputs["Roughness"])
    nt.links.new(_maprange(nt, chk.outputs["Fac"], 0, 1, 0.0, 0.25), bsdf.inputs["Anisotropic Rotation"])
    bsdf.inputs["Anisotropic"].default_value = 0.8
    bsdf.inputs["Coat Weight"].default_value = 1.0
    bsdf.inputs["Coat Roughness"].default_value = 0.06
    _bump(nt, bsdf, wave.outputs["Fac"], 0.08, 0.0003)
    _MATS[name] = mat
    return mat


def mat_rough(name, color, rough=0.8, bump_scale=0.0, bump=0.0, sheen=0.0, metallic=0.0, emission=None, strength=0.0,
              coat=0.0, spec=0.5):
    if name in _MATS:
        return _MATS[name]
    mat = bpy.data.materials.new(name)
    nt, bsdf = _nodes(mat)
    nz = _noise(nt, 9.0, 5.0, 0.55)
    tint = _maprange(nt, nz.outputs["Fac"], 0.3, 0.7, 0.9, 1.06)
    mul = nt.nodes.new("ShaderNodeMix")
    mul.data_type = "RGBA"
    mul.blend_type = "MULTIPLY"
    mul.inputs[0].default_value = 1.0
    mul.inputs[6].default_value = (*color, 1.0)
    comb = nt.nodes.new("ShaderNodeCombineColor")
    for i in range(3):
        nt.links.new(tint, comb.inputs[i])
    nt.links.new(comb.outputs[0], mul.inputs[7])
    nt.links.new(mul.outputs[2], bsdf.inputs["Base Color"])
    nt.links.new(_maprange(nt, nz.outputs["Fac"], 0.3, 0.7, rough - 0.07, rough + 0.07), bsdf.inputs["Roughness"])
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Sheen Weight"].default_value = sheen
    bsdf.inputs["Coat Weight"].default_value = coat
    bsdf.inputs["Specular IOR Level"].default_value = spec
    if bump_scale > 0:
        vor = nt.nodes.new("ShaderNodeTexVoronoi")
        vor.inputs["Scale"].default_value = bump_scale
        tc = nt.nodes.new("ShaderNodeTexCoord")
        nt.links.new(tc.outputs["Object"], vor.inputs["Vector"])
        _bump(nt, bsdf, vor.outputs["Distance"], bump, 0.001)
    if emission is not None:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = strength
    _MATS[name] = mat
    return mat


def mat_glass_dark(name="VisorGlass"):
    if name in _MATS:
        return _MATS[name]
    mat = bpy.data.materials.new(name)
    nt, bsdf = _nodes(mat)
    bsdf.inputs["Base Color"].default_value = (0.004, 0.005, 0.006, 1)
    bsdf.inputs["Roughness"].default_value = 0.04
    bsdf.inputs["Coat Weight"].default_value = 1.0
    bsdf.inputs["Coat Roughness"].default_value = 0.02
    bsdf.inputs["Specular IOR Level"].default_value = 0.8
    smudge = _noise(nt, 14.0, 6.0, 0.7)
    nt.links.new(_maprange(nt, smudge.outputs["Fac"], 0.45, 0.75, 0.02, 0.18), bsdf.inputs["Coat Roughness"])
    _MATS[name] = mat
    return mat


def mat_emissive(name, color, strength):
    if name in _MATS:
        return _MATS[name]
    mat = bpy.data.materials.new(name)
    nt, bsdf = _nodes(mat)
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Emission Color"].default_value = (*color, 1)
    bsdf.inputs["Emission Strength"].default_value = strength
    bsdf.inputs["Roughness"].default_value = 0.3
    _MATS[name] = mat
    return mat


def mat_leather(name, color, rough=0.42):
    """Boxing-glove leather: grain bump, slightly glossy, darker in folds."""
    if name in _MATS:
        return _MATS[name]
    mat = bpy.data.materials.new(name)
    nt, bsdf = _nodes(mat)
    cav = _cavity(nt, 0.03)
    edge = _edge_mask(nt, 0.01, 0.1)
    nz = _noise(nt, 6.0, 6.0, 0.5)
    tint = _maprange(nt, nz.outputs["Fac"], 0.3, 0.7, 0.88, 1.08)
    base = nt.nodes.new("ShaderNodeMix")
    base.data_type = "RGBA"
    base.blend_type = "MULTIPLY"
    base.inputs[0].default_value = 1.0
    base.inputs[6].default_value = (*color, 1.0)
    comb = nt.nodes.new("ShaderNodeCombineColor")
    for i in range(3):
        nt.links.new(tint, comb.inputs[i])
    nt.links.new(comb.outputs[0], base.inputs[7])
    dark = _mix_rgb(nt, _math(nt, "SUBTRACT", 1.0, cav), base.outputs[2], tuple(c * 0.4 for c in color))
    scuff = _math(nt, "MAXIMUM", _math(nt, "MULTIPLY", edge, 0.35), _math(nt, "MULTIPLY", _scratches(nt, 0.8, 0.9), 0.7))
    worn = _mix_rgb(nt, scuff, dark, tuple(min(1, c * 1.6 + 0.07) for c in color))
    nt.links.new(worn, bsdf.inputs["Base Color"])
    nt.links.new(_maprange(nt, nz.outputs["Fac"], 0.3, 0.7, rough - 0.08, rough + 0.1), bsdf.inputs["Roughness"])
    bsdf.inputs["Sheen Weight"].default_value = 0.15
    bsdf.inputs["Coat Weight"].default_value = 0.25
    bsdf.inputs["Coat Roughness"].default_value = 0.25
    vor = nt.nodes.new("ShaderNodeTexVoronoi")
    vor.inputs["Scale"].default_value = 420.0
    tc = nt.nodes.new("ShaderNodeTexCoord")
    nt.links.new(tc.outputs["Object"], vor.inputs["Vector"])
    _bump(nt, bsdf, vor.outputs["Distance"], 0.12, 0.0006)
    _MATS[name] = mat
    return mat


def mat_concrete(name, paint=None, paint_height=1.8, floor_z=-1.0, wet=0.0, base=(0.30, 0.29, 0.27)):
    """Worn industrial concrete. paint=(r,g,b) adds a lower painted band (below paint_height above floor_z) that
    peels off in patches; water streaks run down from the top, grime collects at the floor, hairline cracks.
    wet>0 gives glossy damp/oily patches (floors)."""
    if name in _MATS:
        return _MATS[name]
    mat = bpy.data.materials.new(name)
    nt, bsdf = _nodes(mat)
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(geo.outputs["Position"], sep.inputs[0])
    z = sep.outputs[2]
    big = _noise(nt, 0.6, 5.0, 0.6)
    mid = _noise(nt, 4.0, 8.0, 0.65)
    pores = _noise(nt, 160.0, 4.0, 0.6)
    tone = _math(nt, "MULTIPLY", _maprange(nt, big.outputs["Fac"], 0.3, 0.7, 0.75, 1.15),
                 _maprange(nt, mid.outputs["Fac"], 0.3, 0.7, 0.85, 1.08))
    comb = nt.nodes.new("ShaderNodeCombineColor")
    for i in range(3):
        nt.links.new(tone, comb.inputs[i])
    col = nt.nodes.new("ShaderNodeMix")
    col.data_type = "RGBA"
    col.blend_type = "MULTIPLY"
    col.inputs[0].default_value = 1.0
    col.inputs[6].default_value = (*base, 1)
    nt.links.new(comb.outputs[0], col.inputs[7])
    c = col.outputs[2]
    rough = _maprange(nt, mid.outputs["Fac"], 0.3, 0.7, 0.78, 0.95)
    height = _math(nt, "MULTIPLY", pores.outputs["Fac"], 0.3)
    if paint is not None:
        band = _maprange(nt, z, floor_z + paint_height + 0.02, floor_z + paint_height - 0.02)
        peel_n = _noise(nt, 2.5, 10.0, 0.7)
        peel = _maprange(nt, peel_n.outputs["Fac"], 0.56, 0.585)  # 1 = paint gone
        keep = _math(nt, "MULTIPLY", band, _math(nt, "SUBTRACT", 1.0, peel))
        ptone = _maprange(nt, big.outputs["Fac"], 0.3, 0.7, 0.8, 1.05)
        pc = nt.nodes.new("ShaderNodeCombineColor")
        for i, v in enumerate(paint):
            nt.links.new(_math(nt, "MULTIPLY", ptone, v), pc.inputs[i])
        c = _mix_rgb(nt, keep, c, pc.outputs[0])
        rough = _mix_rgb(nt, keep, rough, (0.45, 0.45, 0.45))
        edge_lip = _maprange(nt, peel_n.outputs["Fac"], 0.54, 0.56)  # raised paint edge around peeled holes
        height = _math(nt, "ADD", height, _math(nt, "MULTIPLY", _math(nt, "ADD", keep, edge_lip), 0.6))
    # water streaks from above (vary fast across, slow down the wall) and grime at the floor
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (7.0, 7.0, 0.25)
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    st = nt.nodes.new("ShaderNodeTexNoise")
    st.inputs["Scale"].default_value = 1.0
    st.inputs["Detail"].default_value = 6.0
    nt.links.new(mp.outputs["Vector"], st.inputs["Vector"])
    streak = _maprange(nt, st.outputs["Fac"], 0.5, 0.68, 0.0, 0.8)
    floor_grime = _maprange(nt, z, floor_z + 0.9, floor_z, 0.0, 0.7)
    dirt = _math(nt, "MINIMUM", _math(nt, "ADD", streak, floor_grime), 0.85)
    c = _mix_rgb(nt, dirt, c, (0.06, 0.055, 0.05))
    # hairline cracks
    vor = nt.nodes.new("ShaderNodeTexVoronoi")
    vor.feature = "DISTANCE_TO_EDGE"
    vor.inputs["Scale"].default_value = 1.6
    vor.inputs["Randomness"].default_value = 1.0
    tc2 = nt.nodes.new("ShaderNodeTexCoord")
    warp = _noise(nt, 3.0, 4.0, 0.5)
    add = nt.nodes.new("ShaderNodeVectorMath")
    add.operation = "ADD"
    nt.links.new(tc2.outputs["Object"], add.inputs[0])
    sc = nt.nodes.new("ShaderNodeVectorMath")
    sc.operation = "SCALE"
    sc.inputs["Scale"].default_value = 0.15
    nt.links.new(warp.outputs["Color"], sc.inputs[0])
    nt.links.new(sc.outputs[0], add.inputs[1])
    nt.links.new(add.outputs[0], vor.inputs["Vector"])
    crack_mask = _noise(nt, 1.1, 2.0, 0.5)
    crack = _math(nt, "MULTIPLY", _maprange(nt, vor.outputs["Distance"], 0.012, 0.0),
                  _maprange(nt, crack_mask.outputs["Fac"], 0.5, 0.62))
    c = _mix_rgb(nt, crack, c, (0.02, 0.02, 0.02))
    height = _math(nt, "SUBTRACT", height, _math(nt, "MULTIPLY", crack, 1.2))
    if wet > 0:
        wn = _noise(nt, 0.9, 4.0, 0.5)
        wetm = _math(nt, "MULTIPLY", _maprange(nt, wn.outputs["Fac"], 0.52, 0.62), wet)
        rough = _mix_rgb(nt, wetm, rough, (0.12, 0.12, 0.12))
        c = _mix_rgb(nt, _math(nt, "MULTIPLY", wetm, 0.5), c, (0.02, 0.02, 0.022))
    nt.links.new(c, bsdf.inputs["Base Color"])
    nt.links.new(rough, bsdf.inputs["Roughness"])
    _bump(nt, bsdf, height, 0.35, 0.004)
    _MATS[name] = mat
    return mat


def mat_rusty_steel(name, paint=(0.03, 0.03, 0.035)):
    """Painted steel with scratches to bright metal and rust blooming from the bottom and from scratches."""
    if name in _MATS:
        return _MATS[name]
    mat = bpy.data.materials.new(name)
    nt, bsdf = _nodes(mat)
    scr = _scratches(nt, 0.7, 1.0)
    edge = _edge_mask(nt, 0.006, 0.1)
    rn = _noise(nt, 6.0, 10.0, 0.7)
    rust = _math(nt, "MULTIPLY", _maprange(nt, rn.outputs["Fac"], 0.5, 0.7),
                 _math(nt, "ADD", 0.25, _math(nt, "MAXIMUM", edge, scr)))
    rust = _math(nt, "MINIMUM", rust, 1.0)
    bare = _math(nt, "MINIMUM", _math(nt, "ADD", scr, _math(nt, "MULTIPLY", edge, 0.5)), 1.0)
    c = _mix_rgb(nt, bare, paint, (0.45, 0.45, 0.46))
    c = _mix_rgb(nt, rust, c, (0.22, 0.08, 0.03))
    nt.links.new(c, bsdf.inputs["Base Color"])
    nt.links.new(_math(nt, "MULTIPLY", bare, _math(nt, "SUBTRACT", 1.0, rust)), bsdf.inputs["Metallic"])
    nt.links.new(_math(nt, "ADD", 0.4, _math(nt, "MULTIPLY", rust, 0.5)), bsdf.inputs["Roughness"])
    _bump(nt, bsdf, _math(nt, "SUBTRACT", rust, scr), 0.25, 0.0008)
    _MATS[name] = mat
    return mat


def mat_cloth(name, color, rough=0.85, scale=900.0):
    if name in _MATS:
        return _MATS[name]
    mat = bpy.data.materials.new(name)
    nt, bsdf = _nodes(mat)
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Sheen Weight"].default_value = 0.4
    tc = nt.nodes.new("ShaderNodeTexCoord")
    w1 = nt.nodes.new("ShaderNodeTexWave")
    w1.inputs["Scale"].default_value = scale
    nt.links.new(tc.outputs["Object"], w1.inputs["Vector"])
    _bump(nt, bsdf, w1.outputs["Fac"], 0.12, 0.0004)
    _MATS[name] = mat
    return mat


# -------------------------------------------------------------------------------------------------------------- render


def setup_render(width=1920, height=1080, samples=192, look="AgX - Punchy", exposure=0.0, fast=False):
    s = bpy.context.scene
    s.render.engine = "CYCLES"
    s.cycles.device = "CPU"
    s.cycles.samples = 48 if fast else samples
    s.cycles.use_adaptive_sampling = True
    s.cycles.adaptive_threshold = 0.02
    s.cycles.use_denoising = True
    s.cycles.denoiser = "OPENIMAGEDENOISE"
    s.cycles.max_bounces = 8
    s.cycles.glossy_bounces = 4
    s.cycles.transmission_bounces = 4
    s.cycles.volume_bounces = 1
    s.cycles.caustics_reflective = False
    s.cycles.caustics_refractive = False
    s.cycles.blur_glossy = 1.0
    s.render.resolution_x = width
    s.render.resolution_y = height
    s.render.resolution_percentage = 50 if fast else 100
    s.view_settings.view_transform = "AgX"
    try:
        s.view_settings.look = look
    except TypeError:
        pass
    s.view_settings.exposure = exposure
    s.render.image_settings.file_format = "PNG"
    s.render.image_settings.color_depth = "8"
    s.render.film_transparent = False


def add_compositor_glare(strength=0.35, vignette=0.25):
    s = bpy.context.scene
    s.use_nodes = True
    nt = s.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    rl = nt.nodes.new("CompositorNodeRLayers")
    comp = nt.nodes.new("CompositorNodeComposite")
    glare = nt.nodes.new("CompositorNodeGlare")
    glare.glare_type = "FOG_GLOW"
    glare.quality = "HIGH"
    glare.mix = -1.0 + strength
    glare.threshold = 1.2
    glare.size = 8
    lens = nt.nodes.new("CompositorNodeLensdist")
    lens.inputs["Distortion"].default_value = -0.008
    lens.inputs["Dispersion"].default_value = 0.012
    nt.links.new(rl.outputs["Image"], glare.inputs["Image"])
    nt.links.new(glare.outputs["Image"], lens.inputs["Image"])
    last = lens.outputs["Image"]
    if vignette > 0:
        mask = nt.nodes.new("CompositorNodeEllipseMask")
        mask.width = 1.1
        mask.height = 1.1
        blur = nt.nodes.new("CompositorNodeBlur")
        blur.size_x = 300
        blur.size_y = 300
        blur.use_relative = False
        nt.links.new(mask.outputs["Mask"], blur.inputs["Image"])
        mix = nt.nodes.new("CompositorNodeMixRGB")
        mix.blend_type = "MULTIPLY"
        mix.inputs["Fac"].default_value = vignette
        nt.links.new(last, mix.inputs[1])
        nt.links.new(blur.outputs["Image"], mix.inputs[2])
        last = mix.outputs["Image"]
    nt.links.new(last, comp.inputs["Image"])


def camera(name, loc, target, lens=35.0, fstop=None, focus=None) -> bpy.types.Object:
    cam = bpy.data.cameras.new(name)
    cam.lens = lens
    cam.sensor_width = 36.0
    obj = _link(bpy.data.objects.new(name, cam))
    obj.location = loc
    direction = Vector(target) - Vector(loc)
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    if fstop:
        cam.dof.use_dof = True
        cam.dof.aperture_fstop = fstop
        cam.dof.focus_distance = focus if focus else direction.length
    bpy.context.scene.camera = obj
    return obj


def area_light(name, loc, target, energy, size=1.0, color=(1, 1, 1), shape="RECTANGLE", size_y=None, spread=180.0):
    li = bpy.data.lights.new(name, "AREA")
    li.energy = energy
    li.color = color
    li.shape = shape
    li.size = size
    li.size_y = size_y if size_y else size
    li.spread = math.radians(spread)
    obj = _link(bpy.data.objects.new(name, li))
    obj.location = loc
    obj.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    return obj


def spot_light(name, loc, target, energy, angle=25.0, blend=0.35, radius=0.08, color=(1, 1, 1)):
    li = bpy.data.lights.new(name, "SPOT")
    li.energy = energy
    li.color = color
    li.spot_size = math.radians(angle)
    li.spot_blend = blend
    li.shadow_soft_size = radius
    obj = _link(bpy.data.objects.new(name, li))
    obj.location = loc
    obj.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    return obj


def world(color=(0.01, 0.011, 0.013), strength=1.0, haze=0.0, haze_box=None):
    w = bpy.data.worlds.new("World")
    bpy.context.scene.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (*color, 1)
    bg.inputs["Strength"].default_value = strength
    if haze > 0 and haze_box:
        loc, size = haze_box
        obj = box("Haze", size, loc, bevel=0)
        for m in list(obj.modifiers):
            obj.modifiers.remove(m)
        mat = bpy.data.materials.new("Haze")
        mat.use_nodes = True
        nt = mat.node_tree
        for n in list(nt.nodes):
            nt.nodes.remove(n)
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        vol = nt.nodes.new("ShaderNodeVolumePrincipled")
        vol.inputs["Density"].default_value = haze
        vol.inputs["Anisotropy"].default_value = 0.55
        nt.links.new(vol.outputs[0], out.inputs["Volume"])
        obj.data.materials.append(mat)
        obj.visible_shadow = False
    return w
