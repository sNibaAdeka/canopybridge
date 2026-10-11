// Boxing depth 1.7: hooks, uppercuts and the duck. No defence beats everything:
//   a late slip beats a straight and an uppercut, not a hook (its path sweeps across the head's line);
//   a late duck beats a straight and a hook, not an uppercut (which rises into the ducked head: a counter hit);
//   a guard stops straights and hooks, but half an uppercut comes up between the gloves;
//   a duck made before the punch started is aimed at (like a slip held from early on).
#include "TestFramework.h"

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

	FighterIntent Duck()
	{
		FighterIntent Intent;
		Intent.bDuck = true;
		return Intent;
	}

	MovementConfig At(float Gap)
	{
		MovementConfig M;
		M.EngageDistance = Gap;
		M.PlayerAutoCloseGap = 0.0f;
		return M;
	}

	struct Outcome
	{
		CombatEvent Contact;   // the player's Hit / Blocked / Dodged / Whiffed
		bool bHasContact = false;
		FighterSnapshot Player;
		FighterSnapshot Opponent;
		FighterSnapshot OpponentAfterContact; // 0.1 s after the contact
	};

	// The player throws one strike at an opponent standing Gap away. The opponent does nothing until DefendFromTick (ticks after
	// the strike starts; <= 0: from before it) and then holds Defence.
	Outcome Exchange(float Gap, Hand InHand, AttackKind Kind, PunchZone Zone, const FighterIntent& Defence, int32_t DefendFromTick)
	{
		CombatSim Sim(MakeDefaultFighterConfig(), MakeDefaultFighterConfig(), At(Gap));
		CombatEventBuffer Events;
		Outcome Out;
		int32_t Tick = 0;
		int32_t ContactTick = -1;
		auto Step = [&](const FighterIntent& P, const FighterIntent& O) {
			Events.Clear();
			Sim.Step(P, O, ++Tick, Events);
			if (ContactTick > 0 && Tick == ContactTick + SecondsToTicks(0.1))
			{
				Out.OpponentAfterContact = Sim.Get(FighterSlot::Opponent).Snapshot();
			}
			for (const CombatEvent& E : Events)
			{
				const bool bContact = E.Type == CombatEventType::HitConfirmed || E.Type == CombatEventType::Blocked
					|| E.Type == CombatEventType::Dodged || E.Type == CombatEventType::Whiffed;
				if (bContact && E.Actor == FighterSlot::Player && !Out.bHasContact)
				{
					Out.Contact = E;
					Out.bHasContact = true;
					ContactTick = Tick;
				}
			}
		};
		// a defence from before the strike: held for half a second first (the duck gets all the way down)
		if (DefendFromTick <= 0)
		{
			for (int32_t Index = 0; Index < SecondsToTicks(0.5); ++Index)
			{
				Step(Idle(), Defence);
			}
		}
		Step(Strike(InHand, Kind, Zone), DefendFromTick <= 0 ? Defence : Idle());
		for (int32_t Index = 1; Index < SecondsToTicks(1.0); ++Index)
		{
			Step(Idle(), Index >= DefendFromTick ? Defence : Idle());
		}
		Out.Player = Sim.Get(FighterSlot::Player).Snapshot();
		Out.Opponent = Sim.Get(FighterSlot::Opponent).Snapshot();
		return Out;
	}

	int32_t Windup(Hand InHand, AttackKind Kind)
	{
		Fighter F(FighterSlot::Player, MakeDefaultFighterConfig());
		return F.SpecFor(InHand, PunchZone::Head, Kind).WindupTicks;
	}

	bool Landed(const Outcome& O) { return O.bHasContact && O.Contact.Type == CombatEventType::HitConfirmed; }
	bool Evaded(const Outcome& O) { return O.bHasContact && O.Contact.Type == CombatEventType::Dodged; }
}

