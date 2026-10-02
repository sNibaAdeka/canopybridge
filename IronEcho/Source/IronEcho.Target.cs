using UnrealBuildTool;

public class IronEchoTarget : TargetRules
{
	public IronEchoTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Game;
		DefaultBuildSettings = BuildSettingsVersion.Latest;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.AddRange(new string[] { "IronEcho", "IronEchoRules" });
	}
}
