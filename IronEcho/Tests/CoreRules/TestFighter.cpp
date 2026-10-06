#include "TestFramework.h"

#include "IronEchoRules/CombatSim.h"

#include <algorithm>
#include <cmath>
#include <vector>

using namespace IronEchoCore;

namespace
{
	FighterIntent Idle() { return FighterIntent{}; }

	FighterIntent PunchIntentFor(Hand InHand)
	{
		FighterIntent Intent;
		Intent.AddPunch(InHand);
		return Intent;
	}

	FighterIntent BlockIntent()
	{
		FighterIntent Intent;
		Intent.bBlock = true;
		return Intent;
	}

	FighterIntent DodgeIntent(DodgeDir Dir)
	{
		FighterIntent Intent;
		Intent.Dodge = Dir;
		Intent.LeanLateral = Dir == DodgeDir::Left ? -1.0f : 1.0f;
		return Intent;
	}

	struct Harness
	{
		CombatSim Sim;
		CombatEventBuffer Events;
		std::vector<CombatEvent> Log;
		int32_t Tick = 0;

		explicit Harness(const FighterConfig& PlayerCfg = MakeDefaultFighterConfig(), const FighterConfig& OppCfg = MakeDefaultFighterConfig())
			: Sim(PlayerCfg, OppCfg, MovementConfig())
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

		int Count(CombatEventType Type, FighterSlot Actor) const
		{
			int Total = 0;
			for (const CombatEvent& Event : Log)
			{
				if (Event.Type == Type && Event.Actor == Actor)
				{
					++Total;
				}
			}
			return Total;
		}

		int32_t FirstTick(CombatEventType Type, FighterSlot Actor) const
		{
			for (const CombatEvent& Event : Log)
			{
				if (Event.Type == Type && Event.Actor == Actor)
				{
					return Event.Tick;
				}
			}
			return -1;
		}

		const FighterSnapshot& P() const { return Sim.Get(FighterSlot::Player).Snapshot(); }
		const FighterSnapshot& O() const { return Sim.Get(FighterSlot::Opponent).Snapshot(); }
	};
}

IE_TEST(Fighter_JabTimelineIsExact)
{
	Harness H;
	const AttackSpec Jab = MakeDefaultFighterConfig().Attacks[0];
	H.Step(PunchIntentFor(Hand::Left), Idle()); // tick 1
	IE_EXPECT(H.P().State == ActionState::Attack);
	IE_EXPECT(H.P().Stage == AttackStage::Windup);
	H.Run(Jab.WindupTicks + Jab.ActiveTicks + Jab.RecoveryTicks + 2);
	IE_EXPECT_EQ(H.FirstTick(CombatEventType::AttackStarted, FighterSlot::Player), 1);
	IE_EXPECT_EQ(H.FirstTick(CombatEventType::AttackActive, FighterSlot::Player), 1 + Jab.WindupTicks);
	IE_EXPECT_EQ(H.FirstTick(CombatEventType::HitConfirmed, FighterSlot::Player), 1 + Jab.WindupTicks);
	IE_EXPECT_EQ(H.FirstTick(CombatEventType::AttackRecovery, FighterSlot::Player), 1 + Jab.WindupTicks + Jab.ActiveTicks);
	IE_EXPECT_EQ(H.FirstTick(CombatEventType::AttackFinished, FighterSlot::Player), 1 + Jab.WindupTicks + Jab.ActiveTicks + Jab.RecoveryTicks);
	IE_EXPECT_NEAR(H.O().Health, 100.0 - Jab.Damage, 1e-4);
	IE_EXPECT(H.P().State == ActionState::Guard);
	IE_EXPECT_EQ(H.P().PunchesLanded, 1);
}