IE_TEST(BoxingDepth_SpecsHaveTheirOwnRanges)
{
	const FighterConfig C = MakeDefaultFighterConfig();
	const MovementConfig M;
	for (int32_t Index = 0; Index < 2; ++Index)
	{
		// a hook lands from the working distance, but a step back takes the head out of it while the straights still reach
		IE_EXPECT(C.Hooks[Index].ReachMeters >= M.EngageDistance);
		IE_EXPECT(C.Hooks[Index].ReachMeters < C.Attacks[Index].ReachMeters - 0.05f);
		// an uppercut needs a step in
		IE_EXPECT(C.Uppercuts[Index].ReachMeters < M.EngageDistance);
		IE_EXPECT(C.Uppercuts[Index].ReachMeters > C.Elbows[Index].ReachMeters);
		// heavier than the straight of the same hand, a little slower to start
		IE_EXPECT(C.Hooks[Index].Damage > C.Attacks[Index].Damage);
		IE_EXPECT(C.Uppercuts[Index].Damage > C.Attacks[Index].Damage);
		IE_EXPECT(C.Hooks[Index].WindupTicks >= C.Attacks[Index].WindupTicks);
		IE_EXPECT(C.Uppercuts[Index].WindupTicks >= C.Attacks[Index].WindupTicks);
	}
	const FighterConfig Bot = MakeBotFighterConfig(BotLevel::Normal);
	IE_EXPECT(Bot.Hooks[1].WindupTicks > Bot.Attacks[1].WindupTicks); // the bot's tell is longer still
	IE_EXPECT(Bot.Uppercuts[1].WindupTicks > Bot.Attacks[1].WindupTicks);
}

IE_TEST(BoxingDepth_ALateSlipBeatsTheStraightButNotTheHook)
{
	const Outcome Straight = Exchange(1.30f, Hand::Left, AttackKind::Punch, PunchZone::Head, Slip(), Windup(Hand::Left, AttackKind::Punch) - 6);
	const Outcome Hook = Exchange(1.30f, Hand::Left, AttackKind::Hook, PunchZone::Head, Slip(), Windup(Hand::Left, AttackKind::Hook) - 6);
	IE_EXPECT(Evaded(Straight));
	IE_EXPECT(Landed(Hook));
	IE_EXPECT(Hook.Contact.Kind == AttackKind::Hook);
	IE_EXPECT_EQ(Hook.Player.HooksThrown, 1);
	IE_EXPECT_EQ(Hook.Player.HooksLanded, 1);
	IE_EXPECT_EQ(Hook.Player.PunchesLanded, 1);
}

IE_TEST(BoxingDepth_ALateDuckBeatsTheStraightAndTheHook)
{
	const Outcome Straight = Exchange(1.30f, Hand::Right, AttackKind::Punch, PunchZone::Head, Duck(), Windup(Hand::Right, AttackKind::Punch) - 10);
	const Outcome Hook = Exchange(1.30f, Hand::Right, AttackKind::Hook, PunchZone::Head, Duck(), Windup(Hand::Right, AttackKind::Hook) - 10);
	IE_EXPECT(Evaded(Straight));
	IE_EXPECT(Evaded(Hook));
	IE_EXPECT(Hook.Contact.bDucked);
	IE_EXPECT_EQ(Hook.Opponent.DucksMade, 1);
	IE_EXPECT(Hook.OpponentAfterContact.Stamina < Hook.OpponentAfterContact.MaxStamina); // a duck costs a breath, like a slip
}

IE_TEST(BoxingDepth_TheUppercutPunishesTheDuckAndIsBeatenByTheSlip)
{
	const int32_t W = Windup(Hand::Right, AttackKind::Uppercut);
	const Outcome IntoDuck = Exchange(1.05f, Hand::Right, AttackKind::Uppercut, PunchZone::Head, Duck(), W - 10);
	const Outcome Clean = Exchange(1.05f, Hand::Right, AttackKind::Uppercut, PunchZone::Head, Idle(), 1000);
	const Outcome IntoSlip = Exchange(1.05f, Hand::Right, AttackKind::Uppercut, PunchZone::Head, Slip(), W - 6);
	IE_EXPECT(Landed(IntoDuck));
	IE_EXPECT(IntoDuck.Contact.bCounterHit);
	IE_EXPECT(IntoDuck.Contact.Damage > Clean.Contact.Damage * 1.1f);
	IE_EXPECT(Landed(Clean) && !Clean.Contact.bCounterHit);
	IE_EXPECT(Evaded(IntoSlip));
	IE_EXPECT_EQ(IntoDuck.Player.UppercutsLanded, 1);
	std::printf("  info: rear uppercut at 1.05 m: clean %.2f, into a duck %.2f\n", Clean.Contact.Damage, IntoDuck.Contact.Damage);
}

