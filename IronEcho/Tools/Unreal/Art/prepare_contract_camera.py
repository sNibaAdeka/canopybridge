"""Create Codex's camera configuration/material in UE Editor (contract 1.1).

Never imports robots or alters Tech assets, gameplay, Config or the project file.
No Unreal execution has been performed on the preparation Mac.
Console: py "<checkout>/IronEcho/Tools/Unreal/Art/prepare_contract_camera.py"
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import unreal

CONFIG = "/Game/Art/Config/DA_IronEchoVisuals"
MATERIAL = "/Game/Art/IronEcho/Materials/M_IE_ImpactSparks"
ROBOT_SOURCE = "/Game/Tech/Realistic/DA_IronEchoVisuals_Realistic"
CAMERA = "/Script/IronEchoContractVisuals.IEContractCameraRig"


def load_or_create(path, asset_class, factory):
    existing = unreal.load_asset(path)
    if existing:
        if not isinstance(existing, asset_class):
            raise RuntimeError("Asset has another class: " + path)
        return existing, False
    folder, name = path.rsplit("/", 1)
    unreal.EditorAssetLibrary.make_directory(folder)
    asset = unreal.AssetToolsHelpers.get_asset_tools().create_asset(name, folder, asset_class, factory)
    if not asset:
        raise RuntimeError("Failed to create " + path)
    return asset, True


def save(asset):
    if not asset.get_path_name().startswith("/Game/Art/"):
        raise RuntimeError("Refusing to save outside Codex Art")
    if not unreal.EditorAssetLibrary.save_loaded_asset(asset, only_if_is_dirty=False):
        raise RuntimeError("Failed to save " + asset.get_path_name())


def create_sparks():
    material, created = load_or_create(MATERIAL, unreal.Material, unreal.MaterialFactoryNew())
    if created:
        material.set_editor_property("blend_mode", unreal.BlendMode.BLEND_OPAQUE)
        material.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
        lib = unreal.MaterialEditingLibrary
        color = lib.create_material_expression(material, unreal.MaterialExpressionVectorParameter, -300, 0)
        color.set_editor_property("parameter_name", "SparkColor")
        # Linear scene RGB, cosmetic emission; does not change robot materials.
        color.set_editor_property("default_value", unreal.LinearColor(1.0, 0.54, 0.10, 1.0))
        strength = lib.create_material_expression(material, unreal.MaterialExpressionScalarParameter, -300, 160)
        strength.set_editor_property("parameter_name", "SparkEmission")
        strength.set_editor_property("default_value", 3.0)
        multiply = lib.create_material_expression(material, unreal.MaterialExpressionMultiply, -80, 0)
        if not lib.connect_material_expressions(color, "", multiply, "A"):
            raise RuntimeError("Failed to connect spark color")
        if not lib.connect_material_expressions(strength, "", multiply, "B"):
            raise RuntimeError("Failed to connect spark emission")
        if not lib.connect_material_property(multiply, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR):
            raise RuntimeError("Failed to connect emissive output")
        lib.set_material_usage(material, unreal.MaterialUsage.MATUSAGE_INSTANCED_STATIC_MESHES)
        lib.recompile_material(material)
        save(material)
    return created


def main():
    levels = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    if levels.is_in_play_in_editor():
        raise RuntimeError("Stop PIE before preparing Art")
    dirty = list(unreal.EditorLoadingAndSavingUtils.get_dirty_map_packages())
    dirty += list(unreal.EditorLoadingAndSavingUtils.get_dirty_content_packages())
    if dirty:
        raise RuntimeError("Save your current changes first")
    camera_class = unreal.load_class(None, CAMERA)
    config_class = unreal.load_class(None, "/Script/IronEcho.IronEchoVisualConfig")
    if not camera_class or not config_class:
        raise RuntimeError("Register/build the IronEchoContractVisuals project module and IronEchoVisuals plugin first")
    # Existing DA is preserved, including changes made by another integration pass.
    # Move to a new owned asset path / handoff if its references need changing.
    if unreal.load_asset(CONFIG):
        raise RuntimeError("Art config already exists; inspect it before changing camera/robot references")
    saved = Path(unreal.Paths.project_saved_dir())
    saved.mkdir(parents=True, exist_ok=True)
    lock = saved / "IronEchoArt.lock"
    descriptor = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump({"writer": "codex", "operation": "prepare_contract_camera", "pid": os.getpid()}, handle)
        material_created = create_sparks()
        factory = unreal.DataAssetFactory()
        factory.set_editor_property("data_asset_class", config_class)
        config, _ = load_or_create(CONFIG, unreal.DataAsset, factory)
        source = unreal.load_asset(ROBOT_SOURCE)
        if source:
            for field in ("player_robot_mesh", "opponent_robot_mesh", "robot_anim_class", "punching_bag_mesh"):
                config.set_editor_property(field, source.get_editor_property(field))
        config.set_editor_property("game_camera_class", camera_class)
        # HUD/menu source exists, but its gameplay adapter is still pending.
        config.set_editor_property("b_hide_debug_overlay", False)
        save(config)
        report = {
            "engine": unreal.SystemLibrary.get_engine_version(),
            "config": CONFIG, "camera_class": CAMERA, "material": MATERIAL,
            "material_created": material_created, "robot_source_copied": bool(source),
            "runtime_verified": False, "hud_menu_bound": False,
            "checks_pending": ["UE module/UHT build", "PIE training and bout", "packaged Win64",
                               "camera occlusion", "repeated contact", "reduced motion", "VRAM/FPS"]
        }
        out = saved / "IronEchoArtReports" / "contract_camera_setup.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
        unreal.log("Codex camera config created: " + CONFIG + "; report " + str(out))
        return report
    finally:
        lock.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
