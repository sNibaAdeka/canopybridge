#include "IronEchoRules/CombatConfig.h"

namespace IronEchoCore
{
	FighterConfig MakeDefaultFighterConfig()
	{
		FighterConfig Config;

		AttackSpec& Jab = Config.Attacks[HandIndex(Hand::Left)];
		Jab.WindupTicks = SecondsToTicks(0.09);
		Jab.ActiveTicks = SecondsToTicks(0.07);
		Jab.RecoveryTicks = SecondsToTicks(0.20);
		Jab.Damage = 5.0f;
		Jab.StaminaCost = 6.0f;
		Jab.ReachMeters = 1.50f;
		Jab.KnockbackMeters = 0.06f;
		Jab.HitStunTicks = SecondsToTicks(0.22);

		AttackSpec& Cross = Config.Attacks[HandIndex(Hand::Right)];
		Cross.WindupTicks = SecondsToTicks(0.14);
		Cross.ActiveTicks = SecondsToTicks(0.07);
		Cross.RecoveryTicks = SecondsToTicks(0.28);
		Cross.Damage = 9.0f;
		Cross.StaminaCost = 10.0f;
		Cross.ReachMeters = 1.45f;
		Cross.KnockbackMeters = 0.15f;
		Cross.HitStunTicks = SecondsToTicks(0.32);

		return Config;
	}

	FighterConfig MakeBotFighterConfig(BotLevel Level)
	{
		FighterConfig Config = MakeDefaultFighterConfig();
		double JabWindup = 0.40;
		double CrossWindup = 0.55;
		switch (Level)
		{
		case BotLevel::Easy:
			JabWindup = 0.50;
			CrossWindup = 0.65;
			break;
		case BotLevel::Normal:
			break;
		case BotLevel::Hard:
			JabWindup = 0.32;
			CrossWindup = 0.45;
			break;
		}
		Config.Attacks[HandIndex(Hand::Left)].WindupTicks = SecondsToTicks(JabWindup);
		Config.Attacks[HandIndex(Hand::Right)].WindupTicks = SecondsToTicks(CrossWindup);
		return Config;
	}

	FighterConfig MakeTrainingBagConfig()
	{
		FighterConfig Config = MakeDefaultFighterConfig();
		Config.bInvulnerable = true;
		Config.bPassive = true;
		Config.bKnockdowns = false;
		Config.MaxHealth = 1000.0f;
		return Config;
	}

	BotConfig MakeBotConfig(BotLevel Level)
	{
		BotConfig Config;
		switch (Level)
		{
		case BotLevel::Easy:
			Config.ReactionTicks = SecondsToTicks(0.20);
			Config.GuardAfterHitChance = 0.20f;
			Config.GetUpChance[0] = 0.60f;
			Config.GetUpChance[1] = 0.35f;
			Config.GetUpChance[2] = 0.10f;
			Config.BlockChance = 0.25f;
			Config.DodgeChance = 0.10f;
			Config.AttackIntervalMinTicks = SecondsToTicks(1.2);
			Config.AttackIntervalMaxTicks = SecondsToTicks(2.4);
			Config.ComboChance = 0.15f;
			Config.CrossChance = 0.35f;
			Config.GuardUpChance = 0.15f;
			break;
		case BotLevel::Normal:
			break;
		case BotLevel::Hard:
			Config.ReactionTicks = SecondsToTicks(0.07);
			Config.GuardAfterHitChance = 0.65f;
			Config.GetUpChance[0] = 0.95f;
			Config.GetUpChance[1] = 0.70f;
			Config.GetUpChance[2] = 0.40f;
			Config.BlockChance = 0.50f;
			Config.DodgeChance = 0.30f;
			Config.AttackIntervalMinTicks = SecondsToTicks(0.55);
			Config.AttackIntervalMaxTicks = SecondsToTicks(1.2);
			Config.ComboChance = 0.45f;
			Config.CrossChance = 0.45f;
			Config.GuardUpChance = 0.35f;
			break;
		}
		return Config;
	}

	const char* BotLevelName(BotLevel Level)
	{
		switch (Level)
		{
		case BotLevel::Easy: return "Easy";
		case BotLevel::Normal: return "Normal";
		case BotLevel::Hard: return "Hard";
		}
		return "Unknown";
	}
}
