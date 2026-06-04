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
          return p === 'opencascade.wasm' ? './opencascade.wasm' : p;
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
  let nextHandle = 1;

  function alloc(shape) {
    const h = nextHandle++;
    handles.set(h, shape);
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
    try {
      if (typeof occt.Bnd_Box === 'function' && occt.BRepBndLib && typeof occt.BRepBndLib.Add === 'function') {
        var bnd = new occt.Bnd_Box();
        try {
          occt.BRepBndLib.Add(shape, bnd, true);
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
      if (typeof occt.GProp_GProps === 'function' && occt.BRepGProp) {
        if (typeof occt.BRepGProp.VolumeProperties === 'function') {
          var vp = new occt.GProp_GProps();
          try {
            occt.BRepGProp.VolumeProperties(shape, vp);
            out.volume = vp.Mass();
            var com = vp.CentreOfMass();
            out.centerOfMass = { x: com.X(), y: com.Y(), z: com.Z() };
            if (typeof com.delete === 'function') com.delete();
          } finally {
            if (typeof vp.delete === 'function') vp.delete();
          }
        }
        if (typeof occt.BRepGProp.SurfaceProperties === 'function') {
          var sp = new occt.GProp_GProps();
          try {
            occt.BRepGProp.SurfaceProperties(shape, sp);
            out.area = sp.Mass();
          } finally {
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
        var pnt = new Pnt(p.x, p.y, 0);
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
      var h = alloc(shape);
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
    var warnings = [];
    if (typeof feature.angleDegrees === 'number' && feature.angleDegrees < 360) {
      warnings.push('phase1: partial sweep ' + feature.angleDegrees + 'deg uses full revolve envelope');
    }

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
        revolBuilder = new MakeRevol(face, axis, false);
      } else {
        // Fall back to whatever MakeRevol overload exists on the module.
        revolBuilder = new MakeRevol(face);
      }
      var shape = revolBuilder.Shape();
      var h = alloc(shape);
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
      var h = alloc(shape);
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
  function filletOrChamfer(op, handle, edgeIds, dim) {
    if (!occt) return notReady();
    var src = handles.get(handle);
    if (!src) return { ok: false, error: op + ': unknown handle', warnings: [] };
    if (!isFinite(dim) || !(dim > 0)) {
      return { ok: false, error: op + ': dim must be positive finite', warnings: [] };
    }

    var Algo = op === 'fillet'
      ? (occt.BRepFilletAPI_MakeFillet_1 || occt.BRepFilletAPI_MakeFillet)
      : (occt.BRepFilletAPI_MakeChamfer_1 || occt.BRepFilletAPI_MakeChamfer);
    if (!Algo) return { ok: false, error: op + ': OCCT symbol missing', warnings: [] };

    var algo = null;
    var explorer = null;
    var warnings = ['phase1: ' + op + ' applied to all edges (edgeIds=' + (edgeIds ? edgeIds.length : 0) + ' ignored)'];
    try {
      algo = new Algo(src);
      // Iterate TopExp_Explorer with TopAbs_EDGE to add every edge.
      if (typeof occt.TopExp_Explorer_2 === 'function' && occt.TopAbs_ShapeEnum) {
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
      } else if (typeof algo.Add === 'function') {
        // Stub path — no explorer, just no edges. Algo.Build() still runs.
        void edgeIds;
      }
      if (typeof algo.Build === 'function') algo.Build();
      var shape = algo.Shape();
      var h = alloc(shape);
      return { ok: true, handle: h, kind: 'solid', warnings: warnings };
    } catch (err) {
      return { ok: false, error: op + ': ' + (err && err.message), warnings: warnings };
    } finally {
      if (explorer && typeof explorer.delete === 'function') explorer.delete();
      if (algo && typeof algo.delete === 'function') algo.delete();
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
      // Embind: Transfer(shape, modelType) → IFSelect_ReturnStatus
      writer.Transfer(shape, modelType);
      var path = '/tmp/out.step';
      // Real OCCT supports Write(path) (writes to MEMFS) — read back via FS.
      writer.Write(path);
      var step = null;
      if (occt.FS && typeof occt.FS.readFile === 'function') {
        step = occt.FS.readFile(path, { encoding: 'utf8' });
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
      var path = '/tmp/in.step';
      if (occt.FS && typeof occt.FS.writeFile === 'function') {
        occt.FS.writeFile(path, source);
      } else {
        return { ok: false, error: 'importSTEP: occt.FS unavailable', warnings: [] };
      }
      reader = new Reader();
      var status = reader.ReadFile(path);
      var retDone = (occt.IFSelect_ReturnStatus && (occt.IFSelect_ReturnStatus.RetDone ?? 1)) || 1;
      if (status !== retDone) {
        return { ok: false, error: 'importSTEP: parse failed (status=' + status + ')', warnings: [] };
      }
      reader.TransferRoots();
      var shape = reader.OneShape();
      var h = alloc(shape);
      return { ok: true, handle: h, kind: 'solid', warnings: [] };
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
        get nextHandle() { return nextHandle; },
        // Op handlers exposed so the test can invoke them directly with a
        // mock module installed.
        ops: {
          buildFromExtrude: buildFromExtrude,
          buildFromRevolve: buildFromRevolve,
          booleanOp: booleanOp,
          filletOrChamfer: filletOrChamfer,
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
