# Experiment E4: Transport Layer Metrics (TCP Goodput vs UDP Datagrams vs RTT)

## Goal
Compare TCP stream goodput under synthetic loss against UDP datagram throughput and measure UDP Round-Trip Time (RTT) across latency profiles.

## Condition Table to Record

| Parameter | Recommended Value / Setting | Actual Recorded |
|---|---|---|
| TCP Chunk Size | 64 KiB | |
| UDP Payload Sizes | 256 B, 512 B, 1024 B | |
| UDP Counts | 500, 2000 packets | |
| Loss Conditions | 0%, 1%, 3%, 5%, 10% | |
| Artificial Delays | 0 ms, 20 ms, 50 ms, 100 ms | |
| Repetitions | 3 per condition | |

## Step-by-Step Execution

1. **TCP File Transfer Benchmark**:
   ```bash
   python lab/tcp/server.py --port 9000 &
   python lab/tcp/client.py get sample.bin --repeat 3 --notes run-loss-0
   # Inject loss with netem or clumsy, then re-run:
   python lab/tcp/client.py get sample.bin --repeat 3 --notes run-loss-5
   ```
2. **UDP Measurement Matrix**:
   ```bash
   python lab/udp/run_matrix.py --payload-sizes 256 1024 --counts 2000 --sim-drops 0.0 0.01 0.03 0.05 0.10 --runs 3 --ack
   ```
3. **Outputs**:
   - `lab/results/tcp_results.csv`
   - `lab/results/udp_results.csv`
