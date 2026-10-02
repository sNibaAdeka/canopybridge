#include "IronEchoRules/Fighter.h"

#include <algorithm>
#include <cmath>

namespace IronEchoCore
{
	const char* ActionStateName(ActionState State)
	{
		switch (State)
		{
		case ActionState::Guard: return "Guard";
		case ActionState::Attack: return "Attack";
		case ActionState::Block: return "Block";
		case ActionState::HitStun: return "HitStun";
		case ActionState::BlockStun: return "BlockStun";
		case ActionState::KnockedOut: return "KnockedOut";
		}
		return "Unknown";
	}

	const char* AttackStageName(AttackStage Stage)
	{
		switch (Stage)
		{
		case AttackStage::None: return "None";
		case AttackStage::Windup: return "Windup";
		case AttackStage::Active: return "Active";
		case AttackStage::Recovery: return "Recovery";
		}
		return "Unknown";
	}

	Fighter::Fighter(FighterSlot InSlot, const FighterConfig& InConfig)
		: Config(InConfig)
	{
		Snap.Slot = InSlot;
		ResetForMatch(0.0f);
	}

	void Fighter::ResetForMatch(float Position)
	{
		const FighterSlot Slot = Snap.Slot;
		Snap = FighterSnapshot{};
		Snap.Slot = Slot;
		Snap.MaxHealth = Config.MaxHealth;
		Snap.Health = Config.MaxHealth;
		Snap.MaxStamina = Config.MaxStamina;
		Snap.Stamina = Config.MaxStamina;
		Snap.Position = Position;
		LastOutcome = AttackOutcome::Pending;
		bWantsBlock = false;
		LastStaminaSpendTick = -1000000;
		bHasBuffered = false;
	}

	void Fighter::ResetForRound(float Position, float HealthRecoveryFraction)
	{
		Snap.Health = Clamp(Snap.Health + HealthRecoveryFraction * Config.MaxHealth, 0.0f, Config.MaxHealth);
		Snap.Stamina = Config.MaxStamina;
		Snap.State = Snap.Health > 0.0f ? ActionState::Guard : ActionState::KnockedOut;
		Snap.Stage = AttackStage::None;
		Snap.StageTicksLeft = 0;
		Snap.StageTicksTotal = 0;
		Snap.StateTicksLeft = 0;
		Snap.bBlocking = false;
		Snap.Dodge = DodgeDir::None;
		Snap.DodgeHeldTicks = 0;
		Snap.bDodgeEffective = false;
		Snap.LeanLateral = 0.0f;
		Snap.Position = Position;
		Snap.RoundDamageDealt = 0.0f;
		bWantsBlock = false;
		bHasBuffered = false;
	}

	CombatEvent Fighter::MakeEvent(CombatEventType Type, int32_t Tick) const
	{
		CombatEvent Event;
		Event.Type = Type;
		Event.Actor = Snap.Slot;
		Event.Target = OtherSlot(Snap.Slot);
		Event.AttackHand = Snap.AttackHand;
		Event.AttackId = Snap.AttackId;
		Event.bTired = Snap.bAttackTired;
		Event.Dodge = Snap.Dodge;
		Event.Tick = Tick;
		return Event;
	}

	void Fighter::SpendStamina(float Amount, int32_t Tick, CombatEventBuffer& Events)
	{
		if (Amount <= 0.0f)
		{
			return;
		}
		const bool bHadStamina = Snap.Stamina > 0.0f;
		Snap.Stamina = Clamp(Snap.Stamina - Amount, 0.0f, Config.MaxStamina);
		LastStaminaSpendTick = Tick;
		if (bHadStamina && Snap.Stamina <= 0.0f)
		{
			Events.Push(MakeEvent(CombatEventType::StaminaExhausted, Tick));
		}
	}

