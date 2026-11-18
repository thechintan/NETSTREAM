"""Multi-threaded TCP file-transfer server using Python standard library only.

Protocol (UTF-8 lines ending in '\\n'):
  LIST          -> OK|<byte_length>\\n<json_bytes>
  GET|<name>    -> OK|<size>|<sha256>\\n<raw_bytes_in_64KiB_chunks>
  BYE           -> OK|BYE\\n (closes connection)
  Errors        -> ERR|<message>\\n
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import stat
import threading
from pathlib import Path
from typing import Any

from protocol import (
    CHUNK_SIZE,
    BufferedSocketReader,
    ProtocolError,
    compute_file_sha256,
    resolve_safe_file,
)


def list_catalogue(videos_dir: Path) -> list[dict[str, Any]]:
    """Return sorted JSON-serializable metadata for regular files inside `videos_dir`."""
    root = videos_dir.resolve()
    if not root.exists() or not root.is_dir():
        return []

    entries: list[dict[str, Any]] = []
    for child in sorted(root.iterdir(), key=lambda p: p.name):
        try:
            resolved = child.resolve()
            resolved.relative_to(root)
            st = os.stat(resolved)
            if stat.S_ISREG(st.st_mode):
                entries.append({"name": child.name, "size": st.st_size})
        except (OSError, ValueError):
            continue
    return entries


class TcpFileServer:
    """Thread-per-client TCP server implementing the NetStream lab file protocol."""

    def __init__(
        self,
        host: str = "127.0.0.1",
        port: int = 9000,
        videos_dir: Path = Path("lab/videos"),
    ) -> None:
        self.host = host
        self.port = port
        self.videos_dir = Path(videos_dir)
        self._stop_event = threading.Event()
        self._server_sock: socket.socket | None = None
        self._accept_thread: threading.Thread | None = None
        self._client_threads: list[threading.Thread] = []
        self._lock = threading.Lock()

    @property
    def address(self) -> tuple[str, int]:
        if self._server_sock is None:
            return (self.host, self.port)
        addr = self._server_sock.getsockname()
        return (str(addr[0]), int(addr[1]))

    def start(self, background: bool = False) -> None:
        self.videos_dir.mkdir(parents=True, exist_ok=True)
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind((self.host, self.port))
        sock.listen(64)
        sock.settimeout(0.5)
        self._server_sock = sock
        self._stop_event.clear()

        if background:
            self._accept_thread = threading.Thread(
                target=self._accept_loop, name="tcp-accept", daemon=True
            )
            self._accept_thread.start()
        else:
            self._accept_loop()

    def stop(self) -> None:
        self._stop_event.set()
        if self._server_sock is not None:
            try:
                self._server_sock.close()
            except OSError:
                pass
            self._server_sock = None

        if self._accept_thread is not None:
            self._accept_thread.join(timeout=3.0)
            self._accept_thread = None

        with self._lock:
            threads = list(self._client_threads)
        for t in threads:
            t.join(timeout=2.0)

    def _accept_loop(self) -> None:
        assert self._server_sock is not None
        try:
            while not self._stop_event.is_set():
                try:
                    conn, addr = self._server_sock.accept()
                except socket.timeout:
                    continue
                except OSError:
                    break

                t = threading.Thread(
                    target=self._handle_client,
                    args=(conn, addr),
                    name=f"tcp-client-{addr[0]}:{addr[1]}",
                    daemon=True,
                )
                with self._lock:
                    self._client_threads = [c for c in self._client_threads if c.is_alive()]
                    self._client_threads.append(t)
                t.start()
        finally:
            if self._server_sock is not None:
                try:
                    self._server_sock.close()
                except OSError:
                    pass

    def _send_error(self, conn: socket.socket, message: str) -> None:
        clean = message.replace("\r", " ").replace("\n", " ")
        conn.sendall(f"ERR|{clean}\n".encode("utf-8"))

    def _handle_client(self, conn: socket.socket, _addr: tuple[str, int]) -> None:
        try:
            with conn:
                conn.settimeout(30.0)
                reader = BufferedSocketReader(conn)

                while not self._stop_event.is_set():
                    try:
                        line = reader.readline()
                    except ProtocolError as exc:
                        self._send_error(conn, str(exc))
                        break
                    except (ConnectionError, OSError):
                        break

                    if line is None:
                        break

                    cmd_line = line.strip()
                    if not cmd_line:
                        self._send_error(conn, "Empty command")
                        continue

                    if cmd_line == "LIST":
                        payload = json.dumps(list_catalogue(self.videos_dir)).encode("utf-8")
                        header = f"OK|{len(payload)}\n".encode("utf-8")
                        conn.sendall(header)
                        conn.sendall(payload)
                        continue

                    if cmd_line == "BYE":
                        conn.sendall(b"OK|BYE\n")
                        break

                    if cmd_line.startswith("GET|"):
                        filename = cmd_line[4:]
                        if "|" in filename or not filename:
                            self._send_error(conn, "Malformed GET command")
                            continue

                        try:
                            file_path = resolve_safe_file(self.videos_dir, filename)
                        except FileNotFoundError:
                            self._send_error(conn, f"File not found: {filename}")
                            continue
                        except ValueError as exc:
                            self._send_error(conn, str(exc))
                            continue

                        size, sha256_hex = compute_file_sha256(file_path)
                        conn.sendall(f"OK|{size}|{sha256_hex}\n".encode("utf-8"))

                        with file_path.open("rb") as f:
                            while True:
                                chunk = f.read(CHUNK_SIZE)
                                if not chunk:
                                    break
                                conn.sendall(chunk)
                        continue

                    self._send_error(conn, f"Unknown or malformed command: {cmd_line}")
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, TimeoutError, OSError):
            # Client disconnected mid-transfer: clean up quietly and keep serving
            pass


def main() -> None:
    parser = argparse.ArgumentParser(description="NetStream Lab TCP File Server")
    parser.add_argument("--host", default="127.0.0.1", help="Bind host (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=9000, help="Bind port (default: 9000)")
    parser.add_argument(
        "--videos-dir",
        type=Path,
        default=Path("lab/videos"),
        help="Directory to serve regular files from (default: lab/videos)",
    )
    args = parser.parse_args()

    server = TcpFileServer(host=args.host, port=args.port, videos_dir=args.videos_dir)
    print(f"TCP File Server listening on {args.host}:{args.port} (dir={args.videos_dir})")
    try:
        server.start(background=False)
    except KeyboardInterrupt:
        print("\nShutting down TCP server...")
    finally:
        server.stop()


if __name__ == "__main__":
    main()
