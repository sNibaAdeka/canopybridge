"""Editor check of Codex's robot meshes against ROBOT_VISUAL_CONTRACT (read-only).

Inside the editor:   py "<abs>/Tools/Unreal/Tech/validate_robot.py"                (meshes from DA_IronEchoVisuals)
                     py "<abs>/Tools/Unreal/Tech/validate_robot.py" /Game/Art/Robots/SK_Robot
Headless: UnrealEditor-Cmd.exe <uproject> -run=pythonscript -script="<abs>/validate_robot.py /Game/..." -NullRHI -unattended
Writes Saved/Probe/robot_validation.json; log lines prefixed IRONECHO_ROBOT.
"""

import json
import os
import sys

import unreal

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import robot_contract as rc  # noqa: E402

VISUAL_CONFIG = "/Game/Art/Config/DA_IronEchoVisuals"


def log(message):
    unreal.log(f"IRONECHO_ROBOT {message}")


def collect_facts(mesh):
    facts = {"bones": [], "sockets": []}
    component = unreal.SkeletalMeshComponent()
    try:
        component.set_skeletal_mesh_asset(mesh)
    except Exception:  # noqa: BLE001 - older API name
        component.set_skeletal_mesh(mesh)
    try:
        facts["bones"] = [str(component.get_bone_name(i)) for i in range(component.get_num_bones())]
    except Exception as error:  # noqa: BLE001
        unreal.log_warning(f"IRONECHO_ROBOT bone list unavailable: {error}")
    for socket in rc.REQUIRED_SOCKETS + ("fx_core", "cam_focus"):
        try:
            if mesh.find_socket(socket) is not None:
                facts["sockets"].append(socket)
        except Exception:  # noqa: BLE001
            pass
    try:
        bounds = mesh.get_bounds()
        origin, extent = bounds.origin, bounds.box_extent
        facts["bounds_min"] = [origin.x - extent.x, origin.y - extent.y, origin.z - extent.z]
        facts["bounds_max"] = [origin.x + extent.x, origin.y + extent.y, origin.z + extent.z]
    except Exception as error:  # noqa: BLE001
        unreal.log_warning(f"IRONECHO_ROBOT bounds unavailable: {error}")

    def bone_cs(name):
        transform = component.get_socket_transform(name, unreal.RelativeTransformSpace.RTS_COMPONENT)
        return transform.translation

    try:
        ul, ur = bone_cs("upperarm_l"), bone_cs("upperarm_r")
        facts["shoulder_height"] = (ul.z + ur.z) / 2.0
        facts["torso_half_width"] = abs(ur.y - ul.y) / 2.0
        facts["head_height"] = bone_cs("head").z
        lower, hand = bone_cs("lowerarm_l"), bone_cs("hand_l")
        facts["arm_length"] = (ul - lower).length() + (lower - hand).length()
        facts["fist_l_y"] = bone_cs("fist_l").y if "fist_l" in facts["sockets"] else hand.y
        facts["fist_r_y"] = bone_cs("fist_r").y if "fist_r" in facts["sockets"] else bone_cs("hand_r").y
    except Exception as error:  # noqa: BLE001 - unregistered component may not expose poses on every version
        unreal.log_warning(f"IRONECHO_ROBOT bone positions unavailable: {error}")
    return facts


def meshes_to_check(argv):
    paths = [a for a in argv if a.startswith("/Game/")]
    if paths:
        return paths
    config = unreal.EditorAssetLibrary.load_asset(VISUAL_CONFIG)
    if config is None:
        log(f"{VISUAL_CONFIG} not found and no mesh path given")
        return []
    found = []
    for prop in ("player_robot_mesh", "opponent_robot_mesh"):
        soft = config.get_editor_property(prop)
        path = str(soft) if soft else ""
        if path and path != "None":
            found.append(path.split(".")[0])
    return sorted(set(found))


def main():
    results = {}
    all_ok = True
    for path in meshes_to_check(sys.argv[1:]):
        mesh = unreal.EditorAssetLibrary.load_asset(path)
        if mesh is None:
            log(f"cannot load {path}")
            all_ok = False
            continue
        findings = rc.check_robot(collect_facts(mesh))
        all_ok &= rc.is_ok(findings)
        results[path] = [f.__dict__ for f in findings]
        for line in rc.format_report(path, findings).splitlines():
            log(line)
    project = unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_dir())
    out = os.path.join(project, "Saved", "Probe", "robot_validation.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as handle:
        json.dump({"contract": rc.CONTRACT_VERSION, "ok": all_ok and bool(results), "meshes": results}, handle, indent=2)
    log(f"RESULT {'OK' if all_ok and results else 'FAIL'} -> {out}")


main()