	void Fighter::AdvanceTimers(int32_t Tick, CombatEventBuffer& Events)
	{
		CurrentTick = Tick;
		if (Snap.State == ActionState::KnockedOut)
		{
			return;
		}

		// Stamina regeneration (not while attacking, delayed after spending).
		if (Snap.State != ActionState::Attack && Tick - LastStaminaSpendTick >= Config.StaminaRegenDelayTicks)
		{
			const float Factor = Snap.bBlocking ? Config.BlockRegenFactor : 1.0f;
			Snap.Stamina = Clamp(Snap.Stamina + Config.StaminaRegenPerSecond * Factor / static_cast<float>(kTickRate), 0.0f, Config.MaxStamina);
		}

		if (Snap.State == ActionState::HitStun || Snap.State == ActionState::BlockStun)
		{
			if (--Snap.StateTicksLeft <= 0)
			{
				Snap.StateTicksLeft = 0;
				EnterGuardOrBlock(bWantsBlock, Tick, Events);
			}
			return;
		}

		if (Snap.State != ActionState::Attack)
		{
			return;
		}

		if (--Snap.StageTicksLeft > 0)
		{
			return;
		}

		const AttackSpec& Spec = CurrentAttackSpec();
		switch (Snap.Stage)
		{
		case AttackStage::Windup:
			Snap.Stage = AttackStage::Active;
			Snap.StageTicksTotal = Spec.ActiveTicks;
			Snap.StageTicksLeft = Spec.ActiveTicks;
			Events.Push(MakeEvent(CombatEventType::AttackActive, Tick));
			break;
		case AttackStage::Active:
		{
			int32_t Recovery = Spec.RecoveryTicks;
			if (LastOutcome == AttackOutcome::Dodged || LastOutcome == AttackOutcome::Whiffed)
			{
				Recovery += Config.WhiffPenaltyTicks;
			}
			Snap.Stage = AttackStage::Recovery;
			Snap.StageTicksTotal = Recovery;
			Snap.StageTicksLeft = Recovery;
			Events.Push(MakeEvent(CombatEventType::AttackRecovery, Tick));
			break;
		}
		case AttackStage::Recovery:
			Events.Push(MakeEvent(CombatEventType::AttackFinished, Tick));
			EnterGuardOrBlock(bWantsBlock, Tick, Events);
			break;
		case AttackStage::None:
			EnterGuardOrBlock(bWantsBlock, Tick, Events);
			break;
		}
	}

	void Fighter::EnterGuardOrBlock(bool bWantBlock, int32_t Tick, CombatEventBuffer& Events)
	{
		const bool bWasBlocking = Snap.bBlocking;
		Snap.Stage = AttackStage::None;
		Snap.StageTicksLeft = 0;
		Snap.StageTicksTotal = 0;
		Snap.State = bWantBlock ? ActionState::Block : ActionState::Guard;
		Snap.bBlocking = bWantBlock;
		if (bWantBlock && !bWasBlocking)
		{
			Events.Push(MakeEvent(CombatEventType::BlockStarted, Tick));
		}
		else if (!bWantBlock && bWasBlocking)
		{
			Events.Push(MakeEvent(CombatEventType::BlockEnded, Tick));
		}
	}

	bool Fighter::CanStartAttack(Hand InHand) const
	{
		switch (Snap.State)
		{
		case ActionState::Guard:
		case ActionState::Block:
			return true;
		case ActionState::Attack:
			// Combo cancel: the other hand may interrupt this hand's recovery.
			return Snap.Stage == AttackStage::Recovery && Snap.AttackHand != InHand;
		case ActionState::HitStun:
		case ActionState::BlockStun:
		case ActionState::KnockedOut:
			return false;
		}
		return false;
	}

	void Fighter::StartAttack(Hand InHand, int32_t Tick, CombatEventBuffer& Events)
	{
		if (Snap.State == ActionState::Attack)
		{
			Events.Push(MakeEvent(CombatEventType::AttackCancelled, Tick));
		}
		if (Snap.bBlocking)
		{
			Snap.bBlocking = false;
			Events.Push(MakeEvent(CombatEventType::BlockEnded, Tick));
		}

		const AttackSpec& Spec = Config.Attacks[HandIndex(InHand)];
		const bool bTired = Snap.Stamina < Spec.StaminaCost;
		Snap.State = ActionState::Attack;
		Snap.Stage = AttackStage::Windup;
		Snap.AttackHand = InHand;
		Snap.AttackId = NextAttackId++;
		Snap.bAttackResolved = false;
		Snap.bAttackTired = bTired;
		int32_t Windup = Spec.WindupTicks;
		if (bTired)
		{
			Windup = static_cast<int32_t>(std::lround(static_cast<double>(Spec.WindupTicks) * Config.TiredWindupMultiplier));
		}
		Snap.StageTicksTotal = Windup;
		Snap.StageTicksLeft = Windup;
		LastOutcome = AttackOutcome::Pending;
		++Snap.PunchesThrown;
		SpendStamina(Spec.StaminaCost, Tick, Events);
		Events.Push(MakeEvent(CombatEventType::AttackStarted, Tick));
	}

