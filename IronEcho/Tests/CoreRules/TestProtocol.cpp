#include "TestFramework.h"

#include "IronEchoRules/Crc32.h"
#include "IronEchoRules/Protocol.h"

#include <cstring>
#include <fstream>
#include <map>
#include <sstream>
#include <string>
#include <vector>

using namespace IronEchoCore;
using namespace IronEchoCore::Protocol;

namespace
{
	std::vector<uint8_t> MakePose(uint32_t Sequence, float Lean = 0.25f)
	{
		Header Head;
		Head.SessionToken = 0x12345678u;
		Head.TrackerInstance = 0xABCDEF01u;
		Head.Sequence = Sequence;
		Head.CaptureTimeUs = 1000000;
		Head.SendTimeUs = 1012000;
		PoseFramePayload Pose;
		Pose.State = TrackerState::Tracking;
		Pose.Calibration = CalibrationState::Valid;
		Pose.Confidence = 0.9f;
		Pose.LeanLateral = Lean;
		Pose.BlockAmount = 0.5f;
		Pose.HandPos[0] = {0.3f, -0.2f, 0.1f};
		Pose.HandPos[1] = {0.35f, 0.2f, 0.12f};
		Pose.HandExtension[0] = 0.5f;
		Pose.HandExtension[1] = 0.45f;
		Pose.HandConfidence[0] = 0.95f;
		Pose.HandConfidence[1] = 0.93f;
		Pose.TrackerFps = 30.0f;
		Pose.LastEventId = 12;
		Pose.EventCount = 2;
		Pose.Events[0] = {11, EventType::PunchStart, Hand::Left, 33000, 0.7f, 0.9f};
		Pose.Events[1] = {12, EventType::PunchStart, Hand::Right, 0, 0.8f, 0.95f};
		std::vector<uint8_t> Buffer(kMaxDatagramSize);
		const size_t Size = EncodePoseFrame(Head, Pose, Buffer.data(), Buffer.size());
		Buffer.resize(Size);
		return Buffer;
	}

	void FixCrc(std::vector<uint8_t>& Packet)
	{
		const size_t Body = Packet.size() - kCrcSize;
		const uint32_t Crc = Crc32(Packet.data(), Body);
		for (int Index = 0; Index < 4; ++Index)
		{
			Packet[Body + static_cast<size_t>(Index)] = static_cast<uint8_t>((Crc >> (8 * Index)) & 0xFFu);
		}
	}

	void PutF32At(std::vector<uint8_t>& Packet, size_t Offset, float Value)
	{
		uint32_t Bits = 0;
		std::memcpy(&Bits, &Value, 4);
		for (int Index = 0; Index < 4; ++Index)
		{
			Packet[Offset + static_cast<size_t>(Index)] = static_cast<uint8_t>((Bits >> (8 * Index)) & 0xFFu);
		}
	}
}

IE_TEST(Crc32_KnownVector)
{
	const char* Text = "123456789";
	IE_EXPECT_EQ(Crc32(reinterpret_cast<const uint8_t*>(Text), 9), 0xCBF43926u);
	IE_EXPECT_EQ(Crc32(nullptr, 0), 0u);
}

IE_TEST(Protocol_PoseRoundTrip)
{
	const std::vector<uint8_t> Packet = MakePose(7);
	IE_EXPECT_EQ(Packet.size(), static_cast<size_t>(kHeaderSize + kPoseFramePayloadSize + kCrcSize));
	DecodedPacket Out;
	IE_EXPECT(Decode(Packet.data(), Packet.size(), Out) == DecodeError::Ok);
	IE_EXPECT(Out.Head.Type == PacketType::PoseFrame);
	IE_EXPECT_EQ(Out.Head.Sequence, 7u);
	IE_EXPECT_EQ(Out.Head.SessionToken, 0x12345678u);
	IE_EXPECT_EQ(Out.Head.TrackerInstance, 0xABCDEF01u);
	IE_EXPECT_EQ(Out.Head.CaptureTimeUs, 1000000u);
	IE_EXPECT(Out.Pose.State == TrackerState::Tracking);
	IE_EXPECT(Out.Pose.Calibration == CalibrationState::Valid);
	IE_EXPECT_NEAR(Out.Pose.LeanLateral, 0.25, 1e-6);
	IE_EXPECT_NEAR(Out.Pose.HandPos[1].Y, 0.2, 1e-6);
	IE_EXPECT_EQ(Out.Pose.EventCount, 2);
	IE_EXPECT_EQ(Out.Pose.Events[0].EventId, 11u);
	IE_EXPECT(Out.Pose.Events[1].EventHand == Hand::Right);
	IE_EXPECT_EQ(Out.Pose.Events[0].AgeUs, 33000u);
	IE_EXPECT(!Out.bValuesClamped);
}

