import * as THREE from 'three';
import type { SketchProfile, SketchConfig } from '../sketch/types';

export interface FeatureParam {
  key: string;
  labelKey: string; // key into shapeDict for i18n
  default: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  options?: { value: number; labelKey: string }[]; // for enum-style params (axis, plane, hole type)
}

export type FeatureType =
  | 'sketch'
  | 'fillet'
  | 'chamfer'
  | 'shell'
  | 'hole'
  | 'linearPattern'
  | 'circularPattern'
  | 'mirror'
  | 'boolean'
  | 'draft'
  | 'scale'
  | 'moveCopy'
  | 'splitBody'
  | 'bend'
  | 'flange'
  | 'flatPattern'
  | 'variableFillet'
  | 'boundarySurface'
  | 'sketchExtrude'
  | 'revolve'
  | 'sweep'
  | 'loft'
  | 'thread'
  | 'moldTools'
  | 'weldment'
  | 'nurbsSurface'
  | 'helix'
  | 'variableShell'
  | 'rib';

/** Types dispatched through `FEATURE_MAP` / registry (not the inline sketchExtrude path). */
export type MapBackedFeatureType = Exclude<FeatureType, 'sketchExtrude'>;

/**
 * Optional runtime context the pipelineManager passes to `apply()` so the
 * feature can tag its own contribution (B1 deep face provenance follow-up).
 * Features that don't care about provenance can ignore the parameter — the
 * pipelineManager's coarse stamp will cover them.
 */
export interface FeatureApplyContext {
  /** The FeatureInstance.id of the feature currently being applied. CSG-
   *  aware features should `stampFaceFeatureIdAll(tool, ctx.featureId)`
   *  before calling `applyCSG()` so output triangles from the tool keep
   *  this feature's id while base-inherited triangles keep theirs. */
  featureId: string;
}

export interface FeatureDefinition {
  type: FeatureType;
  icon: string;
  params: FeatureParam[];
  apply: (
    geometry: THREE.BufferGeometry,
    params: Record<string, number>,
    ctx?: FeatureApplyContext,
  ) => THREE.BufferGeometry;
  /** Optional async override for OCCT-backed features */
  applyAsync?: (
    geometry: THREE.BufferGeometry,
    params: Record<string, number>,
    ctx?: FeatureApplyContext,
  ) => Promise<THREE.BufferGeometry>;
}

export interface FeatureInstance {
  id: string;
  type: FeatureType;
  params: Record<string, number>;
  enabled: boolean;
  error?: string;
  /** Present only when type === 'sketchExtrude' */
  sketchData?: {
    profile: SketchProfile;
    config: SketchConfig;
    plane: 'xy' | 'xz' | 'yz';
    planeOffset: number;
    operation: 'add' | 'subtract';
    constraints?: import('../sketch/types').SketchConstraint[];
    dimensions?: import('../sketch/types').SketchDimension[];
  };
  /**
   * Runtime-only handle into the OCCT shape registry (phase 2d of #98). Lets
   * the next feature in the stack run a true B-rep operation against the
   * prior replicad shape instead of re-tessellating from a bounding box.
   * Never persisted — stripped by nfabFormat.serializeProject and invalid
   * across pipeline runs (the registry is cleared on each applyFeaturePipeline
   * call). Carried feature-to-feature via BufferGeometry.userData.occtHandle.
   */
  brep?: string;
}
