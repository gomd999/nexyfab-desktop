/**
 * occt-worker.js — Phase 4 *stub* Web Worker for the OCCT WASM bridge.
 *
 * NexyFab Pro own-CAD (ADR-013). This file is served at
 *   /occt-worker/occt-worker.js
 * and consumed by `src/lib/occt/wasmBridge.ts` (Agent-QQQ) when running in a
 * browser that has `globalThis.Worker` available. In Node/jsdom there is no
 * `Worker`, so the bridge falls back to the in-process `createWasmWorkerStub`
 * from `src/lib/occt/wasmWorkerStub.ts` — this file mirrors that stub's wire
 * protocol byte-for-byte so the bridge code is identical in both modes.
 *
 * STUB SCOPE
 * ----------
 * THERE IS NO REAL OCCT IN THIS FILE. Every kernel op fabricates a synthetic
 * `OcctShape` with:
 *   - `kind = 'solid'`
 *   - `bbox` derived from the input feature (extrude: 2D loop bbox × depth;
 *     revolve: full-revolve envelope around the canonical Y axis; boolean:
 *     element-wise union/intersection of input bboxes; fillet/chamfer: input
 *     bbox unchanged).
 *   - integer handle into a `Map<number, fakeShape>` held inside this worker.
 *
 * The bridge wraps the integer handle as `OcctShape.id = "occt_<handle>"`.
 * Consumers must treat the id as opaque — both the stub and the real OCCT
 * worker will satisfy that contract.
 *
 * THE PHASE 5 REAL BINARY GOES HERE
 * ---------------------------------
 * When OCCT 7.8 + Emscripten lands (see README.md in this directory):
 *   1. Build emits `occt.wasm` + `occt-bindings.js` alongside this worker.
 *   2. The top of this file does `importScripts('./occt-bindings.js')` and
 *      awaits `Module.ready`.
 *   3. The handle table maps integer → `TopoDS_Shape*`; `release` calls
 *      `Shape.delete()` to free OCCT-side memory.
 *   4. Every op below replaces its bbox synthesis with the corresponding
 *      OCCT call (BRepPrimAPI_MakePrism, BRepAlgoAPI_Fuse, BRepFilletAPI_*,
 *      STEPControl_Writer/Reader, …).
 *
 * WIRE PROTOCOL (must match wasmWorkerStub.ts)
 * --------------------------------------------
 *  Request:  { reqId, op, args }
 *  Response: { reqId, ok: true,  shape?, step?, warnings? }
 *         |  { reqId, ok: false, error,  warnings? }
 *
 *  Ops: init / buildFromExtrude / buildFromRevolve / booleanUnion /
 *       booleanSubtract / booleanIntersect / fillet / chamfer /
 *       exportSTEP / importSTEP / release
 *
 * EXECUTION ENVIRONMENT
 * ---------------------
 * `self` is a `DedicatedWorkerGlobalScope`. Browsers run this file in a
 * separate thread; there is no DOM, no `window`, no module imports beyond
 * `importScripts` (classic worker) or top-level `import` (module worker).
 * THIS FILE IS A CLASSIC WORKER — keep it ES2020 syntax with no top-level
 * imports so the same blob serves Chrome/Safari/Firefox without bundler
 * gymnastics. The real OCCT worker should stay classic too; Emscripten
 * output is designed for `importScripts`.
 */
/* global self */

