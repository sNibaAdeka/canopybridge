// Match flow: waiting for the player, countdown, rounds, breaks, scoring, pause (manual / tracking loss),
// result and rematch. Also hosts the training mode (punching bag, no timer).
#pragma once

#include "IronEchoRules/BotBrain.h"
#include "IronEchoRules/CombatConfig.h"
#include "IronEchoRules/CombatEvents.h"
#include "IronEchoRules/CombatSim.h"
#include "IronEchoRules/InputFrame.h"

#include <cstdint>

namespace IronEchoCore
{
	enum class MatchMode : uint8_t
	{
		Bout = 0,     // player vs bot, rounds
		Training = 1, // player vs passive punching bag, no timer
	};

	struct MatchSetup
	{
		FighterConfig PlayerFighter = MakeDefaultFighterConfig();
		FighterConfig OpponentFighter = MakeBotFighterConfig(BotLevel::Normal);
		FighterConfig TrainingBag = MakeTrainingBagConfig();
		MovementConfig Movement;
		MatchConfig Rules;
		BotConfig Bot = MakeBotConfig(BotLevel::Normal);
		MatchMode Mode = MatchMode::Bout;
		uint64_t Seed = 1;
	};

	struct MatchInput
	{
		FighterIntent PlayerIntent;
		bool bInputReady = false; // tracker Live (or a debug input source is active)
	};

	struct MatchSnapshot
	{
		MatchMode Mode = MatchMode::Bout;
		MatchPhase Phase = MatchPhase::WaitingForPlayer;
		MatchPhase ResumePhase = MatchPhase::Fighting;
		PauseReason Pause = PauseReason::None;
		int32_t Round = 0;             // 1-based, 0 before the first countdown
		int32_t Rounds = 0;
		int32_t RoundTicksLeft = 0;
		int32_t CountdownTicksLeft = 0;
		int32_t BreakTicksLeft = 0;
		int32_t ScorePlayer = 0;
		int32_t ScoreOpponent = 0;
		ResultMethod Result = ResultMethod::None;
		bool bHasWinner = false;
		FighterSlot Winner = FighterSlot::Player;
		int32_t TrainingHits = 0;
		int32_t Tick = 0;              // match clock, advances every Tick() call
		int32_t SimTick = 0;           // advances only when the fight simulation steps
		uint64_t Seed = 0;
	};

	class Match
	{
	public:
		explicit Match(const MatchSetup& InSetup);

		void Restart(MatchMode Mode, uint64_t Seed);

		// Requests are applied at the start of the next Tick().
		void RequestPause() { bPauseRequested = true; }
		void RequestResume() { bResumeRequested = true; }
		void RequestRematch() { bRematchRequested = true; }

		void Tick(const MatchInput& Input, CombatEventBuffer& CombatEvents, MatchEventBuffer& MatchEvents);

		const MatchSnapshot& Snapshot() const { return Snap; }
		const CombatSim& Sim() const { return SimData; }
		const MatchSetup& Setup() const { return SetupData; }

	private:
		void SetPhase(MatchPhase NewPhase, MatchEventBuffer& Events);
		void BeginCountdown(MatchPhase Target, bool bNewRound, MatchEventBuffer& Events);
		void EnterPause(PauseReason Reason, MatchEventBuffer& Events);
		void Resume(MatchEventBuffer& Events);
		void StepFight(const MatchInput& Input, bool bTraining, CombatEventBuffer& CombatEvents, MatchEventBuffer& MatchEvents);
		void EndRound(MatchEventBuffer& Events);
		void FinishMatch(ResultMethod Method, bool bHasWinner, FighterSlot Winner, MatchEventBuffer& Events);
		MatchEvent MakeEvent(MatchEventType Type) const;
		static CombatSim MakeSim(const MatchSetup& Setup, MatchMode Mode);

		MatchSetup SetupData;
		CombatSim SimData;
		BotBrain Bot;
		MatchSnapshot Snap;

		MatchPhase CountdownTarget = MatchPhase::Fighting;
		bool bRoundInProgress = false;
		int32_t ReadyTicks = 0;
		int32_t NotReadyTicks = 0;
		int32_t LastCountdownSecond = 0;

		bool bPauseRequested = false;
		bool bResumeRequested = false;
		bool bRematchRequested = false;
	};
}
