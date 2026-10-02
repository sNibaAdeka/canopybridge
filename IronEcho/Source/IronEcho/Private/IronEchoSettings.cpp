#include "IronEchoSettings.h"

UIronEchoSettings::UIronEchoSettings()
{
	CategoryName = TEXT("Game");
	SectionName = TEXT("IronEcho");
	VisualConfig = FSoftObjectPath(TEXT("/Game/Art/Config/DA_IronEchoVisuals.DA_IronEchoVisuals"));
}
