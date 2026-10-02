// IRON ECHO input contract, core level (schema 1). Normative: Docs/Contracts/INPUT_CONTRACT.md.
// Every input source (camera tracker, keyboard debug source, replay) produces InputFrame;
// IntentMapper turns it into a FighterIntent that the combat rules consume.
#pragma once

#include "IronEchoRules/Types.h"

#include <cstdint>

namespace IronEchoCore
{
	inline constexpr uint32_t kInputContractVersion = 1;
	inline constexpr int32_t kMaxPunchesPerFrame = 4;

	enum class TrackingStatus : uint8_t
	{
		Offline = 0,       // no valid tracker packet within the liveness timeout
		Starting = 1,      // tracker alive, camera / model initialising
		NoCamera = 2,
		NoPerson = 3,
		LowConfidence = 4,
		NotCalibrated = 5, // person tracked, no valid calibration yet
		Calibrating = 6,
		Live = 7,          // usable for gameplay
	};

	const char* TrackingStatusName(TrackingStatus Status);

	struct PunchIntent
	{
		Hand PunchHand = Hand::Left;
		float Strength = 0.0f;     // 0..1 (v1: cosmetic only)
		float Confidence = 0.0f;   // 0..1
		float AgeSeconds = 0.0f;   // time since the source frame was captured
		uint32_t SourceEventId = 0;
	};

	struct InputFrame
	{
		uint32_t ContractVersion = kInputContractVersion;
		TrackingStatus Status = TrackingStatus::Offline;
		float Confidence = 0.0f;
		float LeanLateral = 0.0f;   // -1..1 calibrated, + = player's right
		float LeanForward = 0.0f;   // -1..1, + = toward the screen
		float BlockAmount = 0.0f;   // 0..1
		Vec3 HandPos[2];            // arm lengths, origin shoulder centre, body frame (X fwd, Y right, Z up)
		float HandExtension[2] = {0.0f, 0.0f};
		float HandConfidence[2] = {0.0f, 0.0f};
		bool bMirrorApplied = false;
		int32_t PunchCount = 0;
		PunchIntent Punches[kMaxPunchesPerFrame];

		bool AddPunch(const PunchIntent& Punch)
		{
			if (PunchCount >= kMaxPunchesPerFrame)
			{
				return false;
			}
			Punches[PunchCount++] = Punch;
			return true;
		}
	};

	struct PunchRequest
	{
		Hand PunchHand = Hand::Left;
		float Strength = 1.0f;
	};

	// What a fighter wants to do this tick. Produced by IntentMapper (player) or BotBrain (opponent).
	struct FighterIntent
	{
		bool bBlock = false;
		DodgeDir Dodge = DodgeDir::None;
		float LeanLateral = 0.0f; // continuous, for visuals
		bool bRetreat = false;    // opponent only: step back out of range
		int32_t PunchCount = 0;
		PunchRequest Punches[kMaxPunchesPerFrame];

		bool AddPunch(Hand InHand, float Strength = 1.0f)
		{
			if (PunchCount >= kMaxPunchesPerFrame)
			{
				return false;
			}
			Punches[PunchCount].PunchHand = InHand;
			Punches[PunchCount].Strength = Strength;
			++PunchCount;
			return true;
		}
	};

	struct IntentConfig
	{
		float BlockEnter = 0.60f;
		float BlockExit = 0.45f;
		float DodgeEnter = 0.55f;
		float DodgeExit = 0.40f;
		float MinPunchConfidence = 0.50f;
	};

	// Stateful (hysteresis) mapping from InputFrame to FighterIntent.
	class IntentMapper
	{
	public:
		explicit IntentMapper(const IntentConfig& InConfig = IntentConfig()) : Config(InConfig) {}

		FighterIntent Map(const InputFrame& Frame);
		void Reset();

		const IntentConfig& GetConfig() const { return Config; }
		void SetConfig(const IntentConfig& InConfig) { Config = InConfig; }

	private:
		IntentConfig Config;
		bool bBlocking = false;
		DodgeDir CurrentDodge = DodgeDir::None;
	};
}
