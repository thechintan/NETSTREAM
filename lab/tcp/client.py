"""TCP file-transfer client with SHA-256 verification, throughput calculation, and CSV logging."""

from __future__ import annotations

import argparse
import csv
import json
import socket
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from protocol import BufferedSocketReader

CSV_HEADER = [
    "timestamp",
    "file",
    "bytes",
    "seconds",
    "mbps",
    "integrity",
    "client_count",
    "notes",
]

_CSV_LOCK = threading.Lock()


@dataclass
class TransferResult:
    timestamp: str
    file: str
    bytes_transferred: int
    seconds: float
    mbps: float
    integrity: str
    expected_sha256: str
    actual_sha256: str
    output_path: Path
    client_count: int = 1
    notes: str = ""


def append_tcp_csv(csv_path: Path, result: TransferResult) -> None:
    """Thread-safely append a transfer measurement row to `tcp_results.csv`."""
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    with _CSV_LOCK:
        write_header = not csv_path.exists() or csv_path.stat().st_size == 0
        with csv_path.open("a", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            if write_header:
                writer.writerow(CSV_HEADER)
            writer.writerow(
                [
                    result.timestamp,
                    result.file,
                    result.bytes_transferred,
                    f"{result.seconds:.6f}",
                    f"{result.mbps:.4f}",
                    result.integrity,
                    result.client_count,
                    result.notes,
                ]
            )


def list_remote_files(host: str, port: int, timeout: float = 10.0) -> list[dict[str, Any]]:
    with socket.create_connection((host, port), timeout=timeout) as sock:
        reader = BufferedSocketReader(sock)
        sock.sendall(b"LIST\n")
        header = reader.readline()
        if header is None:
            raise ConnectionError("Server closed connection before LIST response")
        if header.startswith("ERR|"):
            raise RuntimeError(header[4:])
        if not header.startswith("OK|"):
            raise RuntimeError(f"Unexpected LIST header: {header}")

        byte_length = int(header.split("|", 1)[1])
        payload = reader.read_exact(byte_length)
        sock.sendall(b"BYE\n")
        reader.readline()
        return list(json.loads(payload.decode("utf-8")))


def download_file(
    host: str,
    port: int,
    filename: str,
    download_dir: Path = Path("lab/downloads"),
    csv_path: Path | None = Path("lab/results/tcp_results.csv"),
    output_filename: str | None = None,
    client_count: int = 1,
    notes: str = "",
    timeout: float = 30.0,
) -> TransferResult:
    download_dir.mkdir(parents=True, exist_ok=True)
    safe_out_name = Path(output_filename or filename).name
    dest_path = download_dir / safe_out_name

    with socket.create_connection((host, port), timeout=timeout) as sock:
        reader = BufferedSocketReader(sock)
        start_time = time.perf_counter()
        sock.sendall(f"GET|{filename}\n".encode("utf-8"))

        header = reader.readline()
        if header is None:
            raise ConnectionError("Server closed connection before GET header")
        if header.startswith("ERR|"):
            raise RuntimeError(header[4:])

        parts = header.split("|")
        if len(parts) != 3 or parts[0] != "OK":
            raise RuntimeError(f"Malformed GET header: {header}")

        expected_size = int(parts[1])
        expected_sha256 = parts[2]

        with dest_path.open("wb") as out_f:
            actual_size, actual_sha256 = reader.read_exact_to_file(expected_size, out_f)

        elapsed = max(time.perf_counter() - start_time, 1e-9)
        mbps = (actual_size * 8) / elapsed / 1e6
        integrity = (
            "PASS"
            if (actual_size == expected_size and actual_sha256 == expected_sha256)
            else "FAIL"
        )

        try:
            sock.sendall(b"BYE\n")
            reader.readline()
        except OSError:
            pass

    result = TransferResult(
        timestamp=datetime.now(timezone.utc).isoformat(),
        file=filename,
        bytes_transferred=actual_size,
        seconds=elapsed,
        mbps=mbps,
        integrity=integrity,
        expected_sha256=expected_sha256,
        actual_sha256=actual_sha256,
        output_path=dest_path,
        client_count=client_count,
        notes=notes,
    )

    if csv_path is not None:
        append_tcp_csv(csv_path, result)

    return result


def print_results_table(results: list[TransferResult]) -> None:
    print(
        f"{'File':<24} {'Bytes':>12} {'Seconds':>10} {'Mbps':>10} {'Integrity':>10} {'Clients':>8}"
    )
    print("-" * 80)
    for r in results:
        print(
            f"{r.file:<24} {r.bytes_transferred:>12} {r.seconds:>10.4f} "
            f"{r.mbps:>10.2f} {r.integrity:>10} {r.client_count:>8}"
        )


def run_interactive_loop(
    host: str,
    port: int,
    download_dir: Path,
    csv_path: Path,
) -> None:
    print(f"Connected mode -> {host}:{port}. Commands: list | get <filename> | bye")
    while True:
        try:
            raw = input("tcp> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if not raw:
            continue
        if raw.lower() in ("bye", "quit", "exit"):
            break
        if raw.lower() == "list":
            files = list_remote_files(host, port)
            if not files:
                print("(empty catalogue)")
            else:
                for entry in files:
                    print(f"  {entry['name']} ({entry['size']} bytes)")
        elif raw.lower().startswith("get "):
            fname = raw[4:].strip()
            try:
                res = download_file(host, port, fname, download_dir=download_dir, csv_path=csv_path)
                print_results_table([res])
            except Exception as exc:
                print(f"ERROR: {exc}")
        else:
            print("Unknown command. Use: list | get <filename> | bye")


def main() -> None:
    parser = argparse.ArgumentParser(description="NetStream Lab TCP File Client")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=9000)
    parser.add_argument("--download-dir", type=Path, default=Path("lab/downloads"))
    parser.add_argument("--csv", type=Path, default=Path("lab/results/tcp_results.csv"))
    parser.add_argument("--notes", default="")
    sub = parser.add_subparsers(dest="command")

    sub.add_parser("list", help="List available files on server")
    get_p = sub.add_parser("get", help="Download a file and verify SHA-256")
    get_p.add_argument("filename")
    get_p.add_argument("--repeat", type=int, default=1, help="Download N times in a loop")
    sub.add_parser("loop", help="Interactive command loop")

    args = parser.parse_args()

    if args.command == "list":
        files = list_remote_files(args.host, args.port)
        print(json.dumps(files, indent=2))
    elif args.command == "get":
        results: list[TransferResult] = []
        for i in range(max(1, args.repeat)):
            res = download_file(
                args.host,
                args.port,
                args.filename,
                download_dir=args.download_dir,
                csv_path=args.csv,
                notes=args.notes or (f"run-{i + 1}" if args.repeat > 1 else ""),
            )
            results.append(res)
        print_results_table(results)
    elif args.command == "loop":
        run_interactive_loop(args.host, args.port, args.download_dir, args.csv)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