(function () {
  'use strict';

  // ─── handle table ──────────────────────────────────────────────────────
  /**
   * Integer handle → fake-shape record. The bridge addresses shapes by the
   * integer; we keep the full snapshot (kind, bbox, metrics, originating
   * feature) so subsequent ops can echo / mutate it without re-shipping the
   * input across the wire.
   */
  var handles = new Map();
  var nextHandle = 1;

  function allocShape(record) {
    var h = nextHandle++;
    handles.set(h, record);
    return h;
  }

  function shapeToWire(handle, rec) {
    /** @returns {WireShapePayload} */
    return {
      handle: handle,
      kind: rec.kind,
      bbox: rec.bbox,
      volume: rec.volume,
      area: rec.area,
      centerOfMass: rec.centerOfMass,
    };
  }

  // ─── bbox helpers (mirror src/lib/occt/bridge.ts) ──────────────────────

  function bboxOfLoop2D(loop) {
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (var i = 0; i < loop.length; i++) {
      var p = loop[i];
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    return { minX: minX, maxX: maxX, minY: minY, maxY: maxY };
  }

  function cloneBBox(b) {
    if (!b) return undefined;
    return { min: { x: b.min.x, y: b.min.y, z: b.min.z }, max: { x: b.max.x, y: b.max.y, z: b.max.z } };
  }

  function bboxUnion(a, b) {
    if (!a) return cloneBBox(b);
    if (!b) return cloneBBox(a);
    return {
      min: { x: Math.min(a.min.x, b.min.x), y: Math.min(a.min.y, b.min.y), z: Math.min(a.min.z, b.min.z) },
      max: { x: Math.max(a.max.x, b.max.x), y: Math.max(a.max.y, b.max.y), z: Math.max(a.max.z, b.max.z) },
    };
  }

  function bboxIntersection(a, b) {
    if (!a || !b) return undefined;
    var min = {
      x: Math.max(a.min.x, b.min.x),
      y: Math.max(a.min.y, b.min.y),
      z: Math.max(a.min.z, b.min.z),
    };
    var max = {
      x: Math.min(a.max.x, b.max.x),
      y: Math.min(a.max.y, b.max.y),
      z: Math.min(a.max.z, b.max.z),
    };
    if (min.x > max.x || min.y > max.y || min.z > max.z) return undefined;
    return { min: min, max: max };
  }

  // ─── feature → shape (stub geometry) ───────────────────────────────────

  /** Synthesize a stub shape record for an extrude feature. */
  function buildExtrudeShape(feature) {
    if (!feature || feature.kind !== 'extrude') {
      return { ok: false, error: "expected kind='extrude', got '" + (feature && feature.kind) + "'" };
    }
    if (!Array.isArray(feature.loop) || feature.loop.length < 3) {
      return { ok: false, error: 'extrude loop must have ≥3 points, got ' + (feature.loop ? feature.loop.length : 0) };
    }
    if (!(feature.depth > 0) || !isFinite(feature.depth)) {
      return { ok: false, error: 'extrude depth must be positive finite, got ' + feature.depth };
    }
    var b2 = bboxOfLoop2D(feature.loop);
    var z0 = 0, z1 = feature.depth;
    if (feature.direction === 'midplane') { z0 = -feature.depth / 2; z1 = feature.depth / 2; }
    else if (feature.direction === 'two_sided') { z0 = -feature.depth; z1 = feature.depth; }
    return {
      ok: true,
      record: {
        kind: 'solid',
        bbox: { min: { x: b2.minX, y: b2.minY, z: z0 }, max: { x: b2.maxX, y: b2.maxY, z: z1 } },
        feature: feature,
      },
      warnings: ['stub: synthetic bbox; no real BREP'],
    };
  }

  /** Synthesize a stub shape record for a revolve feature (canonical +Y axis). */
  function buildRevolveShape(feature) {
    if (!feature || feature.kind !== 'revolve') {
      return { ok: false, error: "expected kind='revolve', got '" + (feature && feature.kind) + "'" };
    }
    if (!Array.isArray(feature.loop) || feature.loop.length < 3) {
      return { ok: false, error: 'revolve loop must have ≥3 points, got ' + (feature.loop ? feature.loop.length : 0) };
    }
    var rMax = 0, yMin = Infinity, yMax = -Infinity;
    for (var i = 0; i < feature.loop.length; i++) {
      var p = feature.loop[i];
      if (p.x > rMax) rMax = p.x;
      if (p.y < yMin) yMin = p.y;
      if (p.y > yMax) yMax = p.y;
    }
    var warnings = ['stub: synthetic bbox; no real BREP'];
    if (typeof feature.angleDegrees === 'number' && feature.angleDegrees < 360) {
      warnings.push('stub: partial sweep ' + feature.angleDegrees + '° uses full-revolve envelope');
    }
    return {
      ok: true,
      record: {
        kind: 'solid',
        bbox: { min: { x: -rMax, y: yMin, z: -rMax }, max: { x: rMax, y: yMax, z: rMax } },
        feature: feature,
      },
      warnings: warnings,
    };
  }

  // ─── STEP I/O (stub: deterministic ISO-10303-21 envelope only) ─────────

  /**
   * Emit a minimal ISO-10303-21 envelope. Phase 5 swap: replace with
   * STEPControl_Writer over the live TopoDS_Shape.
   */
  function emitStepEnvelope() {
    // record arg reserved for Phase 5 when STEPControl_Writer needs TopoDS_Shape*.
    var name = 'nxf_stub_shape';
    var ts = '2026-06-02T00:00:00Z';
    return [
      'ISO-10303-21;',
      'HEADER;',
      "FILE_DESCRIPTION(('NexyFab OCCT stub export'),'2;1');",
      "FILE_NAME('" + name + "','" + ts + "',(''),(''),'NexyFab stub','NexyFab','');",
      "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));",
      'ENDSEC;',
      'DATA;',
      "#1 = PRODUCT('" + name + "','" + name + "','',(#2));",
      "#2 = PRODUCT_CONTEXT('',#3,'mechanical');",
      "#3 = APPLICATION_CONTEXT('automotive_design');",
      'ENDSEC;',
      'END-ISO-10303-21;',
      '',
    ].join('\n');
  }

  /**
   * Stub STEP parser — recognises the envelope shape this stub emits and
   * returns a 10×10×10 box record. Anything else fails. Phase 5 swap:
   * STEPControl_Reader → TopoDS_Shape → handle.
   */
  function parseStepStub(source) {
    if (typeof source !== 'string' || source.length === 0) {
      return { ok: false, error: 'importSTEP: empty source' };
    }
    if (source.indexOf('ISO-10303-21') < 0) {
      return { ok: false, error: 'importSTEP: not an ISO-10303-21 file' };
    }
    return {
      ok: true,
      record: {
        kind: 'solid',
        bbox: { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 10, z: 10 } },
        feature: undefined,
      },
      warnings: ['stub: imported envelope mapped to 10x10x10 box'],
    };
  }

  // ─── tessellation (stub: axis-aligned box from the tracked bbox) ─────────

  /**
   * Build viewer buffers (OcctTessellation) for a record's bounding box: a
   * flat-shaded 12-triangle box + its 12 feature edges + framing bounds. The
   * stub has no real B-rep, so it draws the envelope. Phase 5 swap: tessellate
   * the live TopoDS_Shape with BRepMesh and extract triangulation.
   */
  function tessellateBoxFromBbox(bbox) {
    var lo = bbox.min, hi = bbox.max;
    var x0 = lo.x, y0 = lo.y, z0 = lo.z, x1 = hi.x, y1 = hi.y, z1 = hi.z;
    var v = [
      [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
      [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
    ];
    // [a,b,c, normal] per triangle (CCW seen from outside).
    var tris = [
      [0, 3, 2, [0, 0, -1]], [0, 2, 1, [0, 0, -1]], // bottom
      [4, 5, 6, [0, 0, 1]], [4, 6, 7, [0, 0, 1]],   // top
      [0, 1, 5, [0, -1, 0]], [0, 5, 4, [0, -1, 0]], // -Y
      [3, 7, 6, [0, 1, 0]], [3, 6, 2, [0, 1, 0]],   // +Y
      [0, 4, 7, [-1, 0, 0]], [0, 7, 3, [-1, 0, 0]], // -X
      [1, 2, 6, [1, 0, 0]], [1, 6, 5, [1, 0, 0]],   // +X
    ];
    var positions = [];
    var normals = [];
    for (var t = 0; t < tris.length; t++) {
      var tri = tris[t];
      for (var k = 0; k < 3; k++) {
        var p = v[tri[k]];
        positions.push(p[0], p[1], p[2]);
        normals.push(tri[3][0], tri[3][1], tri[3][2]);
      }
    }
    var edgePairs = [
      [0, 1], [1, 2], [2, 3], [3, 0],
      [4, 5], [5, 6], [6, 7], [7, 4],
      [0, 4], [1, 5], [2, 6], [3, 7],
    ];
    var edges = [];
    for (var e = 0; e < edgePairs.length; e++) {
      var a = v[edgePairs[e][0]], b = v[edgePairs[e][1]];
      edges.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    }
    var sx = x1 - x0, sy = y1 - y0, sz = z1 - z0;
    return {
      positions: positions,
      normals: normals,
      edges: edges,
      triangleCount: tris.length,
      edgeCount: edgePairs.length,
      bounds: {
        center: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2],
        size: [sx, sy, sz],
        radius: 0.5 * Math.sqrt(sx * sx + sy * sy + sz * sz),
      },
    };
  }

  // ─── dispatch ──────────────────────────────────────────────────────────

  function reply(msg) {
    self.postMessage(msg);
  }

  function resolveHandle(h) {
    if (typeof h !== 'number') return undefined;
    return handles.get(h);
  }

  function handleRequest(req) {
    var reqId = req.reqId;
    var op = req.op;
    var args = req.args || {};
    try {
      switch (op) {
        case 'init':
          // Real OCCT swap: await Module.ready BEFORE this postMessage.
          reply({ reqId: reqId, ok: true });
          return;

        case 'buildFromExtrude': {
          var ex = buildExtrudeShape(args.feature);
          if (!ex.ok) { reply({ reqId: reqId, ok: false, error: ex.error, warnings: [] }); return; }
          var hEx = allocShape(ex.record);
          reply({ reqId: reqId, ok: true, shape: shapeToWire(hEx, ex.record), warnings: ex.warnings });
          return;
        }

        case 'buildFromRevolve': {
          var rv = buildRevolveShape(args.feature);
          if (!rv.ok) { reply({ reqId: reqId, ok: false, error: rv.error, warnings: [] }); return; }
          var hRv = allocShape(rv.record);
          reply({ reqId: reqId, ok: true, shape: shapeToWire(hRv, rv.record), warnings: rv.warnings });
          return;
        }

        case 'booleanUnion':
        case 'booleanSubtract':
        case 'booleanIntersect': {
          var a = resolveHandle(args.handleA);
          var b = resolveHandle(args.handleB);
          if (!a || !b) {
            reply({ reqId: reqId, ok: false, error: op + ': unknown handle (a=' + args.handleA + ', b=' + args.handleB + ')', warnings: [] });
            return;
          }
          var resultBbox;
          var note;
          if (op === 'booleanUnion') {
            resultBbox = bboxUnion(a.bbox, b.bbox);
            note = 'stub: bbox-only union';
          } else if (op === 'booleanSubtract') {
            // Stub cannot subtract geometry — return A's envelope unchanged.
            resultBbox = cloneBBox(a.bbox);
            note = 'stub: no real cut; A bbox preserved';
          } else {
            resultBbox = bboxIntersection(a.bbox, b.bbox);
            note = 'stub: bbox-only intersect';
            if (!resultBbox) {
              reply({ reqId: reqId, ok: false, error: 'intersect: bbox disjoint (stub: no overlap)', warnings: [note] });
              return;
            }
          }
          var rec = { kind: 'solid', bbox: resultBbox, feature: undefined };
          var h = allocShape(rec);
          reply({ reqId: reqId, ok: true, shape: shapeToWire(h, rec), warnings: [note] });
          return;
        }

        case 'fillet':
        case 'chamfer': {
          var src = resolveHandle(args.handle);
          if (!src) {
            reply({ reqId: reqId, ok: false, error: op + ': unknown handle (' + args.handle + ')', warnings: [] });
            return;
          }
          var dim = typeof args.dim === 'number' ? args.dim : NaN;
          if (!(dim > 0) || !isFinite(dim)) {
            reply({ reqId: reqId, ok: false, error: op + ' ' + (op === 'fillet' ? 'radius' : 'distance') + ' must be positive finite, got ' + dim, warnings: [] });
            return;
          }
          var edgeIds = Array.isArray(args.edgeIds) ? args.edgeIds : [];
          // Pass-through: clone bbox + inherit originating feature so STEP
          // export still works post-fillet (mirrors the stub bridge).
          var rec2 = { kind: src.kind, bbox: cloneBBox(src.bbox), feature: src.feature };
          var h2 = allocShape(rec2);
          var w = op === 'fillet'
            ? 'stub: no actual fillet (radius=' + dim + ', edges=' + edgeIds.length + ')'
            : 'stub: no actual chamfer (distance=' + dim + ', edges=' + edgeIds.length + ')';
          reply({ reqId: reqId, ok: true, shape: shapeToWire(h2, rec2), warnings: [w] });
          return;
        }

        case 'exportSTEP': {
          var rec3 = resolveHandle(args.handle);
          if (!rec3) {
            reply({ reqId: reqId, ok: false, error: 'exportSTEP: unknown handle (' + args.handle + ')', warnings: [] });
            return;
          }
          reply({ reqId: reqId, ok: true, step: emitStepEnvelope(rec3), warnings: ['stub: STEP envelope only; no BREP geometry'] });
          return;
        }

        case 'importSTEP': {
          var parsed = parseStepStub(args.source);
          if (!parsed.ok) { reply({ reqId: reqId, ok: false, error: parsed.error, warnings: [] }); return; }
          var h3 = allocShape(parsed.record);
          reply({ reqId: reqId, ok: true, shape: shapeToWire(h3, parsed.record), warnings: parsed.warnings });
          return;
        }

        case 'tessellate': {
          var recT = resolveHandle(args.handle);
          if (!recT) {
            reply({ reqId: reqId, ok: false, error: 'tessellate: unknown handle (' + args.handle + ')', warnings: [] });
            return;
          }
          reply({ reqId: reqId, ok: true, mesh: tessellateBoxFromBbox(recT.bbox), warnings: ['stub: bbox box mesh; no BREP tessellation'] });
          return;
        }

        case 'release': {
          var hr = typeof args.handle === 'number' ? args.handle : -1;
          handles.delete(hr);
          reply({ reqId: reqId, ok: true });
          return;
        }

        default:
          reply({ reqId: reqId, ok: false, error: 'unknown op: ' + String(op), warnings: [] });
          return;
      }
    } catch (err) {
      reply({ reqId: reqId, ok: false, error: (err && err.message) ? err.message : String(err), warnings: [] });
    }
  }

  self.onmessage = function (e) {
    var data = e && e.data;
    if (!data || typeof data.reqId !== 'number' || typeof data.op !== 'string') {
      // Protocol violation — we have no reqId to echo, so drop silently.
      return;
    }
    handleRequest(data);
  };
})();
