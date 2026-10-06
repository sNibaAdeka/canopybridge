#include "IronEchoRules/CombatSim.h"

#include <algorithm>
#include <cmath>

namespace IronEchoCore
{
	namespace
	{
		// Speed toward Want with a weight: speeding up at Accel, slowing down or reversing at Brake (m/s^2).
		float Approach(float Current, float Want, float Accel, float Brake, float Dt)
		{
			const bool bSpeedingUp = Want * Current >= 0.0f && AbsValue(Want) > AbsValue(Current);
			const float Rate = (bSpeedingUp ? Accel : Brake) * Dt;
			return Current + Clamp(Want - Current, -Rate, Rate);
		}

		Vec2 StartFacing(int32_t Index)
		{
			return Index == 0 ? Vec2{1.0f, 0.0f} : Vec2{-1.0f, 0.0f};
		}
	}

	CombatSim::CombatSim(const FighterConfig& PlayerConfig, const FighterConfig& OpponentConfig, const MovementConfig& InMovement)
		: Fighters{Fighter(FighterSlot::Player, PlayerConfig), Fighter(FighterSlot::Opponent, OpponentConfig)}
		, MovementCfg(InMovement)
	{
		ResetForMatch();
	}

	void CombatSim::ResetForMatch()
	{
		const float Half = MovementCfg.EngageDistance * 0.5f;
		Fighters[0].ResetForMatch(Vec2{-Half, 0.0f});
		Fighters[1].ResetForMatch(Vec2{Half, 0.0f});
		UpdateFacing();
	}

	void CombatSim::ResetForRound(float HealthRecoveryFraction)
	{
		const float Half = MovementCfg.EngageDistance * 0.5f;
		Fighters[0].ResetForRound(Vec2{-Half, 0.0f}, HealthRecoveryFraction);
		Fighters[1].ResetForRound(Vec2{Half, 0.0f}, HealthRecoveryFraction);
		UpdateFacing();
	}

	void CombatSim::ResetPositions()
	{
		const float Half = MovementCfg.EngageDistance * 0.5f;
		Fighters[0].SetLocation(Vec2{-Half, 0.0f});
		Fighters[1].SetLocation(Vec2{Half, 0.0f});
		for (Fighter& F : Fighters)
		{
			F.SetMotion(0.0f, 0.0f, Vec2{}, F.Snapshot().Facing, false);
		}
		UpdateFacing();
	}

	float CombatSim::Gap() const
	{
		return (Fighters[1].Snapshot().Location - Fighters[0].Snapshot().Location).Length();
	}

	Vec2 CombatSim::FacingOf(FighterSlot Slot) const
	{
		const int32_t Index = SlotIndex(Slot);
		const Vec2 Rel = Fighters[1 - Index].Snapshot().Location - Fighters[Index].Snapshot().Location;
		return Rel.Normalized(StartFacing(Index));
	}

	Vec2 CombatSim::TargetPoint(FighterSlot Slot, PunchZone Zone) const
	{
		const FighterSnapshot& S = Get(Slot).Snapshot();
		if (Zone == PunchZone::Body)
		{
			return S.Location;
		}
		return S.Location + FacingOf(Slot).RightOf() * S.HeadOffset;
	}

	float CombatSim::RoomAlong(FighterSlot Slot, Vec2 Dir) const
	{
		const Vec2 P = Get(Slot).Snapshot().Location;
		const float L = Limit();
		float Room = 1.0e6f;
		if (AbsValue(Dir.X) > 1.0e-4f)
		{
			Room = (std::min)(Room, ((Dir.X > 0.0f ? L : -L) - P.X) / Dir.X);
		}
		if (AbsValue(Dir.Y) > 1.0e-4f)
		{
			Room = (std::min)(Room, ((Dir.Y > 0.0f ? L : -L) - P.Y) / Dir.Y);
		}
		return (std::max)(0.0f, Room);
	}

