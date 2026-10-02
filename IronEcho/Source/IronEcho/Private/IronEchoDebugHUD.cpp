#include "IronEchoDebugHUD.h"

#include "Engine/Canvas.h"
#include "Engine/Engine.h"
#include "Engine/Font.h"
#include "IronEchoGameState.h"
#include "IronEchoPlayerController.h"
#include "IronEchoTypes.h"
#include "IronEchoVisualConfig.h"

namespace IronEchoHudLocal
{
	FString EnumText(const UEnum* Enum, int64 Value)
	{
		return Enum != nullptr ? Enum->GetNameStringByValue(Value) : FString::FromInt(static_cast<int32>(Value));
	}

	FString CalibrationHint(EIronEchoCalibrationStep Step)
	{
		switch (Step)
		{
		case EIronEchoCalibrationStep::Neutral: return TEXT("Stand in your guard and hold still");
		case EIronEchoCalibrationStep::RaiseRightHand: return TEXT("Raise your RIGHT hand above your head");
		case EIronEchoCalibrationStep::SlipLeft: return TEXT("Slip to your LEFT and hold");
		case EIronEchoCalibrationStep::SlipRight: return TEXT("Slip to your RIGHT and hold");
		default: return FString();
		}
	}
}

void AIronEchoDebugHUD::Line(const FString& Text, const FLinearColor& Color, float& Y)
{
	DrawText(Text, Color, 24.0f, Y, GEngine ? GEngine->GetSmallFont() : nullptr, 1.2f);
	Y += 20.0f;
}

void AIronEchoDebugHUD::Bar(float X, float Y, float Width, float Fraction, const FLinearColor& Color)
{
	DrawRect(FLinearColor(0.05f, 0.05f, 0.05f, 0.8f), X, Y, Width, 10.0f);
	DrawRect(Color, X, Y, Width * FMath::Clamp(Fraction, 0.0f, 1.0f), 10.0f);
}

