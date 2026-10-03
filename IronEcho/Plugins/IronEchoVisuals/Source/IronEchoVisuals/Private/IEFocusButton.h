#pragma once
#include "Components/Button.h"
#include "IEFocusButton.generated.h"

// UButton exposes focus initialization to subclasses, rather than a runtime setter.
UCLASS()
class UIEFocusButton : public UButton
{
    GENERATED_BODY()
public:
    UIEFocusButton(const FObjectInitializer& Initializer) : Super(Initializer)
    {
        InitIsFocusable(true);
    }
};
