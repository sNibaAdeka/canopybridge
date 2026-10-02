// Parent class for Codex's robot AnimBP. It exposes the gameplay visual state (read-only) and
// precomputed IK targets; all animation decisions (blend spaces, montages, IK chains) belong to the AnimBP.
#pragma once

#include "Animation/AnimInstance.h"
#include "CoreMinimal.h"
#include "IronEchoTypes.h"

#include "IronEchoRobotAnimInstance.generated.h"

UCLASS(Transient, Blueprintable)
class IRONECHO_API UIronEchoRobotAnimInstance : public UAnimInstance
{
	GENERATED_BODY()

public:
	/** Copied from the owning AIronEchoFighter every animation update (game thread). */
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho")
	FIronEchoFighterVisualState VisualState;

	/** Tracked hand targets converted to component space (cm) using this skeleton's arm length. */
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho")
	FVector HandIKTargetLeft = FVector::ZeroVector;

	UPROPERTY(BlueprintReadOnly, Category = "IronEcho")
	FVector HandIKTargetRight = FVector::ZeroVector;

	/** upperarm -> lowerarm -> hand length measured on the reference pose, cm (average of both sides). */
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho")
	float ArmLengthCm = 0.0f;

	/** False until the owner pushed at least one state (e.g. in the editor preview). */
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho")
	bool bHasGameplayState = false;

protected:
	virtual void NativeInitializeAnimation() override;
	virtual void NativeUpdateAnimation(float DeltaSeconds) override;

private:
	void MeasureSkeleton();
	FVector ShoulderCentre = FVector::ZeroVector;
};
