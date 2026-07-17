# ---- Build stage ----
FROM node:22-slim AS builder
WORKDIR /app

# Native module build tools (better-sqlite3 needs python3 + build-essential)
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Install dependencies.
# `npm install` (not `npm ci`): the lock drifts on platform-specific optional
# wasm deps (@emnapi/*, generated on a Windows dev box), which makes the strict
# `npm ci` fail on Linux. `npm install` reconciles the lock at build time and
# still installs the full tree (webpack, replicad-opencascadejs, etc.).
COPY package.json package-lock.json* ./
RUN npm install --legacy-peer-deps --no-audit --no-fund

# Copy source.
# Cache-bust: buildkit occasionally reuses a stale `COPY . .` layer on Railway
# (2026-07-12: shipped old scripts/drawing-to-3d despite changed files). Bump this
# value to force the copy + build to re-run from fresh source.
ARG CACHEBUST=20260717-82
RUN echo "cachebust ${CACHEBUST}"
COPY . .

# NEXT_PUBLIC_* are inlined into the client bundle at `next build` time.
# Railway exposes service variables as Docker build args, but ONLY for ARGs
# declared here — without these, the client bundle bakes `undefined` (the
# reCAPTCHA outage of 2026-06: api.js?render=undefined → all lead forms 403).
ARG NEXT_PUBLIC_RECAPTCHA_SITE_KEY
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_NEXYFLOW_URL
ARG NEXT_PUBLIC_NEXYWISE_URL
ARG NEXT_PUBLIC_TOSS_CLIENT_KEY
ARG NEXT_PUBLIC_POSTHOG_KEY
ARG NEXT_PUBLIC_POSTHOG_HOST
ARG NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_PAID_BETA
ARG NEXT_PUBLIC_OCCT_COLLAB_WS_URL
ENV NEXT_PUBLIC_RECAPTCHA_SITE_KEY=$NEXT_PUBLIC_RECAPTCHA_SITE_KEY \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_NEXYFLOW_URL=$NEXT_PUBLIC_NEXYFLOW_URL \
    NEXT_PUBLIC_NEXYWISE_URL=$NEXT_PUBLIC_NEXYWISE_URL \
    NEXT_PUBLIC_TOSS_CLIENT_KEY=$NEXT_PUBLIC_TOSS_CLIENT_KEY \
    NEXT_PUBLIC_POSTHOG_KEY=$NEXT_PUBLIC_POSTHOG_KEY \
    NEXT_PUBLIC_POSTHOG_HOST=$NEXT_PUBLIC_POSTHOG_HOST \
    NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN \
    NEXT_PUBLIC_PAID_BETA=$NEXT_PUBLIC_PAID_BETA \
    NEXT_PUBLIC_OCCT_COLLAB_WS_URL=$NEXT_PUBLIC_OCCT_COLLAB_WS_URL

# Build (8GB heap — the project outgrew 4GB; webpack OOMs mid-compile at 4096).
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS=--max-old-space-size=8192
RUN npm run build

# ---- Runner stage ----
FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# OpenSCAD CLI + BOSL2 library for the deterministic intent→SCAD pipeline
# (intentToScad emits BOSL2 calls for gear/threadedRod/roundedBox/screw).
# `git` is needed for the BOSL2 clone step only; pruned in the same RUN to
# keep the image lean.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openscad git ca-certificates fonts-dejavu-core \
 && git clone --depth 1 https://github.com/BelfrySCAD/BOSL2.git /opt/openscad-libs/BOSL2 \
 && apt-get purge -y --auto-remove git \
 && rm -rf /var/lib/apt/lists/*
ENV OPENSCAD_BIN=/usr/bin/openscad
ENV OPENSCADPATH=/opt/openscad-libs

# Copy only what's needed
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
# Ensure native better-sqlite3 addon is present (Next.js standalone may omit it)
COPY --from=builder /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=builder /app/node_modules/bindings ./node_modules/bindings
COPY --from=builder /app/node_modules/file-uri-to-path ./node_modules/file-uri-to-path
# drawing-to-3d / engineering-core pipelines are loaded at runtime via
# webpackIgnore dynamic import (process.cwd()/scripts/...), so Next's standalone
# tracer can't see them — copy explicitly. NOT scripts/knowledge-crawler (323MB data).
COPY --from=builder /app/scripts/drawing-to-3d ./scripts/drawing-to-3d
COPY --from=builder /app/scripts/engineering-core ./scripts/engineering-core
# export_step(to-step.mjs) uses replicad/OCCT via DYNAMIC import (occtEngine also
# dynamic-imports it), so the tracer omits the whole subtree — copy the closure
# (computed from package.json deps: replicad→flatbush/flatqueue/opentype.js/…).
# The OCCT wasm itself is served from public/replicad_single.wasm (to-step wasmPath).
COPY --from=builder /app/node_modules/replicad ./node_modules/replicad
COPY --from=builder /app/node_modules/replicad-opencascadejs ./node_modules/replicad-opencascadejs
COPY --from=builder /app/node_modules/flatbush ./node_modules/flatbush
COPY --from=builder /app/node_modules/flatqueue ./node_modules/flatqueue
COPY --from=builder /app/node_modules/opentype.js ./node_modules/opentype.js
COPY --from=builder /app/node_modules/string.prototype.codepointat ./node_modules/string.prototype.codepointat
COPY --from=builder /app/node_modules/tiny-inflate ./node_modules/tiny-inflate

# Data directory for SQLite (Railway volume mount 이후에도 writable하도록 root로 실행)
RUN mkdir -p /app/data /app/adminlink

ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
