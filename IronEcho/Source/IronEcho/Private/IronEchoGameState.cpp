#include "IronEchoGameState.h"

#include "IronEchoFighter.h"
#include "IronEchoPunchingBag.h"

AIronEchoFighter* AIronEchoGameState::GetFighter(EIronEchoFighterRole Role) const
{
	return Role == EIronEchoFighterRole::Player ? PlayerFighter.Get() : OpponentFighter.Get();
}

void AIronEchoGameState::SetArena(AIronEchoFighter* InPlayer, AIronEchoFighter* InOpponent, AIronEchoPunchingBag* InBag, const FTransform& InRing)
{
	PlayerFighter = InPlayer;
	OpponentFighter = InOpponent;
	Bag = InBag;
	RingTransform = InRing;
}
