using UnrealBuildTool;

// Gameplay integration layer: tracker process + UDP, match driving, fighters, placeholder robot,
// debug HUD, and the C++ API that Codex's visual content binds to (Docs/Contracts/ROBOT_VISUAL_CONTRACT.md).
public class IronEcho : ModuleRules
{
	public IronEcho(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

		PublicDependencyModuleNames.AddRange(new string[]
		{
			"Core",
			"CoreUObject",
			"Engine",
			"InputCore",
			"DeveloperSettings",
			"UMG",
			"IronEchoRules"
		});

		PrivateDependencyModuleNames.AddRange(new string[]
		{
			"Sockets",
			"Networking",
			"Slate",
			"SlateCore"
		});
	}
}
