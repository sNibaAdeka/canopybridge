#include "IronEchoRules/Match.h"

namespace IronEchoCore
{
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
		}
		return "Unknown";
	}

	CombatSim Match::MakeSim(const MatchSetup& Setup, MatchMode Mode)
	{
		return CombatSim(Setup.PlayerFighter, Mode == MatchMode::Training ? Setup.TrainingBag : Setup.OpponentFighter, Setup.Movement);
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
		if (Target == MatchPhase::RoundBreak)
		{
			SetPhase(MatchPhase::RoundBreak, Events);
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
				|| Snap.Phase == MatchPhase::RoundBreak || Snap.Phase == MatchPhase::Training)
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

		const bool bPlayerKO = SimData.Get(FighterSlot::Player).IsKnockedOut();
		const bool bOpponentKO = SimData.Get(FighterSlot::Opponent).IsKnockedOut();
		if (bPlayerKO && bOpponentKO)
		{
			FinishMatch(ResultMethod::Draw, false, FighterSlot::Player, MatchEvents);
			return;
		}
		if (bPlayerKO || bOpponentKO)
		{
			FinishMatch(ResultMethod::KnockOut, true, bPlayerKO ? FighterSlot::Opponent : FighterSlot::Player, MatchEvents);
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
		const float PlayerDamage = SimData.Get(FighterSlot::Player).Snapshot().RoundDamageDealt;
		const float OpponentDamage = SimData.Get(FighterSlot::Opponent).Snapshot().RoundDamageDealt;
		const float Diff = PlayerDamage - OpponentDamage;
		int32_t PlayerPoints = 10;
		int32_t OpponentPoints = 10;
		bool bRoundWinner = false;
		FighterSlot RoundWinner = FighterSlot::Player;
		if (Diff > SetupData.Rules.DrawDamageMargin)
		{
			OpponentPoints = 9;
			bRoundWinner = true;
			RoundWinner = FighterSlot::Player;
		}
		else if (Diff < -SetupData.Rules.DrawDamageMargin)
		{
			PlayerPoints = 9;
			bRoundWinner = true;
			RoundWinner = FighterSlot::Opponent;
		}
		Snap.ScorePlayer += PlayerPoints;
		Snap.ScoreOpponent += OpponentPoints;
		bRoundInProgress = false;

		MatchEvent Event = MakeEvent(MatchEventType::RoundEnded);
		Event.bHasWinner = bRoundWinner;
		Event.Winner = RoundWinner;
		Event.Method = ResultMethod::None;
		Events.Push(Event);

		if (Snap.Round >= SetupData.Rules.Rounds)
		{
			if (Snap.ScorePlayer == Snap.ScoreOpponent)
			{
				FinishMatch(ResultMethod::Draw, false, FighterSlot::Player, Events);
			}
			else
			{
				FinishMatch(ResultMethod::Decision, true,
					Snap.ScorePlayer > Snap.ScoreOpponent ? FighterSlot::Player : FighterSlot::Opponent, Events);
			}
			return;
		}
		Snap.BreakTicksLeft = SetupData.Rules.BreakTicks;
		SetPhase(MatchPhase::RoundBreak, Events);
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
