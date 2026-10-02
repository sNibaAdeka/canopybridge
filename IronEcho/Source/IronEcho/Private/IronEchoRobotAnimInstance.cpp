#include "IronEchoRobotAnimInstance.h"

#include "Components/SkeletalMeshComponent.h"
#include "IronEchoFighter.h"

void UIronEchoRobotAnimInstance::NativeInitializeAnimation()
{
	Super::NativeInitializeAnimation();
	MeasureSkeleton();
}

void UIronEchoRobotAnimInstance::MeasureSkeleton()
{
	const USkeletalMeshComponent* Mesh = GetSkelMeshComponent();
	if (Mesh == nullptr)
	{
		return;
	}
	auto BoneCs = [Mesh](const TCHAR* Name) { return Mesh->GetBoneLocation(FName(Name), EBoneSpaces::ComponentSpace); };
	if (Mesh->GetBoneIndex(TEXT("upperarm_l")) == INDEX_NONE || Mesh->GetBoneIndex(TEXT("upperarm_r")) == INDEX_NONE)
	{
		return;
	}
	const FVector ShoulderL = BoneCs(TEXT("upperarm_l"));
	const FVector ShoulderR = BoneCs(TEXT("upperarm_r"));
	const float Left = static_cast<float>(FVector::Dist(ShoulderL, BoneCs(TEXT("lowerarm_l"))) + FVector::Dist(BoneCs(TEXT("lowerarm_l")), BoneCs(TEXT("hand_l"))));
	const float Right = static_cast<float>(FVector::Dist(ShoulderR, BoneCs(TEXT("lowerarm_r"))) + FVector::Dist(BoneCs(TEXT("lowerarm_r")), BoneCs(TEXT("hand_r"))));
	ArmLengthCm = 0.5f * (Left + Right);
	ShoulderCentre = 0.5f * (ShoulderL + ShoulderR);
}

void UIronEchoRobotAnimInstance::NativeUpdateAnimation(float DeltaSeconds)
{
	Super::NativeUpdateAnimation(DeltaSeconds);
	const AIronEchoFighter* Fighter = Cast<AIronEchoFighter>(GetOwningActor());
	if (Fighter == nullptr)
	{
		return;
	}
	VisualState = Fighter->GetVisualStateRef();
	bHasGameplayState = true;
	if (ArmLengthCm <= 0.0f)
	{
		MeasureSkeleton();
	}
	const USkeletalMeshComponent* Mesh = GetSkelMeshComponent();
	if (ArmLengthCm > 0.0f && Mesh != nullptr)
	{
		// Follow the current (last evaluated) shoulders so targets move with the torso lean.
		ShoulderCentre = 0.5f * (Mesh->GetBoneLocation(TEXT("upperarm_l"), EBoneSpaces::ComponentSpace)
			+ Mesh->GetBoneLocation(TEXT("upperarm_r"), EBoneSpaces::ComponentSpace));
		// Body frame (X fwd, Y right, Z up) == component space of a robot that faces +X (contract).
		HandIKTargetLeft = ShoulderCentre + VisualState.HandTargetLeft * ArmLengthCm;
		HandIKTargetRight = ShoulderCentre + VisualState.HandTargetRight * ArmLengthCm;
	}
}
