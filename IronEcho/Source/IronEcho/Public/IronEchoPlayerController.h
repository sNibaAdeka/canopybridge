// Local player controller: debug keyboard input (an InputFrame source like the tracker) and dev hotkeys.
// Keyboard input is for development only and never replaces camera trials (Docs/Testing/HUMAN_TRIALS.md).
//   J / K        left / right straight      Space  block (hold)      A / D  slip left / right (hold)
//   F1 tracker<->keyboard   F2 training<->bout   F3 debug overlay   F4 tracker preview window
//   C full calibration   V quick calibration   P pause/resume   Enter rematch   1/2/3 bot level (new bout)
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/PlayerController.h"
#include "IronEchoRules/InputFrame.h"

#include "IronEchoPlayerController.generated.h"

UCLASS()
class IRONECHO_API AIronEchoPlayerController : public APlayerController
{
	GENERATED_BODY()

public:
	AIronEchoPlayerController();

	virtual void BeginPlay() override;
	virtual void PlayerTick(float DeltaTime) override;

	/** Keyboard state as an InputFrame (status Live); drains punches pressed since the last call. */
	IronEchoCore::InputFrame ConsumeKeyboardFrame();

	UFUNCTION(BlueprintPure, Category = "IronEcho")
	bool IsDebugOverlayVisible() const { return bShowDebugOverlay; }

	UFUNCTION(BlueprintCallable, Category = "IronEcho")
	void SetDebugOverlayVisible(bool bVisible) { bShowDebugOverlay = bVisible; }

private:
	int32 PendingLeft = 0;
	int32 PendingRight = 0;
	int32 PendingBodyLeft = 0;
	int32 PendingBodyRight = 0;
	float KeyboardLean = 0.0f;
	float KeyboardMoveForward = 0.0f;
	float KeyboardMoveLateral = 0.0f;
	bool bShowDebugOverlay = true;
	bool bTrackerPreview = false;
};
