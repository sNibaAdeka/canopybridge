// Ring 1.2: footwork on the canvas (steps with weight, circling, ropes, clinch distance, the camera player's
// assist) and geometric hit resolution (aim line, slips in time, glancing blows, sweet spot, body shots).
#include "TestFramework.h"

#include "IronEchoRules/CombatSim.h"
#include "IronEchoRules/InputFrame.h"

#include <cmath>
#include <vector>

using namespace IronEchoCore;

namespace
{
	FighterIntent Idle() { return FighterIntent{}; }

	FighterIntent Move(float Forward, float Side = 0.0f)
	{
		FighterIntent Intent;
		Intent.MoveForward = Forward;
		Intent.MoveSide = Side;
		return Intent;
	}

	FighterIntent Punch(Hand InHand, PunchZone Zone = PunchZone::Head)
	{
		FighterIntent Intent;
		Intent.AddPunch(InHand, 1.0f, Zone);
		return Intent;
	}

	FighterIntent Slip(DodgeDir Dir, float Lean = 1.0f)
	{
		FighterIntent Intent;
		Intent.Dodge = Dir;
		Intent.LeanLateral = Dir == DodgeDir::Left ? -Lean : Lean;
		return Intent;
	}

	FighterIntent Guard()
	{
		FighterIntent Intent;
		Intent.bBlock = true;
		return Intent;
	}

	struct Ring
	{
		CombatSim Sim;
		CombatEventBuffer Events;
		std::vector<CombatEvent> Log;
		int32_t Tick = 0;

		explicit Ring(const FighterConfig& PlayerCfg = MakeDefaultFighterConfig(), const FighterConfig& OppCfg = MakeDefaultFighterConfig(),
			const MovementConfig& Movement = MovementConfig())
			: Sim(PlayerCfg, OppCfg, Movement)
		{
		}

		void Step(const FighterIntent& Player, const FighterIntent& Opponent)
		{
			Events.Clear();
			Sim.Step(Player, Opponent, ++Tick, Events);
			for (const CombatEvent& Event : Events)
			{
				Log.push_back(Event);
			}
		}

		void Run(int32_t Ticks, const FighterIntent& Player = FighterIntent{}, const FighterIntent& Opponent = FighterIntent{})
		{
			for (int32_t Index = 0; Index < Ticks; ++Index)
			{
				Step(Player, Opponent);
			}
		}

		const CombatEvent* Find(CombatEventType Type, FighterSlot Actor) const
		{
			for (const CombatEvent& Event : Log)
			{
				if (Event.Type == Type && Event.Actor == Actor)
				{
					return &Event;
				}
			}
			return nullptr;
		}

		int Count(CombatEventType Type, FighterSlot Actor) const
		{
			int Total = 0;
			for (const CombatEvent& Event : Log)
			{
				Total += (Event.Type == Type && Event.Actor == Actor) ? 1 : 0;
			}
			return Total;
		}

		const FighterSnapshot& P() const { return Sim.Get(FighterSlot::Player).Snapshot(); }
		const FighterSnapshot& O() const { return Sim.Get(FighterSlot::Opponent).Snapshot(); }
	};

	float Limit()
	{
		const MovementConfig M;
		return M.RingHalfSize - M.FighterRadius;
	}
}

IE_TEST(Ring_StartsFacingAtEngageDistance)
{
	Ring R;
	IE_EXPECT_NEAR(R.Sim.Gap(), MovementConfig().EngageDistance, 1e-5);
	IE_EXPECT_NEAR(R.P().Facing.X, 1.0, 1e-6);
	IE_EXPECT_NEAR(R.O().Facing.X, -1.0, 1e-6);
	R.Run(kTickRate);
	IE_EXPECT_NEAR(R.Sim.Gap(), MovementConfig().EngageDistance, 1e-5); // nobody drifts on their own
}

IE_TEST(Ring_StepsHaveWeight)
{
	MovementConfig NoAssist;
	NoAssist.PlayerAutoCloseGap = 0.0f;
	Ring R(MakeDefaultFighterConfig(), MakeDefaultFighterConfig(), NoAssist);
	const FighterConfig C = MakeDefaultFighterConfig();
	R.Step(Move(-1.0f), Idle());
	IE_EXPECT(R.P().SpeedForward < 0.0f);
	IE_EXPECT(-R.P().SpeedForward < C.StepBackSpeed * 0.2f); // no instant start
	R.Run(SecondsToTicks(0.3), Move(-1.0f), Idle());
	IE_EXPECT_NEAR(R.P().SpeedForward, -C.StepBackSpeed, 1e-4);
	IE_EXPECT(R.P().bMoving);
	R.Run(SecondsToTicks(0.3), Idle(), Idle());
	IE_EXPECT_NEAR(R.P().SpeedForward, 0.0, 1e-5); // and a real stop
	IE_EXPECT(!R.P().bMoving);
}