IE_TEST(Fighter_ComboCancelOtherHandOnly)
{
	Harness H;
	const AttackSpec Jab = MakeDefaultFighterConfig().Attacks[0];
	H.Step(PunchIntentFor(Hand::Left), Idle());
	H.Run(Jab.WindupTicks + Jab.ActiveTicks); // now in recovery
	IE_EXPECT(H.P().Stage == AttackStage::Recovery);
	H.Step(PunchIntentFor(Hand::Right), Idle()); // cross cancels jab recovery
	IE_EXPECT(H.P().AttackHand == Hand::Right);
	IE_EXPECT(H.P().Stage == AttackStage::Windup);
	IE_EXPECT_EQ(H.Count(CombatEventType::AttackCancelled, FighterSlot::Player), 1);

	Harness Same;
	Same.Step(PunchIntentFor(Hand::Left), Idle());
	Same.Run(Jab.WindupTicks + Jab.ActiveTicks);
	Same.Step(PunchIntentFor(Hand::Left), Idle()); // same hand: buffered, not cancelled
	IE_EXPECT(Same.P().Stage == AttackStage::Recovery);
	IE_EXPECT_EQ(Same.P().PunchesThrown, 1);
}

IE_TEST(Fighter_InputBufferStartsWhenFreeOrExpires)
{
	Harness H;
	const AttackSpec Jab = MakeDefaultFighterConfig().Attacks[0];
	H.Step(PunchIntentFor(Hand::Left), Idle());
	// Request the same hand 10 ticks before recovery ends: within the 18-tick buffer -> starts automatically.
	const int32_t UntilLate = Jab.WindupTicks + Jab.ActiveTicks + Jab.RecoveryTicks - 10;
	H.Run(UntilLate - 1);
	H.Step(PunchIntentFor(Hand::Left), Idle());
	H.Run(12);
	IE_EXPECT_EQ(H.P().PunchesThrown, 2);
	IE_EXPECT_EQ(H.Count(CombatEventType::InputDropped, FighterSlot::Player), 0);

	Harness Early;
	Early.Step(PunchIntentFor(Hand::Left), Idle());
	Early.Step(PunchIntentFor(Hand::Left), Idle()); // far too early: expires
	Early.Run(Jab.WindupTicks + Jab.ActiveTicks + Jab.RecoveryTicks + 5);
	IE_EXPECT_EQ(Early.P().PunchesThrown, 1);
	IE_EXPECT_EQ(Early.Count(CombatEventType::InputDropped, FighterSlot::Player), 1);
}

IE_TEST(Fighter_BlockReducesDamageCostsStaminaNeverKOs)
{
	FighterConfig Fragile = MakeDefaultFighterConfig();
	Fragile.MaxHealth = 1.2f;
	Harness H(MakeDefaultFighterConfig(), Fragile);
	H.Run(2, Idle(), BlockIntent());
	IE_EXPECT(H.O().bBlocking);
	H.Step(PunchIntentFor(Hand::Right), BlockIntent());
	H.Run(30, Idle(), BlockIntent());
	IE_EXPECT_EQ(H.Count(CombatEventType::Blocked, FighterSlot::Player), 1);
	IE_EXPECT(H.O().State != ActionState::KnockedOut);
	IE_EXPECT(H.O().Health >= 1.0f - 1e-5f);
	IE_EXPECT_EQ(H.P().PunchesBlocked, 1);

	Harness Normal;
	Normal.Run(2, Idle(), BlockIntent());
	Normal.Step(PunchIntentFor(Hand::Right), BlockIntent());
	Normal.Run(30, Idle(), BlockIntent());
	const FighterConfig Cfg = MakeDefaultFighterConfig();
	IE_EXPECT_NEAR(Normal.O().Health, 100.0 - Cfg.Attacks[1].Damage * Cfg.BlockChipFactor, 1e-4);
}

