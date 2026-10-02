#include "IronEchoRules/Match.h"

namespace IronEchoCore
{
	namespace
	{
		constexpr FighterSlot kBothSlots[2] = {FighterSlot::Player, FighterSlot::Opponent};
	}

	const char* MatchPhaseName(MatchPhase Phase)
	{
		switch (Phase)
		{
		case MatchPhase::WaitingForPlayer: return "WaitingForPlayer";
		case MatchPhase::Countdown: return "Countdown";
		case MatchPhase::Fighting: return "Fighting";
		case MatchPhase::RoundBreak: return "RoundBreak";
		case MatchPhase::MatchOver: return "MatchOver";
		case MatchPhase::Paused: return "Paused";
		case MatchPhase::Training: return "Training";
		case MatchPhase::Knockdown: return "Knockdown";
		}
		return "Unknown";
	}

	const char* MatchEventName(MatchEventType Type)
	{
		switch (Type)
		{
		case MatchEventType::PhaseChanged: return "PhaseChanged";
		case MatchEventType::RoundStarted: return "RoundStarted";
		case MatchEventType::RoundEnded: return "RoundEnded";
		case MatchEventType::MatchEnded: return "MatchEnded";
		case MatchEventType::Paused: return "Paused";
		case MatchEventType::Resumed: return "Resumed";
		case MatchEventType::CountdownTick: return "CountdownTick";
		case MatchEventType::KnockdownCount: return "KnockdownCount";
		}
		return "Unknown";
	}

	const char* CombatEventName(CombatEventType Type)
	{
		switch (Type)
		{
		case CombatEventType::AttackStarted: return "AttackStarted";
		case CombatEventType::AttackActive: return "AttackActive";
		case CombatEventType::AttackRecovery: return "AttackRecovery";
		case CombatEventType::AttackFinished: return "AttackFinished";
		case CombatEventType::AttackCancelled: return "AttackCancelled";
		case CombatEventType::HitConfirmed: return "HitConfirmed";
		case CombatEventType::Blocked: return "Blocked";
		case CombatEventType::Dodged: return "Dodged";
		case CombatEventType::Whiffed: return "Whiffed";
		case CombatEventType::GuardBroken: return "GuardBroken";
		case CombatEventType::KnockedOut: return "KnockedOut";
		case CombatEventType::StaminaExhausted: return "StaminaExhausted";
		case CombatEventType::BlockStarted: return "BlockStarted";
		case CombatEventType::BlockEnded: return "BlockEnded";
		case CombatEventType::DodgeStarted: return "DodgeStarted";
		case CombatEventType::DodgeEnded: return "DodgeEnded";
		case CombatEventType::InputDropped: return "InputDropped";
		case CombatEventType::KnockedDown: return "KnockedDown";
		case CombatEventType::GotUp: return "GotUp";
		}
		return "Unknown";
	}

	CombatSim Match::MakeSim(const MatchSetup& Setup, MatchMode Mode)
	{
		FighterConfig PlayerCfg = Setup.PlayerFighter;
		FighterConfig OpponentCfg = Mode == MatchMode::Training ? Setup.TrainingBag : Setup.OpponentFighter;
		if (!Setup.Rules.bKnockdowns)
		{
			PlayerCfg.bKnockdowns = false;
			OpponentCfg.bKnockdowns = false;
		}
		return CombatSim(PlayerCfg, OpponentCfg, Setup.Movement);
	}

