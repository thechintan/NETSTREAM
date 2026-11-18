.PHONY: dev up down logs seed demo

# Start development mode (host Node processes + infra dependencies)
dev:
	pnpm dev

# Build and start the complete production container stack in background
up:
	pnpm --filter @netstream/web build
	docker compose -f infra/docker-compose.prod.yml up --build -d

# Stop all running containers and preserve volumes
down:
	docker compose -f infra/docker-compose.prod.yml down

# Stream container logs in real time
logs:
	docker compose -f infra/docker-compose.prod.yml logs -f

# Run database seed inside running server container
seed:
	docker compose -f infra/docker-compose.prod.yml exec server node dist/db/seed.js

# Configure LAN demo mode and run the stack
demo:
	bash scripts/lan-demo.sh
	pnpm --filter @netstream/web build
	docker compose -f infra/docker-compose.prod.yml up --build
