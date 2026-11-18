"""UDP measurement sender with optional ACK RTT measurement and clearly labelled SIMULATED impairments."""

from __future__ import annotations

import argparse
import csv
import json
import random
import socket
import statistics
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from packet import (
    FLAG_ACK_REQUESTED,
    HEADER_SIZE,
    decode_packet,
    encode_end,
    encode_packet,
)

UDP_CSV_HEADER = [
    "timestamp",
    "payload_size",
    "packet_count",
    "interval_ms",
    "ack_mode",
    "SIMULATED_drop_rate",
    "SIMULATED_delay_ms",
    "SIMULATED_dropped_packets",
    "sent",
    "received",
    "missing",
    "observed_loss_pct",
    "duplicates",
    "reordered",
    "elapsed_s",
    "observation_window_s",
    "throughput_mbps",
    "rtt_avg_ms",
    "rtt_median_ms",
    "rtt_p95_ms",
]

_UDP_CSV_LOCK = threading.Lock()


@dataclass
class UdpExperimentResult:
    timestamp: str
    payload_size: int
    packet_count: int
    interval_ms: float
    ack_mode: bool
    simulated_drop_rate: float
    simulated_delay_ms: float
    simulated_dropped_packets: int
    sent: int
    received: int
    missing: int
    observed_loss_pct: float
    duplicates: int
    reordered: int
    elapsed_s: float
    observation_window_s: float
    throughput_mbps: float
    rtt_avg_ms: float | None
    rtt_median_ms: float | None
    rtt_p95_ms: float | None


def compute_percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    idx = min(len(ordered) - 1, max(0, int(round((pct / 100.0) * (len(ordered) - 1)))))
    return ordered[idx]


