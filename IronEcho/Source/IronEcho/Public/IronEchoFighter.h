// A robot fighter. Gameplay state comes from the rules (AIronEchoGameMode pushes FIronEchoFighterVisualState);
// visuals are Codex's skeletal mesh + AnimBP when configured, otherwise a procedural placeholder robot built
// from engine basic shapes (no project assets needed).
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "IronEchoTypes.h"

#include "IronEchoFighter.generated.h"

class UMaterialInstanceDynamic;
class USkeletalMesh;
class USkeletalMeshComponent;
class UStaticMesh;
class UStaticMeshComponent;

UCLASS()
class IRONECHO_API AIronEchoFighter : public AActor
{
	GENERATED_BODY()

public:
	AIronEchoFighter();

	/** Called by the game mode after spawning. AnimClass must derive from UIronEchoRobotAnimInstance. */
	void SetupVisuals(EIronEchoFighterRole InRole, USkeletalMesh* Mesh, UClass* AnimClass);

	/** Pushes the latest rules state; the actor itself never decides gameplay. */
	void ApplyVisualState(const FIronEchoFighterVisualState& State, const FTransform& WorldTransform, float DeltaSeconds);

	UFUNCTION(BlueprintPure, Category = "IronEcho")
	FIronEchoFighterVisualState GetVisualState() const { return VisualState; }

	const FIronEchoFighterVisualState& GetVisualStateRef() const { return VisualState; }

	UFUNCTION(BlueprintPure, Category = "IronEcho")
	EIronEchoFighterRole GetRole() const { return Role; }

	/** fist_l / fist_r socket on the robot mesh, or the placeholder fist. */
	UFUNCTION(BlueprintPure, Category = "IronEcho")
	FVector GetFistLocation(EIronEchoHand Hand) const;

	/** hit_head socket on the robot mesh, or the placeholder head. */
	UFUNCTION(BlueprintPure, Category = "IronEcho")
	FVector GetHitLocation() const;

	UFUNCTION(BlueprintPure, Category = "IronEcho")
	bool IsUsingPlaceholder() const { return bUsingPlaceholder; }

	UFUNCTION(BlueprintPure, Category = "IronEcho")
	USkeletalMeshComponent* GetRobotMesh() const { return RobotMesh; }

	/** Names required on Codex's skeleton (ROBOT_VISUAL_CONTRACT.md). */
	static const TArray<FName>& RequiredBones();
	static const TArray<FName>& RequiredSockets();

protected:
	UPROPERTY(VisibleAnywhere, Category = "IronEcho") TObjectPtr<USceneComponent> Root;
	UPROPERTY(VisibleAnywhere, Category = "IronEcho") TObjectPtr<USkeletalMeshComponent> RobotMesh;

private:
	void UpdatePlaceholder(float DeltaSeconds);
	// Part indices are defined in IronEchoFighter.cpp (FighterParts).
	void PlaceSegment(int32 Part, const FVector& From, const FVector& To, float Thickness);
	void PlaceSphere(int32 Part, const FVector& Center, float Radius);
	FVector SolveElbow(const FVector& Shoulder, const FVector& Wrist, float Upper, float Fore, float SideSign) const;

	UPROPERTY() TArray<TObjectPtr<UStaticMeshComponent>> Parts;
	UPROPERTY() TArray<TObjectPtr<UMaterialInstanceDynamic>> PartMaterials;
	UPROPERTY() TObjectPtr<UStaticMesh> CubeMesh;
	UPROPERTY() TObjectPtr<UStaticMesh> CylinderMesh;
	UPROPERTY() TObjectPtr<UStaticMesh> SphereMesh;

	EIronEchoFighterRole Role = EIronEchoFighterRole::Player;
	FIronEchoFighterVisualState VisualState;
	bool bUsingPlaceholder = true;
	float SmoothedLean = 0.0f;
	float SmoothedBlock = 0.0f;
	float HitJolt = 0.0f;
	float LastSeenHitTime = -1.0f;
	FVector SmoothedHands[2];
};
