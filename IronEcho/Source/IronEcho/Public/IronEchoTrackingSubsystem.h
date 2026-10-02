// Owns the tracker process and the loopback UDP link (Docs/Contracts/LOCAL_PROTOCOL.md).
// All protocol validation is done by IronEchoCore::PacketGate (unit-tested outside Unreal).
#pragma once

#include "CoreMinimal.h"
#include "Containers/Ticker.h"
#include "HAL/PlatformProcess.h"
#include "IronEchoRules/InputFrame.h"
#include "IronEchoRules/PacketGate.h"
#include "IronEchoRules/Protocol.h"
#include "IronEchoTypes.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "Templates/UniquePtr.h"

#include "IronEchoTrackingSubsystem.generated.h"

class FSocket;

UCLASS()
class IRONECHO_API UIronEchoTrackingSubsystem : public UGameInstanceSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;

	/** Drains the socket into the packet gate. Cheap; call at the start of every game frame. */
	void Poll();

	/** Latest tracker pose as an InputFrame; drains punch events that are still fresh. */
	IronEchoCore::InputFrame BuildInputFrame();

	UFUNCTION(BlueprintPure, Category = "IronEcho|Tracking")
	FIronEchoTrackingHud GetTrackingHud() const;

	UFUNCTION(BlueprintCallable, Category = "IronEcho|Tracking")
	void RequestCalibration(bool bFull);

	UFUNCTION(BlueprintCallable, Category = "IronEcho|Tracking")
	void CancelCalibration();

	UFUNCTION(BlueprintCallable, Category = "IronEcho|Tracking")
	void SetTrackerPreview(bool bVisible);

	UFUNCTION(BlueprintCallable, Category = "IronEcho|Tracking")
	void RestartTracker();

	UFUNCTION(BlueprintPure, Category = "IronEcho|Tracking")
	bool IsTrackerProcessRunning() const;

	UFUNCTION(BlueprintPure, Category = "IronEcho|Tracking")
	EIronEchoTrackingStatus GetTrackingStatus() const { return LastStatus; }

private:
	struct FPendingCommand
	{
		IronEchoCore::Protocol::ControlCommand Command = IronEchoCore::Protocol::ControlCommand::Ping;
		uint8 Arg = 0;
		uint32 CommandId = 0;
		double FirstSent = 0.0;
		double LastSent = -1.0;
	};

	bool HandleTicker(float DeltaSeconds);
	bool OpenSocket();
	void CloseSocket();
	void LaunchTracker();
	void StopTracker();
	void QueueCommand(IronEchoCore::Protocol::ControlCommand Command, uint8 Arg = 0);
	void SendCommand(FPendingCommand& Pending, double Now);
	bool ResolveTrackerCommand(FString& OutExecutable, FString& OutArgs, FString& OutWorkingDir) const;

	FSocket* Socket = nullptr;
	int32 BoundPort = 0;
	int32 TrackerControlPort = 0;
	uint32 SessionToken = 0;
	TUniquePtr<IronEchoCore::PacketGate> Gate;

	FProcHandle TrackerProcess;
	bool bManagedProcess = false;
	int32 RestartCount = 0;
	double NextRestartTime = 0.0;
	EIronEchoTrackerError ProcessError = EIronEchoTrackerError::None;

	TArray<FPendingCommand> PendingCommands;
	uint32 NextCommandId = 1;
	uint32 ControlSequence = 0;
	double LastPingTime = 0.0;
	double LastPollTime = 0.0;
	double LastBuildTime = 0.0;
	EIronEchoTrackingStatus LastStatus = EIronEchoTrackingStatus::Offline;

	FTSTicker::FDelegateHandle TickerHandle;
};
