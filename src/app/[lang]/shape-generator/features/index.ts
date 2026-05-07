import * as THREE from 'three';
import type { FeatureDefinition, FeatureInstance, FeatureType, MapBackedFeatureType } from './types';
import { runPipeline, runPipelineAsync, type PipelineResult, type PipelineOptions } from './pipelineManager';

// ─── Import actual feature implementations ───────────────────────────────────

import { filletFeature } from './fillet';
import { chamferFeature } from './chamfer';
import { shellFeature } from './shell';
import { holeFeature } from './hole';
import { linearPatternFeature } from './linearPattern';
import { circularPatternFeature } from './circularPattern';
import { mirrorFeature } from './mirror';
import { booleanFeature } from './boolean';
import { draftFeature } from './draft';
import { scaleFeature } from './scale';
import { moveCopyFeature } from './moveCopy';
import { splitBodyFeature } from './splitBody';
import { bendFeature, flangeFeature, flatPatternFeature } from './sheetMetal';
import { variableFilletFeature } from './variableFillet';
import { boundarySurfaceFeature } from './boundarySurface';
import { revolveFeature } from './revolve';
import { sweepFeature } from './sweep';
import { loftFeature } from './loft';
import { threadFeature } from './thread';
import { moldToolsFeature } from './moldTools';
import { weldmentFeature } from './weldment';
import { nurbsSurfaceFeature } from './nurbsSurface';
import { sketchFeature } from './sketch';

// ─── Registry ────────────────────────────────────────────────────────────────

export const FEATURE_DEFS: FeatureDefinition[] = [
  sketchFeature,
  filletFeature,
  chamferFeature,
  shellFeature,
  holeFeature,
  linearPatternFeature,
  circularPatternFeature,
  mirrorFeature,
  booleanFeature,
  draftFeature,
  scaleFeature,
  moveCopyFeature,
  splitBodyFeature,
  bendFeature,
  flangeFeature,
  flatPatternFeature,
  variableFilletFeature,
  boundarySurfaceFeature,
  revolveFeature,
  sweepFeature,
  loftFeature,
  threadFeature,
  moldToolsFeature,
  weldmentFeature,
  nurbsSurfaceFeature,
];

export const FEATURE_MAP: Record<MapBackedFeatureType, FeatureDefinition> =
  Object.fromEntries(FEATURE_DEFS.map(d => [d.type, d])) as Record<
    MapBackedFeatureType,
    FeatureDefinition
  >;

/** Definition for UI / add-feature; `sketchExtrude` is created via `addSketchFeature`. */
export function getFeatureDefinition(type: FeatureType): FeatureDefinition | undefined {
  if (type === 'sketchExtrude') return undefined;
  return FEATURE_MAP[type];
}

// ─── Diagnostics (M2) ────────────────────────────────────────────────────────
export type { FeatureDiagnostic } from './featureDiagnostics';
export { classifyFeatureError } from './featureDiagnostics';

// ─── Pipeline executor ───────────────────────────────────────────────────────

export type { PipelineResult, PipelineOptions };

export function applyFeaturePipeline(
  baseGeometry: THREE.BufferGeometry,
  features: FeatureInstance[],
): THREE.BufferGeometry {
  return applyFeaturePipelineDetailed(baseGeometry, features).geometry;
}

export function applyFeaturePipelineDetailedAsync(
  baseGeometry: THREE.BufferGeometry,
  features: FeatureInstance[],
  opts: PipelineOptions = {},
): Promise<PipelineResult> {
  return runPipelineAsync(baseGeometry, features, FEATURE_MAP, opts);
}

export function applyFeaturePipelineDetailed(
  baseGeometry: THREE.BufferGeometry,
  features: FeatureInstance[],
): PipelineResult {
  return runPipeline(baseGeometry, features, FEATURE_MAP);
}

// Re-export types
export type {
  FeatureDefinition,
  FeatureInstance,
  FeatureParam,
  FeatureType,
  MapBackedFeatureType,
} from './types';
