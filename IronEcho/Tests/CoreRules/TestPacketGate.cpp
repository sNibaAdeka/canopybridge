#include "TestFramework.h"

#include "IronEchoRules/PacketGate.h"

#include <vector>

using namespace IronEchoCore;
using namespace IronEchoCore::Protocol;

namespace
{
	struct PoseSpec
	{
		uint32_t Token = 77;
		uint32_t Instance = 1;
		uint32_t Sequence = 1;
		uint64_t CaptureUs = 1000000;
		uint64_t PipelineUs = 15000;
		TrackerState State = TrackerState::Tracking;
		CalibrationState Calibration = CalibrationState::Valid;
		std::vector<TrackerEvent> Events;
	};

	std::vector<uint8_t> Encode(const PoseSpec& Spec)
	{
		Header Head;
		Head.SessionToken = Spec.Token;
		Head.TrackerInstance = Spec.Instance;
		Head.Sequence = Spec.Sequence;
		Head.CaptureTimeUs = Spec.CaptureUs;
		Head.SendTimeUs = Spec.CaptureUs + Spec.PipelineUs;
		PoseFramePayload Pose;
		Pose.State = Spec.State;
		Pose.Calibration = Spec.Calibration;
		Pose.Confidence = 0.9f;
		Pose.LeanLateral = 0.1f;
		Pose.EventCount = static_cast<uint8_t>(Spec.Events.size());
		for (size_t Index = 0; Index < Spec.Events.size(); ++Index)
		{
			Pose.Events[Index] = Spec.Events[Index];
			Pose.LastEventId = Spec.Events[Index].EventId;
		}
		std::vector<uint8_t> Buffer(kMaxDatagramSize);
		Buffer.resize(EncodePoseFrame(Head, Pose, Buffer.data(), Buffer.size()));
		return Buffer;
	}

	GateVerdict Send(PacketGate& Gate, const PoseSpec& Spec, double Now)
	{
		const std::vector<uint8_t> Data = Encode(Spec);
		return Gate.Submit(Data.data(), Data.size(), Now);
	}

	TrackerEvent Punch(uint32_t Id, Hand InHand, uint32_t AgeUs = 0)
	{
		return TrackerEvent{Id, EventType::PunchStart, InHand, AgeUs, 0.8f, 0.9f};
	}

	GateConfig TokenConfig()
	{
		GateConfig Config;
		Config.ExpectedToken = 77;
		return Config;
	}
}

IE_TEST(Gate_AcceptsInOrderAndRejectsReplay)
{
	PacketGate Gate(TokenConfig());
	PoseSpec Spec;
	IE_EXPECT(Send(Gate, Spec, 10.0) == GateVerdict::Accepted);
	IE_EXPECT(Send(Gate, Spec, 10.01) == GateVerdict::DuplicateOrOld);
	Spec.Sequence = 2;
	Spec.CaptureUs += 33000;
	IE_EXPECT(Send(Gate, Spec, 10.03) == GateVerdict::Accepted);
	PoseSpec Old = Spec;
	Old.Sequence = 1;
	IE_EXPECT(Send(Gate, Old, 10.04) == GateVerdict::DuplicateOrOld);
	Spec.Sequence = 6; // 3 lost packets
	Spec.CaptureUs += 33000 * 4;
	IE_EXPECT(Send(Gate, Spec, 10.15) == GateVerdict::Accepted);
	IE_EXPECT_EQ(Gate.Stats().LostPackets, 3u);
}

IE_TEST(Gate_RejectsWrongSessionStaleAndClockRegression)
{
	PacketGate Gate(TokenConfig());
	PoseSpec Spec;
	Spec.Token = 78;
	IE_EXPECT(Send(Gate, Spec, 1.0) == GateVerdict::WrongSession);
	Spec.Token = 77;
	Spec.PipelineUs = 400000; // 400 ms between capture and send
	IE_EXPECT(Send(Gate, Spec, 1.0) == GateVerdict::StalePipeline);
	Spec.PipelineUs = 10000;
	IE_EXPECT(Send(Gate, Spec, 1.0) == GateVerdict::Accepted);
	Spec.Sequence = 2;
	Spec.CaptureUs -= 1000; // capture clock went backwards
	IE_EXPECT(Send(Gate, Spec, 1.03) == GateVerdict::ClockRegression);
}

