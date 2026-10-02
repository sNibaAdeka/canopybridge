// IRON ECHO local tracker <-> game wire protocol, schema 1.x.
// Normative description: Docs/Contracts/LOCAL_PROTOCOL.md. Python twin: Tracking/iron_echo_tracker/protocol.py.
// Golden vectors shared by both implementations: Tests/Golden/protocol_v1.
#pragma once

#include "IronEchoRules/Types.h"

#include <cstddef>
#include <cstdint>

namespace IronEchoCore::Protocol
{
	inline constexpr uint32_t kMagic = 0x48434549u; // bytes "IECH" little-endian
	inline constexpr uint16_t kSchemaMajor = 1;
	inline constexpr uint16_t kSchemaMinor = 0;
	inline constexpr uint32_t kHeaderSize = 48;
	inline constexpr uint32_t kCrcSize = 4;
	inline constexpr uint32_t kMaxDatagramSize = 1200;
	inline constexpr int32_t kMaxEventsPerFrame = 4;

	inline constexpr uint32_t kPoseFramePayloadSize = 152;
	inline constexpr uint32_t kStatusPayloadSize = 48;
	inline constexpr uint32_t kControlPayloadSize = 8;
	inline constexpr uint32_t kControlAckPayloadSize = 8;
	inline constexpr uint32_t kModelNameSize = 24;

	enum class PacketType : uint16_t
	{
		PoseFrame = 1,  // tracker -> game, every processed camera frame (also acts as heartbeat)
		Status = 2,     // tracker -> game, ~2 Hz diagnostics + calibration progress
		Control = 16,   // game -> tracker
		ControlAck = 17 // tracker -> game
	};

	enum class TrackerState : uint8_t
	{
		Starting = 0,
		NoCamera = 1,
		NoPerson = 2,
		Tracking = 3,
		LowConfidence = 4,
	};

	enum class CalibrationState : uint8_t
	{
		None = 0,
		InProgress = 1,
		Valid = 2,
		Failed = 3,
	};

	enum class CalibrationStep : uint8_t
	{
		Idle = 0,
		Neutral = 1,
		RaiseRightHand = 2,
		SlipLeft = 3,
		SlipRight = 4,
		Done = 5,
	};

	enum class CalibrationFailure : uint8_t
	{
		NoFailure = 0,
		Timeout = 1,
		LowVisibility = 2,
		Unstable = 3,
		Cancelled = 4,
	};

	enum class TrackerError : uint8_t
	{
		NoError = 0,
		CameraOpenFailed = 1,
		ModelLoadFailed = 2,
		CameraReadFailed = 3,
	};

	enum class EventType : uint8_t
	{
		PunchStart = 1,
	};

	enum class ControlCommand : uint8_t
	{
		Ping = 1,
		StartCalibrationFull = 2,
		StartCalibrationQuick = 3,
		CancelCalibration = 4,
		Shutdown = 5,
		SetPreview = 6, // Arg: 0 = hide, 1 = show tracker debug window
	};

	enum class AckResult : uint8_t
	{
		Ok = 0,
		Rejected = 1,
		Unsupported = 2,
	};

	// PoseFrame.Flags bits
	inline constexpr uint8_t kPoseFlagMirrorApplied = 1u << 0;

	struct Header
	{
		uint16_t SchemaMajor = kSchemaMajor;
		uint16_t SchemaMinor = kSchemaMinor;
		PacketType Type = PacketType::PoseFrame;
		uint32_t PayloadSize = 0;
		uint32_t SessionToken = 0;
		uint32_t TrackerInstance = 0;
		uint32_t Sequence = 0;
		uint32_t Flags = 0;
		uint64_t CaptureTimeUs = 0; // sender monotonic clock, microseconds
		uint64_t SendTimeUs = 0;    // sender monotonic clock, microseconds
	};

