// Drives one match: input (tracker or keyboard) -> IronEchoCore::Match at a fixed 120 Hz -> fighters,
// bag, HUD snapshot and events. Works in any map: uses an AIronEchoRingAnchor if present, otherwise the
// world origin plus a technical gym. Integration with Codex's content only via UIronEchoVisualConfig.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "IronEchoRules/InputFrame.h"
#include "IronEchoRules/Match.h"
#include "IronEchoTypes.h"
#include "Templates/UniquePtr.h"

#include "IronEchoGameMode.generated.h"

class AIronEchoFighter;
class AIronEchoGameState;
class AIronEchoPunchingBag;
class UIronEchoVisualConfig;
class UUserWidget;

UCLASS()
class IRONECHO_API AIronEchoGameMode : public AGameModeBase
{
	GENERATED_BODY()

public:
	AIronEchoGameMode();

	virtual void StartPlay() override;
	virtual void Tick(float DeltaSeconds) override;
	virtual void HandleStartingNewPlayer_Implementation(APlayerController* NewPlayer) override;

	UFUNCTION(BlueprintCallable, Category = "IronEcho") void StartBout(EIronEchoBotLevel Level);
	UFUNCTION(BlueprintCallable, Category = "IronEcho") void StartTraining();
	UFUNCTION(BlueprintCallable, Category = "IronEcho") void TogglePause();
	UFUNCTION(BlueprintCallable, Category = "IronEcho") void RequestPause();
	UFUNCTION(BlueprintCallable, Category = "IronEcho") void RequestResume();
	UFUNCTION(BlueprintCallable, Category = "IronEcho") void RequestRematch();
	UFUNCTION(BlueprintCallable, Category = "IronEcho") void RequestCalibration(bool bFull);
	UFUNCTION(BlueprintCallable, Category = "IronEcho") void SetInputSource(EIronEchoInputSource Source);
	UFUNCTION(BlueprintPure, Category = "IronEcho") EIronEchoInputSource GetInputSource() const { return InputSource; }
	UFUNCTION(BlueprintPure, Category = "IronEcho") FIronEchoHudState GetHudState() const { return HudState; }
	UFUNCTION(BlueprintPure, Category = "IronEcho") AIronEchoFighter* GetFighter(EIronEchoFighterRole Role) const;

private:
	void EnsureArena();
	void SpawnTechGym();
	void SetupView(APlayerController* Player);
	void RebuildMatch(IronEchoCore::MatchMode Mode, EIronEchoBotLevel Level);
	IronEchoCore::InputFrame GatherInput();
	void StepSimulation(float DeltaSeconds, const IronEchoCore::InputFrame& Frame);
	void PushVisuals(float DeltaSeconds, const IronEchoCore::InputFrame& Frame);
	void DispatchEvents();
	void UpdateHudState();
	FTransform SlotTransform(IronEchoCore::FighterSlot Slot) const;
	FIronEchoFighterVisualState MakeVisualState(IronEchoCore::FighterSlot Slot, const IronEchoCore::InputFrame& Frame) const;
	AIronEchoGameState* GetIronEchoGameState() const;
	uint64 MakeSeed() const;

	TUniquePtr<IronEchoCore::Match> Match;
	IronEchoCore::IntentMapper Mapper;
	IronEchoCore::FighterIntent CarriedPunches;
	IronEchoCore::CombatEventBuffer CombatEvents;
	IronEchoCore::MatchEventBuffer MatchEvents;
	double Accumulator = 0.0;
	bool bLastInputReady = false;

	EIronEchoInputSource InputSource = EIronEchoInputSource::Tracker;
	EIronEchoBotLevel BotLevel = EIronEchoBotLevel::Normal;
	FIronEchoHudState HudState;
	FTransform RingTransform = FTransform::Identity;
	bool bArenaReady = false;
	bool bHasAnchor = false;

	struct FReactionMemory
	{
		float LastHitTakenTime = -1.0f;
		EIronEchoHand LastHitFromHand = EIronEchoHand::Left;
		int32 HitsTaken = 0;
		float LastBlockTime = -1.0f;
		float BlockAlpha = 0.0f;
	};
	FReactionMemory Reactions[2];

	UPROPERTY() TObjectPtr<AIronEchoFighter> PlayerFighter;
	UPROPERTY() TObjectPtr<AIronEchoFighter> OpponentFighter;
	UPROPERTY() TObjectPtr<AIronEchoPunchingBag> Bag;
	UPROPERTY() TObjectPtr<AActor> ViewCamera;
	UPROPERTY() TObjectPtr<UIronEchoVisualConfig> VisualConfig;
	UPROPERTY() TObjectPtr<UUserWidget> HudWidget;
};
