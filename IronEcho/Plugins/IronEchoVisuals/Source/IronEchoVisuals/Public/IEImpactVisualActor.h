#pragma once
#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "IEVisualTypes.h"
#include "IEImpactVisualActor.generated.h"

class UInstancedStaticMeshComponent;
class UMaterialInterface;

UCLASS(BlueprintType)
class IRONECHOVISUALS_API AIEImpactVisualActor : public AActor
{
    GENERATED_BODY()
public:
    AIEImpactVisualActor();
    UFUNCTION(BlueprintCallable) bool ShowConfirmedImpact(const FIEConfirmedImpact& Event);
    UFUNCTION(BlueprintCallable) void SetReducedMotion(bool bReduce);
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Cosmetic") TObjectPtr<UMaterialInterface> SparkMaterial;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly) TObjectPtr<UInstancedStaticMeshComponent> Sparks;
    virtual void Tick(float DeltaSeconds) override;
protected:
    virtual void BeginPlay() override;
private:
    struct FSpark { FVector Position; FVector Velocity; float Life=0.f; };
    TArray<FSpark> Pool;
    TSet<FGuid> Seen;
    TArray<FGuid> SeenOrder;
    int32 Cursor=0;
    bool bReducedMotion=false;
    void ClearSparks();
};
