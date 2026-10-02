// Training target. Contact is decided by the rules (HitConfirmed on the passive opponent);
// this actor only visualises it (pendulum swing) and counts confirmed hits.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "IronEchoTypes.h"

#include "IronEchoPunchingBag.generated.h"

class UStaticMesh;
class UStaticMeshComponent;

UCLASS()
class IRONECHO_API AIronEchoPunchingBag : public AActor
{
	GENERATED_BODY()

public:
	AIronEchoPunchingBag();

	void SetBagMesh(UStaticMesh* Mesh);
	void OnConfirmedHit(EIronEchoHand Hand, float Strength);
	void UpdateBag(const FTransform& WorldTransform, float DeltaSeconds);

	UFUNCTION(BlueprintPure, Category = "IronEcho") int32 GetConfirmedHits() const { return ConfirmedHits; }
	UFUNCTION(BlueprintPure, Category = "IronEcho") FVector GetHitLocation() const;

protected:
	UPROPERTY(VisibleAnywhere, Category = "IronEcho") TObjectPtr<USceneComponent> Pivot;
	UPROPERTY(VisibleAnywhere, Category = "IronEcho") TObjectPtr<UStaticMeshComponent> Chain;
	UPROPERTY(VisibleAnywhere, Category = "IronEcho") TObjectPtr<UStaticMeshComponent> Bag;

private:
	int32 ConfirmedHits = 0;
	float SwingAngle = 0.0f;    // degrees, pitch away from the player
	float SwingVelocity = 0.0f; // degrees / s
	float Twist = 0.0f;
	float TwistVelocity = 0.0f;
};
