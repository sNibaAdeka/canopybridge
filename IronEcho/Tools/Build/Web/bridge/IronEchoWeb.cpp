// Browser bridge: the real IronEchoRules core (Source/IronEchoRules) behind a flat C API for WebAssembly.
// Mirrors AIronEchoGameMode::StepSimulation: one InputFrame per render frame -> IntentMapper -> fixed 120 Hz
// Match ticks with an accumulator (frame time clamped to 0.25 s), punches go to the first sub-step only and are
// carried to the next frame when no tick happened. State and events are exposed as double arrays whose layout is
// self-described by ie_layout() (JSON), so JS never hard-codes indices.
#include "IronEchoRules/Match.h"

#include <cstddef>
#include <cstdint>
#include <new>
#include <type_traits>

#if defined(__wasm__)
#define IE_EXPORT(Name) extern "C" __attribute__((export_name(#Name)))
#else
#define IE_EXPORT(Name) extern "C" // native twin (Tools/Build/Web/bridge/bridge_check.cpp)
#endif

using namespace IronEchoCore;

namespace
{
	// ---- state layout (one place; JS reads the names from ie_layout) ----
	const char* const kMatchFields[] = {
		"mode", "level", "phase", "resumePhase", "pause", "round", "rounds", "roundTicksLeft", "countdownTicksLeft",
		"breakTicksLeft", "scorePlayer", "scoreOpponent", "result", "hasWinner", "winner", "trainingHits",
		"judge1Player", "judge1Opponent", "judge2Player", "judge2Opponent", "judge3Player", "judge3Opponent",
		"decision", "knockdownCount", "getUpProgress", "postGetUpTicksLeft", "tick", "simTick", "gap", "seed",
		"inputReady", "tickRate", "getUpOpponent"};
	const char* const kFighterFields[] = {
		"health", "maxHealth", "stamina", "maxStamina", "state", "stage", "hand", "attackId", "resolved", "tired",
		"stageAlpha", "stageTicksTotal", "stageTicksLeft", "stateTicksLeft", "gassedTicksLeft", "blocking", "dodge",
		"dodgeEffective", "lean", "x", "y", "faceX", "faceY", "speedForward", "speedSide", "moving", "onRopes", "headOffset", "zone",
		"aimX", "aimY", "kind", "legSlow", "roundDamage", "totalDamage", "thrown", "landed", "punchesBlocked", "dodgesMade", "blocksMade",
		"counterHits", "combo", "maxCombo", "knockdowns", "roundKnockdowns", "roundLanded", "roundDefenses", "bodyLanded",
		"glancingHits", "kicksThrown", "kicksLanded"};
	const char* const kCombatEventFields[] = {
		"type", "actor", "target", "hand", "dodge", "counter", "tired", "damage", "targetHealthAfter",
		"targetStaminaAfter", "attackId", "combo", "knockdownNumber", "tick", "zone", "glancing", "smothered", "power", "kind"};
	const char* const kMatchEventFields[] = {
		"type", "phase", "previousPhase", "reason", "method", "hasWinner", "winner", "round", "countdownSeconds",
		"scorePlayer", "scoreOpponent", "decision", "hasDowned", "downed", "tick"};

	template <typename T, size_t N>
	constexpr int32_t CountOf(T (&)[N]) { return static_cast<int32_t>(N); }

	constexpr int32_t kMatchCount = CountOf(kMatchFields);
	constexpr int32_t kFighterCount = CountOf(kFighterFields);
	constexpr int32_t kCombatEventSize = CountOf(kCombatEventFields);
	constexpr int32_t kMatchEventSize = CountOf(kMatchEventFields);
	constexpr int32_t kStateSize = kMatchCount + 2 * kFighterCount;
	constexpr int32_t kMaxCombatEvents = 512;
	constexpr int32_t kMaxMatchEvents = 128;

	double State[kStateSize];
	double CombatOut[kMaxCombatEvents * kCombatEventSize];
	double MatchOut[kMaxMatchEvents * kMatchEventSize];
	int32_t CombatOutCount = 0;
	int32_t MatchOutCount = 0;
	char Layout[8192];

