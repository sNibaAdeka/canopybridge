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
		Jab.Damage = 1.6f;
		Jab.StaminaCost = 6.0f;
		Jab.ReachMeters = 1.50f;
		Jab.KnockbackMeters = 0.06f;
		Jab.HitStunTicks = SecondsToTicks(0.22);

		AttackSpec& Cross = Config.Attacks[HandIndex(Hand::Right)];
		Cross.WindupTicks = SecondsToTicks(0.14);
		Cross.ActiveTicks = SecondsToTicks(0.07);
		Cross.RecoveryTicks = SecondsToTicks(0.28);
		Cross.Damage = 2.8f;
		Cross.StaminaCost = 10.0f;
		Cross.ReachMeters = 1.45f;
		Cross.KnockbackMeters = 0.15f;
		Cross.HitStunTicks = SecondsToTicks(0.32);

		// Lead leg: a quick front kick (teep) that keeps the opponent off; rear leg: the round kick, the big one.
		AttackSpec& Teep = Config.Kicks[HandIndex(Hand::Left)];
		Teep.WindupTicks = SecondsToTicks(0.17);
		Teep.ActiveTicks = SecondsToTicks(0.08);
		Teep.RecoveryTicks = SecondsToTicks(0.42);
		Teep.Damage = 2.2f;
		Teep.StaminaCost = 12.0f;
		Teep.ReachMeters = 1.72f;
		Teep.KnockbackMeters = 0.22f;
		Teep.HitStunTicks = SecondsToTicks(0.26);

		AttackSpec& Round = Config.Kicks[HandIndex(Hand::Right)];
		Round.WindupTicks = SecondsToTicks(0.24);
		Round.ActiveTicks = SecondsToTicks(0.09);
		Round.RecoveryTicks = SecondsToTicks(0.55);
		Round.Damage = 4.0f;
		Round.StaminaCost = 16.0f;
		Round.ReachMeters = 1.68f;
		Round.KnockbackMeters = 0.28f;
		Round.HitStunTicks = SecondsToTicks(0.38);

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
			JabWindup = 0.34;
			CrossWindup = 0.48;
			break;
		}
		Config.Attacks[HandIndex(Hand::Left)].WindupTicks = SecondsToTicks(JabWindup);
		Config.Attacks[HandIndex(Hand::Right)].WindupTicks = SecondsToTicks(CrossWindup);
		// Kicks are telegraphed even longer: the leg has to come up first, so the tell is easy to read.
		Config.Kicks[HandIndex(Hand::Left)].WindupTicks = SecondsToTicks(JabWindup + 0.20);
		Config.Kicks[HandIndex(Hand::Right)].WindupTicks = SecondsToTicks(CrossWindup + 0.22);
		Config.Kicks[0].StaminaCost *= 0.75f;
		Config.Kicks[1].StaminaCost *= 0.75f;
		// The telegraphed windup is there for the human, not a choice of the bot: it would keep the bot out of
		// regeneration (no regen while attacking) and starve it. Cheaper punches and faster regen compensate.
		Config.Attacks[HandIndex(Hand::Left)].StaminaCost *= 0.75f;
		Config.Attacks[HandIndex(Hand::Right)].StaminaCost *= 0.75f;
		Config.StaminaRegenPerSecond = 18.0f;
		// Precision: the long windup is telegraph, not a slow arm; the bot reads a punch and snaps the head away
		// like a machine (otherwise the player's 0.09 s jab could never be slipped), and its own punches follow a
		// human slip slowly (a slip made in time beats them, one held from long before does not).
		Config.HeadSlipSpeed = 8.0f;
		Config.AimTrackSpeed = 0.20f;
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
			Config.ReactionTicks = SecondsToTicks(0.09); // cannot defend a jab, only crosses
			Config.CounterChance = 0.15f;
			Config.FlurryBlockBonus = 0.06f;
			Config.GuardAfterHitChance = 0.20f;
			Config.GetUpChance[0] = 0.75f;
			Config.GetUpChance[1] = 0.45f;
			Config.GetUpChance[2] = 0.20f;
			Config.BlockChance = 0.30f;
			Config.DodgeChance = 0.10f;
			Config.AttackIntervalMinTicks = SecondsToTicks(1.5);
			Config.AttackIntervalMaxTicks = SecondsToTicks(2.8);
			Config.AvoidTradeChance = 0.0f;
			Config.ComboChance = 0.15f;
			Config.CrossChance = 0.35f;
			Config.GuardUpChance = 0.30f;
			Config.CircleChance = 0.25f;
			Config.StepBackChance = 0.05f;
			Config.bCutOffRing = false;
			Config.BodyShotChance = 0.10f;
			Config.BodyVsGuardBonus = 0.10f;
			Config.KickChance = 0.06f;
			Config.LegKickShare = 0.20f;
			break;
		case BotLevel::Normal:
			break;
		case BotLevel::Hard:
			Config.ReactionTicks = SecondsToTicks(0.04);
			Config.CounterChance = 0.55f;
			Config.GuardAfterHitChance = 0.65f;
			Config.GetUpChance[0] = 0.97f;
			Config.GetUpChance[1] = 0.80f;
			Config.GetUpChance[2] = 0.50f;
			Config.BlockChance = 0.50f;
			Config.DodgeChance = 0.22f;
			Config.AttackIntervalMinTicks = SecondsToTicks(0.60);
			Config.AttackIntervalMaxTicks = SecondsToTicks(1.25);
			Config.AvoidTradeChance = 0.80f;
			Config.ComboChance = 0.45f;
			Config.CrossChance = 0.45f;
			Config.GuardUpChance = 0.35f;
			Config.CircleChance = 0.50f;
			Config.StepBackChance = 0.12f;
			Config.BodyShotChance = 0.20f;
			Config.BodyVsGuardBonus = 0.40f;
			Config.KickChance = 0.22f;
			Config.LegKickShare = 0.45f;
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
