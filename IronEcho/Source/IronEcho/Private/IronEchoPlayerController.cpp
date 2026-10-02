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

	if (WasInputKeyJustPressed(EKeys::J))
	{
		++PendingLeft;
	}
	if (WasInputKeyJustPressed(EKeys::K))
	{
		++PendingRight;
	}
	const float TargetLean = (IsInputKeyDown(EKeys::A) ? -1.0f : 0.0f) + (IsInputKeyDown(EKeys::D) ? 1.0f : 0.0f);
	KeyboardLean = FMath::FInterpTo(KeyboardLean, TargetLean, DeltaTime, 14.0f);

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
	const bool bBlock = IsInputKeyDown(EKeys::SpaceBar);
	Frame.BlockAmount = bBlock ? 1.0f : 0.0f;
	const float Raise = bBlock ? 0.62f : 0.25f;
	Frame.HandPos[0] = IronEchoCore::Vec3{bBlock ? 0.32f : 0.45f, -0.15f, Raise};
	Frame.HandPos[1] = IronEchoCore::Vec3{bBlock ? 0.32f : 0.45f, 0.15f, Raise};
	Frame.HandConfidence[0] = 1.0f;
	Frame.HandConfidence[1] = 1.0f;
	for (int32 Index = 0; Index < PendingLeft + PendingRight; ++Index)
	{
		IronEchoCore::PunchIntent Punch;
		Punch.PunchHand = Index < PendingLeft ? IronEchoCore::Hand::Left : IronEchoCore::Hand::Right;
		Punch.Strength = 1.0f;
		Punch.Confidence = 1.0f;
		Frame.AddPunch(Punch);
	}
	PendingLeft = 0;
	PendingRight = 0;
	return Frame;
}
