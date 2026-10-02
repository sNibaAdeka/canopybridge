#include "IronEchoRules/Protocol.h"

#include "IronEchoRules/Crc32.h"

#include <cmath>
#include <cstring>

namespace IronEchoCore::Protocol
{
	namespace
	{
		// ---- little-endian byte access (portable, no alignment assumptions) ----
		void PutU8(uint8_t* Dst, uint8_t Value) { Dst[0] = Value; }
		void PutU16(uint8_t* Dst, uint16_t Value)
		{
			Dst[0] = static_cast<uint8_t>(Value & 0xFFu);
			Dst[1] = static_cast<uint8_t>((Value >> 8) & 0xFFu);
		}
		void PutU32(uint8_t* Dst, uint32_t Value)
		{
			for (int Index = 0; Index < 4; ++Index)
			{
				Dst[Index] = static_cast<uint8_t>((Value >> (8 * Index)) & 0xFFu);
			}
		}
		void PutU64(uint8_t* Dst, uint64_t Value)
		{
			for (int Index = 0; Index < 8; ++Index)
			{
				Dst[Index] = static_cast<uint8_t>((Value >> (8 * Index)) & 0xFFu);
			}
		}
		void PutF32(uint8_t* Dst, float Value)
		{
			uint32_t Bits = 0;
			std::memcpy(&Bits, &Value, sizeof(Bits));
			PutU32(Dst, Bits);
		}

		uint8_t GetU8(const uint8_t* Src) { return Src[0]; }
		uint16_t GetU16(const uint8_t* Src)
		{
			return static_cast<uint16_t>(static_cast<uint16_t>(Src[0]) | static_cast<uint16_t>(Src[1] << 8));
		}
		uint32_t GetU32(const uint8_t* Src)
		{
			uint32_t Value = 0;
			for (int Index = 0; Index < 4; ++Index)
			{
				Value |= static_cast<uint32_t>(Src[Index]) << (8 * Index);
			}
			return Value;
		}
		uint64_t GetU64(const uint8_t* Src)
		{
			uint64_t Value = 0;
			for (int Index = 0; Index < 8; ++Index)
			{
				Value |= static_cast<uint64_t>(Src[Index]) << (8 * Index);
			}
			return Value;
		}
		float GetF32(const uint8_t* Src)
		{
			const uint32_t Bits = GetU32(Src);
			float Value = 0.0f;
			std::memcpy(&Value, &Bits, sizeof(Value));
			return Value;
		}

		// ---- validated float reads ----
		struct FloatReader
		{
			bool bNonFinite = false;
			bool bClamped = false;

			float Read(const uint8_t* Src, float Lo, float Hi)
			{
				const float Value = GetF32(Src);
				if (!std::isfinite(Value))
				{
					bNonFinite = true;
					return 0.0f;
				}
				if (Value < Lo)
				{
					bClamped = true;
					return Lo;
				}
				if (Value > Hi)
				{
					bClamped = true;
					return Hi;
				}
				return Value;
			}
		};

		size_t WriteFrame(Header Head, PacketType Type, const uint8_t* Payload, uint32_t PayloadSize, uint8_t* Out, size_t Capacity)
		{
			const size_t Total = static_cast<size_t>(kHeaderSize) + PayloadSize + kCrcSize;
			if (Out == nullptr || Capacity < Total || Total > kMaxDatagramSize)
			{
				return 0;
			}
			Head.Type = Type;
			Head.PayloadSize = PayloadSize;
			PutU32(Out + 0, kMagic);
			PutU16(Out + 4, Head.SchemaMajor);
			PutU16(Out + 6, Head.SchemaMinor);
			PutU16(Out + 8, static_cast<uint16_t>(Head.Type));
			PutU16(Out + 10, static_cast<uint16_t>(kHeaderSize));
			PutU32(Out + 12, Head.PayloadSize);
			PutU32(Out + 16, Head.SessionToken);
			PutU32(Out + 20, Head.TrackerInstance);
			PutU32(Out + 24, Head.Sequence);
			PutU32(Out + 28, Head.Flags);
			PutU64(Out + 32, Head.CaptureTimeUs);
			PutU64(Out + 40, Head.SendTimeUs);
			std::memcpy(Out + kHeaderSize, Payload, PayloadSize);
			const uint32_t Crc = Crc32(Out, kHeaderSize + PayloadSize);
			PutU32(Out + kHeaderSize + PayloadSize, Crc);
			return Total;
		}

