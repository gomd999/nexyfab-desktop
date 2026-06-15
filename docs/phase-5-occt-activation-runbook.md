# Phase 5 — Real OCCT (browser) activation runbook

Operational checklist to flip the shape-generator's **worker bridge** from the
Phase-4 stub to the real OpenCascade kernel in the browser. Deploy-time
procedure; **risk is low** because the launcher falls back to the stub on any
failure, but the flip touches a production default so it is gated on a burn-in.

> Scope note: this is about the **new opencascade.js worker bridge**
> (`src/lib/occt/`, the K1–K7 kernel). The shape-generator UI already runs
> **replicad** (also OpenCascade) for its precise B-rep modelling today; that is
> independent of this flip. Activating this bridge gives the agent / B-rep
> tooling the new persistent-naming kernel (variable fillet, draft, STEP
> round-trip, topological edge IDs) in the browser. See
> `occt-worker/PHASE_5_INTEGRATION.md` for the deep design; this file is the
> step list.

---

## 0. What is ALREADY done (no action needed)

- `opencascade.js@^1.1.1` is a dependency; **`scripts/copy-occt.js`** copies the
  kernel (`opencascade.js` + `opencascade.wasm`) AND the three dispatchers
  (`occt-worker.js`, `occt-worker-real.js`, `occt-worker-launcher.js`) into
  `public/occt-worker/` — wired into `prebuild`, so a normal build produces them.
- **CSP is set + test-pinned**: `src/lib/security/cspHeaders.ts` ships
  `script-src 'wasm-unsafe-eval'`, `worker-src 'self' blob:`, and
  `/occt-worker/*` same-origin-CORP + 1-year immutable cache. Guarded by
  `cspHeaders.test.ts`.
- `occt-worker-real.js` implements all wire ops **incl. `tessellate`** (real
  BRepMesh), feature-detecting via `occt-worker-launcher.js` (real → stub
  fallback).
- The bridge exports **`LAUNCHER_WORKER_URL`** (`src/lib/occt/wasmBridge.ts`);
  `DEFAULT_WORKER_URL` still points at the stub.

So the only things left are: a consumer, the flip, and the burn-in.

---

## 1. Pre-flight (in CI / on the build host)

```bash
npm run build            # prebuild runs copy-occt; emits public/occt-worker/*
npm run occt:check --mode=wasm
```

`occt:check --mode=wasm` must report the WASM blob present and ≥ the size
threshold. If it falls back to `stub`, the binary did not copy — fix the build
(usually `npm ci` did not pull `opencascade.js`, or a Docker layer dropped
`node_modules/opencascade.js/dist`). **Do not proceed** until `wasm` passes.

Confirm the served files exist:

```
public/occt-worker/opencascade.js
public/occt-worker/opencascade.wasm        (gitignored — build artifact)
public/occt-worker/occt-worker.js          (stub)
public/occt-worker/occt-worker-real.js     (real dispatcher)
public/occt-worker/occt-worker-launcher.js (feature-detect)
```

---

## 2. Point the bridge at the launcher

Any caller of `createWasmBridge()` opts in per-call:

```ts
import { createWasmBridge, LAUNCHER_WORKER_URL } from '@/lib/occt/wasmBridge';
const bridge = createWasmBridge({ workerUrl: LAUNCHER_WORKER_URL });
```

To make it the global default instead, change `DEFAULT_WORKER_URL` in
`wasmBridge.ts` to `LAUNCHER_WORKER_URL` (one line). Prefer the per-call form
during rollout so a regression is scoped to the consumer.

> **Gate:** there is currently **no UI consumer** of `createWasmBridge` (the
> shape-generator runs replicad). A consumer must adopt the bridge first —
> otherwise the flip is inert. The natural first consumer is a server- or
> worker-side "precise rebuild / B-rep export" path, NOT the live slider preview
> (which must stay synchronous).

---

## 3. Burn-in (required before flipping the default)

Run a Playwright check in a real browser against the served binary:

1. Load a page that constructs `createWasmBridge({ workerUrl: LAUNCHER_WORKER_URL })`.
2. Assert the launcher posts `{ event: 'mode', mode: 'wasm' }` (NOT `'stub'`).
   `mode: 'stub'` with a `reason` means the real load failed — read the reason
   (404 / MIME / WASM-instantiate / CSP) and fix before shipping.
3. Drive the wire ops and assert geometry parity with the Node suite:
   - `buildFromExtrude` 10×10×5 → volume 500
   - boolean subtract holed solid → 420
   - `exportSTEP` → starts `ISO-10303-21`, round-trips with volume preserved
   - `tessellate` → 12 triangles for a box, 12 feature edges
   (These mirror `src/lib/occt/nodeOcctBridge.test.ts`, the Node ground truth.)
4. Check CSP: no `Refused to … 'wasm-unsafe-eval'` / `worker-src` violations in
   the console.

Only after the burn-in is green on the target browsers (Chrome + Safari + Firefox)
flip `DEFAULT_WORKER_URL`.

---

## 4. Verify in production

- UI kernel badge reads "OCCT 7.7" (not "simulated") where the launcher reports
  `mode: 'wasm'`.
- Sentry: no spike in `occt` / worker errors; the launcher's stub fallback means
  a failure degrades (slower/approx) rather than breaks.

## 5. Rollback

Set `workerUrl` back to `/occt-worker/occt-worker.js` (or revert
`DEFAULT_WORKER_URL`). No data migration — shapes are recomputed. Because the
launcher already falls back to the stub, even leaving the flip in place degrades
gracefully if the binary goes missing.

---

## Quick reference

| Concern | Location |
|---|---|
| Serve worker + wasm | `scripts/copy-occt.js` (prebuild) |
| CSP directives | `src/lib/security/cspHeaders.ts` (+ `.test.ts`) |
| Activation URL | `LAUNCHER_WORKER_URL` in `src/lib/occt/wasmBridge.ts` |
| Real dispatcher | `occt-worker/occt-worker-real.js` |
| Feature-detect | `occt-worker/occt-worker-launcher.js` |
| Node ground-truth ops | `src/lib/occt/nodeOcctBridge.test.ts` |
| Readiness gate | `npm run occt:check --mode=wasm` |
| Deep design | `occt-worker/PHASE_5_INTEGRATION.md` |
