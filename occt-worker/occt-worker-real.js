/**
 * occt-worker-real.js — Phase 5 real OCCT WASM dispatcher (STRUCTURE ONLY).
 *
 * NexyFab Pro own-CAD (ADR-013). This file is the destination of the Phase 5
 * swap described in `PHASE_5_INTEGRATION.md`. IT DOES NOT EXECUTE A REAL OCCT
 * BINARY YET — `opencascade.wasm` / `opencascade.js` are not in the repo and
 * are not bundled in `node_modules` at this commit. The file is committed in
 * structure-only form so:
 *
 *   1. The dispatcher shape is reviewable BEFORE the binary lands (CSP, init
 *      handshake, handle-table semantics, op signatures).
 *   2. The launch-day diff is *adding* `importScripts('./opencascade.js')`
 *      and `Module(...)`, not designing a new dispatcher.
 *   3. Any reviewer can see where the actual OCCT calls go without staring
 *      at a 12 MB WASM blob.
 *
 * SWAP PROCEDURE (launch day):
 *   - Drop `opencascade.js` + `opencascade.wasm` into this directory (via
 *     `scripts/copy-occt.js` from `node_modules/opencascade.js/dist/`).
 *   - Edit `occt-worker.js` to `importScripts('./occt-worker-real.js')` when
 *     the binary is present (see Part 3 of PHASE_5_INTEGRATION.md).
 *   - Uncomment the OCCT call sites below and delete the `TODO_PHASE_5`
 *     placeholders.
 *   - Run `wasmWorker.integration.test.ts` under Playwright (jsdom can't
 *     instantiate the WASM cleanly).
 *
 * WIRE PROTOCOL — IDENTICAL to occt-worker.js and wasmWorkerStub.ts. Do not
 * drift the envelope shape; the bridge does not branch on stub vs real.
 */
/* global self */

