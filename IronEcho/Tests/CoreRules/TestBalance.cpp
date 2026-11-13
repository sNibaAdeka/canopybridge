// Balance guard rails on full bouts against the scripted human model (HumanModel.h). Broad bounds only:
// they catch regressions such as one-round massacres, exploits that win, or inverted difficulty levels.
#include "TestFramework.h"

#include "HumanModel.h"

using namespace IronEchoTest;

namespace
{
	struct Tally
	{
		int Bouts = 0;
		int Wins = 0;
		int Decisions = 0;
		int StoppedInRoundOne = 0;
		int RoundsSum = 0;
	};

	Tally Play(BotLevel Level, const HumanProfile& Profile, int Bouts)
	{
		Tally T;
		for (int Seed = 1; Seed <= Bouts; ++Seed)
		{
			const BoutSummary B = RunBout(Level, Profile, static_cast<uint64_t>(Seed));
			++T.Bouts;
			T.Wins += (B.bHasWinner && B.Winner == FighterSlot::Player) ? 1 : 0;
			T.Decisions += (B.Result == ResultMethod::Decision || B.Result == ResultMethod::Draw) ? 1 : 0;
			T.StoppedInRoundOne += ((B.Result == ResultMethod::KnockOut || B.Result == ResultMethod::TechnicalKnockOut) && B.LastRound == 1) ? 1 : 0;
			T.RoundsSum += B.LastRound;
		}
		return T;
	}
}

IE_TEST(Balance_BoutsLastAndLevelsAreOrdered)
{
	const int N = 16;
	const Tally Easy = Play(BotLevel::Easy, AverageHuman(), N);
	const Tally Normal = Play(BotLevel::Normal, AverageHuman(), N);
	const Tally Hard = Play(BotLevel::Hard, AverageHuman(), N);
	std::printf("  info: average human wins easy=%d normal=%d hard=%d of %d; normal: decisions=%d r1 stoppages=%d rounds=%.2f\n",
		Easy.Wins, Normal.Wins, Hard.Wins, N, Normal.Decisions, Normal.StoppedInRoundOne, static_cast<double>(Normal.RoundsSum) / N);
	IE_EXPECT(Easy.Wins >= Normal.Wins && Normal.Wins >= Hard.Wins);
	IE_EXPECT(Normal.Wins >= N / 2);          // Normal is beatable by an average player...
	IE_EXPECT(Hard.Wins < N);                 // ...Hard is not a walkover
	IE_EXPECT(Normal.StoppedInRoundOne <= N / 4); // no one-round massacres
	IE_EXPECT(Normal.RoundsSum >= 2 * N);     // bouts reach round 2 on average
	IE_EXPECT(Easy.StoppedInRoundOne < N);
}

IE_TEST(Balance_FlailingDoesNotWin)
{
	const int N = 16;
	const Tally Normal = Play(BotLevel::Normal, SpammerHuman(), N);
	const Tally Hard = Play(BotLevel::Hard, SpammerHuman(), N);
	const Tally Measured = Play(BotLevel::Normal, AverageHuman(), N);
	std::printf("  info: flailing wins normal=%d hard=%d of %d (measured boxing: %d)\n", Normal.Wins, Hard.Wins, N, Measured.Wins);
	IE_EXPECT(Normal.Wins <= N / 2);
	IE_EXPECT(Hard.Wins <= N / 4);
	IE_EXPECT(Measured.Wins > Normal.Wins); // picking punches beats throwing them all
}

