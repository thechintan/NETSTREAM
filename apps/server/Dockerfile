# syntax=docker/dockerfile:1

# -----------------------------------------------------------------------------
# Stage 1: Build stage
# -----------------------------------------------------------------------------
FROM node:20-bookworm-slim AS builder

WORKDIR /build

# Install build dependencies for native compilation (mediasoup worker)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    gcc \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install pnpm
RUN corepack enable && corepack prepare pnpm@11.5.3 --activate

# Copy monorepo manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/server/package.json ./apps/server/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source trees
COPY packages/shared/ ./packages/shared/
COPY apps/server/ ./apps/server/

# Build server TypeScript
RUN pnpm --filter @netstream/server build

# -----------------------------------------------------------------------------
# Stage 2: Runtime stage
# -----------------------------------------------------------------------------
FROM node:20-bookworm-slim AS runner

WORKDIR /app

# Install runtime dependencies: FFmpeg and ca-certificates
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Create dedicated non-root user
RUN groupadd -g 10001 netstream && \
    useradd -u 10001 -g netstream -s /bin/sh -m netstream

# Create directories for media storage and give ownership to netstream user
RUN mkdir -p /app/media/hls /app/media/vod && \
    chown -R netstream:netstream /app

# Copy dependencies and build artifacts
COPY --from=builder --chown=netstream:netstream /build/node_modules ./node_modules
COPY --from=builder --chown=netstream:netstream /build/packages/shared ./packages/shared
COPY --from=builder --chown=netstream:netstream /build/apps/server/node_modules ./apps/server/node_modules
COPY --from=builder --chown=netstream:netstream /build/apps/server/package.json ./package.json
COPY --from=builder --chown=netstream:netstream /build/apps/server/dist ./dist
COPY --from=builder --chown=netstream:netstream /build/apps/server/src/db/migrations ./dist/db/migrations
COPY --chown=netstream:netstream apps/server/entrypoint.sh ./entrypoint.sh

RUN chmod +x ./entrypoint.sh

# Switch to non-root user
USER netstream

ENV NODE_ENV=production
ENV PORT=3000
ENV HLS_DIR=/app/media/hls
ENV VOD_DIR=/app/media/vod

EXPOSE 3000
EXPOSE 40000-40100/udp
EXPOSE 40000-40100/tcp

HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=5 \
  CMD node -e "fetch('http://localhost:' + (process.env.PORT || 3000) + '/api/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

ENTRYPOINT ["./entrypoint.sh"]
