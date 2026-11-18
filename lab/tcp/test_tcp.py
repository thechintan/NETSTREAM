"""Pytest suite for Task 24: Python TCP file-transfer lab."""

from __future__ import annotations

import csv
import hashlib
import os
import socket
import sys
import time
from pathlib import Path

import pytest

# Allow importing sibling modules directly
sys.path.insert(0, str(Path(__file__).resolve().parent))

from client import download_file, list_remote_files  # noqa: E402
from multi_client import run_concurrent_downloads  # noqa: E402
from protocol import BufferedSocketReader  # noqa: E402
from server import TcpFileServer  # noqa: E402


@pytest.fixture()
def tcp_env(tmp_path: Path):
    videos_dir = tmp_path / "videos"
    downloads_dir = tmp_path / "downloads"
    results_csv = tmp_path / "results" / "tcp_results.csv"
    videos_dir.mkdir()

    # Create sample regular files
    small_data = b"NetStream TCP Lab Payload\n" * 400
    (videos_dir / "sample.bin").write_bytes(small_data)

    # Larger 512 KiB file for multi-chunk & mid-transfer abort tests
    large_data = os.urandom(512 * 1024)
    (videos_dir / "clip_512k.bin").write_bytes(large_data)

    # Secret file outside videos_dir for traversal tests
    outside_secret = tmp_path / "secret.txt"
    outside_secret.write_text("TOP SECRET", encoding="utf-8")

    server = TcpFileServer(host="127.0.0.1", port=0, videos_dir=videos_dir)
    server.start(background=True)
    host, port = server.address

    try:
        yield {
            "host": host,
            "port": port,
            "videos_dir": videos_dir,
            "downloads_dir": downloads_dir,
            "csv": results_csv,
            "small_data": small_data,
            "large_data": large_data,
            "outside_secret": outside_secret,
        }
    finally:
        server.stop()


def test_list_and_get_happy_path_and_hash_match(tcp_env):
    files = list_remote_files(tcp_env["host"], tcp_env["port"])
    names = [f["name"] for f in files]
    assert "sample.bin" in names
    assert "clip_512k.bin" in names

    res = download_file(
        tcp_env["host"],
        tcp_env["port"],
        "sample.bin",
        download_dir=tcp_env["downloads_dir"],
        csv_path=tcp_env["csv"],
        notes="happy-path",
    )

    expected_hash = hashlib.sha256(tcp_env["small_data"]).hexdigest()
    assert res.integrity == "PASS"
    assert res.bytes_transferred == len(tcp_env["small_data"])
    assert res.actual_sha256 == expected_hash
    assert res.output_path.read_bytes() == tcp_env["small_data"]
    assert res.mbps > 0

    # Confirm CSV logged properly
    with tcp_env["csv"].open("r", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    assert len(rows) == 1
    assert rows[0]["file"] == "sample.bin"
    assert rows[0]["integrity"] == "PASS"


def test_empty_catalogue(tmp_path: Path):
    empty_dir = tmp_path / "empty_videos"
    empty_dir.mkdir()
    server = TcpFileServer(host="127.0.0.1", port=0, videos_dir=empty_dir)
    server.start(background=True)
    try:
        host, port = server.address
        assert list_remote_files(host, port) == []
    finally:
        server.stop()


def test_path_traversal_and_missing_file_rejected(tcp_env):
    bad_names = [
        "../secret.txt",
        "..\\secret.txt",
        "/etc/passwd",
        "sub/file.bin",
        "C:\\Windows\\win.ini",
        ".",
        "..",
    ]

    for bad in bad_names:
        with pytest.raises(RuntimeError):
            download_file(
                tcp_env["host"],
                tcp_env["port"],
                bad,
                download_dir=tcp_env["downloads_dir"],
                csv_path=None,
            )

    # Missing file returns clean ERR
    with pytest.raises(RuntimeError, match="File not found"):
        download_file(
            tcp_env["host"],
            tcp_env["port"],
            "does_not_exist.bin",
            download_dir=tcp_env["downloads_dir"],
            csv_path=None,
        )

    # Malformed command returns ERR and connection remains usable
    with socket.create_connection((tcp_env["host"], tcp_env["port"]), timeout=5.0) as sock:
        reader = BufferedSocketReader(sock)
        sock.sendall(b"GARBAGE_CMD\n")
        resp = reader.readline()
        assert resp is not None and resp.startswith("ERR|")
        sock.sendall(b"BYE\n")
        assert reader.readline() == "OK|BYE"


def test_three_concurrent_clients(tcp_env):
    results = run_concurrent_downloads(
        host=tcp_env["host"],
        port=tcp_env["port"],
        filename="clip_512k.bin",
        num_clients=3,
        download_dir=tcp_env["downloads_dir"],
        csv_path=tcp_env["csv"],
    )

    expected_hash = hashlib.sha256(tcp_env["large_data"]).hexdigest()
    assert len(results) == 3
    for r in results:
        assert r.integrity == "PASS"
        assert r.actual_sha256 == expected_hash
        assert r.client_count == 3


def test_client_abort_mid_transfer_then_next_client_succeeds(tcp_env):
    # Client 1 requests 512 KiB file, reads 64 bytes, then abruptly disconnects
    sock = socket.create_connection((tcp_env["host"], tcp_env["port"]), timeout=5.0)
    sock.sendall(b"GET|clip_512k.bin\n")
    _ = sock.recv(64)
    sock.close()

    # Client 2 must still succeed cleanly
    res = download_file(
        tcp_env["host"],
        tcp_env["port"],
        "clip_512k.bin",
        download_dir=tcp_env["downloads_dir"],
        csv_path=None,
    )
    assert res.integrity == "PASS"
    assert res.bytes_transferred == len(tcp_env["large_data"])


def test_one_byte_at_a_time_header_framing(tcp_env):
    """Sends the command header one byte at a time to prove framing never assumes 1 recv == 1 message."""
    with socket.create_connection((tcp_env["host"], tcp_env["port"]), timeout=10.0) as sock:
        sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        cmd = b"GET|sample.bin\n"
        for b in cmd:
            sock.sendall(bytes([b]))
            time.sleep(0.002)

        reader = BufferedSocketReader(sock, chunk_size=7)  # tiny recv buffer on client side too
        header = reader.readline()
        assert header is not None and header.startswith("OK|")
        _, size_str, sha_hex = header.split("|")
        size = int(size_str)

        body = reader.read_exact(size)
        assert len(body) == len(tcp_env["small_data"])
        assert hashlib.sha256(body).hexdigest() == sha_hex
        assert body == tcp_env["small_data"]
