// Core (plain C++) <-> Unreal (UENUM / USTRUCT) conversions. Units: core metres -> Unreal centimetres.
#pragma once

#include "CoreMinimal.h"
#include "IronEchoRules/CombatEvents.h"
#include "IronEchoRules/Fighter.h"
#include "IronEchoRules/InputFrame.h"
#include "IronEchoRules/Match.h"
#include "IronEchoRules/Protocol.h"
#include "IronEchoTypes.h"

namespace IronEchoConvert
{
	inline constexpr float MetersToCm = 100.0f;

	inline EIronEchoHand ToUnreal(IronEchoCore::Hand Value) { return Value == IronEchoCore::Hand::Left ? EIronEchoHand::Left : EIronEchoHand::Right; }
	inline IronEchoCore::Hand ToCore(EIronEchoHand Value) { return Value == EIronEchoHand::Left ? IronEchoCore::Hand::Left : IronEchoCore::Hand::Right; }

	inline EIronEchoFighterRole ToUnreal(IronEchoCore::FighterSlot Value)
	{
		return Value == IronEchoCore::FighterSlot::Player ? EIronEchoFighterRole::Player : EIronEchoFighterRole::Opponent;
	}

	inline EIronEchoDodge ToUnreal(IronEchoCore::DodgeDir Value)
	{
		switch (Value)
		{
		case IronEchoCore::DodgeDir::Left: return EIronEchoDodge::Left;
		case IronEchoCore::DodgeDir::Right: return EIronEchoDodge::Right;
		default: return EIronEchoDodge::None;
		}
	}

	// Enumerations below share numeric order with their core twins (static_asserts guard it).
	inline EIronEchoActionState ToUnreal(IronEchoCore::ActionState Value) { return static_cast<EIronEchoActionState>(static_cast<uint8>(Value)); }
	inline EIronEchoAttackStage ToUnreal(IronEchoCore::AttackStage Value) { return static_cast<EIronEchoAttackStage>(static_cast<uint8>(Value)); }
	inline EIronEchoTrackingStatus ToUnreal(IronEchoCore::TrackingStatus Value) { return static_cast<EIronEchoTrackingStatus>(static_cast<uint8>(Value)); }
	inline EIronEchoMatchPhase ToUnreal(IronEchoCore::MatchPhase Value) { return static_cast<EIronEchoMatchPhase>(static_cast<uint8>(Value)); }
	inline EIronEchoPauseReason ToUnreal(IronEchoCore::PauseReason Value) { return static_cast<EIronEchoPauseReason>(static_cast<uint8>(Value)); }
	inline EIronEchoResultMethod ToUnreal(IronEchoCore::ResultMethod Value) { return static_cast<EIronEchoResultMethod>(static_cast<uint8>(Value)); }
	inline EIronEchoCombatEventType ToUnreal(IronEchoCore::CombatEventType Value) { return static_cast<EIronEchoCombatEventType>(static_cast<uint8>(Value)); }
	inline EIronEchoMatchEventType ToUnreal(IronEchoCore::MatchEventType Value) { return static_cast<EIronEchoMatchEventType>(static_cast<uint8>(Value)); }
	inline EIronEchoDecisionKind ToUnreal(IronEchoCore::DecisionKind Value) { return static_cast<EIronEchoDecisionKind>(static_cast<uint8>(Value)); }
	inline EIronEchoCalibrationStep ToUnreal(IronEchoCore::Protocol::CalibrationStep Value) { return static_cast<EIronEchoCalibrationStep>(static_cast<uint8>(Value)); }
	inline EIronEchoCalibrationFailure ToUnreal(IronEchoCore::Protocol::CalibrationFailure Value) { return static_cast<EIronEchoCalibrationFailure>(static_cast<uint8>(Value)); }

	inline EIronEchoTrackerError ToUnreal(IronEchoCore::Protocol::TrackerError Value)
	{
		switch (Value)
		{
		case IronEchoCore::Protocol::TrackerError::CameraOpenFailed: return EIronEchoTrackerError::CameraOpenFailed;
		case IronEchoCore::Protocol::TrackerError::ModelLoadFailed: return EIronEchoTrackerError::ModelLoadFailed;
		case IronEchoCore::Protocol::TrackerError::CameraReadFailed: return EIronEchoTrackerError::CameraReadFailed;
		default: return EIronEchoTrackerError::None;
		}
	}

	inline IronEchoCore::BotLevel ToCore(EIronEchoBotLevel Value)
	{
		switch (Value)
		{
		case EIronEchoBotLevel::Easy: return IronEchoCore::BotLevel::Easy;
		case EIronEchoBotLevel::Hard: return IronEchoCore::BotLevel::Hard;
		default: return IronEchoCore::BotLevel::Normal;
		}
	}

	inline IronEchoCore::MatchMode ToCore(EIronEchoMatchMode Value)
	{
		return Value == EIronEchoMatchMode::Training ? IronEchoCore::MatchMode::Training : IronEchoCore::MatchMode::Bout;
	}

	inline EIronEchoMatchMode ToUnreal(IronEchoCore::MatchMode Value)
	{
		return Value == IronEchoCore::MatchMode::Training ? EIronEchoMatchMode::Training : EIronEchoMatchMode::Bout;
	}

	inline FVector ToUnreal(const IronEchoCore::Vec3& Value)
	{
		return FVector(Value.X, Value.Y, Value.Z);
	}

	static_assert(static_cast<uint8>(IronEchoCore::ActionState::KnockedDown) == static_cast<uint8>(EIronEchoActionState::KnockedDown), "ActionState order");
	static_assert(static_cast<uint8>(IronEchoCore::AttackStage::Recovery) == static_cast<uint8>(EIronEchoAttackStage::Recovery), "AttackStage order");
	static_assert(static_cast<uint8>(IronEchoCore::TrackingStatus::Live) == static_cast<uint8>(EIronEchoTrackingStatus::Live), "TrackingStatus order");
	static_assert(static_cast<uint8>(IronEchoCore::MatchPhase::Knockdown) == static_cast<uint8>(EIronEchoMatchPhase::Knockdown), "MatchPhase order");
	static_assert(static_cast<uint8>(IronEchoCore::PauseReason::TrackingLost) == static_cast<uint8>(EIronEchoPauseReason::TrackingLost), "PauseReason order");
	static_assert(static_cast<uint8>(IronEchoCore::ResultMethod::TechnicalKnockOut) == static_cast<uint8>(EIronEchoResultMethod::TechnicalKnockOut), "ResultMethod order");
	static_assert(static_cast<uint8>(IronEchoCore::CombatEventType::GotUp) == static_cast<uint8>(EIronEchoCombatEventType::GotUp), "CombatEventType order");
	static_assert(static_cast<uint8>(IronEchoCore::MatchEventType::KnockdownCount) == static_cast<uint8>(EIronEchoMatchEventType::KnockdownCount), "MatchEventType order");
	static_assert(static_cast<uint8>(IronEchoCore::DecisionKind::Majority) == static_cast<uint8>(EIronEchoDecisionKind::Majority), "DecisionKind order");
	static_assert(static_cast<uint8>(IronEchoCore::Protocol::CalibrationStep::Done) == static_cast<uint8>(EIronEchoCalibrationStep::Done), "CalibrationStep order");
	static_assert(static_cast<uint8>(IronEchoCore::Protocol::CalibrationFailure::Cancelled) == static_cast<uint8>(EIronEchoCalibrationFailure::Cancelled), "CalibrationFailure order");
}