IE_TEST(Fighter_GuardBreaksWithoutStamina)
{
	FighterConfig Tired = MakeDefaultFighterConfig();
	Tired.MaxStamina = 2.0f; // below BlockStaminaCost
	Harness H(MakeDefaultFighterConfig(), Tired);
	H.Run(2, Idle(), BlockIntent());
	H.Step(PunchIntentFor(Hand::Left), BlockIntent());
	H.Run(20, Idle(), BlockIntent());
	IE_EXPECT_EQ(H.Count(CombatEventType::GuardBroken, FighterSlot::Player), 1);
	IE_EXPECT_EQ(H.Count(CombatEventType::HitConfirmed, FighterSlot::Player), 1);
}

IE_TEST(Fighter_DodgeEvadesAndPunishesWithPenalty)
{
	Harness H;
	const AttackSpec Jab = MakeDefaultFighterConfig().Attacks[0];
	H.Step(PunchIntentFor(Hand::Left), DodgeIntent(DodgeDir::Left));
	H.Run(Jab.WindupTicks + Jab.ActiveTicks + 2, Idle(), DodgeIntent(DodgeDir::Left));
	IE_EXPECT_EQ(H.Count(CombatEventType::Dodged, FighterSlot::Player), 1);
	IE_EXPECT_NEAR(H.O().Health, 100.0, 1e-5);
	IE_EXPECT_EQ(H.O().DodgesMade, 1);
	// Recovery of a dodged punch is longer by WhiffPenaltyTicks.
	IE_EXPECT_EQ(H.P().StageTicksTotal, Jab.RecoveryTicks + MakeDefaultFighterConfig().WhiffPenaltyTicks);
}

IE_TEST(Fighter_DodgeReturningToCentreGetsHit)
{
	Harness H;
	const AttackSpec Cross = MakeDefaultFighterConfig().Attacks[1];
	H.Step(PunchIntentFor(Hand::Right), DodgeIntent(DodgeDir::Right));
	H.Run(Cross.WindupTicks, Idle(), DodgeIntent(DodgeDir::Right)); // first active tick: still slipping
	H.Step(Idle(), Idle());                                         // back to centre inside the window
	H.Run(5);
	IE_EXPECT_EQ(H.Count(CombatEventType::HitConfirmed, FighterSlot::Player), 1);
}

IE_TEST(Fighter_HeldDodgeExpires)
{
	Harness H;
	const FighterConfig Cfg = MakeDefaultFighterConfig();
	H.Run(Cfg.DodgeMaxEffectiveTicks + 5, Idle(), DodgeIntent(DodgeDir::Left));
	IE_EXPECT(!H.O().bDodgeEffective);
	H.Step(PunchIntentFor(Hand::Left), DodgeIntent(DodgeDir::Left));
	H.Run(30, Idle(), DodgeIntent(DodgeDir::Left));
	IE_EXPECT_EQ(H.Count(CombatEventType::HitConfirmed, FighterSlot::Player), 1);
}

IE_TEST(Fighter_OutOfRangeWhiffs)
{
	FighterConfig ShortArms = MakeDefaultFighterConfig();
	ShortArms.Attacks[0].ReachMeters = 1.0f; // engage distance is 1.35
	Harness H(ShortArms, MakeDefaultFighterConfig());
	H.Step(PunchIntentFor(Hand::Left), Idle());
	H.Run(40);
	IE_EXPECT_EQ(H.Count(CombatEventType::Whiffed, FighterSlot::Player), 1);
	IE_EXPECT_NEAR(H.O().Health, 100.0, 1e-5);
}

IE_TEST(Fighter_TradeIsSymmetric)
{
	Harness H;
	H.Step(PunchIntentFor(Hand::Left), PunchIntentFor(Hand::Left));
	H.Run(30);
	IE_EXPECT_EQ(H.Count(CombatEventType::HitConfirmed, FighterSlot::Player), 1);
	IE_EXPECT_EQ(H.Count(CombatEventType::HitConfirmed, FighterSlot::Opponent), 1);
	IE_EXPECT_NEAR(H.P().Health, H.O().Health, 1e-5);
}