IE_TEST(Ring_StepInStopsAtClinchStepBackOpens)
{
	Ring R;
	const MovementConfig M;
	R.Run(kTickRate, Move(1.0f), Idle());
	IE_EXPECT_NEAR(R.Sim.Gap(), M.MinDistance, 1e-3);
	R.Run(kTickRate, Move(-1.0f), Idle());
	IE_EXPECT(R.Sim.Gap() > 2.0f);
	IE_EXPECT(R.Sim.Gap() > MakeDefaultFighterConfig().Attacks[0].ReachMeters); // out of reach: safe
}

IE_TEST(Ring_CirclingKeepsDistanceAndTurnsTheFightLine)
{
	Ring R;
	const float Gap0 = R.Sim.Gap();
	R.Run(SecondsToTicks(1.5), Move(0.0f, 1.0f), Idle()); // circle to the player's right
	IE_EXPECT_NEAR(R.Sim.Gap(), Gap0, 0.03);
	IE_EXPECT(R.P().Location.Y < -0.5f); // facing +X, the right is -Y
	// Both keep facing each other.
	const Vec2 ToOpp = R.O().Location - R.P().Location;
	IE_EXPECT_NEAR(R.P().Facing.Cross(ToOpp.Normalized()), 0.0, 1e-4);
	IE_EXPECT(R.P().Facing.Dot(ToOpp) > 0.0f);
	IE_EXPECT_NEAR(R.O().Facing.Dot(R.P().Facing), -1.0, 1e-4);
}

IE_TEST(Ring_RopesStopTheRetreat)
{
	Ring R;
	R.Run(kTickRate * 4, Move(-1.0f), Idle());
	IE_EXPECT_NEAR(R.P().Location.X, -Limit(), 1e-4);
	IE_EXPECT(R.P().bOnRopes);
	IE_EXPECT(std::fabs(R.P().SpeedForward) < 0.05f);
	IE_EXPECT(!R.O().bOnRopes);
	// Pressed on the ropes, the player is not pushed through them: the walker stops at the clinch.
	R.Run(kTickRate * 4, Move(-1.0f), Move(1.0f));
	IE_EXPECT(R.P().Location.X >= -Limit() - 1e-4f);
	IE_EXPECT(R.Sim.Gap() >= MovementConfig().MinDistance - 1e-4f);
	// The way out is to the side.
	const Vec2 Before = R.P().Location;
	R.Run(kTickRate, Move(0.0f, -1.0f), Idle());
	IE_EXPECT((R.P().Location - Before).Length() > 0.6f);
}

IE_TEST(Ring_CornerHoldsBothAxes)
{
	Ring R;
	R.Run(kTickRate * 6, Move(-0.7f, 0.7f), Idle());
	IE_EXPECT(std::fabs(R.P().Location.X) <= Limit() + 1e-4f && std::fabs(R.P().Location.Y) <= Limit() + 1e-4f);
	IE_EXPECT(R.P().bOnRopes);
}

IE_TEST(Ring_CameraPlayerIsBroughtBackIntoRange)
{
	Ring R;
	const MovementConfig M;
	R.Run(kTickRate, Idle(), Move(-1.0f)); // the opponent walks away
	IE_EXPECT(R.Sim.Gap() > M.PlayerAutoCloseGap + 0.15f);
	R.Run(kTickRate * 4, Idle(), Idle());
	IE_EXPECT(R.Sim.Gap() <= M.PlayerAutoCloseGap + 0.03f);
	// Off: the player stays where they are.
	MovementConfig Off;
	Off.PlayerAutoCloseGap = 0.0f;
	Ring Manual(MakeDefaultFighterConfig(), MakeDefaultFighterConfig(), Off);
	Manual.Run(kTickRate * 2, Idle(), Move(-1.0f));
	const float Far = Manual.Sim.Gap();
	Manual.Run(kTickRate * 2, Idle(), Idle());
	IE_EXPECT_NEAR(Manual.Sim.Gap(), Far, 0.05);
}

