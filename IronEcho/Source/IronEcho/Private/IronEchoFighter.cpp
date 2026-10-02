#include "IronEchoFighter.h"

#include "Animation/AnimInstance.h"
#include "Components/SkeletalMeshComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/SkeletalMesh.h"
#include "Engine/StaticMesh.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Materials/MaterialInterface.h"
#include "UObject/ConstructorHelpers.h"

namespace IronEchoFighterLocal
{
	// Placeholder proportions (cm). A ~2.1 m robot; Codex's robot defines the real ones.
	constexpr float PelvisHeight = 105.0f;
	constexpr float ChestHeight = 155.0f;
	constexpr float ShoulderHalfWidth = 26.0f;
	constexpr float ShoulderHeight = 165.0f;
	constexpr float HeadHeight = 192.0f;
	constexpr float UpperArmLength = 34.0f;
	constexpr float ForeArmLength = 31.0f;
	constexpr float ArmLength = UpperArmLength + ForeArmLength;
	constexpr float HipHalfWidth = 13.0f;

	const FName ColorParam(TEXT("Color"));
}

namespace IronEchoFighterLocal
{
	enum PartIndex : int32
	{
		Pelvis,
		Torso,
		Head,
		Visor,
		UpperArmL,
		ForeArmL,
		FistL,
		UpperArmR,
		ForeArmR,
		FistR,
		ThighL,
		ShinL,
		ThighR,
		ShinR,
		PartCount
	};
}


const TArray<FName>& AIronEchoFighter::RequiredBones()
{
	static const TArray<FName> Bones = {
		TEXT("root"), TEXT("pelvis"), TEXT("spine_01"), TEXT("spine_02"), TEXT("spine_03"), TEXT("neck_01"), TEXT("head"),
		TEXT("clavicle_l"), TEXT("upperarm_l"), TEXT("lowerarm_l"), TEXT("hand_l"),
		TEXT("clavicle_r"), TEXT("upperarm_r"), TEXT("lowerarm_r"), TEXT("hand_r"),
		TEXT("thigh_l"), TEXT("calf_l"), TEXT("foot_l"), TEXT("thigh_r"), TEXT("calf_r"), TEXT("foot_r")};
	return Bones;
}

const TArray<FName>& AIronEchoFighter::RequiredSockets()
{
	static const TArray<FName> Sockets = {TEXT("fist_l"), TEXT("fist_r"), TEXT("hit_head"), TEXT("hit_body")};
	return Sockets;
}

AIronEchoFighter::AIronEchoFighter()
{
	using namespace IronEchoFighterLocal;
	PrimaryActorTick.bCanEverTick = false; // driven by the game mode

	Root = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	SetRootComponent(Root);

	RobotMesh = CreateDefaultSubobject<USkeletalMeshComponent>(TEXT("RobotMesh"));
	RobotMesh->SetupAttachment(Root);
	RobotMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	RobotMesh->SetVisibility(false);

	static ConstructorHelpers::FObjectFinder<UStaticMesh> Cube(TEXT("/Engine/BasicShapes/Cube.Cube"));
	static ConstructorHelpers::FObjectFinder<UStaticMesh> Cylinder(TEXT("/Engine/BasicShapes/Cylinder.Cylinder"));
	static ConstructorHelpers::FObjectFinder<UStaticMesh> Sphere(TEXT("/Engine/BasicShapes/Sphere.Sphere"));
	CubeMesh = Cube.Object;
	CylinderMesh = Cylinder.Object;
	SphereMesh = Sphere.Object;

	static const TCHAR* PartNames[PartCount] = {
		TEXT("Pelvis"), TEXT("Torso"), TEXT("Head"), TEXT("Visor"),
		TEXT("UpperArmL"), TEXT("ForeArmL"), TEXT("FistL"), TEXT("UpperArmR"), TEXT("ForeArmR"), TEXT("FistR"),
		TEXT("ThighL"), TEXT("ShinL"), TEXT("ThighR"), TEXT("ShinR")};
	for (int32 Index = 0; Index < PartCount; ++Index)
	{
		UStaticMeshComponent* Part = CreateDefaultSubobject<UStaticMeshComponent>(PartNames[Index]);
		Part->SetupAttachment(Root);
		Part->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		Part->SetGenerateOverlapEvents(false);
		Part->SetCanEverAffectNavigation(false);
		UStaticMesh* Mesh = CylinderMesh;
		if (Index == Pelvis || Index == Torso || Index == Visor)
		{
			Mesh = CubeMesh;
		}
		else if (Index == Head || Index == FistL || Index == FistR)
		{
			Mesh = SphereMesh;
		}
		Part->SetStaticMesh(Mesh);
		Parts.Add(Part);
	}
	SmoothedHands[0] = FVector(0.45f, -0.15f, 0.25f);
	SmoothedHands[1] = FVector(0.45f, 0.15f, 0.25f);
}