	PunchGeometry CombatSim::Measure(FighterSlot Attacker, const AttackSpec& Spec, PunchZone Zone, Vec2 Aim) const
	{
		const Fighter& A = Get(Attacker);
		const Fighter& D = Get(OtherSlot(Attacker));
		const FighterConfig& AC = A.GetConfig();
		const FighterConfig& DC = D.GetConfig();
		const Vec2 Origin = A.Snapshot().Location;
		const Vec2 Dir = (Aim - Origin).Normalized(FacingOf(Attacker));
		const Vec2 Rel = TargetPoint(OtherSlot(Attacker), Zone) - Origin;

		PunchGeometry G;
		G.Along = Dir.Dot(Rel);
		G.Offset = AbsValue(Dir.Cross(Rel));
		G.bInReach = G.Along > 0.0f && G.Along <= Spec.ReachMeters;
		const bool bHead = Zone == PunchZone::Head;
		G.bClean = G.Offset <= (bHead ? DC.HeadHitRadius : DC.BodyHitRadius);
		G.bOnLine = G.Offset <= (bHead ? DC.HeadGlanceRadius : DC.BodyGlanceRadius);
		const float SweetStart = Spec.ReachMeters - AC.SweetSpotMeters;
		if (G.Along < SweetStart)
		{
			const float Span = (std::max)(0.05f, SweetStart - MovementCfg.MinDistance);
			const float T = Clamp((G.Along - MovementCfg.MinDistance) / Span, 0.0f, 1.0f);
			G.Power = AC.SmotheredDamageFactor + (1.0f - AC.SmotheredDamageFactor) * T;
		}
		return G;
	}

	void CombatSim::Step(const FighterIntent& PlayerIntent, const FighterIntent& OpponentIntent, int32_t Tick, CombatEventBuffer& Events)
	{
		Fighters[0].AdvanceTimers(Tick, Events);
		Fighters[1].AdvanceTimers(Tick, Events);
		Fighters[0].ApplyIntent(PlayerIntent, Tick, Events);
		Fighters[1].ApplyIntent(OpponentIntent, Tick, Events);
		UpdateAim(0);
		UpdateAim(1);

		// Evaluate both attacks against the same post-intent snapshot, then apply: trades are symmetric.
		const PendingOutcome PlayerResult = Evaluate(Fighters[0], Fighters[1]);
		const PendingOutcome OpponentResult = Evaluate(Fighters[1], Fighters[0]);
		Apply(Fighters[0], Fighters[1], PlayerResult, Tick, Events);
		Apply(Fighters[1], Fighters[0], OpponentResult, Tick, Events);

		UpdateMovement(PlayerIntent, OpponentIntent);
	}

	void CombatSim::UpdateAim(int32_t Index)
	{
		Fighter& F = Fighters[Index];
		const FighterSnapshot& S = F.Snapshot();
		if (S.State != ActionState::Attack)
		{
			return;
		}
		const FighterSlot Target = OtherSlot(S.Slot);
		const FighterConfig& C = F.GetConfig();
		const float Dt = static_cast<float>(kTickSeconds);
		const FighterSnapshot& D = Get(Target).Snapshot();
		const float HeadOffset = S.AttackZone == PunchZone::Head ? D.HeadOffset : 0.0f;
		const bool bNew = S.AttackId != AimedAttackId[Index];
		if (bNew)
		{
			AimedAttackId[Index] = S.AttackId;
			AimSlip[Index] = HeadOffset;
		}
		else if (S.Stage != AttackStage::Windup || S.StageTicksLeft <= C.AimCommitTicks)
		{
			return; // committed: the aim point stays where it was
		}
		else
		{
			// The punch turns with the target's body at once, but follows a head slip only slowly.
			const float MaxStep = C.AimTrackSpeed * Dt;
			AimSlip[Index] += Clamp(HeadOffset - AimSlip[Index], -MaxStep, MaxStep);
		}
		// Lead a moving target by the time left until the punch lands.
		const float ToContact = static_cast<float>(S.Stage == AttackStage::Windup ? S.StageTicksLeft : 0) * Dt;
		const Vec2 Body = D.Location + D.Velocity * (ToContact * C.AimLeadFactor);
		F.SetAimPoint(Body + FacingOf(Target).RightOf() * AimSlip[Index]);
	}

