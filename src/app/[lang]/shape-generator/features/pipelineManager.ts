import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Evaluator, Brush, SUBTRACTION } from 'three-bvh-csg';
import type { FeatureDefinition, FeatureInstance, MapBackedFeatureType } from './types';
import { classifyFeatureError } from './featureDiagnostics';
import { profileToGeometry, countContourEdgesPerSegment, brepContourPoints } from '../sketch/extrudeProfile';
import { reportError } from '../lib/telemetry';
import {
  cacheGet,
  cachePut,
  cacheDelete,
  featureCacheKey,
  stampGeoId,
  getGeoId,
  type PipelineCacheKernel,
} from './pipelineCache';
import { resetShapeRegistry, ensureOcctReady, isOcctReady, isOcctGlobalMode, occtExtrudeProfile, occtExtrudeProfileOnFrame, occtExtrudeCircle, occtRevolveProfile, occtBaseSolid, getShape, registerShape } from './occtEngine';
import {
  stampFaceFeatureIdAll,
  configureEvaluatorForProvenance,
  propagateFeatureIdMap,
} from './faceProvenance';
// Topology naming — Phase-2 step A. `runSketchExtrude` now stamps the
// resulting geometry with the persistent sketch-segment hashes so that
// downstream selection lookups (and eventually per-edge fillet/chamfer)
// can resolve a clicked face/edge back to its authoring profile segment.
// Triangle ↔ segment index mapping is still coarse (per-feature, not
// per-triangle); per-triangle mapping is phase-2 step B.
import { TopologyRegistry } from './topologyTracker';

/**
 * Feature pipeline manager (#98 phase 2d-2).
 *
 * Owns the per-run orchestration that was previously inline in
 * applyFeaturePipelineDetailed:
 *   - Shape-registry reset (OCCT handles don't outlive a single pass)
 *   - Per-feature cache lookup / store
 *   - sketchExtrude inline path
 *   - FEATURE_MAP dispatch + rollback on failure
 *   - Error collection for the UI error panel
 *
 * Sync entry is the default. An async entry is available for callers that
 * want OCCT pre-initialised before the loop runs — the loop itself stays
 * synchronous because FeatureDefinition.apply is sync.
 */

export interface PipelineResult {
  geometry: THREE.BufferGeometry;
  errors: Record<string, string>;
}

export interface PipelineOptions {
  /** When true, await ensureOcctReady() before running. Only relevant to the
   *  async entry — sync callers must have pre-initialised separately. */
  occtMode?: boolean;
  /** Optional callback to report progress. Only supported in async mode. */
  onProgress?: (progress: number, label: string) => void;
  /** Base primitive spec. When OCCT mode is on, the async entry rebuilds this
   *  primitive as a real B-rep solid IN THIS CONTEXT (worker or main) and seeds
   *  its handle onto the base geometry, so the OCCT chain starts from the base
   *  (a cylinder/sphere fillet then rounds the real shape, not its bbox). The
   *  occtHandle can't cross the worker boundary, hence we pass the spec, not a
   *  handle. */
  baseSpec?: { shapeId: string; params: Record<string, number> };
}

// The FEATURE_MAP is provided by the caller rather than imported here to keep
// this module free of the feature-def import graph (avoids circular imports).
export type FeatureMap = Record<MapBackedFeatureType, FeatureDefinition>;

export function runPipeline(
  baseGeometry: THREE.BufferGeometry,
  features: FeatureInstance[],
  featureMap: FeatureMap,
): PipelineResult {
  resetShapeRegistry();
  return runLoopSync(baseGeometry, features, featureMap, 'mesh');
}

/** Variant that resolves a ConfigurationManager's active config first. */
export function runPipelineWithConfig(
  baseGeometry: THREE.BufferGeometry,
  features: FeatureInstance[],
  featureMap: FeatureMap,
  configManager: { applyConfig(baseFeatures: FeatureInstance[]): FeatureInstance[] } | null | undefined,
): PipelineResult {
  const resolved = configManager ? configManager.applyConfig(features) : features;
  return runPipeline(baseGeometry, resolved, featureMap);
}

