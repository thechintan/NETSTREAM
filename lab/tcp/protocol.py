"""Shared framing protocol and path safety utilities for the TCP file-transfer lab."""

from __future__ import annotations

import hashlib
import os
import socket
import stat
from pathlib import Path
from typing import BinaryIO

CHUNK_SIZE = 65536  # 64 KiB
MAX_LINE_BYTES = 4096


class ProtocolError(Exception):
    """Raised when an incoming TCP stream violates framing or UTF-8 rules."""


class BufferedSocketReader:
    """Line-and-length buffered reader over a raw TCP byte stream.

    Never assumes a single socket.recv() corresponds to one application message.
    Bytes received beyond a newline delimiter remain buffered for subsequent
    readline() or read_exact() calls.
    """

    def __init__(self, sock: socket.socket, chunk_size: int = CHUNK_SIZE) -> None:
        self._sock = sock
        self._chunk_size = chunk_size
        self._buf = bytearray()

    def readline(self, max_bytes: int = MAX_LINE_BYTES) -> str | None:
        """Read a single UTF-8 command/header line terminated by '\\n'.

        Returns None on clean EOF when no partial bytes were read.
        """
        while True:
            nl_idx = self._buf.find(b"\n")
            if nl_idx != -1:
                if nl_idx > max_bytes:
                    raise ProtocolError("Header line exceeds maximum allowed length")
                raw_line = bytes(self._buf[:nl_idx])
                del self._buf[: nl_idx + 1]
                if raw_line.endswith(b"\r"):
                    raw_line = raw_line[:-1]
                try:
                    return raw_line.decode("utf-8")
                except UnicodeDecodeError as exc:
                    raise ProtocolError("Invalid UTF-8 in header line") from exc

            if len(self._buf) > max_bytes:
                raise ProtocolError("Header line exceeds maximum allowed length")

            chunk = self._sock.recv(self._chunk_size)
            if not chunk:
                if not self._buf:
                    return None
                raise ConnectionError("Unexpected EOF while reading header line")
            self._buf.extend(chunk)

    def read_exact(self, num_bytes: int) -> bytes:
        """Read exactly `num_bytes` from the stream (draining buffer first)."""
        if num_bytes < 0:
            raise ValueError("num_bytes must be non-negative")
        if num_bytes == 0:
            return b""

        out = bytearray()
        if self._buf:
            take = min(num_bytes, len(self._buf))
            out.extend(self._buf[:take])
            del self._buf[:take]

        while len(out) < num_bytes:
            remaining = num_bytes - len(out)
            chunk = self._sock.recv(min(self._chunk_size, remaining))
            if not chunk:
                raise ConnectionError(
                    f"Unexpected EOF: expected {num_bytes} bytes, received {len(out)}"
                )
            out.extend(chunk)

        return bytes(out)

    def read_exact_to_file(
        self,
        num_bytes: int,
        dest_file: BinaryIO,
    ) -> tuple[int, str]:
        """Stream exactly `num_bytes` to `dest_file` in chunks and return (bytes_written, sha256_hex)."""
        if num_bytes < 0:
            raise ValueError("num_bytes must be non-negative")

        hasher = hashlib.sha256()
        received = 0

        if self._buf and num_bytes > 0:
            take = min(num_bytes, len(self._buf))
            data = bytes(self._buf[:take])
            del self._buf[:take]
            dest_file.write(data)
            hasher.update(data)
            received += take

        while received < num_bytes:
            remaining = num_bytes - received
            chunk = self._sock.recv(min(self._chunk_size, remaining))
            if not chunk:
                raise ConnectionError(
                    f"Unexpected EOF: expected {num_bytes} bytes, received {received}"
                )
            dest_file.write(chunk)
            hasher.update(chunk)
            received += len(chunk)

        return received, hasher.hexdigest()


def resolve_safe_file(base_dir: Path, filename: str) -> Path:
    """Validate `filename` against path traversal and ensure it is a regular file inside `base_dir`.

    Rejects:
    - empty names, '.', '..'
    - any path separators ('/', '\\'), NUL bytes, or Windows drive letters (':')
    - absolute paths
    - symlinks whose target escapes `base_dir`
    - non-regular files (directories, FIFOs, sockets, devices)
    """
    if not filename or filename in (".", ".."):
        raise ValueError("Invalid filename")
    if "/" in filename or "\\" in filename or "\x00" in filename or ":" in filename:
        raise ValueError("Path traversal or invalid characters in filename")
    if ".." in filename.split(os.sep):
        raise ValueError("Path traversal detected")
    if Path(filename).is_absolute():
        raise ValueError("Absolute paths are not allowed")

    root = base_dir.resolve()
    candidate = base_dir / filename
    resolved = candidate.resolve()

    try:
        resolved.relative_to(root)
    except ValueError as exc:
        raise ValueError("Path escapes configured directory") from exc

    if not resolved.exists():
        raise FileNotFoundError(f"File not found: {filename}")

    st = os.stat(resolved)
    if not stat.S_ISREG(st.st_mode):
        raise ValueError("Requested path is not a regular file")

    return resolved


def compute_file_sha256(file_path: Path, chunk_size: int = CHUNK_SIZE) -> tuple[int, str]:
    """Compute file size and SHA-256 hex digest streaming in 64 KiB chunks."""
    hasher = hashlib.sha256()
    total = 0
    with file_path.open("rb") as f:
        while True:
            chunk = f.read(chunk_size)
            if not chunk:
                break
            hasher.update(chunk)
            total += len(chunk)
    return total, hasher.hexdigest()
