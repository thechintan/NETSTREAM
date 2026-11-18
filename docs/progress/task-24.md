# Task 24: Python TCP File-Transfer Lab
- Built `lab/tcp` (stdlib-only): `protocol.py` (`BufferedSocketReader` header+length framing, 64 KiB streaming, strict path-traversal/symlink/regular-file guard), `server.py` (thread-per-client `LIST`, `GET|<file>`, `BYE`), `client.py` (SHA-256 verification, throughput Mbps, `lab/results/tcp_results.csv`, loop mode), and `multi_client.py` (N concurrent downloads).
- Documented the TCP byte-stream framing rule and usage commands in `lab/README.md`.
- Verified `python -m pytest lab/tcp/test_tcp.py -v` (6/6 pass: happy path + SHA-256 + CSV, empty catalogue, traversal/missing/malformed errors, 3 concurrent clients, mid-transfer abort recovery, 1-byte-at-a-time header framing).
