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
ARG CACHEBUST=20260802-202
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
# ★260802 — 빌드 태그를 **런타임까지** 전달한다. `railway up` 이 exit 0 · 빌드 성공인데도
# 반영되지 않는 일이 하루에 네 번 있었고, 그때마다 기능별 관측점을 찾아 확인해야 했다.
# 헬스 응답에 이 값이 실리면 **1회 호출로** 어느 빌드가 도는지 확정된다.
# ⚠ 260802 — 여기 기본값을 `unknown` 으로 두었더니 **그 값이 그대로 나갔다**
#   (실측: 라이브 `build:"unknown"`). 각 스테이지의 `ARG` 는 **독립**이라 빌드 스테이지 값을
#   물려받지 않고, Railway 가 인자를 주입하지 않으면 기본값이 쓰인다.
#   → 빌드 스테이지와 **같은 기본값**을 둔다. 인자가 오면 그것이 이긴다.
#   ⚠ 두 곳을 함께 올려야 한다 — 갈리면 표시가 실제와 달라진다.
ARG CACHEBUST=20260802-202
ENV NEXYFAB_BUILD_TAG=${CACHEBUST}
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# OpenSCAD CLI + BOSL2 library for the deterministic intent→SCAD pipeline
# (intentToScad emits BOSL2 calls for gear/threadedRod/roundedBox/screw).
# `git` is needed for the BOSL2 clone step only; pruned in the same RUN to
# keep the image lean.
# gmsh (FEA precise-path tet mesher) links OpenGL/GLU + OpenCASCADE even for
# batch `-3` runs; with --no-install-recommends the GL/GLU runtime libs are
# NOT pulled automatically, so gmsh can fail to LOAD (loader error) at runtime
# and the FEA path silently falls back to octree. Install them explicitly and
# then run `gmsh --version` so a broken/unloadable binary FAILS THE BUILD here
# instead of degrading silently in production. `command -v gmsh` also confirms
# the binary is on PATH at /usr/bin/gmsh (must match ENV GMSH_BIN below).
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      openscad gmsh git ca-certificates fonts-dejavu-core \
      libglu1-mesa libgl1 libgomp1 \
 && git clone --depth 1 https://github.com/BelfrySCAD/BOSL2.git /opt/openscad-libs/BOSL2 \
 && apt-get purge -y --auto-remove git \
 && rm -rf /var/lib/apt/lists/* \
 && command -v gmsh \
 && gmsh --version
ENV OPENSCAD_BIN=/usr/bin/openscad
ENV OPENSCADPATH=/opt/openscad-libs
# gmsh: out-of-process boundary-conforming tet mesher for the FEA precise path
# (server-only, execFile shell-out like the openscad CLI; GPL-as-subprocess).
ENV GMSH_BIN=/usr/bin/gmsh

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
# ★260802 — `three` 누락으로 GA_3D.html 이 **라이브에서만** 실패하고 있었다.
#   실측 사유: `Cannot find module 'three'` (/app/scripts/drawing-to-3d/html-render.mjs).
#   `html-render.mjs` 가 three.js 를 **data: URL 로 인라인**해 뷰어를 오프라인 자립시키는데
#   (현장 인터넷 없음), 그 참조가 `createRequire` 동적 해석이라 tracer 가 못 본다.
#   ⚠ 로컬에서는 전체 node_modules 가 있어 **재현되지 않았다** — 사유를 남기게 하고서야 잡혔다.
COPY --from=builder /app/node_modules/three ./node_modules/three
# ⚠ 260802 전수 확인 — `scripts/drawing-to-3d` 가 동적으로 부르는 외부 패키지는 6종이고
#   그중 런타임에 필요한 것만 복사한다:
#     · `iconv-lite` — **DXF cp949 인코딩**(패키지 산출물이라 런타임 필요)
#     · `playwright`(시각 회귀)·`sharp`(시험 도면 생성)는 **개발 도구** — 넣지 않는다.
#   ⚠ 「빠진 걸 다 넣자」가 아니다. 안 쓰는 것을 넣으면 이미지만 커지고, 그 판단 근거가
#     남지 않으면 다음 사람이 또 훑어야 한다.
COPY --from=builder /app/node_modules/iconv-lite ./node_modules/iconv-lite
# DWG 임포트(LibreDWG WASM) — webpackIgnore 동적 import 라 tracer 가 못 본다
COPY --from=builder /app/node_modules/@mlightcad ./node_modules/@mlightcad
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
