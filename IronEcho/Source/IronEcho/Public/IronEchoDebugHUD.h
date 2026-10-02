// Technical overlay (F3). The player-facing HUD is Codex's UMG widget (UIronEchoVisualConfig::HudWidgetClass).
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/HUD.h"

#include "IronEchoDebugHUD.generated.h"

UCLASS()
class IRONECHO_API AIronEchoDebugHUD : public AHUD
{
	GENERATED_BODY()

public:
	virtual void DrawHUD() override;

private:
	void Line(const FString& Text, const FLinearColor& Color, float& Y);
	void Bar(float X, float Y, float Width, float Fraction, const FLinearColor& Color);
};
