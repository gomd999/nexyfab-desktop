# occt-worker — OCCT WASM worker package (Phase 4 stub → Phase 5 real)

NexyFab Pro own-CAD (ADR-013). This directory holds the Web Worker bundle
that the WASM-backed OCCT bridge in `src/lib/occt/wasmBridge.ts` posts
messages to. It is served to the browser at `/occt-worker/occt-worker.js`
(see `CONFIG.md` for how the file gets into `public/occt-worker/`).

## Status today (Phase 4)

**This is a stub.** `occt-worker.js` speaks the full wire protocol the
real OCCT worker will, but every kernel op fabricates a synthetic
`OcctShape`:

| Op                  | What the stub returns                                    |
|---------------------|----------------------------------------------------------|
| `init`              | `{ ok: true }` immediately                               |
| `buildFromExtrude`  | bbox = 2D loop envelope × depth (respecting direction)   |
| `buildFromRevolve`  | bbox = full-revolve envelope around canonical Y axis     |
| `booleanUnion`      | element-wise min/max of input bboxes                     |
| `booleanSubtract`   | A's bbox unchanged (stub cannot cut geometry)            |
| `booleanIntersect`  | element-wise intersection; `ok: false` if disjoint       |
| `fillet` / `chamfer`| pass-through (new id, same bbox)                         |
| `exportSTEP`        | minimal ISO-10303-21 envelope — NO geometry              |
| `importSTEP`        | recognises the envelope shape only; returns a 10×10×10   |
| `release`           | drops the handle from the worker-side `Map`              |

The stub is enough to:
- Exercise the bridge's `reqId` + handle-table + dispose plumbing in real
  browsers (not just jsdom).
- Wire UI panels (boolean, fillet, STEP export) end-to-end so the only
  swap when Phase 5 lands is `occt-worker.js` itself.
- Keep the integration test green even before the OCCT binary exists.

## Stub limits (what does NOT work)

These will surprise anyone who treats the stub as a kernel. Documented
explicitly so failures don't masquerade as bugs:

1. **No BREP.** All shapes are bboxes. Anything that needs faces/edges/
   vertices (display, mesh tessellation, GD&T snap, edge selection for
   fillet) is impossible.
2. **`exportSTEP` produces a non-loadable envelope.** Other CAD tools
   will open the file but find zero geometry. Do NOT ship STEP files
   produced by this stub to design partners.
3. **`importSTEP` is hard-coded to a 10×10×10 box** for any input that
   contains the `ISO-10303-21` magic. Real BREP parsing is Phase 5.
4. **`fillet` and `chamfer` are pass-throughs** — the result bbox equals
   the input bbox. The warning string tells the UI but the geometry is
   unchanged.
5. **`booleanSubtract`** returns A unchanged. No CSG happens.
6. **No memory pressure.** Every handle is a small JS record; you can
   create millions without OOM. The Phase 5 worker will be backed by a
   ~256 MB Emscripten heap.
7. **No cancellation.** Long ops cannot be aborted (a moot point here
   because every op is O(profile-length)).
8. **No threads.** Phase 5 may use Emscripten pthreads if the OCCT
   build cooperates; this stub is intentionally single-threaded.

## Phase 5: the real OCCT binary

When the real kernel ships:

### Binary plan

| File                            | Source                                       |
|---------------------------------|----------------------------------------------|
| `occt.wasm`                     | OCCT 7.8 compiled with `emcc -O3`            |
| `occt-bindings.js`              | Embind glue (TopoDS_Shape, MakePrism, …)     |
| `occt-worker.js` (this file)    | thin dispatcher — keeps wire protocol stable |

Build it in a separate repo (`occt-emscripten-build/`) so a Docker job
produces a versioned tarball; copy the artifacts into this directory at
release time. Do NOT compile OCCT inside `nexyfab.com/new/` — the WASM
build takes ~40 minutes and would block every CI run.

### Module init contract

```js
importScripts('./occt-bindings.js');         // exposes Module factory
Module().then(function (Mod) {
  occt = Mod;                                // Embind handle
  self.onmessage = handleRequest;            // start accepting requests
  // do NOT postMessage 'init ok' until HERE — that signal means "ready".
});
```

