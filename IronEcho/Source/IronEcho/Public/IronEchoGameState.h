// Read-side API for Codex's HUD, menus, camera and VFX: HUD snapshot, actors, and event delegates.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameStateBase.h"
#include "IronEchoTypes.h"

#include "IronEchoGameState.generated.h"

class AIronEchoFighter;
class AIronEchoPunchingBag;

UCLASS()
class IRONECHO_API AIronEchoGameState : public AGameStateBase
{
	GENERATED_BODY()

public:
	/** Fired for every rules event (hits, blocks, dodges, attack stages, KO...). Bind VFX / audio / HUD here. */
	UPROPERTY(BlueprintAssignable, Category = "IronEcho")
	FIronEchoCombatEventSignature OnCombatEvent;

	/** Fired for match flow events (phase changes, rounds, countdown, pause, result). */
	UPROPERTY(BlueprintAssignable, Category = "IronEcho")
	FIronEchoMatchEventSignature OnMatchEvent;

	UFUNCTION(BlueprintPure, Category = "IronEcho")
	FIronEchoHudState GetHudState() const { return HudState; }

	UFUNCTION(BlueprintPure, Category = "IronEcho")
	AIronEchoFighter* GetFighter(EIronEchoFighterRole Role) const;

	UFUNCTION(BlueprintPure, Category = "IronEcho")
	AIronEchoPunchingBag* GetPunchingBag() const { return Bag; }

	/** Ring centre and fight line (+X from player toward opponent). */
	UFUNCTION(BlueprintPure, Category = "IronEcho")
	FTransform GetRingTransform() const { return RingTransform; }

	UFUNCTION(BlueprintPure, Category = "IronEcho")
	int32 GetVisualContractVersion() const { return IRONECHO_VISUAL_CONTRACT_VERSION; }

	void SetHudState(const FIronEchoHudState& InState) { HudState = InState; }
	void SetArena(AIronEchoFighter* InPlayer, AIronEchoFighter* InOpponent, AIronEchoPunchingBag* InBag, const FTransform& InRing);

private:
	UPROPERTY() FIronEchoHudState HudState;
	UPROPERTY() TObjectPtr<AIronEchoFighter> PlayerFighter;
	UPROPERTY() TObjectPtr<AIronEchoFighter> OpponentFighter;
	UPROPERTY() TObjectPtr<AIronEchoPunchingBag> Bag;
	FTransform RingTransform;
};
