#include "TestFramework.h"

#include "IronEchoRules/Match.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdint>
#include <vector>

using namespace IronEchoCore;

namespace
{
	MatchSetup ShortSetup(MatchMode Mode = MatchMode::Bout, uint64_t Seed = 7)
	{
		MatchSetup Setup;
		Setup.Mode = Mode;
		Setup.Seed = Seed;
		Setup.Rules.Rounds = 2;
		Setup.Rules.RoundTicks = SecondsToTicks(10.0);
		Setup.Rules.BreakTicks = SecondsToTicks(2.0);
		return Setup;
	}

	struct Runner
	{
		Match M;
		CombatEventBuffer Combat;
		MatchEventBuffer Events;
		std::vector<MatchEvent> MatchLog;
		std::vector<CombatEvent> CombatLog;

		explicit Runner(const MatchSetup& Setup) : M(Setup) {}

		void Tick(bool bReady, const FighterIntent& Intent = FighterIntent{})
		{
			Combat.Clear();
			Events.Clear();
			MatchInput Input;
			Input.bInputReady = bReady;
			Input.PlayerIntent = Intent;
			M.Tick(Input, Combat, Events);
			for (const MatchEvent& Event : Events)
			{
				MatchLog.push_back(Event);
			}
			for (const CombatEvent& Event : Combat)
			{
				CombatLog.push_back(Event);
			}
		}

		void Run(int32_t Ticks, bool bReady = true)
		{
			for (int32_t Index = 0; Index < Ticks; ++Index)
			{
				Tick(bReady);
			}
		}

		void RunUntil(MatchPhase Phase, int32_t MaxTicks, bool bReady = true)
		{
			for (int32_t Index = 0; Index < MaxTicks && M.Snapshot().Phase != Phase; ++Index)
			{
				Tick(bReady);
			}
		}

		int Count(MatchEventType Type) const
		{
			int Total = 0;
			for (const MatchEvent& Event : MatchLog)
			{
				Total += Event.Type == Type ? 1 : 0;
			}
			return Total;
		}
	};

	// A scripted "player" that punches on a fixed rhythm and blocks sometimes.
	FighterIntent ScriptedPlayer(int32_t Tick)
	{
		FighterIntent Intent;
		const int32_t Phase = Tick % 90;
		if (Phase == 0)
		{
			Intent.AddPunch(Hand::Left);
		}
		else if (Phase == 30)
		{
			Intent.AddPunch(Hand::Right);
		}
		else if (Phase > 50 && Phase < 75)
		{
			Intent.bBlock = true;
		}
		if ((Tick / 240) % 3 == 1 && Phase > 75)
		{
			Intent.Dodge = DodgeDir::Left;
			Intent.LeanLateral = -0.7f;
		}
		return Intent;
	}

	uint64_t HashRun(uint64_t Seed, int32_t Ticks)
	{
		Runner R(ShortSetup(MatchMode::Bout, Seed));
		uint64_t Hash = 1469598103934665603ULL;
		auto Mix = [&Hash](uint64_t Value) {
			Hash ^= Value;
			Hash *= 1099511628211ULL;
		};
		for (int32_t Tick = 0; Tick < Ticks; ++Tick)
		{
			R.Tick(true, ScriptedPlayer(Tick));
		}
		for (const CombatEvent& Event : R.CombatLog)
		{
			Mix(static_cast<uint64_t>(Event.Type));
			Mix(static_cast<uint64_t>(Event.Actor));
			Mix(static_cast<uint64_t>(Event.Tick));
			Mix(static_cast<uint64_t>(std::lround(Event.Damage * 1000.0f)));
		}
		Mix(static_cast<uint64_t>(R.M.Snapshot().Phase));
		return Hash;
	}
}

