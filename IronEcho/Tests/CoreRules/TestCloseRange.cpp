// Close range 1.6: elbows (to the head) and knees (to the body). They land only when the fighters are close, hit harder than a
// straight from there, the elbow can be slipped and blocked, the knee only blocked; a knee leaves the fighter on one leg.
#include "TestFramework.h"

#include "IronEchoRules/BotBrain.h"
#include "IronEchoRules/CombatSim.h"

#include <vector>

using namespace IronEchoCore;

namespace
{
	FighterIntent Idle() { return FighterIntent{}; }

	FighterIntent Strike(Hand InHand, AttackKind Kind, PunchZone Zone = PunchZone::Head)
	{
		FighterIntent Intent;
		Intent.AddPunch(InHand, 1.0f, Zone, Kind);
		return Intent;
	}

	FighterIntent Guard()
	{
		FighterIntent Intent;
		Intent.bBlock = true;
		return Intent;
	}

	FighterIntent Slip()
	{
		FighterIntent Intent;
		Intent.Dodge = DodgeDir::Left;
		Intent.LeanLateral = -1.0f;
		return Intent;
	}

	MovementConfig At(float Gap)
	{
		MovementConfig M;
		M.EngageDistance = Gap;
		M.PlayerAutoCloseGap = 0.0f;
		return M;
	}

	struct Ring
	{
		CombatSim Sim;
		CombatEventBuffer Events;
		std::vector<CombatEvent> Log;
		int32_t Tick = 0;

		explicit Ring(const MovementConfig& M) : Sim(MakeDefaultFighterConfig(), MakeDefaultFighterConfig(), M) {}

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

		const CombatEvent* Last(CombatEventType Type) const
		{
			for (auto It = Log.rbegin(); It != Log.rend(); ++It)
			{
				if (It->Type == Type && It->Actor == FighterSlot::Player)
				{
					return &*It;
				}
			}
			return nullptr;
		}

		int Count(CombatEventType Type) const
		{
			int Total = 0;
			for (const CombatEvent& Event : Log)
			{
				Total += (Event.Type == Type && Event.Actor == FighterSlot::Player) ? 1 : 0;
			}
			return Total;
		}

		const FighterSnapshot& P() const { return Sim.Get(FighterSlot::Player).Snapshot(); }
		const FighterSnapshot& O() const { return Sim.Get(FighterSlot::Opponent).Snapshot(); }
	};

	// One strike of the player against an idle (or guarding / slipping) opponent; returns the damage of the hit, 0 if none.
	float Throw(float Gap, Hand InHand, AttackKind Kind, PunchZone Zone, const FighterIntent& Defender, Ring** Out = nullptr)
	{
		static Ring* Keep = nullptr;
		delete Keep;
		Keep = new Ring(At(Gap));
		Ring& R = *Keep;
		R.Step(Strike(InHand, Kind, Zone), Defender);
		R.Run(SecondsToTicks(1.0), Idle(), Defender);
		if (Out != nullptr)
		{
			*Out = Keep;
		}
		const CombatEvent* Hit = R.Last(CombatEventType::HitConfirmed);
		return Hit != nullptr ? Hit->Damage : 0.0f;
	}
}

IE_TEST(CloseRange_SpecsAreShortFastAndHeavy)
{
	const FighterConfig C = MakeDefaultFighterConfig();
	for (int Index = 0; Index < 2; ++Index)
	{
		IE_EXPECT(C.Elbows[Index].ReachMeters < C.Attacks[Index].ReachMeters - C.SweetSpotMeters + 0.1f); // inside the straights' smothered zone
		IE_EXPECT(C.Elbows[Index].ReachMeters < MovementConfig().EngageDistance);                          // a step in is needed
		IE_EXPECT(C.Knees[Index].ReachMeters < MovementConfig().EngageDistance);
		IE_EXPECT(C.Elbows[Index].Damage > C.Attacks[1].Damage);                                            // heavier than a cross
		IE_EXPECT(C.Knees[Index].Damage > C.Attacks[1].Damage);
		IE_EXPECT(C.Elbows[Index].WindupTicks < C.Kicks[Index].WindupTicks);                                // faster than a kick
		IE_EXPECT(C.Knees[Index].WindupTicks < C.Kicks[Index].WindupTicks);
	}
}

IE_TEST(CloseRange_ElbowLandsInTheClinchNotFromTheWorkingDistance)
{
	Ring* R = nullptr;
	const float Close = Throw(1.05f, Hand::Right, AttackKind::Elbow, PunchZone::Head, Idle(), &R);
	IE_EXPECT(Close > 0.0f);
	const CombatEvent* Hit = R->Last(CombatEventType::HitConfirmed);
	IE_EXPECT(Hit != nullptr && Hit->Kind == AttackKind::Elbow && Hit->Zone == PunchZone::Head);
	IE_EXPECT_EQ(R->P().ElbowsThrown, 1);
	IE_EXPECT_EQ(R->P().ElbowsLanded, 1);
	IE_EXPECT_EQ(R->P().PunchesThrown, 1); // every strike counts in the totals
	Throw(MovementConfig().EngageDistance, Hand::Right, AttackKind::Elbow, PunchZone::Head, Idle(), &R);
	IE_EXPECT_EQ(R->Count(CombatEventType::HitConfirmed), 0);
	IE_EXPECT_EQ(R->Count(CombatEventType::Whiffed), 1);
}

