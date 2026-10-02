#include "IronEchoTrackingSubsystem.h"

#include "Common/UdpSocketBuilder.h"
#include "HAL/PlatformTime.h"
#include "Interfaces/IPv4/IPv4Address.h"
#include "IronEchoConversions.h"
#include "IronEchoSettings.h"
#include "Misc/Guid.h"
#include "Misc/Paths.h"
#include "SocketSubsystem.h"
#include "Sockets.h"

namespace IronEchoTrackingLocal
{
	constexpr int32 PortSearchRange = 10;
	constexpr double PingPeriod = 1.0;
	constexpr double CommandResendPeriod = 0.25;
	constexpr double CommandGiveUpSeconds = 3.0;
	constexpr int32 MaxDatagramsPerPoll = 512;
}
using IronEchoCore::GateConfig;
using IronEchoCore::GateStats;
using IronEchoCore::GateVerdict;
using IronEchoCore::InputFrame;
using IronEchoCore::PacketGate;
namespace Protocol = IronEchoCore::Protocol;

void UIronEchoTrackingSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);
	const UIronEchoSettings* Settings = GetDefault<UIronEchoSettings>();

	// Non-zero random session token: packets from any other process/session are rejected by the gate.
	const FGuid Guid = FGuid::NewGuid();
	SessionToken = (Guid.A ^ Guid.B ^ Guid.C ^ Guid.D) | 1u;

	GateConfig Config;
	Config.LivenessTimeout = Settings->LivenessTimeoutSeconds;
	Config.MaxPipelineLatency = Settings->MaxPipelineLatencySeconds;
	Config.MaxEventAge = Settings->MaxEventAgeSeconds;
	Gate = MakeUnique<PacketGate>(Config);

	if (Settings->TrackerLaunchMode != EIronEchoTrackerLaunchMode::Disabled)
	{
		if (OpenSocket())
		{
			LaunchTracker();
		}
	}
	TickerHandle = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateUObject(this, &UIronEchoTrackingSubsystem::HandleTicker), 0.0f);
}

void UIronEchoTrackingSubsystem::Deinitialize()
{
	FTSTicker::GetCoreTicker().RemoveTicker(TickerHandle);
	StopTracker();
	CloseSocket();
	Gate.Reset();
	Super::Deinitialize();
}

bool UIronEchoTrackingSubsystem::OpenSocket()
{
	const UIronEchoSettings* Settings = GetDefault<UIronEchoSettings>();
	for (int32 Offset = 0; Offset < IronEchoTrackingLocal::PortSearchRange; ++Offset)
	{
		const int32 Port = Settings->GameListenPort + Offset;
		FSocket* NewSocket = FUdpSocketBuilder(TEXT("IronEchoTrackerLink"))
			.AsNonBlocking()
			.BoundToAddress(FIPv4Address(127, 0, 0, 1))
			.BoundToPort(Port)
			.WithReceiveBufferSize(1 << 20)
			.WithSendBufferSize(1 << 16)
			.Build();
		if (NewSocket != nullptr)
		{
			Socket = NewSocket;
			BoundPort = Port;
			TrackerControlPort = Settings->TrackerControlPort + Offset;
			UE_LOG(LogIronEcho, Log, TEXT("Tracker link listening on 127.0.0.1:%d (tracker control port %d)"), BoundPort, TrackerControlPort);
			return true;
		}
	}
	ProcessError = EIronEchoTrackerError::SocketBindFailed;
	UE_LOG(LogIronEcho, Error, TEXT("Could not bind a UDP port in %d..%d"), Settings->GameListenPort, Settings->GameListenPort + IronEchoTrackingLocal::PortSearchRange - 1);
	return false;
}

void UIronEchoTrackingSubsystem::CloseSocket()
{
	if (Socket != nullptr)
	{
		Socket->Close();
		ISocketSubsystem::Get(PLATFORM_SOCKETSUBSYSTEM)->DestroySocket(Socket);
		Socket = nullptr;
	}
}

