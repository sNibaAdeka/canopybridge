#include "IronEchoPlayerController.h"

#include "Engine/GameInstance.h"
#include "Engine/World.h"
#include "InputCoreTypes.h"
#include "IronEchoGameMode.h"
#include "IronEchoSettings.h"
#include "IronEchoTrackingSubsystem.h"
#include "IronEchoTypes.h"

AIronEchoPlayerController::AIronEchoPlayerController()
{
	bAutoManageActiveCameraTarget = false; // the game mode chooses the view target
	bShowMouseCursor = false;
	// Read here, not in BeginPlay: the game mode may hide the overlay before this controller begins play.
	bShowDebugOverlay = GetDefault<UIronEchoSettings>()->bShowDebugOverlay;
}

void AIronEchoPlayerController::BeginPlay()
{
	Super::BeginPlay();
	SetInputMode(FInputModeGameOnly());
}

void AIronEchoPlayerController::PlayerTick(float DeltaTime)
{
	Super::PlayerTick(DeltaTime);

	// J / K: jab / cross to the head; with Shift (or N / M): to the body.
	const bool bShift = IsInputKeyDown(EKeys::LeftShift) || IsInputKeyDown(EKeys::RightShift);
	if (WasInputKeyJustPressed(EKeys::J))
	{
		++(bShift ? PendingBodyLeft : PendingLeft);
	}
	if (WasInputKeyJustPressed(EKeys::K))
	{
		++(bShift ? PendingBodyRight : PendingRight);
	}
	if (WasInputKeyJustPressed(EKeys::N))
	{
		++PendingBodyLeft;
	}
	if (WasInputKeyJustPressed(EKeys::M))
	{
		++PendingBodyRight;
	}
	// U / I: lead / rear leg kick to the body, with Shift to the legs.
	if (WasInputKeyJustPressed(EKeys::U))
	{
		++(bShift ? PendingKickLowLeft : PendingKickLeft);
	}
	if (WasInputKeyJustPressed(EKeys::I))
	{
		++(bShift ? PendingKickLowRight : PendingKickRight);
	}
	// Q / E: slip left / right. W / S: step in / back. A / D: circle left / right.
	const float TargetLean = (IsInputKeyDown(EKeys::Q) ? -1.0f : 0.0f) + (IsInputKeyDown(EKeys::E) ? 1.0f : 0.0f);
	KeyboardLean = FMath::FInterpTo(KeyboardLean, TargetLean, DeltaTime, 14.0f);
	KeyboardMoveForward = (IsInputKeyDown(EKeys::W) ? 1.0f : 0.0f) - (IsInputKeyDown(EKeys::S) ? 1.0f : 0.0f);
	KeyboardMoveLateral = (IsInputKeyDown(EKeys::D) ? 1.0f : 0.0f) - (IsInputKeyDown(EKeys::A) ? 1.0f : 0.0f);

	AIronEchoGameMode* Mode = GetWorld() ? GetWorld()->GetAuthGameMode<AIronEchoGameMode>() : nullptr;
	UIronEchoTrackingSubsystem* Tracking = GetGameInstance() ? GetGameInstance()->GetSubsystem<UIronEchoTrackingSubsystem>() : nullptr;
	if (Mode != nullptr)
	{
		if (WasInputKeyJustPressed(EKeys::F1))
		{
			Mode->SetInputSource(Mode->GetInputSource() == EIronEchoInputSource::Tracker ? EIronEchoInputSource::Keyboard : EIronEchoInputSource::Tracker);
		}
		if (WasInputKeyJustPressed(EKeys::F2))
		{
			if (Mode->GetHudState().Mode == EIronEchoMatchMode::Training)
			{
				Mode->StartBout(Mode->GetHudState().BotLevel);
			}
			else
			{
				Mode->StartTraining();
			}
		}
		if (WasInputKeyJustPressed(EKeys::P))
		{
			Mode->TogglePause();
		}
		if (WasInputKeyJustPressed(EKeys::Enter))
		{
			Mode->RequestRematch();
		}
		if (WasInputKeyJustPressed(EKeys::C))
		{
			Mode->RequestCalibration(true);
		}
		if (WasInputKeyJustPressed(EKeys::V))
		{
			Mode->RequestCalibration(false);
		}
		if (WasInputKeyJustPressed(EKeys::One))
		{
			Mode->StartBout(EIronEchoBotLevel::Easy);
		}
		if (WasInputKeyJustPressed(EKeys::Two))
		{
			Mode->StartBout(EIronEchoBotLevel::Normal);
		}
		if (WasInputKeyJustPressed(EKeys::Three))
		{
			Mode->StartBout(EIronEchoBotLevel::Hard);
		}
	}
	if (WasInputKeyJustPressed(EKeys::F3))
	{
		bShowDebugOverlay = !bShowDebugOverlay;
	}
	if (WasInputKeyJustPressed(EKeys::F4) && Tracking != nullptr)
	{
		bTrackerPreview = !bTrackerPreview;
		Tracking->SetTrackerPreview(bTrackerPreview);
	}
}

