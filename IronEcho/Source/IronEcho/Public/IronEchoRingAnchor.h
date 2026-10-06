// Placed by Codex in the arena map: its location is the ring centre and its +X axis is the fight line
// (player on -X facing +X, opponent on +X facing -X). Without an anchor the game uses the world origin
// and spawns the technical gym (floor + lights).
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"

#include "IronEchoRingAnchor.generated.h"

class UArrowComponent;

UCLASS()
class IRONECHO_API AIronEchoRingAnchor : public AActor
{
	GENERATED_BODY()

public:
	AIronEchoRingAnchor();

	/** How far a fighter's centre may go from the anchor along X and Y, cm (square ring, inside the ropes). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "IronEcho") float UsableHalfLength = 260.0f;

#if WITH_EDITORONLY_DATA
	UPROPERTY() TObjectPtr<UArrowComponent> Arrow;
#endif
};