	void Match::ScoreRound(const MatchConfig& Rules, const RoundTally& Player, const RoundTally& Opponent, int32_t OutPoints[kJudgeCount][2])
	{
		for (int32_t Judge = 0; Judge < kJudgeCount; ++Judge)
		{
			const float PlayerValue = Player.Damage + Rules.JudgeLandedWeight[Judge] * static_cast<float>(Player.Landed)
				+ Rules.JudgeDefenseWeight[Judge] * static_cast<float>(Player.Defenses);
			const float OpponentValue = Opponent.Damage + Rules.JudgeLandedWeight[Judge] * static_cast<float>(Opponent.Landed)
				+ Rules.JudgeDefenseWeight[Judge] * static_cast<float>(Opponent.Defenses);
			const float Diff = PlayerValue - OpponentValue;
			int32_t PlayerPoints = 10;
			int32_t OpponentPoints = 10;
			if (Diff > Rules.DrawDamageMargin)
			{
				OpponentPoints = 9;
			}
			else if (Diff < -Rules.DrawDamageMargin)
			{
				PlayerPoints = 9;
			}
			// Each knockdown suffered costs one more point (classic 10-8 round).
			PlayerPoints -= Player.KnockdownsSuffered;
			OpponentPoints -= Opponent.KnockdownsSuffered;
			OutPoints[Judge][0] = PlayerPoints < Rules.MinPointsPerRound ? Rules.MinPointsPerRound : PlayerPoints;
			OutPoints[Judge][1] = OpponentPoints < Rules.MinPointsPerRound ? Rules.MinPointsPerRound : OpponentPoints;
		}
	}

	DecisionKind Match::DecideCards(const int32_t Totals[kJudgeCount][2], bool& bOutHasWinner, FighterSlot& OutWinner)
	{
		int32_t PlayerCards = 0;
		int32_t OpponentCards = 0;
		int32_t EvenCards = 0;
		for (int32_t Judge = 0; Judge < kJudgeCount; ++Judge)
		{
			if (Totals[Judge][0] > Totals[Judge][1])
			{
				++PlayerCards;
			}
			else if (Totals[Judge][0] < Totals[Judge][1])
			{
				++OpponentCards;
			}
			else
			{
				++EvenCards;
			}
		}
		bOutHasWinner = PlayerCards != OpponentCards && (PlayerCards >= 2 || OpponentCards >= 2);
		OutWinner = PlayerCards > OpponentCards ? FighterSlot::Player : FighterSlot::Opponent;
		if (bOutHasWinner)
		{
			const int32_t Winning = PlayerCards > OpponentCards ? PlayerCards : OpponentCards;
			const int32_t Losing = PlayerCards > OpponentCards ? OpponentCards : PlayerCards;
			if (Winning == kJudgeCount)
			{
				return DecisionKind::Unanimous;
			}
			return Losing > 0 ? DecisionKind::Split : DecisionKind::Majority;
		}
		// Draws: all even = unanimous draw, one each way + one even = split draw, two even = majority draw.
		if (EvenCards == kJudgeCount)
		{
			return DecisionKind::Unanimous;
		}
		return EvenCards == 1 ? DecisionKind::Split : DecisionKind::Majority;
	}

	Match::Match(const MatchSetup& InSetup)
		: SetupData(InSetup)
		, SimData(MakeSim(InSetup, InSetup.Mode))
		, Bot(InSetup.Bot, InSetup.Seed)
	{
		Restart(InSetup.Mode, InSetup.Seed);
	}

	void Match::Restart(MatchMode Mode, uint64_t Seed)
	{
		SetupData.Mode = Mode;
		SetupData.Seed = Seed;
		SimData = MakeSim(SetupData, Mode);
		SimData.ResetForMatch();
		Bot.Reset(Seed);
		Snap = MatchSnapshot{};
		Snap.Mode = Mode;
		Snap.Rounds = Mode == MatchMode::Bout ? SetupData.Rules.Rounds : 0;
		Snap.Seed = Seed;
		CountdownTarget = MatchPhase::Fighting;
		bRoundInProgress = false;
		ReadyTicks = 0;
		NotReadyTicks = 0;
		LastCountdownSecond = 0;
		bPauseRequested = false;
		bResumeRequested = false;
		bRematchRequested = false;
	}

