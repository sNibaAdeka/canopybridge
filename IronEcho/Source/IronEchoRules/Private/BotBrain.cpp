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
		PlannedZone = PunchZone::Head;
		PlannedKind = AttackKind::Punch;
		bGuardRolled = false;
		CircleDir = 1;
		CircleUntilTick = -1;
		NextCircleRollTick = 0;
		StepOutRolledId = 0;
		StepOutUntilTick = -1;
		EscapeDir = 0;
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
			PlanNext();
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
			PlannedZone = PunchZone::Head; // a counter goes straight back at the head
			PlannedKind = AttackKind::Punch;
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
		const bool bRetreating = Tick < RetreatUntilTick;

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
		PunchZone AttackZone = PunchZone::Head;
		AttackKind AttackType = AttackKind::Punch;
		if (bComboQueued)
		{
			if (Tick >= ComboTick)
			{
				bComboQueued = false;
				bAttackNow = true; // the fighter buffers it if it cannot start this very tick
				AttackHand = ComboHand;
				AttackZone = PunchZone::Head;
			}
		}
		else if (Tick >= NextAttackTick && !bRetreating && (ActiveDefense == Defense::None || bFoeGassed))
		{
			const Hand Choice = PlannedHand;
			// Body work: planned some of the time, and a raised guard invites it (one roll per plan).
			if (FoeSnap.bBlocking && PlannedZone == PunchZone::Head && !bGuardRolled)
			{
				bGuardRolled = true;
				if (Rng.Chance(Config.BodyVsGuardBonus))
				{
					PlannedZone = PunchZone::Body;
				}
			}
			PunchZone Zone = PlannedZone;
			AttackKind Kind = PlannedKind;
			// The foe stands just out of punching reach but inside a kick's: a kick is the answer.
			if (Kind == AttackKind::Punch && Sim.Gap() > Me.SpecFor(Choice, Zone).ReachMeters
				&& Sim.Gap() <= Me.SpecFor(Hand::Right, PunchZone::Body, AttackKind::Kick).ReachMeters && MySnap.Stamina >= 16.0f && Rng.Chance(0.6f))
			{
				Kind = AttackKind::Kick;
				Zone = FoeSnap.bMoving ? PunchZone::Leg : PunchZone::Body;
			}
			// Inside elbow reach (the human walked in, or the ropes did it): an elbow to the head or a knee to the body.
			if (Kind == AttackKind::Punch && Sim.Gap() <= Me.SpecFor(Choice, PunchZone::Head, AttackKind::Elbow).ReachMeters
				&& Rng.Chance(Config.ClinchStrikeChance))
			{
				Kind = Rng.Chance(0.5f) ? AttackKind::Elbow : AttackKind::Knee;
				Zone = Kind == AttackKind::Elbow ? PunchZone::Head : PunchZone::Body;
			}
			const AttackSpec Spec = Me.SpecFor(Choice, Zone, Kind);
			const bool bFoeCommitted = FoeSnap.State == ActionState::Attack && FoeSnap.Stage != AttackStage::Recovery;
			const bool bWaitOut = bFoeCommitted && Rng.Chance(Config.AvoidTradeChance);
			if (bFree && !bWaitOut && MySnap.State != ActionState::Attack && Sim.Gap() <= Spec.ReachMeters && MySnap.Stamina >= Spec.StaminaCost)
			{
				bAttackNow = true;
				AttackHand = Choice;
				AttackZone = Zone;
				AttackType = Kind;
				if (Kind == AttackKind::Punch && Rng.Chance(Config.ComboChance))
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
				PlanNext();
				bGuardRolled = false;
				ActiveDefense = Defense::None;
			}
			else
			{
				NextAttackTick = Tick + Config.AttackRetryTicks; // not now: try again soon, keep the plan
			}
		}

		if (bAttackNow)
		{
			Intent.AddPunch(AttackHand, 1.0f, AttackZone, AttackType);
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
			Intent.LeanLateral = 1.0f;
		}

		const bool bWantsToAttack = bComboQueued || (!bRetreating && Tick >= NextAttackTick - SecondsToTicks(0.25));
		Footwork(Sim, Tick, bRetreating, bWantsToAttack, Intent);
		return Intent;
	}

	void BotBrain::PlanNext()
	{
		if (Rng.Chance(Config.KickChance))
		{
			PlannedKind = AttackKind::Kick;
			PlannedHand = Rng.Chance(Config.RoundKickShare) ? Hand::Right : Hand::Left;
			PlannedZone = Rng.Chance(Config.LegKickShare) ? PunchZone::Leg : PunchZone::Body;
			return;
		}
		PlannedKind = AttackKind::Punch;
		PlannedHand = Rng.Chance(Config.CrossChance) ? Hand::Right : Hand::Left;
		PlannedZone = Rng.Chance(Config.BodyShotChance) ? PunchZone::Body : PunchZone::Head;
	}

	void BotBrain::Footwork(const CombatSim& Sim, int32_t Tick, bool bRetreating, bool bWantsToAttack, FighterIntent& Intent)
	{
		const Fighter& Me = Sim.Get(FighterSlot::Opponent);
		const FighterSnapshot& MySnap = Me.Snapshot();
		const FighterSnapshot& FoeSnap = Sim.Get(FighterSlot::Player).Snapshot();
		const MovementConfig& M = Sim.Movement();
		const float Gap = Sim.Gap();
		const Vec2 Face = Sim.FacingOf(FighterSlot::Opponent);
		const float RoomBack = Sim.RoomAlong(FighterSlot::Opponent, Face * -1.0f);
		const float RoomRight = Sim.RoomAlong(FighterSlot::Opponent, Face.RightOf());
		const float RoomLeft = Sim.RoomAlong(FighterSlot::Opponent, Face.RightOf() * -1.0f);
		const float Open = RoomRight >= RoomLeft ? 1.0f : -1.0f;
		const float Work = M.EngageDistance;
		float Forward = 0.0f;
		float Side = 0.0f;

		if (Tick >= NextCircleRollTick)
		{
			NextCircleRollTick = Tick + Config.CircleRollTicks;
			if (Rng.Chance(Config.CircleChance))
			{
				CircleUntilTick = Tick + Rng.RangeInclusive(Config.CircleMinTicks, Config.CircleMaxTicks);
				CircleDir = Rng.Chance(0.5f) ? 1 : -1;
			}
		}

		// Hit and move: after its own punch, sometimes step straight back out of the counter's reach.
		if (MySnap.State == ActionState::Attack && MySnap.Stage == AttackStage::Recovery && MySnap.AttackId != StepOutRolledId)
		{
			StepOutRolledId = MySnap.AttackId;
			if (!bWantsToAttack && Rng.Chance(Config.StepBackChance))
			{
				StepOutUntilTick = Tick + SecondsToTicks(0.35);
			}
		}

		if (Tick < StepOutUntilTick && RoomBack > 0.4f)
		{
			Forward = -1.0f;
		}
		else if (bRetreating)
		{
			Forward = -1.0f;
			if (RoomBack < 0.5f)
			{
				Forward = -0.4f;
				Side = Open; // backing into the ropes is a trap: slide along them toward the open side
			}
		}
		else
		{
			const bool bNearRopes = MySnap.bOnRopes || RoomBack < (EscapeDir != 0 ? 1.0f : 0.6f); // hysteresis
			if (!bNearRopes)
			{
				EscapeDir = 0;
			}
			if (bWantsToAttack)
			{
				// Step in until the planned punch reaches, with a margin for a target that moves.
				const float Reach = bComboQueued ? Me.SpecFor(ComboHand, PunchZone::Head).ReachMeters
					: Me.SpecFor(PlannedHand, PlannedZone, PlannedKind).ReachMeters;
				if (Gap > Reach - 0.10f)
				{
					Forward = 1.0f;
				}
			}
			else if (Gap > Work + Config.RangeSlack)
			{
				Forward = Gap > Work + 0.5f ? 1.0f : 0.6f;
			}
			else if (Gap < M.MinDistance + 0.15f)
			{
				Forward = -0.6f; // out of the clinch: a smothered punch is wasted
			}
			else if (Gap < Work - Config.RangeSlack - 0.10f)
			{
				Forward = -0.35f; // too close for its long arms: ease back to its range
			}
			if (Tick < CircleUntilTick && !bWantsToAttack)
			{
				Side = Config.CircleSpeed * static_cast<float>(CircleDir);
			}
			if (bNearRopes)
			{
				// Ropes or a corner behind: get out along them toward the open side, and stick to that choice
				// (unless that side closes into a corner).
				if (EscapeDir == 0)
				{
					EscapeDir = AbsValue(RoomRight - RoomLeft) < 0.05f ? CircleDir : static_cast<int32_t>(Open);
				}
				if ((EscapeDir > 0 ? RoomRight : RoomLeft) < 0.3f)
				{
					EscapeDir = -EscapeDir;
				}
				Side = 0.8f * static_cast<float>(EscapeDir);
				Forward = (std::max)(Forward, 0.0f);
			}
			else if (Config.bCutOffRing && FoeSnap.bOnRopes)
			{
				// Cut the ring off: walk the player down and mirror his sideways escape (his right is the bot's left).
				const float Escape = Clamp(FoeSnap.SpeedSide / 0.6f, -1.0f, 1.0f);
				Side = -Escape * 0.8f;
				if (Gap > Work)
				{
					Forward = (std::max)(Forward, 0.8f);
				}
			}
		}
		Intent.MoveForward = Forward;
		Intent.MoveSide = Side;
	}
}
