# Phase 5 — OCCT WASM Integration Guide

NexyFab Pro own-CAD (ADR-013). This document is the operational playbook for
swapping the Phase 4 stub at `occt-worker/occt-worker.js` for a real OCCT
WASM kernel without breaking the bridge in `src/lib/occt/wasmBridge.ts` or
the wire protocol mirrored in `src/lib/occt/wasmWorkerStub.ts`.

The bridge and stub are **frozen** for Phase 5. The only files that change
are:

1. `occt-worker/occt-worker.js`            — gains a real `importScripts` path.
2. `occt-worker/occt-worker-real.js`       — new; what ships when the binary is present.
3. `occt-worker/opencascade.{wasm,js,data}` — new; build artifacts (NOT in git).
4. `public/occt-worker/*`                   — copied at build time, see CONFIG.md.

Everything in `src/lib/occt/` keeps the wire protocol it has today.

---

## 1. Library candidate comparison

We need an OCCT-backed WASM that exposes **at minimum** the 11 ops the wire
protocol speaks: `init`, `buildFromExtrude`, `buildFromRevolve`,
`booleanUnion`, `booleanSubtract`, `booleanIntersect`, `fillet`, `chamfer`,
`exportSTEP`, `importSTEP`, `release`.

| Package              | Binary (gzip)   | OCCT version | Ops covered                                                   | License        | Notes                                                                                                                          |
|----------------------|-----------------|--------------|---------------------------------------------------------------|----------------|--------------------------------------------------------------------------------------------------------------------------------|
| **opencascade.js**   | ~5 MB (~12 MB raw) | OCCT 7.7.0 (some forks 7.8) | **all 11** — full Embind surface (BRepPrimAPI, BRepAlgoAPI, BRepFilletAPI, STEPControl) | MIT (LGPL OCCT runtime) | Best fit. Maintained, npm-published (`opencascade.js@2.x`), ships standard + custom builds. Bridge ops map 1:1.                |
| **occt-import-js**   | ~1 MB           | OCCT 7.7 (subset) | STEP read only (no MakePrism, no MakeRevol, no booleans, no fillet) | MIT (LGPL OCCT) | Disqualified for Phase 5 — covers `importSTEP` and visualization tessellation only. Useful as a *fallback* read-only path.    |
| **opencascade.js custom build** | 1.5–3 MB (op-pruned) | Same as parent | Same 11 (we choose) | MIT (LGPL OCCT) | Recommended for production: `opencascade.js`'s build config lets us strip ops we don't ship (e.g. NURBS surface intersection). |
| **Self-build (emcc + OCCT 7.8)** | 4–7 MB tuned | OCCT 7.8 (latest) | All ops + AP242 + GD&T headers | LGPL OCCT | 40–60 min build, separate `occt-emscripten-build/` repo. Required for AP242 PMI later — not for Phase 5 launch.                |
| CascadeStudio        | bundled         | OCCT 7.5      | Indirect (JSON-RPC inside their app) | MIT             | Not a library — an app. Useful only as a reference.                                                                            |

**Recommendation: `opencascade.js` for Phase 5 v1**, with a switch to a
custom `opencascade.js` build (pruned) once the op list is frozen. The
self-build/AP242 track is Phase 5.5+.

### Why opencascade.js wins

- **Full kernel surface** — every wire op has a direct Embind call.
- **MIT wrapper, LGPL kernel** — same license posture we already accept.
- **npm-distributable** — `npm install opencascade.js` lands the WASM + JS
  glue; no Docker side-build for the first integration.
- **Documented init contract** matches our bridge's `init` handshake (an
  async factory that resolves when the module is instantiated).

### Why occt-import-js loses

- STEP read only. We'd still need a second kernel for everything else;
  shipping two WASMs in the same worker is a memory + CSP nightmare.

---

## 2. Integration steps

### Step 1 — install

```bash
npm install opencascade.js@2.0.0-beta.94      # or current stable
```

Add to `package.json` **only**. Do NOT commit the WASM file from
`node_modules/` into git — copy at build time from
`node_modules/opencascade.js/dist/` into `public/occt-worker/`.

`scripts/copy-occt.js` (new, ~10 lines):

```js
// Run from `prebuild` hook.
const fs = require('node:fs');
const src = 'node_modules/opencascade.js/dist';
const dst = 'public/occt-worker';
for (const f of ['opencascade.js', 'opencascade.wasm']) {
  fs.copyFileSync(`${src}/${f}`, `${dst}/${f}`);
}
```

Wire it into `package.json`:

```json
"scripts": {
  "prebuild": "node scripts/copy-occt.js",
  ...
}
```

### Step 2 — add `importScripts` path in `occt-worker.js`

The stub currently has no `importScripts`. Phase 5 wraps the top of the
file in a try/catch:

```js
try {
  importScripts('./opencascade.js');         // succeeds in prod, fails in dev
  self.__OCCT_REAL__ = true;
} catch (_e) {
  self.__OCCT_REAL__ = false;                // stub mode
}
```

The rest of the file branches on `self.__OCCT_REAL__`. See Part 3 of the
playbook below for the exact feature-detection wrapper.

### Step 3 — Module() init → 11 op mapping

In the real path (`occt-worker-real.js`):

```js
let occt = null;
let occtReady = (async () => {
  occt = await Module({
    locateFile: (p) => p === 'opencascade.wasm' ? './opencascade.wasm' : p,
  });
})();
```