	MatchEvent Match::MakeEvent(MatchEventType Type) const
	{
		MatchEvent Event;
		Event.Type = Type;
		Event.Phase = Snap.Phase;
		Event.Reason = Snap.Pause;
		Event.Round = Snap.Round;
		Event.ScorePlayer = Snap.ScorePlayer;
		Event.ScoreOpponent = Snap.ScoreOpponent;
		Event.Method = Snap.Result;
		Event.bHasWinner = Snap.bHasWinner;
		Event.Winner = Snap.Winner;
		Event.Decision = Snap.Decision;
		Event.Tick = Snap.Tick;
		return Event;
	}

	void Match::SetPhase(MatchPhase NewPhase, MatchEventBuffer& Events)
	{
		if (NewPhase == Snap.Phase)
		{
			return;
		}
		const MatchPhase Previous = Snap.Phase;
		Snap.Phase = NewPhase;
		MatchEvent Event = MakeEvent(MatchEventType::PhaseChanged);
		Event.PreviousPhase = Previous;
		Events.Push(Event);
	}

	void Match::BeginCountdown(MatchPhase Target, bool bNewRound, MatchEventBuffer& Events)
	{
		CountdownTarget = Target;
		if (bNewRound && Target == MatchPhase::Fighting)
		{
			++Snap.Round;
			Snap.RoundTicksLeft = SetupData.Rules.RoundTicks;
			bRoundInProgress = false;
		}
		Snap.CountdownTicksLeft = SetupData.Rules.CountdownTicks;
		LastCountdownSecond = 0;
		SetPhase(MatchPhase::Countdown, Events);
	}

	void Match::EnterPause(PauseReason Reason, MatchEventBuffer& Events)
	{
		Snap.ResumePhase = Snap.Phase == MatchPhase::Countdown ? CountdownTarget : Snap.Phase;
		Snap.Pause = Reason;
		bResumeRequested = false;
		SetPhase(MatchPhase::Paused, Events);
		Events.Push(MakeEvent(MatchEventType::Paused));
	}

	void Match::Resume(MatchEventBuffer& Events)
	{
		const MatchPhase Target = Snap.ResumePhase;
		Snap.Pause = PauseReason::None;
		bResumeRequested = false;
		Events.Push(MakeEvent(MatchEventType::Resumed));
		if (Target == MatchPhase::RoundBreak || Target == MatchPhase::Knockdown)
		{
			SetPhase(Target, Events);
		}
		else
		{
			BeginCountdown(Target, false, Events);
		}
	}