void AIronEchoFighter::SetupVisuals(EIronEchoFighterRole InRole, USkeletalMesh* Mesh, UClass* AnimClass)
{
	using namespace IronEchoFighterLocal;
	Role = InRole;
	VisualState.Role = InRole;

	bUsingPlaceholder = true;
	if (Mesh != nullptr)
	{
		RobotMesh->SetSkeletalMeshAsset(Mesh);
		if (AnimClass != nullptr)
		{
			RobotMesh->SetAnimInstanceClass(AnimClass);
		}
		RobotMesh->SetVisibility(true);
		bUsingPlaceholder = false;

		for (const FName& Bone : RequiredBones())
		{
			if (RobotMesh->GetBoneIndex(Bone) == INDEX_NONE)
			{
				UE_LOG(LogIronEcho, Error, TEXT("Robot mesh %s violates ROBOT_VISUAL_CONTRACT: missing bone '%s'"), *Mesh->GetName(), *Bone.ToString());
			}
		}
		for (const FName& Socket : RequiredSockets())
		{
			if (!RobotMesh->DoesSocketExist(Socket))
			{
				UE_LOG(LogIronEcho, Warning, TEXT("Robot mesh %s: missing socket '%s' (fallback location used)"), *Mesh->GetName(), *Socket.ToString());
			}
		}
	}

	const FLinearColor Body = InRole == EIronEchoFighterRole::Player ? FLinearColor(0.10f, 0.45f, 0.95f) : FLinearColor(0.95f, 0.35f, 0.08f);
	const FLinearColor Dark(0.08f, 0.08f, 0.09f);
	const FLinearColor Glow = InRole == EIronEchoFighterRole::Player ? FLinearColor(0.2f, 1.0f, 1.0f) : FLinearColor(1.0f, 0.85f, 0.2f);
	PartMaterials.Reset();
	for (int32 Index = 0; Index < Parts.Num(); ++Index)
	{
		UStaticMeshComponent* Part = Parts[Index];
		Part->SetVisibility(bUsingPlaceholder);
		UMaterialInterface* Base = Part->GetMaterial(0);
		UMaterialInstanceDynamic* Material = Base != nullptr ? UMaterialInstanceDynamic::Create(Base, this) : nullptr;
		if (Material != nullptr)
		{
			const bool bAccent = Index == FistL || Index == FistR || Index == Torso;
			Material->SetVectorParameterValue(IronEchoFighterLocal::ColorParam, Index == Visor ? Glow : (bAccent ? Body : Dark + Body * 0.25f));
			Part->SetMaterial(0, Material);
		}
		PartMaterials.Add(Material);
	}
}

void AIronEchoFighter::ApplyVisualState(const FIronEchoFighterVisualState& State, const FTransform& WorldTransform, float DeltaSeconds)
{
	VisualState = State;
	SetActorTransform(WorldTransform);
	if (bUsingPlaceholder)
	{
		UpdatePlaceholder(DeltaSeconds);
	}
}

FVector AIronEchoFighter::GetFistLocation(EIronEchoHand Hand) const
{
	using namespace IronEchoFighterLocal;
	const FName Socket = Hand == EIronEchoHand::Left ? FName(TEXT("fist_l")) : FName(TEXT("fist_r"));
	if (!bUsingPlaceholder && RobotMesh->DoesSocketExist(Socket))
	{
		return RobotMesh->GetSocketLocation(Socket);
	}
	return Parts[Hand == EIronEchoHand::Left ? FistL : FistR]->GetComponentLocation();
}

