# ══════════════════════════════════════════════════════════════
# WhatsApp Fatawa Bot — Multi-Stage Dockerfile
# ══════════════════════════════════════════════════════════════

# ── Stage 1: Builder ──────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package files first for layer caching
COPY package.json package-lock.json* ./
RUN npm ci

# Copy TypeScript source and compile
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ── Stage 2: Production ───────────────────────────────────────
FROM node:20-slim AS production

WORKDIR /app

# Install ffmpeg for audio conversion (permanent layer)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install only production dependencies
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# ── Persistent Volume Mounts ─────────────────────────────────
# auth_info_baileys/ — WhatsApp session tokens (MUST persist across restarts)
# tmp/              — Temporary audio conversion workspace
VOLUME ["/app/auth_info_baileys", "/app/tmp"]

# Create directories in image (bind-mount will override in compose)
RUN mkdir -p /app/auth_info_baileys /app/tmp

# Non-root user for security
RUN groupadd --gid 1001 botuser && \
    useradd --uid 1001 --gid botuser --shell /bin/bash --create-home botuser && \
    chown -R botuser:botuser /app

USER botuser

# Health check — verify the process is alive
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD node -e "process.exit(0)"

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
