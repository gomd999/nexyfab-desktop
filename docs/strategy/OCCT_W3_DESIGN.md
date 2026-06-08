# OCCT Migration — W3 Design: route `occtEngine` to the K-series

> Status: design (headless) · 2026-06-08 · Parent: [OCCT_WORKER_MIGRATION_PLAN](./OCCT_WORKER_MIGRATION_PLAN.md) W3
> Goal: make the **K-series** (real `opencascade.js`, persistent naming + the
> ceiling ops) the kernel that `occtEngine` ops actually run on — behind a flag,
> with a replicad-vs-K-series parity gate, default unchanged.

W1 (browser boot) and W2 (ceiling ops across the wire) are done. W3 is the
**async refactor**: the blast radius + the browser-perf risk live here, so this
doc nails the architecture, the first consumer, and the parity gate BEFORE any
code lands.

---

## 1. Current topology (grounded)

Three facts decide the design:

1. **`occtEngine` ops are SYNCHRONOUS** (`features/occtEngine.ts`): `occtExtrudeProfile`,
   `occtBooleanSolids`, … return `{ geometry: BufferGeometry, handle: string | null }`
   synchronously. Handles are **string keys** into an in-process
   `shapeRegistry: Map<string, replicadShape>`; the feature pipeline threads the
   string on `geometry.userData.occtHandle` and looks inputs up via `getShape()`.
   **The handle model is already string-id'd — identical in shape to `OcctShape.id`.**
2. **The kernel of record is replicad, IN-PROCESS** (`engineSelection.ts`): the
   mesh path (three-bvh-csg) is the fast/fallback. `shouldUseOcctEngine` gates
   it (drag → mesh).
3. **The production OCCT eval runs in the PIPELINE WORKER**, not the main thread:
   `workers/pipelineWorker.ts` → `applyFeaturePipelineDetailedAsync(..., {occtMode:true})`
   → feature `applyAsync` → `occtEngine` (replicad). So **replicad WASM already
   loads inside the pipeline worker**, and the de-facto drag guard is that
   worker's `paramDragging` (~200 ms) debounce, NOT `setInteractionPhase`.

Separately, the **occt-worker** (`createWasmBridge` → `occt-worker-real.js`) runs
the K-series in its OWN worker, async, and after W2 speaks
`thicken`/`surfaceTrim`/`buildPlanarFace`. It is NOT what the UI modelling uses
today.

So there are **two worker contexts**: the pipeline worker (replicad) and the
occt-worker (K-series). W3's central question is how to converge them.

## 2. Architecture decision — A (nested worker) vs B (K-series in the pipeline worker)