	CombatSim::PendingOutcome CombatSim::Evaluate(const Fighter& Attacker, const Fighter& Defender) const
	{
		PendingOutcome Result;
		if (!Attacker.HasPendingActiveAttack() || Attacker.IsDown() || Defender.IsDown())
		{
			return Result;
		}
		const FighterSnapshot& A = Attacker.Snapshot();
		const AttackSpec Spec = Attacker.CurrentAttackSpec();
		const PunchGeometry G = Measure(A.Slot, Spec, A.AttackZone, A.AimPoint);
		const bool bLast = Attacker.IsLastActiveTick();

		// The active window is the glove at the end of its path: contact on the first tick the target is there.
		const bool bContact = G.bInReach && G.bOnLine;
		if (!bContact)
		{
			if (!bLast)
			{
				return Result;
			}
			// Missed. In reach but off the line: the defender's slip or side step made it miss.
			const FighterSnapshot& D = Defender.Snapshot();
			const bool bEvaded = G.bInReach && (D.Dodge != DodgeDir::None || AbsValue(D.SpeedSide) > 0.30f);
			Result.Outcome = bEvaded ? AttackOutcome::Dodged : AttackOutcome::Whiffed;
			return Result;
		}

		Result.bGlancing = !G.bClean;
		Result.bSmothered = G.Power < 0.85f;
		Result.Power = G.Power * (Result.bGlancing ? Attacker.GetConfig().GlancingDamageFactor : 1.0f);
		if (Defender.IsBlocking())
		{
			const float Drain = Defender.BlockDrain(Attacker.CurrentAttackDamage(false), Spec.Damage, A.AttackZone);
			Result.Outcome = Defender.CanAffordBlock(Drain) ? AttackOutcome::Blocked : AttackOutcome::GuardBroken;
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
		const AttackSpec Spec = Attacker.CurrentAttackSpec();
		const FighterSnapshot& A = Attacker.Snapshot();
		const FighterConfig& AC = Attacker.GetConfig();

		CombatEvent Event;
		Event.Actor = A.Slot;
		Event.Target = Defender.Snapshot().Slot;
		Event.AttackHand = A.AttackHand;
		Event.AttackId = A.AttackId;
		Event.bTired = A.bAttackTired;
		Event.Zone = A.AttackZone;
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
			const float Damage = Attacker.CurrentAttackDamage(Result.bCounter) * Result.Power;
			const int32_t FullStun = Attacker.CurrentAttackHitStun();
			const int32_t Stun = (std::max)(1, static_cast<int32_t>(std::lround(static_cast<double>(FullStun) * Result.Power)));
			Applied = Defender.ReceiveHit(Spec, Damage, Tick, Events, A.AttackId, Stun, A.bAttackTired);
			if (A.AttackZone == PunchZone::Body)
			{
				Defender.TakeStaminaDamage(AC.BodyStaminaDamage * Result.Power, Tick, Events);
			}
			Knockback(Defender.Snapshot().Slot, Spec.KnockbackMeters * Result.Power);
			Event.Type = CombatEventType::HitConfirmed;
			Event.bCounterHit = Result.bCounter;
			Event.bGlancing = Result.bGlancing;
			Event.bSmothered = Result.bSmothered;
			Event.Power = Result.Power;
			if (Result.bGlancing)
			{
				Attacker.NoteGlancing();
			}
			break;
		}
		case AttackOutcome::Blocked:
			Applied = Defender.ReceiveBlockedHit(Spec, Attacker.CurrentAttackDamage(false), Tick, A.AttackZone);
			Knockback(Defender.Snapshot().Slot, Spec.KnockbackMeters * Defender.GetConfig().BlockKnockbackFactor);
			Event.Type = CombatEventType::Blocked;
			Event.Power = Result.Power;
			break;
		case AttackOutcome::Dodged:
			Event.Type = CombatEventType::Dodged;
			Event.Dodge = Defender.Snapshot().Dodge;
			Event.Power = 0.0f;
			Defender.NoteDodge();
			break;
		case AttackOutcome::Whiffed:
			Event.Type = CombatEventType::Whiffed;
			Event.Power = 0.0f;
			break;
		case AttackOutcome::Pending:
			return;
		}