bool UIronEchoTrackingSubsystem::ResolveTrackerCommand(FString& OutExecutable, FString& OutArgs, FString& OutWorkingDir) const
{
	const UIronEchoSettings* Settings = GetDefault<UIronEchoSettings>();
	const FString ProjectDir = FPaths::ConvertRelativePathToFull(FPaths::ProjectDir());
	const FString Packaged = FPaths::Combine(ProjectDir, Settings->PackagedTrackerRelativePath);
	FString DevPython = FPaths::Combine(ProjectDir, Settings->DevTrackerPythonRelativePath);
	if (!FPaths::FileExists(DevPython))
	{
		const FString PosixPython = FPaths::Combine(ProjectDir, TEXT("Tracking/.venv/bin/python"));
		if (FPaths::FileExists(PosixPython))
		{
			DevPython = PosixPython;
		}
	}

	EIronEchoTrackerLaunchMode Mode = Settings->TrackerLaunchMode;
	if (Mode == EIronEchoTrackerLaunchMode::Auto)
	{
		Mode = FPaths::FileExists(Packaged) ? EIronEchoTrackerLaunchMode::Packaged
			: (FPaths::FileExists(DevPython) ? EIronEchoTrackerLaunchMode::DevPython : EIronEchoTrackerLaunchMode::External);
	}

	const FString LogDir = FPaths::ConvertRelativePathToFull(FPaths::Combine(FPaths::ProjectLogDir(), TEXT("Tracker")));
	const FString Common = FString::Printf(
		TEXT("run --camera %d --model %s --game-port %d --control-port %d --token %u --parent-pid %u --managed --log-dir \"%s\" %s"),
		Settings->CameraIndex, *Settings->TrackerModel, BoundPort, TrackerControlPort, SessionToken,
		FPlatformProcess::GetCurrentProcessId(), *LogDir, *Settings->TrackerExtraArgs);

	if (Mode == EIronEchoTrackerLaunchMode::Packaged)
	{
		OutExecutable = Packaged;
		OutArgs = Common;
		OutWorkingDir = FPaths::GetPath(Packaged);
		return FPaths::FileExists(Packaged);
	}
	if (Mode == EIronEchoTrackerLaunchMode::DevPython)
	{
		OutExecutable = DevPython;
		OutArgs = FString(TEXT("-m iron_echo_tracker ")) + Common;
		OutWorkingDir = FPaths::Combine(ProjectDir, TEXT("Tracking"));
		return FPaths::FileExists(DevPython);
	}
	return false; // External / Disabled: nothing to launch
}

void UIronEchoTrackingSubsystem::LaunchTracker()
{
	FString Executable;
	FString Args;
	FString WorkingDir;
	const UIronEchoSettings* Settings = GetDefault<UIronEchoSettings>();
	if (!ResolveTrackerCommand(Executable, Args, WorkingDir))
	{
		bManagedProcess = false;
#if UE_BUILD_SHIPPING
		ProcessError = EIronEchoTrackerError::ProcessNotFound;
		UE_LOG(LogIronEcho, Error, TEXT("Tracker executable not found (mode %d)."), static_cast<int32>(Settings->TrackerLaunchMode));
#else
		// Developer convenience: accept a hand-started tracker with token 0 on the default ports.
		GateConfig Config = Gate->GetConfig();
		Config.ExpectedToken = 0;
		Gate->SetConfig(Config);
		UE_LOG(LogIronEcho, Warning, TEXT("No tracker launched (External mode). Start one with: python -m iron_echo_tracker run --preview --game-port %d --control-port %d"),
			BoundPort, TrackerControlPort);
#endif
		return;
	}

	GateConfig Config = Gate->GetConfig();
	Config.ExpectedToken = SessionToken;
	Gate->SetConfig(Config);

	uint32 ProcessId = 0;
	TrackerProcess = FPlatformProcess::CreateProc(*Executable, *Args, false, true, true, &ProcessId, 0, *WorkingDir, nullptr, nullptr);
	bManagedProcess = TrackerProcess.IsValid();
	if (bManagedProcess)
	{
		ProcessError = EIronEchoTrackerError::None;
		UE_LOG(LogIronEcho, Log, TEXT("Tracker started (pid %u): %s %s"), ProcessId, *Executable, *Args);
	}
	else
	{
		ProcessError = EIronEchoTrackerError::ProcessNotFound;
		UE_LOG(LogIronEcho, Error, TEXT("Failed to start tracker: %s"), *Executable);
	}
	LastPingTime = 0.0;
}

void UIronEchoTrackingSubsystem::StopTracker()
{
	if (!TrackerProcess.IsValid())
	{
		return;
	}
	if (FPlatformProcess::IsProcRunning(TrackerProcess))
	{
		// Polite shutdown first (the tracker releases the camera), then hard stop.
		FPendingCommand Shutdown;
		Shutdown.Command = Protocol::ControlCommand::Shutdown;
		Shutdown.CommandId = NextCommandId++;
		SendCommand(Shutdown, FPlatformTime::Seconds());
		const double Deadline = FPlatformTime::Seconds() + 0.5;
		while (FPlatformProcess::IsProcRunning(TrackerProcess) && FPlatformTime::Seconds() < Deadline)
		{
			FPlatformProcess::Sleep(0.02f);
		}
		if (FPlatformProcess::IsProcRunning(TrackerProcess))
		{
			FPlatformProcess::TerminateProc(TrackerProcess, true);
		}
	}
	FPlatformProcess::CloseProc(TrackerProcess);
	TrackerProcess.Reset();
	bManagedProcess = false;
}

