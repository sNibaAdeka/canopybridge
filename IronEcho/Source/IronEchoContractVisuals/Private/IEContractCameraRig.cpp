#include "IEContractCameraRig.h"

#include "Engine/World.h"
#include "IEContactFeedbackComponent.h"
#include "IEImpactVisualActor.h"
#include "IronEchoFighter.h"
#include "IronEchoGameState.h"
#include "IronEchoPunchingBag.h"
#include "Materials/MaterialInterface.h"

AIEContractCameraRig::AIEContractCameraRig()
{
    PlayerFeedback = CreateDefaultSubobject<UIEContactFeedbackComponent>(TEXT("PlayerContactFeedback"));
    OpponentFeedback = CreateDefaultSubobject<UIEContactFeedbackComponent>(TEXT("OpponentContactFeedback"));
    ImpactMaterial = TSoftObjectPtr<UMaterialInterface>(FSoftObjectPath(
        TEXT("/Game/Art/IronEcho/Materials/M_IE_ImpactSparks.M_IE_ImpactSparks")));
}

void AIEContractCameraRig::BeginPlay()
{
    Super::BeginPlay();
    SessionSalt = FGuid::NewGuid().A;
    if (SessionSalt == 0) SessionSalt = 1;
    UWorld* World = GetWorld();
    if (World)
    {
        ImpactActor = World->SpawnActorDeferred<AIEImpactVisualActor>(
            AIEImpactVisualActor::StaticClass(), FTransform::Identity, this, nullptr,
            ESpawnActorCollisionHandlingMethod::AlwaysSpawn);
        if (ImpactActor)
        {
            ImpactActor->SparkMaterial = ImpactMaterial.LoadSynchronous();
            ImpactActor->FinishSpawning(FTransform::Identity);
            ImpactActor->SetReducedMotion(bPresentationReducedMotion);
            if (!ImpactActor->SparkMaterial)
                UE_LOG(LogIronEcho, Warning, TEXT("Codex: impact material absent; sparks disabled."));
        }
    }
    PlayerFeedback->ConfigureTargets(this, ImpactActor);
    OpponentFeedback->ConfigureTargets(this, ImpactActor);
    RefreshGameplayBinding();
}

void AIEContractCameraRig::RefreshGameplayBinding()
{
    AIronEchoGameState* State = GetWorld() ? GetWorld()->GetGameState<AIronEchoGameState>() : nullptr;
    if (State == BoundState.Get()) return;
    if (AIronEchoGameState* Previous = BoundState.Get())
        Previous->OnCombatEvent.RemoveDynamic(this, &AIEContractCameraRig::HandleCombatEvent);
    BoundState.Reset();
    PlayerFeedback->ResetPresentationSession();
    OpponentFeedback->ResetPresentationSession();
    if (IsValid(State) && State->GetVisualContractVersion() == 1)
    {
        BoundState = State;
        State->OnCombatEvent.AddUniqueDynamic(this, &AIEContractCameraRig::HandleCombatEvent);
    }
}

void AIEContractCameraRig::RefreshFollowTargets()
{
    AIronEchoGameState* State = BoundState.Get();
    AIronEchoFighter* Player = State ? State->GetFighter(EIronEchoFighterRole::Player) : nullptr;
    AIronEchoFighter* Opponent = State ? State->GetFighter(EIronEchoFighterRole::Opponent) : nullptr;
    AIronEchoPunchingBag* Bag = State ? State->GetPunchingBag() : nullptr;
    const bool bTraining = State && State->GetHudState().Mode == EIronEchoMatchMode::Training;
    AActor* Look = bTraining ? static_cast<AActor*>(Bag) : static_cast<AActor*>(Opponent);
    // FollowRobot resets interpolation/pulse: call it only when identities change.
    if (BoundPlayer.Get() != Player || BoundLook.Get() != Look)
    {
        // Sample player height once; a hit reaction must not shake the camera anchor.
        if (IsValid(Player))
            FollowOffset = Player->GetActorTransform().InverseTransformPosition(Player->GetHitLocation()) - FVector(0, 0, 25);
        FollowRobot(Player, Look);
        BoundPlayer = Player;
        BoundLook = Look;
    }
    if (IsValid(Look))
    {
        const FVector Aim = bTraining && IsValid(Bag) ? Bag->GetHitLocation() :
            (IsValid(Opponent) ? Opponent->GetHitLocation() : Look->GetActorLocation());
        OpponentAimOffset = Look->GetActorTransform().InverseTransformPosition(Aim);
    }
}