| | **A — pipeline worker → occt-worker RPC** | **B ⭐ — load the K-series IN the pipeline worker** |
|---|---|---|
| How | the feature pipeline (in the pipeline worker) calls the occt-worker via a MessageChannel | replace/duplicate the replicad loader in the pipeline worker with the proven `opencascade.js` loader (`nodeOcctLoader`-style), drive `createNodeOcctBridge` directly |
| Workers | TWO (nested worker messaging) | ONE (pipeline worker only) |
| Latency | extra postMessage hop per op | in-process call (no hop) |
| Reuse | reuses `createWasmBridge` client | reuses `createNodeOcctBridge` (the exact node-proven bridge) |
| Risk | nested-worker lifecycle, structured-clone of meshes twice | 65 MB wasm in the pipeline worker (already pays ~replicad's cost) |

**Recommendation: B.** It eliminates nested-worker complexity, keeps ops as
in-worker calls (the pipeline already batches on settle), and reuses
`createNodeOcctBridge` — the bridge whose ops (incl. thicken/surfaceTrim) are
already headless-verified (25/25). The standalone occt-worker remains for
non-pipeline callers (direct `createWasmBridge` consumers, the e2e gate).

> Loader note: `nodeOcctLoader` reads the wasm via `fs` in Node; in the pipeline
> *worker* it loads `/occt-worker/opencascade.js` + `opencascade.wasm` over fetch
> (the W1 e2e proves both are served + instantiate in a browser context). A
> `workerOcctLoader` variant wraps that — the only new loader code.

## 3. The kernel facade

Introduce one seam so the pipeline doesn't care which kernel runs:

```ts
interface SolidKernel {
  extrude(profile, opts): Promise<{ id: string; mesh: MeshBuffers; volume: number }>;
  boolean(op, aId, bId): Promise<{ id: string; mesh; volume }>;
  // …revolve/sweep/loft/fillet/chamfer/thicken/surfaceTrim…
  release(id): void;
}
```

- `replicadKernel`  — wraps today's synchronous `occtEngine` (returns resolved Promises).
- `kSeriesKernel`   — wraps `createNodeOcctBridge` (already async) + its tessellate.

Both use **string ids** (occtEngine's handle == `OcctShape.id`), so the existing
`userData.occtHandle` threading is unchanged. The pipeline holds ids; the active
kernel owns the registry. Selection: `?occtWorker=1` (or an env/uiStore flag) →
`kSeriesKernel`; default → `replicadKernel`.

## 4. First consumer + sequence

Migrate op-by-op behind the flag, simplest first:

1. **`occtExtrudeProfile`** — W3a. No input handle; produces a solid + mesh. The
   cleanest first proof that the facade + async + tessellation round-trips.
   Acceptance: extrude a 10×10×5 → volume 500 via the K-series kernel; mesh
   renders; parity vs replicad within tol.
2. **`occtBooleanSolids`** — W3b. Threads TWO input ids → proves cross-op handle
   threading through the facade. Acceptance: box − tool = 420; parity holds.
3. **revolve / sweep / loft / fillet / chamfer** — W3c, mirror the pattern. Fillet
   exercises **persistent naming** (the K-series re-anchors edge selections by
   signature — already 7/7 headless): a selected-edge fillet must survive an
   upstream param change through the facade.
4. **thicken / surfaceTrim surfaced to the surfaces UI** — that's **W5**, now
   reachable because the facade speaks them.

## 5. Parity gate (the form)

The safety net for the async swap: for each migrated op, run BOTH kernels on the
same input and diff the result.

```ts
// dev/CI harness — NOT in the hot path
interface ParityVerdict { op: string; ok: boolean; volRelErr: number; bboxErr: number; note?: string }

async function kernelParity(op, inputs): Promise<ParityVerdict> {
  const r = await replicadKernel[op](...inputs);
  const k = await kSeriesKernel[op](...inputs);
  const volRelErr = Math.abs(r.volume - k.volume) / Math.max(1e-9, Math.abs(r.volume));
  const bboxErr  = maxCornerDist(r.bbox, k.bbox);
  return { op, ok: volRelErr < 0.005 && bboxErr < 1e-2, volRelErr, bboxErr };
}
```

- **Tolerance:** volume rel-err < 0.5%, bbox corner dist < 0.01 mm (tighten per
  op once baselined). Mesh tri-count is informational, not gated (tessellation
  deflection differs).
- **Where it runs:** a CI burn-in gated on `NEXYFAB_OCCT_REAL=1` (both kernels
  loadable). The K-series side ALSO runs headless via `createNodeOcctBridge`
  (proven in Node) — so the *K-side numbers* are unit-testable now; the
  cross-kernel diff needs replicad, which is the browser/e2e half.
- **On divergence:** log a structured `reportWarning('kernel_parity', verdict)`
  (the telemetry already exists) and FAIL the burn-in. Divergence is a caught
  bug, never a silent geometry change — matches the codebase's
  "block/warn rather than silently wrong" discipline.
- **Enablement:** `?occtWorker=1` opts a session into `kSeriesKernel`; default
  stays replicad. The flag + parity together make the swap reversible per-session.

## 6. Async + drag

`occtEngine` ops become async (await the facade). The feature `applyAsync` bodies
**already** await, so the change is localized to occtEngine internals + the
facade. The `*OnFrame` (drag) variants stay mesh/synchronous; the K-series only
runs on COMMIT (the pipeline's `paramDragging` debounce already coalesces drags),
so the worker's heavier latency never hits the interactive path.

## 7. Risks → mitigations

- **65 MB wasm in the pipeline worker** — it already pays ~replicad's WASM cost;
  load lazily on first OCCT-mode commit, cache. Measure before W3b.
- **Handle lifetime across the facade** — the active kernel owns the registry +
  `release`; the pipeline clears it per run (as today). Cap + release like
  `wasmBridge`'s 256 budget.
- **Tessellation parity** — mesh comes from the K-series `tessellate`; deflection
  differs from replicad's, so gate on volume/bbox, not tri-for-tri.
- **Persistent naming through the facade** — thread the stored edge selection
  (signature) across op calls; K-series re-anchors it (the 7/7 path). Fillet is
  the test.
- **Reversibility** — everything behind `?occtWorker=1`; default replicad; parity
  burn-in is the gate to ever flip the default (that flip is W6 / F1.3).

## 8. First concrete PR (headless-shippable)

1. `SolidKernel` interface + `replicadKernel` (wraps occtEngine) + `kSeriesKernel`
   (wraps `createNodeOcctBridge`).
2. `kernelParity` harness + a **headless** test that runs the K-series side via
   `createNodeOcctBridge` and asserts the absolute numbers (box=500, holed=420,
   thicken=200) — the cross-kernel diff lands in the `NEXYFAB_OCCT_REAL` e2e.
3. Route **only `occtExtrudeProfile`** through the facade behind `?occtWorker=1`.
   Default path byte-for-byte unchanged (replicad). Acceptance: existing pipeline
   tests stay green; the flag path extrudes a 500-volume solid via the K-series.

Everything in this PR except the cross-kernel browser diff is headless-testable —
so W3a can land + be verified here; only the replicad-vs-K-series numeric diff
needs the user's browser.

### W3a status (2026-06-08) — facade + parity harness SHIPPED (headless)

`features/solidKernel.ts` + `solidKernel.test.ts` (10 green):
- **`SolidKernel`** facade (string-id ops: extrude / boolean / buildPlanarFace /
  thicken / surfaceTrim / tessellate / release).
- **`createKSeriesKernel(bridge)`** — wraps any `OcctBridge`; verified over the
  REAL `opencascade.js` via `createNodeOcctBridge`: extrude→500, boolean→420,
  buildPlanarFace→thicken→200, tessellate+release.
- **`kernelParity(a, b, tol)`** — pure verdict (volRelErr ≤ 0.5%, bboxErr ≤
  0.01 mm); passes identical/within-tol, fails volume/bbox divergence + missing
  volume.

**Remaining W3a (browser-gated, NOT wired here):** `createReplicadKernel`
(wraps the sync `occtEngine`) + routing `occtExtrudeProfile` through the facade
behind `?occtWorker=1` in the pipeline, + the cross-kernel parity burn-in. These
touch the production pipeline + need replicad (browser), so they land with
real-browser verification — deliberately not blind-wired.
