#include "IronEchoRules/BotBrain.h"

#include <algorithm>

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
		PlannedHand = Hand::Left;
		bComboQueued = false;
		ComboHand = Hand::Left;
		ComboTick = 0;
		RetreatUntilTick = -1;
		NextRetreatRollTick = 0;
		NextGuardRollTick = 0;
		GuardUpUntilTick = -1;
		LastHealth = -1.0f;
		FlurryCount = 0;
		LastPlayerAttackTick = -1000000;
		LastDefenses = -1;
	}

	int32_t BotBrain::DecideGetUpCount(int32_t KnockdownNumber)
	{
		const int32_t Index = Clamp(KnockdownNumber - 1, 0, 2);
		if (!Rng.Chance(Config.GetUpChance[Index]))
		{
			return -1;
		}
		return Rng.RangeInclusive(Config.GetUpCountMin, Config.GetUpCountMax);
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
			PlannedHand = Rng.Chance(Config.CrossChance) ? Hand::Right : Hand::Left;
			NextGuardRollTick = Tick + Config.GuardUpPeriodTicks;
			NextRetreatRollTick = Tick;
		}

		// ---- perception: a new player attack becomes visible, the reaction is decided now and executed later ----
		if (FoeSnap.State == ActionState::Attack && FoeSnap.AttackId != LastSeenPlayerAttackId)
		{
			LastSeenPlayerAttackId = FoeSnap.AttackId;
			// A flurry is easy to read: each punch after the second one raises the block chance.
			FlurryCount = (Tick - LastPlayerAttackTick <= Config.FlurryGapTicks) ? FlurryCount + 1 : 1;
			LastPlayerAttackTick = Tick;
			const float Read = Config.FlurryBlockBonus * static_cast<float>(FlurryCount > 2 ? FlurryCount - 2 : 0);
			const bool bHurt = MySnap.Health < Config.HurtHealthFraction * MySnap.MaxHealth;
			const float Hurt = bHurt ? Config.HurtBlockBonus : 0.0f;
			const float BlockChance = Clamp(Config.BlockChance + Read + Hurt, 0.0f, (std::max)(Config.MaxBlockChance, Config.BlockChance));
			const float Roll = Rng.NextFloat01();
			Defense Planned = Defense::None;
			if (Roll < BlockChance)
			{
				Planned = Defense::Block;
			}
			else if (Roll < BlockChance + Config.DodgeChance)
			{
				Planned = Rng.Chance(0.5f) ? Defense::DodgeLeft : Defense::DodgeRight;
			}
			bReactionPending = Planned != Defense::None;
			PlannedDefense = Planned;
			ReactionTick = Tick + Config.ReactionTicks;
			ReactingToAttackId = FoeSnap.AttackId;
		}
		const bool bFoeGassed = FoeSnap.Stamina < Config.PressureStaminaThreshold;
		if (bReactionPending && Tick >= ReactionTick)
		{
			bReactionPending = false;
			const bool bThreatStillLive = FoeSnap.State == ActionState::Attack && FoeSnap.AttackId == ReactingToAttackId
				&& (FoeSnap.Stage == AttackStage::Windup || (FoeSnap.Stage == AttackStage::Active && !FoeSnap.bAttackResolved));
			// A gassed player's arm punch is not worth covering up for while the bot's own punch is coming.
			const bool bIgnore = bFoeGassed && FoeSnap.bAttackTired && MySnap.State == ActionState::Attack;
			if (bThreatStillLive && !bIgnore)
			{
				ActiveDefense = PlannedDefense;
				DefenseUntilTick = Tick + Config.DefenseHoldTicks;
			}
		}
		if (ActiveDefense != Defense::None && Tick >= DefenseUntilTick)
		{
			ActiveDefense = Defense::None;
		}

		// ---- block-and-counter: a successful block or slip opens a chance to fire back at once ----
		const int32_t Defenses = MySnap.BlocksMade + MySnap.DodgesMade;
		if (LastDefenses >= 0 && Defenses > LastDefenses && !bComboQueued && Rng.Chance(Config.CounterChance))
		{
			ActiveDefense = Defense::None;
			bReactionPending = false;
			GuardUpUntilTick = -1;
			NextAttackTick = Tick + Config.CounterDelayTicks;
			PlannedHand = Rng.Chance(Config.CounterCrossChance) ? Hand::Right : Hand::Left;
		}
		LastDefenses = Defenses;

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
			const bool bHurtNow = MySnap.Health < Config.HurtHealthFraction * MySnap.MaxHealth;
			const float GuardUp = Config.GuardUpChance + (bHurtNow ? Config.HurtGuardUpBonus : 0.0f);
			if (bFoeInRange && ActiveDefense == Defense::None && Rng.Chance(GuardUp))
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
		else if (Tick >= NextAttackTick && !Intent.bRetreat && (ActiveDefense == Defense::None || bFoeGassed))
		{
			const Hand Choice = PlannedHand;
			const AttackSpec& Spec = Me.GetConfig().Attacks[HandIndex(Choice)];
			const bool bFoeCommitted = FoeSnap.State == ActionState::Attack && FoeSnap.Stage != AttackStage::Recovery;
			const bool bWaitOut = bFoeCommitted && Rng.Chance(Config.AvoidTradeChance);
			if (bFree && !bWaitOut && MySnap.State != ActionState::Attack && Sim.Gap() <= Spec.ReachMeters && MySnap.Stamina >= Spec.StaminaCost)
			{
				bAttackNow = true;
				AttackHand = Choice;
				if (Rng.Chance(Config.ComboChance))
				{
					bComboQueued = true;
					ComboHand = OtherHand(Choice);
					ComboTick = Tick + Spec.WindupTicks + Spec.ActiveTicks;
				}
				int32_t Interval = Rng.RangeInclusive(Config.AttackIntervalMinTicks, Config.AttackIntervalMaxTicks);
				if (bFoeGassed)
				{
					Interval = static_cast<int32_t>(static_cast<float>(Interval) * Config.PressureIntervalScale);
				}
				else if (MySnap.Health < Config.HurtHealthFraction * MySnap.MaxHealth)
				{
					Interval = static_cast<int32_t>(static_cast<float>(Interval) * Config.HurtIntervalScale);
				}
				NextAttackTick = Tick + Interval;
				PlannedHand = Rng.Chance(Config.CrossChance) ? Hand::Right : Hand::Left;
				ActiveDefense = Defense::None;
			}
			else
			{
				NextAttackTick = Tick + Config.AttackRetryTicks; // not now: try again soon, keep the plan
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
