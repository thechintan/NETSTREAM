#!/bin/sh
set -e

echo "[netstream-server] Running database migrations..."
node dist/db/migrate.js || {
  echo "[netstream-server] Database migrations completed or already up to date."
}

if [ "$1" = "seed" ]; then
  echo "[netstream-server] Seeding database..."
  node dist/db/seed.js || true
  exit 0
fi

echo "[netstream-server] Starting NetStream Live server..."
exec node dist/index.js "$@"
