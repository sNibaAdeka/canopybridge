// Two fighters in a square ring (1.2): footwork on the canvas, both always facing each other, and deterministic
// two-phase hit resolution where a punch is a line toward an aim point and lands only if the target is within
// reach and on that line during the active window (slips and late side steps take the head off it).
#pragma once

#include "IronEchoRules/CombatConfig.h"
#include "IronEchoRules/CombatEvents.h"
#include "IronEchoRules/Fighter.h"
#include "IronEchoRules/InputFrame.h"

namespace IronEchoCore
{
	// Geometry of a punch against a target at this instant (also used by the bot to judge its chances).
	struct PunchGeometry
	{
		float Along = 0.0f;   // distance from the attacker's centre to the target point, along the punch line
		float Offset = 0.0f;  // target point's distance from the punch line
		bool bInReach = false;
		bool bClean = false;  // Offset within the clean radius
		bool bOnLine = false; // Offset within the glancing radius
		float Power = 1.0f;   // distance factor: 1 in the sweet spot, less when smothered
	};

	class CombatSim
	{
	public:
		CombatSim(const FighterConfig& PlayerConfig, const FighterConfig& OpponentConfig, const MovementConfig& InMovement);

		void ResetForMatch();
		void ResetForRound(float HealthRecoveryFraction);
		// Both fighters back to the engage distance around the ring centre (after a knockdown).
		void ResetPositions();
		Fighter& Mutable(FighterSlot Slot) { return Fighters[SlotIndex(Slot)]; }

		// One fixed tick: timers -> intents -> aim -> resolution (both sides from the same snapshot) -> footwork.
		void Step(const FighterIntent& PlayerIntent, const FighterIntent& OpponentIntent, int32_t Tick, CombatEventBuffer& Events);

		const Fighter& Get(FighterSlot Slot) const { return Fighters[SlotIndex(Slot)]; }
		// Centre-to-centre distance on the canvas.
		float Gap() const;
		// Unit vector from Slot toward the other fighter.
		Vec2 FacingOf(FighterSlot Slot) const;
		// The point a punch at this zone of Slot aims for: the head (slip included) or the body centre.
		Vec2 TargetPoint(FighterSlot Slot, PunchZone Zone) const;
		// How far Slot can still go before a rope, moving along Dir (unit). 0 = against the rope.
		float RoomAlong(FighterSlot Slot, Vec2 Dir) const;
		// Geometry of Attacker's punch (hand, zone) aimed at Aim, against the defender as it stands now.
		PunchGeometry Measure(FighterSlot Attacker, const AttackSpec& Spec, PunchZone Zone, Vec2 Aim) const;
		const MovementConfig& Movement() const { return MovementCfg; }

	private:
		struct PendingOutcome
		{
			AttackOutcome Outcome = AttackOutcome::Pending;
			bool bCounter = false;
			bool bGlancing = false;
			bool bSmothered = false;
			float Power = 1.0f;
		};

		void UpdateAim(int32_t Index);
		PendingOutcome Evaluate(const Fighter& Attacker, const Fighter& Defender) const;
		void Apply(Fighter& Attacker, Fighter& Defender, const PendingOutcome& Result, int32_t Tick, CombatEventBuffer& Events);
		void Knockback(FighterSlot Defender, float Meters);
		void UpdateMovement(const FighterIntent& PlayerIntent, const FighterIntent& OpponentIntent);
		void SeparateAndClamp();
		void UpdateFacing();
		float Limit() const { return MovementCfg.RingHalfSize - MovementCfg.FighterRadius; }

		Fighter Fighters[2];
		MovementConfig MovementCfg;
		uint32_t AimedAttackId[2] = {0, 0};
		float AimSlip[2] = {0.0f, 0.0f}; // how much of the target's head slip the aim has followed so far
	};
}
