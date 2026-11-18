"""UDP measurement receiver tracking unique sequences, duplicates, reordering, bytes, and ACKs."""

from __future__ import annotations

import argparse
import json
import socket
import threading
import time
from dataclasses import asdict, dataclass
from pathlib import Path

from packet import (
    FLAG_ACK_REPLY,
    FLAG_END,
    UdpPacket,
    decode_packet,
    encode_ack,
    encode_packet,
)


@dataclass
class ReceiverSummary:
    received_unique: int
    total_packets_received: int
    duplicates: int
    reordered: int
    total_bytes: int
    reported_sent: int | None
    missing: int | None
    observed_loss_pct: float | None
    observation_window_s: float
    throughput_mbps: float


class SequenceTracker:
    """Pure in-memory tracker for unique sequences, duplicates, out-of-order arrivals, and bytes."""

    def __init__(self) -> None:
        self.unique_sequences: set[int] = set()
        self.total_packets_received: int = 0
        self.duplicates: int = 0
        self.reordered: int = 0
        self.max_seq_seen: int = -1
        self.total_bytes: int = 0
        self.first_rx_ns: int | None = None
        self.last_rx_ns: int | None = None
        self.reported_sent: int | None = None

    def record(self, pkt: UdpPacket, rx_time_ns: int | None = None) -> None:
        now_ns = rx_time_ns if rx_time_ns is not None else time.perf_counter_ns()
        if self.first_rx_ns is None:
            self.first_rx_ns = now_ns
        self.last_rx_ns = now_ns

        self.total_packets_received += 1
        self.total_bytes += pkt.total_bytes

        seq = pkt.sequence
        if seq in self.unique_sequences:
            self.duplicates += 1
            return

        self.unique_sequences.add(seq)
        if seq < self.max_seq_seen:
            self.reordered += 1
        else:
            self.max_seq_seen = seq

    def summarize(self, reported_sent: int | None = None) -> ReceiverSummary:
        sent = reported_sent if reported_sent is not None else self.reported_sent
        unique_cnt = len(self.unique_sequences)

        if self.first_rx_ns is not None and self.last_rx_ns is not None:
            obs_s = max((self.last_rx_ns - self.first_rx_ns) / 1e9, 0.0)
        else:
            obs_s = 0.0

        throughput_mbps = (self.total_bytes * 8 / obs_s / 1e6) if obs_s > 0 else 0.0

        if sent is not None and sent > 0:
            missing = max(0, sent - unique_cnt)
            loss_pct = (missing / sent) * 100.0
        else:
            missing = None
            loss_pct = None

        return ReceiverSummary(
            received_unique=unique_cnt,
            total_packets_received=self.total_packets_received,
            duplicates=self.duplicates,
            reordered=self.reordered,
            total_bytes=self.total_bytes,
            reported_sent=sent,
            missing=missing,
            observed_loss_pct=loss_pct,
            observation_window_s=obs_s,
            throughput_mbps=throughput_mbps,
        )


