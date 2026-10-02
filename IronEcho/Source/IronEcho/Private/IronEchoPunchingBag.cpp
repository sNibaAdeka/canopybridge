#include "IronEchoPunchingBag.h"

#include "Components/StaticMeshComponent.h"
#include "Engine/StaticMesh.h"
#include "UObject/ConstructorHelpers.h"

namespace IronEchoBagLocal
{
	constexpr float PivotHeight = 260.0f;   // cm, ceiling attachment
	constexpr float ChainLength = 45.0f;
	constexpr float BagLength = 115.0f;
	constexpr float BagDiameter = 42.0f;
	constexpr float Omega = 2.0f * UE_PI * 0.75f; // rad/s pendulum
	constexpr float Damping = 2.2f;
}

AIronEchoPunchingBag::AIronEchoPunchingBag()
{
	using namespace IronEchoBagLocal;
	PrimaryActorTick.bCanEverTick = false;
	SetRootComponent(CreateDefaultSubobject<USceneComponent>(TEXT("Root")));
	Pivot = CreateDefaultSubobject<USceneComponent>(TEXT("Pivot"));
	Pivot->SetupAttachment(GetRootComponent());
	Pivot->SetRelativeLocation(FVector(0.0f, 0.0f, PivotHeight));

	static ConstructorHelpers::FObjectFinder<UStaticMesh> Cylinder(TEXT("/Engine/BasicShapes/Cylinder.Cylinder"));
	Chain = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Chain"));
	Chain->SetupAttachment(Pivot);
	Chain->SetStaticMesh(Cylinder.Object);
	Chain->SetRelativeLocation(FVector(0.0f, 0.0f, -ChainLength * 0.5f));
	Chain->SetRelativeScale3D(FVector(0.03f, 0.03f, ChainLength / 100.0f));
	Chain->SetCollisionEnabled(ECollisionEnabled::NoCollision);

	Bag = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Bag"));
	Bag->SetupAttachment(Pivot);
	Bag->SetStaticMesh(Cylinder.Object);
	Bag->SetRelativeLocation(FVector(0.0f, 0.0f, -ChainLength - BagLength * 0.5f));
	Bag->SetRelativeScale3D(FVector(BagDiameter / 100.0f, BagDiameter / 100.0f, BagLength / 100.0f));
	Bag->SetCollisionEnabled(ECollisionEnabled::NoCollision);
}

void AIronEchoPunchingBag::SetBagMesh(UStaticMesh* Mesh)
{
	if (Mesh != nullptr)
	{
		// Codex's bag: pivot at the top attachment point, hanging along -Z (ROBOT_VISUAL_CONTRACT.md).
		Bag->SetStaticMesh(Mesh);
		Bag->SetRelativeLocation(FVector::ZeroVector);
		Bag->SetRelativeScale3D(FVector::OneVector);
		Chain->SetVisibility(false);
	}
}

void AIronEchoPunchingBag::OnConfirmedHit(EIronEchoHand Hand, float Strength)
{
	++ConfirmedHits;
	SwingVelocity += 55.0f + 40.0f * FMath::Clamp(Strength, 0.0f, 1.0f);
	TwistVelocity += (Hand == EIronEchoHand::Left ? 1.0f : -1.0f) * 60.0f;
}

FVector AIronEchoPunchingBag::GetHitLocation() const
{
	return Bag->GetComponentLocation();
}

void AIronEchoPunchingBag::UpdateBag(const FTransform& WorldTransform, float DeltaSeconds)
{
	using namespace IronEchoBagLocal;
	SetActorTransform(WorldTransform);
	const float Dt = FMath::Min(DeltaSeconds, 0.05f);
	SwingVelocity += (-Omega * Omega * SwingAngle - Damping * SwingVelocity) * Dt;
	SwingAngle += SwingVelocity * Dt;
	TwistVelocity += (-9.0f * Twist - 2.5f * TwistVelocity) * Dt;
	Twist += TwistVelocity * Dt;
	// The bag uses the opponent transform (local +X faces the player); hits push it toward local -X.
	Pivot->SetRelativeRotation(FRotator(-SwingAngle, Twist, 0.0f));
}
