// Opponent AI. Deterministic for a given seed and input history (PCG32, fixed decision order).
// It perceives the player's attack only through the rules snapshot and reacts after ReactionTicks,
// so it cannot read inputs the player has not committed yet.
#pragma once

#include "IronEchoRules/CombatConfig.h"
#include "IronEchoRules/CombatSim.h"
#include "IronEchoRules/InputFrame.h"
#include "IronEchoRules/Random.h"

#include <cstdint>

namespace IronEchoCore
{
	class BotBrain
	{
	public:
		BotBrain(const BotConfig& InConfig, uint64_t Seed);

		void Reset(uint64_t Seed);
		FighterIntent Think(const CombatSim& Sim, int32_t Tick);
		// Decided when the bot is knocked down: referee count at which it stands, or -1 to stay down.
		int32_t DecideGetUpCount(int32_t KnockdownNumber);

		const BotConfig& GetConfig() const { return Config; }
		void SetConfig(const BotConfig& InConfig) { Config = InConfig; }

	private:
		enum class Defense : uint8_t
		{
			None = 0,
			Block,
			DodgeLeft,
			DodgeRight,
		};

		BotConfig Config;
		Pcg32 Rng;
		bool bInitialized = false;

		uint32_t LastSeenPlayerAttackId = 0;
		bool bReactionPending = false;
		int32_t ReactionTick = 0;
		uint32_t ReactingToAttackId = 0;
		Defense PlannedDefense = Defense::None;
		Defense ActiveDefense = Defense::None;
		int32_t DefenseUntilTick = 0;

		int32_t NextAttackTick = 0;
		Hand PlannedHand = Hand::Left;
		bool bComboQueued = false;
		Hand ComboHand = Hand::Left;
		int32_t ComboTick = 0;

		int32_t RetreatUntilTick = -1;
		int32_t NextRetreatRollTick = 0;
		int32_t NextGuardRollTick = 0;
		int32_t GuardUpUntilTick = -1;
		float LastHealth = -1.0f;

		int32_t FlurryCount = 0;
		int32_t LastPlayerAttackTick = -1000000;
		int32_t LastDefenses = -1;
	};
}
