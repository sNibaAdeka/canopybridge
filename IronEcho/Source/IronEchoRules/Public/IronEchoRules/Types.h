// IRON ECHO core rules: shared primitive types.
//
// This module is plain C++20 with no Unreal dependency so the same sources are
// compiled by Unreal (module IronEchoRules) and by Tests/CoreRules (CMake).
// Rules for this folder:
//   - no exceptions, no RTTI, no dynamic allocation in per-tick paths;
//   - avoid identifiers that collide with Unreal/Windows macros
//     (check, verify, ensure, PI, IN, OUT, near, far, min, max, ERROR, DELETE, ...);
//   - all simulation timing is integer ticks at kTickRate.
#pragma once

#include <cstdint>

namespace IronEchoCore
{
	// Fixed simulation rate. Every duration in the rules is quantised to 1/kTickRate s.
	inline constexpr int32_t kTickRate = 120;
	inline constexpr double kTickSeconds = 1.0 / static_cast<double>(kTickRate);

	inline constexpr int32_t SecondsToTicks(double Seconds)
	{
		const double Scaled = Seconds * static_cast<double>(kTickRate);
		return static_cast<int32_t>(Scaled >= 0.0 ? Scaled + 0.5 : Scaled - 0.5);
	}

	inline constexpr double TicksToSeconds(int32_t Ticks)
	{
		return static_cast<double>(Ticks) * kTickSeconds;
	}

	struct Vec3
	{
		// Body frame, camera aligned: X forward (toward camera / opponent), Y anatomical right, Z up.
		float X = 0.0f;
		float Y = 0.0f;
		float Z = 0.0f;
	};

	// Anatomical side of the player (and of the robot that mirrors the player). Never screen side.
	enum class Hand : uint8_t
	{
		Left = 0,
		Right = 1,
	};

	inline constexpr int32_t HandIndex(Hand InHand) { return InHand == Hand::Left ? 0 : 1; }
	inline constexpr Hand OtherHand(Hand InHand) { return InHand == Hand::Left ? Hand::Right : Hand::Left; }

	// Lateral dodge (slip) direction, anatomical: Left = player's own left.
	enum class DodgeDir : int8_t
	{
		Left = -1,
		None = 0,
		Right = 1,
	};

	enum class FighterSlot : uint8_t
	{
		Player = 0,
		Opponent = 1,
	};

	inline constexpr int32_t SlotIndex(FighterSlot Slot) { return Slot == FighterSlot::Player ? 0 : 1; }
	inline constexpr FighterSlot OtherSlot(FighterSlot Slot) { return Slot == FighterSlot::Player ? FighterSlot::Opponent : FighterSlot::Player; }

	template <typename T>
	inline constexpr T Clamp(T Value, T Lo, T Hi)
	{
		return Value < Lo ? Lo : (Value > Hi ? Hi : Value);
	}

	template <typename T>
	inline constexpr T AbsValue(T Value)
	{
		return Value < T(0) ? -Value : Value;
	}
}