IE_TEST(Fighter_CounterHitBonusAndInterrupt)
{
	Harness H;
	const FighterConfig Cfg = MakeDefaultFighterConfig();
	// Player's jab lands while the opponent is winding up a slower cross.
	H.Step(PunchIntentFor(Hand::Left), Idle());
	H.Step(Idle(), PunchIntentFor(Hand::Right));
	H.Run(40);
	IE_EXPECT_EQ(H.Count(CombatEventType::AttackCancelled, FighterSlot::Opponent), 1);
	IE_EXPECT_NEAR(H.O().Health, 100.0 - Cfg.Attacks[0].Damage * Cfg.CounterHitMultiplier, 1e-4);
	IE_EXPECT_NEAR(H.P().Health, 100.0, 1e-5);
}

IE_TEST(Fighter_StaminaSpendRegenAndTiredPunch)
{
	FighterConfig Cfg = MakeDefaultFighterConfig();
	Cfg.MaxStamina = 8.0f;
	Harness H(Cfg, MakeDefaultFighterConfig());
	H.Step(PunchIntentFor(Hand::Left), Idle()); // costs 6 -> 2 left
	IE_EXPECT_NEAR(H.P().Stamina, 2.0, 1e-4);
	H.Run(Cfg.Attacks[0].WindupTicks + Cfg.Attacks[0].ActiveTicks + Cfg.Attacks[0].RecoveryTicks);
	H.Step(PunchIntentFor(Hand::Right), Idle()); // cross needs 10: tired
	IE_EXPECT(H.P().bAttackTired);
	IE_EXPECT_EQ(H.P().StageTicksTotal, static_cast<int32_t>(std::lround(Cfg.Attacks[1].WindupTicks * static_cast<double>(Cfg.TiredWindupMultiplier))));
	IE_EXPECT_EQ(H.Count(CombatEventType::StaminaExhausted, FighterSlot::Player), 1);
	H.Run(60);
	const float Hp = H.O().Health;
	IE_EXPECT_NEAR(100.0 - Hp - Cfg.Attacks[0].Damage, Cfg.Attacks[1].Damage * Cfg.TiredDamageMultiplier, 1e-3);
	H.Run(kTickRate * 2);
	IE_EXPECT(H.P().Stamina > 0.0f);
}

IE_TEST(Fighter_KnockOutWhenKnockdownsDisabled)
{
	FighterConfig Glass = MakeDefaultFighterConfig();
	Glass.MaxHealth = Glass.Attacks[0].Damage; // one jab empties it
	Glass.bKnockdowns = false;
	Harness H(MakeDefaultFighterConfig(), Glass);
	H.Step(PunchIntentFor(Hand::Left), Idle());
	H.Run(30);
	IE_EXPECT(H.O().State == ActionState::KnockedOut);
	IE_EXPECT_EQ(H.Count(CombatEventType::KnockedOut, FighterSlot::Opponent), 1);
	// A KO'd fighter ignores further intents.
	H.Step(Idle(), PunchIntentFor(Hand::Left));
	IE_EXPECT(H.O().State == ActionState::KnockedOut);
}

IE_TEST(Fighter_TrainingBagTakesHitsForever)
{
	Harness H(MakeDefaultFighterConfig(), MakeTrainingBagConfig());
	for (int Round = 0; Round < 40; ++Round)
	{
		H.Step(PunchIntentFor(Round % 2 == 0 ? Hand::Left : Hand::Right), Idle());
		H.Run(120); // a sustainable pace: the player never empties the stamina tank
	}
	IE_EXPECT(H.Count(CombatEventType::HitConfirmed, FighterSlot::Player) >= 39);
	IE_EXPECT(H.O().State != ActionState::KnockedOut);
	IE_EXPECT_NEAR(H.O().Health, H.O().MaxHealth, 1e-4);
}

