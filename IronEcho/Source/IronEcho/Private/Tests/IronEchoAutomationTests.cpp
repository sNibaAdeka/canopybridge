// In-engine smoke tests (run: Tools/Build/Run-UETests.ps1 or Session Frontend, filter "IronEcho").
// The exhaustive rules/protocol suite runs outside Unreal (Tests/CoreRules); these prove the same
// code links, runs and reads the shared golden vectors inside the engine build.
#include "IronEchoConversions.h"
#include "IronEchoFighter.h"
#include "IronEchoRules/Match.h"
#include "IronEchoRules/PacketGate.h"
#include "IronEchoRules/Protocol.h"
#include "IronEchoSettings.h"
#include "Misc/AutomationTest.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"

#if WITH_DEV_AUTOMATION_TESTS

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FIronEchoGoldenVectorsTest, "IronEcho.Protocol.GoldenVectors",
	EAutomationTestFlags::EditorContext | EAutomationTestFlags::ClientContext | EAutomationTestFlags::ProductFilter)

bool FIronEchoGoldenVectorsTest::RunTest(const FString& Parameters)
{
	const FString Dir = FPaths::Combine(FPaths::ProjectDir(), TEXT("Tests/Golden/protocol_v1"));
	TArray<FString> Lines;
	if (!FFileHelper::LoadFileToStringArray(Lines, *FPaths::Combine(Dir, TEXT("manifest.txt"))))
	{
		AddError(TEXT("manifest.txt not found next to the project"));
		return false;
	}
	int32 Checked = 0;
	for (const FString& Line : Lines)
	{
		if (Line.IsEmpty() || Line.StartsWith(TEXT("#")))
		{
			continue;
		}
		TArray<FString> Tokens;
		Line.ParseIntoArrayWS(Tokens);
		if (Tokens.Num() < 2)
		{
			continue;
		}
		TArray<uint8> Bytes;
		if (!FFileHelper::LoadFileToArray(Bytes, *FPaths::Combine(Dir, Tokens[0])))
		{
			AddError(FString::Printf(TEXT("missing %s"), *Tokens[0]));
			continue;
		}
		IronEchoCore::Protocol::DecodedPacket Packet;
		const IronEchoCore::Protocol::DecodeError Error = IronEchoCore::Protocol::Decode(Bytes.GetData(), static_cast<size_t>(Bytes.Num()), Packet);
		TestEqual(*Tokens[0], FString(ANSI_TO_TCHAR(IronEchoCore::Protocol::DecodeErrorName(Error))), Tokens[1]);
		++Checked;
	}
	TestTrue(TEXT("at least 6 vectors"), Checked >= 6);
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FIronEchoBoutSmokeTest, "IronEcho.Rules.BoutSmoke",
	EAutomationTestFlags::EditorContext | EAutomationTestFlags::ClientContext | EAutomationTestFlags::ProductFilter)

bool FIronEchoBoutSmokeTest::RunTest(const FString& Parameters)
{
	IronEchoCore::MatchSetup Setup;
	Setup.Seed = 99;
	Setup.Rules.Rounds = 1;
	Setup.Rules.RoundTicks = IronEchoCore::SecondsToTicks(20.0);
	IronEchoCore::Match Match(Setup);
	IronEchoCore::CombatEventBuffer Combat;
	IronEchoCore::MatchEventBuffer Events;
	int32 Hits = 0;
	for (int32 Tick = 0; Tick < IronEchoCore::SecondsToTicks(30.0) && Match.Snapshot().Phase != IronEchoCore::MatchPhase::MatchOver; ++Tick)
	{
		IronEchoCore::MatchInput Input;
		Input.bInputReady = true;
		if (Tick % 75 == 0)
		{
			Input.PlayerIntent.AddPunch(Tick % 150 == 0 ? IronEchoCore::Hand::Left : IronEchoCore::Hand::Right);
		}
		Combat.Clear();
		Events.Clear();
		Match.Tick(Input, Combat, Events);
		for (const IronEchoCore::CombatEvent& Event : Combat)
		{
			Hits += Event.Type == IronEchoCore::CombatEventType::HitConfirmed ? 1 : 0;
		}
	}
	TestEqual(TEXT("match finished"), static_cast<int32>(Match.Snapshot().Phase), static_cast<int32>(IronEchoCore::MatchPhase::MatchOver));
	TestTrue(TEXT("hits happened"), Hits > 3);
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FIronEchoContractTest, "IronEcho.Contract.EnumsAndSettings",
	EAutomationTestFlags::EditorContext | EAutomationTestFlags::ClientContext | EAutomationTestFlags::ProductFilter)

bool FIronEchoContractTest::RunTest(const FString& Parameters)
{
	TestTrue(TEXT("tracking Live maps"), IronEchoConvert::ToUnreal(IronEchoCore::TrackingStatus::Live) == EIronEchoTrackingStatus::Live);
	TestTrue(TEXT("phase Training maps"), IronEchoConvert::ToUnreal(IronEchoCore::MatchPhase::Training) == EIronEchoMatchPhase::Training);
	TestEqual(TEXT("required bones"), AIronEchoFighter::RequiredBones().Num(), 21);
	const UIronEchoSettings* Settings = GetDefault<UIronEchoSettings>();
	TestTrue(TEXT("ports sane"), Settings->GameListenPort > 1024 && Settings->TrackerControlPort > 1024 && Settings->GameListenPort != Settings->TrackerControlPort);
	TestTrue(TEXT("hysteresis sane"), Settings->BlockExit < Settings->BlockEnter && Settings->DodgeExit < Settings->DodgeEnter);
	return true;
}

#endif