Each op `await`s `occtReady` before dispatching. The `init` op replies
**only after** that promise resolves — that is the contract the bridge's
30s `initTimeoutMs` is measuring.

### Step 4 — handle table: `TopoDS_Shape` ↔ int

OCCT shapes live in the WASM heap. JavaScript GC will NOT free them; the
handle table must own them explicitly:

```js
const handles = new Map();          // int → TopoDS_Shape
let next = 1;
function alloc(shape) { const h = next++; handles.set(h, shape); return h; }
function release(h) {
  const s = handles.get(h);
  if (s) { s.delete(); handles.delete(h); }   // Embind delete frees heap
}
```

Every op that creates a result shape MUST `alloc(result)` and reply with
`{ handle, kind, bbox, volume, area, centerOfMass }`.

### Per-op binding table

| Wire op            | OCCT binding (opencascade.js)                                         |
|--------------------|-----------------------------------------------------------------------|
| `buildFromExtrude` | `BRepBuilderAPI_MakePolygon` → `MakeFace` → `BRepPrimAPI_MakePrism`   |
| `buildFromRevolve` | profile → `MakeFace` → `BRepPrimAPI_MakeRevol` (gp_Ax1 along +Y)      |
| `booleanUnion`     | `BRepAlgoAPI_Fuse(a, b).Shape()`                                      |
| `booleanSubtract`  | `BRepAlgoAPI_Cut(a, b).Shape()`                                       |
| `booleanIntersect` | `BRepAlgoAPI_Common(a, b).Shape()`                                    |
| `fillet`           | `BRepFilletAPI_MakeFillet(shape)` + `.Add(radius, edge)` per edgeId   |
| `chamfer`          | `BRepFilletAPI_MakeChamfer(shape)` + `.Add(dist, edge, face)`         |
| `exportSTEP`       | `STEPControl_Writer().Transfer(shape, AP214CD).WriteStream(buf)`      |
| `importSTEP`       | `STEPControl_Reader().ReadStream(buf).Transfer() → OneShape()`        |
| `release`          | `handles.get(h).delete(); handles.delete(h)`                          |

Bbox / volume / area / centre of mass after every op:

```js
const bnd = new occt.Bnd_Box();
occt.BRepBndLib.Add(shape, bnd, true);
const props = new occt.GProp_GProps();
occt.BRepGProp.VolumeProperties(shape, props);
const vol = props.Mass();
const com = props.CentreOfMass();      // gp_Pnt → {x,y,z}
```

These three numbers complete the `WireShapePayload` the bridge expects.

---

## 3. CSP, security, build

- **CSP** — Adding WASM requires `script-src 'self' 'wasm-unsafe-eval'` and
  `worker-src 'self' blob:` (Emscripten uses Blob URLs internally).
- **No `eval`** — Emscripten OCCT does NOT need `unsafe-eval`; we got
  burned by `planegcs` requiring it (see memory `feedback_webpack_emscripten_wasm`).
  Verify with the dev-tools "Issues" tab BEFORE flipping the CSP.
- **COOP/COEP** — Only required if we enable Emscripten pthreads. For
  Phase 5 v1, stay single-threaded; revisit when boolean perf becomes the
  bottleneck.
- **WASM integrity** — Serve with `Cross-Origin-Resource-Policy: same-origin`
  and a SHA-384 SRI on the loader. The WASM itself can't carry SRI but
  `opencascade.js` (the loader) can.
- **Source map** — Build with `--emit-symbol-map` so Sentry can de-mangle
  `wasm:::n0` into `BRepAlgoAPI_Fuse::Build`.

---

## 4. Launch checklist (the actual swap day)

1. `npm install opencascade.js` and verify `node_modules/opencascade.js/dist/`
   has `opencascade.wasm` (~12 MB raw).
2. Add `scripts/copy-occt.js` and the `prebuild` hook.
3. Land `occt-worker-real.js` (the real dispatcher).
4. Edit `occt-worker.js` to: try `importScripts('./opencascade.js')`; if it
   succeeds, swap the dispatcher to the real one via a second
   `importScripts('./occt-worker-real.js')`. If it fails, stay in stub mode.
   The existing stub body stays as the fallback.
5. Update CSP headers (`next.config.ts` / Cloudflare worker).
6. Burn-in: run `wasmWorker.integration.test.ts` against the real binary
   inside Playwright (jsdom can't load WASM cleanly).
7. Land `*.kernel.test.ts` for real BREP assertions (volume of a 10×10×10
   extrude == 1000 ± 1e-6; STEP roundtrip preserves volume).
8. Update `BREP_QA_CHECKLIST.md` with the new kernel matrix.

---

## 5. Out-of-scope for Phase 5 v1

These land in 5.5 / 6:

- **AbortSignal / cancellation** — requires patching OCCT Progress callbacks.
- **Tessellation feed** — `tessellate(handle, deflection)` op for UI display.
- **Assembly mate solver** — lives in `occt-collab-worker/`, parallel track.
- **STEP AP242 + PMI / GD&T** — needs self-build with extra IGES/STEP modules.
- **Per-session heap budget** — bridge already calls `onLowMemory` at 256
  handles; real WASM should echo Emscripten heap stats per response.
- **Embind dispose discipline audit** — every `new occt.X` needs a `.delete()`
  pair; eslint rule to enforce comes in a follow-up.
