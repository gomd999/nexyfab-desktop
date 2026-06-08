# OCCT K-series → Browser-Worker Migration Plan

> Status: design / kickoff plan · Drafted 2026-06-08
> Anchors: [ADR-014](../adr/014-occt-kernel-promotion.md) (path b, K8), [3D_MODELER_STATUS_AND_ROADMAP](./3D_MODELER_STATUS_AND_ROADMAP.md) §3, [phase-5-occt-activation-runbook](../phase-5-occt-activation-runbook.md)
> Scope: promote the validated headless `src/lib/occt` K-series (real
> `opencascade.js`) to the **browser** kernel via an async Web Worker, replacing
> the in-process `replicad` UI kernel where it hits the ceiling.

This is the explicit remaining **Tier 0** item: "migration plan for occtEngine
consumers (in-process sync → async worker)." It is the unlock for every Track S
🧱 ceiling op (surface trim / exact offset / thicken-to-solid / production
rolling-ball fillet) — all of which the K-series already performs headlessly
(`ceilingSpike.thicken.test.ts`, promoted in `nodeOcctBridge.ts`).

---

## 1. Why (the payoff)

- The K-series can express what replicad's high-level API cannot — **proven**:
  thicken (`MakeThickSolidBySimple`, exact volume), surface trim
  (`BRepAlgoAPI_Section`), plus fillet/chamfer/draft/variableFillet/STEP with
  **persistent topological naming**. Today these run only in Node/tests.
- replicad stays useful as a **fast preview / WASM-unavailable fallback** — this
  is not a rip-and-replace; it's promoting the source of truth.
- One kernel of record for the UI → no more two-stacks drift (ADR-014).

## 2. Current state (grounded)

| Piece | File(s) | State |
|---|---|---|
| In-process UI kernel | `shape-generator/features/occtEngine.ts` (replicad) | live, OCCT-mode-gated, **synchronous** |
| Engine selection | `features/engineSelection.ts` | `shouldUseOcctEngine()` (drag guard, ready check) |
| K-series (real OCCT) | `src/lib/occt/nodeOcctBridge.ts` + `OcctBridge` interface | **Node/test only**; full op set incl. thicken/surfaceTrim |
| Browser worker scaffold | `src/lib/occt/{wasmWorker*,wasmBridge,wasmReal,wasmRealActivation,runtimeMode}.ts`, `public/occt-worker/` | RPC client + worker boot exist; ops return **synthetic bbox** (no real BREP consumed yet) |
| Node loader | `src/lib/occt/nodeOcctLoader.ts` | loads `opencascade.js` (~700 ms, 65 MB wasm) in Node |
| Activation runbook | `docs/phase-5-occt-activation-runbook.md` | the browser-activation checklist |

**Gap:** the worker bridge boots `opencascade.wasm` but does not yet run the
`nodeOcctBridge` logic; `occtEngine` consumers call the kernel **synchronously**.

## 3. Target architecture

```
 UI (React)                       Web Worker (occt-worker)
 ─────────                         ────────────────────────
 occtEngine.apply* ──async RPC──▶  loadOcctNode()-equivalent (opencascade.js)
   │  (returns Promise)            createNodeOcctBridge(oc)  ← REUSED verbatim
   │                               op dispatch (extrude/boolean/fillet/
   │                                 thicken/surfaceTrim/…)
   ◀── {meshBuffers, shapeId} ───  tessellate → transferable Float32Array
   │
 viewport renders mesh; B-rep handle (shapeId) lives in the worker registry
 mesh fast-path (three-bvh-csg) used during slider drag; B-rep on commit
```

Key idea: **the worker reuses `createNodeOcctBridge` unchanged** — the bridge is
already pure over an `OcctModule`. The worker just provides the module (browser
`opencascade.js`) + an RPC envelope. The Node and browser kernels become the
same code behind one `OcctBridge`.

## 4. The four hard problems (and the approach)

1. **65 MB wasm in the browser.** Lazy-load only when OCCT mode commits a B-rep
   op; cache via the worker + HTTP cache (immutable, hashed URL); show a
   one-time "preparing precise kernel…" affordance. Never on first paint.
2. **sync → async everywhere.** Every `occtEngine` op + its `occtEngine.ts`
   consumers (feature apply, boolean panel, fillet UI, STEP export) become
   `await`. Guardrails: keep the mesh path synchronous for drag (no await on the
   hot path); a single `interactionPhase` gate routes drag→mesh, commit→worker.
   Audit every `shouldUseOcctEngine()` call site.
3. **Shape lifetime across the worker boundary.** Shapes live as `occt_<n>`
   handles in the worker registry (already how `nodeOcctBridge` works). The UI
   holds opaque ids; `release(shape)` sends a message → worker `.delete()`s.
   Budget live shapes (e.g. 256) + emit `release-suggested` at 75%.
4. **Persistent naming across rebuild.** The K-series already re-anchors edge
   selections by signature (`edgeCorrespondence`/`topologyEdgeFinder`). Carry
   the stored selection across the RPC so "fillet a selected edge, change an
   upstream param, fillet survives" holds in the browser (already 7/7 headless).

## 5. Phased plan + acceptance gates