IE_TEST(Match_WaitsForStableInputThenCountsDown)
{
	Runner R(ShortSetup());
	R.Run(SecondsToTicks(0.5));
	IE_EXPECT(R.M.Snapshot().Phase == MatchPhase::WaitingForPlayer);
	R.Run(SecondsToTicks(0.6));
	IE_EXPECT(R.M.Snapshot().Phase == MatchPhase::Countdown);
	IE_EXPECT_EQ(R.M.Snapshot().Round, 1);
	R.RunUntil(MatchPhase::Fighting, SecondsToTicks(4.0));
	IE_EXPECT(R.M.Snapshot().Phase == MatchPhase::Fighting);
	IE_EXPECT_EQ(R.Count(MatchEventType::CountdownTick), 3);
	IE_EXPECT_EQ(R.Count(MatchEventType::RoundStarted), 1);
}

IE_TEST(Match_FullBoutReachesResultWithInvariants)
{
	Runner R(ShortSetup());
	int32_t Tick = 0;
	while (R.M.Snapshot().Phase != MatchPhase::MatchOver && Tick < SecondsToTicks(60.0))
	{
		R.Tick(true, ScriptedPlayer(Tick++));
		for (FighterSlot Slot : {FighterSlot::Player, FighterSlot::Opponent})
		{
			const FighterSnapshot& F = R.M.Sim().Get(Slot).Snapshot();
			IE_EXPECT(F.Health >= 0.0f && F.Health <= F.MaxHealth);
			IE_EXPECT(F.Stamina >= 0.0f && F.Stamina <= F.MaxStamina);
			IE_EXPECT(std::isfinite(F.Position));
		}
		const float Gap = R.M.Sim().Gap();
		IE_EXPECT(Gap >= R.M.Setup().Movement.MinDistance - 1e-4f);
	}
	const MatchSnapshot& S = R.M.Snapshot();
	IE_EXPECT(S.Phase == MatchPhase::MatchOver);
	IE_EXPECT(S.Result != ResultMethod::None);
	IE_EXPECT_EQ(R.Count(MatchEventType::MatchEnded), 1);
	if (S.Result == ResultMethod::Decision || S.Result == ResultMethod::Draw)
	{
		IE_EXPECT_EQ(R.Count(MatchEventType::RoundEnded), 2);
		IE_EXPECT(S.ScorePlayer >= 14 && S.ScoreOpponent >= 14 && S.ScorePlayer <= 20 && S.ScoreOpponent <= 20);
		IE_EXPECT(S.Decision != DecisionKind::None);
	}
	// The bot fought back: it threw punches and something connected.
	int BotPunches = 0;
	int Landed = 0;
	for (const CombatEvent& Event : R.CombatLog)
	{
		BotPunches += (Event.Type == CombatEventType::AttackStarted && Event.Actor == FighterSlot::Opponent) ? 1 : 0;
		Landed += Event.Type == CombatEventType::HitConfirmed ? 1 : 0;
	}
	const double FightSeconds = static_cast<double>(R.M.Snapshot().SimTick) / kTickRate;
	std::printf("  info: result=%d fight=%.1fs bot_punches=%d landed=%d score=%d-%d\n", static_cast<int>(S.Result), FightSeconds,
		BotPunches, Landed, S.ScorePlayer, S.ScoreOpponent);
	IE_EXPECT(BotPunches >= static_cast<int>(FightSeconds / 3.0));
	IE_EXPECT(Landed > 5);
}