	alignas(Match) unsigned char MatchStorage[sizeof(Match)];
	Match* Game = nullptr;
	IntentMapper Mapper;
	IntentMapper MapperOpponent; // Versus: the second human
	// Versus input: per slot [status, confidence, lean, leanForward, block, punchMask, kickMask, moveForward, moveSide, ctl]
	constexpr int32_t kVersusFields = 10;
	double VersusIn[2 * kVersusFields];
	CombatEventBuffer CombatEvents;
	MatchEventBuffer MatchEvents;
	FighterIntent CarriedPunches;

	// Rollback (online duel): whole-state snapshots of the match and both intent mappers. The rules hold no heap pointers, so
	// a byte copy is an exact copy (checked below); restoring one and replaying the same inputs reproduces the same state.
	constexpr int32_t kSaveSlots = 32;
	struct SavedState
	{
		alignas(Match) unsigned char MatchBytes[sizeof(Match)];
		IntentMapper MapperA;
		IntentMapper MapperB;
		bool bReady = false;
		bool bValid = false;
	};
	static_assert(std::is_trivially_copyable<Match>::value, "Match must be byte-copyable for rollback");
	static_assert(std::is_trivially_copyable<IntentMapper>::value, "IntentMapper must be byte-copyable for rollback");
	SavedState Saved[kSaveSlots];
	double Accumulator = 0.0;
	int32_t Level = 1;
	bool bLastReady = false;

	void AppendCombatEvents()
	{
		for (const CombatEvent& E : CombatEvents)
		{
			if (CombatOutCount >= kMaxCombatEvents)
			{
				break;
			}
			double* O = CombatOut + CombatOutCount * kCombatEventSize;
			O[0] = static_cast<double>(E.Type);
			O[1] = static_cast<double>(E.Actor);
			O[2] = static_cast<double>(E.Target);
			O[3] = static_cast<double>(E.AttackHand);
			O[4] = static_cast<double>(E.Dodge);
			O[5] = E.bCounterHit ? 1.0 : 0.0;
			O[6] = E.bTired ? 1.0 : 0.0;
			O[7] = E.Damage;
			O[8] = E.TargetHealthAfter;
			O[9] = E.TargetStaminaAfter;
			O[10] = static_cast<double>(E.AttackId);
			O[11] = E.ComboCount;
			O[12] = E.KnockdownNumber;
			O[13] = E.Tick;
			O[14] = static_cast<double>(E.Zone);
			O[15] = E.bGlancing ? 1.0 : 0.0;
			O[16] = E.bSmothered ? 1.0 : 0.0;
			O[17] = E.Power;
			O[18] = static_cast<double>(E.Kind);
			++CombatOutCount;
		}
		CombatEvents.Clear();
	}

	void AppendMatchEvents()
	{
		for (const MatchEvent& E : MatchEvents)
		{
			if (MatchOutCount >= kMaxMatchEvents)
			{
				break;
			}
			double* O = MatchOut + MatchOutCount * kMatchEventSize;
			O[0] = static_cast<double>(E.Type);
			O[1] = static_cast<double>(E.Phase);
			O[2] = static_cast<double>(E.PreviousPhase);
			O[3] = static_cast<double>(E.Reason);
			O[4] = static_cast<double>(E.Method);
			O[5] = E.bHasWinner ? 1.0 : 0.0;
			O[6] = static_cast<double>(E.Winner);
			O[7] = E.Round;
			O[8] = E.CountdownSeconds;
			O[9] = E.ScorePlayer;
			O[10] = E.ScoreOpponent;
			O[11] = static_cast<double>(E.Decision);
			O[12] = E.bHasDowned ? 1.0 : 0.0;
			O[13] = static_cast<double>(E.Downed);
			O[14] = E.Tick;
			++MatchOutCount;
		}
		MatchEvents.Clear();
	}