	void Match::Tick(const MatchInput& Input, CombatEventBuffer& CombatEvents, MatchEventBuffer& MatchEvents)
	{
		++Snap.Tick;
		if (Input.bInputReady)
		{
			++ReadyTicks;
			NotReadyTicks = 0;
		}
		else
		{
			++NotReadyTicks;
			ReadyTicks = 0;
		}

		if (bRematchRequested)
		{
			bRematchRequested = false;
			if (Snap.Phase == MatchPhase::MatchOver || Snap.Phase == MatchPhase::Paused || Snap.Mode == MatchMode::Training)
			{
				const MatchPhase Previous = Snap.Phase;
				const int32_t KeepTick = Snap.Tick;
				Restart(SetupData.Mode, SetupData.Seed + 1);
				Snap.Tick = KeepTick;
				MatchEvent Event = MakeEvent(MatchEventType::PhaseChanged);
				Event.PreviousPhase = Previous;
				MatchEvents.Push(Event);
				return;
			}
		}
		if (bPauseRequested)
		{
			bPauseRequested = false;
			if (Snap.Phase == MatchPhase::Countdown || Snap.Phase == MatchPhase::Fighting
				|| Snap.Phase == MatchPhase::RoundBreak || Snap.Phase == MatchPhase::Training || Snap.Phase == MatchPhase::Knockdown)
			{
				EnterPause(PauseReason::Manual, MatchEvents);
				return;
			}
		}

		const MatchConfig& Rules = SetupData.Rules;
		switch (Snap.Phase)
		{
		case MatchPhase::WaitingForPlayer:
			if (ReadyTicks >= Rules.ReadyStableTicks)
			{
				if (Snap.Mode == MatchMode::Training)
				{
					BeginCountdown(MatchPhase::Training, false, MatchEvents);
				}
				else
				{
					BeginCountdown(MatchPhase::Fighting, true, MatchEvents);
				}
			}
			break;

		case MatchPhase::Countdown:
		{
			if (NotReadyTicks >= Rules.TrackingLossGraceTicks)
			{
				EnterPause(PauseReason::TrackingLost, MatchEvents);
				break;
			}
			const int32_t Second = (Snap.CountdownTicksLeft + kTickRate - 1) / kTickRate;
			if (Second != LastCountdownSecond && Second > 0)
			{
				LastCountdownSecond = Second;
				MatchEvent Event = MakeEvent(MatchEventType::CountdownTick);
				Event.CountdownSeconds = Second;
				MatchEvents.Push(Event);
			}
			if (--Snap.CountdownTicksLeft <= 0)
			{
				Snap.CountdownTicksLeft = 0;
				SetPhase(CountdownTarget, MatchEvents);
				if (CountdownTarget == MatchPhase::Fighting && !bRoundInProgress)
				{
					bRoundInProgress = true;
					MatchEvents.Push(MakeEvent(MatchEventType::RoundStarted));
				}
			}
			break;
		}

		case MatchPhase::Fighting:
			if (NotReadyTicks >= Rules.TrackingLossGraceTicks)
			{
				EnterPause(PauseReason::TrackingLost, MatchEvents);
				break;
			}
			StepFight(Input, false, CombatEvents, MatchEvents);
			break;

		case MatchPhase::Training:
			if (NotReadyTicks >= Rules.TrackingLossGraceTicks)
			{
				EnterPause(PauseReason::TrackingLost, MatchEvents);
				break;
			}
			StepFight(Input, true, CombatEvents, MatchEvents);
			break;

		case MatchPhase::Knockdown:
			if (NotReadyTicks >= Rules.TrackingLossGraceTicks)
			{
				EnterPause(PauseReason::TrackingLost, MatchEvents);
				break;
			}
			StepKnockdown(Input, CombatEvents, MatchEvents);
			break;

		case MatchPhase::RoundBreak:
			if (--Snap.BreakTicksLeft <= 0)
			{
				Snap.BreakTicksLeft = 0;
				SimData.ResetForRound(Rules.BetweenRoundHealthRecovery);
				BeginCountdown(MatchPhase::Fighting, true, MatchEvents);
			}
			break;

		case MatchPhase::Paused:
			// A manual resume request is kept until the player has been ready for ReadyStableTicks.
			if (ReadyTicks >= Rules.ReadyStableTicks && (Snap.Pause == PauseReason::TrackingLost || bResumeRequested))
			{
				Resume(MatchEvents);
			}
			break;

		case MatchPhase::MatchOver:
			break;
		}
	}

	void Match::StepFight(const MatchInput& Input, bool bTraining, CombatEventBuffer& CombatEvents, MatchEventBuffer& MatchEvents)
	{
		++Snap.SimTick;
		const FighterIntent OpponentIntent = bTraining ? FighterIntent{} : Bot.Think(SimData, Snap.SimTick);
		const int32_t FirstEvent = CombatEvents.Num();
		SimData.Step(Input.PlayerIntent, OpponentIntent, Snap.SimTick, CombatEvents);

		if (bTraining)
		{
			for (int32_t Index = FirstEvent; Index < CombatEvents.Num(); ++Index)
			{
				const CombatEvent& Event = CombatEvents[Index];
				if (Event.Type == CombatEventType::HitConfirmed && Event.Actor == FighterSlot::Player)
				{
					++Snap.TrainingHits;
				}
			}
			return;
		}

		// The Nth knockdown in a round (default third) stops the fight: technical knockout.
		bool bTechnical = false;
		bool bAnyDown = false;
		for (FighterSlot Slot : kBothSlots)
		{
			Fighter& F = SimData.Mutable(Slot);
			if (!F.IsKnockedDown())
			{
				continue;
			}
			if (F.Snapshot().RoundKnockdownsSuffered >= SetupData.Rules.MaxKnockdownsPerRound)
			{
				F.ForceKnockOut(Snap.SimTick, CombatEvents);
				bTechnical = true;
			}
			else
			{
				bAnyDown = true;
			}
		}

		const bool bPlayerKO = SimData.Get(FighterSlot::Player).IsKnockedOut();
		const bool bOpponentKO = SimData.Get(FighterSlot::Opponent).IsKnockedOut();
		const ResultMethod StoppageMethod = bTechnical ? ResultMethod::TechnicalKnockOut : ResultMethod::KnockOut;
		if (bPlayerKO && bOpponentKO)
		{
			FinishMatch(ResultMethod::Draw, false, FighterSlot::Player, MatchEvents);
			return;
		}
		if (bPlayerKO || bOpponentKO)
		{
			FinishMatch(StoppageMethod, true, bPlayerKO ? FighterSlot::Opponent : FighterSlot::Player, MatchEvents);
			return;
		}
		if (bAnyDown)
		{
			BeginKnockdown(MatchEvents);
			return;
		}
		if (--Snap.RoundTicksLeft <= 0)
		{
			Snap.RoundTicksLeft = 0;
			EndRound(MatchEvents);
		}
	}

