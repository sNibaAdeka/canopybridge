#include "TestFramework.h"

#include "IronEchoRules/BotBrain.h"
#include "IronEchoRules/CombatSim.h"

#include <vector>

using namespace IronEchoCore;

namespace
{
	// CombatSim + BotBrain without the match flow: the bot thinks, then the tick resolves.
	struct BotHarness
	{
		CombatSim Sim;
		BotBrain Bot;
		CombatEventBuffer Events;
		std::vector<CombatEvent> Log;
		int32_t Tick = 0;

		BotHarness(const FighterConfig& PlayerCfg, const FighterConfig& BotCfg, const BotConfig& Brain, uint64_t Seed = 3)
			: Sim(PlayerCfg, BotCfg, MovementConfig())
			, Bot(Brain, Seed)
		{
		}

		void Step(const FighterIntent& Player)
		{
			++Tick;
			const FighterIntent BotIntent = Bot.Think(Sim, Tick);
			Events.Clear();
			Sim.Step(Player, BotIntent, Tick, Events);
			for (const CombatEvent& Event : Events)
			{
				Log.push_back(Event);
			}
		}

		void Run(int32_t Ticks, const FighterIntent& Player = FighterIntent{})
		{
			for (int32_t Index = 0; Index < Ticks; ++Index)
			{
				Step(Player);
			}
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

		std::vector<int32_t> Ticks(CombatEventType Type, FighterSlot Actor) const
		{
			std::vector<int32_t> Out;
			for (const CombatEvent& Event : Log)
			{
				if (Event.Type == Type && Event.Actor == Actor)
				{
					Out.push_back(Event.Tick);
				}
			}
			return Out;
		}
	};

	FighterIntent Jab()
	{
		FighterIntent Intent;
		Intent.AddPunch(Hand::Left);
		return Intent;
	}

	BotConfig QuietBot(BotLevel Level)
	{
		BotConfig Brain = MakeBotConfig(Level);
		Brain.AttackIntervalMinTicks = Brain.AttackIntervalMaxTicks = 1000000; // never attacks on its own
		Brain.GuardUpChance = 0.0f;
		Brain.GuardAfterHitChance = 0.0f;
		Brain.CounterChance = 0.0f;
		Brain.FlurryBlockBonus = 0.0f;
		Brain.HurtBlockBonus = 0.0f;
		return Brain;
	}