IE_TEST(Ring_StunnedLegsDoNotWalk)
{
	Ring R;
	R.Step(Punch(Hand::Right), Move(-1.0f));
	for (int Guard = 0; Guard < 40 && R.O().State != ActionState::HitStun; ++Guard)
	{
		R.Step(Idle(), Move(-1.0f));
	}
	// Still moving back (the punch caught it walking), so the knock-back plus the step carry it; but the stun stops it.
	IE_EXPECT(R.O().State == ActionState::HitStun || R.Count(CombatEventType::Whiffed, FighterSlot::Player) == 1);
	if (R.O().State == ActionState::HitStun)
	{
		R.Run(SecondsToTicks(0.12), Idle(), Move(-1.0f));
		IE_EXPECT(std::fabs(R.O().SpeedForward) < 0.1f);
	}
}

IE_TEST(Ring_KnockbackFollowsTheFightLine)
{
	Ring R;
	R.Run(SecondsToTicks(1.2), Move(0.0f, 1.0f), Idle()); // rotate the line
	R.Run(SecondsToTicks(0.3), Idle(), Idle());
	const float Gap0 = R.Sim.Gap();
	const Vec2 Dir = (R.O().Location - R.P().Location).Normalized();
	const Vec2 Before = R.O().Location;
	R.Step(Punch(Hand::Right), Idle());
	R.Run(30);
	IE_EXPECT_EQ(R.Count(CombatEventType::HitConfirmed, FighterSlot::Player), 1);
	IE_EXPECT(R.Sim.Gap() > Gap0 + 0.10f);
	const Vec2 Moved = R.O().Location - Before;
	IE_EXPECT(Moved.Dot(Dir) > 0.10f);
	IE_EXPECT(std::fabs(Moved.Cross(Dir)) < 0.02f);
}

// ---- precision ----

IE_TEST(Precision_SlipInTimeMakesTheCrossMiss)
{
	Ring R;
	const AttackSpec Cross = MakeDefaultFighterConfig().Attacks[1];
	const int32_t Commit = MakeDefaultFighterConfig().AimCommitTicks;
	R.Step(Punch(Hand::Right), Idle());
	R.Run(Cross.WindupTicks - Commit - 1, Idle(), Idle()); // still upright when the punch commits
	R.Run(Commit + Cross.ActiveTicks + 2, Idle(), Slip(DodgeDir::Right));
	IE_EXPECT_EQ(R.Count(CombatEventType::Dodged, FighterSlot::Player), 1);
	IE_EXPECT_NEAR(R.O().Health, 100.0, 1e-5);
	IE_EXPECT_EQ(R.O().DodgesMade, 1);
	// The miss is real geometry: the head is off the punch line.
	IE_EXPECT(R.O().HeadOffset > MakeDefaultFighterConfig().HeadGlanceRadius);
}

IE_TEST(Precision_TooLateSlipStillGetsHit)
{
	Ring R;
	const AttackSpec Cross = MakeDefaultFighterConfig().Attacks[1];
	R.Step(Punch(Hand::Right), Idle());
	R.Run(Cross.WindupTicks - 3, Idle(), Idle());
	R.Run(Cross.ActiveTicks + 5, Idle(), Slip(DodgeDir::Right)); // 3 ticks: the head moves 7.5 cm
	IE_EXPECT_EQ(R.Count(CombatEventType::HitConfirmed, FighterSlot::Player), 1);
}

IE_TEST(Precision_SlipHeldFromBeforeIsTracked)
{
	Ring R;
	R.Run(SecondsToTicks(0.5), Idle(), Slip(DodgeDir::Left));
	R.Step(Punch(Hand::Left), Slip(DodgeDir::Left));
	R.Run(30, Idle(), Slip(DodgeDir::Left));
	IE_EXPECT_EQ(R.Count(CombatEventType::HitConfirmed, FighterSlot::Player), 1);
	const CombatEvent* Hit = R.Find(CombatEventType::HitConfirmed, FighterSlot::Player);
	IE_EXPECT(Hit != nullptr && !Hit->bGlancing);
}

