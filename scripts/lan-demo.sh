#!/usr/bin/env bash
# =============================================================================
# NetStream Live - LAN Demo Setup Script
# =============================================================================
# Detects host LAN IP, configures .env for local network streaming, sets up
# local TLS certificates if mkcert is available, and displays connection URLs.
#
# NOTE ON HTTPS:
# Mobile and remote browser devices require HTTPS (Secure Context) to access
# camera and microphone devices via navigator.mediaDevices.getUserMedia.
# Accessing via plaintext http://<LAN_IP> will block camera permissions!
# =============================================================================

set -e

echo "=== NetStream Live: LAN Demo Setup ==="

# 1. Detect LAN IP address
LAN_IP=""
if command -v hostname >/dev/null 2>&1; then
  LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
fi

if [ -z "$LAN_IP" ] && command -v ip >/dev/null 2>&1; then
  LAN_IP=$(ip route get 1.1.1.1 2>/dev/null | awk '{print $7}')
fi

if [ -z "$LAN_IP" ] && command -v ifconfig >/dev/null 2>&1; then
  LAN_IP=$(ifconfig | grep -Eo 'inet (addr:)?([0-9]*\.){3}[0-9]*' | grep -Eo '([0-9]*\.){3}[0-9]*' | grep -v '127.0.0.1' | head -n 1)
fi

if [ -z "$LAN_IP" ]; then
  read -r -p "Could not auto-detect LAN IP. Please enter host LAN IP (e.g., 192.168.1.50): " LAN_IP
fi

echo "Detected LAN IP: ${LAN_IP}"

# 2. Update .env configuration
ENV_FILE=".env"
if [ ! -f "$ENV_FILE" ]; then
  if [ -f ".env.example" ]; then
    cp .env.example .env
  else
    touch .env
  fi
fi

# Helper to update or append env var
set_env() {
  local key=$1
  local value=$2
  if grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
    sed -i.bak "s|^${key}=.*|${key}=${value}|" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
  else
    echo "${key}=${value}" >> "$ENV_FILE"
  fi
}

set_env "PUBLIC_IP" "${LAN_IP}"
set_env "TURN_HOST" "${LAN_IP}"
set_env "WEB_ORIGIN" "https://${LAN_IP}"
set_env "SITE_ADDRESS" "${LAN_IP}"
set_env "TLS_MODE" "internal"

echo "Updated .env with:"
echo "  PUBLIC_IP=${LAN_IP}"
echo "  TURN_HOST=${LAN_IP}"
echo "  WEB_ORIGIN=https://${LAN_IP}"
echo "  SITE_ADDRESS=${LAN_IP}"

# 3. Optional mkcert local CA provisioning
if command -v mkcert >/dev/null 2>&1; then
  echo ""
  echo "Found mkcert! Generating trusted certificate for ${LAN_IP}..."
  mkdir -p certs
  mkcert -install
  mkcert -cert-file certs/lan-cert.pem -key-file certs/lan-key.pem "${LAN_IP}" localhost 127.0.0.1
  echo "Certificates created in certs/"
else
  echo ""
  echo "mkcert not found. Caddy will use internal self-signed TLS (tls internal)."
  echo "Accept the browser security certificate prompt on connecting devices."
fi

# 4. Display instructions
echo ""
echo "============================================================================="
echo "LAN DEMO READY!"
echo "============================================================================="
echo "On this machine, run:"
echo "  make up          (or docker compose -f infra/docker-compose.prod.yml up --build)"
echo ""
echo "On second devices (phone, laptop on same Wi-Fi), open:"
echo "  https://${LAN_IP}"
echo ""
echo "WHY HTTPS IS MANDATORY:"
echo "Browsers strictly require a Secure Context (HTTPS or localhost) for"
echo "navigator.mediaDevices.getUserMedia. Opening via plain http://<LAN_IP>"
echo "disables camera and microphone publishing on other devices."
echo "============================================================================="
