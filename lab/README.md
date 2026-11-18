# NetStream Live — Computer Networks Labs (`lab/`)

Standalone Python 3.11+ standard-library-only labs for studying TCP stream framing, concurrent file transfer throughput, and UDP packet loss / reordering / RTT measurements.

---

## 1. TCP File-Transfer Lab (`lab/tcp`)

### Protocol Framing Rule (TCP Is a Byte Stream)

TCP provides a reliable, ordered **byte stream**, not message boundaries. A single `send()` on the server may be split across multiple `recv()` calls on the client, and multiple `send()` calls may be coalesced into one `recv()`.

To make framing deterministic regardless of kernel segmentation or packet coalescing, this lab uses a **newline-delimited header + explicit byte-length** design implemented in `lab/tcp/protocol.py` (`BufferedSocketReader`):

- **Commands (client → server)** — one UTF-8 line terminated by `\n`:
  - `LIST\n`
  - `GET|<filename>\n`
  - `BYE\n`
- **Responses (server → client)**:
  - `LIST` → `OK|<byte_length>\n` followed by **exact** `<byte_length>` bytes of UTF-8 JSON listing regular files in the configured directory.
  - `GET` → `OK|<size>|<sha256>\n` followed by **exact** `<size>` raw bytes streamed in 64 KiB chunks.
  - Errors → `ERR|<message>\n`.
- **Buffered reading**: `BufferedSocketReader.readline()` accumulates bytes until `\n` while retaining any leftover bytes for the immediately following `read_exact(n)` or `read_exact_to_file(n, file)` call. It never assumes `1 recv() == 1 message` (proven by `test_one_byte_at_a_time_header_framing`).
- **Path safety**: `resolve_safe_file()` rejects `/`, `\`, `..`, absolute paths, drive letters, non-regular files, and symlinks resolving outside `videos_dir`.

### Running the TCP Lab

```bash
# Start server (default binds 127.0.0.1:9000, serves lab/videos)
python lab/tcp/server.py --videos-dir lab/videos

# List remote files
python lab/tcp/client.py list

# Download a file (writes to lab/downloads, verifies SHA-256, appends lab/results/tcp_results.csv)
python lab/tcp/client.py get sample.bin

# Interactive loop mode
python lab/tcp/client.py loop

# Run N concurrent clients downloading the same file
python lab/tcp/multi_client.py sample.bin -n 4

# Run pytest acceptance suite
python -m pytest lab/tcp/test_tcp.py -v
```

---

## 2. UDP Measurement Lab (`lab/udp`)

### Binary Packet Format (Network Byte Order `!2sBBIQ`)

| Field | Size | Type | Description |
|---|---:|---|---|
| `magic` | 2 B | `2s` | Constant `b"NS"` |
| `version` | 1 B | `uint8` | Protocol version (`1`) |
| `flags` | 1 B | `uint8` | `bit0 = ACK requested`, `bit1 = ACK reply`, `bit2 = END control` |
| `sequence` | 4 B | `uint32` | Monotonic packet sequence number (`0 .. N-1`) |
| `send_time_ns` | 8 B | `uint64` | Sender monotonic timestamp in nanoseconds |
| `payload` | configurable | `bytes` | Padding payload to configured size |

### Metric Definitions (Blueprint v1 Section 10)

- **`sent`**: Total logical datagrams scheduled by the sender for the run (`N`).
- **`received`**: Count of **unique** sequence numbers observed by the receiver.
- **`missing`**: `max(0, sent - received)` — packets never received within the observation window.
- **`observed_loss_pct`**: `(missing / sent) * 100` — fraction of packets missing during this run.
- **`duplicates`**: Count of packets whose sequence number was already recorded in the receiver's unique set.
- **`reordered`** *(out-of-order)*: Count of newly seen unique packets arriving with `sequence < max_sequence_seen_so_far`.
- **`elapsed_s`**: Wall-clock duration at the sender from first packet scheduled to final packet transmitted (`time.perf_counter`).
- **`observation_window_s`**: Interval at the receiver between first packet arrival and last packet arrival (`(last_rx_ns - first_rx_ns) / 1e9`).
- **`throughput_mbps`**: Application-layer goodput computed as `(bytes_received * 8) / elapsed_s / 1e6`.
- **`rtt_avg_ms`, `rtt_median_ms`, `rtt_p95_ms`**: Mean, 50th percentile, and 95th percentile Round-Trip Time in milliseconds computed in ACK mode from `(ack_rx_ns - echoed_send_time_ns) / 1e6`.
- **`SIMULATED_*` columns (`SIMULATED_drop_rate`, `SIMULATED_delay_ms`, `SIMULATED_dropped_packets`)**: Artificial sender-side impairments explicitly tagged `SIMULATED` in both console reports and `lab/results/udp_results.csv` so synthetic lab loss/delay is never confused with real network impairment.

> **Important Statistical Warning**: A single observed loss figure (`observed_loss_pct`) is a point-in-time measurement of one finite observation window — it is **NOT** the network's permanent loss rate. Real packet loss is bursty and varies with router queue occupancy, Wi-Fi contention, cross-traffic, packet size, and sending rate. Always run multiple repetitions (`run_matrix.py`) and record every condition alongside the observation window.

### Running the UDP Lab

```bash
# Terminal 1: start receiver
python lab/udp/receiver.py --port 9100

# Terminal 2: run sender (with ACK mode and optional SIMULATED impairments)
python lab/udp/sender.py --port 9100 -n 1000 --payload-size 512 --ack --sim-drop 0.05 --sim-delay-ms 10

# Run full matrix (payload sizes x counts x simulated drop rates) -> lab/results/udp_results.csv
python lab/udp/run_matrix.py --payload-sizes 256 1024 --counts 500 2000 --sim-drops 0.0 0.05 0.15 --runs 2

# Run pytest acceptance suite
python -m pytest lab/udp/test_udp.py -v
```
