#pragma once
#include "CoreMinimal.h"
#include "Blueprint/UserWidget.h"
#include "IEVisualTypes.h"
#include "IEHUDWidget.generated.h"

class UTextBlock;
class UProgressBar;

UCLASS(BlueprintType)
class IRONECHOVISUALS_API UIEHUDWidget : public UUserWidget
{
    GENERATED_BODY()
public:
    UFUNCTION(BlueprintCallable) bool ApplySnapshot(const FIEHUDSnapshot& Snapshot);
    UFUNCTION(BlueprintCallable) void ClearSnapshot();
protected:
    virtual TSharedRef<SWidget> RebuildWidget() override;
    virtual void NativeConstruct() override;
private:
    UPROPERTY(Transient) TObjectPtr<UTextBlock> PlayerLabel;
    UPROPERTY(Transient) TObjectPtr<UTextBlock> OpponentLabel;
    UPROPERTY(Transient) TObjectPtr<UTextBlock> StaminaLabel;
    UPROPERTY(Transient) TObjectPtr<UTextBlock> TimerLabel;
    UPROPERTY(Transient) TObjectPtr<UTextBlock> TrackingLabel;
    UPROPERTY(Transient) TObjectPtr<UProgressBar> PlayerBar;
    UPROPERTY(Transient) TObjectPtr<UProgressBar> OpponentBar;
    UPROPERTY(Transient) TObjectPtr<UProgressBar> StaminaBar;
    void BuildTree();
};