	void WriteFighter(double* O, const FighterSnapshot& F)
	{
		const double Values[] = {
			F.Health, F.MaxHealth, F.Stamina, F.MaxStamina, static_cast<double>(F.State), static_cast<double>(F.Stage),
			static_cast<double>(F.AttackHand), static_cast<double>(F.AttackId), F.bAttackResolved ? 1.0 : 0.0,
			F.bAttackTired ? 1.0 : 0.0, F.StageAlpha(), static_cast<double>(F.StageTicksTotal), static_cast<double>(F.StageTicksLeft),
			static_cast<double>(F.StateTicksLeft), static_cast<double>(F.GassedTicksLeft), F.bBlocking ? 1.0 : 0.0,
			static_cast<double>(F.Dodge), F.bDodgeEffective ? 1.0 : 0.0, F.LeanLateral, F.Location.X, F.Location.Y, F.Facing.X, F.Facing.Y,
			F.SpeedForward, F.SpeedSide, F.bMoving ? 1.0 : 0.0, F.bOnRopes ? 1.0 : 0.0, F.HeadOffset,
			static_cast<double>(F.AttackZone), F.AimPoint.X, F.AimPoint.Y, static_cast<double>(F.AttackType),
			static_cast<double>(F.LegSlowTicksLeft) / static_cast<double>(kTickRate), F.RoundDamageDealt,
			F.TotalDamageDealt, static_cast<double>(F.PunchesThrown), static_cast<double>(F.PunchesLanded),
			static_cast<double>(F.PunchesBlocked), static_cast<double>(F.DodgesMade), static_cast<double>(F.BlocksMade),
			static_cast<double>(F.CounterHits), static_cast<double>(F.ComboCount), static_cast<double>(F.MaxCombo),
			static_cast<double>(F.KnockdownsSuffered), static_cast<double>(F.RoundKnockdownsSuffered),
			static_cast<double>(F.RoundPunchesLanded), static_cast<double>(F.RoundDefenses),
			static_cast<double>(F.BodyPunchesLanded), static_cast<double>(F.GlancingHits),
			static_cast<double>(F.KicksThrown), static_cast<double>(F.KicksLanded)};
		static_assert(sizeof(Values) / sizeof(Values[0]) == kFighterCount, "fighter layout");
		for (int32_t Index = 0; Index < kFighterCount; ++Index)
		{
			O[Index] = Values[Index];
		}
	}

	void WriteState()
	{
		if (Game == nullptr)
		{
			return;
		}
		const MatchSnapshot& S = Game->Snapshot();
		const double Values[] = {
			static_cast<double>(S.Mode), static_cast<double>(Level), static_cast<double>(S.Phase), static_cast<double>(S.ResumePhase),
			static_cast<double>(S.Pause), static_cast<double>(S.Round), static_cast<double>(S.Rounds),
			static_cast<double>(S.RoundTicksLeft), static_cast<double>(S.CountdownTicksLeft), static_cast<double>(S.BreakTicksLeft),
			static_cast<double>(S.ScorePlayer), static_cast<double>(S.ScoreOpponent), static_cast<double>(S.Result),
			S.bHasWinner ? 1.0 : 0.0, static_cast<double>(S.Winner), static_cast<double>(S.TrainingHits),
			static_cast<double>(S.JudgeScores[0][0]), static_cast<double>(S.JudgeScores[0][1]),
			static_cast<double>(S.JudgeScores[1][0]), static_cast<double>(S.JudgeScores[1][1]),
			static_cast<double>(S.JudgeScores[2][0]), static_cast<double>(S.JudgeScores[2][1]),
			static_cast<double>(S.Decision), static_cast<double>(S.KnockdownCount), static_cast<double>(S.GetUpProgress),
			static_cast<double>(S.PostGetUpTicksLeft), static_cast<double>(S.Tick), static_cast<double>(S.SimTick),
			Game->Sim().Gap(), static_cast<double>(S.Seed), bLastReady ? 1.0 : 0.0, static_cast<double>(kTickRate),
			static_cast<double>(S.GetUpProgressOpponent)};
		static_assert(sizeof(Values) / sizeof(Values[0]) == kMatchCount, "match layout");
		for (int32_t Index = 0; Index < kMatchCount; ++Index)
		{
			State[Index] = Values[Index];
		}
		WriteFighter(State + kMatchCount, Game->Sim().Get(FighterSlot::Player).Snapshot());
		WriteFighter(State + kMatchCount + kFighterCount, Game->Sim().Get(FighterSlot::Opponent).Snapshot());
	}

