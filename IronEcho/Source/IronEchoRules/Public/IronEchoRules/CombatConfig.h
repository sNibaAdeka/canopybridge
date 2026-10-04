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

		float BlockStaminaCost = 5.0f;     // per blocked full-power punch (scaled by the punch's actual damage)
		float BlockChipFactor = 0.15f;     // fraction of damage that goes through a block (never KOs)
		int32_t BlockStunTicks = SecondsToTicks(0.12);
		float BlockKnockbackFactor = 0.5f;
		// Cover-up: after this much of a hit stun a fighter who wants to block raises the guard at once.
		// Punching stays locked until the stun would have ended, so covering up never shortens offence recovery.
		int32_t CoverUpTicks = SecondsToTicks(0.10);

		int32_t WhiffPenaltyTicks = SecondsToTicks(0.10); // extra recovery after a dodged / missed punch
		int32_t DodgeMaxEffectiveTicks = SecondsToTicks(0.90); // holding a slip longer stops evading
		float DodgeEntryStaminaCost = 3.0f;

		// A punch started without enough stamina is an arm punch: slow, weak, short stun, and a guard absorbs it
		// cheaply (block drain scales with the punch's damage), so an exhausted flurry cannot break a guard.
		float TiredWindupMultiplier = 1.6f;
		float TiredDamageMultiplier = 0.3f;
		float TiredHitStunMultiplier = 0.5f;
		// Gassed: emptying the stamina tank costs a breath, no new punch for this long (flailing stops itself).
		int32_t GassedTicks = SecondsToTicks(0.60);
		float CounterHitMultiplier = 1.2f;  // hitting a defender that is winding up
		int32_t InputBufferTicks = SecondsToTicks(0.15);

		bool bInvulnerable = false; // training bag: takes hits, never loses health
		bool bPassive = false;      // training bag: never acts, never blocks or dodges

		bool bKnockdowns = true;               // health 0 -> knocked down for a count instead of instant KO
		float KnockdownRecoverHealth = 0.50f;  // fraction of max health after the first get-up
		float KnockdownRecoverDecay = 0.70f;   // each further knockdown in the match multiplies the above
		float GetUpStamina = 0.50f;            // fraction of max stamina after a get-up
		int32_t ComboWindowTicks = SecondsToTicks(1.0); // next clean hit within this window extends the combo
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
		float DrawDamageMargin = 1.0f;                    // round score difference treated as even

		// Knockdowns and the referee count.
		bool bKnockdowns = true;
		int32_t MaxKnockdownsPerRound = 3;                // the third knockdown in a round is a TKO
		int32_t CountStepTicks = SecondsToTicks(1.0);
		int32_t CountTo = 10;
		int32_t MinDownTicks = SecondsToTicks(2.0);       // nobody beats the count before this
		int32_t GetUpHoldTicks = SecondsToTicks(1.2);     // player: hold the guard up this long to stand
		int32_t PostGetUpTicks = SecondsToTicks(1.0);     // "box!" pause before the fight resumes
		int32_t MinPointsPerRound = 7;

		// Three judges score each round on (damage + LandedWeight*landed + DefenseWeight*defences).
		// Judge 1 is neutral (damage only), judge 2 rewards volume, judge 3 rewards defence.
		float JudgeLandedWeight[3] = {0.0f, 3.0f, 0.0f};
		float JudgeDefenseWeight[3] = {0.0f, 0.0f, 2.5f};
	};

	enum class BotLevel : uint8_t
	{
		Easy = 0,
		Normal = 1,
		Hard = 2,
	};

	struct BotConfig
	{
		// Reaction to the player's visible windup. The player's punches are fast (game-processed, the camera
		// already saw ~0.1 s of the real movement), so the bot "reads" the windup: to defend a jab the reaction
		// must be shorter than the jab windup (0.09 s). Easy cannot, Normal and Hard can.
		int32_t ReactionTicks = SecondsToTicks(0.06);
		float BlockChance = 0.45f;
		float DodgeChance = 0.15f;
		// Reading a flurry: every punch after the second one inside FlurryGapTicks adds this much block chance.
		float FlurryBlockBonus = 0.12f;
		int32_t FlurryGapTicks = SecondsToTicks(0.60);
		float MaxBlockChance = 0.80f;
		int32_t DefenseHoldTicks = SecondsToTicks(0.40);
		int32_t AttackIntervalMinTicks = SecondsToTicks(0.85);
		int32_t AttackIntervalMaxTicks = SecondsToTicks(1.70);
		// Timing: chance per attempt to wait while the player is winding up or punching (no blind trades);
		// the attempt is retried, so the bot tends to fire into the player's recovery instead.
		float AvoidTradeChance = 0.50f;
		// A planned attack that cannot start (stunned, mid-action, out of range, no stamina) is retried this
		// soon instead of waiting a whole interval: a hit bot fires back instead of going passive.
		int32_t AttackRetryTicks = SecondsToTicks(0.12);
		// Block-and-counter: after a successful block or slip, chance to fire back right away.
		float CounterChance = 0.35f;
		int32_t CounterDelayTicks = SecondsToTicks(0.05);
		float CounterCrossChance = 0.60f;
		// Hurt: below this health fraction the bot fights to survive, covers up more and attacks less often.
		float HurtHealthFraction = 0.30f;
		float HurtBlockBonus = 0.15f;
		float HurtGuardUpBonus = 0.25f;
		float HurtIntervalScale = 1.25f;
		// Pressure: once the player is gassed (stamina below this), the bot stops covering up and walks through
		// the arm punches (which cannot interrupt its windup) with shorter pauses between attacks.
		float PressureStaminaThreshold = 15.0f;
		float PressureIntervalScale = 0.55f;
		float ComboChance = 0.35f;
		float CrossChance = 0.40f;
		float RetreatStaminaThreshold = 25.0f;
		float RetreatChance = 0.50f;
		int32_t RetreatTicks = SecondsToTicks(1.2);
		float GuardUpChance = 0.30f;     // rolled once per GuardUpPeriodTicks while in range and idle
		int32_t GuardUpTicks = SecondsToTicks(0.6);
		int32_t GuardUpPeriodTicks = SecondsToTicks(1.0);
		float GuardAfterHitChance = 0.45f; // covers up after taking a clean hit
		int32_t GuardAfterHitTicks = SecondsToTicks(0.8);
		float GetUpChance[3] = {0.90f, 0.65f, 0.35f}; // per knockdown in the match (1st, 2nd, 3rd+)
		int32_t GetUpCountMin = 3;
		int32_t GetUpCountMax = 8;
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
