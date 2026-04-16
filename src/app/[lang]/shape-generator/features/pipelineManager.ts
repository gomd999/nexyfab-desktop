import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { FeatureDefinition, FeatureInstance, FeatureType } from './types';
import { profileToGeometry } from '../sketch/extrudeProfile';
import { reportError } from '../lib/telemetry';
import { cacheGet, cachePut, featureCacheKey, stampGeoId, getGeoId } from './pipelineCache';
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
}

// The FEATURE_MAP is provided by the caller rather than imported here to keep
// this module free of the feature-def import graph (avoids circular imports).
export type FeatureMap = Record<FeatureType, FeatureDefinition>;

export function runPipeline(
  baseGeometry: THREE.BufferGeometry,
  features: FeatureInstance[],
  featureMap: FeatureMap,
): PipelineResult {
  resetShapeRegistry();
  return runLoop(baseGeometry, features, featureMap);
}

export async function runPipelineAsync(
  baseGeometry: THREE.BufferGeometry,
  features: FeatureInstance[],
  featureMap: FeatureMap,
  opts: PipelineOptions = {},
): Promise<PipelineResult> {
  if (opts.occtMode) {
    try {
      await ensureOcctReady();
    } catch (err) {
      // OCCT init failure is non-fatal — the features will silently fall
      // back to their legacy mesh paths via isOcctReady() checks.
      reportError('feature_pipeline', err, { stage: 'occt_init' });
    }
  }
  resetShapeRegistry();
  return runLoop(baseGeometry, features, featureMap);
}

// ─── Internal loop ──────────────────────────────────────────────────────────

function runLoop(
  baseGeometry: THREE.BufferGeometry,
  features: FeatureInstance[],
  featureMap: FeatureMap,
): PipelineResult {
  let geo = baseGeometry.clone();
  const baseId = getGeoId(baseGeometry) ?? stampGeoId(baseGeometry);
  stampGeoId(geo, baseId);
  const errors: Record<string, string> = {};

  for (const f of features) {
    if (!f.enabled) continue;

    const upstreamId = getGeoId(geo) ?? stampGeoId(geo);
    const key = featureCacheKey(f, upstreamId);
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
        errors[f.id] = 'Feature produced empty geometry';
        reportError('feature_pipeline', 'empty geometry', { featureId: f.id, featureType: f.type });
        geo = prev;
        continue;
      }
      next.computeVertexNormals();
      stampGeoId(next);
      cachePut(key, next);
      geo = next;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors[f.id] = msg;
      reportError('feature_pipeline', e, {
        featureId: f.id,
        featureType: f.type,
        params: f.params,
      });
      // geo stays at its last good value — rollback preserved automatically.
    }
  }
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
      errors[f.id] = 'Sketch produced empty geometry';
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
      errors[f.id] = 'Sketch merge produced empty geometry';
      return prev;
    }
    merged.computeVertexNormals();
    stampGeoId(merged);
    cachePut(key, merged);
    return merged;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors[f.id] = msg;
    reportError('feature_pipeline', e, { featureId: f.id, featureType: 'sketchExtrude' });
    return prev;
  }
}