IE_TEST(CloseRange_InTheClinchAnElbowOutHitsASmotheredCross)
{
	const float Elbow = Throw(1.05f, Hand::Right, AttackKind::Elbow, PunchZone::Head, Idle());
	const float Cross = Throw(1.05f, Hand::Right, AttackKind::Punch, PunchZone::Head, Idle());
	std::printf("  info: at 1.05 m: rear elbow %.2f, cross %.2f\n", Elbow, Cross);
	IE_EXPECT(Cross > 0.0f);
	IE_EXPECT(Elbow > 1.5f * Cross);
}

IE_TEST(CloseRange_ElbowCanBeSlippedAndBlocked)
{
	Ring* R = nullptr;
	// the slip is held from the start: a held slip is tracked by the aim, so slip late, during the windup's last part
	R = new Ring(At(1.05f));
	R->Step(Strike(Hand::Left, AttackKind::Elbow), Idle());
	R->Run(MakeDefaultFighterConfig().Elbows[0].WindupTicks - 6, Idle(), Idle());
	R->Run(SecondsToTicks(0.6), Idle(), Slip());
	IE_EXPECT_EQ(R->Count(CombatEventType::HitConfirmed), 0);
	IE_EXPECT(R->Count(CombatEventType::Dodged) == 1 || R->Count(CombatEventType::Whiffed) == 1);
	delete R;
	Throw(1.05f, Hand::Left, AttackKind::Elbow, PunchZone::Head, Guard(), &R);
	IE_EXPECT_EQ(R->Count(CombatEventType::Blocked), 1);
}

IE_TEST(CloseRange_KneeGoesToTheBodyCannotBeSlippedButCanBeBlocked)
{
	Ring* R = nullptr;
	const FighterConfig C = MakeDefaultFighterConfig();
	// asked for the head: a knee always goes to the body
	const float Damage = Throw(1.05f, Hand::Right, AttackKind::Knee, PunchZone::Head, Slip(), &R);
	IE_EXPECT(Damage > 0.0f); // a slip does not take the body off the line
	const CombatEvent* Hit = R->Last(CombatEventType::HitConfirmed);
	IE_EXPECT(Hit != nullptr && Hit->Kind == AttackKind::Knee && Hit->Zone == PunchZone::Body);
	IE_EXPECT(R->O().Stamina < 100.0f - 0.9f * C.KneeBodyStaminaDamage); // the knee takes the wind
	IE_EXPECT_EQ(R->P().KneesThrown, 1);
	IE_EXPECT_EQ(R->P().KneesLanded, 1);
	Throw(1.05f, Hand::Right, AttackKind::Knee, PunchZone::Body, Guard(), &R);
	IE_EXPECT_EQ(R->Count(CombatEventType::Blocked), 1);
	Throw(MovementConfig().EngageDistance, Hand::Right, AttackKind::Knee, PunchZone::Body, Idle(), &R);
	IE_EXPECT_EQ(R->Count(CombatEventType::Whiffed), 1); // out of knee reach
}

IE_TEST(CloseRange_JabIntoElbowCancelsButAKneeIsOnOneLeg)
{
	const FighterConfig C = MakeDefaultFighterConfig();
	// jab, then the same arm's elbow in the jab's recovery: a classic, allowed
	Ring R(At(1.05f));
	R.Step(Strike(Hand::Left, AttackKind::Punch), Idle());
	R.Run(C.Attacks[0].WindupTicks + C.Attacks[0].ActiveTicks + 2, Idle(), Idle());
	IE_EXPECT(R.P().Stage == AttackStage::Recovery);
	R.Step(Strike(Hand::Left, AttackKind::Elbow), Idle());
	IE_EXPECT(R.P().AttackType == AttackKind::Elbow && R.P().Stage == AttackStage::Windup);
	// a knee's recovery cannot be cancelled by anything
	Ring K(At(1.05f));
	K.Step(Strike(Hand::Right, AttackKind::Knee), Idle());
	K.Run(C.Knees[1].WindupTicks + C.Knees[1].ActiveTicks + 2, Idle(), Idle());
	IE_EXPECT(K.P().Stage == AttackStage::Recovery);
	K.Step(Strike(Hand::Left, AttackKind::Elbow), Idle());
	IE_EXPECT(K.P().AttackType == AttackKind::Knee && K.P().Stage == AttackStage::Recovery);
}

IE_TEST(CloseRange_TheBotUsesThemWhenThePlayerWalksIn)
{
	auto Close = [](BotLevel Level) {
		BotConfig Brain = MakeBotConfig(Level);
		CombatSim Sim(MakeDefaultFighterConfig(), MakeBotFighterConfig(Level), At(1.08f));
		BotBrain Bot(Brain, 21);
		CombatEventBuffer Events;
		int Elbows = 0;
		int Knees = 0;
		int All = 0;
		FighterIntent Player;
		Player.MoveForward = 1.0f; // keeps walking into the bot
		for (int32_t Tick = 1; Tick <= SecondsToTicks(40.0); ++Tick)
		{
			const FighterIntent BotIntent = Bot.Think(Sim, Tick);
			Events.Clear();
			Sim.Step(Player, BotIntent, Tick, Events);
			for (const CombatEvent& E : Events)
			{
				if (E.Type == CombatEventType::AttackStarted && E.Actor == FighterSlot::Opponent)
				{
					++All;
					Elbows += E.Kind == AttackKind::Elbow ? 1 : 0;
					Knees += E.Kind == AttackKind::Knee ? 1 : 0;
				}
			}
		}
		std::printf("  info: bot %s in the clinch for 40 s: %d attacks, %d elbows, %d knees\n", BotLevelName(Level), All, Elbows, Knees);
		return Elbows + Knees;
	};
	const int Easy = Close(BotLevel::Easy);
	const int Hard = Close(BotLevel::Hard);
	IE_EXPECT(Easy > 0);
	IE_EXPECT(Hard > Easy);
}