IE_TEST(Fighter_KnockdownAndGetUpRecovery)
{
	FighterConfig Glass = MakeDefaultFighterConfig();
	Glass.MaxHealth = Glass.Attacks[0].Damage; // one jab empties it
	Harness H(MakeDefaultFighterConfig(), Glass);
	H.Step(PunchIntentFor(Hand::Left), Idle());
	H.Run(30);
	IE_EXPECT(H.O().State == ActionState::KnockedDown);
	IE_EXPECT_EQ(H.Count(CombatEventType::KnockedDown, FighterSlot::Opponent), 1);
	IE_EXPECT_EQ(H.O().KnockdownsSuffered, 1);
	IE_EXPECT_EQ(H.O().RoundKnockdownsSuffered, 1);
	// A downed fighter cannot be hit again.
	H.Step(PunchIntentFor(Hand::Right), Idle());
	H.Run(40);
	IE_EXPECT_EQ(H.Count(CombatEventType::HitConfirmed, FighterSlot::Player), 1);

	CombatEventBuffer Events;
	H.Sim.Mutable(FighterSlot::Opponent).GetUp(500, Events);
	IE_EXPECT(H.O().State == ActionState::Guard);
	IE_EXPECT_NEAR(H.O().Health, (std::max)(1.0f, Glass.MaxHealth * Glass.KnockdownRecoverHealth), 1e-4); // never below 1 HP
	IE_EXPECT_NEAR(H.O().Stamina, H.O().MaxStamina * 0.5, 1e-4);
	IE_EXPECT_EQ(Events.Num(), 1);
	IE_EXPECT(Events[0].Type == CombatEventType::GotUp);
}

IE_TEST(Fighter_ComboCountsConsecutiveCleanHits)
{
	Harness H;
	const AttackSpec Jab = MakeDefaultFighterConfig().Attacks[0];
	H.Step(PunchIntentFor(Hand::Left), Idle());
	H.Run(Jab.WindupTicks + Jab.ActiveTicks);
	H.Step(PunchIntentFor(Hand::Right), Idle()); // 1-2 combo cancel
	H.Run(60);
	std::vector<int32_t> Combos;
	for (const CombatEvent& Event : H.Log)
	{
		if (Event.Type == CombatEventType::HitConfirmed && Event.Actor == FighterSlot::Player)
		{
			Combos.push_back(Event.ComboCount);
		}
	}
	IE_EXPECT_EQ(Combos.size(), 2u);
	IE_EXPECT(Combos.size() == 2 && Combos[0] == 1 && Combos[1] == 2);
	IE_EXPECT_EQ(H.P().MaxCombo, 2);
	H.Run(kTickRate * 2); // outside the combo window
	H.Sim.ResetPositions(); // the knock-backs pushed it out of reach
	H.Step(PunchIntentFor(Hand::Left), Idle());
	H.Run(30);
	int32_t LastCombo = 0;
	for (const CombatEvent& Event : H.Log)
	{
		if (Event.Type == CombatEventType::HitConfirmed && Event.Actor == FighterSlot::Player)
		{
			LastCombo = Event.ComboCount;
		}
	}
	IE_EXPECT_EQ(LastCombo, 1);
}

IE_TEST(Fighter_DefenseStatsCountBlocksAndDodges)
{
	Harness H;
	H.Run(2, Idle(), BlockIntent());
	H.Step(PunchIntentFor(Hand::Left), BlockIntent());
	H.Run(60, Idle(), BlockIntent());
	H.Run(10);
	H.Step(PunchIntentFor(Hand::Right), DodgeIntent(DodgeDir::Left));
	H.Run(40, Idle(), DodgeIntent(DodgeDir::Left));
	IE_EXPECT_EQ(H.O().BlocksMade, 1);
	IE_EXPECT_EQ(H.O().DodgesMade, 1);
	IE_EXPECT_EQ(H.O().RoundDefenses, 2);
}

// ---- 1.2 balance rules: cover-up, arm punches, guard drain, gassed ----