export async function runPipelineAsync(
  baseGeometry: THREE.BufferGeometry,
  features: FeatureInstance[],
  featureMap: FeatureMap,
  opts: PipelineOptions = {},
): Promise<PipelineResult> {
  if (opts.onProgress) opts.onProgress(0, 'Initializing Engine');
  if (opts.occtMode) {
    try {
      await ensureOcctReady();
    } catch (err) {
      // OCCT init failure is non-fatal — the features will silently fall
      // back to their legacy mesh paths via isOcctReady() checks.
      const msg = err instanceof Error ? err.message : String(err);
      const ft = features.find(f => f.enabled)?.type ?? features[0]?.type ?? 'sketchExtrude';
      reportError('feature_pipeline', err, {
        stage: 'occt_init',
        diagnosticCode: classifyFeatureError(ft, msg, { nodeId: features.find(f => f.enabled)?.id }).code,
        featureType: ft,
      });
    }
  }
  resetShapeRegistry();
  // Seed a real B-rep base handle (this context's registry) so the chain starts
  // from a cylinder/sphere base instead of its bounding box. Built AFTER the
  // reset so it survives into the loop; mesh display untouched (handle-only).
  if (opts.occtMode && opts.baseSpec && isOcctReady()) {
    try {
      const base = occtBaseSolid(opts.baseSpec.shapeId, opts.baseSpec.params);
      if (base.handle) baseGeometry.userData = { ...baseGeometry.userData, occtHandle: base.handle };
    } catch { /* mesh fallback — no handle */ }
  }
  const cacheKernel: PipelineCacheKernel = opts.occtMode ? 'occt' : 'mesh';
  return await runLoopAsync(baseGeometry, features, featureMap, cacheKernel, opts.onProgress);
}

// ─── Internal loop ──────────────────────────────────────────────────────────

function runLoopSync(
  baseGeometry: THREE.BufferGeometry,
  features: FeatureInstance[],
  featureMap: FeatureMap,
  cacheKernel: PipelineCacheKernel,
): PipelineResult {
  let geo = baseGeometry.clone();
  const baseId = getGeoId(baseGeometry) ?? stampGeoId(baseGeometry);
  stampGeoId(geo, baseId);
  const errors: Record<string, string> = {};

  for (const f of features) {
    if (!f.enabled) continue;

    const upstreamId = getGeoId(geo) ?? stampGeoId(geo);
    const key = featureCacheKey(f, upstreamId, cacheKernel);
    const cached = cacheGet(key);
    if (cached) {
      geo = cached;
      continue;
    }

    if (f.type === 'sketchExtrude') {
      geo = runSketchExtrude(f, geo, key, errors);
      continue;
    }

    const def = featureMap[f.type];
    if (!def) continue;
    try {
      const prev = geo.clone();
      const next = def.apply(geo, f.params, {
        featureId: f.id,
        targetEdgeIds: f.targetEdgeIds,
        targetFaceIds: f.targetFaceIds,
      });
      if (!next || !next.attributes.position || next.attributes.position.count === 0) {
        cacheDelete(key);
        const emptyMsg = 'Feature produced empty geometry';
        errors[f.id] = emptyMsg;
        reportError('feature_pipeline', 'empty geometry', {
          featureId: f.id,
          featureType: f.type,
          diagnosticCode: classifyFeatureError(f.type, emptyMsg, { nodeId: f.id }).code,
        });
        geo = prev;
        continue;
      }
      next.computeVertexNormals();
      stampGeoId(next);
      // B1 (face provenance): tag the output. `stampFaceFeatureIdAll` writes
      // the per-triangle `nfabFaceFeatureId` BufferAttribute *and* keeps the
      // coarse `userData.lastFeatureId` in sync so consumers that have not
      // migrated to the deep reader still get the right answer. Today every
      // triangle on this output is stamped with the current feature's id;
      // CSG-aware features (boolean) can override this by pre-tagging their
      // tool before calling applyCSG, and the Evaluator preserves the
      // attribute so the mixed result keeps the correct per-triangle ids.
      stampFaceFeatureIdAll(next, f.id);
      cachePut(key, next);
      geo = next;
    } catch (e) {
      cacheDelete(key);
      const msg = e instanceof Error ? e.message : String(e);
      errors[f.id] = msg;
      reportError('feature_pipeline', e, {
        featureId: f.id,
        featureType: f.type,
        params: f.params,
        diagnosticCode: classifyFeatureError(f.type, msg, { nodeId: f.id }).code,
      });
    }
  }
  return { geometry: geo, errors };
}