IE_TEST(Match_DecisionScoringAndRoundBreakRecovery)
{
	MatchSetup Setup = ShortSetup();
	Setup.Bot.AttackIntervalMinTicks = 1000000; // passive bot: player must win on points
	Setup.Bot.AttackIntervalMaxTicks = 1000000;
	Setup.Bot.BlockChance = 0.0f;
	Setup.Bot.DodgeChance = 0.0f;
	Setup.Bot.GuardUpChance = 0.0f;
	Runner R(Setup);
	R.RunUntil(MatchPhase::Fighting, SecondsToTicks(5.0));
	int32_t Tick = 0;
	while (R.M.Snapshot().Phase == MatchPhase::Fighting)
	{
		FighterIntent Intent;
		if (Tick++ % 120 == 0)
		{
			Intent.AddPunch(Hand::Left);
		}
		R.Tick(true, Intent);
	}
	IE_EXPECT(R.M.Snapshot().Phase == MatchPhase::RoundBreak);
	IE_EXPECT_EQ(R.M.Snapshot().ScorePlayer, 10);
	IE_EXPECT_EQ(R.M.Snapshot().ScoreOpponent, 9);
	const float HpBefore = R.M.Sim().Get(FighterSlot::Opponent).Snapshot().Health;
	R.RunUntil(MatchPhase::Countdown, SecondsToTicks(3.0));
	const float HpAfter = R.M.Sim().Get(FighterSlot::Opponent).Snapshot().Health;
	IE_EXPECT_NEAR(HpAfter, (std::min)(100.0f, HpBefore + 15.0f), 1e-3);
	IE_EXPECT_EQ(R.M.Snapshot().Round, 2);
	R.RunUntil(MatchPhase::MatchOver, SecondsToTicks(20.0));
	IE_EXPECT(R.M.Snapshot().Result == ResultMethod::Decision);
	IE_EXPECT(R.M.Snapshot().bHasWinner && R.M.Snapshot().Winner == FighterSlot::Player);
}

IE_TEST(Match_StayingDownForTenIsKnockOut)
{
	MatchSetup Setup = ShortSetup();
	Setup.OpponentFighter.MaxHealth = 9.0f;
	Setup.Bot.GetUpChance[0] = 0.0f;
	Setup.Bot.AttackIntervalMinTicks = 1000000;
	Setup.Bot.AttackIntervalMaxTicks = 1000000;
	Setup.Bot.BlockChance = 0.0f;
	Setup.Bot.DodgeChance = 0.0f;
	Setup.Bot.GuardUpChance = 0.0f;
	Runner R(Setup);
	R.RunUntil(MatchPhase::Fighting, SecondsToTicks(5.0));
	FighterIntent Cross;
	Cross.AddPunch(Hand::Right);
	R.Tick(true, Cross);
	R.RunUntil(MatchPhase::Knockdown, 60);
	IE_EXPECT(R.M.Snapshot().Phase == MatchPhase::Knockdown);
	const int32_t Frozen = R.M.Snapshot().RoundTicksLeft;
	R.RunUntil(MatchPhase::MatchOver, SecondsToTicks(11.0));
	IE_EXPECT(R.M.Snapshot().Result == ResultMethod::KnockOut);
	IE_EXPECT_EQ(R.Count(MatchEventType::KnockdownCount), 10);
	IE_EXPECT_EQ(R.M.Snapshot().RoundTicksLeft, Frozen); // the round clock stops during the count
	IE_EXPECT(R.M.Snapshot().Winner == FighterSlot::Player);
	IE_EXPECT_EQ(R.M.Snapshot().Round, 1);
}

IE_TEST(Match_TrackingLossPausesAfterGraceAndResumesWhenStable)
{
	Runner R(ShortSetup());
	R.RunUntil(MatchPhase::Fighting, SecondsToTicks(5.0));
	const int32_t TimeLeft = R.M.Snapshot().RoundTicksLeft;
	R.Run(SecondsToTicks(0.4), false); // short dropout: inside the grace period
	IE_EXPECT(R.M.Snapshot().Phase == MatchPhase::Fighting);
	R.Run(SecondsToTicks(0.2), false);
	IE_EXPECT(R.M.Snapshot().Phase == MatchPhase::Paused);
	IE_EXPECT(R.M.Snapshot().Pause == PauseReason::TrackingLost);
	const int32_t Frozen = R.M.Snapshot().RoundTicksLeft;
	R.Run(SecondsToTicks(5.0), false);
	IE_EXPECT_EQ(R.M.Snapshot().RoundTicksLeft, Frozen);
	IE_EXPECT(TimeLeft - Frozen <= SecondsToTicks(0.5) + 1);
	R.Run(SecondsToTicks(0.5), true); // not stable long enough yet
	IE_EXPECT(R.M.Snapshot().Phase == MatchPhase::Paused);
	R.Run(SecondsToTicks(0.6), true);
	IE_EXPECT(R.M.Snapshot().Phase == MatchPhase::Countdown);
	R.RunUntil(MatchPhase::Fighting, SecondsToTicks(4.0));
	IE_EXPECT(R.M.Snapshot().Phase == MatchPhase::Fighting);
	IE_EXPECT_EQ(R.M.Snapshot().RoundTicksLeft, Frozen);
	IE_EXPECT_EQ(R.Count(MatchEventType::RoundStarted), 1); // resuming is not a new round
	IE_EXPECT_EQ(R.Count(MatchEventType::Paused), 1);
	IE_EXPECT_EQ(R.Count(MatchEventType::Resumed), 1);
}

