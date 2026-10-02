"""Editor connection probe: proves editor Python runs against THIS project and reports what it sees.

Run headless (Tools/Build/Run-UEProbe.ps1 does this and keeps the log):
    UnrealEditor-Cmd.exe <IronEcho.uproject> -run=pythonscript -script="<abs>/Tools/Unreal/Tech/ue_connection_probe.py" -unattended -nop4 -nosplash -NullRHI
or inside an open editor:  py "<abs>/Tools/Unreal/Tech/ue_connection_probe.py"

Writes <Project>/Saved/Probe/ue_probe_result.json and log lines prefixed IRONECHO_PROBE.
Read-only: it never modifies assets.
"""

import json
import os
import platform
import sys
import time

import unreal

PREFIX = "IRONECHO_PROBE"


def log(message):
    unreal.log(f"{PREFIX} {message}")


def safe(label, fn, default=None):
    try:
        return fn()
    except Exception as error:  # noqa: BLE001 - a probe must report, not crash
        unreal.log_warning(f"{PREFIX} {label} failed: {error}")
        return default


def main():
    project_dir = unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_dir())
    result = {
        "probe_version": 1,
        "utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "engine_version": safe("engine version", unreal.SystemLibrary.get_engine_version),
        "project_dir": project_dir,
        "project_file": safe("project file", lambda: unreal.Paths.get_project_file_path()),
        "python": sys.version,
        "platform": platform.platform(),
        "is_editor": safe("editor check", lambda: unreal.SystemLibrary.is_editor() if hasattr(unreal.SystemLibrary, "is_editor") else None),
    }

    # C++ module loaded? (the editor target must have been built)
    classes = {}
    for path in (
        "/Script/IronEcho.IronEchoGameMode",
        "/Script/IronEcho.IronEchoFighter",
        "/Script/IronEcho.IronEchoRobotAnimInstance",
        "/Script/IronEcho.IronEchoVisualConfig",
        "/Script/IronEcho.IronEchoRingAnchor",
        "/Script/IronEcho.IronEchoTrackingSubsystem",
    ):
        classes[path] = safe(path, lambda p=path: unreal.load_class(None, p) is not None, False)
    result["cpp_classes"] = classes

    settings = safe("settings", lambda: unreal.get_default_object(unreal.load_class(None, "/Script/IronEcho.IronEchoSettings")))
    if settings is not None:
        result["settings"] = {
            name: str(safe(name, lambda n=name: settings.get_editor_property(n)))
            for name in ("tracker_launch_mode", "game_listen_port", "tracker_control_port", "start_mode", "visual_config")
        }

    # Plugins needed for content automation.
    result["plugins"] = {}
    plugin_lib = getattr(unreal, "PluginBlueprintLibrary", None)
    enabled = safe("plugins", lambda: plugin_lib.get_enabled_plugin_names(), []) if plugin_lib else []
    for name in ("PythonScriptPlugin", "EditorScriptingUtilities"):
        result["plugins"][name] = (name in enabled) if enabled else "unknown (PluginBlueprintLibrary unavailable)"

    # Content visible to the editor (Codex's area and the visual config entry point).
    eal = unreal.EditorAssetLibrary
    result["content"] = {
        "game_assets": len(safe("list /Game", lambda: eal.list_assets("/Game", recursive=True, include_folder=False), []) or []),
        "art_dir_exists": safe("art dir", lambda: eal.does_directory_exist("/Game/Art"), False),
        "visual_config_exists": safe("visual config", lambda: eal.does_asset_exist("/Game/Art/Config/DA_IronEchoVisuals"), False),
        "entry_map_exists": safe("entry map", lambda: eal.does_asset_exist("/Engine/Maps/Entry"), False),
        "basic_cube_exists": safe("basic shapes", lambda: eal.does_asset_exist("/Engine/BasicShapes/Cube"), False),
    }

    rhi = safe("rhi", lambda: unreal.SystemLibrary.get_rendering_detail_mode() if hasattr(unreal.SystemLibrary, "get_rendering_detail_mode") else None)
    result["rendering_detail_mode"] = str(rhi)
    result["ok"] = all(classes.values()) and bool(result["content"]["entry_map_exists"])

    out_dir = os.path.join(project_dir, "Saved", "Probe")
    os.makedirs(out_dir, exist_ok=True)
    out_file = os.path.join(out_dir, "ue_probe_result.json")
    with open(out_file, "w", encoding="utf-8") as handle:
        json.dump(result, handle, indent=2, default=str)
    for key, value in result.items():
        log(f"{key} = {json.dumps(value, default=str)}")
    log(f"RESULT {'OK' if result['ok'] else 'PROBLEMS'} -> {out_file}")


main()
