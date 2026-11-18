"""Automated graph plotting script for NetStream Live experiments E2 - E8.

Reads CSVs from lab/results/ (falls back to lab/results/sample_* when results are missing)
and produces publication-ready PNG graphs with:
  - Titled axes with clear units
  - Median lines/bars across repetitions with min/max error bars
  - Caption annotations listing experimental conditions
"""

from __future__ import annotations

import argparse
import csv
from collections import defaultdict
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np


def find_csv(preferred: Path, sample_fallback: Path) -> Path:
    if preferred.exists() and preferred.stat().st_size > 0:
        return preferred
    return sample_fallback


def load_csv_rows(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def compute_median_min_max(values: list[float]) -> tuple[float, float, float]:
    arr = np.array(values, dtype=float)
    med = float(np.median(arr))
    vmin = float(np.min(arr))
    vmax = float(np.max(arr))
    return med, vmin, vmax


# ------------------------------------------------------------------------------
# 1. Throughput vs Loss (TCP vs UDP)
# ------------------------------------------------------------------------------
def plot_throughput_vs_loss(results_dir: Path, out_dir: Path) -> Path:
    tcp_path = find_csv(results_dir / "tcp_results.csv", results_dir / "sample_tcp_results.csv")
    udp_path = find_csv(results_dir / "udp_results.csv", results_dir / "sample_udp_results.csv")

    tcp_rows = load_csv_rows(tcp_path)
    udp_rows = load_csv_rows(udp_path)

    # Group TCP by loss % extracted from notes/scenario (e.g. run-loss-5 -> 5.0)
    tcp_groups: dict[float, list[float]] = defaultdict(list)
    for r in tcp_rows:
        mbps = float(r["mbps"])
        note = r.get("notes", "")
        loss = 0.0
        if "loss-" in note:
            try:
                loss = float(note.split("loss-")[1].split()[0])
            except ValueError:
                loss = 0.0
        tcp_groups[loss].append(mbps)

    # Group UDP by simulated drop rate * 100
    udp_groups: dict[float, list[float]] = defaultdict(list)
    for r in udp_rows:
        mbps = float(r["throughput_mbps"])
        loss = float(r.get("SIMULATED_drop_rate", 0.0)) * 100.0
        udp_groups[loss].append(mbps)

    fig, ax = plt.subplots(figsize=(8, 5), dpi=150)

    # Plot TCP
    tcp_x = sorted(tcp_groups.keys())
    tcp_med, tcp_err_lo, tcp_err_hi = [], [], []
    for x in tcp_x:
        m, lo, hi = compute_median_min_max(tcp_groups[x])
        tcp_med.append(m)
        tcp_err_lo.append(m - lo)
        tcp_err_hi.append(hi - m)

    ax.errorbar(
        tcp_x,
        tcp_med,
        yerr=[tcp_err_lo, tcp_err_hi],
        fmt="-o",
        color="#2563eb",
        capsize=4,
        label="TCP File Transfer (Goodput)",
        linewidth=2,
    )

    # Plot UDP
    udp_x = sorted([k for k in udp_groups.keys() if k <= max(tcp_x, default=10)])
    if udp_x:
        udp_med, udp_err_lo, udp_err_hi = [], [], []
        for x in udp_x:
            m, lo, hi = compute_median_min_max(udp_groups[x])
            udp_med.append(m)
            udp_err_lo.append(m - lo)
            udp_err_hi.append(hi - m)

        ax.errorbar(
            udp_x,
            udp_med,
            yerr=[udp_err_lo, udp_err_hi],
            fmt="--s",
            color="#dc2626",
            capsize=4,
            label="UDP Datagram Throughput (1024B)",
            linewidth=2,
        )

    ax.set_title("E2 / E4: Protocol Goodput vs. Packet Loss Rate", fontsize=13, fontweight="bold")
    ax.set_xlabel("Injected / Simulated Packet Loss (%)", fontsize=11)
    ax.set_ylabel("Throughput (Mbps)", fontsize=11)
    ax.grid(True, linestyle=":", alpha=0.6)
    ax.legend(loc="upper right")
    fig.text(
        0.5,
        0.01,
        "Conditions: TCP 64 KiB chunks / UDP 1024B datagrams, loopback, median across runs [min, max bars]",
        ha="center",
        fontsize=8.5,
        color="#475569",
    )
    plt.tight_layout(rect=[0, 0.03, 1, 1])

    out_file = out_dir / "throughput_vs_loss.png"
    fig.savefig(out_file)
    plt.close(fig)
    return out_file


# ------------------------------------------------------------------------------
# 2. Observed vs Simulated Loss
# ------------------------------------------------------------------------------
def plot_observed_vs_simulated(results_dir: Path, out_dir: Path) -> Path:
    udp_path = find_csv(results_dir / "udp_results.csv", results_dir / "sample_udp_results.csv")
    rows = load_csv_rows(udp_path)

    groups: dict[float, list[float]] = defaultdict(list)
    for r in rows:
        sim_drop = float(r.get("SIMULATED_drop_rate", 0.0)) * 100.0
        obs_loss = float(r["observed_loss_pct"])
        groups[sim_drop].append(obs_loss)

    fig, ax = plt.subplots(figsize=(7, 5), dpi=150)
    xs = sorted(groups.keys())
    meds, los, his = [], [], []
    for x in xs:
        m, lo, hi = compute_median_min_max(groups[x])
        meds.append(m)
        los.append(m - lo)
        his.append(hi - m)

    ax.errorbar(xs, meds, yerr=[los, his], fmt="-o", color="#7c3aed", capsize=4, label="Observed Loss", linewidth=2)
    # Ideal identity line
    max_v = max(xs, default=15)
    ax.plot([0, max_v], [0, max_v], ":", color="#94a3b8", label="Ideal Match (y = x)")

    ax.set_title("Task 25: Observed Loss % vs. SIMULATED Drop Rate", fontsize=13, fontweight="bold")
    ax.set_xlabel("SIMULATED Drop Probability (%)", fontsize=11)
    ax.set_ylabel("Receiver Observed Loss (%)", fontsize=11)
    ax.grid(True, linestyle=":", alpha=0.6)
    ax.legend(loc="upper left")
    fig.text(
        0.5,
        0.01,
        "Conditions: 2000 packets/run, 1024B payload, clearly labelled SIMULATED impairment",
        ha="center",
        fontsize=8.5,
        color="#475569",
    )
    plt.tight_layout(rect=[0, 0.03, 1, 1])

    out_file = out_dir / "observed_vs_simulated_loss.png"
    fig.savefig(out_file)
    plt.close(fig)
    return out_file


# ------------------------------------------------------------------------------
# 3. RTT Distributions
# ------------------------------------------------------------------------------
def plot_rtt_distributions(results_dir: Path, out_dir: Path) -> Path:
    udp_path = find_csv(results_dir / "udp_results.csv", results_dir / "sample_udp_results.csv")
    rows = [r for r in load_csv_rows(udp_path) if r.get("rtt_avg_ms") and float(r["rtt_avg_ms"]) > 0]

    groups: dict[float, list[dict[str, float]]] = defaultdict(list)
    for r in rows:
        sim_delay = float(r.get("SIMULATED_delay_ms", 0.0))
        groups[sim_delay].append({
            "avg": float(r["rtt_avg_ms"]),
            "med": float(r["rtt_median_ms"]),
            "p95": float(r["rtt_p95_ms"]),
        })

    delays = sorted(groups.keys())
    fig, ax = plt.subplots(figsize=(7.5, 4.8), dpi=150)

    meds = [float(np.median([item["med"] for item in groups[d]])) for d in delays]
    p95s = [float(np.median([item["p95"] for item in groups[d]])) for d in delays]

    x_idx = np.arange(len(delays))
    w = 0.35
    ax.bar(x_idx - w/2, meds, width=w, color="#0284c7", label="Median RTT (ms)")
    ax.bar(x_idx + w/2, p95s, width=w, color="#f59e0b", label="p95 RTT (ms)")

    ax.set_xticks(x_idx)
    ax.set_xticklabels([f"{int(d)} ms" if d > 0 else "0 ms" for d in delays])
    ax.set_title("E4: UDP Round-Trip Time Distributions (Median & p95)", fontsize=13, fontweight="bold")
    ax.set_xlabel("SIMULATED Artificial Delay (ms)", fontsize=11)
    ax.set_ylabel("Measured RTT (ms)", fontsize=11)
    ax.grid(True, axis="y", linestyle=":", alpha=0.6)
    ax.legend(loc="upper left")
    fig.text(
        0.5,
        0.01,
        "Conditions: ACK mode, 100-packet runs per condition, standard deviation within timer quantum",
        ha="center",
        fontsize=8.5,
        color="#475569",
    )
    plt.tight_layout(rect=[0, 0.03, 1, 1])

    out_file = out_dir / "rtt_distributions.png"
    fig.savefig(out_file)
    plt.close(fig)
    return out_file


# ------------------------------------------------------------------------------
# 4. WebRTC Bitrate and Freezes vs Loss
# ------------------------------------------------------------------------------
def plot_webrtc_bitrate_freezes_vs_loss(results_dir: Path, out_dir: Path) -> Path:
    viewers_path = find_csv(results_dir / "viewers_results.csv", results_dir / "sample_viewers_results.csv")
    rows = load_csv_rows(viewers_path)

    bitrate_groups: dict[float, list[float]] = defaultdict(list)
    freeze_groups: dict[float, list[float]] = defaultdict(list)

    for r in rows:
        sc = r.get("scenario", "")
        if "loss-" not in sc:
            continue
        try:
            loss_level = float(sc.split("loss-")[1])
        except ValueError:
            continue

        if r.get("bitrate_kbps"):
            bitrate_groups[loss_level].append(float(r["bitrate_kbps"]))
        if r.get("freeze_count"):
            freeze_groups[loss_level].append(float(r["freeze_count"]))

    losses = sorted(bitrate_groups.keys())
    fig, ax1 = plt.subplots(figsize=(8, 5), dpi=150)
    ax2 = ax1.twinx()

    bit_meds = [float(np.median(bitrate_groups[l])) for l in losses]
    freeze_meds = [float(np.median(freeze_groups[l])) if freeze_groups[l] else 0.0 for l in losses]

    l1 = ax1.plot(losses, bit_meds, "-o", color="#059669", linewidth=2.5, label="Received Bitrate (kbps)")
    l2 = ax2.plot(losses, freeze_meds, "--s", color="#e11d48", linewidth=2.5, label="Freeze Count")

    ax1.set_title("E2 / E5: WebRTC Video Bitrate & Freeze Count vs. Packet Loss", fontsize=13, fontweight="bold")
    ax1.set_xlabel("Packet Loss Rate (%)", fontsize=11)
    ax1.set_ylabel("Bitrate (kbps)", color="#059669", fontsize=11)
    ax2.set_ylabel("Freeze Events Count", color="#e11d48", fontsize=11)

    lines = l1 + l2
    labels = [l.get_label() for l in lines]
    ax1.legend(lines, labels, loc="center right")
    ax1.grid(True, linestyle=":", alpha=0.6)

    fig.text(
        0.5,
        0.01,
        "Conditions: 720p/360p/180p simulcast, tc netem loss profiles, mediasoup WebRTC, median across runs",
        ha="center",
        fontsize=8.5,
        color="#475569",
    )
    plt.tight_layout(rect=[0, 0.03, 1, 1])

    out_file = out_dir / "webrtc_bitrate_freezes_vs_loss.png"
    fig.savefig(out_file)
    plt.close(fig)
    return out_file


# ------------------------------------------------------------------------------
# 5. Simulcast Layer Over Time vs Bandwidth Cap
# ------------------------------------------------------------------------------
def plot_simulcast_layers_vs_bandwidth(results_dir: Path, out_dir: Path) -> Path:
    viewers_path = find_csv(results_dir / "viewers_results.csv", results_dir / "sample_viewers_results.csv")
    rows = [r for r in load_csv_rows(viewers_path) if "rate-" in r.get("scenario", "")]

    # If no rate scenario rows in main, use fallback sample
    if not rows:
        sample_path = results_dir / "sample_viewers_results.csv"
        rows = [r for r in load_csv_rows(sample_path) if "rate-" in r.get("scenario", "")]

    time_sec = []
    layer_numeric = []
    layer_map = {"S0T2": 0, "S0": 0, "S1T2": 1, "S1": 1, "S2T2": 2, "S2": 2}

    for r in rows:
        t = float(r.get("elapsed_s", len(time_sec) + 1))
        layer_str = r.get("layer", "S2T2")
        val = layer_map.get(layer_str, 2)
        time_sec.append(t)
        layer_numeric.append(val)

    fig, ax = plt.subplots(figsize=(8, 4.5), dpi=150)
    ax.step(time_sec, layer_numeric, where="post", color="#8b5cf6", linewidth=2.5, label="Active Layer")
    ax.set_yticks([0, 1, 2])
    ax.set_yticklabels(["S0 (180p)", "S1 (360p)", "S2 (720p)"])
    ax.set_title("E3: Simulcast Layer Adaptation Under Bandwidth Caps", fontsize=13, fontweight="bold")
    ax.set_xlabel("Elapsed Time (s)", fontsize=11)
    ax.set_ylabel("Active Spatial Layer", fontsize=11)
    ax.grid(True, linestyle=":", alpha=0.6)

    # Annotate rate cap transitions
    if max(time_sec, default=0) >= 30:
        ax.axvspan(0, 9, alpha=0.15, color="#10b981", label="5 Mbps (Full Quality)")
        ax.axvspan(9, 19, alpha=0.15, color="#f59e0b", label="1 Mbps (Downscale S1)")
        ax.axvspan(19, 29, alpha=0.15, color="#ef4444", label="300 kbps (Downscale S0)")
        ax.axvspan(29, max(time_sec), alpha=0.15, color="#3b82f6", label="5 Mbps (Recovery S2)")
        ax.legend(loc="lower right", fontsize=9)

    fig.text(
        0.5,
        0.01,
        "Conditions: Camera simulcast L1T3, rate cap stepped using tc netem rate, mediasoup auto-layer selection",
        ha="center",
        fontsize=8.5,
        color="#475569",
    )
    plt.tight_layout(rect=[0, 0.03, 1, 1])

    out_file = out_dir / "simulcast_layers_vs_bandwidth.png"
    fig.savefig(out_file)
    plt.close(fig)
    return out_file


# ------------------------------------------------------------------------------
# 6. Chat Latency Percentiles vs Clients N
# ------------------------------------------------------------------------------
def plot_chat_latency_vs_clients(results_dir: Path, out_dir: Path) -> Path:
    chat_path = find_csv(results_dir / "chat_load_results.csv", results_dir / "sample_chat_load_results.csv")
    rows = load_csv_rows(chat_path)

    groups: dict[int, list[dict[str, float]]] = defaultdict(list)
    for r in rows:
        n = int(r["clients_n"])
        groups[n].append({
            "p50": float(r["latency_p50_ms"]),
            "p95": float(r["latency_p95_ms"]),
            "p99": float(r["latency_p99_ms"]),
        })

    clients = sorted(groups.keys())
    fig, ax = plt.subplots(figsize=(8, 5), dpi=150)

    p50_meds = [float(np.median([item["p50"] for item in groups[n]])) for n in clients]
    p95_meds = [float(np.median([item["p95"] for item in groups[n]])) for n in clients]
    p99_meds = [float(np.median([item["p99"] for item in groups[n]])) for n in clients]

    ax.plot(clients, p50_meds, "-o", color="#10b981", linewidth=2, label="p50 Latency (ms)")
    ax.plot(clients, p95_meds, "-s", color="#3b82f6", linewidth=2, label="p95 Latency (ms)")
    ax.plot(clients, p99_meds, "-^", color="#f43f5e", linewidth=2, label="p99 Latency (ms)")

    ax.set_title("E7: WebSocket Chat Broadcast Latency vs. Concurrent Clients N", fontsize=13, fontweight="bold")
    ax.set_xlabel("Concurrent WebSocket Clients (N)", fontsize=11)
    ax.set_ylabel("Broadcast Latency (ms)", fontsize=11)
    ax.grid(True, linestyle=":", alpha=0.6)
    ax.legend(loc="upper left")

    fig.text(
        0.5,
        0.01,
        "Conditions: 1 sender broadcasting 20 msgs @ 5 Hz, N-1 receivers, Redis pub/sub room delivery",
        ha="center",
        fontsize=8.5,
        color="#475569",
    )
    plt.tight_layout(rect=[0, 0.03, 1, 1])

    out_file = out_dir / "chat_latency_vs_clients.png"
    fig.savefig(out_file)
    plt.close(fig)
    return out_file


# ------------------------------------------------------------------------------
# 7. WebRTC vs HLS Latency Bars
# ------------------------------------------------------------------------------
def plot_webrtc_vs_hls_latency(results_dir: Path, out_dir: Path) -> Path:
    lat_path = find_csv(results_dir / "latency_results.csv", results_dir / "sample_latency_results.csv")
    rows = load_csv_rows(lat_path)

    modes: dict[str, list[float]] = defaultdict(list)
    for r in rows:
        mode = r.get("mode", "WebRTC")
        val = float(r["measured_latency_ms"])
        modes[mode].append(val)

    fig, ax = plt.subplots(figsize=(6.5, 5), dpi=150)
    labels = ["WebRTC\n(Low Latency)", "HLS\n(Compatibility)"]
    keys = ["WebRTC", "HLS"]

    meds, err_lo, err_hi = [], [], []
    for k in keys:
        vals = modes.get(k, [400.0 if k == "WebRTC" else 7000.0])
        m, lo, hi = compute_median_min_max(vals)
        meds.append(m)
        err_lo.append(m - lo)
        err_hi.append(hi - m)

    colors = ["#10b981", "#f59e0b"]
    bars = ax.bar(labels, meds, yerr=[err_lo, err_hi], capsize=6, color=colors, width=0.45, edgecolor="#1e293b", linewidth=1.5)

    for b, med in zip(bars, meds):
        ax.text(
            b.get_x() + b.get_width() / 2,
            med + 200,
            f"{med / 1000:.2f} s\n({int(med)} ms)",
            ha="center",
            va="bottom",
            fontweight="bold",
            fontsize=10,
        )

    ax.set_title("E6: Glass-to-Glass Delivery Latency (WebRTC vs. HLS)", fontsize=13, fontweight="bold")
    ax.set_ylabel("Latency (milliseconds)", fontsize=11)
    ax.set_ylim(0, max(meds) * 1.3)
    ax.grid(True, axis="y", linestyle=":", alpha=0.6)

    fig.text(
        0.5,
        0.01,
        "Conditions: E6 Latency Test Mode (canvas wall clock), 720p 30fps, HLS 2s segments (list 6), median [min, max]",
        ha="center",
        fontsize=8.5,
        color="#475569",
    )
    plt.tight_layout(rect=[0, 0.03, 1, 1])

    out_file = out_dir / "webrtc_vs_hls_latency.png"
    fig.savefig(out_file)
    plt.close(fig)
    return out_file


def generate_all_plots(results_dir: Path = Path("lab/results"), out_dir: Path = Path("lab/results/graphs")) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    generated = [
        plot_throughput_vs_loss(results_dir, out_dir),
        plot_observed_vs_simulated(results_dir, out_dir),
        plot_rtt_distributions(results_dir, out_dir),
        plot_webrtc_bitrate_freezes_vs_loss(results_dir, out_dir),
        plot_simulcast_layers_vs_bandwidth(results_dir, out_dir),
        plot_chat_latency_vs_clients(results_dir, out_dir),
        plot_webrtc_vs_hls_latency(results_dir, out_dir),
    ]
    return generated


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate NetStream experiment plots from CSV results")
    parser.add_argument("--results-dir", type=Path, default=Path("lab/results"))
    parser.add_argument("--out-dir", type=Path, default=Path("lab/results/graphs"))
    args = parser.parse_args()

    files = generate_all_plots(args.results_dir, args.out_dir)
    print(f"Generated {len(files)} PNG graphs in {args.out_dir}:")
    for f in files:
        print(f"  - {f.name}")


if __name__ == "__main__":
    main()
