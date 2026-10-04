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
