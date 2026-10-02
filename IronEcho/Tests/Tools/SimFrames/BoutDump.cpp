// Runs a full bout on the real IronEchoRules core with a human-like scripted player, dumps JSONL per tick.
#include "IronEchoRules/Match.h"
#include "IronEchoRules/Random.h"
#include <cstdio>
#include <cstdlib>
using namespace IronEchoCore;

static void DumpFighter(FILE* f, const FighterSnapshot& s) {
	std::fprintf(f, "{\"hp\":%.2f,\"maxhp\":%.1f,\"st\":%.2f,\"maxst\":%.1f,\"state\":%d,\"stage\":%d,\"hand\":%d,\"alpha\":%.3f,"
		"\"block\":%d,\"dodge\":%d,\"lean\":%.2f,\"pos\":%.3f,\"thrown\":%d,\"landed\":%d,\"blocks\":%d,\"dodges\":%d,\"counters\":%d,"
		"\"combo\":%d,\"maxcombo\":%d,\"kd\":%d}",
		s.Health, s.MaxHealth, s.Stamina, s.MaxStamina, int(s.State), int(s.Stage), int(s.AttackHand), s.StageAlpha(),
		int(s.bBlocking), int(s.Dodge), s.LeanLateral, s.Position, s.PunchesThrown, s.PunchesLanded, s.BlocksMade, s.DodgesMade,
		s.CounterHits, s.ComboCount, s.MaxCombo, s.KnockdownsSuffered);
}

int main(int argc, char** argv) {
	const uint64_t seed = argc > 1 ? std::strtoull(argv[1], nullptr, 10) : 7;
	MatchSetup setup; setup.Seed = seed;
	if (argc > 2) { const BotLevel L = BotLevel(std::atoi(argv[2])); setup.OpponentFighter = MakeBotFighterConfig(L); setup.Bot = MakeBotConfig(L); }
	Match m(setup);
	Pcg32 rng(seed * 31 + 5);
	CombatEventBuffer ce; MatchEventBuffer me;
	int sawWindupAt = -1000; int reactAt = -1; int defense = 0; int holdUntil = -1; int nextPunch = 60;
	FILE* f = stdout;
	for (int t = 0; t < 120 * 600; ++t) {
		const auto& snap = m.Snapshot();
		const auto& me_ = m.Sim().Get(FighterSlot::Player).Snapshot();
		const auto& bot = m.Sim().Get(FighterSlot::Opponent).Snapshot();
		MatchInput in; in.bInputReady = true;
		FighterIntent& it = in.PlayerIntent;
		if (snap.Phase == MatchPhase::Knockdown && me_.State == ActionState::KnockedDown) { it.bBlock = true; }
		else {
			// Human: notices the bot's windup after ~0.25-0.35 s and defends; otherwise throws jabs/crosses/1-2s.
			if (bot.State == ActionState::Attack && bot.Stage == AttackStage::Windup && sawWindupAt < 0) {
				sawWindupAt = t; reactAt = t + 42 + int((rng.NextU32() % 20u));
				const uint32_t r = (rng.NextU32() % 100u); defense = r < 50 ? 1 : (r < 70 ? 2 : 0);
			}
			if (bot.State != ActionState::Attack) sawWindupAt = -1;
			if (reactAt >= 0 && t >= reactAt) { if (defense) holdUntil = t + 45; reactAt = -1; }
			if (t < holdUntil) {
				if (defense == 1) it.bBlock = true; else { it.Dodge = (t / 400) % 2 ? DodgeDir::Left : DodgeDir::Right; it.LeanLateral = float(int(it.Dodge)) * 0.9f; }
			} else if (t >= nextPunch && snap.Phase == MatchPhase::Fighting) {
				const uint32_t r = (rng.NextU32() % 100u);
				it.AddPunch(r < 60 ? Hand::Left : Hand::Right);
				nextPunch = t + (r < 25 ? 22 : 55 + int((rng.NextU32() % 60u)));
			}
		}
		m.Tick(in, ce, me);
		const auto& s = m.Snapshot();
		std::fprintf(f, "{\"t\":%d,\"phase\":%d,\"round\":%d,\"rounds\":%d,\"left\":%d,\"cd\":%d,\"brk\":%d,\"res\":%d,\"win\":%d,\"haswin\":%d,"
			"\"dec\":%d,\"kc\":%d,\"gup\":%d,\"j\":[[%d,%d],[%d,%d],[%d,%d]],\"p\":",
			t, int(s.Phase), s.Round, s.Rounds, s.RoundTicksLeft, s.CountdownTicksLeft, s.BreakTicksLeft, int(s.Result), int(s.Winner), int(s.bHasWinner),
			int(s.Decision), s.KnockdownCount, s.GetUpProgress, s.JudgeScores[0][0], s.JudgeScores[0][1], s.JudgeScores[1][0], s.JudgeScores[1][1], s.JudgeScores[2][0], s.JudgeScores[2][1]);
		DumpFighter(f, m.Sim().Get(FighterSlot::Player).Snapshot()); std::fputs(",\"o\":", f);
		DumpFighter(f, m.Sim().Get(FighterSlot::Opponent).Snapshot()); std::fputs(",\"ev\":[", f);
		for (int i = 0; i < ce.Num(); ++i) std::fprintf(f, "%s[\"%s\",%d,%d,%d]", i ? "," : "", CombatEventName(ce[i].Type), int(ce[i].Actor), ce[i].ComboCount, int(ce[i].bCounterHit));
		std::fputs("]}\n", f);
		ce.Clear(); me.Clear();
		if (s.Phase == MatchPhase::MatchOver) { for (int k = 0; k < 240; ++k) {} break; }
	}
	return 0;
}