FVector AIronEchoFighter::GetHitLocation() const
{
	using namespace IronEchoFighterLocal;
	const FName Socket(TEXT("hit_head"));
	if (!bUsingPlaceholder && RobotMesh->DoesSocketExist(Socket))
	{
		return RobotMesh->GetSocketLocation(Socket);
	}
	return Parts[Head]->GetComponentLocation();
}

FVector AIronEchoFighter::SolveElbow(const FVector& Shoulder, const FVector& Wrist, float Upper, float Fore, float SideSign) const
{
	const FVector Axis = Wrist - Shoulder;
	const float Distance = FMath::Clamp(static_cast<float>(Axis.Size()), 1.0f, Upper + Fore - 0.1f);
	const FVector Dir = Axis.GetSafeNormal();
	const float Along = (Upper * Upper - Fore * Fore + Distance * Distance) / (2.0f * Distance);
	const float Height = FMath::Sqrt(FMath::Max(Upper * Upper - Along * Along, 0.0f));
	FVector Pole = FVector(0.0f, SideSign * 0.6f, -1.0f);
	Pole = (Pole - FVector::DotProduct(Pole, Dir) * Dir).GetSafeNormal();
	return Shoulder + Dir * Along + Pole * Height;
}

void AIronEchoFighter::PlaceSegment(int32 Part, const FVector& From, const FVector& To, float Thickness)
{
	UStaticMeshComponent* Component = Parts[Part];
	const FVector Delta = To - From;
	const float Length = FMath::Max(static_cast<float>(Delta.Size()), 1.0f);
	// Engine cylinder: 100 cm tall along Z, 100 cm diameter, pivot at the centre.
	Component->SetRelativeLocation((From + To) * 0.5f);
	Component->SetRelativeRotation(FRotationMatrix::MakeFromZ(Delta.GetSafeNormal()).Rotator());
	Component->SetRelativeScale3D(FVector(Thickness / 100.0f, Thickness / 100.0f, Length / 100.0f));
}

void AIronEchoFighter::PlaceSphere(int32 Part, const FVector& Center, float Radius)
{
	UStaticMeshComponent* Component = Parts[Part];
	Component->SetRelativeLocation(Center);
	Component->SetRelativeRotation(FRotator::ZeroRotator);
	Component->SetRelativeScale3D(FVector(Radius / 50.0f));
}

