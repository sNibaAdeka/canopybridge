#pragma once

#include "CoreMinimal.h"
#include "Blueprint/UserWidget.h"
#include "IEVisualTypes.h"
#include "IEMenuWidget.generated.h"

class UButton;
class UBorder;
class USizeBox;
class UTextBlock;

UCLASS(BlueprintType)
class IRONECHOVISUALS_API UIEMenuWidget : public UUserWidget
{
    GENERATED_BODY()
public:
    UPROPERTY(BlueprintAssignable) FIEVisualActionRequested OnActionRequested;
    UFUNCTION(BlueprintCallable) void SetCameraReady(bool bReady);
    UFUNCTION(BlueprintCallable) void SetReducedMotion(bool bReduce);
    UFUNCTION(BlueprintCallable) void ShowCameraMessage(const FText& Message);
    UFUNCTION(BlueprintCallable) void FocusPrimaryAction();
protected:
    virtual TSharedRef<SWidget> RebuildWidget() override;
    virtual void NativeConstruct() override;
    virtual void NativeTick(const FGeometry& MyGeometry, float InDeltaTime) override;
    virtual FReply NativeOnPreviewKeyDown(const FGeometry& Geometry, const FKeyEvent& Event) override;
private:
    UPROPERTY(Transient) TArray<TObjectPtr<UButton>> Buttons;
    UPROPERTY(Transient) TArray<TObjectPtr<UBorder>> FocusBorders;
    UPROPERTY(Transient) TObjectPtr<UTextBlock> PrimaryLabel;
    UPROPERTY(Transient) TObjectPtr<UTextBlock> StatusLabel;
    UPROPERTY(Transient) TObjectPtr<USizeBox> MenuWidth;
    bool bCameraReady = false;
    bool bReducedMotion = false;
    int32 FocusIndex = 0;
    float EnterTime = 0.f;
    void BuildTree();
    void FocusButton(int32 Index);
    UFUNCTION() void PrimaryPressed();
    UFUNCTION() void CalibrationPressed();
    UFUNCTION() void SettingsPressed();
    UFUNCTION() void ExitPressed();
};
