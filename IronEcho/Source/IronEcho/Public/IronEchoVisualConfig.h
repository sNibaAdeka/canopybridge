// Data asset owned by Codex: /Game/Art/Config/DA_IronEchoVisuals (path set in UIronEchoSettings::VisualConfig).
// Gameplay only reads it; every field is optional and has a technical fallback.
#pragma once

#include "CoreMinimal.h"
#include "Engine/DataAsset.h"

#include "IronEchoVisualConfig.generated.h"

class AActor;
class UAnimInstance;
class USkeletalMesh;
class UStaticMesh;
class UUserWidget;

UCLASS(BlueprintType)
class IRONECHO_API UIronEchoVisualConfig : public UPrimaryDataAsset
{
	GENERATED_BODY()

public:
	/** Player robot. Requirements: ROBOT_VISUAL_CONTRACT.md (bones, sockets, scale, facing +X). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Robots") TSoftObjectPtr<USkeletalMesh> PlayerRobotMesh;
	/** Opponent robot; falls back to PlayerRobotMesh. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Robots") TSoftObjectPtr<USkeletalMesh> OpponentRobotMesh;
	/** Must derive from UIronEchoRobotAnimInstance. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Robots") TSoftClassPtr<UAnimInstance> RobotAnimClass;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Training") TSoftObjectPtr<UStaticMesh> PunchingBagMesh;

	/** Actor with a UCameraComponent; the game mode makes it the view target. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Presentation") TSoftClassPtr<AActor> GameCameraClass;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Presentation") TSoftClassPtr<UUserWidget> HudWidgetClass;
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Presentation") TSoftClassPtr<UUserWidget> MenuWidgetClass;
	/** Hides the C++ debug overlay when Codex's HUD is present (F3 still toggles it). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Presentation") bool bHideDebugOverlay = true;

	virtual FPrimaryAssetId GetPrimaryAssetId() const override
	{
		return FPrimaryAssetId(TEXT("IronEchoVisualConfig"), GetFName());
	}
};