void AIEContractCameraRig::Tick(float DeltaSeconds)
{
    RefreshGameplayBinding();
    RefreshFollowTargets();
    Super::Tick(DeltaSeconds);
}

void AIEContractCameraRig::HandleCombatEvent(const FIronEchoCombatEvent& Event)
{
    const bool bHit = Event.Type == EIronEchoCombatEventType::HitConfirmed;
    // CombatSim emits GuardBroken followed by HitConfirmed. Render the latter once.
    const bool bBlock = Event.Type == EIronEchoCombatEventType::Blocked;
    if ((!bHit && !bBlock) || !FMath::IsFinite(Event.WorldTime) || Event.WorldTime < 0.f) return;
    uint32 TimeBits = 0;
    static_assert(sizeof(TimeBits) == sizeof(Event.WorldTime));
    FMemory::Memcpy(&TimeBits, &Event.WorldTime, sizeof(TimeBits));
    const uint32 Roles = 1u | (static_cast<uint32>(Event.Actor) << 8) |
        (static_cast<uint32>(Event.Target) << 16) | (static_cast<uint32>(Event.Hand) << 24);
    FIEConfirmedImpact Impact;
    // No new gameplay IDs: one presentation identity per attack/contact/frame.
    // Include roles (both fighters can have AttackId 1), time (rematches reset IDs),
    // and session salt (world reload). GuardBroken is handled by its following HitConfirmed.
    Impact.EventId = FGuid(SessionSalt, static_cast<uint32>(Event.AttackId), TimeBits, Roles);
    Impact.WorldPosition = Event.ImpactLocation;
    Impact.WorldNormal = -Event.ImpactDirection;
    // Cosmetic tuning only; damage is never recomputed here.
    Impact.VisualIntensity = bHit ? (Event.bCounterHit ? 0.9f : 0.65f) : 0.3f;
    const bool bBag = BoundState.IsValid() && BoundState->GetHudState().Mode == EIronEchoMatchMode::Training
        && Event.Target == EIronEchoFighterRole::Opponent;
    if (bBag)
    {
        // The bag is padded: no metal sparks and no defender reaction hold.
        ApplyConfirmedImpact(Impact);
        return;
    }
    UIEContactFeedbackComponent* Recipient = Event.Target == EIronEchoFighterRole::Player ? PlayerFeedback.Get() : OpponentFeedback.Get();
    Recipient->ApplyConfirmedImpact(Impact);
}

void AIEContractCameraRig::SetPresentationReducedMotion(bool bReduce)
{
    bPresentationReducedMotion = bReduce;
    SetReducedMotion(bReduce);
    PlayerFeedback->SetReducedMotion(bReduce);
    OpponentFeedback->SetReducedMotion(bReduce);
    if (ImpactActor) ImpactActor->SetReducedMotion(bReduce);
}

float AIEContractCameraRig::GetDefenderReactionPlayRate(EIronEchoFighterRole Role) const
{
    return Role == EIronEchoFighterRole::Player ? PlayerFeedback->GetReactionPlayRate() : OpponentFeedback->GetReactionPlayRate();
}

void AIEContractCameraRig::EndPlay(const EEndPlayReason::Type Reason)
{
    if (AIronEchoGameState* State = BoundState.Get())
        State->OnCombatEvent.RemoveDynamic(this, &AIEContractCameraRig::HandleCombatEvent);
    FollowRobot(nullptr, nullptr);
    if (IsValid(ImpactActor)) ImpactActor->Destroy();
    Super::EndPlay(Reason);
}