IE_TEST(Precision_HalfSlipIsAGlancingBlow)
{
	Ring R;
	const FighterConfig C = MakeDefaultFighterConfig();
	const AttackSpec Cross = C.Attacks[1];
	R.Step(Punch(Hand::Right), Idle());
	R.Run(Cross.WindupTicks - C.AimCommitTicks - 1, Idle(), Idle());
	const float Lean = 0.5f * (C.HeadHitRadius + C.HeadGlanceRadius) / C.HeadSlipMeters; // head ends between the radii
	R.Run(C.AimCommitTicks + Cross.ActiveTicks + 2, Idle(), Slip(DodgeDir::Left, Lean));
	const CombatEvent* Hit = R.Find(CombatEventType::HitConfirmed, FighterSlot::Player);
	IE_EXPECT(Hit != nullptr);
	if (Hit != nullptr)
	{
		IE_EXPECT(Hit->bGlancing);
		IE_EXPECT_NEAR(Hit->Power, C.GlancingDamageFactor, 1e-4);
		IE_EXPECT_NEAR(Hit->Damage, Cross.Damage * C.GlancingDamageFactor, 1e-4);
	}
	IE_EXPECT_EQ(R.P().GlancingHits, 1);
}

IE_TEST(Precision_FullPowerAtTheEndOfTheArmSmotheredInTheClinch)
{
	const FighterConfig C = MakeDefaultFighterConfig();
	Ring Long;
	Long.Step(Punch(Hand::Right), Idle());
	Long.Run(30);
	const CombatEvent* Clean = Long.Find(CombatEventType::HitConfirmed, FighterSlot::Player);
	IE_EXPECT(Clean != nullptr && Clean->Power == 1.0f && !Clean->bSmothered);

	Ring Close;
	Close.Run(kTickRate, Idle(), Move(1.0f)); // the opponent walks into the clinch
	Close.Run(SecondsToTicks(0.3));
	IE_EXPECT_NEAR(Close.Sim.Gap(), MovementConfig().MinDistance, 1e-3);
	Close.Step(Punch(Hand::Right), Idle());
	Close.Run(30);
	const CombatEvent* Jammed = Close.Find(CombatEventType::HitConfirmed, FighterSlot::Player);
	IE_EXPECT(Jammed != nullptr);
	if (Jammed != nullptr)
	{
		IE_EXPECT(Jammed->bSmothered);
		IE_EXPECT_NEAR(Jammed->Power, C.SmotheredDamageFactor, 1e-3);
		IE_EXPECT_NEAR(Jammed->Damage, C.Attacks[1].Damage * C.SmotheredDamageFactor, 1e-3);
	}
}

IE_TEST(Precision_StepBackOutOfATelegraphedPunch)
{
	Ring R(MakeDefaultFighterConfig(), MakeBotFighterConfig(BotLevel::Normal));
	R.Step(Idle(), Punch(Hand::Right));
	R.Run(SecondsToTicks(1.0), Move(-1.0f), Idle());
	IE_EXPECT_EQ(R.Count(CombatEventType::Whiffed, FighterSlot::Opponent), 1);
	IE_EXPECT_NEAR(R.P().Health, 100.0, 1e-5);
}

IE_TEST(Precision_CirclingTargetIsLed)
{
	// A target that keeps circling at a steady pace is anticipated and hit.
	Ring R(MakeDefaultFighterConfig(), MakeBotFighterConfig(BotLevel::Normal));
	R.Run(SecondsToTicks(0.4), Move(0.0f, 1.0f), Idle());
	R.Step(Move(0.0f, 1.0f), Punch(Hand::Left));
	R.Run(SecondsToTicks(1.0), Move(0.0f, 1.0f), Idle());
	IE_EXPECT_EQ(R.Count(CombatEventType::HitConfirmed, FighterSlot::Opponent), 1);
}

IE_TEST(Precision_ChangeOfDirectionBeatsACommittedPunch)
{
	const FighterConfig Bot = MakeBotFighterConfig(BotLevel::Normal);
	Ring R(MakeDefaultFighterConfig(), Bot);
	R.Run(SecondsToTicks(0.4), Move(0.0f, 1.0f), Idle());
	R.Step(Move(0.0f, 1.0f), Punch(Hand::Right));
	R.Run(Bot.Attacks[1].WindupTicks - Bot.AimCommitTicks - 1, Move(0.0f, 1.0f), Idle());
	// committed: now reverse and slip the other way
	FighterIntent Juke = Move(0.0f, -1.0f);
	Juke.Dodge = DodgeDir::Left;
	Juke.LeanLateral = -1.0f;
	R.Run(Bot.AimCommitTicks + Bot.Attacks[1].ActiveTicks + 3, Juke, Idle());
	IE_EXPECT_EQ(R.Count(CombatEventType::HitConfirmed, FighterSlot::Opponent), 0);
	IE_EXPECT_EQ(R.Count(CombatEventType::Dodged, FighterSlot::Opponent), 1);
}

// ---- body shots ----

