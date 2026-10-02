#include "IronEchoRules/BotBrain.h"

namespace IronEchoCore
{
	BotBrain::BotBrain(const BotConfig& InConfig, uint64_t Seed)
		: Config(InConfig)
	{
		Reset(Seed);
	}

	void BotBrain::Reset(uint64_t Seed)
	{
		Rng.Reseed(Seed);
		bInitialized = false;
		LastSeenPlayerAttackId = 0;
		bReactionPending = false;
		ReactionTick = 0;
		ReactingToAttackId = 0;
		PlannedDefense = Defense::None;
		ActiveDefense = Defense::None;
		DefenseUntilTick = 0;
		NextAttackTick = 0;
		bComboQueued = false;
		ComboHand = Hand::Left;
		ComboTick = 0;
		RetreatUntilTick = -1;
		NextRetreatRollTick = 0;
		NextGuardRollTick = 0;
		GuardUpUntilTick = -1;
		LastHealth = -1.0f;
	}

	FighterIntent BotBrain::Think(const CombatSim& Sim, int32_t Tick)
	{
		FighterIntent Intent;
		const Fighter& Me = Sim.Get(FighterSlot::Opponent);
		const Fighter& Foe = Sim.Get(FighterSlot::Player);
		const FighterSnapshot& MySnap = Me.Snapshot();
		const FighterSnapshot& FoeSnap = Foe.Snapshot();
		if (Me.IsKnockedOut() || Me.GetConfig().bPassive)
		{
			return Intent;
		}

		if (!bInitialized)
		{
			bInitialized = true;
			NextAttackTick = Tick + Rng.RangeInclusive(Config.AttackIntervalMinTicks, Config.AttackIntervalMaxTicks);
			NextGuardRollTick = Tick + Config.GuardUpPeriodTicks;
			NextRetreatRollTick = Tick;
		}

		// ---- perception: a new player attack becomes visible, the reaction is decided now and executed later ----
		if (FoeSnap.State == ActionState::Attack && FoeSnap.AttackId != LastSeenPlayerAttackId)
		{
			LastSeenPlayerAttackId = FoeSnap.AttackId;
			const float Roll = Rng.NextFloat01();
			Defense Planned = Defense::None;
			if (Roll < Config.BlockChance)
			{
				Planned = Defense::Block;
			}
			else if (Roll < Config.BlockChance + Config.DodgeChance)
			{
				Planned = Rng.Chance(0.5f) ? Defense::DodgeLeft : Defense::DodgeRight;
			}
			bReactionPending = Planned != Defense::None;
			PlannedDefense = Planned;
			ReactionTick = Tick + Config.ReactionTicks;
			ReactingToAttackId = FoeSnap.AttackId;
		}
		if (bReactionPending && Tick >= ReactionTick)
		{
			bReactionPending = false;
			const bool bThreatStillLive = FoeSnap.State == ActionState::Attack && FoeSnap.AttackId == ReactingToAttackId
				&& (FoeSnap.Stage == AttackStage::Windup || (FoeSnap.Stage == AttackStage::Active && !FoeSnap.bAttackResolved));
			if (bThreatStillLive)
			{
				ActiveDefense = PlannedDefense;
				DefenseUntilTick = Tick + Config.DefenseHoldTicks;
			}
		}
		if (ActiveDefense != Defense::None && Tick >= DefenseUntilTick)
		{
			ActiveDefense = Defense::None;
		}

		// ---- stamina management: step out of range to recover ----
		if (Tick >= RetreatUntilTick && MySnap.Stamina < Config.RetreatStaminaThreshold && Tick >= NextRetreatRollTick)
		{
			NextRetreatRollTick = Tick + kTickRate;
			if (Rng.Chance(Config.RetreatChance))
			{
				RetreatUntilTick = Tick + Config.RetreatTicks;
			}
		}
		Intent.bRetreat = Tick < RetreatUntilTick;

		// ---- cover up after eating a clean hit ----
		if (LastHealth >= 0.0f && MySnap.Health < LastHealth - 1.0e-3f && MySnap.State == ActionState::HitStun)
		{
			if (Rng.Chance(Config.GuardAfterHitChance))
			{
				GuardUpUntilTick = Tick + MySnap.StateTicksLeft + Config.GuardAfterHitTicks;
			}
		}
		LastHealth = MySnap.Health;

		// ---- idle guard ----
		const AttackSpec& Jab = Me.GetConfig().Attacks[HandIndex(Hand::Left)];
		const bool bFoeInRange = Sim.Gap() <= Jab.ReachMeters + 0.1f;
		if (Tick >= NextGuardRollTick)
		{
			NextGuardRollTick = Tick + Config.GuardUpPeriodTicks;
			if (bFoeInRange && ActiveDefense == Defense::None && Rng.Chance(Config.GuardUpChance))
			{
				GuardUpUntilTick = Tick + Config.GuardUpTicks;
			}
		}

		// ---- offence ----
		const bool bFree = MySnap.State == ActionState::Guard || MySnap.State == ActionState::Block
			|| (MySnap.State == ActionState::Attack && MySnap.Stage == AttackStage::Recovery);
		bool bAttackNow = false;
		Hand AttackHand = Hand::Left;
		if (bComboQueued)
		{
			if (Tick >= ComboTick)
			{
				bComboQueued = false;
				bAttackNow = true; // the fighter buffers it if it cannot start this very tick
				AttackHand = ComboHand;
			}
		}
		else if (Tick >= NextAttackTick && !Intent.bRetreat && ActiveDefense == Defense::None)
		{
			NextAttackTick = Tick + Rng.RangeInclusive(Config.AttackIntervalMinTicks, Config.AttackIntervalMaxTicks);
			const Hand Choice = Rng.Chance(Config.CrossChance) ? Hand::Right : Hand::Left;
			const AttackSpec& Spec = Me.GetConfig().Attacks[HandIndex(Choice)];
			if (bFree && MySnap.State != ActionState::Attack && Sim.Gap() <= Spec.ReachMeters && MySnap.Stamina >= Spec.StaminaCost)
			{
				bAttackNow = true;
				AttackHand = Choice;
				if (Rng.Chance(Config.ComboChance))
				{
					bComboQueued = true;
					ComboHand = OtherHand(Choice);
					ComboTick = Tick + Spec.WindupTicks + Spec.ActiveTicks;
				}
			}
		}

		if (bAttackNow)
		{
			Intent.AddPunch(AttackHand, 1.0f);
			GuardUpUntilTick = -1;
		}
		else if (ActiveDefense == Defense::Block || Tick < GuardUpUntilTick)
		{
			Intent.bBlock = true;
		}

		if (ActiveDefense == Defense::DodgeLeft)
		{
			Intent.Dodge = DodgeDir::Left;
			Intent.LeanLateral = -0.8f;
		}
		else if (ActiveDefense == Defense::DodgeRight)
		{
			Intent.Dodge = DodgeDir::Right;
			Intent.LeanLateral = 0.8f;
		}
		return Intent;
	}
}
