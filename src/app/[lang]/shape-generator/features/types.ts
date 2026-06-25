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
  | 'hem'
  | 'jog'
  | 'tab'
  | 'cut'
  | 'bendRelief'
  | 'cornerRelief'
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
  | 'rib'
  | 'deleteFace'
  | 'offsetFace';

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
  /** Phase-2 — persistent edge ids the user selected when authoring this
   *  feature. fillet/chamfer use these to restrict the operation to a
   *  subset of edges instead of the global default. Empty/undefined →
   *  legacy global behaviour. */
  targetEdgeIds?: string[];
  /** Phase-2 — persistent face ids (shell with face-removal, etc). */
  targetFaceIds?: string[];
  /** Phase 3-c — click-time edge selection data needed to build a
   *  replicad EdgeFinder predicate. Optional and parallel to
   *  targetEdgeIds: ids survive serialization; selection geometry
   *  (position / length / normal) is what actually drives the OCCT
   *  predicate construction. */
  edgeSelections?: import('../editing/selectionInfo').EdgeSelectionInfo[];
  /** Click-time face selection(s) — drives the FaceFinder for shell face
   *  removal (re-resolved against the current solid's face signatures). */
  faceSelections?: import('../editing/selectionInfo').FaceSelectionInfo[];
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
  /** SolidWorks-style "=expression" sidecar (raw expression per param key).
   *  `params[key]` already holds the evaluated value — the pipeline ignores
   *  this; it's carried so UI surfaces (PropertyManager / FeatureParams) can
   *  show the driving expression. See equations/featureParamExpressions.ts. */
  paramExpressions?: Record<string, string>;
  enabled: boolean;
  error?: string;
  /** Phase-1 "fillet / chamfer on selected edges". Persistent edge ids
   *  (resolved via the topology tracker). When present, feature
   *  implementations may restrict the operation to just those edges; when
   *  absent the legacy global-edge behaviour applies. The OCCT path
   *  still ignores this until per-edge wiring lands in phase 2. */
  targetEdgeIds?: string[];
  /** Phase-1 "shell with face removal". Persistent face ids of the
   *  faces to leave open. Same fallback story as targetEdgeIds. */
  targetFaceIds?: string[];
  /** Phase 3-c — full click-time edge selection. Stored alongside
   *  targetEdgeIds so the OCCT path can build an EdgeFinder predicate
   *  without round-tripping back through the topology tracker. */
  edgeSelections?: import('../editing/selectionInfo').EdgeSelectionInfo[];
  /** Click-time face selection(s) for shell face removal. Re-resolved to a
   *  FaceFinder against the current solid's face signatures at pipeline time. */
  faceSelections?: import('../editing/selectionInfo').FaceSelectionInfo[];
  /** Present only when type === 'sketchExtrude' */
  sketchData?: {
    profile: SketchProfile;
    config: SketchConfig;
    plane: 'xy' | 'xz' | 'yz';
    planeOffset: number;
    operation: 'add' | 'subtract';
    constraints?: import('../sketch/types').SketchConstraint[];
    dimensions?: import('../sketch/types').SketchDimension[];
    /** Phase-2 "Sketch on tilted face". When present, the pipeline
     *  ignores `plane`/`planeOffset` for placement and instead transforms
     *  the sketch geometry onto this oriented frame. */
    faceFrame?: {
      origin: [number, number, number];
      normal: [number, number, number];
      uAxis: [number, number, number];
      vAxis: [number, number, number];
    };
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