		bool IsValidTrackerState(uint8_t Value) { return Value <= static_cast<uint8_t>(TrackerState::LowConfidence); }
		bool IsValidCalibrationState(uint8_t Value) { return Value <= static_cast<uint8_t>(CalibrationState::Failed); }
		bool IsValidCalibrationStep(uint8_t Value) { return Value <= static_cast<uint8_t>(CalibrationStep::Done); }
		bool IsValidCalibrationFailure(uint8_t Value) { return Value <= static_cast<uint8_t>(CalibrationFailure::Cancelled); }
		bool IsValidTrackerError(uint8_t Value) { return Value <= static_cast<uint8_t>(TrackerError::CameraReadFailed); }
		bool IsValidCommand(uint8_t Value)
		{
			return Value >= static_cast<uint8_t>(ControlCommand::Ping) && Value <= static_cast<uint8_t>(ControlCommand::SetPreview);
		}
		bool IsValidAckResult(uint8_t Value) { return Value <= static_cast<uint8_t>(AckResult::Unsupported); }

		DecodeError DecodePose(const uint8_t* P, uint32_t PayloadSize, DecodedPacket& Out)
		{
			if (PayloadSize < kPoseFramePayloadSize)
			{
				return DecodeError::PayloadTooSmall;
			}
			PoseFramePayload& Pose = Out.Pose;
			const uint8_t StateRaw = GetU8(P + 0);
			const uint8_t CalibRaw = GetU8(P + 1);
			if (!IsValidTrackerState(StateRaw) || !IsValidCalibrationState(CalibRaw))
			{
				return DecodeError::BadEnum;
			}
			Pose.State = static_cast<TrackerState>(StateRaw);
			Pose.Calibration = static_cast<CalibrationState>(CalibRaw);
			Pose.Flags = GetU8(P + 2);
			Pose.EventCount = GetU8(P + 3);
			if (Pose.EventCount > kMaxEventsPerFrame)
			{
				return DecodeError::TooManyEvents;
			}

			FloatReader Reader;
			Pose.Confidence = Reader.Read(P + 4, 0.0f, 1.0f);
			Pose.LeanLateral = Reader.Read(P + 8, -2.0f, 2.0f);
			Pose.LeanForward = Reader.Read(P + 12, -2.0f, 2.0f);
			Pose.Crouch = Reader.Read(P + 16, 0.0f, 1.0f);
			Pose.BlockAmount = Reader.Read(P + 20, 0.0f, 1.0f);
			for (int Side = 0; Side < 2; ++Side)
			{
				const uint8_t* Base = P + 24 + Side * 12;
				Pose.HandPos[Side].X = Reader.Read(Base + 0, -3.0f, 3.0f);
				Pose.HandPos[Side].Y = Reader.Read(Base + 4, -3.0f, 3.0f);
				Pose.HandPos[Side].Z = Reader.Read(Base + 8, -3.0f, 3.0f);
			}
			Pose.HandExtension[0] = Reader.Read(P + 48, 0.0f, 2.0f);
			Pose.HandExtension[1] = Reader.Read(P + 52, 0.0f, 2.0f);
			Pose.HandConfidence[0] = Reader.Read(P + 56, 0.0f, 1.0f);
			Pose.HandConfidence[1] = Reader.Read(P + 60, 0.0f, 1.0f);
			Pose.TrackerFps = Reader.Read(P + 64, 0.0f, 1000.0f);
			Pose.LastEventId = GetU32(P + 68);

			for (int Index = 0; Index < kMaxEventsPerFrame; ++Index)
			{
				TrackerEvent& Event = Pose.Events[Index];
				Event = TrackerEvent{};
				if (Index >= Pose.EventCount)
				{
					continue;
				}
				const uint8_t* E = P + 72 + Index * 20;
				Event.EventId = GetU32(E + 0);
				const uint8_t TypeRaw = GetU8(E + 4);
				const uint8_t HandRaw = GetU8(E + 5);
				if (TypeRaw != static_cast<uint8_t>(EventType::PunchStart) || HandRaw > 1 || Event.EventId == 0)
				{
					return DecodeError::BadEnum;
				}
				Event.Type = static_cast<EventType>(TypeRaw);
				Event.EventHand = static_cast<Hand>(HandRaw);
				Event.AgeUs = GetU32(E + 8);
				Event.Strength = Reader.Read(E + 12, 0.0f, 1.0f);
				Event.Confidence = Reader.Read(E + 16, 0.0f, 1.0f);
			}

			if (Reader.bNonFinite)
			{
				return DecodeError::NonFinite;
			}
			Out.bValuesClamped = Reader.bClamped;
			return DecodeError::Ok;
		}

