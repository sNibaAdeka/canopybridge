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

		// Close range (1.6). Reach 1.18-1.22 m: they land from the clinch (1.00 m) up to a short step in from the working
		// distance (1.35 m), where the straights are already smothered. Heavier than a cross, faster than a kick.
		for (int32_t Index = 0; Index < 2; ++Index)
		{
			const bool bRear = Index == 1;
			AttackSpec& Elbow = Config.Elbows[Index];
			Elbow.WindupTicks = SecondsToTicks(bRear ? 0.14 : 0.12);
			Elbow.ActiveTicks = SecondsToTicks(0.06);
			Elbow.RecoveryTicks = SecondsToTicks(bRear ? 0.30 : 0.26);
			Elbow.Damage = bRear ? 3.6f : 3.0f;
			Elbow.StaminaCost = bRear ? 11.0f : 9.0f;
			Elbow.ReachMeters = 1.22f;
			Elbow.KnockbackMeters = 0.10f;
			Elbow.HitStunTicks = SecondsToTicks(0.36);

			AttackSpec& Knee = Config.Knees[Index];
			Knee.WindupTicks = SecondsToTicks(bRear ? 0.18 : 0.15);
			Knee.ActiveTicks = SecondsToTicks(0.08);
			Knee.RecoveryTicks = SecondsToTicks(bRear ? 0.40 : 0.34);
			Knee.Damage = bRear ? 3.8f : 3.2f;
			Knee.StaminaCost = bRear ? 14.0f : 12.0f;
			Knee.ReachMeters = 1.18f;
			Knee.KnockbackMeters = 0.16f;
			Knee.HitStunTicks = SecondsToTicks(0.34);
		}

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
		// Close range: telegraphed too, a little less than the straights (the bot is already in the human's face).
		for (int32_t Index = 0; Index < 2; ++Index)
		{
			Config.Elbows[Index].WindupTicks = SecondsToTicks((Index == 0 ? JabWindup : CrossWindup) - 0.04);
			Config.Knees[Index].WindupTicks = SecondsToTicks((Index == 0 ? JabWindup : CrossWindup) + 0.06);
			Config.Elbows[Index].StaminaCost *= 0.75f;
			Config.Knees[Index].StaminaCost *= 0.75f;
		}
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
			Config.ClinchStrikeChance = 0.20f;
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
			Config.ClinchStrikeChance = 0.50f;
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