IE_TEST(Gate_DeveloperTokenZeroAcceptsAny)
{
	PacketGate Gate; // ExpectedToken = 0
	PoseSpec Spec;
	Spec.Token = 123456;
	IE_EXPECT(Send(Gate, Spec, 1.0) == GateVerdict::Accepted);
}

IE_TEST(Gate_LivenessTimeout)
{
	PacketGate Gate(TokenConfig());
	PoseSpec Spec;
	IE_EXPECT(Send(Gate, Spec, 5.0) == GateVerdict::Accepted);
	IE_EXPECT(Gate.IsLive(5.2));
	IE_EXPECT(Gate.BuildFrame(5.2).Status == TrackingStatus::Live);
	IE_EXPECT(!Gate.IsLive(5.5));
	IE_EXPECT(Gate.BuildFrame(5.5).Status == TrackingStatus::Offline);
}

IE_TEST(Gate_InstanceSwitchNeedsSilence)
{
	PacketGate Gate(TokenConfig());
	PoseSpec A;
	IE_EXPECT(Send(Gate, A, 1.0) == GateVerdict::Accepted);
	PoseSpec B;
	B.Instance = 2;
	B.Sequence = 1;
	B.CaptureUs = 50; // a restarted tracker has a fresh clock
	IE_EXPECT(Send(Gate, B, 1.1) == GateVerdict::ConflictingInstance);
	IE_EXPECT(Send(Gate, B, 1.7) == GateVerdict::Accepted); // 0.7 s of silence from A
	IE_EXPECT_EQ(Gate.BoundInstance(), 2u);
	IE_EXPECT_EQ(Gate.Stats().InstanceSwitches, 1u);
	A.Sequence = 2;
	A.CaptureUs += 1000;
	IE_EXPECT(Send(Gate, A, 1.71) == GateVerdict::ConflictingInstance);
}

IE_TEST(Gate_EventsDeduplicatedAcrossRepeats)
{
	PacketGate Gate(TokenConfig());
	PoseSpec Spec;
	Spec.Events = {Punch(1, Hand::Left)};
	IE_EXPECT(Send(Gate, Spec, 2.0) == GateVerdict::Accepted);
	// The tracker repeats recent events in following packets; they must be delivered exactly once.
	Spec.Sequence = 2;
	Spec.CaptureUs += 16000;
	Spec.Events = {Punch(1, Hand::Left, 16000), Punch(2, Hand::Right)};
	IE_EXPECT(Send(Gate, Spec, 2.016) == GateVerdict::Accepted);
	const InputFrame Frame = Gate.BuildFrame(2.02);
	IE_EXPECT_EQ(Frame.PunchCount, 2);
	IE_EXPECT(Frame.Punches[0].PunchHand == Hand::Left);
	IE_EXPECT(Frame.Punches[1].PunchHand == Hand::Right);
	IE_EXPECT_EQ(Gate.Stats().EventsDuplicate, 1u);
	IE_EXPECT_EQ(Gate.BuildFrame(2.03).PunchCount, 0);
}

IE_TEST(Gate_LostFirstPacketEventRecoveredFromRepeat)
{
	PacketGate Gate(TokenConfig());
	PoseSpec Spec;
	Spec.Sequence = 1;
	IE_EXPECT(Send(Gate, Spec, 3.0) == GateVerdict::Accepted);
	// Packet 2 carrying event 5 is lost; packet 3 repeats it with its age.
	Spec.Sequence = 3;
	Spec.CaptureUs += 66000;
	Spec.Events = {Punch(5, Hand::Right, 33000)};
	IE_EXPECT(Send(Gate, Spec, 3.066) == GateVerdict::Accepted);
	const InputFrame Frame = Gate.BuildFrame(3.07);
	IE_EXPECT_EQ(Frame.PunchCount, 1);
	IE_EXPECT_NEAR(Frame.Punches[0].AgeSeconds, 0.033 + 0.015 + 0.004, 1e-4);
}