	struct TrackerEvent
	{
		uint32_t EventId = 0;   // strictly increasing per tracker instance, starts at 1
		EventType Type = EventType::PunchStart;
		Hand EventHand = Hand::Left;
		uint32_t AgeUs = 0;     // Header.CaptureTimeUs - capture time of the frame that produced the event
		float Strength = 0.0f;  // 0..1
		float Confidence = 0.0f;// 0..1
	};

	struct PoseFramePayload
	{
		TrackerState State = TrackerState::Starting;
		CalibrationState Calibration = CalibrationState::None;
		uint8_t Flags = 0;
		uint8_t EventCount = 0;
		float Confidence = 0.0f;   // 0..1
		float LeanLateral = 0.0f;  // -1..1 calibrated, + = player's right
		float LeanForward = 0.0f;  // -1..1, + = toward camera
		float Crouch = 0.0f;       // reserved in 1.0, always 0
		float BlockAmount = 0.0f;  // 0..1
		Vec3 HandPos[2];           // arm lengths, origin shoulder centre, body frame
		float HandExtension[2] = {0.0f, 0.0f}; // |wrist - shoulder| / arm length
		float HandConfidence[2] = {0.0f, 0.0f};
		float TrackerFps = 0.0f;
		uint32_t LastEventId = 0;
		TrackerEvent Events[kMaxEventsPerFrame];
	};

	struct StatusPayload
	{
		TrackerState State = TrackerState::Starting;
		CalibrationState Calibration = CalibrationState::None;
		CalibrationStep Step = CalibrationStep::Idle;
		uint8_t CalibrationProgress = 0; // 0..100 within the current step
		CalibrationFailure Failure = CalibrationFailure::NoFailure;
		uint8_t MirrorApplied = 0;
		uint8_t CameraIndex = 255;
		TrackerError LastError = TrackerError::NoError;
		float CameraFps = 0.0f;
		float InferenceMs = 0.0f;
		float PipelineLatencyMs = 0.0f;
		uint16_t CameraWidth = 0;
		uint16_t CameraHeight = 0;
		char ModelName[kModelNameSize] = {};
	};

	struct ControlPayload
	{
		ControlCommand Command = ControlCommand::Ping;
		uint8_t Arg = 0;
		uint32_t CommandId = 0;
	};

	struct ControlAckPayload
	{
		ControlCommand Command = ControlCommand::Ping;
		AckResult Result = AckResult::Ok;
		uint32_t CommandId = 0;
	};

	enum class DecodeError : uint8_t
	{
		Ok = 0,
		TooShort,
		TooLong,
		BadMagic,
		UnsupportedMajor,
		BadHeaderSize,
		SizeMismatch,
		BadCrc,
		UnknownType,
		PayloadTooSmall,
		BadEnum,
		NonFinite,
		TooManyEvents,
	};

	const char* DecodeErrorName(DecodeError Error);

	struct DecodedPacket
	{
		Header Head;
		PoseFramePayload Pose;       // valid when Head.Type == PoseFrame
		StatusPayload Status;        // valid when Head.Type == Status
		ControlPayload Control;      // valid when Head.Type == Control
		ControlAckPayload Ack;       // valid when Head.Type == ControlAck
		bool bValuesClamped = false; // finite values outside the documented range were clamped
	};

	// Validates framing, version, CRC, enums and value sanity. Never reads out of bounds.
	DecodeError Decode(const uint8_t* Data, size_t Size, DecodedPacket& Out);

	// Encoders return the datagram size, or 0 if Capacity is too small.
	// Header.Type and Header.PayloadSize are filled in by the encoder.
	size_t EncodePoseFrame(Header Head, const PoseFramePayload& Payload, uint8_t* Out, size_t Capacity);
	size_t EncodeStatus(Header Head, const StatusPayload& Payload, uint8_t* Out, size_t Capacity);
	size_t EncodeControl(Header Head, const ControlPayload& Payload, uint8_t* Out, size_t Capacity);
	size_t EncodeControlAck(Header Head, const ControlAckPayload& Payload, uint8_t* Out, size_t Capacity);
}