The bridge's init handshake timeout (default 30 s, configurable) starts
the moment `createWasmBridge` is called, so OCCT instantiation MUST
finish inside that window or callers see "init handshake timed out".

### Handle table

```js
const handles = new Map();   // number → TopoDS_Shape*
let next = 1;
function alloc(shape) { const h = next++; handles.set(h, shape); return h; }
function release(h)   { const s = handles.get(h); if (s) { s.delete(); handles.delete(h); } }
```

`Shape.delete()` is mandatory — OCCT shapes live in the WASM heap and
JavaScript GC won't free them. The bridge's `release` op MUST be
fire-and-forget reliable; if it ever drops a message the worker leaks.

### Per-op bindings

| Wire op                | OCCT binding                                                  |
|------------------------|---------------------------------------------------------------|
| `buildFromExtrude`     | `BRepBuilderAPI_MakeWire` → `MakeFace` → `BRepPrimAPI_MakePrism`|
| `buildFromRevolve`     | profile → `MakeFace` → `BRepPrimAPI_MakeRevol`                |
| `booleanUnion`         | `BRepAlgoAPI_Fuse`                                            |
| `booleanSubtract`      | `BRepAlgoAPI_Cut`                                             |
| `booleanIntersect`     | `BRepAlgoAPI_Common`                                          |
| `fillet`               | `BRepFilletAPI_MakeFillet` (edge selection by `edgeIds`)      |
| `chamfer`              | `BRepFilletAPI_MakeChamfer`                                   |
| `exportSTEP`           | `STEPControl_Writer` (AP214, schema CD)                       |
| `importSTEP`           | `STEPControl_Reader` → `TopoDS_Shape` per root product        |

After each op compute `bbox` (`Bnd_Box`), `volume`/`area` (`GProp_GProps`
via `BRepGProp::VolumeProperties` / `SurfaceProperties`) and `centerOfMass`
so the wire payload stays identical.

### Wishlist beyond Phase 5 baseline

- **`AbortSignal` over `{ op: 'cancel', reqId }`.** Long fillets/booleans
  should honour cancellation at safe breakpoints (BRepAlgoAPI has progress
  callbacks but no clean abort — may require patching). Bridge already
  reserves the reqId infrastructure for this.
- **Per-session memory cap with `release-suggested` event.** Currently
  the bridge advisory is `onLowMemory` at 256 handles; the worker should
  echo Emscripten heap usage so the bridge can fire the advisory based on
  real bytes not handle count.
- **edgeIds.** Today the stub takes opaque strings; the real worker needs
  a stable encoding (e.g. face-index + edge-index pair) so re-edits of a
  fillet feature can find the same edge after a topology change. This is
  a separate design that should land BEFORE the worker, not after.
- **Tessellation feed.** UI display needs triangles, not BREP. Add a
  `tessellate(handle, deflection)` op returning `{ positions, normals,
  indices, edges }` per shape — bridge does not have this yet because
  the stub has nothing to tessellate.
- **Assembly mate solver.** Phase 6, lives in `occt-collab-worker/` (see
  its README) — keep this worker focused on single-part kernel ops so
  the assembly worker can run in parallel.
- **STEP AP242 + GD&T.** Today's wishlist is AP214 only; AP242 adds
  PMI/GD&T which is the upgrade path for ITAR-shop partners.
- **Source map.** The Emscripten WASM should ship with `occt.wasm.map`
  so Sentry crash reports surface OCCT symbol names not `wasm:::n0`.

## Tests

`src/lib/occt/wasmWorker.integration.test.ts` evaluates this very file
inside jsdom, wires it to the bridge through a `MessageChannel`-style
mock `Worker`, and exercises the full surface (init, build, boolean,
fillet, chamfer, export, import, release). When `occt-bindings.js`
ships, that test should keep passing — the wire protocol is the
contract under test, not the geometry. A separate `*.kernel.test.ts`
will land in Phase 5 to validate real BREP output (volume, face count,
bbox tightness).