void UIronEchoTrackingSubsystem::RestartTracker()
{
	StopTracker();
	RestartCount = 0;
	if (Socket != nullptr)
	{
		LaunchTracker();
	}
}

bool UIronEchoTrackingSubsystem::IsTrackerProcessRunning() const
{
	FProcHandle Handle = TrackerProcess;
	return Handle.IsValid() && FPlatformProcess::IsProcRunning(Handle);
}

void UIronEchoTrackingSubsystem::Poll()
{
	if (Socket == nullptr || !Gate.IsValid())
	{
		return;
	}
	const double Now = FPlatformTime::Seconds();
	LastPollTime = Now;
	TSharedRef<FInternetAddr> Sender = ISocketSubsystem::Get(PLATFORM_SOCKETSUBSYSTEM)->CreateInternetAddr();
	uint8 Buffer[2048];
	uint32 PendingSize = 0;
	for (int32 Count = 0; Count < IronEchoTrackingLocal::MaxDatagramsPerPoll && Socket->HasPendingData(PendingSize); ++Count)
	{
		int32 BytesRead = 0;
		if (!Socket->RecvFrom(Buffer, sizeof(Buffer), BytesRead, *Sender))
		{
			break;
		}
		if (BytesRead > 0)
		{
			Gate->Submit(Buffer, static_cast<size_t>(BytesRead), Now);
		}
	}

	// Drop acknowledged commands.
	for (int32 Index = PendingCommands.Num() - 1; Index >= 0; --Index)
	{
		Protocol::ControlAckPayload Ack;
		if (Gate->FindAck(PendingCommands[Index].CommandId, Ack))
		{
			UE_LOG(LogIronEcho, Verbose, TEXT("Tracker acked command %u (result %d)"), Ack.CommandId, static_cast<int32>(Ack.Result));
			PendingCommands.RemoveAt(Index);
		}
	}
}

InputFrame UIronEchoTrackingSubsystem::BuildInputFrame()
{
	if (!Gate.IsValid())
	{
		return InputFrame();
	}
	LastBuildTime = FPlatformTime::Seconds();
	const InputFrame Frame = Gate->BuildFrame(LastBuildTime);
	LastStatus = IronEchoConvert::ToUnreal(Frame.Status);
	return Frame;
}

FIronEchoTrackingHud UIronEchoTrackingSubsystem::GetTrackingHud() const
{
	FIronEchoTrackingHud Hud;
	Hud.Status = LastStatus;
	Hud.bTrackerProcessRunning = IsTrackerProcessRunning();
	Hud.LastError = ProcessError;
	if (!Gate.IsValid())
	{
		return Hud;
	}
	const GateStats& Stats = Gate->Stats();
	Hud.PacketsAccepted = static_cast<int64>(Stats.Verdicts[static_cast<int>(GateVerdict::Accepted)]);
	int64 Rejected = 0;
	for (int Index = 1; Index < static_cast<int>(GateVerdict::Count); ++Index)
	{
		Rejected += static_cast<int64>(Stats.Verdicts[Index]);
	}
	Hud.PacketsRejected = Rejected;
	Hud.PacketsLost = static_cast<int64>(Stats.LostPackets);
	Hud.PunchesAccepted = static_cast<int64>(Stats.EventsAccepted);
	Hud.PunchesStale = static_cast<int64>(Stats.EventsStale);
	if (Gate->HasStatus())
	{
		const Protocol::StatusPayload& Status = Gate->LatestStatus();
		Hud.CalibrationStep = IronEchoConvert::ToUnreal(Status.Step);
		Hud.CalibrationProgress = Status.CalibrationProgress;
		Hud.CalibrationFailure = IronEchoConvert::ToUnreal(Status.Failure);
		Hud.bMirrorApplied = Status.MirrorApplied != 0;
		Hud.CameraFps = Status.CameraFps;
		Hud.InferenceMs = Status.InferenceMs;
		Hud.PipelineLatencyMs = Status.PipelineLatencyMs;
		Hud.CameraWidth = Status.CameraWidth;
		Hud.CameraHeight = Status.CameraHeight;
		Hud.ModelName = UTF8_TO_TCHAR(Status.ModelName);
		if (Status.LastError != Protocol::TrackerError::NoError)
		{
			Hud.LastError = IronEchoConvert::ToUnreal(Status.LastError);
		}
	}
	return Hud;
}

void UIronEchoTrackingSubsystem::RequestCalibration(bool bFull)
{
	QueueCommand(bFull ? Protocol::ControlCommand::StartCalibrationFull : Protocol::ControlCommand::StartCalibrationQuick);
}

