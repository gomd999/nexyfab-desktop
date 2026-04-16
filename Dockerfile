# ---- Build stage ----
FROM node:22-slim AS builder
WORKDIR /app

# Native module build tools (better-sqlite3 needs python3 + build-essential)
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm install --legacy-peer-deps

# Copy source
COPY . .

# Build (4GB heap for large Next.js projects)
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS=--max-old-space-size=4096
RUN npm run build

# ---- Runner stage ----
FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Copy only what's needed
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
# Ensure native better-sqlite3 addon is present (Next.js standalone may omit it)
COPY --from=builder /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=builder /app/node_modules/bindings ./node_modules/bindings
COPY --from=builder /app/node_modules/file-uri-to-path ./node_modules/file-uri-to-path

# Data directory for SQLite (Railway volume mount 이후에도 writable하도록 root로 실행)
RUN mkdir -p /app/data /app/adminlink

ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