IE_TEST(Fighter_CoverUpFromHitStunKeepsPunchesLocked)
{
	Harness H;
	const FighterConfig Cfg = MakeDefaultFighterConfig();
	const AttackSpec Jab = Cfg.Attacks[0];
	H.Step(PunchIntentFor(Hand::Left), Idle()); // tick 1: the jab lands on tick 1 + windup
	H.Run(Jab.WindupTicks);
	IE_EXPECT(H.O().State == ActionState::HitStun);
	const int32_t HitTick = H.FirstTick(CombatEventType::HitConfirmed, FighterSlot::Player);
	IE_EXPECT_EQ(HitTick, H.Tick);
	// Flinch: the guard cannot come up before CoverUpTicks of the stun have passed.
	H.Run(Cfg.CoverUpTicks - 1, Idle(), BlockIntent());
	IE_EXPECT(H.O().State == ActionState::HitStun);
	H.Step(Idle(), BlockIntent());
	IE_EXPECT(H.O().State == ActionState::Block);
	IE_EXPECT(H.O().bBlocking);
	IE_EXPECT(HitTick + Jab.HitStunTicks > H.Tick); // earlier than the stun would have ended
	// Covering up never shortens the punch lock: a cross requested now starts when the stun would have ended.
	FighterIntent BlockAndPunch = BlockIntent();
	BlockAndPunch.AddPunch(Hand::Right);
	H.Step(Idle(), BlockAndPunch);
	H.Run(Jab.HitStunTicks, Idle(), Idle());
	IE_EXPECT_EQ(H.FirstTick(CombatEventType::AttackStarted, FighterSlot::Opponent), HitTick + Jab.HitStunTicks);
}

IE_TEST(Fighter_TiredPunchIsAWeakArmPunch)
{
	FighterConfig Tired = MakeDefaultFighterConfig();
	Tired.MaxStamina = 1.0f; // every punch is thrown without enough stamina
	const FighterConfig Bot = MakeBotFighterConfig(BotLevel::Normal);
	Harness H(Tired, Bot);
	// The bot starts a long telegraphed cross; the tired jab lands in its windup and does NOT interrupt it.
	H.Step(Idle(), PunchIntentFor(Hand::Right));
	H.Step(PunchIntentFor(Hand::Left), Idle());
	IE_EXPECT(H.P().bAttackTired);
	H.Run(static_cast<int32_t>(std::lround(Tired.Attacks[0].WindupTicks * static_cast<double>(Tired.TiredWindupMultiplier))));
	IE_EXPECT_EQ(H.Count(CombatEventType::HitConfirmed, FighterSlot::Player), 1);
	IE_EXPECT_EQ(H.Count(CombatEventType::AttackCancelled, FighterSlot::Opponent), 0);
	IE_EXPECT(H.O().State == ActionState::Attack && H.O().Stage == AttackStage::Windup);
	// Landing in a windup is still a counter hit (x CounterHitMultiplier), just a weak one.
	IE_EXPECT_NEAR(100.0 - H.O().Health, Tired.Attacks[0].Damage * Tired.TiredDamageMultiplier * Tired.CounterHitMultiplier, 1e-4);
	// ...and the bot's cross still lands.
	H.Run(Bot.Attacks[1].WindupTicks);
	IE_EXPECT_EQ(H.Count(CombatEventType::HitConfirmed, FighterSlot::Opponent), 1);

	// On a fighter that is not winding up, a tired punch stuns for only TiredHitStunMultiplier of the time.
	Harness S(Tired, MakeDefaultFighterConfig());
	S.Step(PunchIntentFor(Hand::Right), Idle());
	S.Run(static_cast<int32_t>(std::lround(Tired.Attacks[1].WindupTicks * static_cast<double>(Tired.TiredWindupMultiplier))));
	IE_EXPECT(S.O().State == ActionState::HitStun);
	IE_EXPECT_EQ(S.O().StateTicksLeft, static_cast<int32_t>(std::lround(Tired.Attacks[1].HitStunTicks * static_cast<double>(Tired.TiredHitStunMultiplier))));
}

