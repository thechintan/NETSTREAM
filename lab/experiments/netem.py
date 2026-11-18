"""Python companion / parser for tc netem profiles (supports Linux tc and cross-platform dry-run)."""

from __future__ import annotations

import argparse
import subprocess
import sys

PROFILES = {
    "loss-1": "netem loss 1%",
    "loss-3": "netem loss 3%",
    "loss-5": "netem loss 5%",
    "loss-10": "netem loss 10%",
    "delay-50": "netem delay 50ms",
    "delay-100": "netem delay 100ms",
    "delay-200-jitter-50": "netem delay 200ms 50ms distribution normal",
    "rate-5mbit": "netem rate 5mbit limit 1000",
    "rate-1mbit": "netem rate 1mbit limit 1000",
    "rate-300kbit": "netem rate 300kbit limit 1000",
}


def build_netem_commands(iface: str, profile: str | None = None, clear: bool = False) -> list[str]:
    if not iface:
        raise ValueError("Interface is required")
    if clear:
        return [f"tc qdisc del dev {iface} root 2>/dev/null || true"]

    if not profile or profile not in PROFILES:
        raise ValueError(f"Unknown profile: {profile}. Available: {list(PROFILES.keys())}")

    rule = PROFILES[profile]
    return [
        f"tc qdisc del dev {iface} root 2>/dev/null || true",
        f"tc qdisc replace dev {iface} root {rule}",
    ]


def main() -> None:
    parser = argparse.ArgumentParser(description="Linux tc netem traffic control tool")
    parser.add_argument("-i", "--iface", required=True, help="Network interface")
    parser.add_argument("-p", "--profile", choices=list(PROFILES.keys()), help="Impairment profile")
    parser.add_argument("-c", "--clear", action="store_true", help="Clear all impairments")
    parser.add_argument("--confirm", action="store_true", help="Confirm execution")
    parser.add_argument("-d", "--dry-run", action="store_true", help="Print commands without running")
    args = parser.parse_args()

    try:
        cmds = build_netem_commands(args.iface, args.profile, args.clear)
    except ValueError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)

    print("==========================================================")
    print("NetStream Impairment Configuration")
    print(f"Interface : {args.iface}")
    print(f"Action    : {'CLEAR' if args.clear else args.profile}")
    print("==========================================================")

    for cmd in cmds:
        print(f"[CMD] {cmd}")

    if args.dry_run:
        print("[DRY RUN] Commands printed without executing.")
        return

    if not args.confirm:
        resp = input("Apply changes? [y/N] ").strip().lower()
        if resp not in ("y", "yes"):
            print("Aborted.")
            sys.exit(1)

    for cmd in cmds:
        subprocess.run(cmd, shell=True, check=False)
    print("SUCCESS: Network settings updated.")


if __name__ == "__main__":
    main()
