#include "IronEchoRingAnchor.h"

#include "Components/ArrowComponent.h"
#include "Components/SceneComponent.h"

AIronEchoRingAnchor::AIronEchoRingAnchor()
{
	PrimaryActorTick.bCanEverTick = false;
	SetRootComponent(CreateDefaultSubobject<USceneComponent>(TEXT("Root")));
#if WITH_EDITORONLY_DATA
	Arrow = CreateEditorOnlyDefaultSubobject<UArrowComponent>(TEXT("FightLine"));
	if (Arrow != nullptr)
	{
		Arrow->SetupAttachment(GetRootComponent());
		Arrow->ArrowSize = 3.0f;
		Arrow->ArrowLength = 150.0f;
	}
#endif
}
