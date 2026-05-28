# Wave 1 architecture overview

Single navigation guide for the 28-PR stack landed across W1-W17.
Goal: a reviewer (user / external engineer / future-me) can read this
once and understand where to look for what. Companion to
[ADR-009 GA gate](./adr/009-wave-1-ga-gate.md) and
[wave-1-ga-checklist.md](./wave-1-ga-checklist.md).

## What Wave 1 ships

A working B-rep CAD modelling stack that runs OCCT (OpenCascade) ops
server-side on Railway, with browser/Tauri clients chaining ops via
R2 keys instead of marshalling geometry blobs over HTTP. 10 ops live:
boolean / fillet / chamfer / shell / mirror / pattern / extrude /
revolve / sweep / loft. Every op has a primitive entry point AND
accepts a previous op's STEP output as `sourceR2Key`, so a real CAD
pipeline like

    extrude → fillet → boolean(cut) → pattern

…composes end-to-end without going back through the client between
each step.

## Layered architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│ React UI (ShapeGeneratorInner.tsx)                                   │
│   _handleBooleanAsync / _handleFilletAsync / _handleChamferAsync /   │
│   _handleShellAsync — each calls buildServerOpts() then              │
│   applyXAsyncWithServer.                                              │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│ features/{boolean,fillet,chamfer,shell}.ts — apply layer             │
│   applyBooleanAsync (+ applyXAsyncWithServer)                         │
│     ├─ try server (serverBoolean → fetchR2Bytes → parseSTL)          │
│     │    • success → stash stepR2Key on geometry.userData             │
│     │    • 5xx/network → warn + fall through                          │
│     │    • 400 → throw (local would also fail)                        │
│     ├─ try worker_threads CSG (performCSG)                            │
│     └─ fall back to sync three-bvh-csg                                │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│ src/lib/occt-server-client.ts — HTTP wrapper                         │
│   10 wrappers + ChainableHost + serverDispatch                       │
│   Returns { stlR2Key, stepR2Key, meta, elapsedMs, requestId }        │
│   Auth: short-lived JWT from useWorkerToken                          │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│ /api/nexyfab/worker-token  — main app, mints 15-min JWT              │
│ /api/nexyfab/r2-fetch       — main app, signed-URL proxy             │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼ HTTPS (KR↔US East ~150ms)
┌─────────────────────────────────────────────────────────────────────┐
│ occt-worker on Railway                                                │
│                                                                       │
│   Express + Sentry + JWT middleware                                   │
│      │                                                                │
│      ▼                                                                │
│   OcctWorkerPool (worker_threads, N slots)                            │
│      • Per-slot OCCT WASM (memory isolation)                          │
│      • Bounded queue (env: OCCT_QUEUE_MAX)                            │
│      • Op timeout → recycle slot                                      │
│      • Crash → respawn                                                │
│      • Op-count threshold (env: OCCT_MAX_OPS_PER_SLOT) → rotate       │
│      • Per-slot mem snapshots pushed after each op                    │
│      │                                                                │
│      ▼                                                                │
│   Op handlers (occt/*.ts):                                            │
│      boolean / fillet / chamfer / shell                               │
│      extrude / revolve / sweep / loft                                 │
│      mirror / pattern                                                 │
│      │                                                                │
│      ├─ host: primitive box OR R2 STEP import                         │
│      ├─ tool (boolean only): primitive cyl/sphere OR R2 STEP          │
│      └─ profile (sketch ops): rectangle | circle | polygon | svgPath  │
│                                       (with Bezier + arc flattening)  │
│      │                                                                │
│      ▼                                                                │
│   replicad-opencascadejs (OCCT WASM)                                  │
│      │                                                                │
│      ▼                                                                │
│   serializeShape → STL + STEP + meta                                  │
│      │                                                                │
│      ▼                                                                │
│   r2Put → returns R2 keys to client                                   │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
                          Cloudflare R2 bucket
                          (shared with main app)
```

## PR → component map

| PR # | Branch | What it lands |
|---|---|---|
| #2  | wave-1/w1-step-route-a              | W3 + W6 Phase B-F shell migration + ADR-001..008 (18 commits) |
| #3  | wave-1/phase-g-prep                 | docs/MIGRATION.md + Phase G runbook |
| #4  | wave-1/w9-occt-worker-scaffold      | occt-worker scaffold + W10 D1-3 boolean op |
| #5  | wave-1/w10-client-server-occt-hook  | main-app serverBoolean wrapper + /api/nexyfab/r2-fetch |
| #6  | wave-1/w11-worker-thread-pool       | OcctWorkerPool (worker_threads, queue, timeout, crash) |
| #7  | wave-1/w11-fillet-chamfer-shell     | fillet/chamfer/shell ops |
| #8  | wave-1/w11-extrude-revolve          | extrude/revolve ops |
| #9  | wave-1/w12-slot-recycling           | op-count recycling + lifetime metrics |
| #10 | wave-1/w12-soak-mem-metrics         | mem snapshots + soak.ts harness |
| #11 | wave-1/w13-polygon-profile          | polygon profile vocabulary |
| #12 | wave-1/w13-svg-path-parser          | SVG d-attr parser (M/L/H/V/Z) |
| #13 | wave-1/w14-bezier-flattening        | C/Q/S/T flattening |
| #14 | wave-1/w14-arc-to-cubic             | A → cubic Bezier (W3C appendix B) |
| #15 | wave-1/w15-remaining-ops            | sweep/loft/pattern/mirror (PLACEHOLDER_OPS empty) |
| #16 | wave-1/w16-chained-r2-input         | sourceR2Key for 6 3D-host ops |
| #17 | wave-1/w16-main-wrapper-chain       | 5 new wrappers + ChainableHost |
| #18 | wave-1/w16-main-wrapper-sketch      | 4 sketch wrappers (extrude/revolve/sweep/loft) |
| #19 | wave-1/w16-boolean-server-hook      | applyBooleanAsync server fallback |
| #20 | wave-1/w17-boolean-ui-wire          | useWorkerToken + _handleBooleanAsync |
| #21 | wave-1/w17-fcs-async                | applyFillet/Chamfer/ShellAsyncWithServer |
| #22 | wave-1/w17-fcs-ui-wire              | _handleFillet/Chamfer/ShellAsync |
| #23 | wave-1/w17-ga-gate                  | ADR-009 + checklist + Sentry alerts doc |
| #24 | wave-1/w17-boolean-tool-r2          | worker toolSourceR2Key (shape-vs-shape) |
| #25 | wave-1/w17-wrapper-tool-r2          | wrapper toolSourceR2Key |
| #26 | wave-1/w17-toserverparams-tool-r2   | toServerParams reads userData.toolSourceR2Key |
| #27 | wave-1/w17-ci-stacked-pr            | CI runs on all PR bases (stacked PR fix) |
| #28 | wave-1/w17-sentry-instrument        | reportInfo forwards alertable patterns to Sentry |

## End-to-end data flow: a boolean cut

User clicks "subtract cylinder from this body" on a 100×100×100 mm box.

1. **React `_handleBooleanAsync`** called with `(geometry, params)`.
2. `buildServerOpts()` → `useWorkerToken().getToken()` returns cached
   JWT (refetches if < 60 s remaining).
3. `applyBooleanAsync(geometry, params, performCSG, serverOpts)`.
4. Inside: `toServerParams(geometry, params)`:
   - Reads `geometry.userData.toolSourceR2Key` → not set, use primitive.
   - Maps `toolShape:1, toolWidth:20` → `serverTool:0, r:10`.
   - Returns `ServerBooleanParams`.
5. `shouldUseServerBoolean(p)` → host volume 1e6 ≥ threshold → true.
6. `serverBoolean(p, { jwtToken, baseUrl })` → POSTs to
   `https://nexyfab-occt-worker.railway.app/occt/op/boolean`.
7. **Worker side:**
   a. Auth middleware verifies JWT (same `JWT_SECRET` as main app).
   b. Route validator runs `validateBooleanParams` → XOR host/tool,
      range checks, type enum.
   c. `getPool().execute('boolean', params, userId)` enqueues.
   d. Free slot picks it up → posts `{type:'op', ...}` to worker thread.
   e. Thread loads OCCT WASM if first op; calls `runBoolean(params, ctx)`:
      - `resolveShape` builds primitive box (no R2 here).
      - Builds cylinder tool, translates by `(cx, cy, cz)`.
      - `host.cut(tool)` returns OCCT shape.
      - `serializeShape` → STL bytes + STEP text + meta.
   f. `r2Put` writes both to R2 under `occt-ops/{userId}/boolean/{ts}-{rnd}.{stl,step}`.
   g. Worker posts `{type:'mem', heapUsedMb, ...}` after op.
   h. Pool: opsCompleted++; if ≥ maxOpsPerSlot → recycle (terminate +
      respawn).
   i. Response: `{ stlR2Key, stepR2Key, meta, elapsedMs, requestId }`.
8. **Back in client wrapper** (`serverBoolean`):
   - Maps 4xx/5xx to `ServerOcctUnavailableError`.
   - Reports `csg.server_boolean_ok` via `reportInfo` → also
     `captureMessage` to Sentry (W17, PR #28).
9. `applyBooleanAsync` calls `fetchR2Bytes(stlR2Key)`:
   a. GETs `/api/nexyfab/r2-fetch?key=...` (main app).
   b. Main app re-validates `key.startsWith('occt-ops/{userId}/')`.
   c. Returns short-lived signed R2 URL.
   d. Client fetches bytes directly from R2 (no main-app proxy).
10. `parseSTL(buffer)` → THREE.BufferGeometry.
11. `geometry.userData.serverStepR2Key = stepR2Key` — stashed so a
    chained fillet/boolean on this result can pass `sourceR2Key`.
12. UI receives geometry, re-renders viewport.

Total round trip target: < 500 ms p50 for 100×100×100 boolean.
~150 ms is round-trip latency; balance is worker WASM time.

## Test inventory

| Layer | Test file | Pass count |
|---|---|---|
| Worker pool / fixtures | `occt-worker/src/pool/workerPool.test.ts` | 13 |
| Worker op validators | `occt-worker/src/routes/occt.test.ts` | 60+ |
| Worker geometry helpers | `occt-worker/src/occt/_polygon.test.ts` + `_svg.test.ts` + `_arc.test.ts` | ~35 |
| Worker shape input | `occt-worker/src/occt/_input.test.ts` | 9 |
| Worker total | (all files) | **116** |
| Main wrapper | `src/lib/occt-server-client.test.ts` | 33 |
| Worker-token hook | `src/app/[lang]/shape-generator/hooks/useWorkerToken.test.ts` | 5 |
| Boolean server hook | `src/app/[lang]/shape-generator/features/booleanServerHook.test.ts` | 9 |
| Fillet/chamfer/shell server hooks | `src/app/[lang]/shape-generator/features/fcsServerHook.test.ts` | 6 |
| Telemetry alertable forwarding | `src/app/[lang]/shape-generator/lib/__tests__/telemetry.alertable.test.ts` | 9 |
| **Wave 1 total** | (all files) | **186** |

## Performance characteristics

| Op | Local (mesh-CSG) | Local (WASM OCCT) | Server (Railway) |
|---|---|---|---|
| boolean (100mm box - 10mm cyl) | ~80 ms | ~120 ms | ~250 ms (incl 150ms RTT) |
| boolean (1000+ assembly) | tab freeze | ~5 s | ~500 ms |
| fillet (single edge) | ~50 ms | ~80 ms | ~200 ms |
| extrude (svg, 100 verts) | n/a | ~200 ms | ~250 ms |

Numbers are estimates from local development; W12 soak harness
produces real numbers once Railway is provisioned.

## Where to look for what

| Question | Look here |
|---|---|
| "Why does this op return X?" | `occt-worker/src/occt/{op}.ts` |
| "What params does the worker accept?" | `occt-worker/src/routes/occt.ts` validators |
| "Why is the pool slow / restarting?" | `/health` → `pool.{recycles,busy,queueDepth}` |
| "Is the server path firing for this op?" | Sentry → `csg.server_X_path_ok` events |
| "What's in the pipeline between worker and viewport?" | `src/lib/occt-server-client.ts` |
| "Where do telemetry events go?" | `src/app/[lang]/shape-generator/lib/telemetry.ts` |
| "How do I add a new op?" | Worker side: `occt/_polygon.ts` pattern; route validator; pool protocol union. Wrapper side: `serverDispatch` is generic. Feature side: `applyXAsyncWithServer` if 3D-host. |
| "Why isn't CI running on my stacked PR?" | `docs/process/stacked-pr-ci.md` |
| "How do I ship Wave 1?" | `docs/wave-1-ga-checklist.md` |
| "When can we declare Wave 2?" | `docs/adr/009-wave-1-ga-gate.md` §Rollout |

## What Wave 1 does NOT cover

- **UI surface for shape-vs-shape tool picker.** The plumbing is
  ready (PR #24 worker, #25 wrapper, #26 toServerParams reads
  `userData.toolSourceR2Key`), but nothing sets `toolSourceR2Key` in
  the UI yet. Adding a "use imported body as tool" picker is W18+.
- **Sketch chain (R2 SVG/DXF as profile input).** Today extrude /
  revolve / sweep / loft take inline profiles (rectangle / circle /
  polygon / svgPath). Loading a stored sketch from R2 → profile is a
  W18 feature.
- **Multi-subpath SVG profiles.** The parser still rejects compound
  paths (`M ... Z M ... Z`); needs true face-boundary modelling.
- **Live HTTP soak.** `npm run soak` drives an in-process pool. A
  `--remote` mode that exercises the deployed worker over HTTP is
  W18 follow-up.
- **Paid kernel option.** ADR-009 §Rollout reserves the right to
  escalate to a paid kernel (Parasolid etc.) if the external compat
  matrix fails badly — that's ADR-010 territory, not in scope here.
