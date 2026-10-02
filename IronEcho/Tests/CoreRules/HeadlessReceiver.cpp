// Headless game-side receiver for cross-process tests without Unreal:
//   tracker (Python, UDP) -> PacketGate -> IntentMapper -> Match (Training or Bout) -> confirmed hits.
// It mirrors what UIronEchoTrackingSubsystem + AIronEchoGameMode do inside Unreal, using the same core code.
//
//   IronEchoHeadless --port 47810 --token 1234 --seconds 8 --mode training --expect-hits 3 [--control-port 47811]
#include "IronEchoRules/InputFrame.h"
#include "IronEchoRules/Match.h"
#include "IronEchoRules/PacketGate.h"
#include "IronEchoRules/Protocol.h"

#include <arpa/inet.h>
#include <netinet/in.h>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>

#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>

using namespace IronEchoCore;

namespace
{
	double NowSeconds()
	{
		using namespace std::chrono;
		return duration<double>(steady_clock::now().time_since_epoch()).count();
	}

	uint64_t NowMicros()
	{
		using namespace std::chrono;
		return static_cast<uint64_t>(duration_cast<microseconds>(steady_clock::now().time_since_epoch()).count());
	}

	const char* Arg(int Count, char** Args, const char* Name, const char* Default)
	{
		for (int Index = 1; Index + 1 < Count; ++Index)
		{
			if (std::strcmp(Args[Index], Name) == 0)
			{
				return Args[Index + 1];
			}
		}
		return Default;
	}
}

