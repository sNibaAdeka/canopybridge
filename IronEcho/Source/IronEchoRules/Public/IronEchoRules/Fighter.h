// One fighter's combat state machine. Driven by CombatSim; never by Unreal directly.
#pragma once

#include "IronEchoRules/CombatConfig.h"
#include "IronEchoRules/CombatEvents.h"
#include "IronEchoRules/InputFrame.h"

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
		bool bBlocking = false;
		DodgeDir Dodge = DodgeDir::None;
		int32_t DodgeHeldTicks = 0;
		bool bDodgeEffective = false;
		float LeanLateral = 0.0f;
		float Position = 0.0f;        // metres along the fight line, +X toward the opponent's side
		// Statistics for the current round / match.
		float RoundDamageDealt = 0.0f;
		float TotalDamageDealt = 0.0f;
		int32_t PunchesThrown = 0;
		int32_t PunchesLanded = 0;
		int32_t PunchesBlocked = 0;   // this fighter's punches that were blocked
		int32_t DodgesMade = 0;

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

		void ResetForMatch(float Position);
		void ResetForRound(float Position, float HealthRecoveryFraction);

		// Phase A1: advance timers by one tick (stage transitions, stun expiry, stamina regen).
		void AdvanceTimers(int32_t Tick, CombatEventBuffer& Events);
		// Phase A2: apply this tick's intent (block, dodge, punch requests, input buffer).
		void ApplyIntent(const FighterIntent& Intent, int32_t Tick, CombatEventBuffer& Events);

		// Resolution queries (phase B).
		bool HasPendingActiveAttack() const;
		bool IsLastActiveTick() const;
		const AttackSpec& CurrentAttackSpec() const;
		bool IsDodgeEffective() const { return Snap.bDodgeEffective; }
		bool IsBlocking() const { return Snap.bBlocking; }
		bool IsWindingUp() const { return Snap.State == ActionState::Attack && Snap.Stage == AttackStage::Windup; }
		bool IsKnockedOut() const { return Snap.State == ActionState::KnockedOut; }
		bool CanAffordBlock() const { return Snap.Stamina >= Config.BlockStaminaCost; }
		float CurrentAttackDamage(bool bCounter) const;

		// Phase C: outcome application. Return the damage actually applied.
		void OnAttackResolved(AttackOutcome Outcome, float DamageDealt);
		float ReceiveHit(const AttackSpec& Spec, float Damage, int32_t Tick, CombatEventBuffer& Events, uint32_t AttackerAttackId);
		float ReceiveBlockedHit(const AttackSpec& Spec, float Damage, int32_t Tick);

		void SetPosition(float NewPosition) { Snap.Position = NewPosition; }
		void ClearRoundStats() { Snap.RoundDamageDealt = 0.0f; }
		void NoteDodge() { ++Snap.DodgesMade; }

		const FighterSnapshot& Snapshot() const { return Snap; }
		const FighterConfig& GetConfig() const { return Config; }

	private:
		bool CanStartAttack(Hand InHand) const;
		void StartAttack(Hand InHand, int32_t Tick, CombatEventBuffer& Events);
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
	};
}
