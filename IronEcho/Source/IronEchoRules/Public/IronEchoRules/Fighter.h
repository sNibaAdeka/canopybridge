// One fighter's combat state machine. Driven by CombatSim; never by Unreal directly.
#pragma once

#include "IronEchoRules/CombatConfig.h"
#include "IronEchoRules/CombatEvents.h"
#include "IronEchoRules/InputFrame.h"

#include <algorithm>
#include <cstdint>

namespace IronEchoCore
{
	enum class ActionState : uint8_t
	{
		Guard = 0,
		Attack,
		Block,
		HitStun,
		BlockStun,
		KnockedOut,
		KnockedDown, // down for the count (1.1)
	};

	enum class AttackStage : uint8_t
	{
		None = 0,
		Windup,
		Active,
		Recovery,
	};

	const char* ActionStateName(ActionState State);
	const char* AttackStageName(AttackStage Stage);

	struct FighterSnapshot
	{
		FighterSlot Slot = FighterSlot::Player;
		float Health = 0.0f;
		float MaxHealth = 0.0f;
		float Stamina = 0.0f;
		float MaxStamina = 0.0f;
		ActionState State = ActionState::Guard;
		AttackStage Stage = AttackStage::None;
		Hand AttackHand = Hand::Left;
		uint32_t AttackId = 0;
		bool bAttackResolved = false;
		bool bAttackTired = false;
		int32_t StageTicksTotal = 0;
		int32_t StageTicksLeft = 0;
		int32_t StateTicksLeft = 0;   // remaining stun ticks
		int32_t GassedTicksLeft = 0;  // > 0: out of breath after emptying the stamina, cannot start a punch
		bool bBlocking = false;
		DodgeDir Dodge = DodgeDir::None;
		int32_t DodgeHeldTicks = 0;
		bool bDodgeEffective = false;
		float LeanLateral = 0.0f;
		// ---- ring (1.2) ----
		Vec2 Location;                // centre of the fighter on the canvas (ring frame, see Vec2)
		Vec2 Facing{1.0f, 0.0f};      // unit vector toward the opponent (a vector, not an angle: no libm in the rules)
		Vec2 Velocity;                // m/s on the canvas
		float SpeedForward = 0.0f;    // m/s toward the opponent (- = backing off)
		float SpeedSide = 0.0f;       // m/s circling to the fighter's own right
		bool bMoving = false;
		bool bOnRopes = false;        // within MovementConfig.RopeMargin of a rope: no room to back off
		float HeadOffset = 0.0f;      // m, head off the centre line to the fighter's right (the real slip)
		PunchZone AttackZone = PunchZone::Head;
		AttackKind AttackType = AttackKind::Punch; // hand or leg strike (1.4)
		int32_t LegSlowTicksLeft = 0;              // > 0: legs hurt, movement slowed (1.4)
		Vec2 AimPoint;                // where the current punch goes (tracks the target in the windup, then frozen)
		int32_t BodyPunchesLanded = 0;
		int32_t KicksThrown = 0;
		int32_t KicksLanded = 0;
		int32_t GlancingHits = 0;     // this fighter's punches that only grazed
		// Statistics for the current round / match.
		float RoundDamageDealt = 0.0f;
		float TotalDamageDealt = 0.0f;
		int32_t PunchesThrown = 0;
		int32_t PunchesLanded = 0;
		int32_t PunchesBlocked = 0;   // this fighter's punches that were blocked
		int32_t DodgesMade = 0;
		int32_t BlocksMade = 0;
		int32_t CounterHits = 0;
		int32_t ComboCount = 0;       // current run of clean hits
		int32_t MaxCombo = 0;
		int32_t KnockdownsSuffered = 0;     // match total
		int32_t RoundKnockdownsSuffered = 0;
		int32_t RoundPunchesLanded = 0;
		int32_t RoundDefenses = 0;          // dodges + blocks this round

		// Normalised progress of the current attack stage, 0 at stage start, 1 at stage end.
		float StageAlpha() const
		{
			if (StageTicksTotal <= 0)
			{
				return 0.0f;
			}
			const int32_t Elapsed = StageTicksTotal - StageTicksLeft;
			return Clamp(static_cast<float>(Elapsed) / static_cast<float>(StageTicksTotal), 0.0f, 1.0f);
		}
	};

	enum class AttackOutcome : uint8_t
	{
		Pending = 0,
		Hit,
		Blocked,
		GuardBroken,
		Dodged,
		Whiffed,
	};

	class Fighter
	{
	public:
		Fighter(FighterSlot InSlot, const FighterConfig& InConfig);

		void ResetForMatch(Vec2 Location);
		void ResetForRound(Vec2 Location, float HealthRecoveryFraction);

		// Phase A1: advance timers by one tick (stage transitions, stun expiry, stamina regen).
		void AdvanceTimers(int32_t Tick, CombatEventBuffer& Events);
		// Phase A2: apply this tick's intent (block, dodge, punch requests, input buffer).
		void ApplyIntent(const FighterIntent& Intent, int32_t Tick, CombatEventBuffer& Events);