| Phase | Deliverable | Acceptance gate |
|---|---|---|
| **W1 — browser boot** ✅ *(largely pre-existing; gate strengthened 2026-06-08)* | `occt-worker/occt-worker-real.js` already boots `opencascade.js` (65 MB wasm staged in `public/occt-worker/`) and maps the 11 ops; `e2e/occt/wasm-real.spec.ts` boots it in real chromium. **Added:** a real-VOLUME + ceiling-op gate (box=500, holed=420, **thicken-ceiling=200**) mirroring the headless `nodeOcctBridge`/`ceilingSpike` asserts | `NEXYFAB_OCCT_REAL=1 npm run test:e2e:occt` (user-run): in-browser volumes match node exactly, incl. the thicken ceiling op. The prior spec only checked non-null shapes |
| **W2 — RPC + ceiling ops** ✅ *(wire plumbing 2026-06-08)* | RPC + registry already shipped (`wasmBridge`/`wasmWorkerStub`/`occt-worker*.js`). **Added the ceiling ops `buildPlanarFace`/`thicken`/`surfaceTrim` across the whole wire**: `OcctBridge` interface + bridge.ts stub (synthetic) + wasmWorkerStub (TS) + wasmBridge client + `occt-worker.js` (JS stub) + `occt-worker-real.js` (real embind, mirrors nodeOcctBridge) | **headless: 123 green** (bridge.test + wasmBridge.test + wasmWorker.integration JS-stub-in-node + nodeOcctBridge). **browser (user-run):** `e2e/occt` W2 drives the real worker over postMessage — thicken returns ~200 volume |
| **W3 — occtEngine async swap** | `occtEngine` ops return Promises wired to the worker; mesh stays the drag fast-path; one feature (boolean) fully migrated behind `?occtWorker=1` | parity: replicad vs worker boolean agree on volume within tol (a CI parity gate); drag stays <16 ms (mesh), commit produces B-rep |
| **W4 — coverage** | Migrate the remaining ops (extrude/revolve/sweep/loft/fillet/chamfer/shell/draft/pattern) op-by-op behind the flag | every solid op returns a worker B-rep handle in OCCT mode; STEP export uses the worker writer |
| **W5 — Track S ceiling** | Surface the proven `thicken` / `surfaceTrim` (+ exact offset / production fillet) to the surfaces UI through the worker | thicken a surface→solid + trim two surfaces **in the browser**, volume/edge verified (the headless asserts, now live) |
| **W6 — default + cleanup** | Flip OCCT mode default ON (gated by the F1.3 visual-regression matrix); replicad demoted to fast-preview/fallback; one kernel of record documented | visual-regression matrix green; perf budget (load, commit latency, memory) within SLA; ADR-014 marked delivered |

W1–W2 are the de-risking core (does the browser run the K-series at all, with a
clean RPC). W3 is the UX inflection (async). W5 is the payoff (ceiling ops).

## 6. Risks → mitigations

- **Browser perf of opencascade.js** (much heavier than replicad): keep mesh the
  interactive path; only commit-time B-rep on the worker; measure W1 before W3.
- **Webpack/Emscripten bundling** (the recurring pain — see
  `feedback_webpack_emscripten_wasm`): the worker is a separate bundle; load the
  glue via runtime `import()` + `wasmBinary`, never a static import.
- **Async refactor blast radius**: do W3 behind `?occtWorker=1`, one op at a
  time, with a replicad-vs-worker parity gate so divergence is a caught bug.
- **Memory**: 65 MB wasm + live shapes; cap the registry, release aggressively,
  surface a budget indicator.
- **Regression to the validated mesh path**: the mesh fallback is never removed;
  every op keeps its synchronous mesh route for drag + WASM-unavailable.

## 7. Effort

Rough: **W1–W2 ≈ 1–2 weeks** (de-risk), **W3 ≈ 2–4 weeks** (async refactor is the
bulk), **W4 ≈ 2–3 weeks**, **W5 ≈ 1–2 weeks** (logic exists; UI surface), **W6**
gated on the browser visual-regression matrix. Total ≈ **a quarter** for one
engineer — matching the ADR-014 "multi-quarter rewrite" estimate, now de-risked
at the kernel-capability level (the spike proved the ops; this is plumbing+UX).

## 8. First concrete step — DONE (W1 gate, 2026-06-08)

W1's browser-boot infra already existed (`occt-worker-real.js` + the wasm in
`public/`). The missing piece was a gate proving **correct geometry** (the prior
`e2e/occt/wasm-real.spec.ts` only checked non-null shapes). Added a Playwright
test that, in real chromium, computes real `VolumeProperties` and asserts box=500,
holed=420, and the **thicken ceiling op = 200** — mirroring the headless
`nodeOcctBridge`/`ceilingSpike` asserts so node↔browser drift is caught (run:
`NEXYFAB_OCCT_REAL=1 npm run test:e2e:occt`).

## 9. W2 status (2026-06-08)

The ceiling ops `buildPlanarFace`/`thicken`/`surfaceTrim` now cross the **entire
wire** (interface → stub → TS worker-stub → client → JS stub → real dispatcher).
Headless-verified at the stub level (123 green: the JS stub `occt-worker.js` runs
in a Node sandbox via `wasmWorker.integration.test.ts`); the real
`occt-worker-real.js` embind port mirrors the node-proven `nodeOcctBridge` and is
browser-verified by the user (`e2e/occt` W2 drives the real worker over
postMessage → thicken volume ≈ 200).

**Next (W3):** route `occtEngine` ops through `createWasmBridge` behind
`?occtWorker=1` (the async refactor), with a replicad-vs-worker parity gate; keep
mesh the drag fast-path. Then surface `thicken`/`surfaceTrim` to the surfaces UI
(W5) — the logic is now reachable through the worker.