		Attacker.OnAttackResolved(Result.Outcome, Applied, Result.bCounter, Tick);
		Event.ComboCount = (Event.Type == CombatEventType::HitConfirmed) ? Attacker.Snapshot().ComboCount : 0;
		Event.Damage = Applied;
		Event.TargetHealthAfter = Defender.Snapshot().Health;
		Event.TargetStaminaAfter = Defender.Snapshot().Stamina;
		Events.Push(Event);
	}

	void CombatSim::Knockback(FighterSlot Defender, float Meters)
	{
		Fighter& Target = Fighters[SlotIndex(Defender)];
		const Vec2 Away = FacingOf(Defender) * -1.0f;
		Target.SetLocation(Target.Snapshot().Location + Away * Meters);
		SeparateAndClamp(); // the ropes catch it
	}

	void CombatSim::UpdateMovement(const FighterIntent& PlayerIntent, const FighterIntent& OpponentIntent)
	{
		const float Dt = static_cast<float>(kTickSeconds);
		const FighterIntent* Intents[2] = {&PlayerIntent, &OpponentIntent};
		const Vec2 Start[2] = {Fighters[0].Snapshot().Location, Fighters[1].Snapshot().Location};
		const float GapNow = Gap();
		float Forward[2] = {0.0f, 0.0f};
		float Side[2] = {0.0f, 0.0f};

		for (int32_t Index = 0; Index < 2; ++Index)
		{
			Fighter& F = Fighters[Index];
			const FighterSnapshot& S = F.Snapshot();
			const FighterConfig& C = F.GetConfig();
			float Fwd = 0.0f;
			float Lat = 0.0f;
			float Factor = 0.0f;
			if (!F.IsDown() && !C.bPassive)
			{
				Fwd = Clamp(Intents[Index]->MoveForward, -1.0f, 1.0f);
				Lat = Clamp(Intents[Index]->MoveSide, -1.0f, 1.0f);
				if (Index == 0 && MovementCfg.PlayerAutoCloseGap > 0.0f && Fwd == 0.0f && Lat == 0.0f && GapNow > MovementCfg.PlayerAutoCloseGap)
				{
					Fwd = MovementCfg.AutoCloseFactor;
				}
				switch (S.State)
				{
				case ActionState::Guard: Factor = 1.0f; break;
				case ActionState::Attack: Factor = C.AttackMoveFactor; break;
				case ActionState::Block: Factor = C.BlockMoveFactor; break;
				default: Factor = 0.0f; break; // stunned: the legs belong to the punch that landed
				}
				if (S.GassedTicksLeft > 0)
				{
					Factor *= C.GassedMoveFactor;
				}
			}
			if (C.bPassive && !F.IsDown())
			{
				// The training bag swings back to the engage distance after a punch moves it.
				const Vec2 Home = Start[1 - Index] + (Start[Index] - Start[1 - Index]).Normalized(StartFacing(Index) * -1.0f) * MovementCfg.EngageDistance;
				const Vec2 Delta = Home - Start[Index];
				const float Dist = Delta.Length();
				const float MaxStep = MovementCfg.BagReturnSpeed * Dt;
				F.SetLocation(Dist <= MaxStep ? Home : Start[Index] + Delta * (MaxStep / Dist));
				continue;
			}
			const float WantForward = Fwd * (Fwd >= 0.0f ? C.StepForwardSpeed : C.StepBackSpeed) * Factor;
			const float WantSide = Lat * C.CircleSpeed * Factor;
			Forward[Index] = Approach(S.SpeedForward, WantForward, C.MoveAccel, C.MoveBrake, Dt);
			Side[Index] = Approach(S.SpeedSide, WantSide, C.MoveAccel, C.MoveBrake, Dt);

			const Vec2 Rel = Start[1 - Index] - Start[Index];
			const float Radius = Rel.Length();
			const Vec2 Face = Rel.Normalized(StartFacing(Index));
			Vec2 Moved = Start[Index] + Face * (Forward[Index] * Dt) + Face.RightOf() * (Side[Index] * Dt);
			// Circling goes around the opponent: only the forward speed changes the distance.
			if (Side[Index] != 0.0f && Radius > 0.05f)
			{
				const Vec2 FromOther = Moved - Start[1 - Index];
				Moved = Start[1 - Index] + FromOther.Normalized(Face * -1.0f) * (std::max)(0.0f, Radius - Forward[Index] * Dt);
			}
			F.SetLocation(Moved);
		}

		SeparateAndClamp();

		for (int32_t Index = 0; Index < 2; ++Index)
		{
			Fighter& F = Fighters[Index];
			const Vec2 Velocity = (F.Snapshot().Location - Start[Index]) * (1.0f / Dt);
			const Vec2 Face = FacingOf(F.Snapshot().Slot);
			// Speeds follow what really happened: a rope or the opponent's body stops the step.
			const float ActualForward = Velocity.Dot(Face);
			const float ActualSide = Velocity.Dot(Face.RightOf());
			const auto Keep = [](float Planned, float Actual) { return AbsValue(Actual) < AbsValue(Planned) ? Actual : Planned; };
			F.SetMotion(Keep(Forward[Index], ActualForward), Keep(Side[Index], ActualSide), Velocity, F.Snapshot().Facing, false);
		}
		UpdateFacing();
	}

	void CombatSim::SeparateAndClamp()
	{
		const float L = Limit();
		for (int32_t Pass = 0; Pass < 3; ++Pass)
		{
			for (Fighter& F : Fighters)
			{
				const Vec2 P = F.Snapshot().Location;
				F.SetLocation(Vec2{Clamp(P.X, -L, L), Clamp(P.Y, -L, L)});
			}
			const Vec2 P0 = Fighters[0].Snapshot().Location;
			const Vec2 P1 = Fighters[1].Snapshot().Location;
			const Vec2 Rel = P1 - P0;
			const float Dist = Rel.Length();
			if (Dist >= MovementCfg.MinDistance - 1.0e-5f)
			{
				return;
			}
			// Never overlap: push apart along the line; a fighter pinned on the ropes cannot give way.
			const Vec2 N = Rel.Normalized(Vec2{1.0f, 0.0f});
			const float Push = MovementCfg.MinDistance - Dist;
			const float Room0 = RoomAlong(FighterSlot::Player, N * -1.0f);
			const float Room1 = RoomAlong(FighterSlot::Opponent, N);
			float Share0 = 0.5f;
			if (Room0 < Push * 0.5f && Room1 >= Push * 0.5f)
			{
				Share0 = Room0 / Push;
			}
			else if (Room1 < Push * 0.5f && Room0 >= Push * 0.5f)
			{
				Share0 = 1.0f - Room1 / Push;
			}
			Fighters[0].SetLocation(P0 - N * (Push * Share0));
			Fighters[1].SetLocation(P1 + N * (Push * (1.0f - Share0)));
		}
	}

	void CombatSim::UpdateFacing()
	{
		const float RopeLimit = Limit() - MovementCfg.RopeMargin;
		for (int32_t Index = 0; Index < 2; ++Index)
		{
			Fighter& F = Fighters[Index];
			const FighterSnapshot& S = F.Snapshot();
			const Vec2 Face = FacingOf(S.Slot);
			const bool bOnRopes = AbsValue(S.Location.X) >= RopeLimit || AbsValue(S.Location.Y) >= RopeLimit;
			F.SetMotion(S.SpeedForward, S.SpeedSide, S.Velocity, Face, bOnRopes);
		}
	}
}
