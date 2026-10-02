// Stream validator for tracker packets: session token, tracker instance, ordering,
// clock sanity, pipeline staleness, liveness and event de-duplication.
// Normative rules: Docs/Contracts/LOCAL_PROTOCOL.md section "Приёмник".
#pragma once

#include "IronEchoRules/InputFrame.h"
#include "IronEchoRules/Protocol.h"

#include <cstddef>
#include <cstdint>

namespace IronEchoCore
{
	struct GateConfig
	{
		uint32_t ExpectedToken = 0;          // 0 = accept any token (developer mode only)
		double LivenessTimeout = 0.35;       // s without an accepted packet -> Offline
		double MaxPipelineLatency = 0.25;    // s, SendTime - CaptureTime above this -> reject packet
		double MaxEventAge = 0.25;           // s, punch older than this when consumed -> dropped
		double InstanceSwitchSilence = 0.50; // s of silence before a new tracker instance may take over
	};

	enum class GateVerdict : uint8_t
	{
		Accepted = 0,
		DecodeFailed,
		WrongSession,
		ConflictingInstance,
		DuplicateOrOld,
		ClockRegression,
		StalePipeline,
		NotTrackerPacket,
		Count
	};

	const char* GateVerdictName(GateVerdict Verdict);

	struct GateStats
	{
		uint64_t Verdicts[static_cast<int>(GateVerdict::Count)] = {};
		uint64_t LostPackets = 0;      // sequence gaps
		uint64_t ClampedPackets = 0;
		uint64_t EventsAccepted = 0;
		uint64_t EventsStale = 0;
		uint64_t EventsDuplicate = 0;
		uint64_t EventsOverflow = 0;
		uint64_t InstanceSwitches = 0;
		Protocol::DecodeError LastDecodeError = Protocol::DecodeError::Ok;
	};

	class PacketGate
	{
	public:
		explicit PacketGate(const GateConfig& InConfig = GateConfig()) : Config(InConfig) {}

		GateVerdict Submit(const uint8_t* Data, size_t Size, double ReceiveTimeSeconds);
		GateVerdict SubmitDecoded(const Protocol::DecodedPacket& Packet, double ReceiveTimeSeconds);

		// Latest pose as an InputFrame; drains accepted, still-fresh punch events.
		InputFrame BuildFrame(double NowSeconds);

		bool IsLive(double NowSeconds) const;
		bool HasStatus() const { return bHasStatus; }
		const Protocol::StatusPayload& LatestStatus() const { return Status; }
		const GateStats& Stats() const { return StatsData; }
		uint32_t BoundInstance() const { return bBound ? Instance : 0; }

		// Returns true and fills OutAck if an ack with CommandId has been received.
		bool FindAck(uint32_t CommandId, Protocol::ControlAckPayload& OutAck) const;

		void Reset();
		const GateConfig& GetConfig() const { return Config; }
		void SetConfig(const GateConfig& InConfig) { Config = InConfig; }

	private:
		struct PendingPunch
		{
			PunchIntent Punch;
			double CaptureTimeOnReceiveClock = 0.0; // estimated capture time expressed on the game clock
		};

		static constexpr int kPendingCapacity = 8;
		static constexpr int kAckCapacity = 8;

		void Rebind(uint32_t NewInstance);

		GateConfig Config;
		GateStats StatsData;

		bool bBound = false;
		uint32_t Instance = 0;
		bool bHasSequence = false;
		uint32_t LastSequence = 0;
		uint64_t LastCaptureUs = 0;
		double LastAcceptedReceiveTime = -1.0e9;
		uint32_t LastEventId = 0;

		bool bHasPose = false;
		Protocol::PoseFramePayload Pose;
		bool bHasStatus = false;
		Protocol::StatusPayload Status;

		PendingPunch Pending[kPendingCapacity];
		int PendingCount = 0;

		Protocol::ControlAckPayload Acks[kAckCapacity];
		int AckCount = 0;
		int AckNext = 0;
	};
}
