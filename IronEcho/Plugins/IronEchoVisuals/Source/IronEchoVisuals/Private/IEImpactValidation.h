#pragma once
#include "IEVisualTypes.h"
#include "IEContactPolicy.h"

inline bool IEIsUsableImpact(const FIEConfirmedImpact& Event)
{
    return Event.EventId.IsValid() && FMath::IsFinite(Event.VisualIntensity)
        && FMath::IsFinite(Event.WorldPosition.X) && FMath::IsFinite(Event.WorldPosition.Y)
        && FMath::IsFinite(Event.WorldPosition.Z) && FMath::IsFinite(Event.WorldNormal.X)
        && FMath::IsFinite(Event.WorldNormal.Y) && FMath::IsFinite(Event.WorldNormal.Z);
}
inline IronEchoPresentation::FEventKey IEImpactKey(const FGuid& Id)
{ return {Id.A,Id.B,Id.C,Id.D}; }