class UdpReceiver:
    """UDP server that collects measurement packets, echoes optional ACKs, and finalizes on END or idle timeout."""

    def __init__(
        self,
        host: str = "127.0.0.1",
        port: int = 9100,
        idle_timeout_s: float = 2.0,
        summary_path: Path | None = None,
    ) -> None:
        self.host = host
        self.port = port
        self.idle_timeout_s = idle_timeout_s
        self.summary_path = summary_path
        self.tracker = SequenceTracker()
        self._sock: socket.socket | None = None
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self.summary: ReceiverSummary | None = None

    @property
    def address(self) -> tuple[str, int]:
        if self._sock is None:
            return (self.host, self.port)
        addr = self._sock.getsockname()
        return (str(addr[0]), int(addr[1]))

    def bind(self) -> tuple[str, int]:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 4 * 1024 * 1024)
        except OSError:
            pass
        sock.bind((self.host, self.port))
        sock.settimeout(0.2)
        self._sock = sock
        return self.address

    def start_background(self) -> tuple[str, int]:
        addr = self.bind()
        self._stop_event.clear()
        self._thread = threading.Thread(target=self.run_once, name="udp-receiver", daemon=True)
        self._thread.start()
        return addr

    def wait(self, timeout: float | None = 15.0) -> ReceiverSummary:
        if self._thread is not None:
            self._thread.join(timeout=timeout)
        if self.summary is None:
            self.summary = self.tracker.summarize()
        return self.summary

    def stop(self) -> None:
        self._stop_event.set()
        if self._sock is not None:
            try:
                self._sock.close()
            except OSError:
                pass
            self._sock = None
        if self._thread is not None:
            self._thread.join(timeout=3.0)
            self._thread = None

    def run_once(self) -> ReceiverSummary:
        if self._sock is None:
            self.bind()
        assert self._sock is not None

        last_activity: float | None = None
        try:
            while not self._stop_event.is_set():
                try:
                    data, addr = self._sock.recvfrom(65535)
                except socket.timeout:
                    if (
                        last_activity is not None
                        and (time.perf_counter() - last_activity) >= self.idle_timeout_s
                    ):
                        break
                    continue
                except OSError:
                    break

                rx_ns = time.perf_counter_ns()
                try:
                    pkt = decode_packet(data)
                except ValueError:
                    continue

                last_activity = time.perf_counter()

                if pkt.is_end:
                    self.tracker.reported_sent = pkt.sequence
                    summary = self.tracker.summarize(reported_sent=pkt.sequence)
                    self.summary = summary
                    # Echo END-ACK with JSON summary payload so sender can record exact receiver counts
                    payload = json.dumps(asdict(summary)).encode("utf-8")
                    ack_end = encode_packet(
                        sequence=pkt.sequence,
                        send_time_ns=pkt.send_time_ns,
                        payload_size=len(payload),
                        flags=FLAG_END | FLAG_ACK_REPLY,
                        payload=payload,
                    )
                    try:
                        self._sock.sendto(ack_end, addr)
                    except OSError:
                        pass
                    break

                self.tracker.record(pkt, rx_time_ns=rx_ns)

                if pkt.ack_requested:
                    ack = encode_ack(pkt.sequence, pkt.send_time_ns)
                    try:
                        self._sock.sendto(ack, addr)
                    except OSError:
                        pass
        finally:
            if self._sock is not None:
                try:
                    self._sock.close()
                except OSError:
                    pass
                self._sock = None

        if self.summary is None:
            self.summary = self.tracker.summarize()

        if self.summary_path is not None:
            self.summary_path.parent.mkdir(parents=True, exist_ok=True)
            self.summary_path.write_text(json.dumps(asdict(self.summary), indent=2), encoding="utf-8")

        return self.summary


def print_receiver_summary(summary: ReceiverSummary) -> None:
    print("\n=== UDP Receiver Summary ===")
    print(f"Unique received : {summary.received_unique}")
    print(f"Duplicates      : {summary.duplicates}")
    print(f"Reordered       : {summary.reordered}")
    print(f"Total bytes     : {summary.total_bytes}")
    if summary.reported_sent is not None:
        print(f"Reported sent   : {summary.reported_sent}")
        print(f"Missing         : {summary.missing}")
        print(f"Observed loss % : {summary.observed_loss_pct:.2f}%")
    print(f"Obs window (s)  : {summary.observation_window_s:.4f}")
    print(f"Throughput Mbps : {summary.throughput_mbps:.4f}")


def main() -> None:
    parser = argparse.ArgumentParser(description="NetStream Lab UDP Measurement Receiver")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=9100)
    parser.add_argument("--idle-timeout", type=float, default=3.0)
    parser.add_argument("--summary-out", type=Path, default=None)
    args = parser.parse_args()

    receiver = UdpReceiver(
        host=args.host,
        port=args.port,
        idle_timeout_s=args.idle_timeout,
        summary_path=args.summary_out,
    )
    bound = receiver.bind()
    print(f"UDP Receiver listening on {bound[0]}:{bound[1]} (idle timeout={args.idle_timeout}s)")
    try:
        summary = receiver.run_once()
        print_receiver_summary(summary)
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        receiver.stop()


if __name__ == "__main__":
    main()
