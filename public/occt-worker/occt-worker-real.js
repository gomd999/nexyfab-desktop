/**
 * occt-worker-real.js — Phase 5 real OCCT WASM dispatcher (ACTIVATED).
 *
 * NexyFab Pro own-CAD (ADR-013). Phase 5 launch step 9 (Agent — activation).
 *
 * STATE
 * -----
 * The OCCT call sites are now LIVE. The dispatcher:
 *   1. Tries `importScripts('./opencascade.js')` so the Emscripten factory
 *      lands on `self.Module` (or `globalThis.Module`).
 *   2. Calls `Module({ locateFile })` and awaits the returned promise. The
 *      resolved value is the Embind module — kept in `occt`.
 *   3. If either step fails, the worker enters "failed" mode and emits
 *      `{ event: 'mode', mode: 'failed', reason }` so the parent can detect.
 *      Every kernel op then replies `ok:false`.
 *   4. The 11 wire ops (`init` / `buildFromExtrude` / ... / `release`) map
 *      1:1 onto the OCCT call sites documented in PHASE_5_INTEGRATION.md §2.
 *
 * TEST SEAMS
 * ----------
 * Vitest cannot run `importScripts` and cannot fetch `opencascade.wasm`. To
 * keep the dispatcher exercisable from `wasmRealActivation.test.ts` we honour
 * an optional `self.__OCCT_TEST_MODULE_FACTORY__` hook:
 *   - If present, it MUST be a function returning a Promise<EmbindModule>.
 *   - The dispatcher uses it INSTEAD OF `importScripts` + `Module()`.
 *   - On the real worker this hook is undefined, so the production path runs.
 *
 * WIRE PROTOCOL — identical to occt-worker.js / wasmWorkerStub.ts. Do NOT
 * drift the envelope; the bridge does not branch on stub vs real.
 *
 * DISPOSE DISCIPLINE
 * ------------------
 * OCCT objects live in the Emscripten heap and require an explicit `.delete()`.
 * Every `new occt.X(...)` below is paired with a `delete()` inside a
 * `try { ... } finally { x.delete(); }` so partial failures still free the heap.
 * The result shape returned to the caller is NOT deleted — the worker's
 * handle table owns it until a `release` op fires.
 */
/* global self, importScripts, Module */

