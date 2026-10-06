// Scripted human-like player for balance checks (tests and Tests/Tools/Balance). Deterministic for a seed.
// It sees only what a person in front of the camera sees: the bot's windup starts, then reacts after a human
// delay (reaction + tracking latency); it throws punches at a human pace that slows down round by round.
#pragma once

#include "IronEchoRules/Match.h"
#include "IronEchoRules/Random.h"

#include <cstdint>

namespace IronEchoTest
{
	using namespace IronEchoCore;

	struct HumanProfile
	{
		const char* Name = "average";
		double ReactMinS = 0.35;    // bot windup start -> defence in place (reaction + camera latency)
		double ReactMaxS = 0.52;
		float BlockShare = 0.50f;   // of the punches the player notices
		float DodgeShare = 0.20f;
		double DefendHoldS = 0.38;
		double PunchGapMinS = 0.80; // pause between own attacks
		double PunchGapMaxS = 1.60;
		float ComboChance = 0.25f;  // jab-cross / cross-jab
		float CrossShare = 0.40f;
		float PunishChance = 0.0f;  // throws at once when the bot is recovering or stunned by a block
		double FatiguePerRound = 0.15; // punch gaps grow by this fraction every round
		bool bRangeDiscipline = false; // 1.2: steps in instead of throwing from out of reach
	};

	inline HumanProfile CasualHuman()
	{
		HumanProfile P;
		P.Name = "casual";
		P.ReactMinS = 0.42;
		P.ReactMaxS = 0.62;
		P.BlockShare = 0.40f;
		P.DodgeShare = 0.10f;
		P.PunchGapMinS = 1.10;
		P.PunchGapMaxS = 2.20;
		P.ComboChance = 0.15f;
		P.FatiguePerRound = 0.20;
		return P;
	}

	inline HumanProfile AverageHuman()
	{
		return HumanProfile{};
	}

	inline HumanProfile SkilledHuman()
	{
		HumanProfile P;
		P.Name = "skilled";
		P.ReactMinS = 0.28;
		P.ReactMaxS = 0.40;
		P.BlockShare = 0.55f;
		P.DodgeShare = 0.30f;
		P.PunchGapMinS = 0.80;
		P.PunchGapMaxS = 1.50;
		P.ComboChance = 0.35f;
		P.CrossShare = 0.45f;
		P.PunishChance = 0.70f;
		P.FatiguePerRound = 0.10;
		P.bRangeDiscipline = true;
		return P;
	}

	// Exploit check: alternates hands as fast as the rules accept and never defends.
	inline HumanProfile SpammerHuman()
	{
		HumanProfile P;
		P.Name = "spammer";
		P.BlockShare = 0.0f;
		P.DodgeShare = 0.0f;
		P.PunchGapMinS = 0.16;
		P.PunchGapMaxS = 0.22;
		P.ComboChance = 0.0f;
		P.CrossShare = 0.5f;
		P.FatiguePerRound = 0.0;
		return P;
	}

	class HumanModel
	{
	public:
		HumanModel(const HumanProfile& InProfile, uint64_t Seed) : Profile(InProfile), Rng(Seed * 2654435761ULL + 17ULL) {}

		FighterIntent Think(const Match& M)
		{
			++Tick;
			FighterIntent Intent;
			const MatchSnapshot& S = M.Snapshot();
			const FighterSnapshot& Me = M.Sim().Get(FighterSlot::Player).Snapshot();
			const FighterSnapshot& Bot = M.Sim().Get(FighterSlot::Opponent).Snapshot();
			if (S.Phase == MatchPhase::Knockdown)
			{
				Intent.bBlock = Me.State == ActionState::KnockedDown; // beat the count: guard up and hold
				return Intent;
			}
			if (S.Phase != MatchPhase::Fighting)
			{
				return Intent;
			}

			// Perception of the bot's punch: the windup is visible, the reaction comes later.
			if (Bot.State == ActionState::Attack && Bot.Stage == AttackStage::Windup && Bot.AttackId != SeenAttackId)
			{
				SeenAttackId = Bot.AttackId;
				ReactTick = Tick + Rng.RangeInclusive(SecondsToTicks(Profile.ReactMinS), SecondsToTicks(Profile.ReactMaxS));
				const float Roll = Rng.NextFloat01();
				PlannedDefense = Roll < Profile.BlockShare ? 1 : (Roll < Profile.BlockShare + Profile.DodgeShare ? 2 : 0);
				DodgeSide = Rng.Chance(0.5f) ? DodgeDir::Left : DodgeDir::Right;
			}
			if (ReactTick >= 0 && Tick >= ReactTick)
			{
				ReactTick = -1;
				if (PlannedDefense != 0)
				{
					DefendUntil = Tick + SecondsToTicks(Profile.DefendHoldS);
					ActiveDefense = PlannedDefense;
				}
			}
			if (Tick < DefendUntil)
			{
				if (ActiveDefense == 1)
				{
					Intent.bBlock = true;
				}
				else
				{
					Intent.Dodge = DodgeSide;
					Intent.LeanLateral = DodgeSide == DodgeDir::Left ? -0.9f : 0.9f;
				}
				return Intent;
			}

			// A disciplined player closes the distance first (keyboard W / leaning in) instead of punching air.
			if (Profile.bRangeDiscipline && M.Sim().Gap() > M.Sim().Get(FighterSlot::Player).GetConfig().Attacks[1].ReachMeters - 0.03f)
			{
				Intent.MoveForward = 1.0f;
				return Intent;
			}

			const bool bBotOpen = (Bot.State == ActionState::Attack && Bot.Stage == AttackStage::Recovery) || Bot.State == ActionState::BlockStun;
			if (bBotOpen && Bot.AttackId != PunishedAttackId && Profile.PunishChance > 0.0f)
			{
				PunishedAttackId = Bot.AttackId;
				if (Rng.Chance(Profile.PunishChance))
				{
					Intent.AddPunch(Rng.Chance(0.5f) ? Hand::Right : Hand::Left);
					return Intent;
				}
			}
			if (ComboTick >= 0 && Tick >= ComboTick)
			{
				ComboTick = -1;
				Intent.AddPunch(ComboHand);
				return Intent;
			}
			if (Tick >= NextPunchTick)
			{
				const Hand Choice = Rng.Chance(Profile.CrossShare) ? Hand::Right : Hand::Left;
				Intent.AddPunch(Choice);
				if (Rng.Chance(Profile.ComboChance))
				{
					ComboHand = OtherHand(Choice);
					ComboTick = Tick + SecondsToTicks(0.22);
				}
				const double Fatigue = 1.0 + Profile.FatiguePerRound * static_cast<double>(S.Round > 1 ? S.Round - 1 : 0);
				NextPunchTick = Tick + static_cast<int32_t>(Fatigue * static_cast<double>(Rng.RangeInclusive(SecondsToTicks(Profile.PunchGapMinS), SecondsToTicks(Profile.PunchGapMaxS))));
			}
			return Intent;
		}