IE_TEST(Match_ManualPauseNeedsResumeRequest)
{
	Runner R(ShortSetup());
	R.RunUntil(MatchPhase::Fighting, SecondsToTicks(5.0));
	R.M.RequestPause();
	R.Tick(true);
	IE_EXPECT(R.M.Snapshot().Phase == MatchPhase::Paused);
	IE_EXPECT(R.M.Snapshot().Pause == PauseReason::Manual);
	R.Run(SecondsToTicks(3.0));
	IE_EXPECT(R.M.Snapshot().Phase == MatchPhase::Paused);
	R.M.RequestResume();
	R.Tick(true);
	IE_EXPECT(R.M.Snapshot().Phase == MatchPhase::Countdown);
}

IE_TEST(Match_RematchResetsEverything)
{
	MatchSetup Setup = ShortSetup();
	Setup.OpponentFighter.MaxHealth = 5.0f;
	Setup.Bot.GetUpChance[0] = 0.0f;
	Setup.Bot.AttackIntervalMinTicks = 1000000;
	Setup.Bot.AttackIntervalMaxTicks = 1000000;
	Setup.Bot.BlockChance = 0.0f;
	Setup.Bot.DodgeChance = 0.0f;
	Setup.Bot.GuardUpChance = 0.0f;
	Runner R(Setup);
	R.RunUntil(MatchPhase::Fighting, SecondsToTicks(5.0));
	FighterIntent Jab;
	Jab.AddPunch(Hand::Left);
	R.Tick(true, Jab);
	R.RunUntil(MatchPhase::MatchOver, SecondsToTicks(12.0));
	IE_EXPECT(R.M.Snapshot().Phase == MatchPhase::MatchOver);
	R.M.RequestRematch();
	R.Tick(true);
	IE_EXPECT(R.M.Snapshot().Phase == MatchPhase::WaitingForPlayer);
	IE_EXPECT_EQ(R.M.Snapshot().Round, 0);
	IE_EXPECT_EQ(R.M.Snapshot().ScorePlayer, 0);
	IE_EXPECT(R.M.Snapshot().Result == ResultMethod::None);
	IE_EXPECT_NEAR(R.M.Sim().Get(FighterSlot::Opponent).Snapshot().Health, 5.0, 1e-5);
	IE_EXPECT(R.M.Snapshot().Seed == Setup.Seed + 1);
	R.RunUntil(MatchPhase::Fighting, SecondsToTicks(6.0));
	IE_EXPECT(R.M.Snapshot().Phase == MatchPhase::Fighting);
}

IE_TEST(Match_TrainingCountsConfirmedBagHits)
{
	Runner R(ShortSetup(MatchMode::Training));
	R.RunUntil(MatchPhase::Training, SecondsToTicks(6.0));
	IE_EXPECT(R.M.Snapshot().Phase == MatchPhase::Training);
	for (int Index = 0; Index < 10; ++Index)
	{
		FighterIntent Intent;
		Intent.AddPunch(Index % 2 == 0 ? Hand::Left : Hand::Right);
		R.Tick(true, Intent);
		R.Run(70);
	}
	IE_EXPECT_EQ(R.M.Snapshot().TrainingHits, 10);
	IE_EXPECT(R.M.Snapshot().Phase == MatchPhase::Training);
	R.Run(SecondsToTicks(120.0)); // no timer in training
	IE_EXPECT(R.M.Snapshot().Phase == MatchPhase::Training);
}

