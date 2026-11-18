"""Pytest suite for Task 25: Python UDP measurement lab."""

from __future__ import annotations

import csv
import socket
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from packet import (  # noqa: E402
    FLAG_ACK_REQUESTED,
    HEADER_SIZE,
    MAGIC,
    VERSION,
    decode_packet,
    encode_end,
    encode_packet,
)
from receiver import SequenceTracker, UdpReceiver  # noqa: E402
from sender import run_udp_sender  # noqa: E402


def test_packet_encode_decode_roundtrip():
    raw = encode_packet(
        sequence=424242,
        send_time_ns=123_456_789_012_345,
        payload_size=256,
        flags=FLAG_ACK_REQUESTED,
        payload=b"hello-udp",
    )

    assert len(raw) == HEADER_SIZE + 256
    pkt = decode_packet(raw)
    assert pkt.magic == MAGIC
    assert pkt.version == VERSION
    assert pkt.flags == FLAG_ACK_REQUESTED
    assert pkt.ack_requested is True
    assert pkt.is_ack is False
    assert pkt.is_end is False
    assert pkt.sequence == 424242
    assert pkt.send_time_ns == 123_456_789_012_345
    assert len(pkt.payload) == 256
    assert pkt.payload.startswith(b"hello-udp")

    # Malformed packets raise ValueError
    with pytest.raises(ValueError, match="Packet too short"):
        decode_packet(b"short")
    with pytest.raises(ValueError, match="Invalid magic"):
        decode_packet(b"XX" + raw[2:])


def test_receiver_counts_duplicates_and_out_of_order_on_crafted_sequence():
    # Crafted sequence: 0, 1, 3, 2 (reordered), 1 (duplicate), 5, 4 (reordered), 3 (duplicate)
    # Unique: {0, 1, 2, 3, 4, 5} => 6 unique, 2 duplicates, 2 reordered
    receiver = UdpReceiver(host="127.0.0.1", port=0, idle_timeout_s=1.0)
    host, port = receiver.start_background()

    crafted_seqs = [0, 1, 3, 2, 1, 5, 4, 3]
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            for seq in crafted_seqs:
                pkt = encode_packet(sequence=seq, send_time_ns=1000 + seq, payload_size=64)
                sock.sendto(pkt, (host, port))
            sock.sendto(encode_end(total_sent=6, send_time_ns=9999), (host, port))

        summary = receiver.wait(timeout=5.0)
        assert summary.received_unique == 6
        assert summary.total_packets_received == 8
        assert summary.duplicates == 2
        assert summary.reordered == 2
        assert summary.missing == 0
        assert summary.total_bytes == 8 * (HEADER_SIZE + 64)
    finally:
        receiver.stop()


def test_simulated_drop_rate_over_10000_packets_within_tolerance(tmp_path: Path):
    """Verify SIMULATED drop probability produces ~10% loss across 10,000 packets within tolerance."""
    csv_path = tmp_path / "udp_results.csv"
    receiver = UdpReceiver(host="127.0.0.1", port=0, idle_timeout_s=2.0)
    host, port = receiver.start_background()

    try:
        res = run_udp_sender(
            host=host,
            port=port,
            count=10_000,
            payload_size=32,
            interval_ms=0.0,
            ack_mode=False,
            simulated_drop_rate=0.10,
            rng_seed=2026,
            csv_path=csv_path,
        )
        receiver.wait(timeout=5.0)

        # Binomial std dev for n=10000, p=0.10 is 0.3%; allow +/- 2% tolerance for loopback jitter
        simulated_rate = res.simulated_dropped_packets / res.sent
        assert 0.085 <= simulated_rate <= 0.115
        assert 8.5 <= res.observed_loss_pct <= 13.0

        # Confirm SIMULATED columns are recorded in CSV
        with csv_path.open("r", encoding="utf-8") as f:
            rows = list(csv.DictReader(f))
        assert len(rows) == 1
        assert float(rows[0]["SIMULATED_drop_rate"]) == pytest.approx(0.10)
        assert int(rows[0]["SIMULATED_dropped_packets"]) == res.simulated_dropped_packets
    finally:
        receiver.stop()


def test_rtt_calculation_with_fixed_simulated_delay(tmp_path: Path):
    """Verify ACK mode RTT average, median, and p95 reflect a fixed SIMULATED delay."""
    receiver = UdpReceiver(host="127.0.0.1", port=0, idle_timeout_s=2.0)
    host, port = receiver.start_background()

    try:
        res = run_udp_sender(
            host=host,
            port=port,
            count=12,
            payload_size=64,
            interval_ms=0.0,
            ack_mode=True,
            simulated_drop_rate=0.0,
            simulated_delay_ms=15.0,
            csv_path=tmp_path / "rtt.csv",
        )
        receiver.wait(timeout=5.0)

        assert res.received == 12
        assert res.rtt_avg_ms is not None
        assert res.rtt_median_ms is not None
        assert res.rtt_p95_ms is not None
        # Fixed 15ms artificial delay on Windows timer (~15.6ms quantum) => RTT >= 14ms
        assert res.rtt_avg_ms >= 14.0
        assert res.rtt_median_ms >= 14.0
        assert res.rtt_p95_ms >= res.rtt_median_ms
    finally:
        receiver.stop()


def test_sequence_tracker_unit_sanity():
    tracker = SequenceTracker()
    for seq in [0, 2, 1, 2]:
        pkt = decode_packet(encode_packet(sequence=seq, send_time_ns=10, payload_size=16))
        tracker.record(pkt, rx_time_ns=1_000_000_000 + seq * 1_000_000)

    s = tracker.summarize(reported_sent=4)
    assert s.received_unique == 3
    assert s.duplicates == 1
    assert s.reordered == 1
    assert s.missing == 1
    assert s.observed_loss_pct == pytest.approx(25.0)
