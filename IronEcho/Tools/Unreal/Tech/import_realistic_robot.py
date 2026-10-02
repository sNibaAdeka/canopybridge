"""Editor-only: import the realistic IE-1 robots (ArtSource/Realistic/Export/SK_IE1_*.fbx) into /Game/Tech/Realistic,
add contract sockets (fist_l, fist_r, hit_head, hit_body) and point a UIronEchoVisualConfig at them.

Run in the editor (PythonScriptPlugin):
    UnrealEditor-Cmd.exe IronEcho.uproject -run=pythonscript -script=Tools/Unreal/Tech/import_realistic_robot.py
then Tools/Unreal/Tech/validate_robot.py. NOT RUN YET: written in the cloud without Unreal; expect API fixes on first run.
Editor operations only — never used at game runtime.
"""

import os

import unreal

PROJECT = unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_dir())
SRC = os.path.join(PROJECT, "ArtSource", "Realistic", "Export")
DEST = "/Game/Tech/Realistic"
LIVERIES = ("Forge", "Ember")

# socket: (bone, relative location cm) — fist offsets come from the fist_tip_* bones exported with the mesh
SOCKETS = {
    "hit_head": ("head", unreal.Vector(0.0, 0.0, 11.0)),
    "hit_body": ("spine_03", unreal.Vector(0.0, 0.0, 8.0)),
}


def log(msg):
    unreal.log(f"IRONECHO_IMPORT {msg}")


def import_fbx(name):
    path = os.path.join(SRC, f"SK_IE1_{name}.fbx")
    if not os.path.exists(path):
        log(f"missing {path}; run Tools/Blender/Realistic/export_robot.py first")
        return None
    task = unreal.AssetImportTask()
    task.filename = path
    task.destination_path = DEST
    task.automated = True
    task.replace_existing = True
    task.save = True
    ui = unreal.FbxImportUI()
    ui.import_as_skeletal = True
    ui.import_mesh = True
    ui.import_materials = True
    ui.import_textures = False
    ui.import_animations = False
    ui.mesh_type_to_import = unreal.FBXImportType.FBXIT_SKELETAL_MESH
    ui.skeletal_mesh_import_data.set_editor_property("import_morph_targets", False)
    ui.skeletal_mesh_import_data.set_editor_property("convert_scene", True)
    ui.skeletal_mesh_import_data.set_editor_property("use_t0_as_ref_pose", False)
    task.options = ui
    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
    mesh = unreal.load_asset(f"{DEST}/SK_IE1_{name}")
    log(f"imported {name}: {mesh}")
    return mesh


def add_socket(mesh, socket_name, bone, location):
    socket = unreal.SkeletalMeshSocket()
    socket.set_editor_property("socket_name", socket_name)
    socket.set_editor_property("bone_name", bone)
    socket.set_editor_property("relative_location", location)
    try:
        mesh.add_socket(socket, False)
    except AttributeError:
        log(f"SkeletalMesh.add_socket unavailable in this UE version; add socket {socket_name} on {bone} manually")
        return False
    return True


def main():
    meshes = {}
    for name in LIVERIES:
        mesh = import_fbx(name)
        if not mesh:
            continue
        # hand bone axis points down the fist (Y in Unreal bone space after import): striking surface 27 cm along it
        add_socket(mesh, "fist_l", "hand_l", unreal.Vector(0.0, 27.0, 0.0))
        add_socket(mesh, "fist_r", "hand_r", unreal.Vector(0.0, 27.0, 0.0))
        for sock, (bone, loc) in SOCKETS.items():
            add_socket(mesh, sock, bone, loc)
        unreal.EditorAssetLibrary.save_loaded_asset(mesh)
        meshes[name] = mesh
    if not meshes:
        log("nothing imported")
        return
    da_path = f"{DEST}/DA_IronEchoVisuals_Realistic"
    da = unreal.load_asset(da_path)
    if not da:
        factory = unreal.DataAssetFactory()
        factory.set_editor_property("data_asset_class", unreal.load_class(None, "/Script/IronEcho.IronEchoVisualConfig"))
        da = unreal.AssetToolsHelpers.get_asset_tools().create_asset("DA_IronEchoVisuals_Realistic", DEST, None,
                                                                    factory)
    if "Forge" in meshes:
        da.set_editor_property("player_robot_mesh", meshes["Forge"])
    if "Ember" in meshes:
        da.set_editor_property("opponent_robot_mesh", meshes["Ember"])
    unreal.EditorAssetLibrary.save_loaded_asset(da)
    log(f"visual config {da_path} ready; to use it set VisualConfig in Config/DefaultGame.ini "
        f"([/Script/IronEcho.IronEchoSettings]) to {da_path}.DA_IronEchoVisuals_Realistic")


main()