IE_TEST(Match_DeterministicForSeed)
{
	const int32_t Ticks = SecondsToTicks(30.0);
	IE_EXPECT_EQ(HashRun(42, Ticks), HashRun(42, Ticks));
	IE_EXPECT(HashRun(42, Ticks) != HashRun(43, Ticks));
}

IE_TEST(Match_BotDifficultyOrdering)
{
	// Over many seeds, Hard lands more punches on the scripted player than Easy.
	auto Landed = [](BotLevel Level) {
		int Total = 0;
		for (uint64_t Seed = 1; Seed <= 6; ++Seed)
		{
			MatchSetup Setup = ShortSetup(MatchMode::Bout, Seed);
			Setup.Bot = MakeBotConfig(Level);
			Setup.OpponentFighter = MakeBotFighterConfig(Level);
			Setup.PlayerFighter.MaxHealth = 10000.0f;
			Runner R(Setup);
			for (int32_t Tick = 0; Tick < SecondsToTicks(25.0); ++Tick)
			{
				R.Tick(true, ScriptedPlayer(Tick));
			}
			for (const CombatEvent& Event : R.CombatLog)
			{
				Total += (Event.Type == CombatEventType::HitConfirmed && Event.Actor == FighterSlot::Opponent) ? 1 : 0;
			}
		}
		return Total;
	};
	const int Easy = Landed(BotLevel::Easy);
	const int Hard = Landed(BotLevel::Hard);
	std::printf("  info: bot hits on scripted player: easy=%d hard=%d\n", Easy, Hard);
	IE_EXPECT(Hard > Easy);
}

namespace
{
	MatchSetup PassiveBotSetup()
	{
		MatchSetup Setup = ShortSetup();
		Setup.Bot.AttackIntervalMinTicks = 1000000;
		Setup.Bot.AttackIntervalMaxTicks = 1000000;
		Setup.Bot.BlockChance = 0.0f;
		Setup.Bot.DodgeChance = 0.0f;
		Setup.Bot.GuardUpChance = 0.0f;
		Setup.Bot.GuardAfterHitChance = 0.0f;
		return Setup;
	}
}

IE_TEST(Match_PlayerBeatsCountByHoldingGuard)
{
	MatchSetup Setup = PassiveBotSetup();
	Setup.PlayerFighter.MaxHealth = 4.0f;
	Setup.Bot.AttackIntervalMinTicks = SecondsToTicks(0.3); // aggressive bot knocks the idle player down
	Setup.Bot.AttackIntervalMaxTicks = SecondsToTicks(0.3);
	Runner R(Setup);
	R.RunUntil(MatchPhase::Fighting, SecondsToTicks(5.0));
	R.RunUntil(MatchPhase::Knockdown, SecondsToTicks(5.0));
	IE_EXPECT(R.M.Snapshot().Phase == MatchPhase::Knockdown);
	IE_EXPECT(R.M.Sim().Get(FighterSlot::Player).IsKnockedDown());

	FighterIntent Guard;
	Guard.bBlock = true;
	R.Tick(true, Guard);
	for (int32_t Index = 0; Index < SecondsToTicks(1.5); ++Index)
	{
		R.Tick(true, Guard); // too early: the count must reach the minimum down time first
	}
	IE_EXPECT(R.M.Sim().Get(FighterSlot::Player).IsKnockedDown());
	IE_EXPECT_EQ(R.M.Snapshot().GetUpProgress, 100);
	for (int32_t Index = 0; Index < SecondsToTicks(1.0); ++Index)
	{
		R.Tick(true, Guard);
	}
	IE_EXPECT(!R.M.Sim().Get(FighterSlot::Player).IsKnockedDown());
	IE_EXPECT_NEAR(R.M.Sim().Get(FighterSlot::Player).Snapshot().Health, 4.0 * 0.40, 1e-4);
	IE_EXPECT_NEAR(R.M.Sim().Gap(), R.M.Setup().Movement.EngageDistance, 1e-4);
	R.RunUntil(MatchPhase::Fighting, SecondsToTicks(2.0));
	IE_EXPECT(R.M.Snapshot().Phase == MatchPhase::Fighting);
	IE_EXPECT_EQ(R.Count(MatchEventType::RoundStarted), 1);
}

