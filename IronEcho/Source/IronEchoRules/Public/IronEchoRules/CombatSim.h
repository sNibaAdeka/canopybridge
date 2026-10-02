// Two fighters on a one-dimensional fight line with deterministic two-phase hit resolution
// and automatic distance keeping (the player never has to walk in the room).
#pragma once

#include "IronEchoRules/CombatConfig.h"
#include "IronEchoRules/CombatEvents.h"
#include "IronEchoRules/Fighter.h"
#include "IronEchoRules/InputFrame.h"

namespace IronEchoCore
{
	class CombatSim
	{
	public:
		CombatSim(const FighterConfig& PlayerConfig, const FighterConfig& OpponentConfig, const MovementConfig& InMovement);

		void ResetForMatch();
		void ResetForRound(float HealthRecoveryFraction);
		// Both fighters back to the engage distance around the ring centre (after a knockdown).
		void ResetPositions();
		Fighter& Mutable(FighterSlot Slot) { return Fighters[SlotIndex(Slot)]; }

		// One fixed tick: timers -> intents -> resolution (both sides from the same snapshot) -> movement.
		void Step(const FighterIntent& PlayerIntent, const FighterIntent& OpponentIntent, int32_t Tick, CombatEventBuffer& Events);

		const Fighter& Get(FighterSlot Slot) const { return Fighters[SlotIndex(Slot)]; }
		float Gap() const;
		const MovementConfig& Movement() const { return MovementCfg; }

	private:
		struct PendingOutcome
		{
			AttackOutcome Outcome = AttackOutcome::Pending;
			bool bCounter = false;
		};

		PendingOutcome Evaluate(const Fighter& Attacker, const Fighter& Defender) const;
		void Apply(Fighter& Attacker, Fighter& Defender, const PendingOutcome& Result, int32_t Tick, CombatEventBuffer& Events);
		void Knockback(FighterSlot Defender, float Meters);
		void UpdateMovement(bool bOpponentRetreat);
		void ClampToRing();

		Fighter Fighters[2];
		MovementConfig MovementCfg;
	};
}
