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
		float ReachMeters = 0.0f;     // max distance from the attacker's centre to the target point (head) at contact
		float KnockbackMeters = 0.0f;
		int32_t HitStunTicks = 0;     // stun applied to the defender on a clean hit
	};

	struct FighterConfig
	{
		float MaxHealth = 100.0f;
		float MaxStamina = 100.0f;
		AttackSpec Attacks[2]; // indexed by HandIndex(): [0] left straight (jab), [1] right straight (cross)
		AttackSpec Kicks[2];   // [0] lead leg (front kick / teep), [1] rear leg (round kick) (1.4)
		// Close range (1.6): an elbow to the head and a knee to the body. Short reach (they only land when the fighters are
		// close, inside the punches' sweet spot), fast and heavy; the elbow can be slipped and blocked, the knee only blocked.
		AttackSpec Elbows[2];  // [0] lead arm, [1] rear arm
		AttackSpec Knees[2];   // [0] lead leg, [1] rear leg

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

		// ---- precision (1.2): a punch is a line from the attacker toward an aim point, the hit is geometric ----
		// The aim follows the target's body (leading its movement) during the windup, but a head slip only at
		// AimTrackSpeed; AimCommitTicks before the active window the aim point freezes. So a slip or a change of
		// direction made late takes the head off the line, while one held from early on is tracked and hit.
		float AimTrackSpeed = 0.50f;         // m/s of head slip followed
		int32_t AimCommitTicks = SecondsToTicks(0.10);
		float AimLeadFactor = 0.8f;          // fraction of the target's own movement anticipated
		float HeadSlipMeters = 0.30f;        // head shift off the centre line at a full lean (|LeanLateral| = 1)
		float HeadSlipSpeed = 5.0f;          // m/s: a full keyboard slip takes 0.06 s (a camera lean is already real motion)
		float HeadHitRadius = 0.12f;         // glove centre within this of the head: clean
		float HeadGlanceRadius = 0.22f;      // within this: glancing blow; beyond: miss
		float BodyHitRadius = 0.20f;         // the torso is wide and does not move with a slip
		float BodyGlanceRadius = 0.30f;
		float GlancingDamageFactor = 0.45f;  // damage and stun of a glancing blow
		// Distance: full power in the last SweetSpotMeters of the reach (arm extended); closer, the punch is
		// smothered and loses power down to SmotheredDamageFactor at the clinch distance (MovementConfig.MinDistance).
		float SweetSpotMeters = 0.30f;
		float SmotheredDamageFactor = 0.50f;
		// Body shots: a little shorter, less damage, but they take the stamina and a guard pays more to stop them.
		float BodyReachDelta = -0.08f;
		float BodyDamageFactor = 0.70f;
		float BodyStaminaDamage = 9.0f;      // defender's stamina lost to a full clean body shot
		float BodyBlockDrainFactor = 1.8f;
		float BodyStaminaCostFactor = 1.10f;

		// ---- kicks (1.4) ----
		// Kicks reach further than punches and hit harder, but wind up slowly, cost a lot of breath, leave the fighter
		// standing on one leg (no cancel out of the recovery, hardly any movement) and a missed one hurts more.
		float KickMoveFactor = 0.12f;
		float KickMidDamageFactor = 1.0f;    // kick to the body
		float KickBodyStaminaDamage = 11.0f; // defender's stamina lost to a full clean mid kick
		float LegKickDamageFactor = 0.50f;   // low kick: little health damage...
		float LegKickReachDelta = -0.05f;
		float LegKickStaminaDamage = 7.0f;
		int32_t LegSlowTicks = SecondsToTicks(1.6); // ...but the legs go: slowed, and every further low kick adds time
		int32_t LegSlowMaxTicks = SecondsToTicks(4.0);
		float LegSlowFactor = 0.55f;         // movement speed multiplier while slowed
		int32_t KickWhiffPenaltyTicks = SecondsToTicks(0.22);
		float KneeBodyStaminaDamage = 10.0f; // defender's stamina lost to a full clean knee (1.6)

		// ---- footwork (1.2) ----
		float StepForwardSpeed = 1.50f;      // m/s
		float StepBackSpeed = 1.35f;
		float CircleSpeed = 1.45f;           // tangential, around the opponent
		float MoveAccel = 9.0f;              // m/s^2 toward the wanted velocity (weight: no instant starts)
		float MoveBrake = 14.0f;             // m/s^2 when stopping or reversing
		float AttackMoveFactor = 0.35f;      // moving while punching (a step-in jab still carries the body)
		float BlockMoveFactor = 0.60f;
		float GassedMoveFactor = 0.60f;
		float MoveRegenFactor = 0.75f;       // stamina regen multiplier while moving
	};

	// The ring (1.2): a square of ropes, fighters are discs on the canvas and always face each other.
	struct MovementConfig
	{
		float EngageDistance = 1.35f;       // starting centre-to-centre gap; also the bot's working distance
		float MinDistance = 1.00f;          // clinch distance: bodies never get closer
		float RingHalfSize = 2.95f;         // ropes at |X| and |Y| = this (5.9 m between the ropes)
		float FighterRadius = 0.35f;
		float RopeMargin = 0.15f;           // within this of the rope limit a fighter is "on the ropes"
		// Assist for a player who does not walk (camera play): beyond this gap the player's robot closes in by
		// itself at AutoCloseFactor of the step speed. Inside it, distance is the player's own business. 0 = off.
		float PlayerAutoCloseGap = 1.38f;
		float AutoCloseFactor = 0.80f;
		float BagReturnSpeed = 0.9f;        // training bag swinging back to the engage distance, m/s
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
		// ---- footwork (1.2) ----
		float RangeSlack = 0.06f;           // works at MovementConfig.EngageDistance +- this
		float CircleChance = 0.40f;         // rolled every CircleRollTicks between exchanges
		int32_t CircleRollTicks = SecondsToTicks(1.1);
		int32_t CircleMinTicks = SecondsToTicks(0.5);
		int32_t CircleMaxTicks = SecondsToTicks(1.3);
		float CircleSpeed = 0.60f;          // fraction of the full circling speed
		float StepBackChance = 0.10f;       // after its own punch: step straight back out (hit and move)
		bool bCutOffRing = true;            // walks a player on the ropes down instead of circling
		// Kicks (1.4): share of planned attacks that are kicks, of those the share of round kicks (rear leg) and of low
		// kicks (legs, against a player who walks, instead of the body).
		float KickChance = 0.12f;
		float RoundKickShare = 0.55f;
		float LegKickShare = 0.35f;
		// Close range (1.6): when the foe is inside elbow reach, the share of planned punches that become an elbow or a knee.
		float ClinchStrikeChance = 0.35f;
		// Offence: body shots, more of them against a guard.
		float BodyShotChance = 0.12f;
		float BodyVsGuardBonus = 0.30f;
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
