using UnrealBuildTool;

public class IronEchoVisuals : ModuleRules
{
    public IronEchoVisuals(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
        PublicDependencyModuleNames.AddRange(new string[] { "Core", "CoreUObject", "Engine", "UMG", "SlateCore" });
        PrivateDependencyModuleNames.AddRange(new string[] { "Slate", "InputCore" });
    }
}