		// Resolution queries (phase B).
		bool HasPendingActiveAttack() const;
		bool IsLastActiveTick() const;
		// The current punch's spec with its zone applied (body shots: shorter, weaker, dearer).
		AttackSpec CurrentAttackSpec() const;
		AttackSpec SpecFor(Hand InHand, PunchZone Zone, AttackKind Kind = AttackKind::Punch) const;
		bool IsDodgeEffective() const { return Snap.bDodgeEffective; }
		bool IsBlocking() const { return Snap.bBlocking; }
		bool IsWindingUp() const { return Snap.State == ActionState::Attack && Snap.Stage == AttackStage::Windup; }
		bool IsKnockedOut() const { return Snap.State == ActionState::KnockedOut; }
		bool IsKnockedDown() const { return Snap.State == ActionState::KnockedDown; }
		bool IsDown() const { return IsKnockedOut() || IsKnockedDown(); }
		// Stamina a guard pays to stop a punch of this damage from an attack with this full damage.
		float BlockDrain(float Damage, float FullDamage, PunchZone Zone = PunchZone::Head) const
		{
			const float Power = FullDamage > 0.0f ? Clamp(Damage / FullDamage, 0.0f, 2.0f) : 1.0f;
			return Config.BlockStaminaCost * Power * (Zone == PunchZone::Body ? Config.BodyBlockDrainFactor : 1.0f);
			// (a leg kick never reaches the guard: CombatSim skips the block for PunchZone::Leg)
		}
		// The guard holds while it can pay for the punch; an empty tank breaks it.
		bool CanAffordBlock(float Drain) const { return Snap.Stamina >= Drain; }
		float CurrentAttackDamage(bool bCounter) const;
		int32_t CurrentAttackHitStun() const;

		// Phase C: outcome application. Return the damage actually applied.
		void OnAttackResolved(AttackOutcome Outcome, float DamageDealt, bool bCounter, int32_t Tick);
		// StunTicks < 0: the attack's full HitStunTicks. bArmPunch: a tired punch, which cannot interrupt a punch
		// this fighter is already winding up (the damage still counts).
		float ReceiveHit(const AttackSpec& Spec, float Damage, int32_t Tick, CombatEventBuffer& Events, uint32_t AttackerAttackId,
			int32_t StunTicks = -1, bool bArmPunch = false);
		float ReceiveBlockedHit(const AttackSpec& Spec, float Damage, int32_t Tick, PunchZone Zone = PunchZone::Head);
		// A body shot takes the wind: stamina lost (can empty the tank and gas the fighter).
		void TakeStaminaDamage(float Amount, int32_t Tick, CombatEventBuffer& Events);

		// Ring state, written by CombatSim.
		void SetLocation(Vec2 NewLocation) { Snap.Location = NewLocation; }
		void SetMotion(float Forward, float Side, Vec2 InVelocity, Vec2 InFacing, bool bInOnRopes)
		{
			Snap.SpeedForward = Forward;
			Snap.SpeedSide = Side;
			Snap.Velocity = InVelocity;
			Snap.Facing = InFacing;
			Snap.bOnRopes = bInOnRopes;
			Snap.bMoving = InVelocity.LengthSquared() > 0.04f; // faster than 0.2 m/s
		}
		void SetAimPoint(Vec2 Point) { Snap.AimPoint = Point; }
		void NoteGlancing() { ++Snap.GlancingHits; }
		// A low kick: the legs go (slow, cumulative up to LegSlowMaxTicks).
		void ApplyLegSlow(int32_t Ticks)
		{
			Snap.LegSlowTicksLeft = (std::min)(Snap.LegSlowTicksLeft + Ticks, Config.LegSlowMaxTicks);
		}
		void ClearRoundStats();
		void NoteDodge();

		// Knockdown resolution (driven by Match).
		void GetUp(int32_t Tick, CombatEventBuffer& Events);
		void ForceKnockOut(int32_t Tick, CombatEventBuffer& Events);

		const FighterSnapshot& Snapshot() const { return Snap; }
		const FighterConfig& GetConfig() const { return Config; }

	private:
		bool CanStartAttack(Hand InHand, AttackKind Kind) const;
		void StartAttack(Hand InHand, PunchZone Zone, AttackKind Kind, int32_t Tick, CombatEventBuffer& Events);
		void EnterGuardOrBlock(bool bWantBlock, int32_t Tick, CombatEventBuffer& Events);
		void SpendStamina(float Amount, int32_t Tick, CombatEventBuffer& Events);
		CombatEvent MakeEvent(CombatEventType Type, int32_t Tick) const;

		FighterConfig Config;
		FighterSnapshot Snap;
		AttackOutcome LastOutcome = AttackOutcome::Pending;
		bool bWantsBlock = false;
		int32_t LastStaminaSpendTick = -1000000;
		uint32_t NextAttackId = 1;
		int32_t CurrentTick = 0;

		bool bHasBuffered = false;
		PunchRequest Buffered;
		int32_t BufferedExpiresTick = 0;
		int32_t LastLandedTick = -1000000;
		int32_t StunTicksElapsed = 0;
		int32_t GassedUntilTick = -1000000;
		int32_t AttackLockedUntilTick = -1000000; // cover-up keeps the rest of the hit stun for punches
		bool bSlipWeak = false; // the slip started without the stamina to pay for it: half a slip
	};
}
