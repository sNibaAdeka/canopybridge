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
		case ActionState::KnockedDown: return "KnockedDown";
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
		ResetForMatch(Vec2{});
	}

	void Fighter::ResetForMatch(Vec2 Location)
	{
		const FighterSlot Slot = Snap.Slot;
		Snap = FighterSnapshot{};
		Snap.Slot = Slot;
		Snap.MaxHealth = Config.MaxHealth;
		Snap.Health = Config.MaxHealth;
		Snap.MaxStamina = Config.MaxStamina;
		Snap.Stamina = Config.MaxStamina;
		Snap.Location = Location;
		Snap.Facing = Vec2{Location.X > 0.0f ? -1.0f : 1.0f, 0.0f};
		LastOutcome = AttackOutcome::Pending;
		bWantsBlock = false;
		LastStaminaSpendTick = -1000000;
		bHasBuffered = false;
		StunTicksElapsed = 0;
		AttackLockedUntilTick = -1000000;
		GassedUntilTick = -1000000;
	}

	void Fighter::ResetForRound(Vec2 Location, float HealthRecoveryFraction)
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
		Snap.HeadOffset = 0.0f;
		Snap.Location = Location;
		Snap.Facing = Vec2{Location.X > 0.0f ? -1.0f : 1.0f, 0.0f};
		Snap.Velocity = Vec2{};
		Snap.SpeedForward = 0.0f;
		Snap.SpeedSide = 0.0f;
		Snap.bMoving = false;
		Snap.bOnRopes = false;
		ClearRoundStats();
		Snap.ComboCount = 0;
		bWantsBlock = false;
		bHasBuffered = false;
		StunTicksElapsed = 0;
		AttackLockedUntilTick = -1000000;
		GassedUntilTick = -1000000;
		Snap.GassedTicksLeft = 0;
	}

	void Fighter::ClearRoundStats()
	{
		Snap.RoundDamageDealt = 0.0f;
		Snap.RoundPunchesLanded = 0;
		Snap.RoundDefenses = 0;
		Snap.RoundKnockdownsSuffered = 0;
	}

	void Fighter::NoteDodge()
	{
		++Snap.DodgesMade;
		++Snap.RoundDefenses;
	}

	void Fighter::GetUp(int32_t Tick, CombatEventBuffer& Events)
	{
		if (Snap.State != ActionState::KnockedDown)
		{
			return;
		}
		float Fraction = Config.KnockdownRecoverHealth;
		for (int32_t Index = 1; Index < Snap.KnockdownsSuffered; ++Index)
		{
			Fraction *= Config.KnockdownRecoverDecay;
		}
		Snap.Health = Clamp(Config.MaxHealth * Fraction, 1.0f, Config.MaxHealth);
		Snap.Stamina = Clamp(Config.MaxStamina * Config.GetUpStamina, 0.0f, Config.MaxStamina);
		Snap.State = ActionState::Guard;
		Snap.StateTicksLeft = 0;
		bWantsBlock = false;
		bHasBuffered = false;
		AttackLockedUntilTick = -1000000;
		GassedUntilTick = -1000000;
		Snap.GassedTicksLeft = 0;
		CombatEvent Event = MakeEvent(CombatEventType::GotUp, Tick);
		Event.KnockdownNumber = Snap.KnockdownsSuffered;
		Events.Push(Event);
	}

	void Fighter::ForceKnockOut(int32_t Tick, CombatEventBuffer& Events)
	{
		if (Snap.State == ActionState::KnockedOut)
		{
			return;
		}
		Snap.State = ActionState::KnockedOut;
		Snap.Health = 0.0f;
		Snap.Dodge = DodgeDir::None;
		Snap.bDodgeEffective = false;
		Events.Push(MakeEvent(CombatEventType::KnockedOut, Tick));
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
		Event.Zone = Snap.AttackZone;
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
			GassedUntilTick = Tick + Config.GassedTicks;
			Snap.GassedTicksLeft = Config.GassedTicks;
			Events.Push(MakeEvent(CombatEventType::StaminaExhausted, Tick));
		}
	}

	void Fighter::AdvanceTimers(int32_t Tick, CombatEventBuffer& Events)
	{
		CurrentTick = Tick;
		Snap.GassedTicksLeft = GassedUntilTick > Tick ? GassedUntilTick - Tick : 0;
		if (Snap.State == ActionState::KnockedOut || Snap.State == ActionState::KnockedDown)
		{
			return;
		}

		// Stamina regeneration (not while attacking, delayed after spending).
		if (Snap.State != ActionState::Attack && Tick - LastStaminaSpendTick >= Config.StaminaRegenDelayTicks)
		{
			const float Factor = (Snap.bBlocking ? Config.BlockRegenFactor : 1.0f) * (Snap.bMoving ? Config.MoveRegenFactor : 1.0f);
			Snap.Stamina = Clamp(Snap.Stamina + Config.StaminaRegenPerSecond * Factor / static_cast<float>(kTickRate), 0.0f, Config.MaxStamina);
		}

		if (Snap.State == ActionState::HitStun || Snap.State == ActionState::BlockStun)
		{
			++StunTicksElapsed;
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
		if (CurrentTick < AttackLockedUntilTick || CurrentTick < GassedUntilTick)
		{
			return false;
		}
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
		case ActionState::KnockedDown:
			return false;
		}
		return false;
	}

	void Fighter::StartAttack(Hand InHand, PunchZone Zone, int32_t Tick, CombatEventBuffer& Events)
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

		const AttackSpec Spec = SpecFor(InHand, Zone);
		const bool bTired = Snap.Stamina < Spec.StaminaCost;
		Snap.State = ActionState::Attack;
		Snap.Stage = AttackStage::Windup;
		Snap.AttackHand = InHand;
		Snap.AttackZone = Zone;
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
		if (Snap.State == ActionState::KnockedOut || Snap.State == ActionState::KnockedDown || Config.bPassive)
		{
			Snap.LeanLateral = 0.0f;
			return;
		}

		Snap.LeanLateral = Intent.LeanLateral;
		bWantsBlock = Intent.bBlock;
		const float Dt = static_cast<float>(kTickSeconds);

		// ---- cover-up: raise the guard out of a hit stun once the flinch is over ----
		if (Snap.State == ActionState::HitStun && bWantsBlock && StunTicksElapsed >= Config.CoverUpTicks)
		{
			AttackLockedUntilTick = Tick + Snap.StateTicksLeft;
			Snap.StateTicksLeft = 0;
			EnterGuardOrBlock(true, Tick, Events);
		}

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
				bSlipWeak = Snap.Stamina < Config.DodgeEntryStaminaCost;
				if (!bSlipWeak)
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

		// ---- the head: the lean moves it off the centre line at a finite speed (a late slip does not get there) ----
		{
			float Wanted = Clamp(Snap.LeanLateral, -1.0f, 1.0f) * Config.HeadSlipMeters;
			if (Snap.State == ActionState::HitStun)
			{
				Wanted = 0.0f;
			}
			else if (Snap.Dodge != DodgeDir::None && bSlipWeak)
			{
				Wanted *= 0.5f;
			}
			const float MaxStep = Config.HeadSlipSpeed * Dt;
			Snap.HeadOffset += Clamp(Wanted - Snap.HeadOffset, -MaxStep, MaxStep);
		}

		// ---- punches (new requests replace the buffered one) ----
		bool bStarted = false;
		for (int32_t Index = 0; Index < Intent.PunchCount; ++Index)
		{
			const PunchRequest& Request = Intent.Punches[Index];
			if (!bStarted && CanStartAttack(Request.PunchHand))
			{
				StartAttack(Request.PunchHand, Request.Zone, Tick, Events);
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
				StartAttack(Buffered.PunchHand, Buffered.Zone, Tick, Events);
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

	AttackSpec Fighter::SpecFor(Hand InHand, PunchZone Zone) const
	{
		AttackSpec Spec = Config.Attacks[HandIndex(InHand)];
		if (Zone == PunchZone::Body)
		{
			Spec.ReachMeters += Config.BodyReachDelta;
			Spec.Damage *= Config.BodyDamageFactor;
			Spec.StaminaCost *= Config.BodyStaminaCostFactor;
		}
		return Spec;
	}

	AttackSpec Fighter::CurrentAttackSpec() const
	{
		return SpecFor(Snap.AttackHand, Snap.AttackZone);
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

	int32_t Fighter::CurrentAttackHitStun() const
	{
		const int32_t Full = CurrentAttackSpec().HitStunTicks;
		if (!Snap.bAttackTired)
		{
			return Full;
		}
		return static_cast<int32_t>(std::lround(static_cast<double>(Full) * Config.TiredHitStunMultiplier));
	}

	void Fighter::OnAttackResolved(AttackOutcome Outcome, float DamageDealt, bool bCounter, int32_t Tick)
	{
		Snap.bAttackResolved = true;
		LastOutcome = Outcome;
		Snap.RoundDamageDealt += DamageDealt;
		Snap.TotalDamageDealt += DamageDealt;
		if (Outcome == AttackOutcome::Hit || Outcome == AttackOutcome::GuardBroken)
		{
			++Snap.PunchesLanded;
			++Snap.RoundPunchesLanded;
			if (Snap.AttackZone == PunchZone::Body)
			{
				++Snap.BodyPunchesLanded;
			}
			if (bCounter)
			{
				++Snap.CounterHits;
			}
			// A combo continues while clean hits keep landing inside the window and this fighter is not hit back
			// (ReceiveHit resets ComboCount).
			Snap.ComboCount = (Snap.ComboCount > 0 && Tick - LastLandedTick <= Config.ComboWindowTicks) ? Snap.ComboCount + 1 : 1;
			LastLandedTick = Tick;
			if (Snap.ComboCount > Snap.MaxCombo)
			{
				Snap.MaxCombo = Snap.ComboCount;
			}
		}
		else if (Outcome == AttackOutcome::Blocked)
		{
			++Snap.PunchesBlocked;
		}
	}

	float Fighter::ReceiveHit(const AttackSpec& Spec, float Damage, int32_t Tick, CombatEventBuffer& Events, uint32_t AttackerAttackId,
		int32_t StunTicks, bool bArmPunch)
	{
		(void)AttackerAttackId;
		const float Before = Snap.Health;
		if (!Config.bInvulnerable)
		{
			Snap.Health = Clamp(Snap.Health - Damage, 0.0f, Config.MaxHealth);
		}
		const float Applied = Config.bInvulnerable ? Damage : (Before - Snap.Health);

		// An exhausted arm punch does not stop a committed punch: the windup goes on (it still hurts).
		if (bArmPunch && Snap.Health > 0.0f && Snap.State == ActionState::Attack && Snap.Stage == AttackStage::Windup)
		{
			Snap.ComboCount = 0;
			return Applied;
		}

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
		Snap.ComboCount = 0;

		if (!Config.bInvulnerable && Snap.Health <= 0.0f)
		{
			Snap.Dodge = DodgeDir::None;
			Snap.bDodgeEffective = false;
			if (Config.bKnockdowns)
			{
				Snap.State = ActionState::KnockedDown;
				++Snap.KnockdownsSuffered;
				++Snap.RoundKnockdownsSuffered;
				CombatEvent Down = MakeEvent(CombatEventType::KnockedDown, Tick);
				Down.KnockdownNumber = Snap.KnockdownsSuffered;
				Events.Push(Down);
			}
			else
			{
				Snap.State = ActionState::KnockedOut;
				Events.Push(MakeEvent(CombatEventType::KnockedOut, Tick));
			}
			return Applied;
		}
		if (Config.bPassive)
		{
			Snap.State = ActionState::Guard;
			return Applied;
		}
		Snap.State = ActionState::HitStun;
		Snap.StateTicksLeft = StunTicks >= 0 ? StunTicks : Spec.HitStunTicks;
		StunTicksElapsed = 0;
		if (Snap.Dodge != DodgeDir::None)
		{
			Events.Push(MakeEvent(CombatEventType::DodgeEnded, Tick));
		}
		Snap.Dodge = DodgeDir::None;
		Snap.bDodgeEffective = false;
		return Applied;
	}

	void Fighter::TakeStaminaDamage(float Amount, int32_t Tick, CombatEventBuffer& Events)
	{
		if (Config.bInvulnerable || Snap.State == ActionState::KnockedOut || Snap.State == ActionState::KnockedDown)
		{
			return;
		}
		SpendStamina(Amount, Tick, Events);
	}

	float Fighter::ReceiveBlockedHit(const AttackSpec& Spec, float Damage, int32_t Tick, PunchZone Zone)
	{
		const float Chip = Damage * Config.BlockChipFactor;
		const float Before = Snap.Health;
		if (!Config.bInvulnerable)
		{
			// Chip damage never knocks out.
			Snap.Health = Clamp(Snap.Health - Chip, (std::min)(1.0f, Before), Config.MaxHealth);
		}
		// The guard pays for the punch it stops (a tired arm punch far less than a full one). Absorbing a punch
		// is not spending: it does not restart the regeneration delay, so a flurry cannot starve a guard.
		(void)Tick;
		Snap.Stamina = Clamp(Snap.Stamina - BlockDrain(Damage, Spec.Damage, Zone), 0.0f, Config.MaxStamina);
		++Snap.BlocksMade;
		++Snap.RoundDefenses;
		if (!Config.bPassive)
		{
			Snap.State = ActionState::BlockStun;
			Snap.StateTicksLeft = Config.BlockStunTicks;
			StunTicksElapsed = 0;
		}
		return Config.bInvulnerable ? Chip : (Before - Snap.Health);
	}
}
