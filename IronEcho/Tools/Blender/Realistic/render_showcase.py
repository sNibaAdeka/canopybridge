"""Showcase renders of the realistic IE-1 robots in the pro ring (Cycles).

    python render_showcase.py --shot game|hero|wide|forge|ember [--fast] --out path.png
(`pip install bpy==4.5.*` gives a headless Blender; inside Blender: blender -b -P render_showcase.py -- ...)
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
import ring as RG  # noqa: E402
import robot as RB  # noqa: E402

SHOTS = {
    # name: (camera, target, lens, fstop)
    "game": ((-2.55, -1.75, 2.1), (0.55, 0.2, 1.3), 30.0, 4.0),
    "hero": ((0.3, -2.55, 1.38), (0.0, 0.0, 1.42), 38.0, 2.8),
    "wide": ((-10.5, -8.5, 5.2), (0.0, 0.0, 0.9), 32.0, None),
    "forge": ((1.3, -1.75, 1.55), (-0.58, 0.0, 1.3), 55.0, 3.2),
    "ember": ((-1.3, 1.75, 1.55), (0.58, 0.0, 1.3), 55.0, 3.2),
}


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("--shots", default="game", help="comma list of " + ",".join(sorted(SHOTS)))
    ap.add_argument("--outdir", required=True)
    ap.add_argument("--tag", default="")
    ap.add_argument("--fast", action="store_true")
    ap.add_argument("--samples", type=int, default=160)
    ap.add_argument("--res", default="1920x1080")
    ap.add_argument("--player", default="jab", choices=sorted(RB.STANCES))
    ap.add_argument("--opponent", default="block", choices=sorted(RB.STANCES))
    args = ap.parse_args(argv)
    t0 = time.time()
    R.reset_scene()
    forge = RB.build_robot(RB.FORGE)  # robots first: fewer objects to re-evaluate on every join
    ember = RB.build_robot(RB.EMBER)
    RG.build_ring()
    RG.light_arena()
    forge.location = (-0.58, 0.0, 0.0)  # mid-exchange: closer than the 135 cm neutral distance
    ember.location = (0.58, 0.0, 0.0)
    ember.rotation_euler = (0, 0, math.pi)
    RB.pose(forge, **RB.STANCES[args.player])
    RB.pose(ember, **RB.STANCES[args.opponent])
    R.set_collection(bpy.context.scene.collection)
    rw, rh = (int(x) for x in args.res.split("x"))
    R.setup_render(rw, rh, args.samples, fast=args.fast, exposure=-0.15)
    bpy.context.scene.cycles.volume_step_rate = 4.0
    R.add_compositor_glare(0.3, 0.3)
    print(f"scene built in {time.time() - t0:.1f}s, objects={len(bpy.data.objects)}", flush=True)
    os.makedirs(args.outdir, exist_ok=True)
    for shot in args.shots.split(","):
        cam, target, lens, fstop = SHOTS[shot]
        old = bpy.data.objects.get("Camera")
        if old:
            bpy.data.objects.remove(old, do_unlink=True)
        R.camera("Camera", cam, target, lens=lens, fstop=fstop,
                 focus=(Vector(target) - Vector(cam)).length if fstop else None)
        out = os.path.join(os.path.abspath(args.outdir), f"{shot}{args.tag}.png")
        bpy.context.scene.render.filepath = out
        t1 = time.time()
        bpy.ops.render.render(write_still=True)
        print(f"{shot}: {time.time() - t1:.1f}s -> {out}", flush=True)


if __name__ == "__main__":
    main(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])