IE_TEST(BoxingDepth_HalfAnUppercutComesUpThroughTheGuard)
{
	const Outcome Clean = Exchange(1.05f, Hand::Right, AttackKind::Uppercut, PunchZone::Head, Idle(), 1000);
	const Outcome Guarded = Exchange(1.05f, Hand::Right, AttackKind::Uppercut, PunchZone::Head, Guard(), 0);
	const Outcome Cross = Exchange(1.30f, Hand::Right, AttackKind::Punch, PunchZone::Head, Guard(), 0);
	const Outcome Hook = Exchange(1.30f, Hand::Right, AttackKind::Hook, PunchZone::Head, Guard(), 0);
	IE_EXPECT(Landed(Guarded));
	IE_EXPECT(Guarded.Contact.bThroughGuard);
	IE_EXPECT_NEAR(Guarded.Contact.Damage, 0.5f * Clean.Contact.Damage, 0.05f);
	IE_EXPECT_NEAR(Guarded.Opponent.Stamina, Guarded.Opponent.MaxStamina, 2.0f); // the gloves were not touched
	IE_EXPECT(Cross.bHasContact && Cross.Contact.Type == CombatEventType::Blocked);
	IE_EXPECT(Hook.bHasContact && Hook.Contact.Type == CombatEventType::Blocked);
}

IE_TEST(BoxingDepth_ADuckMadeEarlyIsAimedAt)
{
	// ducked half a second before the punch: the punch is thrown at the ducked head and lands
	const Outcome Early = Exchange(1.30f, Hand::Left, AttackKind::Punch, PunchZone::Head, Duck(), 0);
	IE_EXPECT(Landed(Early));
	// standing up after the aim was committed takes the head off a punch aimed low
	FighterIntent Up = Idle();
	CombatSim Sim(MakeDefaultFighterConfig(), MakeDefaultFighterConfig(), At(1.30f));
	CombatEventBuffer Events;
	int32_t Tick = 0;
	for (int32_t Index = 0; Index < SecondsToTicks(0.5); ++Index)
	{
		Sim.Step(Idle(), Duck(), ++Tick, Events);
	}
	Events.Clear();
	Sim.Step(Strike(Hand::Right, AttackKind::Punch), Duck(), ++Tick, Events);
	bool bDodged = false;
	for (int32_t Index = 1; Index < SecondsToTicks(1.0); ++Index)
	{
		Events.Clear();
		Sim.Step(Idle(), Index >= Windup(Hand::Right, AttackKind::Punch) - 10 ? Up : Duck(), ++Tick, Events);
		for (const CombatEvent& E : Events)
		{
			bDodged = bDodged || (E.Type == CombatEventType::Dodged && E.Actor == FighterSlot::Player);
		}
	}
	IE_EXPECT(bDodged);
}

IE_TEST(BoxingDepth_BodyShotsIgnoreTheDuckAndTheUppercutAlwaysGoesUpstairs)
{
	const Outcome BodyHook = Exchange(1.30f, Hand::Left, AttackKind::Hook, PunchZone::Body, Duck(), 0);
	IE_EXPECT(Landed(BodyHook));
	IE_EXPECT(BodyHook.Contact.Zone == PunchZone::Body);
	IE_EXPECT_EQ(BodyHook.Player.BodyPunchesLanded, 1);
	const Outcome Upper = Exchange(1.05f, Hand::Left, AttackKind::Uppercut, PunchZone::Body, Idle(), 1000);
	IE_EXPECT(Upper.bHasContact && Upper.Contact.Zone == PunchZone::Head);
}