IE_TEST(Match_ReleasingGuardResetsGetUp)
{
	MatchSetup Setup = PassiveBotSetup();
	Setup.PlayerFighter.MaxHealth = 4.0f;
	Setup.Bot.AttackIntervalMinTicks = SecondsToTicks(0.3);
	Setup.Bot.AttackIntervalMaxTicks = SecondsToTicks(0.3);
	Runner R(Setup);
	R.RunUntil(MatchPhase::Knockdown, SecondsToTicks(10.0));
	FighterIntent Guard;
	Guard.bBlock = true;
	for (int32_t Index = 0; Index < SecondsToTicks(10.5); ++Index)
	{
		// Guard flickers every 1.0 s: never held long enough.
		R.Tick(true, (Index / SecondsToTicks(1.0)) % 2 == 0 ? Guard : FighterIntent{});
	}
	IE_EXPECT(R.M.Snapshot().Phase == MatchPhase::MatchOver);
	IE_EXPECT(R.M.Snapshot().Result == ResultMethod::KnockOut);
	IE_EXPECT(R.M.Snapshot().Winner == FighterSlot::Opponent);
}

IE_TEST(Match_ThirdKnockdownInRoundIsTechnicalKnockOut)
{
	MatchSetup Setup = PassiveBotSetup();
	Setup.OpponentFighter.MaxHealth = 9.0f;
	Setup.Bot.GetUpChance[0] = Setup.Bot.GetUpChance[1] = Setup.Bot.GetUpChance[2] = 1.0f;
	Setup.Bot.GetUpCountMin = Setup.Bot.GetUpCountMax = 3;
	Runner R(Setup);
	R.RunUntil(MatchPhase::Fighting, SecondsToTicks(5.0));
	int32_t Tick = 0;
	for (; Tick < SecondsToTicks(60.0) && R.M.Snapshot().Phase != MatchPhase::MatchOver; ++Tick)
	{
		FighterIntent Intent;
		if (R.M.Snapshot().Phase == MatchPhase::Fighting && Tick % 60 == 0)
		{
			Intent.AddPunch(Hand::Right);
		}
		R.Tick(true, Intent);
	}
	const MatchSnapshot& S = R.M.Snapshot();
	IE_EXPECT(S.Result == ResultMethod::TechnicalKnockOut);
	IE_EXPECT(S.bHasWinner && S.Winner == FighterSlot::Player);
	IE_EXPECT_EQ(R.M.Sim().Get(FighterSlot::Opponent).Snapshot().KnockdownsSuffered, 3);
	IE_EXPECT_EQ(S.Round, 1);
	int GotUp = 0;
	for (const CombatEvent& Event : R.CombatLog)
	{
		GotUp += Event.Type == CombatEventType::GotUp ? 1 : 0;
	}
	IE_EXPECT_EQ(GotUp, 2);
}

