# =============================================================================
# NetStream Live - LAN Demo Setup Script (PowerShell for Windows)
# =============================================================================

Write-Host "=== NetStream Live: LAN Demo Setup ===" -ForegroundColor Cyan

# 1. Detect active IPv4 LAN IP
$lanIp = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { 
    $_.InterfaceAlias -notmatch 'vEthernet|Loopback|Docker|WSL' -and 
    $_.IPAddress -notmatch '^127\.|^169\.254\.' 
} | Select-Object -First 1).IPAddress

if (-not $lanIp) {
    $lanIp = Read-Host "Could not auto-detect LAN IP. Please enter LAN IP (e.g. 192.168.1.50)"
}

Write-Host "Detected LAN IP: $lanIp" -ForegroundColor Green

# 2. Update .env file
$envPath = Join-Path $PSScriptRoot "..\.env"
if (-not (Test-Path $envPath)) {
    $examplePath = Join-Path $PSScriptRoot "..\.env.example"
    if (Test-Path $examplePath) {
        Copy-Item $examplePath $envPath
    } else {
        New-Item -ItemType File -Path $envPath | Out-Null
    }
}

$lines = Get-Content $envPath
$updates = @{
    "PUBLIC_IP"    = $lanIp
    "TURN_HOST"    = $lanIp
    "WEB_ORIGIN"   = "https://$lanIp"
    "SITE_ADDRESS" = $lanIp
    "TLS_MODE"     = "internal"
}

foreach ($key in $updates.Keys) {
    $found = $false
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match "^$key=") {
            $lines[$i] = "$key=$($updates[$key])"
            $found = $true
            break
        }
    }
    if (-not $found) {
        $lines += "$key=$($updates[$key])"
    }
}

Set-Content -Path $envPath -Value $lines
Write-Host "Updated .env with LAN IP configuration." -ForegroundColor Green

# 3. mkcert check
$mkcert = Get-Command mkcert -ErrorAction SilentlyContinue
if ($mkcert) {
    Write-Host "Found mkcert! Generating trusted certificate..." -ForegroundColor Yellow
    $certsDir = Join-Path $PSScriptRoot "..\certs"
    New-Item -ItemType Directory -Force -Path $certsDir | Out-Null
    mkcert -install
    mkcert -cert-file (Join-Path $certsDir "lan-cert.pem") -key-file (Join-Path $certsDir "lan-key.pem") $lanIp localhost 127.0.0.1
} else {
    Write-Host "mkcert not found. Caddy will use internal self-signed TLS (tls internal)." -ForegroundColor Gray
}

# 4. Display instructions
Write-Host @"

=============================================================================
LAN DEMO READY!
=============================================================================
On this machine, start the stack:
  docker compose -f infra/docker-compose.prod.yml up --build

On other devices (phone or laptop connected to the same Wi-Fi), open:
  https://$lanIp

WHY HTTPS IS MANDATORY:
Browsers strictly enforce Secure Context requirements for
navigator.mediaDevices.getUserMedia. Plain http:// disables camera/microphone
access on any remote network device.
=============================================================================
"@ -ForegroundColor Cyan