	void Fighter::ApplyIntent(const FighterIntent& Intent, int32_t Tick, CombatEventBuffer& Events)
	{
		CurrentTick = Tick;
		if (Snap.State == ActionState::KnockedOut || Config.bPassive)
		{
			Snap.LeanLateral = 0.0f;
			return;
		}

		Snap.LeanLateral = Intent.LeanLateral;
		bWantsBlock = Intent.bBlock;

		// ---- dodge overlay ----
		const DodgeDir WantedDodge = (Snap.State == ActionState::HitStun) ? DodgeDir::None : Intent.Dodge;
		if (WantedDodge != Snap.Dodge)
		{
			if (Snap.Dodge != DodgeDir::None)
			{
				Events.Push(MakeEvent(CombatEventType::DodgeEnded, Tick));
			}
			Snap.Dodge = WantedDodge;
			Snap.DodgeHeldTicks = 0;
			Snap.bDodgeEffective = false;
			if (WantedDodge != DodgeDir::None)
			{
				if (Snap.Stamina >= Config.DodgeEntryStaminaCost)
				{
					SpendStamina(Config.DodgeEntryStaminaCost, Tick, Events);
					Snap.bDodgeEffective = true;
				}
				Events.Push(MakeEvent(CombatEventType::DodgeStarted, Tick));
			}
		}
		else if (Snap.Dodge != DodgeDir::None)
		{
			++Snap.DodgeHeldTicks;
			if (Snap.DodgeHeldTicks > Config.DodgeMaxEffectiveTicks)
			{
				Snap.bDodgeEffective = false;
			}
		}

		// ---- punches (new requests replace the buffered one) ----
		bool bStarted = false;
		for (int32_t Index = 0; Index < Intent.PunchCount; ++Index)
		{
			const PunchRequest& Request = Intent.Punches[Index];
			if (!bStarted && CanStartAttack(Request.PunchHand))
			{
				StartAttack(Request.PunchHand, Tick, Events);
				bStarted = true;
				if (bHasBuffered && Buffered.PunchHand == Request.PunchHand)
				{
					bHasBuffered = false;
				}
			}
			else
			{
				if (bHasBuffered)
				{
					CombatEvent Dropped = MakeEvent(CombatEventType::InputDropped, Tick);
					Dropped.AttackHand = Buffered.PunchHand;
					Events.Push(Dropped);
				}
				bHasBuffered = true;
				Buffered = Request;
				BufferedExpiresTick = Tick + Config.InputBufferTicks;
			}
		}

		if (!bStarted && bHasBuffered)
		{
			if (Tick > BufferedExpiresTick)
			{
				CombatEvent Dropped = MakeEvent(CombatEventType::InputDropped, Tick);
				Dropped.AttackHand = Buffered.PunchHand;
				Events.Push(Dropped);
				bHasBuffered = false;
			}
			else if (CanStartAttack(Buffered.PunchHand))
			{
				bHasBuffered = false;
				StartAttack(Buffered.PunchHand, Tick, Events);
				bStarted = true;
			}
		}

		// ---- block toggling when free ----
		if (!bStarted && (Snap.State == ActionState::Guard || Snap.State == ActionState::Block))
		{
			if (bWantsBlock != Snap.bBlocking)
			{
				EnterGuardOrBlock(bWantsBlock, Tick, Events);
			}
		}
	}

	bool Fighter::HasPendingActiveAttack() const
	{
		return Snap.State == ActionState::Attack && Snap.Stage == AttackStage::Active && !Snap.bAttackResolved;
	}

