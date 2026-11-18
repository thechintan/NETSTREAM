"""Runs a configurable UDP measurement matrix (payload sizes x packet counts x drop rates) and logs CSV rows."""

from __future__ import annotations

import argparse
from pathlib import Path

from receiver import UdpReceiver
from sender import UdpExperimentResult, run_udp_sender


def run_matrix(
    payload_sizes: list[int],
    packet_counts: list[int],
    simulated_drop_rates: list[float],
    runs_per_scenario: int = 3,
    interval_ms: float = 0.0,
    ack_mode: bool = False,
    simulated_delay_ms: float = 0.0,
    csv_path: Path = Path("lab/results/udp_results.csv"),
) -> list[UdpExperimentResult]:
    results: list[UdpExperimentResult] = []
    scenario_num = 0
    total_runs = len(payload_sizes) * len(packet_counts) * len(simulated_drop_rates) * runs_per_scenario

    for payload_size in payload_sizes:
        for count in packet_counts:
            for drop_rate in simulated_drop_rates:
                for run_idx in range(1, runs_per_scenario + 1):
                    scenario_num += 1
                    receiver = UdpReceiver(host="127.0.0.1", port=0, idle_timeout_s=2.0)
                    host, port = receiver.start_background()
                    try:
                        res = run_udp_sender(
                            host=host,
                            port=port,
                            count=count,
                            payload_size=payload_size,
                            interval_ms=interval_ms,
                            ack_mode=ack_mode,
                            simulated_drop_rate=drop_rate,
                            simulated_delay_ms=simulated_delay_ms,
                            rng_seed=scenario_num * 101 + run_idx,
                            csv_path=csv_path,
                        )
                        receiver.wait(timeout=5.0)
                        results.append(res)
                        sim_tag = (
                            f"SIMULATED_drop={drop_rate * 100:.1f}%"
                            if drop_rate > 0
                            else "no_sim_drop"
                        )
                        print(
                            f"[{scenario_num}/{total_runs}] size={payload_size}B n={count} "
                            f"{sim_tag} run={run_idx} -> loss={res.observed_loss_pct:.2f}% "
                            f"mbps={res.throughput_mbps:.2f}"
                        )
                    finally:
                        receiver.stop()

    return results


def main() -> None:
    parser = argparse.ArgumentParser(description="Run UDP measurement scenario matrix")
    parser.add_argument(
        "--payload-sizes",
        type=int,
        nargs="+",
        default=[256, 1024],
        help="Payload sizes in bytes",
    )
    parser.add_argument(
        "--counts",
        type=int,
        nargs="+",
        default=[500, 2000],
        help="Packet counts per run",
    )
    parser.add_argument(
        "--sim-drops",
        type=float,
        nargs="+",
        default=[0.0, 0.05, 0.15],
        help="SIMULATED drop rates (0.0 - 1.0)",
    )
    parser.add_argument("--runs", type=int, default=2, help="Repetitions per scenario")
    parser.add_argument("--ack", action="store_true")
    parser.add_argument("--sim-delay-ms", type=float, default=0.0)
    parser.add_argument("--csv", type=Path, default=Path("lab/results/udp_results.csv"))
    args = parser.parse_args()

    run_matrix(
        payload_sizes=args.payload_sizes,
        packet_counts=args.counts,
        simulated_drop_rates=args.sim_drops,
        runs_per_scenario=args.runs,
        ack_mode=args.ack,
        simulated_delay_ms=args.sim_delay_ms,
        csv_path=args.csv,
    )


if __name__ == "__main__":
    main()
