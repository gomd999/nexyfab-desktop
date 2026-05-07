import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { FeatureDefinition, FeatureInstance, MapBackedFeatureType } from './types';
import { classifyFeatureError } from './featureDiagnostics';
import { profileToGeometry } from '../sketch/extrudeProfile';
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
import { resetShapeRegistry, ensureOcctReady } from './occtEngine';

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
      const next = def.apply(geo, f.params);
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
      const next = def.apply(geo, f.params);
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
    const { profile, config, plane, planeOffset, operation } = f.sketchData;
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

    if (plane === 'xz') sketchGeo.rotateX(Math.PI / 2);
    else if (plane === 'yz') sketchGeo.rotateY(Math.PI / 2);

    if (planeOffset !== 0) {
      if (plane === 'xy') sketchGeo.translate(0, 0, planeOffset);
      else if (plane === 'xz') sketchGeo.translate(0, planeOffset, 0);
      else sketchGeo.translate(planeOffset, 0, 0);
    }
    sketchGeo.computeVertexNormals();

    // NB: subtract currently falls back to additive merge — real CSG subtract
    // is handled by the async worker elsewhere. This preserves the legacy
    // behaviour so we can migrate without changing semantics here.
    void operation;
    const merged = mergeGeometries([geo, sketchGeo], false);
    if (!merged || !merged.attributes.position || merged.attributes.position.count === 0) {
      cacheDelete(key);
      const errMerge = 'Sketch merge produced empty geometry';
      errors[f.id] = errMerge;
      reportError('feature_pipeline', errMerge, {
        featureId: f.id,
        featureType: 'sketchExtrude',
        diagnosticCode: classifyFeatureError('sketchExtrude', errMerge, { nodeId: f.id }).code,
      });
      return prev;
    }
    merged.computeVertexNormals();
    stampGeoId(merged);
    cachePut(key, merged);
    return merged;
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