async function runLoopAsync(
  baseGeometry: THREE.BufferGeometry,
  features: FeatureInstance[],
  featureMap: FeatureMap,
  cacheKernel: PipelineCacheKernel,
  onProgress?: (progress: number, label: string) => void,
): Promise<PipelineResult> {
  let geo = baseGeometry.clone();
  const baseId = getGeoId(baseGeometry) ?? stampGeoId(baseGeometry);
  stampGeoId(geo, baseId);
  const errors: Record<string, string> = {};

  const enabledFeatures = features.filter(f => f.enabled);
  let computed = 0;

  for (const f of enabledFeatures) {
    if (onProgress) {
      onProgress(Math.floor((computed / enabledFeatures.length) * 100), `Evaluating ${f.type}`);
      await new Promise(r => setTimeout(r, 0)); // Yield to event loop
    }

    const upstreamId = getGeoId(geo) ?? stampGeoId(geo);
    const key = featureCacheKey(f, upstreamId, cacheKernel);
    const cached = cacheGet(key);
    if (cached) {
      geo = cached;
      computed++;
      continue;
    }

    if (f.type === 'sketchExtrude') {
      geo = runSketchExtrude(f, geo, key, errors);
      computed++;
      continue;
    }

    const def = featureMap[f.type];
    if (!def) {
      computed++;
      continue;
    }
    
    try {
      const prev = geo.clone();
      // OCCT-backed features expose `applyAsync` — the whole point of the
      // async loop is to await them. Falling back to the sync `apply` here
      // would defeat the override (sync features just stay sync).
      const featureCtx = {
        featureId: f.id,
        targetEdgeIds: f.targetEdgeIds,
        targetFaceIds: f.targetFaceIds,
        edgeSelections: f.edgeSelections,
        faceSelections: f.faceSelections,
      };
      const next = def.applyAsync
        ? await def.applyAsync(geo, f.params, featureCtx)
        : def.apply(geo, f.params, featureCtx);
      if (!next || !next.attributes.position || next.attributes.position.count === 0) {
        cacheDelete(key);
        const emptyMsg = 'Feature produced empty geometry';
        errors[f.id] = emptyMsg;
        reportError('feature_pipeline', 'empty geometry', {
          featureId: f.id,
          featureType: f.type,
          diagnosticCode: classifyFeatureError(f.type, emptyMsg, { nodeId: f.id }).code,
        });
        geo = prev;
        computed++;
        continue;
      }
      next.computeVertexNormals();
      stampGeoId(next);
      // B1 (face provenance) — see sync loop for rationale.
      stampFaceFeatureIdAll(next, f.id);
      cachePut(key, next);
      geo = next;
    } catch (e) {
      cacheDelete(key);
      const msg = e instanceof Error ? e.message : String(e);
      errors[f.id] = msg;
      reportError('feature_pipeline', e, {
        featureId: f.id,
        featureType: f.type,
        params: f.params,
        diagnosticCode: classifyFeatureError(f.type, msg, { nodeId: f.id }).code,
      });
    }
    computed++;
  }
  
  if (onProgress) onProgress(100, 'Finishing Output');
  return { geometry: geo, errors };
}

