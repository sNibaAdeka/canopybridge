"""Editor-only: import the realistic IE-1 robots (ArtSource/Realistic/Export/SK_IE1_*.fbx + baked T_IE1_* textures from
Tools/Blender/Realistic/bake_robot.py) into /Game/Tech/Realistic, build the PBR material (BaseColor, Normal, ORM,
Emissive), add contract sockets (fist_l, fist_r, hit_head, hit_body) and point a UIronEchoVisualConfig at them.

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
        log(f"missing {path}; run Tools/Blender/Realistic/bake_robot.py first")
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
    ui.import_materials = False  # the PBR material is built below from the baked textures
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


def import_texture(path, kind):
    """kind: BaseColor | Normal | ORM | Emissive."""
    task = unreal.AssetImportTask()
    task.filename = path
    task.destination_path = DEST
    task.automated = True
    task.replace_existing = True
    task.save = True
    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
    tex = unreal.load_asset(f"{DEST}/{os.path.splitext(os.path.basename(path))[0]}")
    if tex is None:
        return None
    if kind == "Normal":
        tex.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_NORMALMAP)
        tex.set_editor_property("srgb", False)
        tex.set_editor_property("flip_green_channel", True)  # Blender bakes OpenGL (+Y) normals
    elif kind == "ORM":
        tex.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_MASKS)
        tex.set_editor_property("srgb", False)
    unreal.EditorAssetLibrary.save_loaded_asset(tex)
    return tex


def build_material(name):
    """M_IE1_<name>: BaseColor, Normal, ORM (R=AO, G=Roughness, B=Metallic), Emissive (LEDs)."""
    textures = {}
    for kind in ("BaseColor", "Normal", "ORM", "Emissive"):
        path = os.path.join(SRC, f"T_IE1_{name}_{kind}.png")
        if os.path.exists(path):
            textures[kind] = import_texture(path, kind)
    if "BaseColor" not in textures:
        log(f"no baked textures for {name}; run bake_robot.py")
        return None
    mel = unreal.MaterialEditingLibrary
    mat_path = f"{DEST}/M_IE1_{name}"
    mat = unreal.load_asset(mat_path) or unreal.AssetToolsHelpers.get_asset_tools().create_asset(
        f"M_IE1_{name}", DEST, unreal.Material, unreal.MaterialFactoryNew())
    mel.delete_all_material_expressions(mat)

    def sampler(kind, y, sampler_type):
        e = mel.create_material_expression(mat, unreal.MaterialExpressionTextureSample, -500, y)
        e.set_editor_property("texture", textures[kind])
        e.set_editor_property("sampler_type", sampler_type)
        return e

    st = unreal.MaterialSamplerType
    mp = unreal.MaterialProperty
    bc = sampler("BaseColor", -300, st.SAMPLERTYPE_COLOR)
    mel.connect_material_property(bc, "RGB", mp.MP_BASE_COLOR)
    if "ORM" in textures:
        orm = sampler("ORM", 0, st.SAMPLERTYPE_MASKS)
        mel.connect_material_property(orm, "R", mp.MP_AMBIENT_OCCLUSION)
        mel.connect_material_property(orm, "G", mp.MP_ROUGHNESS)
        mel.connect_material_property(orm, "B", mp.MP_METALLIC)
    if "Normal" in textures:
        nm = sampler("Normal", 300, st.SAMPLERTYPE_NORMAL)
        mel.connect_material_property(nm, "RGB", mp.MP_NORMAL)
    if "Emissive" in textures:
        em = sampler("Emissive", 600, st.SAMPLERTYPE_COLOR)
        mul = mel.create_material_expression(mat, unreal.MaterialExpressionMultiply, -200, 600)
        mul.set_editor_property("const_b", 12.0)
        mel.connect_material_expressions(em, "RGB", mul, "A")
        mel.connect_material_property(mul, "", mp.MP_EMISSIVE_COLOR)
    mat.set_editor_property("used_with_skeletal_mesh", True)
    mel.recompile_material(mat)
    unreal.EditorAssetLibrary.save_loaded_asset(mat)
    return mat


def assign_material(mesh, mat):
    slots = mesh.get_editor_property("materials")
    for slot in slots:
        slot.set_editor_property("material_interface", mat)
    mesh.set_editor_property("materials", slots)


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
        mat = build_material(name)
        if mat:
            assign_material(mesh, mat)
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
    log(f"visual config {da_path} ready. Next (Codex art step): run Tools/Unreal/Art/prepare_contract_camera.py — it "
        f"copies these robot references into /Game/Art/Config/DA_IronEchoVisuals (the one Config/DefaultGame.ini "
        f"uses) and sets GameCameraClass to IEContractCameraRig")


main()
