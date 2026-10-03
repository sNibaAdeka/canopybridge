#pragma once

#include "CoreMinimal.h"
#include "IEVisualTypes.generated.h"

// Presentation API proposal, not a second MediaPipe or combat protocol.
UENUM(BlueprintType)
enum class EIEVisualAction : uint8
{
    StartMatch, OpenCalibration, OpenSettings, ExitRequested, CloseRequested
};

UENUM(BlueprintType)
enum class EIETrackingPresentation : uint8
{
    Unknown, Ready, Degraded, Lost, Paused
};

USTRUCT(BlueprintType)
struct IRONECHOVISUALS_API FIEHUDSnapshot
{
    GENERATED_BODY()
    UPROPERTY(EditAnywhere, BlueprintReadWrite) FText PlayerName;
    UPROPERTY(EditAnywhere, BlueprintReadWrite) FText OpponentName;
    UPROPERTY(EditAnywhere, BlueprintReadWrite) float PlayerHealth = 0.f;
    UPROPERTY(EditAnywhere, BlueprintReadWrite) float PlayerMaxHealth = 0.f;
    UPROPERTY(EditAnywhere, BlueprintReadWrite) float OpponentHealth = 0.f;
    UPROPERTY(EditAnywhere, BlueprintReadWrite) float OpponentMaxHealth = 0.f;
    UPROPERTY(EditAnywhere, BlueprintReadWrite) float PlayerStamina = 0.f;
    UPROPERTY(EditAnywhere, BlueprintReadWrite) float PlayerMaxStamina = 0.f;
    UPROPERTY(EditAnywhere, BlueprintReadWrite) float SecondsRemaining = 0.f;
    UPROPERTY(EditAnywhere, BlueprintReadWrite) int32 Round = 0;
    UPROPERTY(EditAnywhere, BlueprintReadWrite) int32 TotalRounds = 0;
    UPROPERTY(EditAnywhere, BlueprintReadWrite) EIETrackingPresentation Tracking = EIETrackingPresentation::Unknown;
};

USTRUCT(BlueprintType)
struct IRONECHOVISUALS_API FIEConfirmedImpact
{
    GENERATED_BODY()
    UPROPERTY(EditAnywhere, BlueprintReadWrite) FGuid EventId;
    UPROPERTY(EditAnywhere, BlueprintReadWrite) FVector WorldPosition = FVector::ZeroVector;
    UPROPERTY(EditAnywhere, BlueprintReadWrite) FVector WorldNormal = FVector::UpVector;
    UPROPERTY(EditAnywhere, BlueprintReadWrite) float VisualIntensity = 1.f;
    // Gameplay supplies this event only AFTER its authoritative contact decision.
    // The visual actor does not calculate damage, expose health or send attacks.
};

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FIEVisualActionRequested, EIEVisualAction, Action);
