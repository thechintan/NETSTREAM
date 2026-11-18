# Task 25: Python UDP Measurement Lab
- Built `lab/udp` (stdlib-only): `packet.py` (`struct` `!2sBBIQ` network-byte-order header + configurable payload), `receiver.py` (unique/duplicate/reordered/bytes tracking, optional ACK echo, END & idle-timeout summary), `sender.py` (ACK RTT avg/median/p95, clearly labelled `SIMULATED` drop & fixed delay, `lab/results/udp_results.csv`), and `run_matrix.py` (payload x count x drop matrix).
- Documented all Blueprint v1 section 10 metric definitions and the single-observation loss warning in `lab/README.md`.
- Verified `python -m pytest lab/udp/test_udp.py -v` (5/5 pass: packet roundtrip, crafted duplicate/reordered counts, 10,000-packet simulated drop tolerance, fixed-delay RTT, tracker sanity).
