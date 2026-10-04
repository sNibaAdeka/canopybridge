// Balance report: many full bouts of the real IronEchoRules core, bot level x human profile.
// Build and run: see README.md next to this file.
#include "HumanModel.h"

#include <cstdio>
#include <cstdlib>

using namespace IronEchoTest;

int main(int argc, char** argv)
{
	const int Bouts = argc > 1 ? std::atoi(argv[1]) : 100;
	const HumanProfile Profiles[4] = {CasualHuman(), AverageHuman(), SkilledHuman(), SpammerHuman()};
	std::printf("%-7s %-8s %5s %5s %5s %5s %5s %5s %6s %6s %6s %6s %6s %6s\n", "bot", "human", "win%", "lose%", "draw%", "dec%",
		"stopR1", "rnd", "kdP", "kdBot", "pThr/r", "pAcc%", "bThr/r", "bAcc%");
	for (int L = 0; L <= 2; ++L)
	{
		for (const HumanProfile& Profile : Profiles)
		{
			int Wins = 0, Losses = 0, Draws = 0, Decisions = 0, StopR1 = 0;
			double Rounds = 0, KdP = 0, KdB = 0, PThrown = 0, PLanded = 0, BThrown = 0, BLanded = 0, Minutes = 0;
			for (int Seed = 1; Seed <= Bouts; ++Seed)
			{
				const BoutSummary B = RunBout(static_cast<BotLevel>(L), Profile, static_cast<uint64_t>(Seed));
				if (!B.bHasWinner) ++Draws;
				else if (B.Winner == FighterSlot::Player) ++Wins;
				else ++Losses;
				Decisions += (B.Result == ResultMethod::Decision || B.Result == ResultMethod::Draw) ? 1 : 0;
				StopR1 += ((B.Result == ResultMethod::KnockOut || B.Result == ResultMethod::TechnicalKnockOut) && B.LastRound == 1) ? 1 : 0;
				Rounds += B.LastRound;
				KdP += B.PlayerKnockdowns;
				KdB += B.BotKnockdowns;
				PThrown += B.PlayerThrown;
				PLanded += B.PlayerLanded;
				BThrown += B.BotThrown;
				BLanded += B.BotLanded;
				Minutes += B.FightSeconds / 90.0; // in round-lengths
			}
			const double N = Bouts;
			std::printf("%-7s %-8s %5.0f %5.0f %5.0f %5.0f %6.0f %5.2f %6.2f %6.2f %6.1f %6.0f %6.1f %6.0f\n", BotLevelName(static_cast<BotLevel>(L)),
				Profile.Name, 100.0 * Wins / N, 100.0 * Losses / N, 100.0 * Draws / N, 100.0 * Decisions / N, 100.0 * StopR1 / N, Rounds / N,
				KdP / N, KdB / N, PThrown / Minutes, PThrown > 0 ? 100.0 * PLanded / PThrown : 0.0, BThrown / Minutes,
				BThrown > 0 ? 100.0 * BLanded / BThrown : 0.0);
		}
	}
	return 0;
}
