# NetStream Computer Networks Lab Guide

This document is the complete guide for running the socket programming labs and the empirical networking experiments (E2 through E8).

---

## 1. Network Labs Architecture

The `lab/` directory provides standalone networking experiments demonstrating core transport layer principles:
* **TCP Lab (`lab/tcp/`)**: Multi-threaded socket server and client demonstrating reliable byte streams, stream-safe framing, chunking, and application-level integrity verification (SHA-256).
* **UDP Lab (`lab/udp/`)**: Custom binary packet protocol demonstrating unreliable datagrams, sequence number tracking, loss simulation, jitter calculation, and duplicate detection.
* **Experiments Suite (`lab/experiments/`)**: Automated Playwright headless browser runners, network impairment tooling (`tc netem`), and telemetry collectors for real WebRTC media evaluation.
* **Analysis & Visualization (`lab/analysis/`)**: Matplotlib analysis generating publication-quality performance graphs from recorded experiment CSVs.

---

## 2. Lab 1: Python TCP File Transfer Lab

### Running the TCP Server
```bash
python lab/tcp/server.py --port 9000 --videos-dir lab/videos
```
* **Protocol Framing**: Command lines terminate with `\n` (`LIST`, `GET|<filename>`, `BYE`).
* **Safe Framing**: Uses a buffered reader (`lab/tcp/protocol.py`) that handles TCP segment fragmentation (never assumes one `recv()` equals one application message).
* **Path Traversal Protection**: Rejects `..`, absolute paths, and symlinks outside `videos-dir`.
* **Integrity**: Sends `OK|<size>|<sha256_hash>` header followed by raw bytes in 64 KiB chunks.

### Running the TCP Client
```bash
# List available files
python lab/tcp/client.py --host 127.0.0.1 --port 9000 list

# Download a file and verify SHA-256 integrity
python lab/tcp/client.py --host 127.0.0.1 --port 9000 get test_720p.mp4

# Run loop benchmark with 10 iterations
python lab/tcp/client.py --host 127.0.0.1 --port 9000 loop test_720p.mp4 10

# Run multi-client concurrency benchmark (5 parallel workers)
python lab/tcp/multi_client.py --host 127.0.0.1 --port 9000 --clients 5 --file test_720p.mp4
```

---

## 3. Lab 2: Python UDP Packet Protocol Lab

### Protocol Specification
Each custom UDP packet is packed with standard library `struct` into a 24-byte binary header:
```text
0                   1                   2                   3
0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|       Magic (0x4E53)          |         Sequence (uint32)     |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                       Timestamp (uint64, us)                  |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|      Payload Length (uint16)  |          Flags (uint16)       |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                       CRC32 Checksum                          |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                       Payload Data ...                        |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

### Running UDP Receiver & Sender
```bash
# Terminal 1: Start Receiver
python lab/udp/receiver.py --port 9999 --simulated-loss 0.05 --simulated-delay 20

# Terminal 2: Start Sender (10,000 packets at 1000 pps)
python lab/udp/sender.py --host 127.0.0.1 --port 9999 --rate 1000 --count 10000

# Automated Loss Matrix Test (iterates across 0%, 1%, 3%, 5%, 10% loss)
python lab/udp/run_matrix.py
```

---

## 4. Empirical Experiments E2 to E8

### Impairment Setup (`netem.sh`)
* **Linux**: Uses Linux Kernel `tc qdisc` traffic control.
  ```bash
  # Check syntax (dry run)
  bash lab/experiments/netem.sh --iface eth0 --profile loss-1 --dry-run
  # Apply profile
  sudo bash lab/experiments/netem.sh --iface eth0 --profile loss-1 --confirm
  # Clear impairment
  sudo bash lab/experiments/netem.sh --iface eth0 --clear --confirm
  ```
* **Windows**: Use [Clumsy](https://jagt.github.io/clumsy/) with filter `udp and (udp.DstPort >= 40000 and udp.DstPort <= 40100)`.
* **macOS**: Use **Network Link Conditioner**.

---

### Experiment Overview Matrix

| ID | Title | Method / Command | Primary Metric |
|---|---|---|---|
| **E2** | Video Quality Under Packet Loss | `tsx lab/experiments/viewers.ts --scenario loss-X` | Bitrate, Packet Loss %, Freezes |
| **E3** | Latency & Jitter Under Delay | `tsx lab/experiments/viewers.ts --scenario delay-X` | RTT (ms), Jitter (ms) |
| **E4** | Simulcast Bandwidth Adaptation | `tsx lab/experiments/viewers.ts --scenario rate-X` | Active Spatial Layer (`r0`, `r1`, `r2`) |
| **E5** | WebRTC vs HLS Latency | Compare WebRTC `currentTime` lag to HLS `m3u8` | End-to-end glass-to-glass latency |
| **E6** | Chat Gateway Concurrency | `tsx lab/experiments/chat_load.ts -c 50 -m 20` | Broadcast delivery latency & error rate |
| **E7** | TURN Relay vs Direct Host | Toggle `iceTransportPolicy: relay` in Studio | RTT, Candidate Type (`relay` vs `host`) |
| **E8** | Stream Failover & Reconnect | Disconnect streamer for 15s; resume socket | Reconnect grace window survival |

---

## 5. Metric Interpretation Guide

1. **Round Trip Time (RTT)**:
   * Sourced from WebRTC `candidate-pair.currentRoundTripTime`. Ideal WebRTC is `< 100ms`; above `250ms`, interactive degradation occurs.
2. **Jitter Buffer Delay**:
   * Sourced from `inbound-rtp.jitter`. Measures packet inter-arrival variance. Controlled by receiver playout delay buffers.
3. **Freeze Count & Duration**:
   * Sourced from `inbound-rtp.freezeCount` and `totalFreezesDuration`. Triggered when frame rendering pauses for `> 1000ms`.
4. **NACK Count**:
   * Cumulative missing RTP packets requested upstream via RFC 4585 feedback.
5. **PLI Count**:
   * Cumulative full keyframe intra-requests sent upstream due to unrecoverable packet loss or initial synchronization.

---

## 6. Plotting Graphs

All experiment CSVs saved to `lab/results/` are rendered into visual charts using:
```bash
python lab/analysis/plot.py
```
Generated graphs in `lab/results/graphs/`:
* `chat_latency_vs_clients.png`
* `observed_vs_simulated_loss.png`
* `rtt_distributions.png`
* `simulcast_layers_vs_bandwidth.png`
* `throughput_vs_loss.png`
* `webrtc_bitrate_freezes_vs_loss.png`
* `webrtc_vs_hls_latency.png`