(function () {
  'use strict';

  // ─── OCCT module bootstrap (Phase 5 swap point) ────────────────────────
  //
  // The real binary ships as a single Emscripten factory exposed as
  // `globalThis.Module`. We import it and await its async init promise.
  // Until that promise resolves, every kernel op queues behind `occtReady`
  // and the `init` op DOES NOT REPLY ok. That alignment is what makes the
  // bridge's 30s initTimeoutMs measure WASM instantiation, not worker
  // thread startup.
  //
  // STRUCTURE-ONLY: the importScripts + Module() call are commented out
  // until the binary lands. `occtReady` resolves immediately to a sentinel
  // so the dispatcher framework is still exercisable by reviewers.

  /** @type {unknown} OCCT Embind module handle. `null` until init resolves. */
  let occt = null;

  /** @type {Promise<void>} */
  const occtReady = (function bootOcct() {
    // ── PHASE 5 SWAP: uncomment this block ───────────────────────────────
    // importScripts('./opencascade.js');
    // return Module({
    //   locateFile: function (p) {
    //     return p === 'opencascade.wasm' ? './opencascade.wasm' : p;
    //   },
    // }).then(function (mod) {
    //   occt = mod;
    // });
    // ─────────────────────────────────────────────────────────────────────

    // Structure-only path: pretend we initialised so the dispatcher framework
    // is testable. Every op below early-returns with an `unimplemented` error
    // because `occt` is still `null`.
    return Promise.resolve();
  })();

  // ─── handle table: integer ↔ TopoDS_Shape ──────────────────────────────
  // Real OCCT shapes live in the WASM heap and need an explicit `.delete()`
  // to free. JS GC will NOT do this. Every alloc must be paired with a
  // release; orphans leak the Emscripten heap until the worker is dropped.
  /** @type {Map<number, unknown>} */
  const handles = new Map();
  let nextHandle = 1;

  function _alloc(shape) {
    // Referenced by every "PHASE 5 SWAP" call site below — eslint can't see
    // commented usages, so the leading underscore documents the intentional
    // hold until the binary lands.
    const h = nextHandle++;
    handles.set(h, shape);
    return h;
  }
  void _alloc;

  function freeHandle(h) {
    const s = handles.get(h);
    if (!s) return;
    // PHASE 5 SWAP: s.delete();   // Embind dispose, frees WASM heap
    handles.delete(h);
  }

  // ─── geometry helpers (Phase 5 swap point) ─────────────────────────────
  //
  // After every op that produces a shape, compute the bbox + mass props so
  // the wire payload matches `WireShapePayload`. Stub returns zeros so the
  // structure is testable; real path uses Bnd_Box + GProp_GProps.

  function shapeMetrics(_phase5Shape) {
    void _phase5Shape;
    // PHASE 5 SWAP: real implementation
    //   const bnd = new occt.Bnd_Box();
    //   occt.BRepBndLib.Add(_shape, bnd, true);
    //   const min = bnd.CornerMin(), max = bnd.CornerMax();
    //   const props = new occt.GProp_GProps();
    //   occt.BRepGProp.VolumeProperties(_shape, props);
    //   const com = props.CentreOfMass();
    //   const surf = new occt.GProp_GProps();
    //   occt.BRepGProp.SurfaceProperties(_shape, surf);
    //   bnd.delete(); props.delete(); surf.delete();
    //   return {
    //     bbox: {
    //       min: { x: min.X(), y: min.Y(), z: min.Z() },
    //       max: { x: max.X(), y: max.Y(), z: max.Z() },
    //     },
    //     volume: props.Mass(),
    //     area: surf.Mass(),
    //     centerOfMass: { x: com.X(), y: com.Y(), z: com.Z() },
    //   };
    return {
      bbox: { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } },
      volume: 0,
      area: 0,
      centerOfMass: { x: 0, y: 0, z: 0 },
    };
  }

  function shapeToWire(handle, shape, kind) {
    const m = shapeMetrics(shape);
    return {
      handle: handle,
      kind: kind,
      bbox: m.bbox,
      volume: m.volume,
      area: m.area,
      centerOfMass: m.centerOfMass,
    };
  }

  // ─── per-op OCCT call sites (Phase 5 swap point) ───────────────────────
  //
  // Each function returns `{ ok, handle?, kind?, warnings, error? }`. The
  // dispatcher wraps that into the wire envelope. Until the binary lands,
  // every function returns an `unimplemented` error so it's visually clear
  // in tests that the real path is gated.

  function buildFromExtrude(feature) {
    if (!occt) return { ok: false, error: 'occt-real: unimplemented (binary not loaded)', warnings: [] };
    // PHASE 5 SWAP: real implementation
    //   const polygon = new occt.BRepBuilderAPI_MakePolygon();
    //   for (const p of feature.loop) polygon.Add(new occt.gp_Pnt(p.x, p.y, 0));
    //   polygon.Close();
    //   const face = new occt.BRepBuilderAPI_MakeFace(polygon.Wire(), true).Face();
    //   const dir = new occt.gp_Vec(0, 0, feature.depth);
    //   const prism = new occt.BRepPrimAPI_MakePrism(face, dir, false, true);
    //   const shape = prism.Shape();
    //   polygon.delete(); face.delete(); dir.delete(); prism.delete();
    //   const h = alloc(shape);
    //   return { ok: true, handle: h, kind: 'solid', warnings: [] };
    void feature;
    return { ok: false, error: 'occt-real: buildFromExtrude unimplemented', warnings: [] };
  }

  function buildFromRevolve(feature) {
    if (!occt) return { ok: false, error: 'occt-real: unimplemented (binary not loaded)', warnings: [] };
    // PHASE 5 SWAP:
    //   profile → MakeFace → BRepPrimAPI_MakeRevol(face, gp_Ax1(+Y), angle, true).Shape()
    void feature;
    return { ok: false, error: 'occt-real: buildFromRevolve unimplemented', warnings: [] };
  }

  function booleanOp(op, handleA, handleB) {
    if (!occt) return { ok: false, error: 'occt-real: unimplemented (binary not loaded)', warnings: [] };
    const a = handles.get(handleA);
    const b = handles.get(handleB);
    if (!a || !b) return { ok: false, error: op + ': unknown handle', warnings: [] };
    // PHASE 5 SWAP:
    //   const algo = op === 'booleanUnion'
    //     ? new occt.BRepAlgoAPI_Fuse(a, b)
    //     : op === 'booleanSubtract'
    //     ? new occt.BRepAlgoAPI_Cut(a, b)
    //     : new occt.BRepAlgoAPI_Common(a, b);
    //   algo.Build();
    //   if (!algo.IsDone()) { algo.delete(); return { ok:false, error: op+': BRepAlgoAPI not done', warnings: [] }; }
    //   const shape = algo.Shape();
    //   algo.delete();
    //   return { ok: true, handle: alloc(shape), kind: 'solid', warnings: [] };
    return { ok: false, error: 'occt-real: ' + op + ' unimplemented', warnings: [] };
  }

  function filletOrChamfer(op, handle, edgeIds, dim) {
    if (!occt) return { ok: false, error: 'occt-real: unimplemented (binary not loaded)', warnings: [] };
    const src = handles.get(handle);
    if (!src) return { ok: false, error: op + ': unknown handle', warnings: [] };
    // PHASE 5 SWAP:
    //   const algo = op === 'fillet'
    //     ? new occt.BRepFilletAPI_MakeFillet(src)
    //     : new occt.BRepFilletAPI_MakeChamfer(src);
    //   for (const edge of resolveEdges(src, edgeIds)) {
    //     op === 'fillet' ? algo.Add_2(dim, edge) : algo.Add_2(dim, edge);
    //   }
    //   algo.Build();
    //   const shape = algo.Shape();
    //   algo.delete();
    //   return { ok: true, handle: alloc(shape), kind: 'solid', warnings: [] };
    void edgeIds; void dim;
    return { ok: false, error: 'occt-real: ' + op + ' unimplemented', warnings: [] };
  }

  function exportSTEP(handle) {
    if (!occt) return { ok: false, error: 'occt-real: unimplemented (binary not loaded)', warnings: [] };
    const shape = handles.get(handle);
    if (!shape) return { ok: false, error: 'exportSTEP: unknown handle', warnings: [] };
    // PHASE 5 SWAP:
    //   const writer = new occt.STEPControl_Writer();
    //   writer.Transfer(shape, occt.STEPControl_StepModelType.AsIs);
    //   const path = '/tmp/out.step';
    //   writer.Write(path);
    //   const buf = occt.FS.readFile(path, { encoding: 'utf8' });
    //   writer.delete();
    //   return { ok: true, step: buf, warnings: [] };
    return { ok: false, error: 'occt-real: exportSTEP unimplemented', warnings: [] };
  }

  function importSTEP(source) {
    if (!occt) return { ok: false, error: 'occt-real: unimplemented (binary not loaded)', warnings: [] };
    if (typeof source !== 'string' || source.length === 0) {
      return { ok: false, error: 'importSTEP: empty source', warnings: [] };
    }
    // PHASE 5 SWAP:
    //   occt.FS.writeFile('/tmp/in.step', source);
    //   const reader = new occt.STEPControl_Reader();
    //   const status = reader.ReadFile('/tmp/in.step');
    //   if (status !== occt.IFSelect_ReturnStatus.RetDone) { reader.delete(); return {ok:false,error:'importSTEP: parse failed',warnings:[]}; }
    //   reader.TransferRoots();
    //   const shape = reader.OneShape();
    //   reader.delete();
    //   return { ok: true, handle: alloc(shape), kind: 'solid', warnings: [] };
    return { ok: false, error: 'occt-real: importSTEP unimplemented', warnings: [] };
  }

  // ─── dispatch ──────────────────────────────────────────────────────────

  function reply(msg) {
    self.postMessage(msg);
  }

  function makeShapePayload(reqId, res) {
    if (!res.ok) {
      reply({ reqId: reqId, ok: false, error: res.error, warnings: res.warnings || [] });
      return;
    }
    const shape = handles.get(res.handle);
    reply({
      reqId: reqId,
      ok: true,
      shape: shapeToWire(res.handle, shape, res.kind),
      warnings: res.warnings || [],
    });
  }

  function handleRequest(req) {
    const reqId = req.reqId;
    const op = req.op;
    const args = req.args || {};
    try {
      switch (op) {
        case 'init':
          // Block on the WASM instantiation. Bridge's initTimeoutMs is the
          // budget for this exact await.
          occtReady.then(
            function () { reply({ reqId: reqId, ok: true }); },
            function (err) { reply({ reqId: reqId, ok: false, error: 'occt-real init: ' + (err && err.message), warnings: [] }); }
          );
          return;

        case 'buildFromExtrude':
          makeShapePayload(reqId, buildFromExtrude(args.feature));
          return;

        case 'buildFromRevolve':
          makeShapePayload(reqId, buildFromRevolve(args.feature));
          return;

        case 'booleanUnion':
        case 'booleanSubtract':
        case 'booleanIntersect':
          makeShapePayload(reqId, booleanOp(op, args.handleA, args.handleB));
          return;

        case 'fillet':
        case 'chamfer':
          makeShapePayload(reqId, filletOrChamfer(op, args.handle, args.edgeIds || [], args.dim));
          return;

        case 'exportSTEP': {
          const r = exportSTEP(args.handle);
          if (!r.ok) { reply({ reqId: reqId, ok: false, error: r.error, warnings: r.warnings || [] }); return; }
          reply({ reqId: reqId, ok: true, step: r.step, warnings: r.warnings || [] });
          return;
        }

        case 'importSTEP':
          makeShapePayload(reqId, importSTEP(args.source));
          return;

        case 'release': {
          const h = typeof args.handle === 'number' ? args.handle : -1;
          freeHandle(h);
          reply({ reqId: reqId, ok: true });
          return;
        }

        default:
          reply({ reqId: reqId, ok: false, error: 'occt-real: unknown op: ' + String(op), warnings: [] });
          return;
      }
    } catch (err) {
      reply({ reqId: reqId, ok: false, error: (err && err.message) ? err.message : String(err), warnings: [] });
    }
  }

  self.onmessage = function (e) {
    const data = e && e.data;
    if (!data || typeof data.reqId !== 'number' || typeof data.op !== 'string') return;
    handleRequest(data);
  };
})();
