#pragma once
#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "IEVisualTypes.h"
#include "IEContactPolicy.h"
#include "IEVisualCameraRig.generated.h"

class UCameraComponent;
class USpringArmComponent;

UCLASS(BlueprintType)
class IRONECHOVISUALS_API AIEVisualCameraRig : public AActor
{
    GENERATED_BODY()
public:
    AIEVisualCameraRig();
    UFUNCTION(BlueprintCallable) void FollowRobot(AActor* Robot, AActor* Opponent);
    UFUNCTION(BlueprintCallable) void SetReducedMotion(bool bReduce);
    UFUNCTION(BlueprintCallable) bool ApplyConfirmedImpact(const FIEConfirmedImpact& Event);
    UFUNCTION(BlueprintCallable, meta=(DeprecatedFunction, DeprecationMessage="Use ApplyConfirmedImpact with a gameplay EventId."))
    void ApplyConfirmedContactKick(float VisualIntensity);
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Visual Camera") float FollowSpeed=8.f;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Visual Camera") float ShakeScale=0.5f;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Visual Camera") FVector FollowOffset=FVector(0.f,0.f,160.f);
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Visual Camera") FVector OpponentAimOffset=FVector(0.f,0.f,155.f);
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly) TObjectPtr<USpringArmComponent> CameraArm;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly) TObjectPtr<UCameraComponent> Camera;
    virtual void Tick(float DeltaSeconds) override;
private:
    UPROPERTY(Transient) TWeakObjectPtr<AActor> FollowTarget;
    UPROPERTY(Transient) TWeakObjectPtr<AActor> LookTarget;
    bool bReducedMotion=false;
    bool bFirstFollow=true;
    IronEchoPresentation::FCameraPulse ContactPulse;
    IronEchoPresentation::FEventHistory ContactHistory;
};