	// Tiny JSON writer for the layout description.
	struct Writer
	{
		int32_t Len = 0;
		void Raw(const char* Text)
		{
			while (*Text != '\0' && Len < static_cast<int32_t>(sizeof(Layout)) - 1)
			{
				Layout[Len++] = *Text++;
			}
			Layout[Len] = '\0';
		}
		void Str(const char* Text)
		{
			Raw("\"");
			Raw(Text);
			Raw("\"");
		}
		void Int(int32_t Value)
		{
			char Buf[16];
			int32_t Pos = 15;
			Buf[Pos] = '\0';
			const bool bNegative = Value < 0;
			uint32_t Magnitude = bNegative ? 0u - static_cast<uint32_t>(Value) : static_cast<uint32_t>(Value);
			do
			{
				Buf[--Pos] = static_cast<char>('0' + Magnitude % 10u);
				Magnitude /= 10u;
			} while (Magnitude != 0u && Pos > 1);
			if (bNegative)
			{
				Buf[--Pos] = '-';
			}
			Raw(Buf + Pos);
		}
		template <size_t N>
		void List(const char* Key, const char* const (&Names)[N], bool bComma = true)
		{
			Str(Key);
			Raw(":[");
			for (size_t Index = 0; Index < N; ++Index)
			{
				if (Index > 0)
				{
					Raw(",");
				}
				Str(Names[Index]);
			}
			Raw(bComma ? "]," : "]");
		}
		template <typename Fn>
		void Enum(const char* Key, int32_t Count, Fn Name, bool bComma = true)
		{
			Str(Key);
			Raw(":[");
			for (int32_t Index = 0; Index < Count; ++Index)
			{
				if (Index > 0)
				{
					Raw(",");
				}
				Str(Name(Index));
			}
			Raw(bComma ? "]," : "]");
		}
	};

	void BuildLayout()
	{
		Writer W;
		W.Raw("{\"version\":2,");
		W.Str("tickRate");
		W.Raw(":");
		W.Int(kTickRate);
		W.Raw(",");
		W.List("match", kMatchFields);
		W.List("fighter", kFighterFields);
		W.List("combatEvent", kCombatEventFields);
		W.List("matchEvent", kMatchEventFields);
		W.Raw("\"enums\":{");
		W.Enum("phase", 8, [](int32_t I) { return MatchPhaseName(static_cast<MatchPhase>(I)); });
		W.Enum("state", 7, [](int32_t I) { return ActionStateName(static_cast<ActionState>(I)); });
		W.Enum("stage", 4, [](int32_t I) { return AttackStageName(static_cast<AttackStage>(I)); });
		W.Enum("combatEvent", 19, [](int32_t I) { return CombatEventName(static_cast<CombatEventType>(I)); });
		W.Enum("matchEvent", 8, [](int32_t I) { return MatchEventName(static_cast<MatchEventType>(I)); });
		W.Enum("level", 3, [](int32_t I) { return BotLevelName(static_cast<BotLevel>(I)); }, false);
		W.Raw("}}");
	}
}

IE_EXPORT(ie_layout) const char* ie_layout()
{
	if (Layout[0] == '\0')
	{
		BuildLayout();
	}
	return Layout;
}

IE_EXPORT(ie_state) const double* ie_state() { return State; }
IE_EXPORT(ie_state_size) int32_t ie_state_size() { return kStateSize; }
IE_EXPORT(ie_combat_events) const double* ie_combat_events() { return CombatOut; }
IE_EXPORT(ie_combat_event_count) int32_t ie_combat_event_count() { return CombatOutCount; }
IE_EXPORT(ie_combat_event_size) int32_t ie_combat_event_size() { return kCombatEventSize; }
IE_EXPORT(ie_match_events) const double* ie_match_events() { return MatchOut; }
IE_EXPORT(ie_match_event_count) int32_t ie_match_event_count() { return MatchOutCount; }
IE_EXPORT(ie_match_event_size) int32_t ie_match_event_size() { return kMatchEventSize; }

