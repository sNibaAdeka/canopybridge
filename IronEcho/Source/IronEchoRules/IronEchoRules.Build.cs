using UnrealBuildTool;

// Pure C++ combat rules, tracker protocol and packet validation.
// The same sources (except IronEchoRulesModule.cpp) are compiled and unit-tested by Tests/CoreRules (CMake).
public class IronEchoRules : ModuleRules
{
	public IronEchoRules(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		PublicDependencyModuleNames.AddRange(new string[] { "Core" });
	}
}
