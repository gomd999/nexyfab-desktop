# NexyFab OCCT worker — Railway deploy image.
#
# Wave 1 W9 D1-2 (ADR-007). Worker hosts OCCT WASM kernel (5 MB) plus
# express, runs as a separate Railway service from nexyfab.com main.

# --- Stage 1: build TypeScript ---
FROM node:22-alpine AS builder
WORKDIR /app

# Cache deps layer separately from sources.
COPY package.json package-lock.json* ./
RUN npm ci --omit=optional

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# --- Stage 2: runtime ---
FROM node:22-alpine AS runtime
WORKDIR /app

# Only what runtime needs: compiled JS + production deps.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --omit=optional && \
    npm cache clean --force

COPY --from=builder /app/dist ./dist

# Railway sets $PORT; default 8080 for local docker runs.
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# Healthcheck — matches /health endpoint. Railway also probes this URL
# by config; the HEALTHCHECK directive helps local docker.
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=60s \
  CMD wget -q --spider http://localhost:${PORT}/health || exit 1

# Single process — concurrency added via worker threads in W11
# (per ADR-007 § "Concurrency model"), not via multiple Node workers.
CMD ["node", "dist/server.js"]
