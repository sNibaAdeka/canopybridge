"""Quick studio preview of one robot while designing it (Cycles, CPU, about a minute).

    python preview_robot.py --livery Forge --out out_dir [--stance guard] [--views front,side,back] [--res 640x860]
"""

import argparse
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import rlib as R  # noqa: E402
import robot as RB  # noqa: E402

VIEWS = {
    # name: (camera position, target, lens)
    "front": ((2.75, -1.45, 1.30), (0.0, 0.0, 1.02), 50.0),
    "side": ((0.3, -3.1, 1.25), (0.0, 0.0, 1.02), 50.0),
    "back": ((-2.6, 1.7, 1.45), (0.0, 0.0, 1.02), 50.0),
    "bust": ((1.7, -0.75, 1.7), (0.02, 0.0, 1.55), 60.0),
    "game": ((-2.2, -2.6, 1.65), (0.5, 0.0, 1.05), 35.0),
}


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("--livery", default="Forge")
    ap.add_argument("--out", required=True)
    ap.add_argument("--stance", default="guard")
    ap.add_argument("--views", default="front,side")
    ap.add_argument("--res", default="640x860")
    ap.add_argument("--samples", type=int, default=40)
    ap.add_argument("--game", action="store_true", help="game-quality geometry (what the bake uses)")
    args = ap.parse_args(argv)
    t0 = time.time()
    R.reset_scene()
    if args.game:
        R.QUALITY["mode"] = "game"
    lv = {"Forge": RB.FORGE, "Ember": RB.EMBER}[args.livery]
    arm = RB.build_robot(lv)
    if args.stance != "rest":
        RB.pose(arm, **RB.STANCES[args.stance])
    R.set_collection(bpy.context.scene.collection)
    floor = R.box("floor", (14, 14, 0.1), (0, 0, -0.05), mat=R.mat_rough("Floor", (0.16, 0.16, 0.17), 0.55), bevel=0)
    R.area_light("key", (3.0, -3.2, 3.6), (0, 0, 1.2), 900, size=2.2, color=(1.0, 0.96, 0.9))
    R.area_light("fill", (2.5, 3.5, 1.8), (0, 0, 1.1), 260, size=3.0, color=(0.75, 0.85, 1.0))
    R.area_light("rim", (-3.5, 1.5, 3.0), (0, 0, 1.3), 1100, size=1.6, color=(0.8, 0.9, 1.0))
    R.area_light("top", (0, 0, 4.5), (0, 0, 1.0), 400, size=3.0)
    R.world(color=(0.02, 0.022, 0.026), strength=1.0)
    w, h = (int(x) for x in args.res.split("x"))
    R.setup_render(w, h, args.samples, exposure=0.0)
    tris = sum(len(p.vertices) - 2 for o in arm.children if o.type == "MESH" for p in o.data.polygons)
    print(f"built in {time.time() - t0:.1f}s, {tris} triangles", flush=True)
    os.makedirs(args.out, exist_ok=True)
    for view in args.views.split(","):
        cam, target, lens = VIEWS[view]
        old = bpy.data.objects.get("Camera")
        if old:
            bpy.data.objects.remove(old, do_unlink=True)
        R.camera("Camera", cam, target, lens=lens)
        bpy.context.scene.render.filepath = os.path.join(os.path.abspath(args.out), f"{args.livery}_{view}.png")
        t1 = time.time()
        bpy.ops.render.render(write_still=True)
        print(f"{view}: {time.time() - t1:.1f}s", flush=True)


if __name__ == "__main__":
    main(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])