		DecodeError DecodeStatus(const uint8_t* P, uint32_t PayloadSize, DecodedPacket& Out)
		{
			if (PayloadSize < kStatusPayloadSize)
			{
				return DecodeError::PayloadTooSmall;
			}
			StatusPayload& Status = Out.Status;
			const uint8_t StateRaw = GetU8(P + 0);
			const uint8_t CalibRaw = GetU8(P + 1);
			const uint8_t StepRaw = GetU8(P + 2);
			const uint8_t FailureRaw = GetU8(P + 4);
			const uint8_t ErrorRaw = GetU8(P + 7);
			if (!IsValidTrackerState(StateRaw) || !IsValidCalibrationState(CalibRaw) || !IsValidCalibrationStep(StepRaw)
				|| !IsValidCalibrationFailure(FailureRaw) || !IsValidTrackerError(ErrorRaw))
			{
				return DecodeError::BadEnum;
			}
			Status.State = static_cast<TrackerState>(StateRaw);
			Status.Calibration = static_cast<CalibrationState>(CalibRaw);
			Status.Step = static_cast<CalibrationStep>(StepRaw);
			Status.CalibrationProgress = GetU8(P + 3);
			if (Status.CalibrationProgress > 100)
			{
				Status.CalibrationProgress = 100;
				Out.bValuesClamped = true;
			}
			Status.Failure = static_cast<CalibrationFailure>(FailureRaw);
			Status.MirrorApplied = GetU8(P + 5) != 0 ? 1 : 0;
			Status.CameraIndex = GetU8(P + 6);
			Status.LastError = static_cast<TrackerError>(ErrorRaw);

			FloatReader Reader;
			Status.CameraFps = Reader.Read(P + 8, 0.0f, 1000.0f);
			Status.InferenceMs = Reader.Read(P + 12, 0.0f, 10000.0f);
			Status.PipelineLatencyMs = Reader.Read(P + 16, 0.0f, 10000.0f);
			if (Reader.bNonFinite)
			{
				return DecodeError::NonFinite;
			}
			Out.bValuesClamped = Out.bValuesClamped || Reader.bClamped;
			Status.CameraWidth = GetU16(P + 20);
			Status.CameraHeight = GetU16(P + 22);
			for (uint32_t Index = 0; Index < kModelNameSize; ++Index)
			{
				const uint8_t Char = GetU8(P + 24 + Index);
				// Printable ASCII only; anything else terminates the name.
				Status.ModelName[Index] = (Char >= 0x20 && Char < 0x7F) ? static_cast<char>(Char) : '\0';
			}
			Status.ModelName[kModelNameSize - 1] = '\0';
			return DecodeError::Ok;
		}

		DecodeError DecodeControl(const uint8_t* P, uint32_t PayloadSize, DecodedPacket& Out)
		{
			if (PayloadSize < kControlPayloadSize)
			{
				return DecodeError::PayloadTooSmall;
			}
			const uint8_t CommandRaw = GetU8(P + 0);
			if (!IsValidCommand(CommandRaw))
			{
				return DecodeError::BadEnum;
			}
			Out.Control.Command = static_cast<ControlCommand>(CommandRaw);
			Out.Control.Arg = GetU8(P + 1);
			Out.Control.CommandId = GetU32(P + 4);
			return DecodeError::Ok;
		}

		DecodeError DecodeAck(const uint8_t* P, uint32_t PayloadSize, DecodedPacket& Out)
		{
			if (PayloadSize < kControlAckPayloadSize)
			{
				return DecodeError::PayloadTooSmall;
			}
			const uint8_t CommandRaw = GetU8(P + 0);
			const uint8_t ResultRaw = GetU8(P + 1);
			if (!IsValidCommand(CommandRaw) || !IsValidAckResult(ResultRaw))
			{
				return DecodeError::BadEnum;
			}
			Out.Ack.Command = static_cast<ControlCommand>(CommandRaw);
			Out.Ack.Result = static_cast<AckResult>(ResultRaw);
			Out.Ack.CommandId = GetU32(P + 4);
			return DecodeError::Ok;
		}
	}