// 1.8: the browser game's profile (ApplyArcadeProfile). Hands only, a readable counter rule; the levels keep their order and
// mashing the buttons still does not beat a bot that fights back.
IE_TEST(Balance_ArcadeProfileKeepsLevelsOrderedAndSpamUnrewarded)
{
	MatchSetup Setup;
	ApplyArcadeProfile(Setup);
	IE_EXPECT_NEAR(Setup.Bot.KickChance, 0.0, 1e-9);
	IE_EXPECT_NEAR(Setup.Bot.ClinchStrikeChance, 0.0, 1e-9);
	IE_EXPECT(Setup.PlayerFighter.CounterWindowTicks > 0 && Setup.OpponentFighter.CounterWindowTicks > 0);

	const int N = 16;
	int LegStrikes = 0; // 1.8.1: in whole bouts the bot must throw none (KickChance 0 alone left the "out of reach: kick" answer on)
	auto Wins = [N, &LegStrikes](BotLevel Level, const HumanProfile& Profile) {
		int W = 0;
		for (int Seed = 1; Seed <= N; ++Seed)
		{
			const BoutSummary B = RunBout(Level, Profile, static_cast<uint64_t>(Seed), true);
			W += (B.bHasWinner && B.Winner == FighterSlot::Player) ? 1 : 0;
			LegStrikes += B.BotLegAndElbowStrikes;
		}
		return W;
	};
	const int Easy = Wins(BotLevel::Easy, AverageHuman());
	const int Normal = Wins(BotLevel::Normal, AverageHuman());
	const int Hard = Wins(BotLevel::Hard, AverageHuman());
	IE_EXPECT(Easy >= Normal && Normal >= Hard);
	IE_EXPECT(Easy >= N - 1);       // the first opponent is there to be beaten
	IE_EXPECT(Normal >= N / 2);     // a fair fight for an average player
	IE_EXPECT(Hard <= N / 2);       // Hard stays hard
	IE_EXPECT(Wins(BotLevel::Hard, SpammerHuman()) <= N / 2);
	IE_EXPECT_EQ(LegStrikes, 0);
}

IE_TEST(Balance_LadderGetsHarderRungByRungAndEachRungFightsItsOwnWay)
{
	MatchSetup Untouched;
	IE_EXPECT(!ApplyLadderRung(Untouched, -1) && !ApplyLadderRung(Untouched, kLadderRungs));
	const int N = 16;
	struct Tally
	{
		int Wins = 0;
		double Blocks = 0, Dodges = 0, Thrown = 0, Minutes = 0;
		int LegStrikes = 0;
	};
	auto Run = [N](int32_t Rung, const HumanProfile& Profile) {
		Tally T;
		for (int Seed = 1; Seed <= N; ++Seed)
		{
			const BoutSummary B = RunBout(BotLevel::Normal, Profile, static_cast<uint64_t>(Seed), true, Rung);
			T.Wins += (B.bHasWinner && B.Winner == FighterSlot::Player) ? 1 : 0;
			T.Blocks += B.BotBlocks;
			T.Dodges += B.BotDodges;
			T.Thrown += B.BotThrown;
			T.Minutes += B.FightSeconds / 60.0;
			T.LegStrikes += B.BotLegAndElbowStrikes;
		}
		return T;
	};
	Tally Avg[kLadderRungs];
	for (int32_t Rung = 0; Rung < kLadderRungs; ++Rung)
	{
		Avg[Rung] = Run(Rung, AverageHuman());
		IE_EXPECT_EQ(Avg[Rung].LegStrikes, 0); // the arcade rules still hold on every rung
	}
	// a newcomer beats the first two; from there each rung is at least as hard as the one before (one bout of slack)
	IE_EXPECT(Run(0, CasualHuman()).Wins >= N - 1);
	IE_EXPECT(Run(1, CasualHuman()).Wins >= N * 3 / 4);
	for (int32_t Rung = 1; Rung < kLadderRungs; ++Rung)
	{
		IE_EXPECT(Avg[Rung].Wins <= Avg[Rung - 1].Wins + 1);
	}
	IE_EXPECT(Avg[2].Wins >= N * 3 / 4); // the middle is learnable ...
	IE_EXPECT(Avg[5].Wins <= N / 3);     // ... the champion is not given away
	// the styles are not just numbers: the counter-puncher defends more than the rookie, the mover slips more than the
	// slugger, the pressure fighter throws more a minute than the counter-puncher, and mashing does not beat the slugger
	IE_EXPECT(Avg[2].Blocks + Avg[2].Dodges > 2.0 * (Avg[0].Blocks + Avg[0].Dodges));
	IE_EXPECT(Avg[3].Dodges > 3.0 * Avg[1].Dodges);
	IE_EXPECT(Avg[4].Thrown / Avg[4].Minutes > 1.3 * (Avg[2].Thrown / Avg[2].Minutes));
	IE_EXPECT(Run(1, SpammerHuman()).Wins <= N * 3 / 4);
}