	void Match::EndRound(MatchEventBuffer& Events)
	{
		RoundTally Tallies[2];
		for (FighterSlot Slot : kBothSlots)
		{
			const FighterSnapshot& F = SimData.Get(Slot).Snapshot();
			RoundTally& T = Tallies[SlotIndex(Slot)];
			T.Damage = F.RoundDamageDealt;
			T.Landed = F.RoundPunchesLanded;
			T.Defenses = F.RoundDefenses;
			T.KnockdownsSuffered = F.RoundKnockdownsSuffered;
		}
		int32_t Points[kJudgeCount][2] = {};
		ScoreRound(SetupData.Rules, Tallies[0], Tallies[1], Points);
		for (int32_t Judge = 0; Judge < kJudgeCount; ++Judge)
		{
			Snap.JudgeScores[Judge][0] += Points[Judge][0];
			Snap.JudgeScores[Judge][1] += Points[Judge][1];
		}
		Snap.ScorePlayer = Snap.JudgeScores[0][0];
		Snap.ScoreOpponent = Snap.JudgeScores[0][1];
		const bool bRoundWinner = Points[0][0] != Points[0][1];
		const FighterSlot RoundWinner = Points[0][0] > Points[0][1] ? FighterSlot::Player : FighterSlot::Opponent;
		bRoundInProgress = false;

		MatchEvent Event = MakeEvent(MatchEventType::RoundEnded);
		Event.bHasWinner = bRoundWinner;
		Event.Winner = RoundWinner;
		Event.Method = ResultMethod::None;
		Events.Push(Event);

		if (Snap.Round >= SetupData.Rules.Rounds)
		{
			bool bHasWinner = false;
			FighterSlot Winner = FighterSlot::Player;
			Snap.Decision = DecideCards(Snap.JudgeScores, bHasWinner, Winner);
			FinishMatch(bHasWinner ? ResultMethod::Decision : ResultMethod::Draw, bHasWinner, Winner, Events);
			return;
		}
		Snap.BreakTicksLeft = SetupData.Rules.BreakTicks;
		SetPhase(MatchPhase::RoundBreak, Events);
	}

	void Match::BeginKnockdown(MatchEventBuffer& Events)
	{
		CountTicks = 0;
		PlayerGuardHeldTicks = 0;
		BotGetUpCount = -1;
		Snap.KnockdownCount = 0;
		Snap.GetUpProgress = 0;
		Snap.PostGetUpTicksLeft = 0;
		const Fighter& OpponentF = SimData.Get(FighterSlot::Opponent);
		if (OpponentF.IsKnockedDown())
		{
			BotGetUpCount = Bot.DecideGetUpCount(OpponentF.Snapshot().KnockdownsSuffered);
		}
		SetPhase(MatchPhase::Knockdown, Events);
	}

