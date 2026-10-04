#pragma once

#include "CoreMinimal.h"
#include "IEVisualCameraRig.h"
#include "IronEchoTypes.h"
#include "IEContractCameraRig.generated.h"

class AIronEchoGameState;
class AIEImpactVisualActor;
class UIEContactFeedbackComponent;
class UMaterialInterface;

// ROBOT_VISUAL_CONTRACT 1.1: game mode spawns this via GameCameraClass.
// This actor observes gameplay; it never steps rules or changes fighter clocks.
UCLASS(BlueprintType)
class IRONECHOCONTRACTVISUALS_API AIEContractCameraRig : public AIEVisualCameraRig
{
    GENERATED_BODY()
public:
    AIEContractCameraRig();
    virtual void Tick(float DeltaSeconds) override;
    UFUNCTION(BlueprintCallable, Category="IRON ECHO|Presentation")
    void SetPresentationReducedMotion(bool bReduce);
    // Read on the game thread for a cosmetic-only reaction clip, never the attack graph.
    UFUNCTION(BlueprintPure, Category="IRON ECHO|Presentation")
    float GetDefenderReactionPlayRate(EIronEchoFighterRole Role) const;
    UPROPERTY(EditAnywhere, Category="IRON ECHO|Presentation")
    TSoftObjectPtr<UMaterialInterface> ImpactMaterial;
protected:
    virtual void BeginPlay() override;
    virtual void EndPlay(const EEndPlayReason::Type Reason) override;
private:
    void RefreshGameplayBinding();
    void RefreshFollowTargets();
    UFUNCTION() void HandleCombatEvent(const FIronEchoCombatEvent& Event);
    UPROPERTY(Transient) TWeakObjectPtr<AIronEchoGameState> BoundState;
    UPROPERTY(Transient) TWeakObjectPtr<AActor> BoundPlayer;
    UPROPERTY(Transient) TWeakObjectPtr<AActor> BoundLook;
    UPROPERTY(Transient) TObjectPtr<AIEImpactVisualActor> ImpactActor;
    UPROPERTY(VisibleAnywhere) TObjectPtr<UIEContactFeedbackComponent> PlayerFeedback;
    UPROPERTY(VisibleAnywhere) TObjectPtr<UIEContactFeedbackComponent> OpponentFeedback;
    uint32 SessionSalt = 1;
    bool bPresentationReducedMotion = false;
};