IE_TEST(Body_ShotCannotBeSlippedAndTakesTheWind)
{
	Ring R;
	const FighterConfig C = MakeDefaultFighterConfig();
	R.Step(Punch(Hand::Left, PunchZone::Body), Idle());
	R.Run(30, Idle(), Slip(DodgeDir::Right));
	const CombatEvent* Hit = R.Find(CombatEventType::HitConfirmed, FighterSlot::Player);
	IE_EXPECT(Hit != nullptr);
	if (Hit != nullptr)
	{
		IE_EXPECT(Hit->Zone == PunchZone::Body);
		IE_EXPECT_NEAR(Hit->Damage, C.Attacks[0].Damage * C.BodyDamageFactor, 1e-4);
	}
	IE_EXPECT_EQ(R.P().BodyPunchesLanded, 1);
	// slip entry (3) + the body shot (9), no regeneration within the delay
	IE_EXPECT_NEAR(R.O().Stamina, 100.0 - C.DodgeEntryStaminaCost - C.BodyStaminaDamage, 0.5);
}

IE_TEST(Body_ShotsAreShorter)
{
	const FighterConfig C = MakeDefaultFighterConfig();
	MovementConfig Between;
	Between.EngageDistance = C.Attacks[0].ReachMeters + 0.5f * C.BodyReachDelta; // in reach of a jab to the head only
	Between.PlayerAutoCloseGap = 0.0f;
	Ring R(C, C, Between);
	R.Step(Punch(Hand::Left, PunchZone::Body), Idle());
	R.Run(30);
	IE_EXPECT_EQ(R.Count(CombatEventType::Whiffed, FighterSlot::Player), 1);
	R.Run(40);
	R.Step(Punch(Hand::Left), Idle());
	R.Run(40);
	IE_EXPECT_EQ(R.Count(CombatEventType::HitConfirmed, FighterSlot::Player), 1);
}

IE_TEST(Body_GuardPaysMoreForABodyShot)
{
	const FighterConfig C = MakeDefaultFighterConfig();
	Ring Head;
	Head.Run(2, Idle(), Guard());
	Head.Step(Punch(Hand::Right), Guard());
	Head.Run(30, Idle(), Guard());
	Ring Body;
	Body.Run(2, Idle(), Guard());
	Body.Step(Punch(Hand::Right, PunchZone::Body), Guard());
	Body.Run(30, Idle(), Guard());
	IE_EXPECT_EQ(Head.Count(CombatEventType::Blocked, FighterSlot::Player), 1);
	IE_EXPECT_EQ(Body.Count(CombatEventType::Blocked, FighterSlot::Player), 1);
	const float HeadCost = 100.0f - Head.O().Stamina;
	const float BodyCost = 100.0f - Body.O().Stamina;
	IE_EXPECT(BodyCost > HeadCost * 1.3f);
	(void)C;
}

// ---- intent ----

IE_TEST(Intent_CameraLeanStepsWithHysteresisDirectInputWins)
{
	IntentMapper Mapper;
	InputFrame F;
	F.Status = TrackingStatus::Live;
	F.LeanForward = 0.6f;
	IE_EXPECT_NEAR(Mapper.Map(F).MoveForward, 1.0, 1e-6);
	F.LeanForward = 0.4f; // inside the band: keeps stepping
	IE_EXPECT_NEAR(Mapper.Map(F).MoveForward, 1.0, 1e-6);
	F.LeanForward = 0.2f;
	IE_EXPECT_NEAR(Mapper.Map(F).MoveForward, 0.0, 1e-6);
	F.LeanForward = -0.6f;
	IE_EXPECT_NEAR(Mapper.Map(F).MoveForward, -1.0, 1e-6);
	F.MoveForward = 0.5f;
	F.MoveLateral = -1.0f;
	const FighterIntent Direct = Mapper.Map(F);
	IE_EXPECT_NEAR(Direct.MoveForward, 0.5, 1e-6);
	IE_EXPECT_NEAR(Direct.MoveSide, -1.0, 1e-6);
	F.Status = TrackingStatus::NoPerson;
	IE_EXPECT_NEAR(Mapper.Map(F).MoveForward, 0.0, 1e-6);
	PunchIntent Body;
	Body.PunchHand = Hand::Right;
	Body.Confidence = 1.0f;
	Body.Zone = PunchZone::Body;
	InputFrame P;
	P.Status = TrackingStatus::Live;
	P.AddPunch(Body);
	const FighterIntent WithPunch = Mapper.Map(P);
	IE_EXPECT(WithPunch.PunchCount == 1 && WithPunch.Punches[0].Zone == PunchZone::Body);
}