	const char* DecodeErrorName(DecodeError Error)
	{
		switch (Error)
		{
		case DecodeError::Ok: return "Ok";
		case DecodeError::TooShort: return "TooShort";
		case DecodeError::TooLong: return "TooLong";
		case DecodeError::BadMagic: return "BadMagic";
		case DecodeError::UnsupportedMajor: return "UnsupportedMajor";
		case DecodeError::BadHeaderSize: return "BadHeaderSize";
		case DecodeError::SizeMismatch: return "SizeMismatch";
		case DecodeError::BadCrc: return "BadCrc";
		case DecodeError::UnknownType: return "UnknownType";
		case DecodeError::PayloadTooSmall: return "PayloadTooSmall";
		case DecodeError::BadEnum: return "BadEnum";
		case DecodeError::NonFinite: return "NonFinite";
		case DecodeError::TooManyEvents: return "TooManyEvents";
		}
		return "Unknown";
	}

	DecodeError Decode(const uint8_t* Data, size_t Size, DecodedPacket& Out)
	{
		Out = DecodedPacket{};
		if (Data == nullptr || Size < static_cast<size_t>(kHeaderSize) + kCrcSize)
		{
			return DecodeError::TooShort;
		}
		if (Size > kMaxDatagramSize)
		{
			return DecodeError::TooLong;
		}
		if (GetU32(Data + 0) != kMagic)
		{
			return DecodeError::BadMagic;
		}
		Header& Head = Out.Head;
		Head.SchemaMajor = GetU16(Data + 4);
		Head.SchemaMinor = GetU16(Data + 6);
		if (Head.SchemaMajor != kSchemaMajor)
		{
			return DecodeError::UnsupportedMajor;
		}
		const uint16_t TypeRaw = GetU16(Data + 8);
		const uint16_t HeaderSize = GetU16(Data + 10);
		if (HeaderSize != kHeaderSize)
		{
			return DecodeError::BadHeaderSize;
		}
		Head.PayloadSize = GetU32(Data + 12);
		if (static_cast<uint64_t>(kHeaderSize) + Head.PayloadSize + kCrcSize != static_cast<uint64_t>(Size))
		{
			return DecodeError::SizeMismatch;
		}
		const uint32_t ExpectedCrc = GetU32(Data + kHeaderSize + Head.PayloadSize);
		if (Crc32(Data, kHeaderSize + Head.PayloadSize) != ExpectedCrc)
		{
			return DecodeError::BadCrc;
		}
		Head.SessionToken = GetU32(Data + 16);
		Head.TrackerInstance = GetU32(Data + 20);
		Head.Sequence = GetU32(Data + 24);
		Head.Flags = GetU32(Data + 28);
		Head.CaptureTimeUs = GetU64(Data + 32);
		Head.SendTimeUs = GetU64(Data + 40);

		const uint8_t* Payload = Data + kHeaderSize;
		switch (TypeRaw)
		{
		case static_cast<uint16_t>(PacketType::PoseFrame):
			Head.Type = PacketType::PoseFrame;
			return DecodePose(Payload, Head.PayloadSize, Out);
		case static_cast<uint16_t>(PacketType::Status):
			Head.Type = PacketType::Status;
			return DecodeStatus(Payload, Head.PayloadSize, Out);
		case static_cast<uint16_t>(PacketType::Control):
			Head.Type = PacketType::Control;
			return DecodeControl(Payload, Head.PayloadSize, Out);
		case static_cast<uint16_t>(PacketType::ControlAck):
			Head.Type = PacketType::ControlAck;
			return DecodeAck(Payload, Head.PayloadSize, Out);
		default:
			return DecodeError::UnknownType;
		}
	}

