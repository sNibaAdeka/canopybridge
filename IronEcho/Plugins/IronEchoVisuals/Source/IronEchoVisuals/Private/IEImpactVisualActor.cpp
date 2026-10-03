#include "IEImpactVisualActor.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Engine/StaticMesh.h"
#include "Materials/MaterialInterface.h"
#include "UObject/ConstructorHelpers.h"

AIEImpactVisualActor::AIEImpactVisualActor()
{
    PrimaryActorTick.bCanEverTick=true;
    PrimaryActorTick.bStartWithTickEnabled=false;
    Sparks=CreateDefaultSubobject<UInstancedStaticMeshComponent>(TEXT("CosmeticSparks"));
    SetRootComponent(Sparks);
    Sparks->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    Sparks->SetGenerateOverlapEvents(false);
    Sparks->SetCanEverAffectNavigation(false);
    Sparks->SetCastShadow(false);
    static ConstructorHelpers::FObjectFinder<UStaticMesh> Cube(TEXT("/Engine/BasicShapes/Cube.Cube"));
    if (Cube.Succeeded()) Sparks->SetStaticMesh(Cube.Object);
}

void AIEImpactVisualActor::BeginPlay()
{
    Super::BeginPlay();
    if (SparkMaterial) Sparks->SetMaterial(0,SparkMaterial);
    Pool.SetNum(48);
    for (int32 I=0; I<Pool.Num(); ++I) Sparks->AddInstance(FTransform(FQuat::Identity,FVector::ZeroVector,FVector::ZeroVector),true);
}

bool AIEImpactVisualActor::ShowConfirmedImpact(const FIEConfirmedImpact& Event)
{
    const FVector P=Event.WorldPosition;
    const bool Finite=FMath::IsFinite(P.X)&&FMath::IsFinite(P.Y)&&FMath::IsFinite(P.Z)
        && FMath::IsFinite(Event.VisualIntensity) && FMath::IsFinite(Event.WorldNormal.X)
        && FMath::IsFinite(Event.WorldNormal.Y) && FMath::IsFinite(Event.WorldNormal.Z);
    if (!Event.EventId.IsValid() || Seen.Contains(Event.EventId) || !Finite || Pool.IsEmpty() || !SparkMaterial) return false;
    Seen.Add(Event.EventId); SeenOrder.Add(Event.EventId);
    if (SeenOrder.Num()>512) { Seen.Remove(SeenOrder[0]); SeenOrder.RemoveAt(0); }
    FRandomStream Random(GetTypeHash(Event.EventId));
    const float Intensity=FMath::Clamp(Event.VisualIntensity,0.f,1.f);
    const int32 Count=bReducedMotion ? 2 : FMath::Clamp(FMath::RoundToInt(Intensity*8.f),2,8);
    FVector Normal=Event.WorldNormal.GetSafeNormal();
    if (Normal.IsNearlyZero()) Normal=FVector::UpVector;
    for (int32 I=0; I<Count; ++I)
    {
        FSpark& Spark=Pool[Cursor];
        Spark.Position=Event.WorldPosition;
        Spark.Velocity=Random.VRandCone(Normal,0.85f)*Random.FRandRange(120.f,260.f);
        Spark.Life=bReducedMotion ? .08f : Random.FRandRange(.15f,.28f);
        Cursor=(Cursor+1)%Pool.Num();
    }
    SetActorTickEnabled(true);
    return true;
}

void AIEImpactVisualActor::Tick(float Delta)
{
    Super::Tick(Delta);
    bool Active=false;
    const float Step=FMath::Clamp(Delta,0.f,0.05f);
    for (int32 I=0; I<Pool.Num(); ++I)
    {
        FSpark& Spark=Pool[I];
        Spark.Life=FMath::Max(0.f,Spark.Life-Delta);
        FTransform Transform(FQuat::Identity,FVector::ZeroVector,FVector::ZeroVector);
        if (Spark.Life>0.f)
        {
            Active=true;
            Spark.Velocity.Z-=640.f*Step;
            Spark.Position+=Spark.Velocity*Step;
            const float Fade=FMath::Clamp(Spark.Life/.12f,0.f,1.f);
            Transform=FTransform(Spark.Velocity.Rotation(),Spark.Position,FVector(.06f,.005f,.005f)*Fade);
        }
        Sparks->UpdateInstanceTransform(I,Transform,true,false,true);
    }
    Sparks->MarkRenderStateDirty();
    SetActorTickEnabled(Active);
}

void AIEImpactVisualActor::ClearSparks()
{
    for (int32 I=0; I<Pool.Num(); ++I)
    {
        Pool[I].Life=0.f;
        Sparks->UpdateInstanceTransform(I,FTransform(FQuat::Identity,FVector::ZeroVector,FVector::ZeroVector),true,false,true);
    }
    Sparks->MarkRenderStateDirty();
    SetActorTickEnabled(false);
}
void AIEImpactVisualActor::SetReducedMotion(bool Reduce)
{
    bReducedMotion=Reduce;
    if (Reduce) ClearSparks();
}
