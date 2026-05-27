# 007 — Server-side OCCT worker on Railway for heavy B-rep operations

**Status:** proposed
**Date:** 2026-05-27
**Author:** gomd999
**Risk tier:** P0 (new prod service; failure mode for client CAD ops)

## Context

Wave 1 W9-12 (ADR-001) commits 4 weeks to "Server-side OCCT worker
(Railway)" with DoD "1000+ 트라이앵글 boolean < 2초". Today every OCCT
operation (boolean, fillet, chamfer, shell, pattern, mirror, sketch
extrude, revolve, sweep, loft, helix) runs **client-side**:

- Replicad's WASM kernel loaded into the user's tab on demand
  (auto-init now per ADR-003, ~5 MB download).
- All geometry stays in the browser's memory; for 1000-part assemblies
  this is `O(N²)` for naive boolean chains and the page slows / OOMs.
- The OCCT WASM is **single-threaded inside the tab** — heavy ops block
  the main thread; the user sees the UI freeze.
- Telemetry from the field (Wave 0 Sentry rule #1) will reveal the
  actual frequency of fallback, but anecdotally large assemblies push
  users to abandon and re-open with simpler geometry.

The Wave 1 thesis is that **lifting heavy OCCT ops to a server** unlocks
the assemblies professional engineers actually work on. The DoD
(1000-tri boolean < 2 s) is the proof point for one Wave 1 W17
free-play scenario.

## Decision

W9-12 ships a **Railway worker service** dedicated to OCCT operations,
with the following architecture:

### Service shape

- New Railway service `nexyfab-occt-worker`, separate from the main
  `nexyfab.com` web service. Sized for OCCT (initial: 2 GB RAM, 1
  vCPU; scale up empirically per cost-tracking).
- Single endpoint pattern:
  `POST /occt/op/{operation}` where operation ∈ {`boolean`, `fillet`,
  `chamfer`, `shell`, `extrude`, `revolve`, `sweep`, `loft`, `pattern`,
  `mirror`}.
- Request body: `{ inputHandles: string[], params: object }` plus
  geometry payload **referenced via R2** (not inlined) — see § Payload.
- Response: `{ outputHandle: string, stepUrl: string, stlUrl: string,
  meta: { volume, surface, manifold, bbox } }` — handle is a stable
  id the client can ask back for in subsequent ops; STEP / STL URLs
  point at R2 for the visual / downstream consumer.
- Sync semantics for ops < 10 s; for > 10 s the client polls a job
  status endpoint. Decision boundary set empirically in W11.

### Why a separate Railway service (not a sub-route of the main app)

- Main app's Node process serves Next.js + sqlite + auth + payment.
  Adding OCCT (5 MB WASM, long-running compute) to it risks OOM on
  the shared web dyno and slows every other request when a boolean
  is running.
- Separate service means: independent scaling, independent restart on
  memory leak, isolated billing, independent CI/CD if needed.

### Payload — R2-mediated for large geometry

- A 1000-tri boolean has input STL on the order of 100 KB-1 MB.
  Inlining in the HTTP request hits Railway's body-size limits and
  pollutes the request log.
- Pattern: client uploads geometry to R2 (existing
  `project_r2_architecture` memory), passes the R2 key in the op
  request, server reads from R2, writes output back to R2, returns
  R2 keys to client.
- Re-use the existing 4-env-var R2 setup (`R2_ACCOUNT_ID`,
  `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`); the
  worker service gets the same values.

### Failure mode + client fallback chain

Already established by Wave 0:

1. Server OCCT op succeeds → use server result.
2. Server unavailable / timeout (10 s) → fall back to **client OCCT**
   (same kernel, in-tab). Telemetry event `server_occt_fallback_to_client`.
3. Client OCCT fails → fall back to **mesh-CSG**. Existing per-feature
   try/catch handles this (already in production code).
4. Mesh-CSG fails → surface error to user, log to Sentry.

The new step is #1 + #2. The rest is pre-existing.

### Concurrency model

- OCCT WASM is single-threaded per JS context. Worker process keeps a
  pool of N JS contexts (Node Worker threads), each with its own WASM
  instance. N = vCPU count.
- Job queue (BullMQ or simple in-memory) routes incoming ops to free
  worker thread. Queue depth + p95 wait time logged to Sentry.

### Memory management

- WASM allocator leaks across ops are the highest-risk failure mode.
  Mitigation:
  - Each op resets the OCCT shape registry on completion
    (existing `resetShapeRegistry()` pattern in `occtEngine.ts`).
  - Worker process recycled after every N ops or after RSS exceeds
    1.5 GB (whichever comes first). Pool restart cycles new threads
    in.
- Sentry rule for the worker's RSS — alert if a single process
  exceeds 1.8 GB for > 5 min.

## Consequences

### Positive

- Heavy ops (1000+ part assemblies, complex booleans, deep fillet
  chains) become tractable. The Wave 1 DoD becomes provable.
- Client tab no longer freezes during boolean; the UI stays
  responsive while the server works.
- Geometry telemetry becomes server-side, which means we can build
  aggregate signals across users (e.g. "X % of customer parts have
  non-manifold input — invest in healing").
- Future Wave 2-3 work (B-rep Phase 3 advanced ops, large-assembly
  perf) has the server foundation in place.

### Negative

- **New production service** — Railway monthly cost (initial estimate
  $5-20). Goes up if customers hit it often.
- **Memory leak risk** is real and the project has no Node experience
  running long-lived OCCT WASM. W9-12 must include a soak test
  (continuous ops for 4 hours, RSS < 1.5 GB throughout).
- **Latency floor** — round trip to Railway US-East from KR is
  ~150 ms. Adds to operation cost; only worth it for ops where
  client-side > 1 s.
- **R2 round-trips add ~100-300 ms** for large geometries. The
  client → R2 → server → R2 → client path is 4 R2 ops.
- **Failure mode complexity** — three-tier fallback chain (server →
  client OCCT → mesh-CSG) is more state to debug when something
  breaks.

### Neutral

- The OCCT WASM kernel is the same code as client today; no new
  feature implementation. The work is operational: hosting, queue,
  R2, failure handling.

## Alternatives considered

- **Cloudflare Workers + WASM** — rejected. Cloudflare's Worker CPU
  limit (30 s on paid plan, 10 s free) makes any non-trivial OCCT op
  fragile. Memory limits are also tight.
- **Web Worker (browser-side off-main-thread)** — partial alternative,
  not a substitute. Web Worker keeps geometry in tab memory (still
  OOMs on big assemblies) but unblocks the UI. **Recommended as a
  complement**: do Web Worker in Wave 2 alongside the server worker,
  so small ops stay client-side off-main-thread, large ops go to
  server.
- **Defer to Wave 2** — rejected because the Wave 1 DoD (1000-tri
  boolean < 2 s) is unreachable without it; deferring would make the
  W17 external engineer free-play either skip large-assembly work
  (loss of validation) or fail visibly.
- **Build on existing Railway main service** (route, not service) —
  rejected per the § "Why a separate Railway service" section above.

## Rollout

### W9 (week 9) — Foundation

- [ ] **W9 D1-2** — Provision `nexyfab-occt-worker` Railway service.
  Decide region (closest to user base — KR users → US-East has 150 ms
  RTT; AP-NE2 is closer if available).
- [ ] **W9 D3-4** — Service skeleton: Express/Fastify + one health
  endpoint + Sentry wiring + R2 SDK.
- [ ] **W9 D5** — OCCT WASM load on boot, single in-process
  instance. Smoke test: hit `/health` returns 200 + reports OCCT
  ready.

### W10 — First operation end-to-end

- [ ] **W10 D1-3** — Implement `POST /occt/op/boolean`. R2 upload
  from client → server fetches → runs `occtBoxBooleanWithPrimitive`
  → writes STEP+STL to R2 → returns handles. Latency budget: < 2 s
  for 1k tris.
- [ ] **W10 D4-5** — Client-side: hijack `boolean.ts` for inputs
  > 100 KB, route through server. Fallback chain (server fail →
  client OCCT → mesh-CSG) validated end-to-end.

### W11 — Add more ops + concurrency

- [ ] **W11 D1-2** — Worker thread pool (N = vCPU). Switch from
  in-process to thread-per-op.
- [ ] **W11 D3-5** — Port fillet, chamfer, shell to the server. Each
  follows the boolean pattern.

### W12 — Hardening + soak test

- [ ] **W12 D1-2** — Memory recycling: after-op WASM reset + RSS
  threshold (1.5 GB) restart hook.
- [ ] **W12 D3-4** — 4-hour soak test: synthetic 1k-op stream of
  mixed booleans / fillets / chamfers. RSS < 1.5 GB throughout.
  Failure → diagnose leak, fix, re-run.
- [ ] **W12 D5** — Sentry alerts wired: RSS > 1.8 GB / 5 min, op
  p95 > 5 s, fallback rate > 10 %.

### W13+ usage in Wave 1 remainder

- W13-14 healing already merged (ADR-004); pairs naturally with
  server OCCT for big imports.
- W16 BREP_QA re-run will exercise the server path.
- W17 external engineer free-play sees the server in operation;
  sign-off includes "did it feel slow?" qualitative.

## Reversal

`git revert` of all server-related commits leaves the client OCCT
behavior unchanged (client fallback already in place per ADR-003 +
existing per-feature catches). Worker service can be paused on
Railway without code revert if cost becomes prohibitive — clients
fall back to client OCCT automatically via the failure-mode chain.

The hardest-to-reverse aspect is the **R2 upload pattern**. Once
clients start uploading geometry blobs, removing the pattern means
clients must keep all geometry in-tab again. Mitigation: cap the
geometry-blob retention to 24 h in R2 lifecycle policy (no permanent
storage of intermediate ops).

## Open questions (resolve before W9 Day 1)

- [ ] **Railway region** — does Railway offer AP-NE2 or close to KR?
  If only US-East, the RTT cost is fixed at ~150 ms. Decide if a
  separate KR-hosted worker is needed long-term.
- [ ] **R2 region** — is the existing bucket close to the Railway
  worker? If not, the worker → R2 hops add cross-region latency.
- [ ] **Cost ceiling** — set a $50/month alert on the worker service
  early so we catch runaway usage.
- [ ] **Auth on the worker** — same JWT as main app, or separate
  service-to-service token? Default: same JWT, validated by middleware
  copied from main app. Worker-only tokens add scope but complicate
  ops.

## References

- Code: `src/app/[lang]/shape-generator/features/occtEngine.ts`
  (OCCT kernel wrapper — the same code runs on server)
- Code: `src/app/[lang]/shape-generator/features/boolean.ts`
  (first op to migrate; existing fallback chain)
- Memory: `project_r2_architecture` — R2 access pattern
- Memory: `feedback_railway_deploy` — Railway deploy procedure
- Linked ADRs: `001-marketplace-freeze-cad-focus.md`,
  `003-occt-default-on.md`, `006-monolith-split-via-shell-v3-migration.md`
