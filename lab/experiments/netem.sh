#!/usr/bin/env bash
# ==============================================================================
# NetStream Live - Linux Traffic Control (tc netem) Network Impairment Tool
# ==============================================================================
#
# IMPORTANT NOTICE FOR WINDOWS & MACOS USERS:
# --------------------------------------------
# Linux `tc netem` is native to Linux kernels (or Linux VMs/WSL2 with iproute2).
# If running on macOS or Windows directly on the host:
#   - macOS: Use Apple's "Network Link Conditioner" (Xcode Additional Tools)
#            or `dnctl` / `pfctl` rules.
#   - Windows: Use "Clumsy" (https://jagt.github.io/clumsy/) or clumsy-0.3
#              which injects packet loss, lag, duplicate, and throttle via WinDivert.
#
# USAGE:
#   ./netem.sh --iface <interface> --profile <profile> [--confirm] [--dry-run]
#   ./netem.sh --iface <interface> --clear [--confirm] [--dry-run]
#
# PROFILES:
#   loss-1                : 1% packet loss
#   loss-3                : 3% packet loss
#   loss-5                : 5% packet loss
#   loss-10               : 10% packet loss
#   delay-50              : 50ms one-way delay
#   delay-100             : 100ms one-way delay
#   delay-200-jitter-50   : 200ms delay with +/-50ms normal jitter
#   rate-5mbit            : 5 Mbps bandwidth cap
#   rate-1mbit            : 1 Mbps bandwidth cap
#   rate-300kbit          : 300 kbps bandwidth cap
# ==============================================================================

set -euo pipefail

IFACE=""
PROFILE=""
CLEAR=0
CONFIRM=0
DRY_RUN=0

print_usage() {
  cat <<EOF
Usage: $0 --iface <interface> [--profile <name> | --clear] [--confirm] [--dry-run]

Options:
  -i, --iface <name>    Network interface (e.g. eth0, wlan0, lo). REQUIRED.
  -p, --profile <name>  Impairment profile name.
  -c, --clear           Clear any active tc qdisc on the interface.
  --confirm             Explicit confirmation to apply changes (required unless --dry-run).
  -d, --dry-run         Print the exact tc commands without executing them.
  -h, --help            Show this help message.

Supported Profiles:
  loss-1, loss-3, loss-5, loss-10
  delay-50, delay-100, delay-200-jitter-50
  rate-5mbit, rate-1mbit, rate-300kbit
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -i|--iface)
      IFACE="$2"
      shift 2
      ;;
    -p|--profile)
      PROFILE="$2"
      shift 2
      ;;
    -c|--clear)
      CLEAR=1
      shift
      ;;
    --confirm)
      CONFIRM=1
      shift
      ;;
    -d|--dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      print_usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      print_usage
      exit 1
      ;;
  esac
done

if [[ -z "$IFACE" ]]; then
  echo "ERROR: Missing required --iface argument." >&2
  print_usage
  exit 1
fi

if [[ $CLEAR -eq 0 && -z "$PROFILE" ]]; then
  echo "ERROR: Specify either --profile <name> or --clear." >&2
  print_usage
  exit 1
fi

declare -A NETEM_ARGS
NETEM_ARGS["loss-1"]="netem loss 1%"
NETEM_ARGS["loss-3"]="netem loss 3%"
NETEM_ARGS["loss-5"]="netem loss 5%"
NETEM_ARGS["loss-10"]="netem loss 10%"
NETEM_ARGS["delay-50"]="netem delay 50ms"
NETEM_ARGS["delay-100"]="netem delay 100ms"
NETEM_ARGS["delay-200-jitter-50"]="netem delay 200ms 50ms distribution normal"
NETEM_ARGS["rate-5mbit"]="netem rate 5mbit limit 1000"
NETEM_ARGS["rate-1mbit"]="netem rate 1mbit limit 1000"
NETEM_ARGS["rate-300kbit"]="netem rate 300kbit limit 1000"

run_cmd() {
  local cmd="$*"
  echo "[CMD] $cmd"
  if [[ $DRY_RUN -eq 0 ]]; then
    eval "$cmd"
  fi
}

# Clear mode
if [[ $CLEAR -eq 1 ]]; then
  echo "Target Interface : $IFACE"
  echo "Operation        : Clear all tc qdisc impairments"

  if [[ $DRY_RUN -eq 0 && $CONFIRM -eq 0 ]]; then
    read -r -p "Apply changes to network interface $IFACE? [y/N] " response
    if [[ ! "$response" =~ ^([yY][eE][sS]|[yY])$ ]]; then
      echo "Aborted."
      exit 1
    fi
  fi

  run_cmd "tc qdisc del dev $IFACE root 2>/dev/null || true"
  echo "SUCCESS: Impairments cleared on $IFACE."
  exit 0
fi

# Apply profile mode
if [[ -z "${NETEM_ARGS[$PROFILE]+_}" ]]; then
  echo "ERROR: Unknown profile '$PROFILE'." >&2
  echo "Available profiles: ${!NETEM_ARGS[*]}" >&2
  exit 1
fi

RULES="${NETEM_ARGS[$PROFILE]}"

echo "=========================================================="
echo "NetStream Impairment Configuration"
echo "=========================================================="
echo "Interface : $IFACE"
echo "Profile   : $PROFILE"
echo "Rules     : $RULES"
echo "=========================================================="

if [[ $DRY_RUN -eq 0 && $CONFIRM -eq 0 ]]; then
  read -r -p "Apply impairment '$PROFILE' to $IFACE? [y/N] " response
  if [[ ! "$response" =~ ^([yY][eE][sS]|[yY])$ ]]; then
    echo "Aborted."
    exit 1
  fi
fi

# Reset existing root qdisc then replace
run_cmd "tc qdisc del dev $IFACE root 2>/dev/null || true"
run_cmd "tc qdisc replace dev $IFACE root $RULES"

echo "SUCCESS: Applied profile '$PROFILE' ($RULES) on interface $IFACE."