void AIronEchoDebugHUD::DrawHUD()
{
	Super::DrawHUD();
	using namespace IronEchoHudLocal;
	const AIronEchoPlayerController* Controller = Cast<AIronEchoPlayerController>(GetOwningPlayerController());
	if (Controller == nullptr || !Controller->IsDebugOverlayVisible())
	{
		return;
	}
	const AIronEchoGameState* State = GetWorld() ? GetWorld()->GetGameState<AIronEchoGameState>() : nullptr;
	if (State == nullptr)
	{
		return;
	}
	const FIronEchoHudState Hud = State->GetHudState();
	const FIronEchoTrackingHud& T = Hud.Tracking;
	const FLinearColor White(0.95f, 0.95f, 0.95f);
	const FLinearColor Warn(1.0f, 0.75f, 0.2f);
	const FLinearColor Good(0.3f, 1.0f, 0.4f);
	float Y = 20.0f;

	Line(FString::Printf(TEXT("IRON ECHO tech overlay (F3)   contract v%d"), Hud.SchemaVersion), White, Y);
	Line(FString::Printf(TEXT("Input: %s   Tracking: %s   tracker process: %s"),
		*EnumText(StaticEnum<EIronEchoInputSource>(), static_cast<int64>(T.InputSource)),
		*EnumText(StaticEnum<EIronEchoTrackingStatus>(), static_cast<int64>(T.Status)),
		T.bTrackerProcessRunning ? TEXT("running") : TEXT("not running")),
		T.Status == EIronEchoTrackingStatus::Live ? Good : Warn, Y);
	Line(FString::Printf(TEXT("Camera %dx%d @ %.0f fps  inference %.1f ms  pipeline %.1f ms  model %s  mirror %s"),
		T.CameraWidth, T.CameraHeight, T.CameraFps, T.InferenceMs, T.PipelineLatencyMs, *T.ModelName, T.bMirrorApplied ? TEXT("yes") : TEXT("no")), White, Y);
	Line(FString::Printf(TEXT("Packets ok %lld  rejected %lld  lost %lld   punches ok %lld  stale %lld   error %s"),
		T.PacketsAccepted, T.PacketsRejected, T.PacketsLost, T.PunchesAccepted, T.PunchesStale,
		*EnumText(StaticEnum<EIronEchoTrackerError>(), static_cast<int64>(T.LastError))), White, Y);
	if (T.Status == EIronEchoTrackingStatus::Calibrating)
	{
		Line(FString::Printf(TEXT("CALIBRATION: %s  (%d%%)"), *CalibrationHint(T.CalibrationStep), T.CalibrationProgress), Warn, Y);
	}
	else if (T.Status == EIronEchoTrackingStatus::NotCalibrated)
	{
		Line(TEXT("Not calibrated: press C (full) or V (quick)"), Warn, Y);
	}
	if (T.CalibrationFailure != EIronEchoCalibrationFailure::None)
	{
		Line(FString::Printf(TEXT("Last calibration failed: %s"), *EnumText(StaticEnum<EIronEchoCalibrationFailure>(), static_cast<int64>(T.CalibrationFailure))), Warn, Y);
	}
	Y += 8.0f;
	Line(FString::Printf(TEXT("Mode %s  bot %s  phase %s  pause %s"),
		*EnumText(StaticEnum<EIronEchoMatchMode>(), static_cast<int64>(Hud.Mode)),
		*EnumText(StaticEnum<EIronEchoBotLevel>(), static_cast<int64>(Hud.BotLevel)),
		*EnumText(StaticEnum<EIronEchoMatchPhase>(), static_cast<int64>(Hud.Phase)),
		*EnumText(StaticEnum<EIronEchoPauseReason>(), static_cast<int64>(Hud.PauseReason))), White, Y);
	if (Hud.Phase == EIronEchoMatchPhase::Knockdown)
	{
		if (Hud.ResumeIn > 0.0f)
		{
			Line(FString::Printf(TEXT("UP! Box in %.1f"), Hud.ResumeIn), Good, Y);
		}
		else
		{
			Line(FString::Printf(TEXT("KNOCKDOWN  count %d   %s"), Hud.KnockdownCount,
				Hud.Player.bKnockedDown ? *FString::Printf(TEXT("RAISE AND HOLD YOUR GUARD TO GET UP (%d%%)"), Hud.GetUpProgress) : TEXT("opponent is down")), Warn, Y);
		}
	}
	if (Hud.Mode == EIronEchoMatchMode::Training)
	{
		Line(FString::Printf(TEXT("Confirmed bag hits: %d"), Hud.TrainingHits), Good, Y);
	}
	else
	{
		Line(FString::Printf(TEXT("Round %d/%d  time %.1f  countdown %.1f  break %.1f  score %d-%d  result %s"),
			Hud.Round, Hud.Rounds, Hud.RoundTimeRemaining, Hud.CountdownRemaining, Hud.BreakRemaining, Hud.ScorePlayer, Hud.ScoreOpponent,
			*EnumText(StaticEnum<EIronEchoResultMethod>(), static_cast<int64>(Hud.Result))), White, Y);
		if (Hud.JudgeScoresPlayer.Num() == 3 && Hud.JudgeScoresOpponent.Num() == 3)
		{
			Line(FString::Printf(TEXT("Judges: %d-%d  %d-%d  %d-%d   %s"), Hud.JudgeScoresPlayer[0], Hud.JudgeScoresOpponent[0],
				Hud.JudgeScoresPlayer[1], Hud.JudgeScoresOpponent[1], Hud.JudgeScoresPlayer[2], Hud.JudgeScoresOpponent[2],
				*EnumText(StaticEnum<EIronEchoDecisionKind>(), static_cast<int64>(Hud.Decision))), White, Y);
		}
	}
	const FIronEchoFighterHud* Fighters[2] = {&Hud.Player, &Hud.Opponent};
	for (int32 Index = 0; Index < 2; ++Index)
	{
		const FIronEchoFighterHud& F = *Fighters[Index];
		Line(FString::Printf(TEXT("%s  %s  thrown %d landed %d  combo %d (max %d)  slips %d blocks %d  counters %d  KD %d"),
			Index == 0 ? TEXT("PLAYER  ") : TEXT("OPPONENT"), *EnumText(StaticEnum<EIronEchoActionState>(), static_cast<int64>(F.ActionState)),
			F.PunchesThrown, F.PunchesLanded, F.ComboCount, F.MaxCombo, F.DodgesMade, F.BlocksMade, F.CounterHits, F.KnockdownsSuffered), White, Y);
		Bar(24.0f, Y, 260.0f, F.MaxHealth > 0 ? F.Health / F.MaxHealth : 0.0f, FLinearColor(0.9f, 0.15f, 0.15f));
		Bar(300.0f, Y, 160.0f, F.MaxStamina > 0 ? F.Stamina / F.MaxStamina : 0.0f, FLinearColor(0.2f, 0.6f, 1.0f));
		Y += 18.0f;
	}
	Y += 8.0f;
	Line(TEXT("Keys: J/K punch  Space block  A/D slip  F1 input  F2 mode  P pause  Enter rematch  C/V calibrate  1-3 bot  F4 preview"),
		FLinearColor(0.7f, 0.7f, 0.7f), Y);
}