IronEchoCore::InputFrame AIronEchoPlayerController::ConsumeKeyboardFrame()
{
	IronEchoCore::InputFrame Frame;
	Frame.Status = IronEchoCore::TrackingStatus::Live;
	Frame.Confidence = 1.0f;
	Frame.LeanLateral = KeyboardLean;
	Frame.MoveForward = KeyboardMoveForward;
	Frame.MoveLateral = KeyboardMoveLateral;
	const bool bBlock = IsInputKeyDown(EKeys::SpaceBar);
	Frame.BlockAmount = bBlock ? 1.0f : 0.0f;
	const float Raise = bBlock ? 0.62f : 0.25f;
	Frame.HandPos[0] = IronEchoCore::Vec3{bBlock ? 0.32f : 0.45f, -0.15f, Raise};
	Frame.HandPos[1] = IronEchoCore::Vec3{bBlock ? 0.32f : 0.45f, 0.15f, Raise};
	Frame.HandConfidence[0] = 1.0f;
	Frame.HandConfidence[1] = 1.0f;
	const int32 Counts[4] = {PendingLeft, PendingRight, PendingBodyLeft, PendingBodyRight};
	for (int32 Kind = 0; Kind < 4; ++Kind)
	{
		for (int32 Index = 0; Index < Counts[Kind]; ++Index)
		{
			IronEchoCore::PunchIntent Punch;
			Punch.PunchHand = (Kind % 2 == 0) ? IronEchoCore::Hand::Left : IronEchoCore::Hand::Right;
			Punch.Zone = Kind >= 2 ? IronEchoCore::PunchZone::Body : IronEchoCore::PunchZone::Head;
			Punch.Strength = 1.0f;
			Punch.Confidence = 1.0f;
			Frame.AddPunch(Punch);
		}
	}
	const int32 KickCounts[4] = {PendingKickLeft, PendingKickRight, PendingKickLowLeft, PendingKickLowRight};
	for (int32 Kind = 0; Kind < 4; ++Kind)
	{
		for (int32 Index = 0; Index < KickCounts[Kind]; ++Index)
		{
			IronEchoCore::PunchIntent Kick;
			Kick.PunchHand = (Kind % 2 == 0) ? IronEchoCore::Hand::Left : IronEchoCore::Hand::Right;
			Kick.Kind = IronEchoCore::AttackKind::Kick;
			Kick.Zone = Kind >= 2 ? IronEchoCore::PunchZone::Leg : IronEchoCore::PunchZone::Body;
			Kick.Strength = 1.0f;
			Kick.Confidence = 1.0f;
			Frame.AddPunch(Kick);
		}
	}
	PendingLeft = 0;
	PendingRight = 0;
	PendingBodyLeft = 0;
	PendingBodyRight = 0;
	PendingKickLeft = PendingKickRight = PendingKickLowLeft = PendingKickLowRight = 0;
	return Frame;
}
