// Tunable combat, movement, match and bot parameters. Distances in metres, durations in ticks.
// Defaults are the v1 baseline; Unreal can override them from Config (UIronEchoSettings).
#pragma once

#include "IronEchoRules/Types.h"

#include <cstdint>

namespace IronEchoCore
{
	struct AttackSpec
	{
		int32_t WindupTicks = 0;
		int32_t ActiveTicks = 0;
		int32_t RecoveryTicks = 0;
		float Damage = 0.0f;
		float StaminaCost = 0.0f;
		float ReachMeters = 0.0f;     // max centre-to-centre gap at which the punch connects
		float KnockbackMeters = 0.0f;
		int32_t HitStunTicks = 0;     // stun applied to the defender on a clean hit
	};

	struct FighterConfig
	{
		float MaxHealth = 100.0f;
		float MaxStamina = 100.0f;
		AttackSpec Attacks[2]; // indexed by HandIndex(): [0] left straight (jab), [1] right straight (cross)

		float StaminaRegenPerSecond = 14.0f;
		int32_t StaminaRegenDelayTicks = SecondsToTicks(0.5);
		float BlockRegenFactor = 0.3f;     // regen multiplier while blocking

		float BlockStaminaCost = 5.0f;     // per blocked punch
		float BlockChipFactor = 0.15f;     // fraction of damage that goes through a block (never KOs)
		int32_t BlockStunTicks = SecondsToTicks(0.12);
		float BlockKnockbackFactor = 0.5f;

		int32_t WhiffPenaltyTicks = SecondsToTicks(0.10); // extra recovery after a dodged / missed punch
		int32_t DodgeMaxEffectiveTicks = SecondsToTicks(0.90); // holding a slip longer stops evading
		float DodgeEntryStaminaCost = 3.0f;

		float TiredWindupMultiplier = 1.4f; // punch started without enough stamina
		float TiredDamageMultiplier = 0.6f;
		float CounterHitMultiplier = 1.2f;  // hitting a defender that is winding up
		int32_t InputBufferTicks = SecondsToTicks(0.15);

		bool bInvulnerable = false; // training bag: takes hits, never loses health
		bool bPassive = false;      // training bag: never acts, never blocks or dodges
	};

	struct MovementConfig
	{
		float EngageDistance = 1.35f;       // preferred centre-to-centre gap
		float MinDistance = 1.00f;
		float RingHalfLength = 2.60f;       // usable half length of the fight line (ropes minus margin)
		float FighterRadius = 0.35f;
		float FollowSpeed = 0.90f;          // automatic distance keeping, m/s
		float RetreatSpeed = 1.10f;         // opponent step-back speed, m/s
		float RetreatExtraDistance = 0.60f;
		float RecenterSpeed = 0.15f;        // pull of the pair midpoint toward the ring centre, m/s
		float Tolerance = 0.02f;
	};

	struct MatchConfig
	{
		int32_t Rounds = 3;
		int32_t RoundTicks = SecondsToTicks(90.0);
		int32_t BreakTicks = SecondsToTicks(8.0);
		int32_t CountdownTicks = SecondsToTicks(3.0);
		float BetweenRoundHealthRecovery = 0.15f; // fraction of max health
		int32_t TrackingLossGraceTicks = SecondsToTicks(0.5);
		int32_t ReadyStableTicks = SecondsToTicks(1.0);   // input must be ready this long to start / resume
		float DrawDamageMargin = 1.0f;                    // round damage difference treated as even
	};

	enum class BotLevel : uint8_t
	{
		Easy = 0,
		Normal = 1,
		Hard = 2,
	};

	struct BotConfig
	{
		// Reaction to the player's visible windup. The player's punches are fast (game-processed), so a
		// human-like 0.25 s would make every punch undefendable; the bot "reads" the windup instead.
		int32_t ReactionTicks = SecondsToTicks(0.11);
		float BlockChance = 0.40f;
		float DodgeChance = 0.20f;
		int32_t DefenseHoldTicks = SecondsToTicks(0.40);
		int32_t AttackIntervalMinTicks = SecondsToTicks(0.8);
		int32_t AttackIntervalMaxTicks = SecondsToTicks(1.7);
		float ComboChance = 0.30f;
		float CrossChance = 0.40f;
		float RetreatStaminaThreshold = 25.0f;
		float RetreatChance = 0.50f;
		int32_t RetreatTicks = SecondsToTicks(1.2);
		float GuardUpChance = 0.25f;     // rolled once per GuardUpPeriodTicks while in range and idle
		int32_t GuardUpTicks = SecondsToTicks(0.6);
		int32_t GuardUpPeriodTicks = SecondsToTicks(1.0);
		float GuardAfterHitChance = 0.45f; // covers up after taking a clean hit
		int32_t GuardAfterHitTicks = SecondsToTicks(0.8);
	};

	// Player fighter: short windups because the camera pipeline already adds ~0.1-0.15 s before the game sees the punch.
	FighterConfig MakeDefaultFighterConfig();
	// Bot fighter: same damage, long telegraphed windups so a human can react with a real slip or block
	// (human reaction ~0.25 s + tracking latency ~0.1 s). See Docs/Contracts/ROBOT_VISUAL_CONTRACT.md "Телеграф".
	FighterConfig MakeBotFighterConfig(BotLevel Level);
	FighterConfig MakeTrainingBagConfig();
	BotConfig MakeBotConfig(BotLevel Level);
	const char* BotLevelName(BotLevel Level);
}