IE_TEST(Match_TrackingLossDuringCountPausesAndResumesCount)
{
	MatchSetup Setup = PassiveBotSetup();
	Setup.OpponentFighter.MaxHealth = 9.0f;
	Setup.Bot.GetUpChance[0] = 0.0f;
	Runner R(Setup);
	R.RunUntil(MatchPhase::Fighting, SecondsToTicks(5.0));
	FighterIntent Cross;
	Cross.AddPunch(Hand::Right);
	R.Tick(true, Cross);
	R.RunUntil(MatchPhase::Knockdown, 60);
	R.Run(SecondsToTicks(3.0));
	const int32_t CountBefore = R.M.Snapshot().KnockdownCount;
	R.Run(SecondsToTicks(2.0), false);
	IE_EXPECT(R.M.Snapshot().Phase == MatchPhase::Paused);
	IE_EXPECT(R.M.Snapshot().KnockdownCount <= CountBefore + 1);
	R.Run(SecondsToTicks(1.2), true);
	IE_EXPECT(R.M.Snapshot().Phase == MatchPhase::Knockdown);
	R.RunUntil(MatchPhase::MatchOver, SecondsToTicks(10.0));
	IE_EXPECT(R.M.Snapshot().Result == ResultMethod::KnockOut);
}

IE_TEST(Judges_ScoreRoundWithStylesAndKnockdowns)
{
	MatchConfig Rules;
	RoundTally Player{20.0f, 4, 0, 0};
	RoundTally Opponent{19.5f, 8, 6, 0};
	int32_t Points[kJudgeCount][2] = {};
	Match::ScoreRound(Rules, Player, Opponent, Points);
	IE_EXPECT(Points[0][0] == 10 && Points[0][1] == 10); // neutral judge: damage within the margin
	IE_EXPECT(Points[1][0] == 9 && Points[1][1] == 10);  // volume judge: more punches landed
	IE_EXPECT(Points[2][0] == 9 && Points[2][1] == 10);  // defence judge: more blocks/slips

	RoundTally Dominant{40.0f, 10, 2, 0};
	RoundTally Dropped{5.0f, 1, 0, 1};
	Match::ScoreRound(Rules, Dominant, Dropped, Points);
	for (int32_t Judge = 0; Judge < kJudgeCount; ++Judge)
	{
		IE_EXPECT(Points[Judge][0] == 10 && Points[Judge][1] == 8); // 10-8 knockdown round
	}
	RoundTally Wrecked{0.0f, 0, 0, 5};
	Match::ScoreRound(Rules, Dominant, Wrecked, Points);
	IE_EXPECT_EQ(Points[0][1], Rules.MinPointsPerRound);
}

IE_TEST(Judges_DecisionKinds)
{
	bool bWinner = false;
	FighterSlot Winner = FighterSlot::Opponent;
	const int32_t Unanimous[3][2] = {{30, 27}, {29, 28}, {29, 28}};
	IE_EXPECT(Match::DecideCards(Unanimous, bWinner, Winner) == DecisionKind::Unanimous && bWinner && Winner == FighterSlot::Player);
	const int32_t Split[3][2] = {{29, 28}, {28, 29}, {29, 28}};
	IE_EXPECT(Match::DecideCards(Split, bWinner, Winner) == DecisionKind::Split && bWinner && Winner == FighterSlot::Player);
	const int32_t Majority[3][2] = {{28, 29}, {28, 28}, {27, 30}};
	IE_EXPECT(Match::DecideCards(Majority, bWinner, Winner) == DecisionKind::Majority && bWinner && Winner == FighterSlot::Opponent);
	const int32_t SplitDraw[3][2] = {{29, 28}, {28, 29}, {28, 28}};
	IE_EXPECT(Match::DecideCards(SplitDraw, bWinner, Winner) == DecisionKind::Split && !bWinner);
	const int32_t UnanimousDraw[3][2] = {{28, 28}, {28, 28}, {28, 28}};
	IE_EXPECT(Match::DecideCards(UnanimousDraw, bWinner, Winner) == DecisionKind::Unanimous && !bWinner);
	const int32_t MajorityDraw[3][2] = {{29, 28}, {28, 28}, {28, 28}};
	IE_EXPECT(Match::DecideCards(MajorityDraw, bWinner, Winner) == DecisionKind::Majority && !bWinner);
}
