#pragma once
#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "IEVisualTypes.h"
#include "IEContactPolicy.h"
#include "IEContactFeedbackComponent.generated.h"

class AIEVisualCameraRig;
class AIEImpactVisualActor;

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FIEImpactPresentationAccepted, const FIEConfirmedImpact&, Event);

// Game-thread entry point for one local presentation recipient's confirmed hits.
UCLASS(ClassGroup=(IronEcho), meta=(BlueprintSpawnableComponent))
class IRONECHOVISUALS_API UIEContactFeedbackComponent : public UActorComponent
{
    GENERATED_BODY()
public:
    UIEContactFeedbackComponent();
    UFUNCTION(BlueprintCallable, Category="IRON ECHO|Presentation")
    void ConfigureTargets(AIEVisualCameraRig* CameraRig, AIEImpactVisualActor* ImpactActor);
    // True means accepted once, not proof that a material or reaction clip rendered.
    UFUNCTION(BlueprintCallable, Category="IRON ECHO|Presentation")
    bool ApplyConfirmedImpact(const FIEConfirmedImpact& Event);
    UFUNCTION(BlueprintCallable, Category="IRON ECHO|Presentation") void SetReducedMotion(bool bReduce);
    UFUNCTION(BlueprintCallable, Category="IRON ECHO|Presentation") void ResetPresentationSession();
    // Copy on the game thread into AnimInstance data; do not call from a worker AnimGraph.
    UFUNCTION(BlueprintPure, Category="IRON ECHO|Presentation") float GetReactionPlayRate() const;
    UPROPERTY(BlueprintAssignable, Category="IRON ECHO|Presentation") FIEImpactPresentationAccepted OnImpactAccepted;
protected:
    virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;
private:
    UPROPERTY(Transient) TWeakObjectPtr<AIEVisualCameraRig> CameraTarget;
    UPROPERTY(Transient) TWeakObjectPtr<AIEImpactVisualActor> ImpactTarget;
    IronEchoPresentation::FReactionHold ReactionHold;
    bool bReducedMotion=false;
};