	bool Fighter::IsLastActiveTick() const
	{
		return Snap.Stage == AttackStage::Active && Snap.StageTicksLeft <= 1;
	}

	const AttackSpec& Fighter::CurrentAttackSpec() const
	{
		return Config.Attacks[HandIndex(Snap.AttackHand)];
	}

	float Fighter::CurrentAttackDamage(bool bCounter) const
	{
		float Damage = CurrentAttackSpec().Damage;
		if (Snap.bAttackTired)
		{
			Damage *= Config.TiredDamageMultiplier;
		}
		if (bCounter)
		{
			Damage *= Config.CounterHitMultiplier;
		}
		return Damage;
	}

	void Fighter::OnAttackResolved(AttackOutcome Outcome, float DamageDealt)
	{
		Snap.bAttackResolved = true;
		LastOutcome = Outcome;
		Snap.RoundDamageDealt += DamageDealt;
		Snap.TotalDamageDealt += DamageDealt;
		if (Outcome == AttackOutcome::Hit || Outcome == AttackOutcome::GuardBroken)
		{
			++Snap.PunchesLanded;
		}
		else if (Outcome == AttackOutcome::Blocked)
		{
			++Snap.PunchesBlocked;
		}
	}

	float Fighter::ReceiveHit(const AttackSpec& Spec, float Damage, int32_t Tick, CombatEventBuffer& Events, uint32_t AttackerAttackId)
	{
		(void)AttackerAttackId;
		const float Before = Snap.Health;
		if (!Config.bInvulnerable)
		{
			Snap.Health = Clamp(Snap.Health - Damage, 0.0f, Config.MaxHealth);
		}
		const float Applied = Config.bInvulnerable ? Damage : (Before - Snap.Health);

		if (Snap.State == ActionState::Attack && (Snap.Stage == AttackStage::Windup || (Snap.Stage == AttackStage::Active && !Snap.bAttackResolved)))
		{
			Events.Push(MakeEvent(CombatEventType::AttackCancelled, Tick));
		}
		if (Snap.bBlocking)
		{
			Events.Push(MakeEvent(CombatEventType::BlockEnded, Tick));
		}
		Snap.bBlocking = false;
		Snap.Stage = AttackStage::None;
		Snap.StageTicksLeft = 0;
		Snap.StageTicksTotal = 0;
		bHasBuffered = false;

		if (!Config.bInvulnerable && Snap.Health <= 0.0f)
		{
			Snap.State = ActionState::KnockedOut;
			Snap.Dodge = DodgeDir::None;
			Snap.bDodgeEffective = false;
			Events.Push(MakeEvent(CombatEventType::KnockedOut, Tick));
			return Applied;
		}
		if (Config.bPassive)
		{
			Snap.State = ActionState::Guard;
			return Applied;
		}
		Snap.State = ActionState::HitStun;
		Snap.StateTicksLeft = Spec.HitStunTicks;
		if (Snap.Dodge != DodgeDir::None)
		{
			Events.Push(MakeEvent(CombatEventType::DodgeEnded, Tick));
		}
		Snap.Dodge = DodgeDir::None;
		Snap.bDodgeEffective = false;
		return Applied;
	}

	float Fighter::ReceiveBlockedHit(const AttackSpec& Spec, float Damage, int32_t Tick)
	{
		(void)Spec;
		(void)Tick;
		const float Chip = Damage * Config.BlockChipFactor;
		const float Before = Snap.Health;
		if (!Config.bInvulnerable)
		{
			// Chip damage never knocks out.
			Snap.Health = Clamp(Snap.Health - Chip, (std::min)(1.0f, Before), Config.MaxHealth);
		}
		Snap.Stamina = Clamp(Snap.Stamina - Config.BlockStaminaCost, 0.0f, Config.MaxStamina);
		LastStaminaSpendTick = Tick;
		if (!Config.bPassive)
		{
			Snap.State = ActionState::BlockStun;
			Snap.StateTicksLeft = Config.BlockStunTicks;
		}
		return Config.bInvulnerable ? Chip : (Before - Snap.Health);
	}
}
