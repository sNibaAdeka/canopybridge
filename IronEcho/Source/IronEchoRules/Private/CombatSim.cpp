#include "IronEchoRules/CombatSim.h"

#include <algorithm>

namespace IronEchoCore
{
	CombatSim::CombatSim(const FighterConfig& PlayerConfig, const FighterConfig& OpponentConfig, const MovementConfig& InMovement)
		: Fighters{Fighter(FighterSlot::Player, PlayerConfig), Fighter(FighterSlot::Opponent, OpponentConfig)}
		, MovementCfg(InMovement)
	{
		ResetForMatch();
	}

	void CombatSim::ResetForMatch()
	{
		const float Half = MovementCfg.EngageDistance * 0.5f;
		Fighters[0].ResetForMatch(-Half);
		Fighters[1].ResetForMatch(Half);
	}

	void CombatSim::ResetForRound(float HealthRecoveryFraction)
	{
		const float Half = MovementCfg.EngageDistance * 0.5f;
		Fighters[0].ResetForRound(-Half, HealthRecoveryFraction);
		Fighters[1].ResetForRound(Half, HealthRecoveryFraction);
	}

	float CombatSim::Gap() const
	{
		return Fighters[1].Snapshot().Position - Fighters[0].Snapshot().Position;
	}

	void CombatSim::Step(const FighterIntent& PlayerIntent, const FighterIntent& OpponentIntent, int32_t Tick, CombatEventBuffer& Events)
	{
		Fighters[0].AdvanceTimers(Tick, Events);
		Fighters[1].AdvanceTimers(Tick, Events);
		Fighters[0].ApplyIntent(PlayerIntent, Tick, Events);
		Fighters[1].ApplyIntent(OpponentIntent, Tick, Events);

		// Evaluate both attacks against the same post-intent snapshot, then apply: trades are symmetric.
		const PendingOutcome PlayerResult = Evaluate(Fighters[0], Fighters[1]);
		const PendingOutcome OpponentResult = Evaluate(Fighters[1], Fighters[0]);
		Apply(Fighters[0], Fighters[1], PlayerResult, Tick, Events);
		Apply(Fighters[1], Fighters[0], OpponentResult, Tick, Events);

		UpdateMovement(OpponentIntent.bRetreat);
	}

	CombatSim::PendingOutcome CombatSim::Evaluate(const Fighter& Attacker, const Fighter& Defender) const
	{
		PendingOutcome Result;
		if (!Attacker.HasPendingActiveAttack() || Attacker.IsKnockedOut() || Defender.IsKnockedOut())
		{
			return Result;
		}
		const AttackSpec& Spec = Attacker.CurrentAttackSpec();
		const bool bInRange = Gap() <= Spec.ReachMeters;
		const bool bLast = Attacker.IsLastActiveTick();

		if (!bInRange)
		{
			Result.Outcome = bLast ? AttackOutcome::Whiffed : AttackOutcome::Pending;
			return Result;
		}
		if (Defender.IsDodgeEffective())
		{
			Result.Outcome = bLast ? AttackOutcome::Dodged : AttackOutcome::Pending;
			return Result;
		}
		if (Defender.IsBlocking())
		{
			Result.Outcome = Defender.CanAffordBlock() ? AttackOutcome::Blocked : AttackOutcome::GuardBroken;
			return Result;
		}
		Result.Outcome = AttackOutcome::Hit;
		Result.bCounter = Defender.IsWindingUp();
		return Result;
	}

	void CombatSim::Apply(Fighter& Attacker, Fighter& Defender, const PendingOutcome& Result, int32_t Tick, CombatEventBuffer& Events)
	{
		if (Result.Outcome == AttackOutcome::Pending)
		{
			return;
		}
		const AttackSpec& Spec = Attacker.CurrentAttackSpec();
		const FighterSnapshot& A = Attacker.Snapshot();

		CombatEvent Event;
		Event.Actor = A.Slot;
		Event.Target = Defender.Snapshot().Slot;
		Event.AttackHand = A.AttackHand;
		Event.AttackId = A.AttackId;
		Event.bTired = A.bAttackTired;
		Event.Tick = Tick;

		float Applied = 0.0f;
		switch (Result.Outcome)
		{
		case AttackOutcome::Hit:
		case AttackOutcome::GuardBroken:
		{
			if (Result.Outcome == AttackOutcome::GuardBroken)
			{
				CombatEvent Broken = Event;
				Broken.Type = CombatEventType::GuardBroken;
				Events.Push(Broken);
			}
			const float Damage = Attacker.CurrentAttackDamage(Result.bCounter);
			Applied = Defender.ReceiveHit(Spec, Damage, Tick, Events, A.AttackId);
			Knockback(Defender.Snapshot().Slot, Spec.KnockbackMeters);
			Event.Type = CombatEventType::HitConfirmed;
			Event.bCounterHit = Result.bCounter;
			break;
		}
		case AttackOutcome::Blocked:
			Applied = Defender.ReceiveBlockedHit(Spec, Attacker.CurrentAttackDamage(false), Tick);
			Knockback(Defender.Snapshot().Slot, Spec.KnockbackMeters * Defender.GetConfig().BlockKnockbackFactor);
			Event.Type = CombatEventType::Blocked;
			break;
		case AttackOutcome::Dodged:
			Event.Type = CombatEventType::Dodged;
			Event.Dodge = Defender.Snapshot().Dodge;
			Defender.NoteDodge();
			break;
		case AttackOutcome::Whiffed:
			Event.Type = CombatEventType::Whiffed;
			break;
		case AttackOutcome::Pending:
			return;
		}

		Attacker.OnAttackResolved(Result.Outcome, Applied);
		Event.Damage = Applied;
		Event.TargetHealthAfter = Defender.Snapshot().Health;
		Event.TargetStaminaAfter = Defender.Snapshot().Stamina;
		Events.Push(Event);
	}