void AIronEchoFighter::UpdatePlaceholder(float DeltaSeconds)
{
	using namespace IronEchoFighterLocal;
	const FIronEchoFighterVisualState& S = VisualState;
	const float Blend = 1.0f - FMath::Exp(-DeltaSeconds * 18.0f);
	SmoothedLean = FMath::Lerp(SmoothedLean, FMath::Clamp(S.LeanLateral, -1.3f, 1.3f), Blend);
	SmoothedBlock = FMath::Lerp(SmoothedBlock, S.bBlocking ? 1.0f : 0.0f, Blend);
	if (S.LastHitTakenTime > LastSeenHitTime)
	{
		LastSeenHitTime = S.LastHitTakenTime;
		HitJolt = 1.0f;
	}
	HitJolt = FMath::Max(0.0f, HitJolt - DeltaSeconds * 4.0f);

	// Torso: lateral slip (roll about the forward axis at the pelvis) + forward lean + hit jolt.
	const bool bKO = S.bKnockedOut;
	const float RollDeg = SmoothedLean * 22.0f;
	const float PitchDeg = bKO ? -35.0f : (S.LeanForward * 10.0f - HitJolt * 14.0f);
	const FRotator TorsoRot(PitchDeg, 0.0f, RollDeg);
	const FVector PelvisPos(0.0f, 0.0f, PelvisHeight);
	auto Upper = [&](const FVector& Local) { return PelvisPos + TorsoRot.RotateVector(Local - PelvisPos); };

	const FVector Chest = Upper(FVector(0.0f, 0.0f, ChestHeight));
	const FVector HeadPos = Upper(FVector(-HitJolt * 6.0f, 0.0f, HeadHeight));
	const FVector Shoulder[2] = {Upper(FVector(0.0f, -ShoulderHalfWidth, ShoulderHeight)), Upper(FVector(0.0f, ShoulderHalfWidth, ShoulderHeight))};
	const FVector ShoulderMid = (Shoulder[0] + Shoulder[1]) * 0.5f;

	Parts[Pelvis]->SetRelativeLocation(PelvisPos);
	Parts[Pelvis]->SetRelativeRotation(FRotator::ZeroRotator);
	Parts[Pelvis]->SetRelativeScale3D(FVector(0.30f, 0.40f, 0.22f));
	Parts[Torso]->SetRelativeLocation((PelvisPos + Chest) * 0.5f + FVector(0, 0, 10));
	Parts[Torso]->SetRelativeRotation(TorsoRot);
	Parts[Torso]->SetRelativeScale3D(FVector(0.34f, 0.52f, 0.62f));
	PlaceSphere(Head, HeadPos, 14.0f);
	Parts[Visor]->SetRelativeLocation(HeadPos + TorsoRot.RotateVector(FVector(11.0f, 0.0f, 2.0f)));
	Parts[Visor]->SetRelativeRotation(TorsoRot);
	Parts[Visor]->SetRelativeScale3D(FVector(0.06f, 0.20f, 0.05f));

	// Arms: tracked hands in guard/block, game-processed extension during the robot's own attack.
	const FVector Tracked[2] = {S.HandTargetLeft, S.HandTargetRight};
	const float TrackAlpha[2] = {S.HandTrackingAlphaLeft, S.HandTrackingAlphaRight};
	for (int32 Side = 0; Side < 2; ++Side)
	{
		const float SideSign = Side == 0 ? -1.0f : 1.0f;
		SmoothedHands[Side] = FMath::Lerp(SmoothedHands[Side], Tracked[Side], Blend);
		const FVector GuardLocal = FVector(0.45f, SideSign * 0.15f, 0.25f);
		const FVector BlockLocal = FVector(0.32f, SideSign * 0.10f, 0.62f);
		FVector Target = FMath::Lerp(GuardLocal, SmoothedHands[Side], TrackAlpha[Side]);
		Target = FMath::Lerp(Target, BlockLocal, SmoothedBlock * (1.0f - TrackAlpha[Side] * 0.5f));

		const bool bAttacking = S.ActionState == EIronEchoActionState::Attack && static_cast<int32>(S.AttackHand) == Side;
		if (bAttacking)
		{
			float Extend = 0.0f;
			switch (S.AttackStage)
			{
			case EIronEchoAttackStage::Windup: Extend = -0.15f * S.AttackStageAlpha; break;
			case EIronEchoAttackStage::Active: Extend = 1.0f; break;
			case EIronEchoAttackStage::Recovery: Extend = 1.0f - S.AttackStageAlpha; break;
			default: break;
			}
			const FVector Punch = FVector(0.98f, -SideSign * 0.10f, 0.15f);
			Target = Extend >= 0.0f ? FMath::Lerp(GuardLocal, Punch, Extend) : GuardLocal + FVector(Extend * 0.5f, 0.0f, 0.0f);
		}
		if (bKO)
		{
			Target = FVector(0.15f, SideSign * 0.35f, -0.8f);
		}
		const FVector Wrist = ShoulderMid + Target * ArmLength + FVector(0.0f, SideSign * ShoulderHalfWidth * 0.3f, 0.0f);
		const FVector Elbow = SolveElbow(Shoulder[Side], Wrist, UpperArmLength, ForeArmLength, SideSign);
		PlaceSegment(Side == 0 ? UpperArmL : UpperArmR, Shoulder[Side], Elbow, 11.0f);
		PlaceSegment(Side == 0 ? ForeArmL : ForeArmR, Elbow, Wrist, 10.0f);
		PlaceSphere(Side == 0 ? FistL : FistR, Wrist + (Wrist - Elbow).GetSafeNormal() * 6.0f, 9.0f);
	}

	// Legs (static stance).
	for (int32 Side = 0; Side < 2; ++Side)
	{
		const float SideSign = Side == 0 ? -1.0f : 1.0f;
		const FVector Hip(0.0f, SideSign * HipHalfWidth, PelvisHeight - 8.0f);
		const FVector Knee(6.0f, SideSign * (HipHalfWidth + 3.0f), 55.0f);
		const FVector Foot(0.0f, SideSign * (HipHalfWidth + 5.0f), 6.0f);
		PlaceSegment(Side == 0 ? ThighL : ThighR, Hip, Knee, 15.0f);
		PlaceSegment(Side == 0 ? ShinL : ShinR, Knee, Foot, 13.0f);
	}
}
