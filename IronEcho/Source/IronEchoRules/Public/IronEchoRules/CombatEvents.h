// Events emitted by the rules. Unreal forwards them to HUD / VFX / audio (Docs/Contracts/ROBOT_VISUAL_CONTRACT.md).
#pragma once

#include "IronEchoRules/Types.h"

#include <cstdint>

namespace IronEchoCore
{
	enum class CombatEventType : uint8_t
	{
		AttackStarted = 0,  // windup begins
		AttackActive,       // active window begins
		AttackRecovery,     // recovery begins
		AttackFinished,     // back to guard
		AttackCancelled,    // interrupted by a hit or by a combo cancel
		HitConfirmed,       // clean hit (also emitted after GuardBroken)
		Blocked,
		Dodged,
		Whiffed,            // out of range
		GuardBroken,        // block attempted without stamina -> full hit
		KnockedOut,
		StaminaExhausted,
		BlockStarted,
		BlockEnded,
		DodgeStarted,
		DodgeEnded,
		InputDropped,       // buffered punch expired
	};

	const char* CombatEventName(CombatEventType Type);

	struct CombatEvent
	{
		CombatEventType Type = CombatEventType::AttackStarted;
		FighterSlot Actor = FighterSlot::Player;   // who did it (attacker / blocker / dodger)
		FighterSlot Target = FighterSlot::Opponent;
		Hand AttackHand = Hand::Left;
		DodgeDir Dodge = DodgeDir::None;
		bool bCounterHit = false;
		bool bTired = false;
		float Damage = 0.0f;
		float TargetHealthAfter = 0.0f;
		float TargetStaminaAfter = 0.0f;
		uint32_t AttackId = 0;
		int32_t Tick = 0;
	};

	enum class MatchPhase : uint8_t
	{
		WaitingForPlayer = 0,
		Countdown,
		Fighting,
		RoundBreak,
		MatchOver,
		Paused,
		Training,
	};

	enum class PauseReason : uint8_t
	{
		None = 0,
		Manual,
		TrackingLost,
	};

	enum class ResultMethod : uint8_t
	{
		None = 0,
		KnockOut,
		Decision,
		Draw,
	};

	enum class MatchEventType : uint8_t
	{
		PhaseChanged = 0,
		RoundStarted,
		RoundEnded,
		MatchEnded,
		Paused,
		Resumed,
		CountdownTick,
	};

	const char* MatchPhaseName(MatchPhase Phase);
	const char* MatchEventName(MatchEventType Type);

	struct MatchEvent
	{
		MatchEventType Type = MatchEventType::PhaseChanged;
		MatchPhase Phase = MatchPhase::WaitingForPlayer;
		MatchPhase PreviousPhase = MatchPhase::WaitingForPlayer;
		PauseReason Reason = PauseReason::None;
		ResultMethod Method = ResultMethod::None;
		bool bHasWinner = false;
		FighterSlot Winner = FighterSlot::Player;
		int32_t Round = 0;            // 1-based
		int32_t CountdownSeconds = 0;
		int32_t ScorePlayer = 0;      // cumulative 10-point-must totals
		int32_t ScoreOpponent = 0;
		int32_t Tick = 0;
	};

	// Fixed-capacity FIFO used for event output; never allocates.
	template <typename T, int32_t Capacity>
	class EventBuffer
	{
	public:
		void Push(const T& Item)
		{
			if (Count < Capacity)
			{
				Items[Count++] = Item;
			}
			else
			{
				++Overflow;
			}
		}
		void Clear()
		{
			Count = 0;
			Overflow = 0;
		}
		int32_t Num() const { return Count; }
		int32_t Dropped() const { return Overflow; }
		const T& operator[](int32_t Index) const { return Items[Index]; }
		const T* begin() const { return Items; }
		const T* end() const { return Items + Count; }

	private:
		T Items[Capacity];
		int32_t Count = 0;
		int32_t Overflow = 0;
	};

	using CombatEventBuffer = EventBuffer<CombatEvent, 256>;
	using MatchEventBuffer = EventBuffer<MatchEvent, 64>;
}
