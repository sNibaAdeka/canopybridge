#include "IEVisualCameraRig.h"
#include "Camera/CameraComponent.h"
#include "Components/SceneComponent.h"
#include "GameFramework/SpringArmComponent.h"
#include "IEImpactValidation.h"
#include "HAL/PlatformTime.h"

AIEVisualCameraRig::AIEVisualCameraRig()
{
    PrimaryActorTick.bCanEverTick=true;
    PrimaryActorTick.bTickEvenWhenPaused=true;
    PrimaryActorTick.TickGroup=TG_PostPhysics;
    SetRootComponent(CreateDefaultSubobject<USceneComponent>(TEXT("VisualRoot")));
    CameraArm=CreateDefaultSubobject<USpringArmComponent>(TEXT("ShoulderArm"));
    CameraArm->SetupAttachment(GetRootComponent());
    CameraArm->TargetArmLength=320.f;
    CameraArm->SocketOffset=FVector(0.f,65.f,0.f);
    CameraArm->bDoCollisionTest=true;
    CameraArm->ProbeSize=12.f;
    CameraArm->ProbeChannel=ECC_Camera;
    CameraArm->bEnableCameraLag=false;
    CameraArm->PrimaryComponentTick.TickGroup=TG_PostPhysics;
    CameraArm->AddTickPrerequisiteActor(this);
    Camera=CreateDefaultSubobject<UCameraComponent>(TEXT("Camera"));
    Camera->SetupAttachment(CameraArm,USpringArmComponent::SocketName);
    Camera->FieldOfView=75.f;
}

void AIEVisualCameraRig::FollowRobot(AActor* Robot,AActor* Opponent)
{
    if (AActor* Previous=FollowTarget.Get(); IsValid(Previous)) RemoveTickPrerequisiteActor(Previous);
    FollowTarget=Robot==this ? nullptr : Robot;
    LookTarget=Opponent==this ? nullptr : Opponent;
    bFirstFollow=true;
    if (IsValid(Robot) && Robot!=this) AddTickPrerequisiteActor(Robot);
    ContactPulse.Reset();
    Camera->SetRelativeLocation(FVector::ZeroVector);
}
void AIEVisualCameraRig::SetReducedMotion(bool Reduce)
{
    bReducedMotion=Reduce;
    if (Reduce) { ContactPulse.Reset(); Camera->SetRelativeLocation(FVector::ZeroVector); }
}
bool AIEVisualCameraRig::ApplyConfirmedImpact(const FIEConfirmedImpact& Event)
{
    if (!IsInGameThread() || !IEIsUsableImpact(Event) || !ContactHistory.Accept(IEImpactKey(Event.EventId))) return false;
    ApplyConfirmedContactKick(Event.VisualIntensity);
    return true;
}
void AIEVisualCameraRig::ApplyConfirmedContactKick(float Intensity)
{
    if (bReducedMotion || !FMath::IsFinite(Intensity)) return;
    ContactPulse.Start(Intensity,ShakeScale,FPlatformTime::Seconds());
}
void AIEVisualCameraRig::Tick(float Delta)
{
    Super::Tick(Delta);
    AActor* Robot=FollowTarget.Get();
    if (!IsValid(Robot))
    { ContactPulse.Reset(); bFirstFollow=true; Camera->SetRelativeLocation(FVector::ZeroVector); return; }
    const FVector Anchor=Robot->GetActorTransform().TransformPosition(FollowOffset);
    FRotator Facing=Robot->GetActorRotation();
    if (AActor* Opponent=LookTarget.Get(); IsValid(Opponent))
        Facing=(Opponent->GetActorTransform().TransformPosition(OpponentAimOffset)-Anchor).Rotation();
    Facing.Roll=0.f;
    Facing.Pitch=FMath::Clamp(Facing.Pitch,-20.0,15.0);
    const float Speed=FMath::IsFinite(FollowSpeed) ? FMath::Max(1.f,FollowSpeed) : 8.f;
    SetActorLocation(bFirstFollow ? Anchor : FMath::VInterpTo(GetActorLocation(),Anchor,Delta,Speed));
    SetActorRotation(bFirstFollow ? Facing : FMath::RInterpTo(GetActorRotation(),Facing,Delta,Speed));
    bFirstFollow=false;
    Camera->SetRelativeLocation(FVector(0.f,0.f,bReducedMotion ? 0.0 : ContactPulse.OffsetCm(FPlatformTime::Seconds())));
}
