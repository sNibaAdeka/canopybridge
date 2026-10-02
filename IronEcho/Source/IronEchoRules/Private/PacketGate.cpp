#include "IronEchoRules/PacketGate.h"

namespace IronEchoCore
{
	using namespace Protocol;

	const char* GateVerdictName(GateVerdict Verdict)
	{
		switch (Verdict)
		{
		case GateVerdict::Accepted: return "Accepted";
		case GateVerdict::DecodeFailed: return "DecodeFailed";
		case GateVerdict::WrongSession: return "WrongSession";
		case GateVerdict::ConflictingInstance: return "ConflictingInstance";
		case GateVerdict::DuplicateOrOld: return "DuplicateOrOld";
		case GateVerdict::ClockRegression: return "ClockRegression";
		case GateVerdict::StalePipeline: return "StalePipeline";
		case GateVerdict::NotTrackerPacket: return "NotTrackerPacket";
		case GateVerdict::Count: break;
		}
		return "Unknown";
	}

	GateVerdict PacketGate::Submit(const uint8_t* Data, size_t Size, double ReceiveTimeSeconds)
	{
		DecodedPacket Packet;
		const DecodeError Error = Decode(Data, Size, Packet);
		if (Error != DecodeError::Ok)
		{
			StatsData.LastDecodeError = Error;
			++StatsData.Verdicts[static_cast<int>(GateVerdict::DecodeFailed)];
			return GateVerdict::DecodeFailed;
		}
		return SubmitDecoded(Packet, ReceiveTimeSeconds);
	}

	GateVerdict PacketGate::SubmitDecoded(const DecodedPacket& Packet, double ReceiveTimeSeconds)
	{
		const Header& Head = Packet.Head;
		GateVerdict Verdict = GateVerdict::Accepted;

		if (Head.Type == PacketType::Control)
		{
			Verdict = GateVerdict::NotTrackerPacket;
		}
		else if (Config.ExpectedToken != 0 && Head.SessionToken != Config.ExpectedToken)
		{
			Verdict = GateVerdict::WrongSession;
		}
		else if (Head.SendTimeUs < Head.CaptureTimeUs)
		{
			Verdict = GateVerdict::ClockRegression;
		}
		else if (static_cast<double>(Head.SendTimeUs - Head.CaptureTimeUs) * 1.0e-6 > Config.MaxPipelineLatency)
		{
			Verdict = GateVerdict::StalePipeline;
		}
		else if (bBound && Head.TrackerInstance != Instance)
		{
			if (ReceiveTimeSeconds - LastAcceptedReceiveTime >= Config.InstanceSwitchSilence)
			{
				Rebind(Head.TrackerInstance);
				++StatsData.InstanceSwitches;
			}
			else
			{
				Verdict = GateVerdict::ConflictingInstance;
			}
		}
		else if (!bBound)
		{
			Rebind(Head.TrackerInstance);
		}

		if (Verdict == GateVerdict::Accepted && bHasSequence)
		{
			if (Head.Sequence <= LastSequence)
			{
				Verdict = GateVerdict::DuplicateOrOld;
			}
			else if (Head.CaptureTimeUs < LastCaptureUs)
			{
				Verdict = GateVerdict::ClockRegression;
			}
		}

		++StatsData.Verdicts[static_cast<int>(Verdict)];
		if (Verdict != GateVerdict::Accepted)
		{
			return Verdict;
		}

		if (bHasSequence && Head.Sequence > LastSequence + 1)
		{
			StatsData.LostPackets += static_cast<uint64_t>(Head.Sequence - LastSequence - 1);
		}
		bHasSequence = true;
		LastSequence = Head.Sequence;
		LastCaptureUs = Head.CaptureTimeUs;
		LastAcceptedReceiveTime = ReceiveTimeSeconds;
		if (Packet.bValuesClamped)
		{
			++StatsData.ClampedPackets;
		}

		const double PipelineSeconds = static_cast<double>(Head.SendTimeUs - Head.CaptureTimeUs) * 1.0e-6;

		switch (Head.Type)
		{
		case PacketType::PoseFrame:
		{
			bHasPose = true;
			Pose = Packet.Pose;
			for (int Index = 0; Index < Packet.Pose.EventCount; ++Index)
			{
				const TrackerEvent& Event = Packet.Pose.Events[Index];
				if (Event.EventId <= LastEventId)
				{
					++StatsData.EventsDuplicate;
					continue;
				}
				LastEventId = Event.EventId;
				if (PendingCount >= kPendingCapacity)
				{
					++StatsData.EventsOverflow;
					continue;
				}
				PendingPunch& Slot = Pending[PendingCount++];
				Slot.Punch.PunchHand = Event.EventHand;
				Slot.Punch.Strength = Event.Strength;
				Slot.Punch.Confidence = Event.Confidence;
				Slot.Punch.SourceEventId = Event.EventId;
				// Age of the event at receive time = age inside the frame + capture->send pipeline.
				const double AgeAtReceive = static_cast<double>(Event.AgeUs) * 1.0e-6 + PipelineSeconds;
				Slot.CaptureTimeOnReceiveClock = ReceiveTimeSeconds - AgeAtReceive;
			}
			break;
		}
		case PacketType::Status:
			bHasStatus = true;
			Status = Packet.Status;
			break;
		case PacketType::ControlAck:
			Acks[AckNext] = Packet.Ack;
			AckNext = (AckNext + 1) % kAckCapacity;
			if (AckCount < kAckCapacity)
			{
				++AckCount;
			}
			break;
		case PacketType::Control:
			break;
		}
		return GateVerdict::Accepted;
	}