def append_udp_csv(csv_path: Path, result: UdpExperimentResult) -> None:
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    with _UDP_CSV_LOCK:
        write_header = not csv_path.exists() or csv_path.stat().st_size == 0
        with csv_path.open("a", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            if write_header:
                writer.writerow(UDP_CSV_HEADER)
            writer.writerow(
                [
                    result.timestamp,
                    result.payload_size,
                    result.packet_count,
                    f"{result.interval_ms:.3f}",
                    str(result.ack_mode).lower(),
                    f"{result.simulated_drop_rate:.4f}",
                    f"{result.simulated_delay_ms:.3f}",
                    result.simulated_dropped_packets,
                    result.sent,
                    result.received,
                    result.missing,
                    f"{result.observed_loss_pct:.4f}",
                    result.duplicates,
                    result.reordered,
                    f"{result.elapsed_s:.6f}",
                    f"{result.observation_window_s:.6f}",
                    f"{result.throughput_mbps:.4f}",
                    f"{result.rtt_avg_ms:.3f}" if result.rtt_avg_ms is not None else "",
                    f"{result.rtt_median_ms:.3f}" if result.rtt_median_ms is not None else "",
                    f"{result.rtt_p95_ms:.3f}" if result.rtt_p95_ms is not None else "",
                ]
            )


def run_udp_sender(
    host: str = "127.0.0.1",
    port: int = 9100,
    count: int = 100,
    payload_size: int = 512,
    interval_ms: float = 0.0,
    ack_mode: bool = False,
    simulated_drop_rate: float = 0.0,
    simulated_delay_ms: float = 0.0,
    rng_seed: int | None = None,
    csv_path: Path | None = Path("lab/results/udp_results.csv"),
    end_wait_s: float = 1.0,
) -> UdpExperimentResult:
    """Send `count` UDP measurement packets and return full loss, throughput, and RTT stats."""
    if not (0.0 <= simulated_drop_rate <= 1.0):
        raise ValueError("simulated_drop_rate must be between 0.0 and 1.0")
    if simulated_delay_ms < 0.0:
        raise ValueError("simulated_delay_ms must be >= 0")

    rng = random.Random(rng_seed)
    flags = FLAG_ACK_REQUESTED if ack_mode else 0
    rtts_ms: list[float] = []
    acked_sequences: set[int] = set()
    receiver_summary_dict: dict[str, object] | None = None
    stop_rx = threading.Event()

    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        try:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 4 * 1024 * 1024)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 4 * 1024 * 1024)
        except OSError:
            pass
        sock.bind(("0.0.0.0", 0))
        sock.settimeout(0.1)

        def ack_listener() -> None:
            nonlocal receiver_summary_dict
            while not stop_rx.is_set():
                try:
                    raw, _ = sock.recvfrom(65535)
                except socket.timeout:
                    continue
                except OSError:
                    break
                rx_ns = time.perf_counter_ns()
                try:
                    pkt = decode_packet(raw)
                except ValueError:
                    continue
                if pkt.is_end and pkt.is_ack:
                    try:
                        receiver_summary_dict = json.loads(pkt.payload.decode("utf-8"))
                    except (ValueError, UnicodeDecodeError):
                        pass
                    continue
                if pkt.is_ack:
                    acked_sequences.add(pkt.sequence)
                    rtt_ms = max(0.0, (rx_ns - pkt.send_time_ns) / 1e6)
                    rtts_ms.append(rtt_ms)

        rx_thread = threading.Thread(target=ack_listener, name="udp-ack-rx", daemon=True)
        rx_thread.start()

        simulated_dropped = 0
        start_perf = time.perf_counter()

        try:
            for seq in range(count):
                send_ns = time.perf_counter_ns()

                # SIMULATED drop applied in sender (clearly labelled SIMULATED)
                if simulated_drop_rate > 0.0 and rng.random() < simulated_drop_rate:
                    simulated_dropped += 1
                else:
                    # SIMULATED fixed artificial delay applied in sender before transmission
                    if simulated_delay_ms > 0.0:
                        time.sleep(simulated_delay_ms / 1000.0)
                    datagram = encode_packet(
                        sequence=seq,
                        send_time_ns=send_ns,
                        payload_size=payload_size,
                        flags=flags,
                    )
                    sock.sendto(datagram, (host, port))

                if interval_ms > 0.0 and seq + 1 < count:
                    time.sleep(interval_ms / 1000.0)

            elapsed_s = max(time.perf_counter() - start_perf, 1e-9)

            # Briefly wait for trailing ACKs before sending END
            if ack_mode:
                deadline = time.perf_counter() + min(end_wait_s, 0.5)
                expected_acks = count - simulated_dropped
                while len(acked_sequences) < expected_acks and time.perf_counter() < deadline:
                    time.sleep(0.01)

            # Send END control packet (up to 3 attempts until END-ACK summary arrives)
            end_pkt = encode_end(total_sent=count, send_time_ns=time.perf_counter_ns())
            for _ in range(3):
                sock.sendto(end_pkt, (host, port))
                wait_until = time.perf_counter() + (end_wait_s / 3.0)
                while receiver_summary_dict is None and time.perf_counter() < wait_until:
                    time.sleep(0.01)
                if receiver_summary_dict is not None:
                    break
        finally:
            stop_rx.set()
            rx_thread.join(timeout=2.0)

    if receiver_summary_dict is not None:
        received = int(receiver_summary_dict.get("received_unique", 0))
        duplicates = int(receiver_summary_dict.get("duplicates", 0))
        reordered = int(receiver_summary_dict.get("reordered", 0))
        obs_window_s = float(receiver_summary_dict.get("observation_window_s", elapsed_s))
        total_bytes = int(receiver_summary_dict.get("total_bytes", received * (HEADER_SIZE + payload_size)))
    else:
        received = len(acked_sequences) if ack_mode else (count - simulated_dropped)
        duplicates = 0
        reordered = 0
        obs_window_s = elapsed_s
        total_bytes = received * (HEADER_SIZE + payload_size)

    missing = max(0, count - received)
    observed_loss_pct = (missing / count * 100.0) if count > 0 else 0.0
    throughput_mbps = (total_bytes * 8) / elapsed_s / 1e6

    rtt_avg = statistics.mean(rtts_ms) if rtts_ms else None
    rtt_med = statistics.median(rtts_ms) if rtts_ms else None
    rtt_p95 = compute_percentile(rtts_ms, 95.0) if rtts_ms else None

    result = UdpExperimentResult(
        timestamp=datetime.now(timezone.utc).isoformat(),
        payload_size=payload_size,
        packet_count=count,
        interval_ms=interval_ms,
        ack_mode=ack_mode,
        simulated_drop_rate=simulated_drop_rate,
        simulated_delay_ms=simulated_delay_ms,
        simulated_dropped_packets=simulated_dropped,
        sent=count,
        received=received,
        missing=missing,
        observed_loss_pct=observed_loss_pct,
        duplicates=duplicates,
        reordered=reordered,
        elapsed_s=elapsed_s,
        observation_window_s=obs_window_s,
        throughput_mbps=throughput_mbps,
        rtt_avg_ms=rtt_avg,
        rtt_median_ms=rtt_med,
        rtt_p95_ms=rtt_p95,
    )

    if csv_path is not None:
        append_udp_csv(csv_path, result)

    return result


