#include "IEContactFeedbackComponent.h"
#include "IEImpactValidation.h"
#include "IEImpactVisualActor.h"
#include "IEVisualCameraRig.h"
#include "HAL/PlatformTime.h"

UIEContactFeedbackComponent::UIEContactFeedbackComponent()
{ PrimaryComponentTick.bCanEverTick=false; bAutoActivate=true; }

void UIEContactFeedbackComponent::ConfigureTargets(AIEVisualCameraRig* Rig,AIEImpactVisualActor* Actor)
{
    CameraTarget=Rig;
    ImpactTarget=Actor;
    if (IsValid(Rig)) Rig->SetReducedMotion(bReducedMotion);
    if (IsValid(Actor)) Actor->SetReducedMotion(bReducedMotion);
}

bool UIEContactFeedbackComponent::ApplyConfirmedImpact(const FIEConfirmedImpact& Event)
{
    if (!IsInGameThread() || !HasBegunPlay() || !IsActive() || !IEIsUsableImpact(Event)) return false;
    const float Intensity=FMath::Clamp(Event.VisualIntensity,0.f,1.f);
    if (!ReactionHold.Accept(IEImpactKey(Event.EventId),Intensity,FPlatformTime::Seconds())) return false;
    FIEConfirmedImpact Presentation=Event;
    Presentation.VisualIntensity=Intensity;
    if (Intensity>0.f)
    {
        if (AIEVisualCameraRig* Rig=CameraTarget.Get(); IsValid(Rig)) Rig->ApplyConfirmedImpact(Presentation);
        if (AIEImpactVisualActor* Actor=ImpactTarget.Get(); IsValid(Actor)) Actor->ShowConfirmedImpact(Presentation);
    }
    OnImpactAccepted.Broadcast(Presentation);
    return true;
}

float UIEContactFeedbackComponent::GetReactionPlayRate() const
{
    if (!IsInGameThread() || !HasBegunPlay() || !IsActive()) return 1.f;
    return ReactionHold.PlayRate(FPlatformTime::Seconds());
}

void UIEContactFeedbackComponent::SetReducedMotion(bool Reduce)
{
    bReducedMotion=Reduce;
    ReactionHold.SetReducedMotion(Reduce);
    if (AIEVisualCameraRig* Rig=CameraTarget.Get(); IsValid(Rig)) Rig->SetReducedMotion(Reduce);
    if (AIEImpactVisualActor* Actor=ImpactTarget.Get(); IsValid(Actor)) Actor->SetReducedMotion(Reduce);
}

void UIEContactFeedbackComponent::ResetPresentationSession()
{ ReactionHold.Reset(); }

void UIEContactFeedbackComponent::EndPlay(const EEndPlayReason::Type Reason)
{
    ReactionHold.Reset();
    CameraTarget.Reset(); ImpactTarget.Reset();
    OnImpactAccepted.Clear();
    Super::EndPlay(Reason);
}