IE_EXPORT(ie_clear_events) void ie_clear_events()
{
	CombatOutCount = 0;
	MatchOutCount = 0;
}

// (Re)creates the match. Mode: 0 bout, 1 training. Level: 0 Easy, 1 Normal, 2 Hard.
// Rounds / RoundSeconds <= 0 keep the defaults (3 x 90 s).
IE_EXPORT(ie_init) void ie_init(int32_t Mode, int32_t InLevel, double Seed, int32_t Rounds, double RoundSeconds)
{
	if (Game != nullptr)
	{
		Game->~Match();
		Game = nullptr;
	}
	Level = Clamp(InLevel, 0, 2);
	MatchSetup Setup;
	Setup.Mode = Mode == 2 ? MatchMode::Versus : (Mode == 1 ? MatchMode::Training : MatchMode::Bout);
	Setup.Seed = static_cast<uint64_t>(Seed < 1.0 ? 1.0 : Seed);
	Setup.Bot = MakeBotConfig(static_cast<BotLevel>(Level));
	Setup.OpponentFighter = MakeBotFighterConfig(static_cast<BotLevel>(Level));
	if (Rounds > 0)
	{
		Setup.Rules.Rounds = Rounds;
	}
	if (RoundSeconds > 0.0)
	{
		Setup.Rules.RoundTicks = SecondsToTicks(RoundSeconds);
	}
	Game = new (MatchStorage) Match(Setup);
	for (SavedState& S : Saved)
	{
		S.bValid = false;
	}
	Mapper.Reset();
	MapperOpponent.Reset();
	CombatEvents.Clear();
	MatchEvents.Clear();
	CarriedPunches = FighterIntent{};
	Accumulator = 0.0;
	bLastReady = false;
	ie_clear_events();
	WriteState();
}