IE_TEST(Protocol_StatusControlAckRoundTrip)
{
	uint8_t Buffer[kMaxDatagramSize];
	Header Head;
	Head.Sequence = 3;
	StatusPayload Status;
	Status.State = TrackerState::NoPerson;
	Status.Calibration = CalibrationState::InProgress;
	Status.Step = CalibrationStep::SlipLeft;
	Status.CalibrationProgress = 40;
	Status.CameraFps = 30.0f;
	Status.CameraWidth = 640;
	Status.CameraHeight = 480;
	std::strncpy(Status.ModelName, "pose_landmarker_full", kModelNameSize - 1);
	size_t Size = EncodeStatus(Head, Status, Buffer, sizeof(Buffer));
	DecodedPacket Out;
	IE_EXPECT(Decode(Buffer, Size, Out) == DecodeError::Ok);
	IE_EXPECT(Out.Status.Step == CalibrationStep::SlipLeft);
	IE_EXPECT_EQ(Out.Status.CalibrationProgress, 40);
	IE_EXPECT_EQ(Out.Status.CameraWidth, 640);
	IE_EXPECT(std::string(Out.Status.ModelName) == "pose_landmarker_full");

	ControlPayload Control;
	Control.Command = ControlCommand::StartCalibrationFull;
	Control.CommandId = 99;
	Size = EncodeControl(Head, Control, Buffer, sizeof(Buffer));
	IE_EXPECT(Decode(Buffer, Size, Out) == DecodeError::Ok);
	IE_EXPECT(Out.Control.Command == ControlCommand::StartCalibrationFull);
	IE_EXPECT_EQ(Out.Control.CommandId, 99u);

	ControlAckPayload Ack;
	Ack.Command = ControlCommand::Shutdown;
	Ack.Result = AckResult::Unsupported;
	Ack.CommandId = 5;
	Size = EncodeControlAck(Head, Ack, Buffer, sizeof(Buffer));
	IE_EXPECT(Decode(Buffer, Size, Out) == DecodeError::Ok);
	IE_EXPECT(Out.Ack.Result == AckResult::Unsupported);
}

IE_TEST(Protocol_RejectsMalformed)
{
	DecodedPacket Out;
	std::vector<uint8_t> Packet = MakePose(1);

	IE_EXPECT(Decode(Packet.data(), 10, Out) == DecodeError::TooShort);
	IE_EXPECT(Decode(Packet.data(), Packet.size() - 1, Out) == DecodeError::SizeMismatch);

	std::vector<uint8_t> Corrupt = Packet;
	Corrupt[60] ^= 0x01u;
	IE_EXPECT(Decode(Corrupt.data(), Corrupt.size(), Out) == DecodeError::BadCrc);

	std::vector<uint8_t> Magic = Packet;
	Magic[0] = 'X';
	IE_EXPECT(Decode(Magic.data(), Magic.size(), Out) == DecodeError::BadMagic);

	std::vector<uint8_t> Major = Packet;
	Major[4] = 2;
	FixCrc(Major);
	IE_EXPECT(Decode(Major.data(), Major.size(), Out) == DecodeError::UnsupportedMajor);

	std::vector<uint8_t> Type = Packet;
	Type[8] = 99;
	FixCrc(Type);
	IE_EXPECT(Decode(Type.data(), Type.size(), Out) == DecodeError::UnknownType);

	std::vector<uint8_t> Nan = Packet;
	PutF32At(Nan, kHeaderSize + 8, std::nanf(""));
	FixCrc(Nan);
	IE_EXPECT(Decode(Nan.data(), Nan.size(), Out) == DecodeError::NonFinite);

	std::vector<uint8_t> Events = Packet;
	Events[kHeaderSize + 3] = 5;
	FixCrc(Events);
	IE_EXPECT(Decode(Events.data(), Events.size(), Out) == DecodeError::TooManyEvents);

	std::vector<uint8_t> State = Packet;
	State[kHeaderSize + 0] = 42;
	FixCrc(State);
	IE_EXPECT(Decode(State.data(), State.size(), Out) == DecodeError::BadEnum);

	std::vector<uint8_t> Huge(kMaxDatagramSize + 1, 0);
	IE_EXPECT(Decode(Huge.data(), Huge.size(), Out) == DecodeError::TooLong);
}