IE_TEST(Fighter_GuardDrainScalesWithPowerAndKeepsRegen)
{
	const FighterConfig Cfg = MakeDefaultFighterConfig();
	// Full-power jab into a guard: the guard pays BlockStaminaCost.
	Harness H;
	H.Step(PunchIntentFor(Hand::Left), BlockIntent());
	H.Run(Cfg.Attacks[0].WindupTicks, Idle(), BlockIntent());
	IE_EXPECT_EQ(H.Count(CombatEventType::Blocked, FighterSlot::Player), 1);
	IE_EXPECT_NEAR(H.O().Stamina, Cfg.MaxStamina - Cfg.BlockStaminaCost, 1e-4);
	// Absorbing is not spending: regeneration (at the blocking rate) continues on the very next tick.
	const float After = H.O().Stamina;
	H.Step(Idle(), BlockIntent());
	IE_EXPECT(H.O().Stamina > After);

	// A tired punch drains the guard in proportion to its reduced damage.
	FighterConfig Tired = MakeDefaultFighterConfig();
	Tired.MaxStamina = 1.0f;
	Harness T(Tired, Cfg);
	T.Step(PunchIntentFor(Hand::Left), BlockIntent());
	T.Run(static_cast<int32_t>(std::lround(Cfg.Attacks[0].WindupTicks * static_cast<double>(Tired.TiredWindupMultiplier))), Idle(), BlockIntent());
	IE_EXPECT_EQ(T.Count(CombatEventType::Blocked, FighterSlot::Player), 1);
	IE_EXPECT_NEAR(Cfg.MaxStamina - T.O().Stamina, Cfg.BlockStaminaCost * Tired.TiredDamageMultiplier, 0.05);

	// An empty tank cannot pay for the punch: the guard breaks.
	FighterConfig Empty = MakeDefaultFighterConfig();
	Empty.MaxStamina = Cfg.BlockStaminaCost * 0.5f;
	Harness B(Cfg, Empty);
	B.Step(PunchIntentFor(Hand::Left), BlockIntent());
	B.Run(Cfg.Attacks[0].WindupTicks, Idle(), BlockIntent());
	IE_EXPECT_EQ(B.Count(CombatEventType::GuardBroken, FighterSlot::Player), 1);
	IE_EXPECT_EQ(B.Count(CombatEventType::HitConfirmed, FighterSlot::Player), 1);
}

IE_TEST(Fighter_EmptyingStaminaCostsABreath)
{
	FighterConfig Cfg = MakeDefaultFighterConfig();
	Cfg.MaxStamina = Cfg.Attacks[0].StaminaCost; // one jab empties the tank
	Harness H(Cfg, MakeTrainingBagConfig());
	H.Step(PunchIntentFor(Hand::Left), Idle());
	IE_EXPECT_EQ(H.Count(CombatEventType::StaminaExhausted, FighterSlot::Player), 1);
	IE_EXPECT_EQ(H.P().GassedTicksLeft, Cfg.GassedTicks);
	// Keep asking for punches every tick: nothing starts until the breath is over.
	for (int32_t Index = 0; Index < Cfg.GassedTicks + 5; ++Index)
	{
		H.Step(PunchIntentFor(Index % 2 == 0 ? Hand::Left : Hand::Right), Idle());
	}
	int32_t Second = -1;
	int Started = 0;
	for (const CombatEvent& Event : H.Log)
	{
		if (Event.Type == CombatEventType::AttackStarted && Event.Actor == FighterSlot::Player && ++Started == 2)
		{
			Second = Event.Tick;
		}
	}
	IE_EXPECT_EQ(Second, 1 + Cfg.GassedTicks);
	IE_EXPECT(H.P().bAttackTired); // it comes back as an arm punch
}