IE_TEST(Gate_StaleEventsDropped)
{
	PacketGate Gate(TokenConfig());
	PoseSpec Spec;
	Spec.Events = {Punch(1, Hand::Left, 200000)}; // already 200 ms old inside the frame
	IE_EXPECT(Send(Gate, Spec, 4.0) == GateVerdict::Accepted);
	const InputFrame Frame = Gate.BuildFrame(4.1); // +15 ms pipeline + 100 ms wait > 250 ms
	IE_EXPECT_EQ(Frame.PunchCount, 0);
	IE_EXPECT_EQ(Gate.Stats().EventsStale, 1u);
}

IE_TEST(Gate_StatusMapping)
{
	PacketGate Gate(TokenConfig());
	PoseSpec Spec;
	Spec.Calibration = CalibrationState::None;
	Send(Gate, Spec, 1.0);
	IE_EXPECT(Gate.BuildFrame(1.0).Status == TrackingStatus::NotCalibrated);
	Spec.Sequence = 2;
	Spec.Calibration = CalibrationState::InProgress;
	Send(Gate, Spec, 1.01);
	IE_EXPECT(Gate.BuildFrame(1.01).Status == TrackingStatus::Calibrating);
	Spec.Sequence = 3;
	Spec.State = TrackerState::NoPerson;
	Send(Gate, Spec, 1.02);
	IE_EXPECT(Gate.BuildFrame(1.02).Status == TrackingStatus::NoPerson);
	Spec.Sequence = 4;
	Spec.State = TrackerState::LowConfidence;
	Send(Gate, Spec, 1.03);
	IE_EXPECT(Gate.BuildFrame(1.03).Status == TrackingStatus::LowConfidence);
}

IE_TEST(Gate_RejectsControlPacketsAndGarbage)
{
	PacketGate Gate(TokenConfig());
	Header Head;
	Head.SessionToken = 77;
	Head.Sequence = 1;
	ControlPayload Control;
	uint8_t Buffer[kMaxDatagramSize];
	const size_t Size = EncodeControl(Head, Control, Buffer, sizeof(Buffer));
	IE_EXPECT(Gate.Submit(Buffer, Size, 1.0) == GateVerdict::NotTrackerPacket);
	const uint8_t Garbage[16] = {1, 2, 3};
	IE_EXPECT(Gate.Submit(Garbage, sizeof(Garbage), 1.0) == GateVerdict::DecodeFailed);
	IE_EXPECT(Gate.Stats().LastDecodeError == DecodeError::TooShort);
}

IE_TEST(Gate_AckLookup)
{
	PacketGate Gate(TokenConfig());
	Header Head;
	Head.SessionToken = 77;
	Head.TrackerInstance = 1;
	Head.Sequence = 1;
	Head.CaptureTimeUs = 10;
	Head.SendTimeUs = 10;
	ControlAckPayload Ack;
	Ack.Command = ControlCommand::StartCalibrationFull;
	Ack.CommandId = 42;
	uint8_t Buffer[kMaxDatagramSize];
	const size_t Size = EncodeControlAck(Head, Ack, Buffer, sizeof(Buffer));
	IE_EXPECT(Gate.Submit(Buffer, Size, 1.0) == GateVerdict::Accepted);
	ControlAckPayload Found;
	IE_EXPECT(Gate.FindAck(42, Found));
	IE_EXPECT(Found.Command == ControlCommand::StartCalibrationFull);
	IE_EXPECT(!Gate.FindAck(43, Found));
}