(function () {
  'use strict';

  // ─── OCCT module bootstrap ─────────────────────────────────────────────

  /** @type {any} OCCT Embind module. `null` until init resolves. */
  let occt = null;
  /** @type {'pending'|'ready'|'failed'} */
  let mode = 'pending';
  /** @type {string} */
  let modeReason = '';

  function setMode(next, reason) {
    mode = next;
    modeReason = reason || '';
    try {
      self.postMessage({ event: 'mode', mode: next, reason: modeReason });
    } catch (_e) {
      // Worker scope may not have postMessage in some test sandboxes — fine.
      void _e;
    }
  }

  /**
   * Resolve the Emscripten factory function. Order:
   *   1. self.__OCCT_TEST_MODULE_FACTORY__ — test seam (returns Promise<module>)
   *   2. importScripts('./opencascade.js') → self.Module
   */
  function resolveModuleFactory() {
    if (typeof self.__OCCT_TEST_MODULE_FACTORY__ === 'function') {
      return { factory: self.__OCCT_TEST_MODULE_FACTORY__, source: 'test-seam' };
    }
    if (typeof importScripts !== 'function') {
      return { factory: null, source: 'no-importScripts', error: 'importScripts not available in this worker scope' };
    }
    try {
      importScripts('./opencascade.js');
    } catch (err) {
      return { factory: null, source: 'importScripts-failed', error: (err && err.message) ? err.message : String(err) };
    }
    // Emscripten exports the factory on `Module` (or `self.Module`).
    var factory = (typeof Module !== 'undefined' ? Module : null) || self.Module;
    if (typeof factory !== 'function') {
      return { factory: null, source: 'no-Module', error: 'opencascade.js did not expose a Module factory' };
    }
    return { factory: factory, source: 'production' };
  }

  /** @type {Promise<void>} */
  const occtReady = (function bootOcct() {
    const resolved = resolveModuleFactory();
    if (!resolved.factory) {
      setMode('failed', 'occt-real: ' + (resolved.error || resolved.source));
      // Return a rejected promise so init op surfaces the failure. Attach
      // a swallow handler to avoid host-side unhandled-rejection noise.
      var pReject = Promise.reject(new Error(resolved.error || resolved.source));
      pReject.catch(function () { /* surfaced via mode:'failed' */ });
      return pReject;
    }
    var factoryPromise;
    try {
      factoryPromise = resolved.factory({
        locateFile: function (p) {
          // The npm loader bakes `wasmBinaryFile="opencascade.wasm.wasm"`, but
          // copy-occt serves the binary as `opencascade.wasm` (inner `.wasm`
          // segment dropped). Map ANY opencascade wasm request to the served
          // name, relative to the worker scope (`/occt-worker/`). Matching only
          // the exact string `opencascade.wasm` missed the real request and
          // fetched a 404 → "WebAssembly.instantiate expected 4 bytes".
          return (typeof p === 'string' && p.indexOf('opencascade.wasm') !== -1)
            ? './opencascade.wasm'
            : p;
        },
      });
    } catch (err) {
      setMode('failed', 'occt-real: factory threw: ' + (err && err.message));
      var pErr = Promise.reject(err);
      pErr.catch(function () { /* surfaced via mode:'failed' */ });
      return pErr;
    }
    const p = Promise.resolve(factoryPromise).then(
      function (mod) {
        occt = mod;
        setMode('ready', '');
      },
      function (err) {
        setMode('failed', 'occt-real: Module() rejected: ' + (err && err.message));
        throw err;
      },
    );
    // Attach a swallow handler so an init-time rejection (factory throw /
    // Module reject) does not surface as an unhandled rejection in the host.
    // The `init` op gets its own .then chain in handleRequest and still sees
    // the rejection — we're just hiding it from the global handler.
    p.catch(function () { /* surfaced via mode:'failed' postMessage */ });
    return p;
  })();

  // ─── handle table: integer ↔ TopoDS_Shape ──────────────────────────────
  /** @type {Map<number, any>} */
  const handles = new Map();
  const edgeTopos = new Map();
  const faceTopos = new Map();
  let nextHandle = 1;

  function alloc(shape, edgeTopo, faceTopo) {
    const h = nextHandle++;
    handles.set(h, shape);
    if (edgeTopo && edgeTopo.size) edgeTopos.set(h, edgeTopo);
    if (faceTopo && faceTopo.length) faceTopos.set(h, faceTopo);
    return h;
  }

  function freeHandle(h) {
    const s = handles.get(h);
    if (!s) return false;
    try {
      if (s && typeof s.delete === 'function') s.delete();
    } catch (_e) {
      void _e;
    }
    handles.delete(h);
    edgeTopos.delete(h);
    var faces = faceTopos.get(h) || [];
    for (var i = 0; i < faces.length; i++) {
      if (faces[i].face && typeof faces[i].face.delete === 'function') faces[i].face.delete();
    }
    faceTopos.delete(h);
    return true;
  }

  // ─── geometry helpers ──────────────────────────────────────────────────

  /**
   * Compute bbox + mass props via OCCT. Wrapped in try/catch because not all
   * shapes are eligible for VolumeProperties (e.g. wires).
   * Returns synthesised zeros if anything throws.
   */
  function shapeMetrics(shape) {
    var out = {
      bbox: { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } },
      volume: 0,
      area: 0,
      centerOfMass: { x: 0, y: 0, z: 0 },
    };
    if (!occt || !shape) return out;
    // Try the full OCCT path; if any required symbol is missing fall back to
    // whatever the shape carries (stub modules tag bbox/volume/area on the
    // shape object directly — matches `_vendor/opencascade.stub.ts`).
    // opencascade.js exposes overloaded ctors/statics with numeric embind
    // suffixes in this build (Bnd_Box_2, GProp_GProps_1, VolumeProperties_1, …);
    // the un-suffixed names are ABSENT. The previous code only probed the
    // un-suffixed names, so bbox/volume/area were silently never computed —
    // which made `thicken` (gated on a non-zero volume) always report
    // "no solid". Resolve the suffixed variants (matching the proven
    // ceilingSpike) with un-suffixed fallbacks, each section isolated so one
    // missing API can't blank the others.
    try {
    var BndCtor = occt.Bnd_Box_1 || occt.Bnd_Box;
    var BndLib = occt.BRepBndLib;
    var addFn = BndLib && (BndLib.Add_2 || BndLib.Add_1 || BndLib.Add);
    if (typeof BndCtor === 'function' && typeof addFn === 'function') {
      var bnd = new BndCtor();
      try {
        try { BndLib.Add_2 ? BndLib.Add_2(shape, bnd, true) : (BndLib.Add_1 ? BndLib.Add_1(shape, bnd) : BndLib.Add(shape, bnd, true)); }
        catch (_a) { void _a; }
        var min = bnd.CornerMin();
        var max = bnd.CornerMax();
        out.bbox = {
          min: { x: min.X(), y: min.Y(), z: min.Z() },
          max: { x: max.X(), y: max.Y(), z: max.Z() },
        };
        if (typeof min.delete === 'function') min.delete();
        if (typeof max.delete === 'function') max.delete();
      } finally {
        if (typeof bnd.delete === 'function') bnd.delete();
      }
    } else if (shape.bbox) {
      out.bbox = shape.bbox;
    }

    var GPropCtor = occt.GProp_GProps_1 || occt.GProp_GProps;
    var BG = occt.BRepGProp;
    if (typeof GPropCtor === 'function' && BG) {
      var volFn1 = BG.VolumeProperties_1;
      var volFn = volFn1 || BG.VolumeProperties;
      if (typeof volFn === 'function') {
        var vp = new GPropCtor();
        try {
          // VolumeProperties_1(shape, props, onlyClosed, skipShared, useTriangulation)
          if (volFn1) BG.VolumeProperties_1(shape, vp, false, false, false);
          else BG.VolumeProperties(shape, vp);
          out.volume = vp.Mass();
          var com = vp.CentreOfMass();
          out.centerOfMass = { x: com.X(), y: com.Y(), z: com.Z() };
          if (typeof com.delete === 'function') com.delete();
        } catch (_v) { void _v; } finally {
          if (typeof vp.delete === 'function') vp.delete();
        }
      }
      var surfFn1 = BG.SurfaceProperties_1;
      var surfFn = surfFn1 || BG.SurfaceProperties;
      if (typeof surfFn === 'function') {
        var sp = new GPropCtor();
        try {
          if (surfFn1) BG.SurfaceProperties_1(shape, sp, false, false);
          else BG.SurfaceProperties(shape, sp);
          out.area = sp.Mass();
        } catch (_s) { void _s; } finally {
          if (typeof sp.delete === 'function') sp.delete();
        }
      }
    } else {
      if (typeof shape.volume === 'number') out.volume = shape.volume;
      if (typeof shape.area === 'number') out.area = shape.area;
      if (shape.centerOfMass) out.centerOfMass = shape.centerOfMass;
    }
    } catch (_e) {
      void _e;
      // Last-ditch: copy whatever the shape carries.
      if (shape.bbox) out.bbox = shape.bbox;
      if (typeof shape.volume === 'number') out.volume = shape.volume;
      if (typeof shape.area === 'number') out.area = shape.area;
      if (shape.centerOfMass) out.centerOfMass = shape.centerOfMass;
    }
    return out;
  }

  function shapeToWire(handle, shape, kind) {
    const m = shapeMetrics(shape);
    return {
      handle: handle,
      kind: kind || 'solid',
      bbox: m.bbox,
      volume: m.volume,
      area: m.area,
      centerOfMass: m.centerOfMass,
    };
  }

  function notReady() {
    return { ok: false, error: 'occt-real: not ready (' + mode + ': ' + modeReason + ')', warnings: [] };
  }

  function extrudeEdgeTopo(loop, z0, z1) {
    var topo = new Map();
    for (var i = 0; i < loop.length; i++) {
      var j = (i + 1) % loop.length, lo = Math.min(i, j), hi = Math.max(i, j);
      var a = loop[i], b = loop[j];
      topo.set('e.bottom.' + lo + '-' + hi, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: z0 });
      topo.set('e.top.' + lo + '-' + hi, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: z1 });
      topo.set('e.vert.' + i, { x: a.x, y: a.y, z: (z0 + z1) / 2 });
    }
    return topo;
  }

  function rotateRevolvePoint(p, angleDeg) {
    var angle = angleDeg * Math.PI / 180;
    return { x: p.x * Math.cos(angle), y: p.y, z: -p.x * Math.sin(angle) };
  }

  function revolveEdgeTopo(profile, angleDegrees) {
    var topo = new Map(), eps = 1e-9, full = angleDegrees >= 360 - eps;
    for (var i = 0; i < profile.length; i++) {
      var p = profile[i];
      if (Math.abs(p.x) > eps) topo.set('e.lat.' + i, rotateRevolvePoint(p, full ? 180 : angleDegrees / 2));
    }
    for (var e = 0; e < profile.length; e++) {
      var j = (e + 1) % profile.length, a = profile[e], b = profile[j];
      var bothOnAxis = Math.abs(a.x) <= eps && Math.abs(b.x) <= eps;
      var mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (bothOnAxis) {
        if (!full) topo.set('e.axis.' + e, { x: 0, y: mid.y, z: 0 });
      } else if (full) {
        if (Math.abs(a.y - b.y) > eps) topo.set('e.seam.' + e, { x: mid.x, y: mid.y, z: 0 });
      } else {
        topo.set('e.mer.start.' + e, { x: mid.x, y: mid.y, z: 0 });
        topo.set('e.mer.end.' + e, rotateRevolvePoint(mid, angleDegrees));
      }
    }
    return topo;
  }

  function uniqueEdgeMidpoints(shape) {
    var Exp = occt && (occt.TopExp_Explorer_2 || occt.TopExp_Explorer);
    var Curve = occt && (occt.BRepAdaptor_Curve_2 || occt.BRepAdaptor_Curve);
    var topoDS = occt && occt.TopoDS, enums = occt && occt.TopAbs_ShapeEnum;
    if (!Exp || !Curve || !topoDS || typeof topoDS.Edge_1 !== 'function' || !enums) return [];
    var exp = null, out = [], seen = new Set();
    try {
      exp = new Exp(shape, enums.TopAbs_EDGE, enums.TopAbs_SHAPE);
      while (exp.More()) {
        var edge = topoDS.Edge_1(exp.Current()), curve = new Curve(edge);
        try {
          var p = curve.Value((curve.FirstParameter() + curve.LastParameter()) / 2);
          var mid = { x: p.X(), y: p.Y(), z: p.Z() };
          var key = Math.round(mid.x * 1000) + ',' + Math.round(mid.y * 1000) + ',' + Math.round(mid.z * 1000);
          if (!seen.has(key)) { seen.add(key); out.push({ edge: edge, mid: mid }); }
          if (p && typeof p.delete === 'function') p.delete();
        } finally { if (curve && typeof curve.delete === 'function') curve.delete(); }
        exp.Next();
      }
    } finally { if (exp && typeof exp.delete === 'function') exp.delete(); }
    return out;
  }

  function faceCentroid(face) {
    var Props = occt && (occt.GProp_GProps_1 || occt.GProp_GProps);
    var fn = occt && occt.BRepGProp && (occt.BRepGProp.SurfaceProperties_1 || occt.BRepGProp.SurfaceProperties);
    if (!Props || !fn) return null;
    var props = null, p = null;
    try {
      props = new Props();
      if (occt.BRepGProp.SurfaceProperties_1) occt.BRepGProp.SurfaceProperties_1(face, props, false, false);
      else occt.BRepGProp.SurfaceProperties(face, props);
      p = props.CentreOfMass();
      return { x: p.X(), y: p.Y(), z: p.Z() };
    } catch (_e) { return null; }
    finally {
      if (p && typeof p.delete === 'function') p.delete();
      if (props && typeof props.delete === 'function') props.delete();
    }
  }

  function classifyExtrudeFaces(shape, loop, z0, z1) {
    var Exp = occt && (occt.TopExp_Explorer_2 || occt.TopExp_Explorer);
    var topoDS = occt && occt.TopoDS, enums = occt && occt.TopAbs_ShapeEnum;
    if (!Exp || !topoDS || typeof topoDS.Face_1 !== 'function' || !enums) return [];
    var exp = null, candidates = [], counts = new Map(), zMid = (z0 + z1) / 2, tol = 1e-4;
    try {
      exp = new Exp(shape, enums.TopAbs_FACE, enums.TopAbs_SHAPE);
      while (exp.More()) {
        var face = topoDS.Face_1(exp.Current()), c = faceCentroid(face), name = null;
        if (c && Math.abs(c.z - z0) <= tol) name = 'f.cap.bottom';
        else if (c && Math.abs(c.z - z1) <= tol) name = 'f.cap.top';
        else if (c && Math.abs(c.z - zMid) <= tol) {
          var best = -1, bestDist = Infinity, second = Infinity;
          for (var i = 0; i < loop.length; i++) {
            var q = loop[(i + 1) % loop.length];
            var d = Math.hypot(c.x - (loop[i].x + q.x) / 2, c.y - (loop[i].y + q.y) / 2);
            if (d < bestDist) { second = bestDist; bestDist = d; best = i; }
            else if (d < second) second = d;
          }
          if (bestDist <= tol && second > tol) name = 'f.side.' + best;
        }
        if (name) { candidates.push({ face: face, name: name }); counts.set(name, (counts.get(name) || 0) + 1); }
        else if (face && typeof face.delete === 'function') face.delete();
        exp.Next();
      }
    } finally { if (exp && typeof exp.delete === 'function') exp.delete(); }
    return candidates.filter(function (entry) {
      if (counts.get(entry.name) === 1) return true;
      if (entry.face && typeof entry.face.delete === 'function') entry.face.delete();
      return false;
    });
  }

  function listToShapes(list) {
    var List = occt && occt.TopTools_ListOfShape_1;
    if (!List) return [];
    var copy = new List(), out = [];
    try {
      copy.Assign(list);
      while (copy.Size() > 0) { out.push(copy.First_1()); copy.RemoveFirst(); }
      return out;
    } finally { if (copy && typeof copy.delete === 'function') copy.delete(); }
  }

  function uniqueFaces(shape) {
    var Exp = occt && (occt.TopExp_Explorer_2 || occt.TopExp_Explorer);
    var topoDS = occt && occt.TopoDS, enums = occt && occt.TopAbs_ShapeEnum;
    if (!Exp || !topoDS || typeof topoDS.Face_1 !== 'function' || !enums) return [];
    var exp = null, out = [];
    try {
      exp = new Exp(shape, enums.TopAbs_FACE, enums.TopAbs_SHAPE);
      while (exp.More()) {
        var face = topoDS.Face_1(exp.Current()), duplicate = false;
        for (var i = 0; i < out.length; i++) {
          try { if (out[i].IsSame(face)) { duplicate = true; break; } } catch (_e) { void _e; }
        }
        if (duplicate && face && typeof face.delete === 'function') face.delete();
        else out.push(face);
        exp.Next();
      }
    } finally { if (exp && typeof exp.delete === 'function') exp.delete(); }
    return out;
  }

  function propagatedBooleanFaces(algo, resultShape, operands) {
    var resultFaces = uniqueFaces(resultShape);
    var candidates = resultFaces.map(function () { return new Set(); });
    for (var o = 0; o < operands.length; o++) {
      var faces = faceTopos.get(operands[o].handle) || [];
      for (var f = 0; f < faces.length; f++) {
        var qualified = operands[o].prefix ? operands[o].prefix + '/' + faces[f].name : faces[f].name;
        try { if (typeof algo.IsDeleted === 'function' && algo.IsDeleted(faces[f].face)) continue; }
        catch (_deletedError) { void _deletedError; }
        for (var i = 0; i < resultFaces.length; i++) {
          try { if (resultFaces[i].IsSame(faces[f].face)) candidates[i].add(qualified); }
          catch (_sameError) { void _sameError; }
        }
        var modified = [];
        try { modified = listToShapes(algo.Modified(faces[f].face)); }
        catch (_modifiedError) { continue; }
        for (var m = 0; m < modified.length; m++) {
          for (var r = 0; r < resultFaces.length; r++) {
            try { if (resultFaces[r].IsSame(modified[m])) candidates[r].add(qualified); }
            catch (_matchError) { void _matchError; }
          }
          if (modified[m] && typeof modified[m].delete === 'function') modified[m].delete();
        }
      }
    }
    var out = [];
    for (var n = 0; n < resultFaces.length; n++) {
      if (candidates[n].size === 1) out.push({ face: resultFaces[n], name: Array.from(candidates[n])[0] });
      else if (resultFaces[n] && typeof resultFaces[n].delete === 'function') resultFaces[n].delete();
    }
    return out;
  }

  function classifyRevolveFaces(builder, wire, resultShape, profile, angleDegrees) {
    var resultFaces = uniqueFaces(resultShape);
    var candidates = resultFaces.map(function () { return new Set(); });
    var sourceEdges = uniqueEdgeMidpoints(wire), tol = 1e-4;
    for (var i = 0; i < profile.length; i++) {
      var q = profile[(i + 1) % profile.length];
      var anchor = { x: (profile[i].x + q.x) / 2, y: (profile[i].y + q.y) / 2, z: 0 };
      var best = -1, distance = Infinity;
      for (var e = 0; e < sourceEdges.length; e++) {
        var d = Math.hypot(
          sourceEdges[e].mid.x - anchor.x,
          sourceEdges[e].mid.y - anchor.y,
          sourceEdges[e].mid.z - anchor.z
        );
        if (d < distance) { best = e; distance = d; }
      }
      if (best < 0 || distance > tol || typeof builder.Generated !== 'function') continue;
      var generated = [];
      try { generated = listToShapes(builder.Generated(sourceEdges[best].edge)); }
      catch (_generatedError) { continue; }
      for (var g = 0; g < generated.length; g++) {
        for (var r = 0; r < resultFaces.length; r++) {
          try { if (resultFaces[r].IsSame(generated[g])) candidates[r].add('f.profile.' + i); }
          catch (_sameError) { void _sameError; }
        }
        if (generated[g] && typeof generated[g].delete === 'function') generated[g].delete();
      }
    }
    for (var s = 0; s < sourceEdges.length; s++) {
      if (sourceEdges[s].edge && typeof sourceEdges[s].edge.delete === 'function') sourceEdges[s].edge.delete();
    }
    if (angleDegrees < 360 - 1e-9) {
      var caps = [
        { method: 'FirstShape', name: 'f.cap.start' },
        { method: 'LastShape', name: 'f.cap.end' }
      ];
      for (var c = 0; c < caps.length; c++) {
        if (typeof builder[caps[c].method] !== 'function') continue;
        var cap = null;
        try {
          cap = builder[caps[c].method]();
          for (var k = 0; k < resultFaces.length; k++) {
            try { if (resultFaces[k].IsSame(cap)) candidates[k].add(caps[c].name); }
            catch (_capMatchError) { void _capMatchError; }
          }
        } catch (_capError) { void _capError; }
        finally { if (cap && typeof cap.delete === 'function') cap.delete(); }
      }
    }
    var out = [];
    for (var n = 0; n < resultFaces.length; n++) {
      if (candidates[n].size === 1) out.push({ face: resultFaces[n], name: Array.from(candidates[n])[0] });
      else if (resultFaces[n] && typeof resultFaces[n].delete === 'function') resultFaces[n].delete();
    }
    return out;
  }

  function booleanSeamTopo(op, algo, resultEdges, operands) {
    var generatedBy = resultEdges.map(function () { return new Set(); });
    for (var o = 0; o < operands.length; o++) {
      var faces = faceTopos.get(operands[o].handle) || [];
      for (var f = 0; f < faces.length; f++) {
        var generated = [];
        try { generated = listToShapes(algo.Generated(faces[f].face)); } catch (_e) { continue; }
        for (var g = 0; g < generated.length; g++) {
          for (var e = 0; e < resultEdges.length; e++) {
            try {
              if (resultEdges[e].edge.IsSame(generated[g])) generatedBy[e].add(operands[o].prefix + '/' + faces[f].name);
            } catch (_sameError) { void _sameError; }
          }
          if (generated[g] && typeof generated[g].delete === 'function') generated[g].delete();
        }
      }
    }
    var out = new Map();
    for (var i = 0; i < generatedBy.length; i++) {
      if (generatedBy[i].size < 2) continue;
      var pair = Array.from(generatedBy[i]).sort().join('&');
      out.set(op + '/seam(' + pair + ')', resultEdges[i].mid);
    }
    return out;
  }

  function roundedFaceTopo(op, algo, resultShape, sourceHandle, edgeIds, pickedEdges) {
    var resultFaces = uniqueFaces(resultShape);
    var candidates = resultFaces.map(function () { return new Set(); });
    var sourceFaces = faceTopos.get(sourceHandle) || [];
    for (var f = 0; f < sourceFaces.length; f++) {
      for (var r = 0; r < resultFaces.length; r++) {
        try { if (resultFaces[r].IsSame(sourceFaces[f].face)) candidates[r].add(sourceFaces[f].name); }
        catch (_sameError) { void _sameError; }
      }
      var modified = [];
      try { modified = listToShapes(algo.Modified(sourceFaces[f].face)); } catch (_modifiedError) { modified = []; }
      for (var m = 0; m < modified.length; m++) {
        for (var mr = 0; mr < resultFaces.length; mr++) {
          try { if (resultFaces[mr].IsSame(modified[m])) candidates[mr].add(sourceFaces[f].name); }
          catch (_matchError) { void _matchError; }
        }
        if (modified[m] && typeof modified[m].delete === 'function') modified[m].delete();
      }
    }
    if (!(edgeIds.length === 1 && edgeIds[0] === 'sel:all') && typeof algo.Generated === 'function') {
      for (var p = 0; p < pickedEdges.length; p++) {
        var generated = [];
        try { generated = listToShapes(algo.Generated(pickedEdges[p])); } catch (_generatedError) { generated = []; }
        var matchedFaceIndexes = new Set();
        var orderedFaceIndexes = [];
        for (var g = 0; g < generated.length; g++) {
          var generatedFaceIndex = -1;
          for (var gr = 0; gr < resultFaces.length; gr++) {
            try {
              if (resultFaces[gr].IsSame(generated[g])) {
                matchedFaceIndexes.add(gr);
                generatedFaceIndex = gr;
              }
            }
            catch (_generatedMatchError) { void _generatedMatchError; }
          }
          if (generatedFaceIndex >= 0) orderedFaceIndexes.push(generatedFaceIndex);
          if (generated[g] && typeof generated[g].delete === 'function') generated[g].delete();
        }
        if (matchedFaceIndexes.size === 1) {
          candidates[Array.from(matchedFaceIndexes)[0]].add(op + '/face(' + edgeIds[p] + ')');
        } else if (op === 'chamfer' && matchedFaceIndexes.size > 1 && typeof algo.Contour === 'function') {
          var contour = 0;
          try { contour = algo.Contour(pickedEdges[p]); } catch (_contourError) { contour = 0; }
          if (contour > 0) {
            for (var surface = 0; surface < orderedFaceIndexes.length; surface++) {
              candidates[orderedFaceIndexes[surface]] = new Set([
                op + '/face(' + edgeIds[p] + ')/contour.' + contour + '.surface.' + (surface + 1)
              ]);
            }
          }
        }
      }
    }
    if (pickedEdges.length === 1 && edgeIds.length === 1) {
      var generatedFaceName = op + '/face(' + edgeIds[0] + ')';
      var alreadyNamed = candidates.some(function (set) { return set.has(generatedFaceName); });
      if (!alreadyNamed) {
        var unnamed = [];
        for (var u = 0; u < candidates.length; u++) if (candidates[u].size === 0) unnamed.push(u);
        if (unnamed.length === 1) candidates[unnamed[0]].add(generatedFaceName);
      }
    }
    var out = [];
    for (var i = 0; i < resultFaces.length; i++) {
      if (candidates[i].size === 1) out.push({ face: resultFaces[i], name: Array.from(candidates[i])[0] });
      else if (resultFaces[i] && typeof resultFaces[i].delete === 'function') resultFaces[i].delete();
    }
    return out;
  }

  function roundedSemanticEdges(op, shape, namedFaces) {
    var resultEdges = uniqueEdgeMidpoints(shape);
    var adjacent = resultEdges.map(function () { return new Set(); });
    for (var f = 0; f < namedFaces.length; f++) {
      var faceEdges = uniqueEdgeMidpoints(namedFaces[f].face);
      for (var e = 0; e < faceEdges.length; e++) {
        for (var r = 0; r < resultEdges.length; r++) {
          try { if (resultEdges[r].edge.IsSame(faceEdges[e].edge)) adjacent[r].add(namedFaces[f].name); }
          catch (_sameError) { void _sameError; }
        }
        if (faceEdges[e].edge && typeof faceEdges[e].edge.delete === 'function') faceEdges[e].edge.delete();
      }
    }
    var proposed = new Map(), collisions = new Set();
    for (var i = 0; i < adjacent.length; i++) {
      if (adjacent[i].size < 2) continue;
      var name = op + '/edge(' + Array.from(adjacent[i]).sort().join('&') + ')';
      if (proposed.has(name)) collisions.add(name);
      else proposed.set(name, resultEdges[i].mid);
    }
    collisions.forEach(function (name) { proposed.delete(name); });
    return proposed;
  }

  function resolveWorkerEdges(handle, shape, edgeIds) {
    var edges = uniqueEdgeMidpoints(shape);
    if (edgeIds.length === 1 && edgeIds[0] === 'sel:all') return { ok: true, edges: edges.map(function (e) { return e.edge; }) };
    var topo = edgeTopos.get(handle);
    if (!topo || edges.length === 0) return { ok: false, error: 'selected-edge topology unavailable' };
    var picked = [], claimed = new Set();
    for (var n = 0; n < edgeIds.length; n++) {
      var anchor = topo.get(edgeIds[n]), best = -1, dist = Infinity;
      if (!anchor) return { ok: false, error: 'unknown selected edge ' + edgeIds[n] };
      for (var i = 0; i < edges.length; i++) {
        var m = edges[i].mid, d = Math.hypot(m.x - anchor.x, m.y - anchor.y, m.z - anchor.z);
        if (d < dist) { best = i; dist = d; }
      }
      if (best < 0 || dist > 1e-3 || claimed.has(best)) return { ok: false, error: 'selected edge ' + edgeIds[n] + ' no longer resolves uniquely' };
      claimed.add(best); picked.push(edges[best].edge);
    }
    return { ok: true, edges: picked };
  }

  function survivingWorkerEdgeTopo(handle, shape) {
    var source = edgeTopos.get(handle);
    if (!source) return null;
    var edges = uniqueEdgeMidpoints(shape), out = new Map(), claimed = new Set();
    source.forEach(function (anchor, name) {
      var best = -1, dist = Infinity;
      for (var i = 0; i < edges.length; i++) {
        var m = edges[i].mid, d = Math.hypot(m.x - anchor.x, m.y - anchor.y, m.z - anchor.z);
        if (d < dist) { best = i; dist = d; }
      }
      if (best >= 0 && dist <= 1e-3 && !claimed.has(best)) {
        claimed.add(best); out.set(name, edges[best].mid);
      }
    });
    return out;
  }

  function composedWorkerEdgeTopo(shape, operands, seamTopo) {
    var edges = uniqueEdgeMidpoints(shape), out = new Map(), claimed = new Set();
    for (var o = 0; o < operands.length; o++) {
      var topo = edgeTopos.get(operands[o].handle);
      if (!topo) continue;
      topo.forEach(function (anchor, name) {
        var best = -1, dist = Infinity;
        for (var i = 0; i < edges.length; i++) {
          var m = edges[i].mid, d = Math.hypot(m.x - anchor.x, m.y - anchor.y, m.z - anchor.z);
          if (d < dist) { best = i; dist = d; }
        }
        if (best >= 0 && dist <= 1e-3 && !claimed.has(best)) {
          claimed.add(best); out.set(operands[o].prefix + '/' + name, edges[best].mid);
        }
      });
    }
    if (seamTopo) seamTopo.forEach(function (anchor, name) {
      if (!out.has(name)) out.set(name, anchor);
    });
    return out;
  }

  function importedWorkerEdgeTopo(shape) {
    var mids = uniqueEdgeMidpoints(shape).map(function (entry) { return entry.mid; });
    mids.sort(function (a, b) { return a.x - b.x || a.y - b.y || a.z - b.z; });
    var out = new Map();
    for (var i = 0; i < mids.length; i++) out.set('e.import.' + i, mids[i]);
    return out;
  }

  // ─── per-op OCCT call sites ────────────────────────────────────────────

  /**
   * BRepBuilderAPI_MakePolygon → MakeFace → BRepPrimAPI_MakePrism.
   * Mirrors wasmReal.ts buildFromExtrude exactly.
   */
  function buildFromExtrude(feature) {
    if (!occt) return notReady();
    if (!feature || !Array.isArray(feature.loop) || feature.loop.length < 3) {
      return { ok: false, error: 'buildFromExtrude: loop must have >=3 points', warnings: [] };
    }
    if (!isFinite(feature.depth) || feature.depth === 0) {
      return { ok: false, error: 'buildFromExtrude: depth must be non-zero finite', warnings: [] };
    }
    var z0 = feature.z0 == null ? 0 : feature.z0;
    if (!isFinite(z0)) return { ok: false, error: 'buildFromExtrude: z0 must be finite', warnings: [] };

    // Allocate polygon + points first so try/finally can free them.
    var Polygon = occt.BRepBuilderAPI_MakePolygon_1 || occt.BRepBuilderAPI_MakePolygon;
    var Pnt = occt.gp_Pnt_3 || occt.gp_Pnt;
    var Vec = occt.gp_Vec_4 || occt.gp_Vec;
    var MakeFace = occt.BRepBuilderAPI_MakeFace_15 || occt.BRepBuilderAPI_MakeFace;
    var MakePrism = occt.BRepPrimAPI_MakePrism_1 || occt.BRepPrimAPI_MakePrism;
    if (!Polygon || !Pnt || !Vec || !MakeFace || !MakePrism) {
      return { ok: false, error: 'buildFromExtrude: required OCCT symbol missing', warnings: [] };
    }

    var polygon = null;
    var points = [];
    var wire = null;
    var faceBuilder = null;
    var face = null;
    var vec = null;
    var prismBuilder = null;
    try {
      polygon = new Polygon();
      for (var i = 0; i < feature.loop.length; i++) {
        var p = feature.loop[i];
        var pnt = new Pnt(p.x, p.y, z0);
        points.push(pnt);
        // Embind generated polygons accept Add_1 (real) or Add (older naming).
        if (typeof polygon.Add_1 === 'function') polygon.Add_1(pnt);
        else polygon.Add(pnt);
      }
      polygon.Close();
      wire = polygon.Wire();
      faceBuilder = new MakeFace(wire, true);
      face = faceBuilder.Face();
      vec = new Vec(0, 0, feature.depth);
      prismBuilder = new MakePrism(face, vec, false, true);
      var shape = prismBuilder.Shape();
      var h = alloc(
        shape,
        extrudeEdgeTopo(feature.loop, z0, z0 + feature.depth),
        classifyExtrudeFaces(shape, feature.loop, z0, z0 + feature.depth)
      );
      return { ok: true, handle: h, kind: 'solid', warnings: [] };
    } catch (err) {
      return { ok: false, error: 'buildFromExtrude: ' + (err && err.message), warnings: [] };
    } finally {
      if (prismBuilder && typeof prismBuilder.delete === 'function') prismBuilder.delete();
      if (vec && typeof vec.delete === 'function') vec.delete();
      if (face && typeof face.delete === 'function') face.delete();
      if (faceBuilder && typeof faceBuilder.delete === 'function') faceBuilder.delete();
      if (wire && typeof wire.delete === 'function') wire.delete();
      if (polygon && typeof polygon.delete === 'function') polygon.delete();
      for (var j = 0; j < points.length; j++) {
        if (points[j] && typeof points[j].delete === 'function') points[j].delete();
      }
    }
  }

  function buildPrismAt(loop, z0, heightMm) {
    if (!Array.isArray(loop) || loop.length < 3 || !isFinite(z0) || !isFinite(heightMm) || !(heightMm > 0)) {
      return { ok: false, error: 'buildPrismAt: loop, z0, and positive height are required', warnings: [] };
    }
    var circle = detectCircleLoop(loop);
    if (circle) return buildCylinderAt(circle.center, z0, heightMm, circle.radius);
    return buildFromExtrude({ loop: loop, depth: heightMm, z0: z0 });
  }

  function detectCircleLoop(loop) {
    if (!Array.isArray(loop) || loop.length < 16) return null;
    var cx = 0, cy = 0;
    for (var i = 0; i < loop.length; i++) { cx += loop[i].x; cy += loop[i].y; }
    cx /= loop.length; cy /= loop.length;
    var radii = [], radius = 0;
    for (var r = 0; r < loop.length; r++) {
      var value = Math.hypot(loop[r].x - cx, loop[r].y - cy);
      if (!isFinite(value) || !(value > 0)) return null;
      radii.push(value); radius += value;
    }
    radius /= loop.length;
    var tolerance = Math.max(1e-7, radius * 1e-6);
    for (var j = 0; j < radii.length; j++) if (Math.abs(radii[j] - radius) > tolerance) return null;
    var direction = 0, total = 0;
    for (var a = 0; a < loop.length; a++) {
      var b = (a + 1) % loop.length;
      var aa = Math.atan2(loop[a].y - cy, loop[a].x - cx);
      var ab = Math.atan2(loop[b].y - cy, loop[b].x - cx);
      var delta = ab - aa;
      while (delta <= -Math.PI) delta += 2 * Math.PI;
      while (delta > Math.PI) delta -= 2 * Math.PI;
      if (Math.abs(delta) < 1e-9) return null;
      var sign = delta > 0 ? 1 : -1;
      if (direction === 0) direction = sign;
      else if (sign !== direction) return null;
      total += delta;
    }
    if (Math.abs(Math.abs(total) - 2 * Math.PI) > 1e-6) return null;
    return { center: { x: cx, y: cy }, radius: radius };
  }

  function classifyAxialPrimitiveFaces(shape, center, z0, z1) {
    var faces = uniqueFaces(shape), out = [], tol = 1e-4;
    for (var i = 0; i < faces.length; i++) {
      var c = faceCentroid(faces[i]), name = null;
      if (c && Math.abs(c.z - z0) <= tol) name = 'f.cap.bottom';
      else if (c && Math.abs(c.z - z1) <= tol) name = 'f.cap.top';
      else if (c && Math.abs(c.x - center.x) <= tol && Math.abs(c.y - center.y) <= tol) name = 'f.side.0';
      if (name) out.push({ face: faces[i], name: name });
      else if (faces[i] && faces[i].delete) faces[i].delete();
    }
    return out;
  }

  function buildCylinderAt(center, z0, heightMm, radius) {
    var Pnt = occt && (occt.gp_Pnt_3 || occt.gp_Pnt), Dir = occt && (occt.gp_Dir_4 || occt.gp_Dir);
    var Ax2 = occt && (occt.gp_Ax2_3 || occt.gp_Ax2), Cylinder = occt && (occt.BRepPrimAPI_MakeCylinder_3 || occt.BRepPrimAPI_MakeCylinder);
    if (!Pnt || !Dir || !Ax2 || !Cylinder) return { ok: false, error: 'buildCylinderAt: required OCCT symbol missing', warnings: [] };
    var origin = null, dir = null, axis = null, maker = null;
    try {
      origin = new Pnt(center.x, center.y, z0); dir = new Dir(0, 0, 1); axis = new Ax2(origin, dir);
      maker = new Cylinder(axis, radius, heightMm);
      var shape = maker.Shape();
      var h = alloc(shape, importedWorkerEdgeTopo(shape), classifyAxialPrimitiveFaces(shape, center, z0, z0 + heightMm));
      return { ok: true, handle: h, kind: 'solid', warnings: ['analytic circular prism promoted to OCCT cylinder'] };
    } catch (err) { return { ok: false, error: 'buildCylinderAt: ' + (err && err.message), warnings: [] }; }
    finally {
      if (maker && maker.delete) maker.delete(); if (axis && axis.delete) axis.delete();
      if (dir && dir.delete) dir.delete(); if (origin && origin.delete) origin.delete();
    }
  }

  function buildConeAt(center, z0, heightMm, radius0, radius1) {
    if (!occt) return notReady();
    if (!center || !isFinite(center.x) || !isFinite(center.y) || !isFinite(z0) || !isFinite(heightMm) || !(heightMm > 0) ||
        !isFinite(radius0) || !isFinite(radius1) || radius0 < 0 || radius1 < 0 || (radius0 === 0 && radius1 === 0)) {
      return { ok: false, error: 'buildConeAt: finite center/z0, positive height, and non-negative radii are required', warnings: [] };
    }
    var Pnt = occt.gp_Pnt_3 || occt.gp_Pnt;
    var Dir = occt.gp_Dir_4 || occt.gp_Dir;
    var Ax2 = occt.gp_Ax2_3 || occt.gp_Ax2;
    var Cone = occt.BRepPrimAPI_MakeCone_3 || occt.BRepPrimAPI_MakeCone;
    if (!Pnt || !Dir || !Ax2 || !Cone) return { ok: false, error: 'buildConeAt: required OCCT symbol missing', warnings: [] };
    var origin = null, dir = null, axis = null, maker = null;
    try {
      origin = new Pnt(center.x, center.y, z0);
      dir = new Dir(0, 0, 1);
      axis = new Ax2(origin, dir);
      maker = new Cone(axis, radius0, radius1, heightMm);
      var shape = maker.Shape();
      var h = alloc(shape, importedWorkerEdgeTopo(shape));
      return { ok: true, handle: h, kind: 'solid', warnings: [] };
    } catch (err) {
      return { ok: false, error: 'buildConeAt: ' + (err && err.message), warnings: [] };
    } finally {
      if (maker && maker.delete) maker.delete();
      if (axis && axis.delete) axis.delete();
      if (dir && dir.delete) dir.delete();
      if (origin && origin.delete) origin.delete();
    }
  }

  function buildThreadHelixCutter(opts) {
    if (!occt) return notReady();
    opts = opts || {};
    var center = opts.center || {};
    var values = [center.x, center.y, opts.z0, opts.innerRadius, opts.outerRadius, opts.pitch, opts.lengthMm];
    if (!values.every(isFinite) || !(opts.innerRadius > 0) || !(opts.outerRadius > opts.innerRadius) ||
        !(opts.pitch > 0) || !(opts.lengthMm > 0)) {
      return { ok: false, error: 'buildThreadHelixCutter: requires finite center/z0, 0 < innerRadius < outerRadius, and positive pitch/length', warnings: [] };
    }
    var required = ['gp_Pnt_3', 'gp_Dir_4', 'gp_Ax3_3', 'Geom_CylindricalSurface_1', 'Handle_Geom_Surface_2',
      'gp_Pnt2d_3', 'gp_Dir2d_4', 'Geom2d_Line_3', 'Handle_Geom2d_Curve_2', 'BRepBuilderAPI_MakeEdge_31',
      'BRepBuilderAPI_MakeWire_2', 'BRepBuilderAPI_MakePolygon_1', 'BRepBuilderAPI_MakeFace_15',
      'BRepOffsetAPI_MakePipe_1', 'BRepCheck_Analyzer'];
    for (var ri = 0; ri < required.length; ri++) {
      if (!occt[required[ri]]) return { ok: false, error: 'buildThreadHelixCutter: required OCCT symbol missing: ' + required[ri], warnings: [] };
    }
    try {
      var origin = new occt.gp_Pnt_3(center.x, center.y, opts.z0);
      var axis = new occt.gp_Ax3_3(origin, new occt.gp_Dir_4(0, 0, 1), new occt.gp_Dir_4(1, 0, 0));
      var threadKind = opts.threadKind === 'internal' ? 'internal' : 'external';
      var spineRadius = threadKind === 'internal' ? opts.innerRadius : opts.outerRadius;
      var surface = new occt.Geom_CylindricalSurface_1(axis, spineRadius);
      var surfaceHandle = new occt.Handle_Geom_Surface_2(surface);
      var hand = opts.direction === 'left_hand' ? -1 : 1;
      var p2 = new occt.gp_Pnt2d_3(0, 0);
      var d2 = new occt.gp_Dir2d_4(hand * 2 * Math.PI, opts.pitch);
      var line = new occt.Geom2d_Line_3(p2, d2);
      var lineHandle = new occt.Handle_Geom2d_Curve_2(line);
      var turns = opts.lengthMm / opts.pitch;
      var parameterLength = turns * Math.hypot(2 * Math.PI, opts.pitch);
      var edgeMaker = new occt.BRepBuilderAPI_MakeEdge_31(lineHandle, surfaceHandle, 0, parameterLength);
      var helixEdge = edgeMaker.Edge();
      if (!occt.BRepLib || !occt.BRepLib.BuildCurves3d_2 || !occt.BRepLib.BuildCurves3d_2(helixEdge)) {
        return { ok: false, error: 'buildThreadHelixCutter: OCCT could not build the 3D helix curve', warnings: [] };
      }
      var spine = new occt.BRepBuilderAPI_MakeWire_2(helixEdge).Wire();
      var halfWidth = Math.min(opts.pitch * 0.24, opts.lengthMm * 0.24);
      var profile = new occt.BRepBuilderAPI_MakePolygon_1();
      var baseRadius = threadKind === 'internal' ? opts.innerRadius : opts.outerRadius;
      var tipRadius = threadKind === 'internal' ? opts.outerRadius : opts.innerRadius;
      profile.Add_1(new occt.gp_Pnt_3(center.x + baseRadius, center.y, opts.z0 - halfWidth));
      profile.Add_1(new occt.gp_Pnt_3(center.x + tipRadius, center.y, opts.z0));
      profile.Add_1(new occt.gp_Pnt_3(center.x + baseRadius, center.y, opts.z0 + halfWidth));
      profile.Close();
      var profileFace = new occt.BRepBuilderAPI_MakeFace_15(profile.Wire(), false).Face();
      var pipe = new occt.BRepOffsetAPI_MakePipe_1(spine, profileFace);
      var shape = pipe.Shape();
      var analyzer = null;
      try { analyzer = new occt.BRepCheck_Analyzer(shape, true, false); }
      catch (_) { analyzer = new occt.BRepCheck_Analyzer(shape, true); }
      if (!analyzer.IsValid_2()) return { ok: false, error: 'buildThreadHelixCutter: OCCT produced an invalid helical cutter', warnings: [] };
      var h = alloc(shape, importedWorkerEdgeTopo(shape));
      return { ok: true, handle: h, kind: 'solid', warnings: ['exact OCCT cylindrical helix sweep'] };
    } catch (err) {
      return { ok: false, error: 'buildThreadHelixCutter: ' + (err && err.message), warnings: [] };
    }
  }

  /**
   * profile → MakeFace → BRepPrimAPI_MakeRevol around gp_Ax1(+Y).
   * Phase 1 simplification: always full 360° (angleDegrees is acknowledged
   * via a warning when < 360 but the sweep is still full revolve).
   */
  function buildFromRevolve(feature) {
    if (!occt) return notReady();
    if (!feature || !Array.isArray(feature.loop) || feature.loop.length < 3) {
      return { ok: false, error: 'buildFromRevolve: loop must have >=3 points', warnings: [] };
    }
    var angleDegrees = feature.angleDegrees == null ? 360 : feature.angleDegrees;
    if (!isFinite(angleDegrees) || !(angleDegrees > 0) || angleDegrees > 360) {
      return { ok: false, error: 'buildFromRevolve: angleDegrees must be in (0, 360]', warnings: [] };
    }
    var warnings = [];

    var Polygon = occt.BRepBuilderAPI_MakePolygon_1 || occt.BRepBuilderAPI_MakePolygon;
    var Pnt = occt.gp_Pnt_3 || occt.gp_Pnt;
    var Dir = occt.gp_Dir_4 || occt.gp_Dir;
    var Ax1 = occt.gp_Ax1_2 || occt.gp_Ax1;
    var MakeFace = occt.BRepBuilderAPI_MakeFace_15 || occt.BRepBuilderAPI_MakeFace;
    var MakeRevol = occt.BRepPrimAPI_MakeRevol_1 || occt.BRepPrimAPI_MakeRevol;
    if (!Polygon || !Pnt || !MakeFace || !MakeRevol) {
      return { ok: false, error: 'buildFromRevolve: required OCCT symbol missing', warnings: warnings };
    }

    var polygon = null;
    var points = [];
    var wire = null;
    var faceBuilder = null;
    var face = null;
    var origin = null;
    var dir = null;
    var axis = null;
    var revolBuilder = null;
    try {
      polygon = new Polygon();
      for (var i = 0; i < feature.loop.length; i++) {
        var p = feature.loop[i];
        var pnt = new Pnt(p.x, p.y, 0);
        points.push(pnt);
        if (typeof polygon.Add_1 === 'function') polygon.Add_1(pnt);
        else polygon.Add(pnt);
      }
      polygon.Close();
      wire = polygon.Wire();
      faceBuilder = new MakeFace(wire, true);
      face = faceBuilder.Face();
      // gp_Ax1(origin, +Y direction)
      if (Ax1 && Dir) {
        origin = new Pnt(0, 0, 0);
        dir = new Dir(0, 1, 0);
        axis = new Ax1(origin, dir);
        revolBuilder = new MakeRevol(face, axis, angleDegrees * Math.PI / 180, false);
      } else {
        // Fall back to whatever MakeRevol overload exists on the module.
        revolBuilder = new MakeRevol(face);
      }
      var shape = revolBuilder.Shape();
      var h = alloc(
        shape,
        revolveEdgeTopo(feature.loop, angleDegrees),
        classifyRevolveFaces(revolBuilder, wire, shape, feature.loop, angleDegrees)
      );
      return { ok: true, handle: h, kind: 'solid', warnings: warnings };
    } catch (err) {
      return { ok: false, error: 'buildFromRevolve: ' + (err && err.message), warnings: warnings };
    } finally {
      if (revolBuilder && typeof revolBuilder.delete === 'function') revolBuilder.delete();
      if (axis && typeof axis.delete === 'function') axis.delete();
      if (dir && typeof dir.delete === 'function') dir.delete();
      if (origin && typeof origin.delete === 'function') origin.delete();
      if (face && typeof face.delete === 'function') face.delete();
      if (faceBuilder && typeof faceBuilder.delete === 'function') faceBuilder.delete();
      if (wire && typeof wire.delete === 'function') wire.delete();
      if (polygon && typeof polygon.delete === 'function') polygon.delete();
      for (var j = 0; j < points.length; j++) {
        if (points[j] && typeof points[j].delete === 'function') points[j].delete();
      }
    }
  }

  function booleanOp(op, handleA, handleB) {
    if (!occt) return notReady();
    var a = handles.get(handleA);
    var b = handles.get(handleB);
    if (!a || !b) return { ok: false, error: op + ': unknown handle', warnings: [] };

    var Algo = null;
    if (op === 'booleanUnion') Algo = occt.BRepAlgoAPI_Fuse_3 || occt.BRepAlgoAPI_Fuse;
    else if (op === 'booleanSubtract') Algo = occt.BRepAlgoAPI_Cut_3 || occt.BRepAlgoAPI_Cut;
    else Algo = occt.BRepAlgoAPI_Common_3 || occt.BRepAlgoAPI_Common;
    if (!Algo) return { ok: false, error: op + ': OCCT symbol missing', warnings: [] };

    var algo = null;
    try {
      algo = new Algo(a, b);
      algo.Build();
      if (typeof algo.IsDone === 'function' && !algo.IsDone()) {
        return { ok: false, error: op + ': BRepAlgoAPI not done', warnings: [] };
      }
      var shape = algo.Shape();
      var operands = [
        { handle: handleA, prefix: 'a' }, { handle: handleB, prefix: 'b' }
      ];
      var resultEdges = uniqueEdgeMidpoints(shape);
      var opName = op === 'booleanUnion' ? 'union' : (op === 'booleanSubtract' ? 'cut' : 'intersect');
      var seams = booleanSeamTopo(opName, algo, resultEdges, operands);
      var resultFaces = propagatedBooleanFaces(algo, shape, operands);
      var h = alloc(shape, composedWorkerEdgeTopo(shape, operands, seams), resultFaces);
      return { ok: true, handle: h, kind: 'solid', warnings: [] };
    } catch (err) {
      return { ok: false, error: op + ': ' + (err && err.message), warnings: [] };
    } finally {
      if (algo && typeof algo.delete === 'function') algo.delete();
    }
  }

  /**
   * Phase 1 simplification — apply fillet/chamfer to ALL edges of the shape.
   * Real edge selection (matching `edgeIds` against TopExp_Explorer output) is
   * a Phase 5.5+ follow-up.
   */
  function filletOrChamfer(op, handle, edgeIds, dim, perEdgeDims, radiusLaws, continuityOptions) {
    if (!occt) return notReady();
    var src = handles.get(handle);
    if (!src) return { ok: false, error: op + ': unknown handle', warnings: [] };
    if (!perEdgeDims && !radiusLaws && (!isFinite(dim) || !(dim > 0))) {
      return { ok: false, error: op + ': dim must be positive finite', warnings: [] };
    }
    if (!Array.isArray(edgeIds) || edgeIds.length === 0) return { ok: false, error: op + ': no edges selected', warnings: [] };
    if (perEdgeDims && (perEdgeDims.length !== edgeIds.length || perEdgeDims.some(function (v) { return !isFinite(v) || !(v > 0); }))) {
      return { ok: false, error: op + ': every selected edge requires a positive finite dimension', warnings: [] };
    }
    if (radiusLaws && (radiusLaws.length !== edgeIds.length || radiusLaws.some(function (law) {
      return !law || !isFinite(law.startRadius) || !(law.startRadius > 0) || !isFinite(law.endRadius) || !(law.endRadius > 0);
    }))) {
      return { ok: false, error: op + ': every selected edge requires positive finite start/end radii', warnings: [] };
    }
    var matched = resolveWorkerEdges(handle, src, edgeIds);
    if (!matched.ok) return { ok: false, error: op + ': ' + matched.error + '; refusing to widen selection', warnings: [] };
    if (matched.edges.length === 0) return { ok: false, error: op + ': no live edges resolved', warnings: [] };

    var Algo = op === 'fillet'
      ? (occt.BRepFilletAPI_MakeFillet_1 || occt.BRepFilletAPI_MakeFillet)
      : (occt.BRepFilletAPI_MakeChamfer_1 || occt.BRepFilletAPI_MakeChamfer);
    if (!Algo) return { ok: false, error: op + ': OCCT symbol missing', warnings: [] };

    var algo = null;
    var warnings = [];
    try {
      algo = op === 'fillet' ? new Algo(src, 0) : new Algo(src);
      for (var selectedIndex = 0; selectedIndex < matched.edges.length; selectedIndex++) {
        var selectedDim = perEdgeDims ? perEdgeDims[selectedIndex] : dim;
        if (radiusLaws) {
          if (typeof algo.Add_3 !== 'function') {
            return { ok: false, error: op + ': OCCT linear radius-law overload unavailable', warnings: [] };
          }
          algo.Add_3(radiusLaws[selectedIndex].startRadius, radiusLaws[selectedIndex].endRadius, matched.edges[selectedIndex]);
        } else if (typeof algo.Add_2 === 'function') algo.Add_2(selectedDim, matched.edges[selectedIndex]);
        else algo.Add(selectedDim, matched.edges[selectedIndex]);
      }
      if (continuityOptions) {
        var shapeEnum = occt.GeomAbs_Shape;
        var continuity = continuityOptions.continuity === 'G2'
          ? shapeEnum && shapeEnum.GeomAbs_C2
          : shapeEnum && shapeEnum.GeomAbs_C1;
        var angularTolerance = continuityOptions.angularTolerance == null ? 1e-4 : continuityOptions.angularTolerance;
        if (!continuity || typeof algo.SetContinuity !== 'function' || !isFinite(angularTolerance) || !(angularTolerance > 0)) {
          return { ok: false, error: op + ': requested continuity settings unavailable or invalid', warnings: [] };
        }
        algo.SetContinuity(continuity, angularTolerance);
      }
      // Iterate TopExp_Explorer with TopAbs_EDGE to add every edge.
      /* Legacy all-edge fallback removed: selected IDs must never widen. */
      if (false && typeof occt.TopExp_Explorer_2 === 'function' && occt.TopAbs_ShapeEnum) {
        var TopExp = occt.TopExp_Explorer_2 || occt.TopExp_Explorer;
        explorer = new TopExp(src, occt.TopAbs_ShapeEnum.TopAbs_EDGE, occt.TopAbs_ShapeEnum.TopAbs_SHAPE);
        while (explorer.More()) {
          var edge = explorer.Current();
          if (op === 'fillet') {
            // Real Embind: Add_2(radius, edge)
            if (typeof algo.Add_2 === 'function') algo.Add_2(dim, edge);
            else algo.Add(dim, edge);
          } else {
            if (typeof algo.Add_2 === 'function') algo.Add_2(dim, edge);
            else algo.Add(dim, edge);
          }
          explorer.Next();
        }
      } else if (false && typeof algo.Add === 'function') {
        // Stub path — no explorer, just no edges. Algo.Build() still runs.
        void edgeIds;
      }
      if (typeof algo.Build === 'function') algo.Build();
      if (typeof algo.IsDone === 'function' && !algo.IsDone()) {
        return { ok: false, error: op + ': OCCT kernel did not produce a valid rounded shape', warnings: warnings };
      }
      var shape = algo.Shape();
      if (!shape || (typeof shape.IsNull === 'function' && shape.IsNull())) {
        return { ok: false, error: op + ': OCCT kernel returned an empty rounded shape', warnings: warnings };
      }
      var faces = roundedFaceTopo(op, algo, shape, handle, edgeIds, matched.edges);
      var edges = survivingWorkerEdgeTopo(handle, shape) || new Map();
      roundedSemanticEdges(op, shape, faces).forEach(function (anchor, name) { edges.set(name, anchor); });
      var h = alloc(shape, edges, faces);
      return { ok: true, handle: h, kind: 'solid', warnings: warnings };
    } catch (err) {
      return { ok: false, error: op + ': ' + (err && err.message), warnings: warnings };
    } finally {
      if (algo && typeof algo.delete === 'function') algo.delete();
    }
  }

  function variableFilletWithRecovery(handle, entries) {
    if (!Array.isArray(entries) || entries.length === 0) {
      return { ok: false, error: 'variableFillet: no edges selected', warnings: [] };
    }
    var edgeIds = [], radii = [];
    for (var i = 0; i < entries.length; i++) {
      if (!entries[i] || typeof entries[i].edgeId !== 'string' || !isFinite(entries[i].radius) || !(entries[i].radius > 0)) {
        return { ok: false, error: 'variableFillet: every edge requires an id and positive finite radius', warnings: [] };
      }
      edgeIds.push(entries[i].edgeId);
      radii.push(entries[i].radius);
    }
    var factors = [1, 0.75, 0.5, 0.25];
    var failures = [];
    for (var attempt = 0; attempt < factors.length; attempt++) {
      var scaled = radii.map(function (radius) { return radius * factors[attempt]; });
      var result = filletOrChamfer('fillet', handle, edgeIds, NaN, scaled);
      if (result.ok) {
        if (factors[attempt] < 1) {
          result.warnings = (result.warnings || []).concat([
            'variableFillet: recovered by uniformly scaling all radii to ' + factors[attempt] +
            'x; requested ratios preserved'
          ]);
        }
        return result;
      }
      failures.push(factors[attempt] + 'x: ' + result.error);
      if (result.error && /unknown selected edge|topology unavailable|requires an id|positive finite/.test(result.error)) break;
    }
    return {
      ok: false,
      error: 'variableFillet: all radius scales failed (' + failures.join('; ') + ')',
      warnings: []
    };
  }

  function lawFilletWithRecovery(handle, entries, continuityOptions) {
    if (!Array.isArray(entries) || entries.length === 0) {
      return { ok: false, error: 'lawFillet: no edges selected', warnings: [] };
    }
    var edgeIds = [], laws = [];
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      if (!entry || typeof entry.edgeId !== 'string' || !isFinite(entry.startRadius) || !(entry.startRadius > 0) ||
          !isFinite(entry.endRadius) || !(entry.endRadius > 0)) {
        return { ok: false, error: 'lawFillet: every edge requires positive finite start/end radii', warnings: [] };
      }
      edgeIds.push(entry.edgeId);
      laws.push({ startRadius: entry.startRadius, endRadius: entry.endRadius });
    }
    var factors = [1, 0.75, 0.5, 0.25], failures = [];
    for (var attempt = 0; attempt < factors.length; attempt++) {
      var scaled = laws.map(function (law) {
        return { startRadius: law.startRadius * factors[attempt], endRadius: law.endRadius * factors[attempt] };
      });
      var result = filletOrChamfer('fillet', handle, edgeIds, NaN, null, scaled, continuityOptions || { continuity: 'G1' });
      if (result.ok) {
        result.warnings = (result.warnings || []).concat([
          'lawFillet: linear start-to-end radius law applied at ' + factors[attempt] + 'x scale with ' +
          ((continuityOptions && continuityOptions.continuity) || 'G1') + ' continuity'
        ]);
        return result;
      }
      failures.push(factors[attempt] + 'x: ' + result.error);
      if (result.error && /unknown selected edge|topology unavailable|positive finite|overload unavailable/.test(result.error)) break;
    }
    return { ok: false, error: 'lawFillet: all radius scales failed (' + failures.join('; ') + ')', warnings: [] };
  }

  // ─── STEP MEMFS paths — ⚠ 10-CHAR HARD CEILING (kernel defect, W3-D) ──
  //
  // MEASURED 2026-07-20 (opencascade.js@1.1.1, fresh module, Node probes):
  //   - STEPControl_Writer.Write / STEPControl_Reader.ReadFile corrupt the
  //     path once it reaches 11 characters: the bytes handed to the
  //     underlying file open are stale heap garbage, so a write lands in a
  //     garbage-named MEMFS entry (observed "@ˁ") — sometimes
  //     WITHOUT throwing — or throws Emscripten FS errno 44, and a read
  //     opens a nonexistent garbage path → RetError / 0 transfer roots.
  //     <= 10 characters is always correct. The old literals
  //     '/tmp/out.step' (13) and 'cadr_in.step' (12) both exceeded the
  //     limit, so the browser STEP paths had never worked.
  //   - NOT the JS→C++ argument marshalling: TCollection_AsciiString_2
  //     round-trips 11- and 22-char strings perfectly, and an FS.open trace
  //     shows the CORRECT path also reaching the C side during the same op.
  //   - NOT Emscripten MEMFS: FS.writeFile/readFile handle 38-char names.
  //   → The defect sits inside the compiled OCCT stream-open path. The
  //     10/11 boundary is exactly libc++-on-wasm32 std::string SSO capacity
  //     (10 chars inline + NUL in the 12-byte object): an SSO-resident path
  //     survives a dangling/stale copy by accident; a heap-backed (>= 11
  //     chars) one does not.
  //
  // Therefore every path handed to Write/ReadFile MUST be <= 10 chars and
  // must not point into a missing subdirectory ('/t/o.step' fails silently
  // when /t does not exist). Re-break is guarded three ways: the runtime
  // assert below, the pinned boundary test in wasmReal.placeholder.test.ts
  // ("KNOWN KERNEL DEFECT"), and the real-kernel round-trip through THIS
  // file's ops in occtWorkerReal.stepRoundtrip.test.ts.
  var STEP_FS_PATH_MAX = 10;
  /** exportSTEP MEMFS path — root-level absolute is safe for the writer. */
  var STEP_EXPORT_PATH = '/o.step'; // 7 chars
  /** importSTEP MEMFS path — MUST stay a bare relative name (see importSTEP). */
  var STEP_IMPORT_PATH = 'in.step'; // 7 chars
  function assertStepPathMarshalSafe(p) {
    if (typeof p !== 'string' || p.length === 0 || p.length > STEP_FS_PATH_MAX) {
      throw new Error(
        'occt-real: STEP MEMFS path "' + p + '" exceeds ' + STEP_FS_PATH_MAX +
        ' chars — this opencascade.js build corrupts >= 11-char paths ' +
        '(writes land in garbage MEMFS entries, reads transfer 0 roots). ' +
        'Keep it <= 10 chars.');
    }
  }

  function exportSTEP(handle) {
    if (!occt) return notReady();
    var shape = handles.get(handle);
    if (!shape) return { ok: false, error: 'exportSTEP: unknown handle', warnings: [] };

    var Writer = occt.STEPControl_Writer_1 || occt.STEPControl_Writer;
    if (!Writer) return { ok: false, error: 'exportSTEP: OCCT symbol missing', warnings: [] };

    var writer = null;
    try {
      writer = new Writer();
      var modelType = (occt.STEPControl_StepModelType && (occt.STEPControl_StepModelType.AsIs ?? 0)) || 0;
      // Embind: Transfer(shape, modelType, compgraph) → IFSelect_ReturnStatus.
      // This build REQUIRES all 3 args — the old 2-arg call threw
      // "Transfer called with 2 arguments, expected 3 args!" (measured in
      // occtWorkerReal.stepRoundtrip.test.ts), so export died even before
      // the corrupted-path defect. Mirrors wasmReal.placeholder.test.ts's
      // proven call: Transfer(shape, STEPControl_AsIs = 0, compgraph = true).
      writer.Transfer(shape, modelType, true);
      // ⚠ <= 10 chars — see STEP_FS_PATH_MAX above. '/tmp/out.step' (13)
      // used to land the output in a garbage MEMFS entry / throw errno 44.
      var path = STEP_EXPORT_PATH;
      assertStepPathMarshalSafe(path);
      if (!occt.FS || typeof occt.FS.readFile !== 'function') {
        return { ok: false, error: 'exportSTEP: occt.FS unavailable', warnings: [] };
      }
      // Remove any previous export first so the read-back below can only see
      // BYTES FROM THIS Write — never a stale earlier result.
      if (typeof occt.FS.unlink === 'function') {
        try { occt.FS.unlink(path); } catch (_u) { void _u; }
      }
      // Real OCCT supports Write(path) (writes to MEMFS) — read back via FS.
      writer.Write(path);
      var step = null;
      try {
        step = occt.FS.readFile(path, { encoding: 'utf8' });
      } catch (fsErr) {
        // Write "succeeded" but nothing landed at the requested path — the
        // known corrupted-path failure mode. Loud, never a silent empty step.
        return {
          ok: false,
          error: 'exportSTEP: kernel did not write ' + path +
            ' (FS errno ' + (fsErr && fsErr.errno) + ') — STEP output missing',
          warnings: [],
        };
      }
      if (typeof step !== 'string' || step.length === 0) {
        return { ok: false, error: 'exportSTEP: empty result', warnings: [] };
      }
      return { ok: true, step: step, warnings: [] };
    } catch (err) {
      return { ok: false, error: 'exportSTEP: ' + (err && err.message), warnings: [] };
    } finally {
      if (writer && typeof writer.delete === 'function') writer.delete();
    }
  }

  function importSTEP(source) {
    if (!occt) return notReady();
    if (typeof source !== 'string' || source.length === 0) {
      return { ok: false, error: 'importSTEP: empty source', warnings: [] };
    }
    var Reader = occt.STEPControl_Reader_1 || occt.STEPControl_Reader;
    if (!Reader) return { ok: false, error: 'importSTEP: OCCT symbol missing', warnings: [] };

    var reader = null;
    try {
      // IMPORTANT — TWO path constraints stack here:
      //  1. A BARE relative filename in the FS CWD. opencascade.js's
      //     STEPControl_Reader.ReadFile returns IFSelect_RetError for ABSOLUTE
      //     paths like '/tmp/in.step' on real-world AP203/AP214 files, but
      //     parses the identical bytes fine from a relative name (the node
      //     bridge uses the same workaround, 'cadr.step').
      //  2. <= 10 characters — see STEP_FS_PATH_MAX above. The previous name
      //     'cadr_in.step' (12) hit the corrupted-path defect: ReadFile
      //     opened a garbage path and TransferRoots() yielded 0, so browser
      //     B-rep STEP import had never worked.
      var path = STEP_IMPORT_PATH;
      assertStepPathMarshalSafe(path);
      if (occt.FS && typeof occt.FS.writeFile === 'function') {
        occt.FS.writeFile(path, source);
      } else {
        return { ok: false, error: 'importSTEP: occt.FS unavailable', warnings: [] };
      }
      reader = new Reader();
      // Mirror the proven node bridge (nodeOcctBridge.importSTEP): don't bail on
      // the ReadFile status — many real-world STEPs return a non-RetDone WARNING
      // status yet still transfer fine. Gate on the TransferRoots() COUNT
      // instead, and surface the status in the error for diagnosis.
      var status = reader.ReadFile(path);
      // Distinguish a PARSE failure (RetError/RetFail) from parsed-but-empty.
      // Real-world AP203/AP214/AP242 from CAD tools can return RetError: this
      // opencascade.js build's STEP reader can't parse every schema variant
      // (STEPControl_ and STEPCAFControl_ fail identically). The mesh path
      // (occt-import-js ReadStepFile) handles those — give an actionable error.
      var retDone = occt.IFSelect_ReturnStatus && occt.IFSelect_ReturnStatus.IFSelect_RetDone;
      if (retDone !== undefined && status !== retDone) {
        return { ok: false, error: 'importSTEP: this STEP could not be parsed as B-rep by the kernel — import it as a mesh instead', warnings: [] };
      }
      var n = reader.TransferRoots();
      if (!n || n < 1) {
        // GUARD — the reader can "succeed" (RetDone) and still transfer
        // nothing. A 0-root result must NEVER become a silent empty shape:
        // fail loudly with the status for diagnosis.
        return { ok: false, error: 'importSTEP: no transferable B-rep roots (ReadFile status=' + status + ') — refusing to return an empty shape', warnings: [] };
      }
      var shape = reader.OneShape();
      if (!shape || (typeof shape.IsNull === 'function' && shape.IsNull())) {
        return { ok: false, error: 'importSTEP: kernel returned a null shape despite ' + n + ' transfer root(s)', warnings: [] };
      }
      var h = alloc(shape, importedWorkerEdgeTopo(shape));
      return { ok: true, handle: h, kind: 'solid', warnings: ['imported B-rep edges named deterministically as e.import.*'] };
    } catch (err) {
      return { ok: false, error: 'importSTEP: ' + (err && err.message), warnings: [] };
    } finally {
      if (reader && typeof reader.delete === 'function') reader.delete();
    }
  }

  /**
   * Tessellate a live B-rep into viewer buffers (OcctTessellation): flat-shaded
   * triangles + feature (sharp/boundary) edges + framing bounds. Real BRepMesh +
   * per-face triangulation, welded into a manifold — the same algorithm as
   * src/lib/occt/occtTessellate.ts (which is unit-tested against real OCCT),
   * transcribed for the classic worker.
   */
  function tessellate(handle, deflection) {
    if (!occt) return notReady();
    var shape = handles.get(handle);
    if (!shape) return { ok: false, error: 'tessellate: unknown handle (' + handle + ')', warnings: [] };
    var defl = (typeof deflection === 'number' && deflection > 0) ? deflection : 0.1;

    var IncMesh = occt.BRepMesh_IncrementalMesh_2 || occt.BRepMesh_IncrementalMesh;
    var ExpCtor = occt.TopExp_Explorer_2 || occt.TopExp_Explorer;
    var LocCtor = occt.TopLoc_Location_1 || occt.TopLoc_Location;
    if (!IncMesh || !ExpCtor || !LocCtor || !occt.TopAbs_ShapeEnum || !occt.TopAbs_Orientation || !occt.TopoDS || !occt.BRep_Tool) {
      return { ok: false, error: 'tessellate: required OCCT symbol missing', warnings: [] };
    }
    var FACE = occt.TopAbs_ShapeEnum.TopAbs_FACE;
    var SHAPE = occt.TopAbs_ShapeEnum.TopAbs_SHAPE;
    var REVERSED = occt.TopAbs_Orientation.TopAbs_REVERSED;

    var verts = [];
    var vmap = Object.create(null);
    function weld(x, y, z) {
      var key = Math.round(x * 1e4) + ',' + Math.round(y * 1e4) + ',' + Math.round(z * 1e4);
      var hit = vmap[key];
      if (hit !== undefined) return hit;
      var i = verts.length / 3;
      verts.push(x, y, z);
      vmap[key] = i;
      return i;
    }
    var tris = [];          // welded indices, 3 per triangle
    var triNormals = [];    // 3 per triangle (flat)
    var edgeFaces = Object.create(null);
    function addEdge(u, w, nx, ny, nz) {
      var lo = u < w ? u : w, hi = u < w ? w : u;
      var k = lo + '-' + hi;
      (edgeFaces[k] || (edgeFaces[k] = [])).push([nx, ny, nz, lo, hi]);
    }

    var mesher = null, exp = null;
    try {
      mesher = new IncMesh(shape, defl, false, 0.5, false);
      exp = new ExpCtor(shape, FACE, SHAPE);
      while (exp.More()) {
        var faceShape = occt.TopoDS.Face_1 ? occt.TopoDS.Face_1(exp.Current()) : occt.TopoDS.Face(exp.Current());
        var reversed = faceShape.Orientation_1 ? (faceShape.Orientation_1() === REVERSED) : (faceShape.Orientation() === REVERSED);
        var loc = new LocCtor();
        var triHandle = occt.BRep_Tool.Triangulation(faceShape, loc);
        if (triHandle && !triHandle.IsNull()) {
          var tri = triHandle.get();
          var trsf = loc.Transformation();
          var nbTri = tri.NbTriangles();
          var globalOf = function (localIdx) {
            var n = tri.Node(localIdx);
            var nt = n.Transformed(trsf);
            var gi = weld(nt.X(), nt.Y(), nt.Z());
            if (typeof nt.delete === 'function') nt.delete();
            return gi;
          };
          for (var t = 1; t <= nbTri; t++) {
            var trg = tri.Triangle(t);
            var a = globalOf(trg.Value(1));
            var b = globalOf(trg.Value(2));
            var c = globalOf(trg.Value(3));
            if (a === b || b === c || a === c) continue;
            var ax = verts[a * 3], ay = verts[a * 3 + 1], az = verts[a * 3 + 2];
            var bx = verts[b * 3], by = verts[b * 3 + 1], bz = verts[b * 3 + 2];
            var cx = verts[c * 3], cy = verts[c * 3 + 1], cz = verts[c * 3 + 2];
            var ux = bx - ax, uy = by - ay, uz = bz - az;
            var vx = cx - ax, vy = cy - ay, vz = cz - az;
            var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
            var L = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
            nx /= L; ny /= L; nz /= L;
            var ib = b, ic = c;
            if (reversed) { nx = -nx; ny = -ny; nz = -nz; ib = c; ic = b; }
            tris.push(a, ib, ic);
            triNormals.push(nx, ny, nz);
          }
        }
        if (loc && typeof loc.delete === 'function') loc.delete();
        exp.Next();
      }

      var positions = [], normals = [];
      var triangleCount = tris.length / 3;
      for (var ti = 0; ti < triangleCount; ti++) {
        var i0 = tris[ti * 3], i1 = tris[ti * 3 + 1], i2 = tris[ti * 3 + 2];
        var Nx = triNormals[ti * 3], Ny = triNormals[ti * 3 + 1], Nz = triNormals[ti * 3 + 2];
        var idxs = [i0, i1, i2];
        for (var q = 0; q < 3; q++) {
          var vi = idxs[q];
          positions.push(verts[vi * 3], verts[vi * 3 + 1], verts[vi * 3 + 2]);
          normals.push(Nx, Ny, Nz);
        }
        addEdge(i0, i1, Nx, Ny, Nz);
        addEdge(i1, i2, Nx, Ny, Nz);
        addEdge(i2, i0, Nx, Ny, Nz);
      }
      if (triangleCount === 0) return { ok: false, error: 'tessellate: empty mesh', warnings: [] };

      // Feature edges: boundary, or dihedral > 25°.
      var COS = Math.cos(25 * Math.PI / 180);
      var edges = [], edgeCount = 0;
      for (var key in edgeFaces) {
        var arr = edgeFaces[key];
        var keep = true;
        if (arr.length >= 2) {
          var d = arr[0][0] * arr[1][0] + arr[0][1] * arr[1][1] + arr[0][2] * arr[1][2];
          keep = d < COS;
        }
        if (!keep) continue;
        var lo = arr[0][3], hi = arr[0][4];
        edges.push(verts[lo * 3], verts[lo * 3 + 1], verts[lo * 3 + 2], verts[hi * 3], verts[hi * 3 + 1], verts[hi * 3 + 2]);
        edgeCount++;
      }

      var minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      for (var vj = 0; vj < verts.length / 3; vj++) {
        var x = verts[vj * 3], y = verts[vj * 3 + 1], z = verts[vj * 3 + 2];
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      }
      var sx = maxX - minX, sy = maxY - minY, sz = maxZ - minZ;
      return {
        ok: true,
        mesh: {
          positions: positions, normals: normals, edges: edges,
          triangleCount: triangleCount, edgeCount: edgeCount,
          bounds: {
            center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
            size: [sx, sy, sz],
            radius: 0.5 * Math.sqrt(sx * sx + sy * sy + sz * sz),
          },
        },
        warnings: [],
      };
    } catch (err) {
      return { ok: false, error: 'tessellate: ' + (err && err.message), warnings: [] };
    } finally {
      if (mesher && typeof mesher.delete === 'function') mesher.delete();
      if (exp && typeof exp.delete === 'function') exp.delete();
    }
  }

  // ─── dispatch ──────────────────────────────────────────────────────────

  // ─── W2 ceiling ops (mirror src/lib/occt/nodeOcctBridge.ts) ───────────────

  /** Planar face (sheet body) from a 2D loop at height z — input to thicken/trim. */
  function buildPlanarFace(loop, z) {
    if (!occt) return notReady();
    if (!Array.isArray(loop) || loop.length < 3) {
      return { ok: false, error: 'buildPlanarFace: loop must have >=3 points', warnings: [] };
    }
    var zz = typeof z === 'number' ? z : 0;
    var Polygon = occt.BRepBuilderAPI_MakePolygon_1 || occt.BRepBuilderAPI_MakePolygon;
    var Pnt = occt.gp_Pnt_3 || occt.gp_Pnt;
    var MakeFace = occt.BRepBuilderAPI_MakeFace_15 || occt.BRepBuilderAPI_MakeFace;
    if (!Polygon || !Pnt || !MakeFace) {
      return { ok: false, error: 'buildPlanarFace: required OCCT symbol missing', warnings: [] };
    }
    var polygon = null, points = [], wire = null, faceBuilder = null;
    try {
      polygon = new Polygon();
      for (var i = 0; i < loop.length; i++) {
        var p = loop[i];
        var pnt = new Pnt(p.x, p.y, zz);
        points.push(pnt);
        if (typeof polygon.Add_1 === 'function') polygon.Add_1(pnt); else polygon.Add(pnt);
      }
      polygon.Close();
      wire = polygon.Wire();
      // OnlyPlane=false matches the proven ceilingSpike face construction;
      // OnlyPlane=true produced a face that MakeThickSolidBySimple could not
      // thicken into a positive-volume solid ("kernel produced no solid").
      faceBuilder = new MakeFace(wire, false);
      var face = faceBuilder.Face();
      var h = alloc(face);
      return { ok: true, handle: h, kind: 'face', warnings: ['planar surface (sheet body)'] };
    } catch (err) {
      return { ok: false, error: 'buildPlanarFace: ' + (err && err.message), warnings: [] };
    } finally {
      if (faceBuilder && faceBuilder.delete) faceBuilder.delete();
      if (wire && wire.delete) wire.delete();
      if (polygon && polygon.delete) polygon.delete();
      for (var j = 0; j < points.length; j++) { if (points[j] && points[j].delete) points[j].delete(); }
    }
  }

  /** Thicken an open surface/shell into a solid (BRepOffsetAPI_MakeThickSolid). */
  function thicken(handle, thickness) {
    if (!occt) return notReady();
    var src = handles.get(handle);
    if (!src) return { ok: false, error: 'thicken: unknown handle (' + handle + ')', warnings: [] };
    if (!(thickness > 0) || !isFinite(thickness)) {
      return { ok: false, error: 'thicken: thickness must be positive finite, got ' + thickness, warnings: [] };
    }
    var MTS = occt.BRepOffsetAPI_MakeThickSolid_1 || occt.BRepOffsetAPI_MakeThickSolid;
    if (!MTS) return { ok: false, error: 'thicken: BRepOffsetAPI_MakeThickSolid unavailable', warnings: [] };
    // Prefer the offset sign that yields a positively-oriented solid (+volume).
    var chosen = null, fallback = null;
    var offs = [thickness, -thickness];
    for (var k = 0; k < offs.length && !chosen; k++) {
      var mts = null;
      try {
        mts = new MTS();
        if (typeof mts.MakeThickSolidBySimple !== 'function') {
          if (mts.delete) mts.delete();
          return { ok: false, error: 'thicken: MakeThickSolidBySimple unavailable', warnings: [] };
        }
        mts.MakeThickSolidBySimple(src, offs[k]);
        if (typeof mts.Build === 'function') mts.Build();
        if (typeof mts.IsDone === 'function' && !mts.IsDone()) { if (mts.delete) mts.delete(); continue; }
        var shape = mts.Shape();
        var v = shapeMetrics(shape).volume;
        if (isFinite(v) && Math.abs(v) > 1e-9) {
          if (v > 0) chosen = shape;
          else if (!fallback) fallback = shape;
        }
      } catch (err) {
        void err; // try the other sign
      } finally {
        if (mts && mts.delete) mts.delete();
      }
    }
    var result = chosen || fallback;
    if (!result) return { ok: false, error: 'thicken: kernel produced no solid for +/-thickness', warnings: [] };
    var h = alloc(result);
    return { ok: true, handle: h, kind: 'solid', warnings: ['thickened surface -> solid'] };
  }

  /** Surface-surface trim: section (intersection edges) of two shapes. */
  function surfaceTrim(handleA, handleB) {
    if (!occt) return notReady();
    var a = handles.get(handleA);
    var b = handles.get(handleB);
    if (!a || !b) return { ok: false, error: 'surfaceTrim: unknown handle (a=' + handleA + ', b=' + handleB + ')', warnings: [] };
    var Section = occt.BRepAlgoAPI_Section_3;
    if (!Section) return { ok: false, error: 'surfaceTrim: BRepAlgoAPI_Section_3 unavailable', warnings: [] };
    var sec = null;
    try {
      sec = new Section(a, b, true);
      if (typeof sec.Build === 'function') sec.Build();
      var shape = sec.Shape();
      // Count section edges to distinguish "trimmed" from "disjoint".
      var edges = 0;
      try {
        var en = occt.TopAbs_ShapeEnum;
        if (occt.TopExp_Explorer_2 && en) {
          var exp = new occt.TopExp_Explorer_2(shape, en.TopAbs_EDGE, en.TopAbs_SHAPE);
          while (exp.More()) { edges++; exp.Next(); }
          if (exp.delete) exp.delete();
        } else {
          edges = 1; // can't count — assume intersection present
        }
      } catch (_e) { void _e; edges = 1; }
      if (edges === 0) return { ok: false, error: 'surfaceTrim: shapes do not intersect (no section edges)', warnings: [] };
      var h = alloc(shape);
      return { ok: true, handle: h, kind: 'compound', warnings: ['section: ' + edges + ' intersection edge(s)'] };
    } catch (err) {
      return { ok: false, error: 'surfaceTrim: ' + (err && err.message), warnings: [] };
    } finally {
      if (sec && sec.delete) sec.delete();
    }
  }

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
            function (err) {
              reply({
                reqId: reqId,
                ok: false,
                error: 'occt-real init: ' + ((err && err.message) ? err.message : String(err)),
                warnings: [],
              });
            },
          );
          return;

        case 'buildFromExtrude':
          makeShapePayload(reqId, buildFromExtrude(args.feature));
          return;

        case 'buildFromRevolve':
          makeShapePayload(reqId, buildFromRevolve(args.feature));
          return;

        case 'buildPrismAt':
          makeShapePayload(reqId, buildPrismAt(args.loop || [], args.z0, args.heightMm));
          return;

        case 'buildConeAt':
          makeShapePayload(reqId, buildConeAt(args.center, args.z0, args.heightMm, args.radius0, args.radius1));
          return;

        case 'buildThreadHelixCutter':
          makeShapePayload(reqId, buildThreadHelixCutter(args.opts));
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

        case 'variableFillet':
          var variableEdges = Array.isArray(args.edges) ? args.edges : [];
          makeShapePayload(reqId, variableFilletWithRecovery(args.handle, variableEdges));
          return;

        case 'lawFillet':
          makeShapePayload(reqId, lawFilletWithRecovery(
            args.handle,
            Array.isArray(args.edges) ? args.edges : [],
            args.options || { continuity: 'G1' }
          ));
          return;

        case 'buildPlanarFace':
          makeShapePayload(reqId, buildPlanarFace(args.loop, args.z));
          return;

        case 'thicken':
          makeShapePayload(reqId, thicken(args.handle, args.dim));
          return;

        case 'surfaceTrim':
          makeShapePayload(reqId, surfaceTrim(args.handleA, args.handleB));
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

        case 'tessellate': {
          const tr = tessellate(args.handle, args.deflection);
          if (!tr.ok) { reply({ reqId: reqId, ok: false, error: tr.error, warnings: tr.warnings || [] }); return; }
          reply({ reqId: reqId, ok: true, mesh: tr.mesh, warnings: tr.warnings || [] });
          return;
        }

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

  // Test introspection seam — never used in production, but lets the
  // activation test verify the handle-table + mode state without going
  // through the postMessage round-trip. Properties are wrapped in a getter
  // so they reflect live state.
  Object.defineProperty(self, '__OCCT_REAL_INTROSPECT__', {
    configurable: true,
    enumerable: false,
    get: function () {
      return {
        get mode() { return mode; },
        get reason() { return modeReason; },
        get occt() { return occt; },
        get handles() { return handles; },
        get edgeTopos() { return edgeTopos; },
        get faceTopos() { return faceTopos; },
        get nextHandle() { return nextHandle; },
        // Op handlers exposed so the test can invoke them directly with a
        // mock module installed.
        ops: {
          buildFromExtrude: buildFromExtrude,
          buildFromRevolve: buildFromRevolve,
          buildPrismAt: buildPrismAt,
          buildConeAt: buildConeAt,
          buildThreadHelixCutter: buildThreadHelixCutter,
          booleanOp: booleanOp,
          filletOrChamfer: filletOrChamfer,
          variableFilletWithRecovery: variableFilletWithRecovery,
          lawFilletWithRecovery: lawFilletWithRecovery,
          exportSTEP: exportSTEP,
          importSTEP: importSTEP,
          tessellate: tessellate,
          freeHandle: freeHandle,
          alloc: alloc,
          shapeMetrics: shapeMetrics,
        },
        // Allow tests to set `occt` directly (post-init) so they can drive
        // ops without going through the factory hook.
        setOcct: function (m) { occt = m; if (m) { mode = 'ready'; modeReason = ''; } },
      };
    },
  });
})();
