using UnrealBuildTool;

public class IronEchoEditorTarget : TargetRules
{
	public IronEchoEditorTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Editor;
		DefaultBuildSettings = BuildSettingsVersion.Latest;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.AddRange(new string[] { "IronEcho", "IronEchoRules", "IronEchoContractVisuals" });
	}
}