void UIronEchoTrackingSubsystem::CancelCalibration()
{
	QueueCommand(Protocol::ControlCommand::CancelCalibration);
}

void UIronEchoTrackingSubsystem::SetTrackerPreview(bool bVisible)
{
	QueueCommand(Protocol::ControlCommand::SetPreview, bVisible ? 1 : 0);
}

void UIronEchoTrackingSubsystem::QueueCommand(Protocol::ControlCommand Command, uint8 Arg)
{
	FPendingCommand Pending;
	Pending.Command = Command;
	Pending.Arg = Arg;
	Pending.CommandId = NextCommandId++;
	Pending.FirstSent = FPlatformTime::Seconds();
	SendCommand(Pending, Pending.FirstSent);
	if (Command != Protocol::ControlCommand::Ping)
	{
		PendingCommands.Add(Pending);
	}
}

void UIronEchoTrackingSubsystem::SendCommand(FPendingCommand& Pending, double Now)
{
	if (Socket == nullptr || TrackerControlPort <= 0)
	{
		return;
	}
	Protocol::Header Head;
	Head.SessionToken = SessionToken;
	Head.Sequence = ++ControlSequence;
	Head.CaptureTimeUs = static_cast<uint64>(Now * 1.0e6);
	Head.SendTimeUs = Head.CaptureTimeUs;
	Protocol::ControlPayload Payload;
	Payload.Command = Pending.Command;
	Payload.Arg = Pending.Arg;
	Payload.CommandId = Pending.CommandId;
	uint8 Buffer[Protocol::kMaxDatagramSize];
	const size_t Size = Protocol::EncodeControl(Head, Payload, Buffer, sizeof(Buffer));
	if (Size == 0)
	{
		return;
	}
	TSharedRef<FInternetAddr> Destination = ISocketSubsystem::Get(PLATFORM_SOCKETSUBSYSTEM)->CreateInternetAddr();
	Destination->SetLoopbackAddress();
	Destination->SetPort(TrackerControlPort);
	int32 Sent = 0;
	Socket->SendTo(Buffer, static_cast<int32>(Size), Sent, *Destination);
	Pending.LastSent = Now;
}

bool UIronEchoTrackingSubsystem::HandleTicker(float DeltaSeconds)
{
	const double Now = FPlatformTime::Seconds();

	// Keep status fresh in menus, when no game mode consumes input every frame. Punches drained here are
	// older than MaxEventAge anyway, so a gameplay hitch never loses a punch that would still be valid.
	if (Now - LastBuildTime > 0.5)
	{
		Poll();
		BuildInputFrame();
	}

	if (Socket != nullptr && Now - LastPingTime >= IronEchoTrackingLocal::PingPeriod)
	{
		LastPingTime = Now;
		QueueCommand(Protocol::ControlCommand::Ping);
	}

	for (int32 Index = PendingCommands.Num() - 1; Index >= 0; --Index)
	{
		FPendingCommand& Pending = PendingCommands[Index];
		if (Now - Pending.FirstSent > IronEchoTrackingLocal::CommandGiveUpSeconds)
		{
			UE_LOG(LogIronEcho, Warning, TEXT("Tracker did not acknowledge command %d (id %u)"), static_cast<int32>(Pending.Command), Pending.CommandId);
			PendingCommands.RemoveAt(Index);
		}
		else if (Now - Pending.LastSent >= IronEchoTrackingLocal::CommandResendPeriod)
		{
			SendCommand(Pending, Now);
		}
	}

	// Supervise a tracker we launched: restart a crashed process with a small backoff.
	if (bManagedProcess && !FPlatformProcess::IsProcRunning(TrackerProcess))
	{
		const UIronEchoSettings* Settings = GetDefault<UIronEchoSettings>();
		int32 ReturnCode = 0;
		FPlatformProcess::GetProcReturnCode(TrackerProcess, &ReturnCode);
		FPlatformProcess::CloseProc(TrackerProcess);
		TrackerProcess.Reset();
		bManagedProcess = false;
		ProcessError = EIronEchoTrackerError::ProcessCrashed;
		UE_LOG(LogIronEcho, Warning, TEXT("Tracker exited with code %d"), ReturnCode);
		if (RestartCount < Settings->MaxTrackerRestarts)
		{
			++RestartCount;
			NextRestartTime = Now + 2.0 * RestartCount;
		}
	}
	if (!bManagedProcess && NextRestartTime > 0.0 && Now >= NextRestartTime)
	{
		NextRestartTime = 0.0;
		UE_LOG(LogIronEcho, Log, TEXT("Restarting tracker (attempt %d)"), RestartCount);
		LaunchTracker();
	}
	return true;
}