	bool PacketGate::IsLive(double NowSeconds) const
	{
		return bBound && (NowSeconds - LastAcceptedReceiveTime) <= Config.LivenessTimeout;
	}

	InputFrame PacketGate::BuildFrame(double NowSeconds)
	{
		InputFrame Frame;
		const bool bLive = IsLive(NowSeconds);
		if (!bLive || !bHasPose)
		{
			Frame.Status = TrackingStatus::Offline;
			// Punches from a dead stream are never delivered late.
			StatsData.EventsStale += static_cast<uint64_t>(PendingCount);
			PendingCount = 0;
			return Frame;
		}

		switch (Pose.State)
		{
		case TrackerState::Starting: Frame.Status = TrackingStatus::Starting; break;
		case TrackerState::NoCamera: Frame.Status = TrackingStatus::NoCamera; break;
		case TrackerState::NoPerson: Frame.Status = TrackingStatus::NoPerson; break;
		case TrackerState::LowConfidence: Frame.Status = TrackingStatus::LowConfidence; break;
		case TrackerState::Tracking:
			if (Pose.Calibration == CalibrationState::InProgress)
			{
				Frame.Status = TrackingStatus::Calibrating;
			}
			else if (Pose.Calibration != CalibrationState::Valid)
			{
				Frame.Status = TrackingStatus::NotCalibrated;
			}
			else
			{
				Frame.Status = TrackingStatus::Live;
			}
			break;
		}

		Frame.Confidence = Pose.Confidence;
		Frame.LeanLateral = Pose.LeanLateral;
		Frame.LeanForward = Pose.LeanForward;
		Frame.BlockAmount = Pose.BlockAmount;
		for (int Side = 0; Side < 2; ++Side)
		{
			Frame.HandPos[Side] = Pose.HandPos[Side];
			Frame.HandExtension[Side] = Pose.HandExtension[Side];
			Frame.HandConfidence[Side] = Pose.HandConfidence[Side];
		}
		Frame.bMirrorApplied = (Pose.Flags & kPoseFlagMirrorApplied) != 0;

		for (int Index = 0; Index < PendingCount; ++Index)
		{
			PendingPunch& Slot = Pending[Index];
			const double Age = NowSeconds - Slot.CaptureTimeOnReceiveClock;
			if (Age > Config.MaxEventAge)
			{
				++StatsData.EventsStale;
				continue;
			}
			Slot.Punch.AgeSeconds = static_cast<float>(Age);
			if (Frame.AddPunch(Slot.Punch))
			{
				++StatsData.EventsAccepted;
			}
			else
			{
				++StatsData.EventsOverflow;
			}
		}
		PendingCount = 0;
		return Frame;
	}

	bool PacketGate::FindAck(uint32_t CommandId, ControlAckPayload& OutAck) const
	{
		for (int Index = 0; Index < AckCount; ++Index)
		{
			if (Acks[Index].CommandId == CommandId)
			{
				OutAck = Acks[Index];
				return true;
			}
		}
		return false;
	}

	void PacketGate::Rebind(uint32_t NewInstance)
	{
		bBound = true;
		Instance = NewInstance;
		bHasSequence = false;
		LastSequence = 0;
		LastCaptureUs = 0;
		LastEventId = 0;
		PendingCount = 0;
		bHasPose = false;
		bHasStatus = false;
		AckCount = 0;
		AckNext = 0;
	}

	void PacketGate::Reset()
	{
		const GateConfig Saved = Config;
		*this = PacketGate(Saved);
	}
}