IE_TEST(Protocol_ClampsOutOfRangeValues)
{
	std::vector<uint8_t> Packet = MakePose(1);
	PutF32At(Packet, kHeaderSize + 8, 7.5f);  // lean far outside +-2
	PutF32At(Packet, kHeaderSize + 4, -1.0f); // confidence below 0
	FixCrc(Packet);
	DecodedPacket Out;
	IE_EXPECT(Decode(Packet.data(), Packet.size(), Out) == DecodeError::Ok);
	IE_EXPECT(Out.bValuesClamped);
	IE_EXPECT_NEAR(Out.Pose.LeanLateral, 2.0, 1e-6);
	IE_EXPECT_NEAR(Out.Pose.Confidence, 0.0, 1e-6);
}

IE_TEST(Protocol_ForwardCompatibleMinorVersion)
{
	// A 1.1 sender appends 8 bytes to the pose payload; a 1.0 receiver must accept and ignore them.
	std::vector<uint8_t> Packet = MakePose(1);
	Packet.resize(Packet.size() - kCrcSize);
	Packet[6] = 1; // minor = 1
	const uint32_t NewPayload = kPoseFramePayloadSize + 8;
	for (int Index = 0; Index < 4; ++Index)
	{
		Packet[12 + static_cast<size_t>(Index)] = static_cast<uint8_t>((NewPayload >> (8 * Index)) & 0xFFu);
	}
	for (int Index = 0; Index < 8; ++Index)
	{
		Packet.push_back(0xEE);
	}
	Packet.resize(Packet.size() + kCrcSize);
	FixCrc(Packet);
	DecodedPacket Out;
	IE_EXPECT(Decode(Packet.data(), Packet.size(), Out) == DecodeError::Ok);
	IE_EXPECT_EQ(Out.Head.SchemaMinor, 1);
	IE_EXPECT_EQ(Out.Pose.EventCount, 2);
}

IE_TEST(Protocol_FuzzNeverCrashes)
{
	// Random mutations with and without CRC repair: decoding must never read out of bounds
	// (enforced by ASan/UBSan in the test build) and must only return documented results.
	const std::vector<uint8_t> Base = MakePose(5);
	uint32_t Seed = 12345u;
	auto NextRandom = [&Seed]() {
		Seed = Seed * 1664525u + 1013904223u;
		return Seed;
	};
	int Accepted = 0;
	for (int Iteration = 0; Iteration < 50000; ++Iteration)
	{
		std::vector<uint8_t> Packet = Base;
		const int Mutations = 1 + static_cast<int>(NextRandom() % 4u);
		for (int Index = 0; Index < Mutations; ++Index)
		{
			const size_t Offset = NextRandom() % Packet.size();
			Packet[Offset] = static_cast<uint8_t>(NextRandom() & 0xFFu);
		}
		if ((NextRandom() & 3u) == 0u)
		{
			Packet.resize(NextRandom() % (Packet.size() + 1));
		}
		else if ((NextRandom() & 1u) == 0u && Packet.size() >= kHeaderSize + kCrcSize)
		{
			FixCrc(Packet);
		}
		DecodedPacket Out;
		const DecodeError Error = Decode(Packet.empty() ? nullptr : Packet.data(), Packet.size(), Out);
		if (Error == DecodeError::Ok)
		{
			++Accepted;
			IE_EXPECT(Out.Pose.EventCount <= kMaxEventsPerFrame);
			IE_EXPECT(std::isfinite(Out.Pose.LeanLateral));
		}
	}
	IE_EXPECT(Accepted > 0);
}

// ---- golden vectors written by Tracking/iron_echo_tracker/golden.py ----

namespace
{
	std::map<std::string, std::string> ParseFields(std::istringstream& Line)
	{
		std::map<std::string, std::string> Fields;
		std::string Token;
		while (Line >> Token)
		{
			const size_t Eq = Token.find('=');
			if (Eq != std::string::npos)
			{
				Fields[Token.substr(0, Eq)] = Token.substr(Eq + 1);
			}
		}
		return Fields;
	}