// One render frame of input. Status: TrackingStatus (7 = Live). Lean/Block as in InputFrame (calibrated units).
// PunchMask: bit 0 = left (jab), bit 1 = right (cross), bit 2 = left to the body, bit 3 = right to the body; each set
// bit is one new punch this frame. KickMask: bit 0 = lead-leg kick to the body, 1 = rear-leg kick to the body,
// 2 = lead-leg low kick, 3 = rear-leg low kick. MoveForward / MoveLateral: InputFrame footwork (-1..1; 0, 0 = the
// camera's lean steps). Returns the number of 120 Hz ticks simulated.
IE_EXPORT(ie_frame) int32_t ie_frame(double DeltaSeconds, int32_t Status, double Confidence, double LeanLateral, double LeanForward,
	double BlockAmount, int32_t PunchMask, double PunchConfidence, double MoveForward, double MoveLateral, int32_t KickMask)
{
	if (Game == nullptr)
	{
		return 0;
	}
	InputFrame Frame;
	Frame.Status = static_cast<TrackingStatus>(Clamp(Status, 0, 7));
	Frame.Confidence = static_cast<float>(Confidence);
	Frame.LeanLateral = static_cast<float>(LeanLateral);
	Frame.LeanForward = static_cast<float>(LeanForward);
	Frame.BlockAmount = static_cast<float>(BlockAmount);
	Frame.MoveForward = static_cast<float>(MoveForward);
	Frame.MoveLateral = static_cast<float>(MoveLateral);
	for (int32_t Bit = 0; Bit < 4; ++Bit)
	{
		if ((PunchMask & (1 << Bit)) != 0)
		{
			PunchIntent Punch;
			Punch.PunchHand = Bit % 2 == 0 ? Hand::Left : Hand::Right;
			Punch.Zone = Bit >= 2 ? PunchZone::Body : PunchZone::Head;
			Punch.Strength = 1.0f;
			Punch.Confidence = static_cast<float>(PunchConfidence);
			Frame.AddPunch(Punch);
		}
	}
	for (int32_t Bit = 0; Bit < 4; ++Bit)
	{
		if ((KickMask & (1 << Bit)) != 0)
		{
			PunchIntent Kick;
			Kick.PunchHand = Bit % 2 == 0 ? Hand::Left : Hand::Right;
			Kick.Kind = AttackKind::Kick;
			Kick.Zone = Bit >= 2 ? PunchZone::Leg : PunchZone::Body;
			Kick.Strength = 1.0f;
			Kick.Confidence = static_cast<float>(PunchConfidence);
			Frame.AddPunch(Kick);
		}
	}

	MatchInput Input;
	Input.bInputReady = Frame.Status == TrackingStatus::Live;
	Input.PlayerIntent = Mapper.Map(Frame);
	bLastReady = Input.bInputReady;
	for (int32_t Index = 0; Index < CarriedPunches.PunchCount; ++Index)
	{
		Input.PlayerIntent.AddPunch(CarriedPunches.Punches[Index].PunchHand, CarriedPunches.Punches[Index].Strength, CarriedPunches.Punches[Index].Zone, CarriedPunches.Punches[Index].Kind);
	}
	CarriedPunches.PunchCount = 0;

	Accumulator += DeltaSeconds < 0.0 ? 0.0 : (DeltaSeconds > 0.25 ? 0.25 : DeltaSeconds);
	int32_t Ticks = 0;
	while (Accumulator >= kTickSeconds)
	{
		Accumulator -= kTickSeconds;
		Game->Tick(Input, CombatEvents, MatchEvents);
		AppendCombatEvents();
		AppendMatchEvents();
		Input.PlayerIntent.PunchCount = 0; // punches apply to the first sub-step only
		++Ticks;
	}
	if (Ticks == 0)
	{
		CarriedPunches = Input.PlayerIntent;
	}
	WriteState();
	return Ticks;
}

namespace
{
	InputFrame MakeFrame(const double* In, bool bBodyAndKicks = true)
	{
		(void)bBodyAndKicks;
		InputFrame Frame;
		Frame.Status = static_cast<TrackingStatus>(Clamp(static_cast<int32_t>(In[0]), 0, 7));
		Frame.Confidence = static_cast<float>(In[1]);
		Frame.LeanLateral = static_cast<float>(In[2]);
		Frame.LeanForward = static_cast<float>(In[3]);
		Frame.BlockAmount = static_cast<float>(In[4]);
		Frame.MoveForward = static_cast<float>(In[7]);
		Frame.MoveLateral = static_cast<float>(In[8]);
		const int32_t Punches = static_cast<int32_t>(In[5]);
		const int32_t Kicks = static_cast<int32_t>(In[6]);
		for (int32_t Bit = 0; Bit < 4; ++Bit)
		{
			if ((Punches & (1 << Bit)) != 0)
			{
				PunchIntent Punch;
				Punch.PunchHand = Bit % 2 == 0 ? Hand::Left : Hand::Right;
				Punch.Zone = Bit >= 2 ? PunchZone::Body : PunchZone::Head;
				Punch.Strength = 1.0f;
				Punch.Confidence = 1.0f;
				Frame.AddPunch(Punch);
			}
			if ((Kicks & (1 << Bit)) != 0)
			{
				PunchIntent Kick;
				Kick.PunchHand = Bit % 2 == 0 ? Hand::Left : Hand::Right;
				Kick.Kind = AttackKind::Kick;
				Kick.Zone = Bit >= 2 ? PunchZone::Leg : PunchZone::Body;
				Kick.Strength = 1.0f;
				Kick.Confidence = 1.0f;
				Frame.AddPunch(Kick);
			}
		}
		return Frame;
	}
}

// Versus (two humans, lockstep): JS fills ie_versus_input() with both players' frames, then ie_versus_step runs exactly
// `Ticks` 120 Hz ticks. No accumulator, no carried punches: the same inputs give the same state on every machine.
// ctl bits (either slot): 1 pause, 2 resume, 4 rematch.
IE_EXPORT(ie_versus_input) double* ie_versus_input() { return VersusIn; }