	void Match::StepKnockdown(const MatchInput& Input, CombatEventBuffer& CombatEvents, MatchEventBuffer& MatchEvents)
	{
		const MatchConfig& Rules = SetupData.Rules;
		if (Snap.PostGetUpTicksLeft > 0)
		{
			if (--Snap.PostGetUpTicksLeft <= 0)
			{
				Snap.PostGetUpTicksLeft = 0;
				Snap.KnockdownCount = 0;
				SetPhase(MatchPhase::Fighting, MatchEvents);
			}
			return;
		}

		++CountTicks;
		Fighter& PlayerF = SimData.Mutable(FighterSlot::Player);
		Fighter& OpponentF = SimData.Mutable(FighterSlot::Opponent);
		if (CountTicks % Rules.CountStepTicks == 0)
		{
			++Snap.KnockdownCount;
			MatchEvent Event = MakeEvent(MatchEventType::KnockdownCount);
			Event.CountdownSeconds = Snap.KnockdownCount;
			Event.bHasDowned = true;
			Event.Downed = PlayerF.IsKnockedDown() ? FighterSlot::Player : FighterSlot::Opponent;
			MatchEvents.Push(Event);
		}

		const bool bCountAllowsGetUp = CountTicks >= Rules.MinDownTicks && Snap.KnockdownCount < Rules.CountTo;
		if (PlayerF.IsKnockedDown())
		{
			// The player beats the count by raising the guard and holding it (a real, readable gesture).
			PlayerGuardHeldTicks = Input.PlayerIntent.bBlock ? PlayerGuardHeldTicks + 1 : 0;
			const int32_t Hold = Rules.GetUpHoldTicks > 0 ? Rules.GetUpHoldTicks : 1;
			Snap.GetUpProgress = PlayerGuardHeldTicks >= Hold ? 100 : (100 * PlayerGuardHeldTicks) / Hold;
			if (bCountAllowsGetUp && PlayerGuardHeldTicks >= Hold)
			{
				PlayerF.GetUp(Snap.SimTick, CombatEvents);
			}
		}
		if (OpponentF.IsKnockedDown() && bCountAllowsGetUp && BotGetUpCount > 0 && Snap.KnockdownCount >= BotGetUpCount)
		{
			OpponentF.GetUp(Snap.SimTick, CombatEvents);
		}

		if (Snap.KnockdownCount >= Rules.CountTo)
		{
			const bool bPlayerOut = PlayerF.IsKnockedDown();
			const bool bOpponentOut = OpponentF.IsKnockedDown();
			if (bPlayerOut)
			{
				PlayerF.ForceKnockOut(Snap.SimTick, CombatEvents);
			}
			if (bOpponentOut)
			{
				OpponentF.ForceKnockOut(Snap.SimTick, CombatEvents);
			}
			if (bPlayerOut && bOpponentOut)
			{
				FinishMatch(ResultMethod::Draw, false, FighterSlot::Player, MatchEvents);
				return;
			}
			if (bPlayerOut || bOpponentOut)
			{
				FinishMatch(ResultMethod::KnockOut, true, bPlayerOut ? FighterSlot::Opponent : FighterSlot::Player, MatchEvents);
				return;
			}
		}

		if (!PlayerF.IsKnockedDown() && !OpponentF.IsKnockedDown())
		{
			SimData.ResetPositions();
			Snap.GetUpProgress = 0;
			Snap.PostGetUpTicksLeft = Rules.PostGetUpTicks > 0 ? Rules.PostGetUpTicks : 1;
		}
	}

	void Match::FinishMatch(ResultMethod Method, bool bHasWinner, FighterSlot Winner, MatchEventBuffer& Events)
	{
		Snap.Result = Method;
		Snap.bHasWinner = bHasWinner;
		Snap.Winner = Winner;
		bRoundInProgress = false;
		SetPhase(MatchPhase::MatchOver, Events);
		Events.Push(MakeEvent(MatchEventType::MatchEnded));
	}
}
