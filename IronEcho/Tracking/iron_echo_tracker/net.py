"""UDP link to the game on 127.0.0.1 (LOCAL_PROTOCOL.md).

The tracker sends PoseFrame/Status/ControlAck to the game port and receives Control on its own port.
"""

from __future__ import annotations

import secrets
import socket
import threading
import time
from collections import deque
from dataclasses import dataclass
from typing import Deque, List, Optional

from . import protocol as P
from .pipeline import FrameOutput

LOOPBACK = "127.0.0.1"


def monotonic_us() -> int:
    return time.perf_counter_ns() // 1000


@dataclass
class _SentEvent:
    event_id: int
    hand: int
    strength: float
    confidence: float
    capture_us: int


class TrackerLink:
    def __init__(self, game_port: int, control_port: int, token: int, instance: Optional[int] = None,
                 event_repeat_seconds: float = 0.2):
        self.game_addr = (LOOPBACK, int(game_port))
        self.token = int(token) & 0xFFFFFFFF
        self.instance = instance if instance else (secrets.randbits(32) or 1)
        self.sequence = 0
        self.next_event_id = 1
        self.recent: Deque[_SentEvent] = deque()
        self.event_repeat_us = int(event_repeat_seconds * 1e6)
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.bind((LOOPBACK, int(control_port)))
        self.sock.setblocking(False)
        self.control_port = self.sock.getsockname()[1]
        self.packets_sent = 0
        self.send_errors = 0

    def close(self) -> None:
        self.sock.close()

    def _header(self, capture_us: int) -> P.Header:
        self.sequence += 1
        return P.Header(
            session_token=self.token,
            tracker_instance=self.instance,
            sequence=self.sequence,
            capture_time_us=capture_us,
            send_time_us=max(capture_us, monotonic_us()),
        )

    def _send(self, data: bytes) -> None:
        try:
            self.sock.sendto(data, self.game_addr)
            self.packets_sent += 1
        except OSError:
            # Game not listening yet (ICMP port unreachable on some platforms): keep going.
            self.send_errors += 1

    def send_frame(self, out: FrameOutput, capture_us: int, tracker_fps: float) -> List[int]:
        """Sends one PoseFrame; returns the ids assigned to new punch events."""
        new_ids = []
        for punch in out.punches:
            event = _SentEvent(self.next_event_id, punch.hand, punch.strength, punch.confidence, capture_us)
            self.next_event_id += 1
            self.recent.append(event)
            new_ids.append(event.event_id)
        while self.recent and (capture_us - self.recent[0].capture_us > self.event_repeat_us or len(self.recent) > P.MAX_EVENTS):
            self.recent.popleft()
        pose = P.PoseFrame(
            state=out.state,
            calibration=out.calibration,
            flags=P.POSE_FLAG_MIRROR_APPLIED if out.mirror else 0,
            confidence=out.confidence,
            lean_lateral=out.lean_lateral,
            lean_forward=out.lean_forward,
            block_amount=out.block,
            hand_pos=out.hand_pos,
            hand_extension=out.extension,
            hand_confidence=out.hand_confidence,
            tracker_fps=tracker_fps,
            last_event_id=self.next_event_id - 1,
            events=[
                P.TrackerEvent(e.event_id, P.Hand(e.hand), age_us=capture_us - e.capture_us, strength=e.strength, confidence=e.confidence)
                for e in self.recent
            ],
        )
        self._send(P.encode_pose(self._header(capture_us), pose))
        return new_ids

    def send_status(self, status: P.Status) -> None:
        now = monotonic_us()
        self._send(P.encode_status(self._header(now), status))

    def send_ack(self, command: P.Control, result: P.AckResult) -> None:
        now = monotonic_us()
        self._send(P.encode_ack(self._header(now), P.ControlAck(command.command, result, command.command_id)))

    def poll_control(self) -> List[P.Control]:
        commands: List[P.Control] = []
        for _ in range(64):
            try:
                data, addr = self.sock.recvfrom(2048)
            except (BlockingIOError, InterruptedError):
                break
            except OSError:
                # Windows reports ICMP "port unreachable" from earlier sends as WSAECONNRESET here.
                continue
            if addr[0] != LOOPBACK:
                continue
            decoded, error = P.try_decode(data)
            if decoded is None or decoded.header.packet_type != P.PacketType.CONTROL:
                continue
            if self.token != 0 and decoded.header.session_token != self.token:
                continue
            commands.append(decoded.body)  # type: ignore[arg-type]
        return commands


class GameListener:
    """Minimal game-side receiver used by tests and the self-test (the real one is C++).

    Like the game, it drains the socket continuously (background thread); UDP datagrams that are not
    read in time are dropped by the OS once the receive buffer is full.
    """

    def __init__(self, port: int = 0):
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 1 << 20)
        self.sock.bind((LOOPBACK, port))
        self.sock.settimeout(0.02)
        self.port = self.sock.getsockname()[1]
        self.errors: List[str] = []
        self._packets: List[P.Decoded] = []
        self._lock = threading.Lock()
        self._running = True
        self._thread = threading.Thread(target=self._run, name="game-listener", daemon=True)
        self._thread.start()

    def _run(self) -> None:
        while self._running:
            try:
                data, _ = self.sock.recvfrom(2048)
            except socket.timeout:
                continue
            except OSError:
                if not self._running:
                    return
                continue
            decoded, error = P.try_decode(data)
            with self._lock:
                if decoded is not None:
                    self._packets.append(decoded)
                else:
                    self.errors.append(error)

    def receive_all(self, timeout: float = 0.2) -> List[P.Decoded]:
        """Returns (and clears) everything received so far, after waiting `timeout` for stragglers."""
        time.sleep(timeout)
        with self._lock:
            packets, self._packets = self._packets, []
        return packets

    def send_control(self, port: int, control: P.Control, token: int, sequence: int = 1) -> None:
        header = P.Header(session_token=token, sequence=sequence, capture_time_us=monotonic_us(), send_time_us=monotonic_us())
        self.sock.sendto(P.encode_control(header, control), (LOOPBACK, port))

    def close(self) -> None:
        self._running = False
        self._thread.join(timeout=1.0)
        self.sock.close()