	void CombatSim::Knockback(FighterSlot Defender, float Meters)
	{
		Fighter& Target = Fighters[SlotIndex(Defender)];
		const float Direction = Defender == FighterSlot::Player ? -1.0f : 1.0f;
		Target.SetPosition(Target.Snapshot().Position + Direction * Meters);
		ClampToRing();
	}

	void CombatSim::UpdateMovement(bool bOpponentRetreat)
	{
		const float Dt = static_cast<float>(kTickSeconds);
		Fighter& PlayerF = Fighters[0];
		Fighter& OpponentF = Fighters[1];
		const bool bOpponentMobile = !OpponentF.GetConfig().bPassive && !OpponentF.IsKnockedOut();
		const bool bPlayerMobile = !PlayerF.IsKnockedOut();

		// Opponent: step back when asked, otherwise close in to the engage distance.
		if (bOpponentMobile)
		{
			const float Gap0 = Gap();
			const float Target = MovementCfg.EngageDistance + (bOpponentRetreat ? MovementCfg.RetreatExtraDistance : 0.0f);
			if (bOpponentRetreat && Gap0 < Target)
			{
				OpponentF.SetPosition(OpponentF.Snapshot().Position + MovementCfg.RetreatSpeed * Dt);
			}
			else if (!bOpponentRetreat && Gap0 > MovementCfg.EngageDistance + MovementCfg.Tolerance)
			{
				const float Step = (std::min)(MovementCfg.FollowSpeed * Dt, Gap0 - MovementCfg.EngageDistance);
				OpponentF.SetPosition(OpponentF.Snapshot().Position - Step * 0.5f);
			}
		}

		// Player: automatic distance keeping toward the engage distance.
		if (bPlayerMobile)
		{
			const float Gap1 = Gap();
			const float Error = Gap1 - MovementCfg.EngageDistance;
			if (Error > MovementCfg.Tolerance)
			{
				const float Step = (std::min)(MovementCfg.FollowSpeed * Dt, Error);
				PlayerF.SetPosition(PlayerF.Snapshot().Position + Step);
			}
			else if (Error < -MovementCfg.Tolerance)
			{
				const float Step = (std::min)(MovementCfg.FollowSpeed * Dt, -Error);
				PlayerF.SetPosition(PlayerF.Snapshot().Position - Step);
			}
		}

		// Keep the pair near the ring centre so nobody gets pinned for long.
		const float Mid = 0.5f * (PlayerF.Snapshot().Position + OpponentF.Snapshot().Position);
		if (AbsValue(Mid) > MovementCfg.Tolerance && bOpponentMobile && bPlayerMobile)
		{
			const float Shift = (std::min)(MovementCfg.RecenterSpeed * Dt, AbsValue(Mid)) * (Mid > 0.0f ? -1.0f : 1.0f);
			PlayerF.SetPosition(PlayerF.Snapshot().Position + Shift);
			OpponentF.SetPosition(OpponentF.Snapshot().Position + Shift);
		}

		// Never overlap.
		const float Gap2 = Gap();
		if (Gap2 < MovementCfg.MinDistance)
		{
			const float Push = 0.5f * (MovementCfg.MinDistance - Gap2);
			PlayerF.SetPosition(PlayerF.Snapshot().Position - Push);
			OpponentF.SetPosition(OpponentF.Snapshot().Position + Push);
		}
		ClampToRing();
	}

	void CombatSim::ClampToRing()
	{
		const float Limit = MovementCfg.RingHalfLength - MovementCfg.FighterRadius;
		for (Fighter& F : Fighters)
		{
			F.SetPosition(Clamp(F.Snapshot().Position, -Limit, Limit));
		}
	}
}
