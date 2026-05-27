# nexyfab-occt-worker

Server-side OCCT worker for heavy B-rep operations.

**Wave 1 W9-12 scope** ([ADR-007](../docs/adr/007-server-side-occt-worker.md)).
Runs as a separate Railway service from the main `nexyfab.com` app —
isolates memory pressure of the OCCT WASM kernel (5 MB load + per-op
heap growth) from the customer-facing web dyno.

## Status

- **W9 D1-2** (this scaffold): Express server skeleton + /health + Sentry
  + JWT auth middleware + Dockerfile + Railway config. **0% actual
  OCCT operations implemented.**
- **W9 D3-5**: OCCT WASM load on boot, /health reports `starting` →
  `ready`.
- **W10 D1-3**: First operation `POST /occt/op/boolean` end-to-end (R2
  payload + STEP+STL output).
- **W10 D4-5**: Client-side hook in main app's `boolean.ts` for inputs
  > 100 KB.
- **W11**: Worker thread pool + fillet / chamfer / shell ops.
- **W12**: Memory recycling + 4 h soak test + Sentry alerts.

Each scope ships as one or more commits on a Wave 1 branch.

## Deploy (Railway)

```bash
# From repo root:
cd occt-worker
railway link  # then choose nexyfab-occt-worker service (create first via dashboard)
railway up --detach
```

Required env vars (set on the Railway service):

| Var | Why |
|---|---|
| `JWT_SECRET` | Same as main app — validates Bearer tokens from main app's clients |
| `R2_ACCOUNT_ID` | Cloudflare R2 — for geometry payload mediation |
| `R2_ACCESS_KEY_ID` | (see `project_r2_architecture` memory) |
| `R2_SECRET_ACCESS_KEY` | |
| `R2_BUCKET` | Shared bucket with main app |
| `SENTRY_DSN` | Same project, will be tagged `service=occt-worker` |
| `SENTRY_TRACES_SAMPLE_RATE` | Optional; defaults 0.05 |
| `PORT` | Railway sets automatically |

## Run locally

```bash
npm install
npm run dev        # tsx watch
# in another tab:
curl http://localhost:8080/health
```

Locally `/occt/*` routes require a valid JWT. Easiest: generate one
against the main app's JWT_SECRET (the main app's auth helpers can do
it via `signTestToken`). Otherwise the route returns 401.

## Architecture (capsule)

```
client → main app (Next.js, Railway) ───────┐
                                            │ POST /occt/op/boolean
                                            │ body: { inputR2Keys, params }
                                            ▼
                                      occt-worker (this service)
                                            │
                              R2 ◀──────────┤ (reads input, writes output blobs)
                              R2 ──────────▶│
                                            │
                                            ▼
                                      response { outputR2Key, stepR2Key, ... }
```

See ADR-007 for the full reasoning, including:

- Why a separate service (memory isolation, independent scaling)
- Three-tier client fallback chain (server → client OCCT → mesh-CSG)
- R2 payload mediation (avoid HTTP body size limits)
- Concurrency model (worker threads, not multi-process)
- Memory recycling on RSS threshold

## Files

```
src/
  server.ts              — express boot, /health, /occt mount, graceful shutdown
  sentry.ts              — Sentry init + PII scrub (same patterns as main app)
  middleware/
    requestId.ts         — x-request-id correlation per request
    auth.ts              — HS256 JWT verify, same JWT_SECRET as main app
  routes/
    health.ts            — GET /health (Railway probe)
    occt.ts              — POST /occt/op/* (placeholder 501 until W10)
  occt/
    lifecycle.ts         — lazy OCCT WASM load, status reporting
Dockerfile               — 2-stage build, node:22-alpine
railway.json             — Railway deploy config
tsconfig.json            — strict TS, Node16 module resolution
package.json             — express + occt-import-js + replicad + sentry
```

## Why not in the main repo's Next.js process

The main `nexyfab.com` Node process serves Next.js + sqlite + auth +
payment. Adding OCCT (5 MB WASM, long-running compute) to it risks
OOM on the shared dyno and slows every other request when a boolean
is running. Separate service means independent scaling, independent
restart on memory leak, isolated billing, separate CI/CD cycles.

## Not yet wired (client side)

The main app's `boolean.ts` etc. still run OCCT entirely client-side.
Client-side server-OCCT routing arrives in W10 D4-5 via the existing
per-feature try/catch fallback ladder:

1. Server OCCT (this service) — best for large inputs.
2. Client OCCT (in-tab WASM, Wave 0 fallback).
3. Mesh-CSG (legacy, always available).