int main(int Count, char** Args)
{
	const int Port = std::atoi(Arg(Count, Args, "--port", "47810"));
	const uint32_t Token = static_cast<uint32_t>(std::strtoul(Arg(Count, Args, "--token", "0"), nullptr, 10));
	const double Seconds = std::atof(Arg(Count, Args, "--seconds", "8"));
	const std::string Mode = Arg(Count, Args, "--mode", "training");
	const int ExpectHits = std::atoi(Arg(Count, Args, "--expect-hits", "1"));
	const int ControlPort = std::atoi(Arg(Count, Args, "--control-port", "0"));

	const int Socket = ::socket(AF_INET, SOCK_DGRAM, 0);
	sockaddr_in Address{};
	Address.sin_family = AF_INET;
	Address.sin_port = htons(static_cast<uint16_t>(Port));
	Address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
	if (Socket < 0 || ::bind(Socket, reinterpret_cast<sockaddr*>(&Address), sizeof(Address)) != 0)
	{
		std::fprintf(stderr, "bind 127.0.0.1:%d failed\n", Port);
		return 2;
	}

	GateConfig GateCfg;
	GateCfg.ExpectedToken = Token;
	PacketGate Gate(GateCfg);
	IntentMapper Mapper;
	MatchSetup Setup;
	Setup.Mode = Mode == "bout" ? MatchMode::Bout : MatchMode::Training;
	Setup.Rules.ReadyStableTicks = SecondsToTicks(0.3);
	Setup.Rules.CountdownTicks = SecondsToTicks(0.5);
	Match Game(Setup);
	CombatEventBuffer CombatEvents;
	MatchEventBuffer MatchEvents;

	// Optional: exercise the control path (game -> tracker). Commands are resent until acknowledged,
	// exactly as LOCAL_PROTOCOL.md requires (a command sent before the tracker binds its port is lost).
	const uint32_t ControlId = ControlPort > 0 ? 4242u : 0u;
	uint32_t ControlSequence = 0;
	double LastControlSend = -1.0;
	sockaddr_in ControlDest{};
	ControlDest.sin_family = AF_INET;
	ControlDest.sin_port = htons(static_cast<uint16_t>(ControlPort > 0 ? ControlPort : 0));
	ControlDest.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
	auto SendControl = [&]() {
		Protocol::Header Head;
		Head.SessionToken = Token;
		Head.Sequence = ++ControlSequence;
		Head.CaptureTimeUs = NowMicros();
		Head.SendTimeUs = Head.CaptureTimeUs;
		Protocol::ControlPayload Control;
		Control.Command = Protocol::ControlCommand::Ping;
		Control.CommandId = ControlId;
		uint8_t Out[Protocol::kMaxDatagramSize];
		const size_t Size = Protocol::EncodeControl(Head, Control, Out, sizeof(Out));
		::sendto(Socket, Out, Size, 0, reinterpret_cast<sockaddr*>(&ControlDest), sizeof(ControlDest));
	};

	const double Start = NowSeconds();
	double SimClock = Start;
	int Punches = 0;
	int Hits = 0;
	int Packets = 0;
	TrackingStatus LastStatus = TrackingStatus::Offline;
	uint8_t Buffer[2048];
	while (NowSeconds() - Start < Seconds)
	{
		pollfd Poll{Socket, POLLIN, 0};
		if (::poll(&Poll, 1, 2) > 0)
		{
			for (;;)
			{
				const ssize_t Received = ::recv(Socket, Buffer, sizeof(Buffer), MSG_DONTWAIT);
				if (Received <= 0)
				{
					break;
				}
				++Packets;
				Gate.Submit(Buffer, static_cast<size_t>(Received), NowSeconds());
			}
		}

		const double Now = NowSeconds();
		Protocol::ControlAckPayload PendingAck;
		if (ControlId != 0 && !Gate.FindAck(ControlId, PendingAck) && Now - LastControlSend >= 0.25)
		{
			LastControlSend = Now;
			SendControl();
		}
		while (SimClock + kTickSeconds <= Now)
		{
			SimClock += kTickSeconds;
			const InputFrame Frame = Gate.BuildFrame(SimClock);
			if (Frame.Status != LastStatus)
			{
				std::printf("[%.3f] tracking %s -> %s\n", SimClock - Start, TrackingStatusName(LastStatus), TrackingStatusName(Frame.Status));
				LastStatus = Frame.Status;
			}
			Punches += Frame.PunchCount;
			MatchInput Input;
			Input.PlayerIntent = Mapper.Map(Frame);
			Input.bInputReady = Frame.Status == TrackingStatus::Live;
			CombatEvents.Clear();
			MatchEvents.Clear();
			Game.Tick(Input, CombatEvents, MatchEvents);
			for (const MatchEvent& Event : MatchEvents)
			{
				if (Event.Type == MatchEventType::PhaseChanged)
				{
					std::printf("[%.3f] phase %s\n", SimClock - Start, MatchPhaseName(Event.Phase));
				}
			}
			for (const CombatEvent& Event : CombatEvents)
			{
				if (Event.Actor == FighterSlot::Player && (Event.Type == CombatEventType::HitConfirmed || Event.Type == CombatEventType::AttackStarted))
				{
					std::printf("[%.3f] player %s %s\n", SimClock - Start, CombatEventName(Event.Type), Event.AttackHand == Hand::Left ? "left" : "right");
				}
				Hits += (Event.Type == CombatEventType::HitConfirmed && Event.Actor == FighterSlot::Player) ? 1 : 0;
			}
		}
	}
	::close(Socket);

	const GateStats& Stats = Gate.Stats();
	Protocol::ControlAckPayload Ack;
	const bool bAck = ControlId != 0 && Gate.FindAck(ControlId, Ack);
	std::printf("{\"packets\":%d,\"accepted\":%llu,\"decode_failed\":%llu,\"wrong_session\":%llu,\"duplicate\":%llu,"
		"\"stale\":%llu,\"lost\":%llu,\"events_accepted\":%llu,\"events_stale\":%llu,\"punch_intents\":%d,"
		"\"confirmed_hits\":%d,\"training_hits\":%d,\"control_ack\":%s,\"control_sends\":%u}\n",
		Packets,
		static_cast<unsigned long long>(Stats.Verdicts[static_cast<int>(GateVerdict::Accepted)]),
		static_cast<unsigned long long>(Stats.Verdicts[static_cast<int>(GateVerdict::DecodeFailed)]),
		static_cast<unsigned long long>(Stats.Verdicts[static_cast<int>(GateVerdict::WrongSession)]),
		static_cast<unsigned long long>(Stats.Verdicts[static_cast<int>(GateVerdict::DuplicateOrOld)]),
		static_cast<unsigned long long>(Stats.Verdicts[static_cast<int>(GateVerdict::StalePipeline)]),
		static_cast<unsigned long long>(Stats.LostPackets),
		static_cast<unsigned long long>(Stats.EventsAccepted),
		static_cast<unsigned long long>(Stats.EventsStale),
		Punches, Hits, Game.Snapshot().TrainingHits,
		ControlId == 0 ? "null" : (bAck ? "true" : "false"), ControlSequence);
	return Hits >= ExpectHits ? 0 : 1;
}