	size_t EncodePoseFrame(Header Head, const PoseFramePayload& Payload, uint8_t* Out, size_t Capacity)
	{
		uint8_t P[kPoseFramePayloadSize] = {};
		const uint8_t EventCount = Payload.EventCount > kMaxEventsPerFrame ? static_cast<uint8_t>(kMaxEventsPerFrame) : Payload.EventCount;
		PutU8(P + 0, static_cast<uint8_t>(Payload.State));
		PutU8(P + 1, static_cast<uint8_t>(Payload.Calibration));
		PutU8(P + 2, Payload.Flags);
		PutU8(P + 3, EventCount);
		PutF32(P + 4, Payload.Confidence);
		PutF32(P + 8, Payload.LeanLateral);
		PutF32(P + 12, Payload.LeanForward);
		PutF32(P + 16, Payload.Crouch);
		PutF32(P + 20, Payload.BlockAmount);
		for (int Side = 0; Side < 2; ++Side)
		{
			uint8_t* Base = P + 24 + Side * 12;
			PutF32(Base + 0, Payload.HandPos[Side].X);
			PutF32(Base + 4, Payload.HandPos[Side].Y);
			PutF32(Base + 8, Payload.HandPos[Side].Z);
		}
		PutF32(P + 48, Payload.HandExtension[0]);
		PutF32(P + 52, Payload.HandExtension[1]);
		PutF32(P + 56, Payload.HandConfidence[0]);
		PutF32(P + 60, Payload.HandConfidence[1]);
		PutF32(P + 64, Payload.TrackerFps);
		PutU32(P + 68, Payload.LastEventId);
		for (int Index = 0; Index < EventCount; ++Index)
		{
			const TrackerEvent& Event = Payload.Events[Index];
			uint8_t* E = P + 72 + Index * 20;
			PutU32(E + 0, Event.EventId);
			PutU8(E + 4, static_cast<uint8_t>(Event.Type));
			PutU8(E + 5, static_cast<uint8_t>(Event.EventHand));
			PutU16(E + 6, 0);
			PutU32(E + 8, Event.AgeUs);
			PutF32(E + 12, Event.Strength);
			PutF32(E + 16, Event.Confidence);
		}
		return WriteFrame(Head, PacketType::PoseFrame, P, kPoseFramePayloadSize, Out, Capacity);
	}

	size_t EncodeStatus(Header Head, const StatusPayload& Payload, uint8_t* Out, size_t Capacity)
	{
		uint8_t P[kStatusPayloadSize] = {};
		PutU8(P + 0, static_cast<uint8_t>(Payload.State));
		PutU8(P + 1, static_cast<uint8_t>(Payload.Calibration));
		PutU8(P + 2, static_cast<uint8_t>(Payload.Step));
		PutU8(P + 3, Payload.CalibrationProgress);
		PutU8(P + 4, static_cast<uint8_t>(Payload.Failure));
		PutU8(P + 5, Payload.MirrorApplied);
		PutU8(P + 6, Payload.CameraIndex);
		PutU8(P + 7, static_cast<uint8_t>(Payload.LastError));
		PutF32(P + 8, Payload.CameraFps);
		PutF32(P + 12, Payload.InferenceMs);
		PutF32(P + 16, Payload.PipelineLatencyMs);
		PutU16(P + 20, Payload.CameraWidth);
		PutU16(P + 22, Payload.CameraHeight);
		for (uint32_t Index = 0; Index + 1 < kModelNameSize; ++Index)
		{
			const char Char = Payload.ModelName[Index];
			if (Char == '\0')
			{
				break;
			}
			PutU8(P + 24 + Index, static_cast<uint8_t>(Char));
		}
		return WriteFrame(Head, PacketType::Status, P, kStatusPayloadSize, Out, Capacity);
	}

	size_t EncodeControl(Header Head, const ControlPayload& Payload, uint8_t* Out, size_t Capacity)
	{
		uint8_t P[kControlPayloadSize] = {};
		PutU8(P + 0, static_cast<uint8_t>(Payload.Command));
		PutU8(P + 1, Payload.Arg);
		PutU32(P + 4, Payload.CommandId);
		return WriteFrame(Head, PacketType::Control, P, kControlPayloadSize, Out, Capacity);
	}

	size_t EncodeControlAck(Header Head, const ControlAckPayload& Payload, uint8_t* Out, size_t Capacity)
	{
		uint8_t P[kControlAckPayloadSize] = {};
		PutU8(P + 0, static_cast<uint8_t>(Payload.Command));
		PutU8(P + 1, static_cast<uint8_t>(Payload.Result));
		PutU32(P + 4, Payload.CommandId);
		return WriteFrame(Head, PacketType::ControlAck, P, kControlAckPayloadSize, Out, Capacity);
	}
}