def print_udp_report(result: UdpExperimentResult) -> None:
    is_simulated = result.simulated_drop_rate > 0.0 or result.simulated_delay_ms > 0.0
    print("\n=== UDP Measurement Report ===")
    if is_simulated:
        print(
            f"[SIMULATED IMPAIRMENTS ACTIVE] "
            f"SIMULATED drop_rate={result.simulated_drop_rate * 100:.2f}% "
            f"(dropped={result.simulated_dropped_packets}), "
            f"SIMULATED delay={result.simulated_delay_ms:.2f} ms"
        )
    print(f"Sent / Received : {result.sent} / {result.received} (missing: {result.missing})")
    print(f"Observed Loss % : {result.observed_loss_pct:.2f}%")
    print(f"Duplicates      : {result.duplicates}")
    print(f"Reordered       : {result.reordered}")
    print(f"Elapsed / Obs s : {result.elapsed_s:.4f}s / {result.observation_window_s:.4f}s")
    print(f"Throughput Mbps : {result.throughput_mbps:.4f}")
    if result.rtt_avg_ms is not None:
        label = " (includes SIMULATED delay)" if result.simulated_delay_ms > 0 else ""
        print(
            f"RTT avg/med/p95 : {result.rtt_avg_ms:.2f} / {result.rtt_median_ms:.2f} / "
            f"{result.rtt_p95_ms:.2f} ms{label}"
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="NetStream Lab UDP Measurement Sender")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=9100)
    parser.add_argument("-n", "--count", type=int, default=100)
    parser.add_argument("--payload-size", type=int, default=512)
    parser.add_argument("--interval-ms", type=float, default=0.0)
    parser.add_argument("--ack", action="store_true", help="Enable ACK mode for RTT calculation")
    parser.add_argument(
        "--sim-drop",
        type=float,
        default=0.0,
        help="SIMULATED sender-side drop probability (0.0 - 1.0)",
    )
    parser.add_argument(
        "--sim-delay-ms",
        type=float,
        default=0.0,
        help="SIMULATED fixed artificial delay in milliseconds",
    )
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--csv", type=Path, default=Path("lab/results/udp_results.csv"))
    args = parser.parse_args()

    res = run_udp_sender(
        host=args.host,
        port=args.port,
        count=args.count,
        payload_size=args.payload_size,
        interval_ms=args.interval_ms,
        ack_mode=args.ack,
        simulated_drop_rate=args.sim_drop,
        simulated_delay_ms=args.sim_delay_ms,
        rng_seed=args.seed,
        csv_path=args.csv,
    )
    print_udp_report(res)


if __name__ == "__main__":
    main()