function runSketchExtrude(
  f: FeatureInstance,
  geo: THREE.BufferGeometry,
  key: string,
  errors: Record<string, string>,
): THREE.BufferGeometry {
  if (!f.sketchData) return geo;
  const prev = geo.clone();
  try {
    const { profile, config, plane, planeOffset, operation, faceFrame } = f.sketchData;
    const sketchGeo = profileToGeometry(profile, config);
    if (!sketchGeo || !sketchGeo.attributes.position || sketchGeo.attributes.position.count === 0) {
      cacheDelete(key);
      const errSketch = 'Sketch produced empty geometry';
      errors[f.id] = errSketch;
      reportError('feature_pipeline', errSketch, {
        featureId: f.id,
        featureType: 'sketchExtrude',
        diagnosticCode: classifyFeatureError('sketchExtrude', errSketch, { nodeId: f.id }).code,
      });
      return geo;
    }

    if (faceFrame) {
      // Phase-2 tilted face: profileToGeometry already produced an XY-plane
      // extrusion (axis = +Z). Map (x, y, z) ↦ origin + x·u + y·v + z·n
      // by feeding [u, v, n] as basis columns into a Matrix4.
      const u = new THREE.Vector3(...faceFrame.uAxis);
      const v = new THREE.Vector3(...faceFrame.vAxis);
      const n = new THREE.Vector3(...faceFrame.normal);
      const m = new THREE.Matrix4().makeBasis(u, v, n);
      m.setPosition(new THREE.Vector3(...faceFrame.origin));
      sketchGeo.applyMatrix4(m);
    } else {
      if (plane === 'xz') sketchGeo.rotateX(Math.PI / 2);
      else if (plane === 'yz') sketchGeo.rotateY(Math.PI / 2);

      if (planeOffset !== 0) {
        if (plane === 'xy') sketchGeo.translate(0, 0, planeOffset);
        else if (plane === 'xz') sketchGeo.translate(0, planeOffset, 0);
        else sketchGeo.translate(planeOffset, 0, 0);
      }
    }
    sketchGeo.computeVertexNormals();

    // operation === 'subtract' → CSG cut via three-bvh-csg.
    // Anything else (add) → fast merge path that was already working.
    // Phase-3d — provenance prep. Stamp the tool with this feature's id so
    // CSG-derived triangles carry it through; the base already has its own
    // id from upstream. configureEvaluatorForProvenance keeps the per-triangle
    // attribute alive across the boolean. propagateFeatureIdMap copies the
    // numeric → string registry from both inputs onto the result so the
    // SelectionMesh can resolve a hit triangle back to whichever feature it
    // came from.
    stampFaceFeatureIdAll(sketchGeo, f.id);
    let result: THREE.BufferGeometry | null = null;
    if (operation === 'subtract') {
      try {
        const ev = new Evaluator();
        configureEvaluatorForProvenance(ev, geo, sketchGeo);
        const a = new Brush(geo, new THREE.MeshStandardMaterial());
        const b = new Brush(sketchGeo, new THREE.MeshStandardMaterial());
        a.updateMatrixWorld();
        b.updateMatrixWorld();
        const out = ev.evaluate(a, b, SUBTRACTION);
        result = out.geometry;
        if (result) propagateFeatureIdMap(result, geo, sketchGeo);
      } catch (csgErr) {
        // CSG can throw on degenerate input; fall back to additive merge
        // so the user at least sees their geometry rather than a void.
        reportError('feature_pipeline', csgErr, {
          featureId: f.id,
          featureType: 'sketchExtrude',
          diagnosticCode: 'csg_subtract_failed',
        });
        result = mergeGeometries([geo, sketchGeo], false);
        if (result) propagateFeatureIdMap(result, geo, sketchGeo);
      }
    } else {
      result = mergeGeometries([geo, sketchGeo], false);
      if (result) propagateFeatureIdMap(result, geo, sketchGeo);
    }
    if (!result || !result.attributes.position || result.attributes.position.count === 0) {
      cacheDelete(key);
      const errMerge = operation === 'subtract'
        ? 'Sketch subtract produced empty geometry'
        : 'Sketch merge produced empty geometry';
      errors[f.id] = errMerge;
      reportError('feature_pipeline', errMerge, {
        featureId: f.id,
        featureType: 'sketchExtrude',
        diagnosticCode: classifyFeatureError('sketchExtrude', errMerge, { nodeId: f.id }).code,
      });
      return prev;
    }
    result.computeVertexNormals();
    stampGeoId(result);
    // Phase-2 step A — stamp the persistent hashes derived from this
    // sketch's segments + cap labels. Triangle-index mapping comes in a
    // later step; for now we record the available hashes so selection
    // lookups can fall back to "any face from this feature" while we
    // build the per-triangle table.
    const segHashes = profile.segments.map((seg, i) =>
      TopologyRegistry.hashSketchSegment(f.id, seg.type ?? 'seg', i),
    );
    const sweepFaceHashes = segHashes.map(h => TopologyRegistry.hashExtrudedFace(f.id, h));
    const capTop = TopologyRegistry.hashExtrudedFace(f.id, 'cap', 'top');
    const capBottom = TopologyRegistry.hashExtrudedFace(f.id, 'cap', 'bottom');
    // Phase-3e — per-segment triangle ranges accounting for arc/NURBS
    // tessellation. Each contour edge contributes 2 triangles to the side
    // material group (steps:1, no bevel). countContourEdgesPerSegment
    // mirrors profileToPoints's sampling so the cumulative ranges align
    // with the ExtrudeGeometry vertex order.
    const edgeCounts = countContourEdgesPerSegment(profile);
    const sideSegmentRanges: { startTri: number; endTri: number; hash: string }[] = [];
    let triCursor = 0;
    edgeCounts.forEach((count, i) => {
      const segTris = count * 2;
      sideSegmentRanges.push({
        startTri: triCursor,
        endTri: triCursor + segTris,
        hash: sweepFaceHashes[i],
      });
      triCursor += segTris;
    });
    // Phase-3d — keep a per-feature topology map so a face from `geo`
    // (added by a previous sketchExtrude or a base shape) still resolves
    // to its own hash table after this boolean. `topoSketchExtrudeHashes`
    // is kept as a legacy single-feature shortcut for callers that haven't
    // migrated to the map yet.
    const thisFeatureTopo = {
      featureId: f.id,
      sweepFaces: sweepFaceHashes,
      caps: [capTop, capBottom] as [string, string],
      sideSegmentRanges,
    };
    const carriedMap = (geo.userData as { topoFaceMapByFeature?: Record<string, typeof thisFeatureTopo> } | undefined)
      ?.topoFaceMapByFeature ?? {};
    const mergedMap = { ...carriedMap, [f.id]: thisFeatureTopo };

    // B-rep chain (Phase 1 + 2): attach a real replicad solid handle so
    // downstream OCCT fillet/chamfer/hole/boolean operate on the true solid
    // instead of its bounding box. The displayed mesh + provenance above stay
    // on the mesh path (untouched) — we ONLY attach `occtHandle`, and the
    // B-rep solid is the same shape as the displayed mesh. Three cases for a
    // planar-XY straight extrude:
    //   • add, upstream empty        → the extruded tool itself (chain start)
    //   • add, upstream is B-rep     → host.fuse(tool)   (multi-body union)
    //   • subtract, upstream is B-rep → host.cut(tool)   (pocket / cut)
    // Any failure → no handle → existing bbox fallback (zero regression).
    let brepHandle: string | null = null;
    const upstreamHandle = (geo.userData?.occtHandle as string | undefined) ?? null;
    const upstreamEmpty = !geo.attributes.position || (geo.attributes.position.count ?? 0) === 0;
    const faceFrameExtrude = !!faceFrame && config.mode === 'extrude';
    if (
      (faceFrameExtrude
        || (!faceFrame
          && (plane === 'xy' || plane == null)
          && (config.mode === 'extrude' || config.mode === 'revolve')))
      && isOcctReady()
      && isOcctGlobalMode()
    ) {
      try {
        // revolve → solid of revolution; single circle → exact cylinder;
        // rect/polyline → polygon-contour extrude. sketch-on-face → extrude the
        // (u,v) contour on the face frame along its normal.
        const segs = profile.segments;
        const depth = config.depth ?? 0;
        const off = planeOffset ?? 0;
        let tool: { geometry: THREE.BufferGeometry; handle: string | null };
        if (faceFrameExtrude) {
          const pts = brepContourPoints(profile);
          tool = pts ? occtExtrudeProfileOnFrame(pts, depth, faceFrame!) : { geometry: geo, handle: null };
        } else if (config.mode === 'revolve') {
          // B-rep revolve v1: full 360° about Y on x≥0 profiles only; anything
          // else → no handle, mesh (LatheGeometry) path stands.
          const axisOk = (config.revolveAxis ?? 'y') === 'y';
          const fullTurn = Math.abs((config.revolveAngle ?? 360) - 360) < 0.5;
          const pts = (axisOk && fullTurn) ? brepContourPoints(profile) : null;
          tool = pts ? occtRevolveProfile(pts, {}, off) : { geometry: geo, handle: null };
        } else if (segs.length === 1 && segs[0].type === 'circle') {
          const c = segs[0].points[0], rim = segs[0].points[1];
          const rr = Math.hypot(rim.x - c.x, rim.y - c.y);
          tool = occtExtrudeCircle(rr, c.x, c.y, depth, {}, off);
        } else {
          const pts = brepContourPoints(profile);
          tool = pts ? occtExtrudeProfile(pts, depth, {}, off) : { geometry: geo, handle: null };
        }
        if (tool.handle) {
          if (upstreamEmpty && operation !== 'subtract') {
            brepHandle = tool.handle; // first solid — starts the chain
          } else if (upstreamHandle) {
            const host = getShape(upstreamHandle) as
              { cut?: (o: unknown) => unknown; fuse?: (o: unknown) => unknown } | null;
            const toolSolid = getShape(tool.handle);
            if (host && toolSolid) {
              const res = operation === 'subtract'
                ? host.cut?.(toolSolid)
                : host.fuse?.(toolSolid);
              if (res) brepHandle = registerShape(res);
            }
          }
        }
      } catch {
        brepHandle = null; // never break the working mesh path
      }
    }

    result.userData = {
      ...result.userData,
      topoSketchExtrudeHashes: thisFeatureTopo,
      topoFaceMapByFeature: mergedMap,
      ...(brepHandle ? { occtHandle: brepHandle } : {}),
    };
    cachePut(key, result);
    return result;
  } catch (e) {
    cacheDelete(key);
    const msg = e instanceof Error ? e.message : String(e);
    errors[f.id] = msg;
    reportError('feature_pipeline', e, {
      featureId: f.id,
      featureType: 'sketchExtrude',
      diagnosticCode: classifyFeatureError('sketchExtrude', msg, { nodeId: f.id }).code,
    });
    return prev;
  }
}