	// Jabs at a relaxed pace (fresh stamina every time); returns how many the bot blocked or slipped.
	int DefendedJabs(BotLevel Level, int Jabs)
	{
		BotHarness H(MakeDefaultFighterConfig(), MakeBotFighterConfig(Level), QuietBot(Level));
		for (int Index = 0; Index < Jabs; ++Index)
		{
			H.Step(Jab());
			H.Run(SecondsToTicks(1.2));
		}
		return H.Count(CombatEventType::Blocked, FighterSlot::Player) + H.Count(CombatEventType::Dodged, FighterSlot::Player);
	}
}

IE_TEST(Bot_ReadsTheJabAtNormalAndHardButNotEasy)
{
	// The player's jab windup is 0.09 s: only a reaction shorter than that can defend it.
	IE_EXPECT(MakeBotConfig(BotLevel::Easy).ReactionTicks >= MakeDefaultFighterConfig().Attacks[0].WindupTicks);
	IE_EXPECT(MakeBotConfig(BotLevel::Normal).ReactionTicks < MakeDefaultFighterConfig().Attacks[0].WindupTicks);
	const int Easy = DefendedJabs(BotLevel::Easy, 40);
	const int Normal = DefendedJabs(BotLevel::Normal, 40);
	const int Hard = DefendedJabs(BotLevel::Hard, 40);
	std::printf("  info: jabs defended of 40: easy=%d normal=%d hard=%d\n", Easy, Normal, Hard);
	IE_EXPECT_EQ(Easy, 0);
	IE_EXPECT(Normal >= 12); // ~60 % expected
	IE_EXPECT(Hard >= Normal);
}

IE_TEST(Bot_RetriesAPlannedAttackRightAfterAStun)
{
	BotConfig Brain = QuietBot(BotLevel::Normal);
	Brain.ReactionTicks = 1000000; // never defends: the jab will land
	Brain.AttackIntervalMinTicks = Brain.AttackIntervalMaxTicks = SecondsToTicks(0.5);
	const FighterConfig PlayerCfg = MakeDefaultFighterConfig();
	BotHarness H(PlayerCfg, MakeBotFighterConfig(BotLevel::Normal), Brain);
	// The bot's first attack is due at tick 61; the jab lands at tick 1 + windup and stuns it past that.
	H.Run(SecondsToTicks(0.5) - PlayerCfg.Attacks[0].WindupTicks - 2);
	H.Step(Jab());
	H.Run(SecondsToTicks(1.0));
	const std::vector<int32_t> HitTicks = H.Ticks(CombatEventType::HitConfirmed, FighterSlot::Player);
	const std::vector<int32_t> BotStarts = H.Ticks(CombatEventType::AttackStarted, FighterSlot::Opponent);
	IE_EXPECT_EQ(static_cast<int>(HitTicks.size()), 1);
	IE_EXPECT(!BotStarts.empty());
	if (!HitTicks.empty() && !BotStarts.empty())
	{
		const int32_t StunEnd = HitTicks[0] + PlayerCfg.Attacks[0].HitStunTicks;
		IE_EXPECT(BotStarts[0] >= StunEnd);
		IE_EXPECT(BotStarts[0] <= StunEnd + Brain.AttackRetryTicks + 1); // not a whole interval later
	}
}

IE_TEST(Bot_BlocksThenCounters)
{
	BotConfig Brain = QuietBot(BotLevel::Normal);
	Brain.BlockChance = 1.0f;
	Brain.DodgeChance = 0.0f;
	Brain.CounterChance = 1.0f;
	const FighterConfig BotCfg = MakeBotFighterConfig(BotLevel::Normal);
	BotHarness H(MakeDefaultFighterConfig(), BotCfg, Brain);
	H.Run(10);
	H.Step(Jab());
	H.Run(SecondsToTicks(1.0));
	const std::vector<int32_t> Blocks = H.Ticks(CombatEventType::Blocked, FighterSlot::Player);
	const std::vector<int32_t> BotStarts = H.Ticks(CombatEventType::AttackStarted, FighterSlot::Opponent);
	IE_EXPECT_EQ(static_cast<int>(Blocks.size()), 1);
	IE_EXPECT(!BotStarts.empty());
	if (!Blocks.empty() && !BotStarts.empty())
	{
		// Fires as soon as the block stun is over (plus the counter delay), not an interval later.
		IE_EXPECT(BotStarts[0] > Blocks[0]);
		IE_EXPECT(BotStarts[0] <= Blocks[0] + MakeDefaultFighterConfig().BlockStunTicks + Brain.CounterDelayTicks + Brain.AttackRetryTicks + 2);
	}
}

IE_TEST(Bot_ReadsAFlurryAndCoversUp)
{
	// Same seed and timing; the flurry read is the only difference.
	auto Blocked = [](float Bonus) {
		BotConfig Brain = QuietBot(BotLevel::Normal);
		Brain.FlurryBlockBonus = Bonus;
		Brain.DodgeChance = 0.0f;
		BotHarness H(MakeDefaultFighterConfig(), MakeBotFighterConfig(BotLevel::Normal), Brain);
		for (int Burst = 0; Burst < 12; ++Burst)
		{
			for (int Punch = 0; Punch < 5; ++Punch)
			{
				FighterIntent Intent;
				Intent.AddPunch(Punch % 2 == 0 ? Hand::Left : Hand::Right);
				H.Step(Intent);
				H.Run(SecondsToTicks(0.35));
			}
			H.Run(SecondsToTicks(2.5)); // breathe: stamina back for the next burst
		}
		return H.Count(CombatEventType::Blocked, FighterSlot::Player);
	};
	const int Plain = Blocked(0.0f);
	const int Read = Blocked(0.25f);
	std::printf("  info: flurry punches blocked of 60: plain=%d read=%d\n", Plain, Read);
	IE_EXPECT(Read > Plain);
}

IE_TEST(Bot_PressesAGassedPlayer)
{
	auto BotPunches = [](float PlayerMaxStamina) {
		FighterConfig PlayerCfg = MakeDefaultFighterConfig();
		PlayerCfg.MaxStamina = PlayerMaxStamina;
		BotConfig Brain = MakeBotConfig(BotLevel::Normal);
		Brain.RetreatChance = 0.0f;
		BotHarness H(PlayerCfg, MakeBotFighterConfig(BotLevel::Normal), Brain, 11);
		H.Run(SecondsToTicks(30.0));
		return H.Count(CombatEventType::AttackStarted, FighterSlot::Opponent);
	};
	const int Fresh = BotPunches(100.0f);
	const int Gassed = BotPunches(MakeBotConfig(BotLevel::Normal).PressureStaminaThreshold * 0.5f);
	std::printf("  info: bot punches in 30 s: fresh player=%d gassed player=%d\n", Fresh, Gassed);
	IE_EXPECT(Gassed > Fresh);
}
