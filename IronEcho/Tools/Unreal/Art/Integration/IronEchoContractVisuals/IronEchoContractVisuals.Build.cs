using UnrealBuildTool;

public class IronEchoContractVisuals : ModuleRules
{
    public IronEchoContractVisuals(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
        // Install as Source/IronEchoContractVisuals, a project module (not a plugin).
        PublicDependencyModuleNames.AddRange(new string[] {
            "Core", "CoreUObject", "Engine", "IronEcho", "IronEchoVisuals"
        });
    }
}