IE_TEST(BoxingDepth_DuckingSlowsTheFeetAndAHitStandsTheFighterUp)
{
	auto Walk = [](bool bDuck) {
		CombatSim Sim(MakeDefaultFighterConfig(), MakeDefaultFighterConfig(), At(2.5f));
		CombatEventBuffer Events;
		FighterIntent Move;
		Move.MoveForward = 1.0f;
		Move.bDuck = bDuck;
		const float Start = Sim.Gap();
		for (int32_t Tick = 1; Tick <= SecondsToTicks(0.5); ++Tick)
		{
			Events.Clear();
			Sim.Step(Move, Idle(), Tick, Events);
		}
		return Start - Sim.Gap();
	};
	const float Up = Walk(false);
	const float Down = Walk(true);
	IE_EXPECT(Down < 0.7f * Up);

	// ducked and hit by an uppercut: stunned, the fighter stands up (the duck ends, the head comes back)
	const Outcome Hit = Exchange(1.05f, Hand::Right, AttackKind::Uppercut, PunchZone::Head, Duck(), Windup(Hand::Right, AttackKind::Uppercut) - 10);
	IE_EXPECT(Landed(Hit));
	IE_EXPECT(!Hit.OpponentAfterContact.bDucking);
	IE_EXPECT(Hit.OpponentAfterContact.HeadDrop < 0.5f * MakeDefaultFighterConfig().DuckDepthMeters);
}

// ---- the bot (1.7) ----

#include "IronEchoRules/BotBrain.h"

namespace
{
	struct BotTally
	{
		int Straights = 0;
		int Hooks = 0;
		int Uppercuts = 0;
		int Ducked = 0;      // the player's punches that went over the bot's ducked head
		int Slipped = 0;     // ... that the bot slipped
		int HeadAttacks() const { return Straights + Hooks + Uppercuts; }
	};

	// A bot of Level against a scripted player for Seconds. Player(Sim, Tick) gives the player's intent.
	template <typename Fn>
	BotTally RunBot(BotLevel Level, float Gap, double Seconds, Fn Player, uint64_t Seed = 7)
	{
		CombatSim Sim(MakeDefaultFighterConfig(), MakeBotFighterConfig(Level), At(Gap));
		BotBrain Bot(MakeBotConfig(Level), Seed);
		CombatEventBuffer Events;
		BotTally T;
		for (int32_t Tick = 1; Tick <= SecondsToTicks(Seconds); ++Tick)
		{
			const FighterIntent BotIntent = Bot.Think(Sim, Tick);
			const FighterIntent PlayerIntent = Player(Sim, Tick);
			Events.Clear();
			Sim.Step(PlayerIntent, BotIntent, Tick, Events);
			for (const CombatEvent& E : Events)
			{
				if (E.Type == CombatEventType::AttackStarted && E.Actor == FighterSlot::Opponent && E.Zone == PunchZone::Head)
				{
					T.Straights += E.Kind == AttackKind::Punch ? 1 : 0;
					T.Hooks += E.Kind == AttackKind::Hook ? 1 : 0;
					T.Uppercuts += E.Kind == AttackKind::Uppercut ? 1 : 0;
				}
				if (E.Type == CombatEventType::Dodged && E.Actor == FighterSlot::Player)
				{
					T.Ducked += E.bDucked ? 1 : 0;
					T.Slipped += E.Dodge != DodgeDir::None ? 1 : 0;
				}
			}
		}
		return T;
	}

	// The player defends every bot windup the same way, at once, and never punches.
	auto Defender(int Habit)
	{
		return [Habit](const CombatSim& Sim, int32_t) {
			FighterIntent Intent;
			const FighterSnapshot& B = Sim.Get(FighterSlot::Opponent).Snapshot();
			if (B.State == ActionState::Attack && B.Stage == AttackStage::Windup)
			{
				if (Habit == 0)
				{
					Intent.bBlock = true;
				}
				else if (Habit == 1)
				{
					Intent.Dodge = DodgeDir::Left;
					Intent.LeanLateral = -1.0f;
				}
				else
				{
					Intent.bDuck = true;
				}
			}
			return Intent;
		};
	}
}