IE_EXPORT(ie_versus_step) int32_t ie_versus_step(int32_t Ticks)
{
	if (Game == nullptr)
	{
		return 0;
	}
	const InputFrame FrameA = MakeFrame(VersusIn);
	const InputFrame FrameB = MakeFrame(VersusIn + kVersusFields);
	MatchInput Input;
	Input.bInputReady = FrameA.Status == TrackingStatus::Live;
	Input.bOpponentReady = FrameB.Status == TrackingStatus::Live;
	Input.PlayerIntent = Mapper.Map(FrameA);
	Input.OpponentIntent = MapperOpponent.Map(FrameB);
	bLastReady = Input.bInputReady && Input.bOpponentReady;
	const int32_t Ctl = static_cast<int32_t>(VersusIn[9]) | static_cast<int32_t>(VersusIn[kVersusFields + 9]);
	if ((Ctl & 1) != 0)
	{
		Game->RequestPause();
	}
	if ((Ctl & 2) != 0)
	{
		Game->RequestResume();
	}
	if ((Ctl & 4) != 0)
	{
		Game->RequestRematch();
	}
	for (int32_t Index = 0; Index < Ticks; ++Index)
	{
		Game->Tick(Input, CombatEvents, MatchEvents);
		AppendCombatEvents();
		AppendMatchEvents();
		Input.PlayerIntent.PunchCount = 0; // punches apply to the first tick only
		Input.OpponentIntent.PunchCount = 0;
	}
	WriteState();
	return Ticks;
}

// Rollback: ie_save(slot) keeps the whole match state, ie_load(slot) puts it back (and rewrites the exported state block).
// Events are not part of the state: JS drains them after every step.
IE_EXPORT(ie_save_slots) int32_t ie_save_slots() { return kSaveSlots; }

IE_EXPORT(ie_save) int32_t ie_save(int32_t Slot)
{
	if (Game == nullptr || Slot < 0 || Slot >= kSaveSlots)
	{
		return 0;
	}
	SavedState& S = Saved[Slot];
	__builtin_memcpy(S.MatchBytes, static_cast<const void*>(Game), sizeof(Match));
	S.MapperA = Mapper;
	S.MapperB = MapperOpponent;
	S.bReady = bLastReady;
	S.bValid = true;
	return 1;
}

IE_EXPORT(ie_load) int32_t ie_load(int32_t Slot)
{
	if (Game == nullptr || Slot < 0 || Slot >= kSaveSlots || !Saved[Slot].bValid)
	{
		return 0;
	}
	const SavedState& S = Saved[Slot];
	__builtin_memcpy(static_cast<void*>(Game), S.MatchBytes, sizeof(Match));
	Mapper = S.MapperA;
	MapperOpponent = S.MapperB;
	bLastReady = S.bReady;
	CombatEvents.Clear();
	MatchEvents.Clear();
	WriteState();
	return 1;
}

// Fraction of the next tick already accumulated (0..1): lets the renderer interpolate.
IE_EXPORT(ie_alpha) double ie_alpha() { return Accumulator / kTickSeconds; }

IE_EXPORT(ie_pause) void ie_pause()
{
	if (Game != nullptr)
	{
		Game->RequestPause();
	}
}

IE_EXPORT(ie_resume) void ie_resume()
{
	if (Game != nullptr)
	{
		Game->RequestResume();
	}
}

IE_EXPORT(ie_rematch) void ie_rematch()
{
	if (Game != nullptr)
	{
		Game->RequestRematch();
	}
}

// Tunables that the page exposes: the engage distance and the ring size (rope line, from the centre).
IE_EXPORT(ie_engage_distance) double ie_engage_distance() { return Game != nullptr ? Game->Sim().Movement().EngageDistance : 1.35; }
IE_EXPORT(ie_ring_half_size) double ie_ring_half_size() { return Game != nullptr ? Game->Sim().Movement().RingHalfSize : 2.95; }
