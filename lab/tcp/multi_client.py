"""Launches N concurrent TCP clients downloading the same file and reports per-client times."""

from __future__ import annotations

import argparse
import threading
import time
from pathlib import Path

from client import TransferResult, download_file, print_results_table


def run_concurrent_downloads(
    host: str,
    port: int,
    filename: str,
    num_clients: int,
    download_dir: Path = Path("lab/downloads"),
    csv_path: Path | None = Path("lab/results/tcp_results.csv"),
    notes: str = "concurrent",
) -> list[TransferResult]:
    results: list[TransferResult | None] = [None] * num_clients
    errors: list[Exception] = []
    err_lock = threading.Lock()
    barrier = threading.Barrier(num_clients)

    def worker(idx: int) -> None:
        try:
            barrier.wait(timeout=10.0)
            res = download_file(
                host=host,
                port=port,
                filename=filename,
                download_dir=download_dir,
                csv_path=csv_path,
                output_filename=f"client{idx + 1}_{filename}",
                client_count=num_clients,
                notes=f"{notes}-c{idx + 1}",
            )
            results[idx] = res
        except Exception as exc:
            with err_lock:
                errors.append(exc)

    threads = [
        threading.Thread(target=worker, args=(i,), name=f"multi-client-{i + 1}")
        for i in range(num_clients)
    ]

    overall_start = time.perf_counter()
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    overall_elapsed = time.perf_counter() - overall_start

    if errors:
        raise RuntimeError(f"{len(errors)}/{num_clients} concurrent downloads failed: {errors[0]}")

    completed = [r for r in results if r is not None]
    print(f"\nConcurrent benchmark: {num_clients} clients finished in {overall_elapsed:.4f}s wall time")
    print_results_table(completed)
    return completed


def main() -> None:
    parser = argparse.ArgumentParser(description="Run N concurrent TCP file downloads")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=9000)
    parser.add_argument("filename", help="Filename on the TCP server")
    parser.add_argument("-n", "--clients", type=int, default=3, help="Number of concurrent clients")
    parser.add_argument("--download-dir", type=Path, default=Path("lab/downloads"))
    parser.add_argument("--csv", type=Path, default=Path("lab/results/tcp_results.csv"))
    args = parser.parse_args()

    run_concurrent_downloads(
        host=args.host,
        port=args.port,
        filename=args.filename,
        num_clients=args.clients,
        download_dir=args.download_dir,
        csv_path=args.csv,
    )


if __name__ == "__main__":
    main()