IE_TEST(BoxingDepth_TheBotThrowsHooksAndUppercuts)
{
	// the player stands at the working distance for 3 s, then walks in for 3 s, and so on
	const BotTally T = RunBot(BotLevel::Normal, 1.35f, 90.0, [](const CombatSim&, int32_t Tick) {
		FighterIntent Intent;
		Intent.MoveForward = (Tick / SecondsToTicks(3.0)) % 2 == 1 ? 1.0f : 0.0f;
		return Intent;
	});
	std::printf("  info: Normal bot in 90 s: %d straights, %d hooks, %d uppercuts to the head\n", T.Straights, T.Hooks, T.Uppercuts);
	IE_EXPECT(T.Hooks > 0);
	IE_EXPECT(T.Uppercuts > 0);
	IE_EXPECT(T.Straights > T.Hooks); // the straight stays the bread and butter
}

IE_TEST(BoxingDepth_TheBotReadsHowThePlayerDefends)
{
	const BotTally Blocker = RunBot(BotLevel::Hard, 1.35f, 90.0, Defender(0));
	const BotTally Slipper = RunBot(BotLevel::Hard, 1.35f, 90.0, Defender(1));
	const BotTally Ducker = RunBot(BotLevel::Hard, 1.35f, 90.0, Defender(2));
	auto Share = [](int Part, int All) { return All > 0 ? static_cast<float>(Part) / static_cast<float>(All) : 0.0f; };
	std::printf("  info: Hard bot head shots vs a blocker: %d/%d/%d, a slipper: %d/%d/%d, a ducker: %d/%d/%d (straight/hook/uppercut)\n",
		Blocker.Straights, Blocker.Hooks, Blocker.Uppercuts, Slipper.Straights, Slipper.Hooks, Slipper.Uppercuts, Ducker.Straights, Ducker.Hooks, Ducker.Uppercuts);
	// a guard and a duck are answered with uppercuts, a slip with hooks
	IE_EXPECT(Share(Blocker.Uppercuts, Blocker.HeadAttacks()) > Share(Slipper.Uppercuts, Slipper.HeadAttacks()) + 0.15f);
	IE_EXPECT(Share(Ducker.Uppercuts, Ducker.HeadAttacks()) > Share(Slipper.Uppercuts, Slipper.HeadAttacks()) + 0.15f);
	IE_EXPECT(Share(Slipper.Hooks, Slipper.HeadAttacks()) > Share(Blocker.Hooks, Blocker.HeadAttacks()) + 0.15f);
	// Easy hardly reads at all
	const BotTally EasyBlocker = RunBot(BotLevel::Easy, 1.35f, 90.0, Defender(0));
	IE_EXPECT(Share(EasyBlocker.Uppercuts, EasyBlocker.HeadAttacks()) < Share(Blocker.Uppercuts, Blocker.HeadAttacks()));
}

IE_TEST(BoxingDepth_TheBotDucksHooksAndSlipsUppercuts)
{
	auto Thrower = [](AttackKind Kind) {
		return [Kind](const CombatSim& Sim, int32_t Tick) {
			FighterIntent Intent;
			Intent.MoveForward = Sim.Gap() > 1.15f ? 1.0f : 0.0f; // keeps the bot inside the punch's reach
			if (Tick % SecondsToTicks(1.2) == 0)
			{
				Intent.AddPunch(Hand::Right, 1.0f, PunchZone::Head, Kind);
			}
			return Intent;
		};
	};
	const BotTally Hooks = RunBot(BotLevel::Hard, 1.15f, 40.0, Thrower(AttackKind::Hook));
	const BotTally Uppers = RunBot(BotLevel::Hard, 1.15f, 40.0, Thrower(AttackKind::Uppercut));
	std::printf("  info: Hard bot evading 33 rear hooks: %d ducked, %d slipped; 33 rear uppercuts: %d ducked, %d slipped\n",
		Hooks.Ducked, Hooks.Slipped, Uppers.Ducked, Uppers.Slipped);
	IE_EXPECT(Hooks.Ducked > 0);
	IE_EXPECT(Uppers.Slipped > 0);
	IE_EXPECT_EQ(Uppers.Ducked, 0); // never ducks into an uppercut
}