	double FieldValue(const DecodedPacket& Out, const std::string& Key, bool& bKnown)
	{
		bKnown = true;
		const PoseFramePayload& P = Out.Pose;
		if (Key == "type") return static_cast<double>(Out.Head.Type);
		if (Key == "seq") return Out.Head.Sequence;
		if (Key == "token") return Out.Head.SessionToken;
		if (Key == "instance") return Out.Head.TrackerInstance;
		if (Key == "capture_us") return static_cast<double>(Out.Head.CaptureTimeUs);
		if (Key == "send_us") return static_cast<double>(Out.Head.SendTimeUs);
		if (Key == "minor") return Out.Head.SchemaMinor;
		if (Key == "state") return static_cast<double>(P.State);
		if (Key == "calib") return static_cast<double>(P.Calibration);
		if (Key == "flags") return P.Flags;
		if (Key == "events") return P.EventCount;
		if (Key == "lean") return P.LeanLateral;
		if (Key == "lean_fwd") return P.LeanForward;
		if (Key == "block") return P.BlockAmount;
		if (Key == "conf") return P.Confidence;
		if (Key == "hand_l_x") return P.HandPos[0].X;
		if (Key == "hand_r_y") return P.HandPos[1].Y;
		if (Key == "ext_r") return P.HandExtension[1];
		if (Key == "last_event") return P.LastEventId;
		if (Key == "ev0_id") return P.Events[0].EventId;
		if (Key == "ev0_hand") return static_cast<double>(P.Events[0].EventHand);
		if (Key == "ev0_age_us") return P.Events[0].AgeUs;
		if (Key == "ev0_strength") return P.Events[0].Strength;
		if (Key == "ev1_id") return P.Events[1].EventId;
		if (Key == "ev1_hand") return static_cast<double>(P.Events[1].EventHand);
		if (Key == "status_step") return static_cast<double>(Out.Status.Step);
		if (Key == "status_progress") return Out.Status.CalibrationProgress;
		if (Key == "status_fps") return Out.Status.CameraFps;
		if (Key == "status_width") return Out.Status.CameraWidth;
		if (Key == "control_cmd") return static_cast<double>(Out.Control.Command);
		if (Key == "control_arg") return Out.Control.Arg;
		if (Key == "control_id") return Out.Control.CommandId;
		if (Key == "ack_cmd") return static_cast<double>(Out.Ack.Command);
		if (Key == "ack_result") return static_cast<double>(Out.Ack.Result);
		if (Key == "ack_id") return Out.Ack.CommandId;
		if (Key == "clamped") return Out.bValuesClamped ? 1.0 : 0.0;
		bKnown = false;
		return 0.0;
	}
}

IE_TEST(Protocol_GoldenVectorsFromPython)
{
	const std::string Dir = IRONECHO_GOLDEN_DIR;
	std::ifstream Manifest(Dir + "/manifest.txt");
	IE_EXPECT(Manifest.good());
	std::string Line;
	int Checked = 0;
	while (std::getline(Manifest, Line))
	{
		if (Line.empty() || Line[0] == '#')
		{
			continue;
		}
		std::istringstream Stream(Line);
		std::string File;
		std::string Expected;
		Stream >> File >> Expected;
		const std::map<std::string, std::string> Fields = ParseFields(Stream);

		std::ifstream Bin(Dir + "/" + File, std::ios::binary);
		IE_EXPECT(Bin.good());
		const std::vector<uint8_t> Data((std::istreambuf_iterator<char>(Bin)), std::istreambuf_iterator<char>());
		DecodedPacket Out;
		const DecodeError Error = Decode(Data.empty() ? nullptr : Data.data(), Data.size(), Out);
		if (std::string(DecodeErrorName(Error)) != Expected)
		{
			IeTest::Fail(__FILE__, __LINE__, File + ": expected " + Expected + " got " + DecodeErrorName(Error));
			continue;
		}
		for (const auto& [Key, Value] : Fields)
		{
			bool bKnown = false;
			const double Actual = FieldValue(Out, Key, bKnown);
			if (!bKnown)
			{
				IeTest::Fail(__FILE__, __LINE__, File + ": unknown manifest key " + Key);
				continue;
			}
			const double Want = std::stod(Value);
			if (std::fabs(Actual - Want) > 1e-5 * (1.0 + std::fabs(Want)))
			{
				IeTest::Fail(__FILE__, __LINE__, File + ": " + Key + " expected " + Value + " got " + std::to_string(Actual));
			}
		}

		// Re-encoding what we decoded must reproduce the exact bytes (C++ and Python agree bit for bit).
		if (Error == DecodeError::Ok && Out.Head.SchemaMinor == kSchemaMinor && !Out.bValuesClamped)
		{
			std::vector<uint8_t> Again(kMaxDatagramSize);
			size_t Size = 0;
			switch (Out.Head.Type)
			{
			case PacketType::PoseFrame: Size = EncodePoseFrame(Out.Head, Out.Pose, Again.data(), Again.size()); break;
			case PacketType::Status: Size = EncodeStatus(Out.Head, Out.Status, Again.data(), Again.size()); break;
			case PacketType::Control: Size = EncodeControl(Out.Head, Out.Control, Again.data(), Again.size()); break;
			case PacketType::ControlAck: Size = EncodeControlAck(Out.Head, Out.Ack, Again.data(), Again.size()); break;
			}
			Again.resize(Size);
			if (Again != Data)
			{
				IeTest::Fail(__FILE__, __LINE__, File + ": C++ re-encode differs from Python bytes");
			}
		}
		++Checked;
	}
	IE_EXPECT(Checked >= 6);
}
