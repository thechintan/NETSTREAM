Task 28: Whole stack single-command run and LAN demo mode complete.
Built multi-stage apps/server/Dockerfile (FFmpeg, non-root netstream user) and infra/Caddyfile (reverse proxy + SPA fallback).
Created infra/docker-compose.prod.yml with healthchecks, named volumes, restart policies, and root Makefile.
Created scripts/lan-demo.sh and scripts/lan-demo.ps1 with auto LAN IP detection, HTTPS setup, and docs/DEPLOY.md.
Verified with docker-compose -f infra/docker-compose.prod.yml config and pnpm --filter @netstream/web build.
