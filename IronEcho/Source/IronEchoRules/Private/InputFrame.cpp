#include "IronEchoRules/InputFrame.h"

namespace IronEchoCore
{
	const char* TrackingStatusName(TrackingStatus Status)
	{
		switch (Status)
		{
		case TrackingStatus::Offline: return "Offline";
		case TrackingStatus::Starting: return "Starting";
		case TrackingStatus::NoCamera: return "NoCamera";
		case TrackingStatus::NoPerson: return "NoPerson";
		case TrackingStatus::LowConfidence: return "LowConfidence";
		case TrackingStatus::NotCalibrated: return "NotCalibrated";
		case TrackingStatus::Calibrating: return "Calibrating";
		case TrackingStatus::Live: return "Live";
		}
		return "Unknown";
	}

	FighterIntent IntentMapper::Map(const InputFrame& Frame)
	{
		FighterIntent Intent;
		if (Frame.Status != TrackingStatus::Live)
		{
			// Not usable for gameplay: neutral intent, forget hysteresis so re-entry starts clean.
			Reset();
			return Intent;
		}

		Intent.LeanLateral = Clamp(Frame.LeanLateral, -1.5f, 1.5f);

		// Dodge with hysteresis; direction can flip only through the exit band.
		const float Lean = Frame.LeanLateral;
		const float AbsLean = AbsValue(Lean);
		if (CurrentDodge == DodgeDir::None)
		{
			if (AbsLean >= Config.DodgeEnter)
			{
				CurrentDodge = Lean < 0.0f ? DodgeDir::Left : DodgeDir::Right;
			}
		}
		else
		{
			const bool bSameSide = (CurrentDodge == DodgeDir::Left) ? (Lean < 0.0f) : (Lean > 0.0f);
			if (!bSameSide || AbsLean < Config.DodgeExit)
			{
				CurrentDodge = DodgeDir::None;
				if (AbsLean >= Config.DodgeEnter)
				{
					CurrentDodge = Lean < 0.0f ? DodgeDir::Left : DodgeDir::Right;
				}
			}
		}
		Intent.Dodge = CurrentDodge;

		// Punches: a punch physically leaves the guard, so it cancels the block for this frame.
		for (int32_t Index = 0; Index < Frame.PunchCount; ++Index)
		{
			const PunchIntent& Punch = Frame.Punches[Index];
			if (Punch.Confidence >= Config.MinPunchConfidence)
			{
				Intent.AddPunch(Punch.PunchHand, Punch.Strength, Punch.Zone, Punch.Kind);
			}
		}

		if (bBlocking)
		{
			bBlocking = Frame.BlockAmount >= Config.BlockExit;
		}
		else
		{
			bBlocking = Frame.BlockAmount >= Config.BlockEnter;
		}
		if (Intent.PunchCount > 0)
		{
			bBlocking = false;
		}
		Intent.bBlock = bBlocking;

		// Footwork: a direct source wins; otherwise the camera's forward lean steps in or out (hysteresis).
		const float Fwd = Frame.LeanForward;
		if (CurrentStep == 0)
		{
			CurrentStep = Fwd >= Config.StepEnter ? 1 : (Fwd <= -Config.StepEnter ? -1 : 0);
		}
		else if ((CurrentStep > 0 && Fwd < Config.StepExit) || (CurrentStep < 0 && Fwd > -Config.StepExit))
		{
			CurrentStep = 0;
		}
		const bool bDirect = Frame.MoveForward != 0.0f || Frame.MoveLateral != 0.0f;
		Intent.MoveForward = bDirect ? Clamp(Frame.MoveForward, -1.0f, 1.0f) : static_cast<float>(CurrentStep);
		Intent.MoveSide = Clamp(Frame.MoveLateral, -1.0f, 1.0f);
		return Intent;
	}

	void IntentMapper::Reset()
	{
		bBlocking = false;
		CurrentDodge = DodgeDir::None;
		CurrentStep = 0;
	}
}