	private:
		HumanProfile Profile;
		Pcg32 Rng;
		int32_t Tick = 0;
		uint32_t SeenAttackId = 0;
		uint32_t PunishedAttackId = 0;
		int32_t ReactTick = -1;
		int32_t PlannedDefense = 0;
		int32_t ActiveDefense = 0;
		DodgeDir DodgeSide = DodgeDir::Left;
		int32_t DefendUntil = -1;
		int32_t NextPunchTick = SecondsToTicks(0.5);
		int32_t ComboTick = -1;
		Hand ComboHand = Hand::Left;
	};

	// Outcome of one full bout between a profile and a bot level.
	struct BoutSummary
	{
		ResultMethod Result = ResultMethod::None;
		bool bHasWinner = false;
		FighterSlot Winner = FighterSlot::Player;
		int32_t LastRound = 0;
		int32_t PlayerKnockdowns = 0; // suffered
		int32_t BotKnockdowns = 0;
		int32_t PlayerThrown = 0;
		int32_t PlayerLanded = 0;
		int32_t BotThrown = 0;
		int32_t BotLanded = 0;
		int32_t BotBlocks = 0;
		int32_t BotDodges = 0;
		double FightSeconds = 0.0;
	};

	inline BoutSummary RunBout(BotLevel Level, const HumanProfile& Profile, uint64_t Seed)
	{
		MatchSetup Setup;
		Setup.Seed = Seed;
		Setup.Bot = MakeBotConfig(Level);
		Setup.OpponentFighter = MakeBotFighterConfig(Level);
		Match M(Setup);
		HumanModel Human(Profile, Seed);
		CombatEventBuffer CombatEvents;
		MatchEventBuffer MatchEvents;
		const int32_t Limit = Setup.Rules.Rounds * (Setup.Rules.RoundTicks + Setup.Rules.BreakTicks + Setup.Rules.CountdownTicks) + SecondsToTicks(600.0);
		for (int32_t Tick = 0; Tick < Limit && M.Snapshot().Phase != MatchPhase::MatchOver; ++Tick)
		{
			MatchInput Input;
			Input.bInputReady = true;
			Input.PlayerIntent = Human.Think(M);
			M.Tick(Input, CombatEvents, MatchEvents);
			CombatEvents.Clear();
			MatchEvents.Clear();
		}
		BoutSummary B;
		const MatchSnapshot& S = M.Snapshot();
		const FighterSnapshot& P = M.Sim().Get(FighterSlot::Player).Snapshot();
		const FighterSnapshot& O = M.Sim().Get(FighterSlot::Opponent).Snapshot();
		B.Result = S.Result;
		B.bHasWinner = S.bHasWinner;
		B.Winner = S.Winner;
		B.LastRound = S.Round;
		B.PlayerKnockdowns = P.KnockdownsSuffered;
		B.BotKnockdowns = O.KnockdownsSuffered;
		B.PlayerThrown = P.PunchesThrown;
		B.PlayerLanded = P.PunchesLanded;
		B.BotThrown = O.PunchesThrown;
		B.BotLanded = O.PunchesLanded;
		B.BotBlocks = O.BlocksMade;
		B.BotDodges = O.DodgesMade;
		B.FightSeconds = static_cast<double>(S.SimTick) / static_cast<double>(kTickRate);
		return B;
	}
}
