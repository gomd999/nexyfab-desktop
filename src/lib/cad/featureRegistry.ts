import { Sha256 } from '@aws-crypto/sha256-js';
import {
  canonicalCadConsumerDraftJson,
  type CanonicalCadJsonValue,
} from './canonicalCadV2ConsumerDraft';
import { CAD_MESSAGE_CODES, type CadMessageCode } from './i18n/message';

/**
 * GP-05 local, browser/server-safe feature registry.
 *
 * This is metadata only. It deliberately does not import the Shape Generator,
 * OCCT, catalog, or domain implementations. A non-null handler/evidence entry
 * is a claim boundary; it is not a substitute for the handler itself.
 */
export const FEATURE_REGISTRY_SCHEMA = 'nexyfab.precision-cad.feature-registry.v1' as const;
export const FEATURE_REGISTRY_VERSION = 1 as const;

export const NATIVE_FEATURE_TYPES = [
  'sketch', 'fillet', 'chamfer', 'shell', 'hole', 'linearPattern', 'circularPattern',
  'mirror', 'boolean', 'draft', 'scale', 'moveCopy', 'splitBody', 'bend', 'flange',
  'hem', 'jog', 'tab', 'cut', 'bendRelief', 'cornerRelief', 'flatPattern',
  'variableFillet', 'boundarySurface', 'sketchExtrude', 'revolve', 'sweep', 'loft',
  'thread', 'moldTools', 'weldment', 'nurbsSurface', 'helix', 'variableShell', 'rib',
  'deleteFace', 'offsetFace', 'variableSectionSweep', 'multiSectionSweep',
] as const;
export type NativeFeatureType = (typeof NATIVE_FEATURE_TYPES)[number];

export const CAD_FEATURE_KINDS = [
  'extrude', 'revolve', 'sweep', 'loft', 'linear_pattern', 'circular_pattern',
  'hole', 'fillet', 'chamfer', 'shell', 'rib', 'sweep_path', 'boolean',
] as const;
export type CadFeatureKind = (typeof CAD_FEATURE_KINDS)[number];

export const FEATURE_DOMAINS = [
  'mechanical', 'architecture', 'interior', 'civil', 'landscape', 'coordination',
] as const;
export type FeatureDomain = (typeof FEATURE_DOMAINS)[number];

export const EXECUTORS = ['OCCT_EXACT', 'MESH_PREVIEW', 'DOMAIN_HANDLER', 'UNAVAILABLE'] as const;
export type FeatureExecutor = (typeof EXECUTORS)[number];
export const FIDELITIES = ['EXACT', 'APPROXIMATE', 'PREVIEW', 'UNSUPPORTED'] as const;
export type FeatureFidelity = (typeof FIDELITIES)[number];
export const FALLBACK_POLICIES = ['BLOCK', 'PREVIEW_ONLY', 'NONE'] as const;
export type FeatureFallbackPolicy = (typeof FALLBACK_POLICIES)[number];
export const REGISTRY_STATUSES = ['BOUNDED', 'PREVIEW_ONLY', 'UNSUPPORTED'] as const;
export type FeatureRegistryStatus = (typeof REGISTRY_STATUSES)[number];
export const RISK_CLASSES = ['R0', 'R1', 'R2', 'R3', 'R4'] as const;
export type FeatureRiskClass = (typeof RISK_CLASSES)[number];

export type ParameterType = 'number' | 'string' | 'boolean' | 'enum' | 'object' | 'unknown';
export type ParameterUnit = 'mm' | 'deg' | 'count' | 'ratio' | 'none' | 'unknown';

export interface FeatureParameterField {
  key: string;
  type: ParameterType;
  unit: ParameterUnit;
  required: boolean;
}

export interface FeatureParameterContract {
  ref: string;
  known: boolean;
  fields: readonly FeatureParameterField[];
  unknownReason: string | null;
}

export interface FeatureRegistryEntry {
  featureId: string;
  aliases: readonly string[];
  domains: readonly FeatureDomain[];
  parameterContract: FeatureParameterContract;
  handlerId: string | null;
  executor: FeatureExecutor;
  fidelity: FeatureFidelity;
  fallbackPolicy: FeatureFallbackPolicy;
  verificationIds: readonly string[];
  messageKey: CadMessageCode;
  riskClass: FeatureRiskClass;
  evidenceTestIds: readonly string[];
  status: FeatureRegistryStatus;
  reason: string;
}

export interface FeatureRegistryDocument {
  schema: typeof FEATURE_REGISTRY_SCHEMA;
  version: typeof FEATURE_REGISTRY_VERSION;
  entries: readonly FeatureRegistryEntry[];
  registryHash: string;
}

export type FeatureLookupResult =
  | { ok: true; feature: FeatureRegistryEntry }
  | {
      ok: false;
      code: 'FEATURE_UNSUPPORTED';
      featureId: string | null;
      messageKey: 'CAD_FEATURE_UNSUPPORTED';
      reason: 'invalid_feature_id' | 'unknown_feature_id';
    };

export interface RegistryValidationResult {
  ok: boolean;
  issues: readonly string[];
}

const EXACT_EVIDENCE = [
  'domains/mechanical/product/model.test.ts',
  'domains/mechanical/product/model.occt.test.ts',
  'src/lib/occt/nodeOcctBridge.test.ts',
] as const;
const PLAN_EVIDENCE = ['src/lib/occt/featurePlan.test.ts', 'src/lib/occt/planExecutor.test.ts'] as const;
const NATIVE_EVIDENCE = [
  'src/app/[lang]/shape-generator/features/__tests__/registryCompleteness.test.ts',
  'src/app/[lang]/shape-generator/features/featureApplyCoverage.test.ts',
] as const;
const NATIVE_EXACT_LOOP_EVIDENCE = [
  'src/lib/occt/nativeMechanicalExactFeatureLoop.test.ts',
  'src/lib/occt/nodeOcctBridge.test.ts',
] as const;
const FLAT_PATTERN_EVIDENCE = [
  'src/lib/occt/boundedSheetMetalFlatPattern.test.ts',
  'src/lib/occt/nativeMechanicalExactFeatureLoop.test.ts',
  'src/lib/occt/nodeOcctBridge.test.ts',
] as const;
const SKETCH_GEOMETRY_EVIDENCE = [
  'src/lib/occt/canonicalSketchOcctGeometry.test.ts',
  'src/lib/cad/canonicalSketchPreflight.test.ts',
  'src/lib/occt/nodeOcctBridge.test.ts',
] as const;
const WELDMENT_EVIDENCE = [
  'src/lib/occt/boundedWeldment.test.ts',
  'src/lib/occt/nodeOcctBridge.test.ts',
] as const;

const nativeFeatureId = (type: NativeFeatureType): string => `cad.mechanical.${type.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`;

const TREE_TO_NATIVE: Record<CadFeatureKind, NativeFeatureType | null> = {
  extrude: 'sketchExtrude',
  revolve: 'revolve',
  // The broad FeatureTree sweep contract permits arbitrary profiles, paths,
  // add/cut modes, and transport semantics. It must not inherit the narrower
  // exact native request below through an alias.
  sweep: null,
  loft: 'loft',
  linear_pattern: 'linearPattern',
  circular_pattern: 'circularPattern',
  hole: 'hole',
  fillet: 'fillet',
  chamfer: 'chamfer',
  shell: 'shell',
  rib: 'rib',
  sweep_path: null,
  boolean: 'boolean',
};

const exactParams = (ref: string, fields: readonly FeatureParameterField[]): FeatureParameterContract => ({
  ref, known: true, fields, unknownReason: null,
});
const unknownParams = (ref: string, reason: string): FeatureParameterContract => ({
  ref, known: false, fields: [], unknownReason: reason,
});

const field = (key: string, type: ParameterType, unit: ParameterUnit, required = false): FeatureParameterField => ({ key, type, unit, required });

const previewEntry = (type: NativeFeatureType): FeatureRegistryEntry => ({
  featureId: nativeFeatureId(type),
  aliases: [`native:${type}`, `shape-generator:${type}`],
  domains: ['mechanical'],
  parameterContract: unknownParams(
    'src/app/[lang]/shape-generator/features/types.ts#FeatureDefinition.params',
    'native parameters are not yet a canonical, typed contract',
  ),
  handlerId: null,
  executor: 'MESH_PREVIEW',
  fidelity: 'PREVIEW',
  fallbackPolicy: 'PREVIEW_ONLY',
  verificationIds: [],
  messageKey: 'CAD_EXACT_KERNEL_UNAVAILABLE',
  riskClass: 'R2',
  evidenceTestIds: [...NATIVE_EVIDENCE],
  status: 'PREVIEW_ONLY',
  reason: 'native mesh/definition coverage is not evidence of exact OCCT or domain execution',
});

const exactEntry = (
  type: NativeFeatureType,
  handlerId: string,
  parameterContract: FeatureParameterContract,
  evidenceTestIds: readonly string[] = EXACT_EVIDENCE,
  reason = 'bounded real-OCCT mechanical fixture only; not a broad product-release claim',
): FeatureRegistryEntry => ({
  featureId: nativeFeatureId(type),
  aliases: [`native:${type}`, `shape-generator:${type}`],
  domains: ['mechanical'],
  parameterContract,
  handlerId,
  executor: 'OCCT_EXACT',
  fidelity: 'EXACT',
  fallbackPolicy: 'BLOCK',
  verificationIds: ['part-exact-brep', 'part-step-roundtrip'],
  messageKey: 'CAD_EXACT_KERNEL_UNAVAILABLE',
  riskClass: 'R2',
  evidenceTestIds: [...evidenceTestIds],
  status: 'BOUNDED',
  reason,
});

const unsupportedEntry = (featureId: string, aliases: readonly string[], reason: string): FeatureRegistryEntry => ({
  featureId,
  aliases,
  domains: ['mechanical'],
  parameterContract: unknownParams('src/lib/cad/featureTree.ts#FeaturePayload', reason),
  handlerId: null,
  executor: 'UNAVAILABLE',
  fidelity: 'UNSUPPORTED',
  fallbackPolicy: 'BLOCK',
  verificationIds: [],
  messageKey: 'CAD_FEATURE_UNSUPPORTED',
  riskClass: 'R2',
  evidenceTestIds: [...PLAN_EVIDENCE],
  status: 'UNSUPPORTED',
  reason,
});

const parameterContracts: Partial<Record<NativeFeatureType, FeatureParameterContract>> = {
  sketch: exactParams('src/lib/cad/canonicalSketchPreflight.ts#CanonicalSketchPreflightPass', [
    field('projectId', 'string', 'none', true), field('documentId', 'string', 'none', true),
    field('currentRevision', 'object', 'unknown', true), field('sketchId', 'string', 'none', true),
    field('plane', 'enum', 'none', true), field('points', 'object', 'mm', true),
    field('lineSegments', 'object', 'none', true), field('loop', 'object', 'unknown', true),
    field('canonicalSketchSha256', 'string', 'none', true),
  ]),
  sketchExtrude: exactParams('src/lib/cad/extrudeProfile.ts#ExtrudeFeature', [
    field('loop', 'object', 'unknown', true), field('depth', 'number', 'mm', true),
    field('direction', 'enum', 'none'), field('mode', 'enum', 'none'),
  ]),
  revolve: exactParams('src/lib/cad/revolveProfile.ts#RevolveFeature', [
    field('loop', 'object', 'unknown', true), field('angleDegrees', 'number', 'deg', true), field('mode', 'enum', 'none'),
  ]),
  hole: exactParams('src/lib/cad/holeProfile.ts#HoleFeature', [
    field('center', 'object', 'mm', true), field('diameter', 'number', 'mm', true),
    field('depth', 'number', 'mm', true), field('holeType', 'enum', 'none'), field('terminationMode', 'enum', 'none'),
  ]),
  fillet: exactParams('src/lib/cad/filletProfile.ts#FilletFeature', [
    field('radius', 'number', 'mm', true), field('edgeSelection', 'enum', 'none'), field('edgeRefs', 'object', 'unknown'),
  ]),
  chamfer: exactParams('src/lib/cad/chamferProfile.ts#ChamferFeature', [
    field('distance', 'number', 'mm', true), field('edgeSelection', 'enum', 'none'), field('edgeRefs', 'object', 'unknown'),
  ]),
  shell: exactParams('src/lib/cad/shellProfile.ts#ShellFeature', [
    field('thickness', 'number', 'mm', true), field('openTopFace', 'boolean', 'none'), field('openBottomFace', 'boolean', 'none'),
  ]),
  variableFillet: exactParams('src/lib/occt/nativeMechanicalExactFeatureLoop.ts#VariableFilletExactRequest', [
    field('edgeRadii', 'object', 'unknown', true),
  ]),
  draft: exactParams('src/lib/occt/nativeMechanicalExactFeatureLoop.ts#DraftExactRequest', [
    field('angleDeg', 'number', 'deg', true), field('pullDirection', 'object', 'ratio'), field('neutralZ', 'number', 'mm'),
  ]),
  thread: exactParams('src/lib/occt/nativeMechanicalExactFeatureLoop.ts#ThreadExactRequest', [
    field('nominalDiameter', 'number', 'mm', true), field('minorDiameter', 'number', 'mm', true),
    field('pitch', 'number', 'mm', true), field('length', 'number', 'mm', true), field('direction', 'enum', 'none'),
  ]),
  scale: exactParams('src/lib/occt/nativeMechanicalExactFeatureLoop.ts#ScaleExactRequest', [
    field('factor', 'number', 'ratio', true),
  ]),
  moveCopy: exactParams('src/lib/occt/nativeMechanicalExactFeatureLoop.ts#MoveCopyExactRequest', [
    field('translation', 'object', 'mm', true),
  ]),
  mirror: exactParams('src/lib/occt/nativeMechanicalExactFeatureLoop.ts#MirrorExactRequest', [
    field('planeOrigin', 'object', 'mm', true), field('planeNormal', 'object', 'ratio', true),
  ]),
  rib: exactParams('src/lib/occt/nativeMechanicalExactFeatureLoop.ts#RibExactRequest', [
    field('start', 'object', 'mm', true), field('end', 'object', 'mm', true),
    field('thickness', 'number', 'mm', true), field('height', 'number', 'mm', true),
    field('centered', 'boolean', 'none', true),
  ]),
  offsetFace: exactParams('src/lib/occt/nativeMechanicalExactFeatureLoop.ts#OffsetFaceExactRequest', [
    field('faceId', 'string', 'none', true), field('distance', 'number', 'mm', true),
  ]),
  cut: exactParams('src/lib/occt/nativeMechanicalExactFeatureLoop.ts#CutExactRequest', [
    field('toolLoop', 'object', 'mm', true),
  ]),
  linearPattern: exactParams('src/lib/occt/nativeMechanicalExactFeatureLoop.ts#LinearPatternExactRequest', [
    field('count', 'number', 'count', true), field('direction', 'object', 'ratio', true),
    field('spacing', 'number', 'mm', true),
  ]),
  circularPattern: exactParams('src/lib/occt/nativeMechanicalExactFeatureLoop.ts#CircularPatternExactRequest', [
    field('axisPoint', 'object', 'mm', true), field('axisDirection', 'object', 'ratio', true),
    field('count', 'number', 'count', true), field('totalAngleDeg', 'number', 'deg', true),
  ]),
  loft: exactParams('src/lib/occt/nativeMechanicalExactFeatureLoop.ts#LoftExactRequest', [
    field('sections', 'object', 'mm', true),
  ]),
  sweep: exactParams('src/lib/occt/nativeMechanicalExactFeatureLoop.ts#SweepExactRequest', [
    field('path', 'object', 'mm', true), field('widthMm', 'number', 'mm', true),
    field('heightMm', 'number', 'mm', true),
  ]),
  splitBody: exactParams('src/lib/occt/nativeMechanicalExactFeatureLoop.ts#SplitBodyExactRequest', [
    field('host', 'object', 'mm', true), field('plane', 'enum', 'none', true),
    field('offset', 'number', 'mm', true), field('keepSide', 'enum', 'none', true),
  ]),
  deleteFace: exactParams('src/lib/occt/nativeMechanicalExactFeatureLoop.ts#DeleteFaceExactRequest', [
    field('host', 'object', 'mm', true), field('hole', 'object', 'mm', true),
    field('faceSet', 'object', 'none', true),
  ]),
  bend: exactParams('src/lib/occt/nativeMechanicalExactFeatureLoop.ts#BendExactRequest', [
    field('host', 'object', 'mm', true), field('fixedLengthMm', 'number', 'mm', true),
    field('innerRadiusMm', 'number', 'mm', true), field('angleDeg', 'number', 'deg', true),
    field('direction', 'enum', 'none', true),
  ]),
  flange: exactParams('src/lib/occt/nativeMechanicalExactFeatureLoop.ts#FlangeExactRequest', [
    field('host', 'object', 'mm', true), field('straightLegLengthMm', 'number', 'mm', true),
    field('innerRadiusMm', 'number', 'mm', true), field('angleDeg', 'number', 'deg', true),
    field('edge', 'enum', 'none', true), field('direction', 'enum', 'none', true),
  ]),
  flatPattern: exactParams('src/lib/occt/boundedSheetMetalFlatPattern.ts#BoundedSheetMetalFlatPatternRequest', [
    field('operationId', 'string', 'none', true), field('sourceRequest', 'object', 'unknown', true),
  ]),
  weldment: exactParams('src/lib/occt/boundedWeldment.ts#BoundedWeldmentRequest', [
    field('unit', 'enum', 'none', true), field('primary', 'object', 'mm', true),
    field('branch', 'object', 'mm', true), field('joint', 'object', 'none', true),
  ]),
};

const EXACT_TYPES = new Set<NativeFeatureType>(['sketch', 'sketchExtrude', 'revolve', 'hole', 'fillet', 'chamfer', 'variableFillet', 'draft', 'thread', 'scale', 'moveCopy', 'mirror', 'rib', 'deleteFace', 'offsetFace', 'cut', 'linearPattern', 'circularPattern', 'loft', 'sweep', 'splitBody', 'bend', 'flange', 'flatPattern', 'weldment']);
const EXACT_HANDLER_IDS: Partial<Record<NativeFeatureType, string>> = {
  sketch: 'occt.sketch.convex-line-loop-planar-face',
  sketchExtrude: 'occt.sketchExtrude',
  revolve: 'occt.revolve',
  hole: 'occt.hole',
  fillet: 'occt.fillet',
  chamfer: 'occt.chamfer',
  variableFillet: 'occt.variableFillet',
  draft: 'occt.draft',
  thread: 'occt.thread.cylindrical',
  scale: 'occt.scale.uniform',
  moveCopy: 'occt.move-copy.translation',
  mirror: 'occt.mirror.plane',
  rib: 'occt.rib.single',
  offsetFace: 'occt.offset-face.top',
  cut: 'occt.cut.through-rect',
  linearPattern: 'occt.linear-pattern.connected-fused',
  circularPattern: 'occt.circular-pattern.connected-fused',
  loft: 'occt.loft.ruled-convex',
  sweep: 'occt.sweep.orthogonal-polyline-rect',
  splitBody: 'occt.split-body.keep-side-axis-plane',
  deleteFace: 'occt.delete-face.blind-hole-cap',
  bend: 'occt.bend.single-rectangular-sheet',
  flange: 'occt.flange.single-positive-end',
  flatPattern: 'occt.flat-pattern.single-bend-step-dxf',
  weldment: 'occt.weldment.two-member-corner-cut-list',
};
const booleanContract = exactParams('src/lib/cad/booleanFeature.ts#BooleanFeature', [
  field('bodies', 'object', 'unknown', true),
  field('op', 'enum', 'none', true),
]);
const sweepPathContract = exactParams('src/lib/occt/nativeMechanicalExactFeatureLoop.ts#SweepPathExactRequest', [
  field('path', 'object', 'mm', true), field('widthMm', 'number', 'mm', true),
  field('heightMm', 'number', 'mm', true), field('profileFrame', 'enum', 'none', true),
  field('transition', 'enum', 'none', true),
]);

const buildEntries = (): FeatureRegistryEntry[] => {
  const entries = NATIVE_FEATURE_TYPES.map(type => EXACT_TYPES.has(type)
    ? exactEntry(
      type,
      EXACT_HANDLER_IDS[type]!,
      parameterContracts[type]!,
      type === 'sketch' ? SKETCH_GEOMETRY_EVIDENCE
        : type === 'flatPattern' ? FLAT_PATTERN_EVIDENCE
        : type === 'weldment' ? WELDMENT_EVIDENCE
        : type === 'variableFillet' || type === 'draft' || type === 'thread' || type === 'scale' || type === 'moveCopy' || type === 'mirror' || type === 'rib' || type === 'deleteFace' || type === 'offsetFace' || type === 'cut' || type === 'linearPattern' || type === 'circularPattern' || type === 'loft' || type === 'sweep' || type === 'splitBody' || type === 'bend' || type === 'flange' ? NATIVE_EXACT_LOOP_EVIDENCE : EXACT_EVIDENCE,
      type === 'thread'
        ? 'bounded external cylindrical thread with real OCCT helix cut and STEP re-import; tapered and internal variants remain blocked'
        : type === 'sketch'
          ? 'bounded exact planar-face geometry for one strict-convex line loop on XY/XZ/YZ with actual OCCT inspection and STEP replay; constraints, dimensions, fully-constrained status, nested loops, curves, and solver authority remain blocked'
        : type === 'moveCopy'
          ? 'bounded single-body translation copy with native OCCT transform and STEP re-import; multi-body duplication and rotation remain blocked'
          : type === 'mirror'
            ? 'bounded single-body plane mirror with native OCCT transform and STEP re-import; rotation, copy-pair, and assembly semantics remain blocked'
            : type === 'rib'
              ? 'bounded single straight rectangular rib fused to a convex host prism top face with native OCCT prism and union; multi-rib and non-convex hosts remain blocked'
              : type === 'offsetFace'
                ? 'bounded positive offset of the stable f.cap.top plane on a convex prism with native OCCT pushPullFace; other faces and inward offsets remain blocked'
              : type === 'deleteFace'
                ? 'bounded removal of the complete wall/floor/perforated-top face set for one strict-interior blind cylindrical hole, followed by an outer-wire-preserving planar cap, shell solidification, and STEP re-import; arbitrary faces, surface extension, suppression, and rebuild semantics remain blocked'
              : type === 'cut'
                ? 'bounded through-cut of one convex prism by one strictly interior rectangular tool prism; multi-tool, tangential, non-rectangular, and partial-depth cuts remain blocked'
              : type === 'linearPattern'
                ? 'bounded connected fused linear pattern of one axis-aligned rectangular prism; disjoint, tangential, and multi-body patterns remain blocked'
              : type === 'circularPattern'
                ? 'bounded connected fused circular pattern around a safe ±Z axis through one axis-aligned rectangular prism center; full-turn, disjoint, and multi-body patterns remain blocked'
              : type === 'loft'
                ? 'bounded native ruled loft through two or three same-count strict-convex XY sections; smooth, more-than-three-section, and general profiles remain blocked'
              : type === 'sweep'
                ? 'bounded native constant rectangular-section pipe along two orthogonal non-collinear segments; straight, curved, multi-segment, variable-section, guide-rail, and general spatial sweeps remain blocked'
              : type === 'splitBody'
                ? 'bounded keep-one-side split of one axis-aligned rectangular prism by one strict-interior XY/XZ/YZ plane; two-body output, arbitrary planes, and full split semantics remain blocked'
              : type === 'bend'
                ? 'bounded idealized upward circular bend of one constant-thickness rectangular sheet at 5..90 degrees; material, K-factor, springback, tooling, relief, downward, and multi-bend claims remain blocked'
              : type === 'flange'
                ? 'bounded material-adding upward circular flange on one positive length end of a constant-thickness rectangular sheet at 5..90 degrees; arbitrary edges, miter, relief, downward, and multi-flange claims remain blocked'
              : type === 'flatPattern'
                ? 'bounded server-derived flat pattern for one exact bend or positive-end flange with actual OCCT planar face, STEP re-import, and independently reparsed millimetre DXF; multi-bend nesting, relief, K-factor, and shop-floor forming claims remain blocked'
              : type === 'weldment'
                ? 'bounded two-member rectangular square-corner weldment as an unfused native two-solid compound with STEP roundtrip and hash-bound millimetre cut list; weld bead geometry, process/material authorization, arbitrary frames, more members, and XCAF occurrence verification remain blocked'
        : 'bounded native feature with real OCCT execution, detailed B-rep inspection, and STEP re-import; no mesh downgrade',
    )
    : previewEntry(type));

  // The native/tree `shell` surface is ambiguous: a closed hollow shell has
  // no graduated OCCT plan, while a face-removal (open) shell does. Keep the
  // generic aliases preview-only and expose the bounded exact variant through
  // its own canonical id so callers must prove the discriminator explicitly.
  entries.push({
    featureId: 'cad.mechanical.shell-open',
    aliases: ['candidate:cad.mechanical.shell-open'],
    domains: ['mechanical'],
    parameterContract: parameterContracts.shell!,
    handlerId: 'occt.shell.open',
    executor: 'OCCT_EXACT',
    fidelity: 'EXACT',
    fallbackPolicy: 'BLOCK',
    verificationIds: ['part-exact-brep', 'part-step-roundtrip'],
    messageKey: 'CAD_EXACT_KERNEL_UNAVAILABLE',
    riskClass: 'R2',
    evidenceTestIds: [...EXACT_EVIDENCE, ...PLAN_EVIDENCE],
    status: 'BOUNDED',
    reason: 'bounded face-removal shell only; closed hollow shell remains non-authoritative',
  });
  for (const variant of ['union', 'subtract', 'intersect'] as const) {
    entries.push({
      featureId: `cad.mechanical.boolean-${variant}`,
      aliases: [`candidate:cad.mechanical.boolean-${variant}`],
      domains: ['mechanical'],
      parameterContract: booleanContract,
      handlerId: `occt.boolean.${variant}`,
      executor: 'OCCT_EXACT',
      fidelity: 'EXACT',
      fallbackPolicy: 'BLOCK',
      verificationIds: ['part-exact-brep', 'part-step-roundtrip'],
      messageKey: 'CAD_EXACT_KERNEL_UNAVAILABLE',
      riskClass: 'R2',
      evidenceTestIds: [...EXACT_EVIDENCE, ...PLAN_EVIDENCE],
      status: 'BOUNDED',
      reason: `bounded OCCT boolean ${variant} with one explicit base and at least one tool`,
    });
  }

  entries.push({
    featureId: 'cad.mechanical.sweep-path',
    aliases: ['candidate:cad.mechanical.sweep-path'],
    domains: ['mechanical'],
    parameterContract: sweepPathContract,
    handlerId: 'occt.sweep-path.orthogonal-polyline-rect.v1',
    executor: 'OCCT_EXACT',
    fidelity: 'EXACT',
    fallbackPolicy: 'BLOCK',
    verificationIds: ['part-exact-brep', 'part-step-roundtrip'],
    messageKey: 'CAD_EXACT_KERNEL_UNAVAILABLE',
    riskClass: 'R2',
    evidenceTestIds: [...NATIVE_EXACT_LOOP_EVIDENCE],
    status: 'BOUNDED',
    reason: 'versioned bounded path sweep with one constant rectangular section, exactly two orthogonal non-collinear segments, a start-normal profile frame, and right-corner transition; the broader FeatureTree sweep_path alias, arbitrary frames, curved or multi-segment paths, and variable sections remain blocked',
  });

  // CAD FeatureKind aliases are attached to the same canonical record where a
  // native implementation exists. The broad sweep and sweep_path tree payloads
  // remain separate blocked records rather than inheriting bounded contracts.
  for (const kind of CAD_FEATURE_KINDS) {
    const native = TREE_TO_NATIVE[kind];
    if (!native) {
      if (kind === 'sweep') {
        entries.push(unsupportedEntry(
          'cad.mechanical.unsupported.feature-tree-sweep',
          ['tree:sweep'],
          "CAD FeatureKind 'sweep' is broader than the bounded exact orthogonal-polyline rectangular-section request",
        ));
        continue;
      }
      entries.push(unsupportedEntry(
        'cad.mechanical.unsupported.sweep-path',
        ['tree:sweep_path'],
        "CAD FeatureKind 'sweep_path' is broader than the versioned bounded orthogonal-polyline rectangular-section request",
      ));
      continue;
    }
    const entry = entries.find(item => item.featureId === nativeFeatureId(native));
    if (!entry) throw new Error(`feature_registry_internal_missing:${native}`);
    (entry.aliases as string[]).push(`tree:${kind}`);
  }

  // Candidate aliases remain separate wherever a broad native/tree payload
  // cannot prove the bounded canonical contract.
  return entries;
};

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};

const FEATURE_REGISTRY_HASH_DOMAIN = 'nexyfab.precision-cad.feature-registry.sha256.v1';

/** Browser/server-safe SHA-256 over strict canonical JSON and a domain tag. */
export function hashFeatureRegistry(entries: readonly FeatureRegistryEntry[]): string {
  const canonical = canonicalCadConsumerDraftJson({
    schema: FEATURE_REGISTRY_SCHEMA,
    version: FEATURE_REGISTRY_VERSION,
    entries,
  } as unknown as CanonicalCadJsonValue);
  const hash = new Sha256();
  hash.update(`${FEATURE_REGISTRY_HASH_DOMAIN}\n${canonical}`);
  return [...hash.digestSync()].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

const rawEntries = buildEntries();
const frozenEntries = deepFreeze(rawEntries) as readonly FeatureRegistryEntry[];
export const FEATURE_REGISTRY = frozenEntries;
export const FEATURE_REGISTRY_HASH = hashFeatureRegistry(FEATURE_REGISTRY);
export const FEATURE_REGISTRY_DOCUMENT: FeatureRegistryDocument = deepFreeze({
  schema: FEATURE_REGISTRY_SCHEMA,
  version: FEATURE_REGISTRY_VERSION,
  entries: FEATURE_REGISTRY,
  registryHash: FEATURE_REGISTRY_HASH,
});

export const MECHANICAL_30_CANDIDATE_IDS = [
  'cad.mechanical.sketch', 'cad.mechanical.sketch-extrude', 'cad.mechanical.revolve',
  'cad.mechanical.sweep', 'cad.mechanical.loft', 'cad.mechanical.boolean-union',
  'cad.mechanical.boolean-subtract', 'cad.mechanical.boolean-intersect',
  'cad.mechanical.hole', 'cad.mechanical.fillet', 'cad.mechanical.chamfer',
  'cad.mechanical.shell-open', 'cad.mechanical.sweep-path',
  'cad.mechanical.draft', 'cad.mechanical.rib', 'cad.mechanical.linear-pattern',
  'cad.mechanical.circular-pattern', 'cad.mechanical.mirror', 'cad.mechanical.split-body',
  'cad.mechanical.move-copy', 'cad.mechanical.scale', 'cad.mechanical.delete-face',
  'cad.mechanical.offset-face', 'cad.mechanical.variable-fillet', 'cad.mechanical.thread',
  'cad.mechanical.bend', 'cad.mechanical.flange', 'cad.mechanical.flat-pattern',
  'cad.mechanical.weldment', 'cad.mechanical.cut',
] as const;

/** @deprecated Use the candidate-labelled name until all 30 are graduated. */
export const MECHANICAL_30_FEATURE_IDS = MECHANICAL_30_CANDIDATE_IDS;

const ENTRY_KEYS = [
  'featureId', 'aliases', 'domains', 'parameterContract', 'handlerId', 'executor',
  'fidelity', 'fallbackPolicy', 'verificationIds', 'messageKey', 'riskClass',
  'evidenceTestIds', 'status', 'reason',
] as const;
const PARAMETER_CONTRACT_KEYS = ['ref', 'known', 'fields', 'unknownReason'] as const;
const PARAMETER_FIELD_KEYS = ['key', 'type', 'unit', 'required'] as const;
const DOCUMENT_KEYS = ['schema', 'version', 'entries', 'registryHash'] as const;
const MAX_ENTRIES = 128;
const MAX_ALIASES = 16;
const MAX_LIST = 32;
const MAX_TEXT = 512;
const MAX_ISSUES = 64;
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_FEATURE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

class BoundedIssues extends Array<string> {
  truncated = false;

  override push(...items: string[]): number {
    for (const item of items) {
      if (this.length < MAX_ISSUES - 1) super.push(item);
      else this.truncated = true;
    }
    return this.length;
  }

  report(): readonly string[] {
    return this.truncated ? [...this, 'issues_truncated'] : [...this];
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some(key => typeof key !== 'string')) return false;
  if (ownKeys.some(key => !Object.getOwnPropertyDescriptor(value, key)?.enumerable)) return false;
  const actual = (ownKeys as string[]).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};
const boundedText = (value: unknown, max = MAX_TEXT): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
const enumValue = <T extends readonly string[]>(value: unknown, values: T): value is T[number] => typeof value === 'string' && (values as readonly string[]).includes(value);
const uniqueStrings = (values: readonly unknown[], max = MAX_TEXT): values is readonly string[] => (
  values.every(value => boundedText(value, max)) && new Set(values).size === values.length
);

function validateParameterContract(value: unknown, path: string, issues: string[]): value is FeatureParameterContract {
  if (!isRecord(value) || !exactKeys(value, PARAMETER_CONTRACT_KEYS)) { issues.push(`${path}:keys`); return false; }
  if (!boundedText(value.ref)) issues.push(`${path}:ref`);
  if (typeof value.known !== 'boolean') issues.push(`${path}:known`);
  if (!Array.isArray(value.fields) || value.fields.length > MAX_LIST) issues.push(`${path}:fields`);
  else value.fields.forEach((fieldValue, index) => {
    const fieldPath = `${path}:fields[${index}]`;
    if (!isRecord(fieldValue) || !exactKeys(fieldValue, PARAMETER_FIELD_KEYS)) { issues.push(`${fieldPath}:keys`); return; }
    if (!boundedText(fieldValue.key, 128)) issues.push(`${fieldPath}:key`);
    if (!enumValue(fieldValue.type, ['number', 'string', 'boolean', 'enum', 'object', 'unknown'] as const)) issues.push(`${fieldPath}:type`);
    if (!enumValue(fieldValue.unit, ['mm', 'deg', 'count', 'ratio', 'none', 'unknown'] as const)) issues.push(`${fieldPath}:unit`);
    if (typeof fieldValue.required !== 'boolean') issues.push(`${fieldPath}:required`);
  });
  if (Array.isArray(value.fields)) {
    const keys = value.fields
      .filter(isRecord)
      .map(fieldValue => fieldValue.key)
      .filter((key): key is string => typeof key === 'string');
    if (new Set(keys).size !== keys.length) issues.push(`${path}:duplicate_field_key`);
  }
  if (value.known === true && (!Array.isArray(value.fields) || value.fields.length === 0 || value.unknownReason !== null)) issues.push(`${path}:known_contract_incomplete`);
  if (value.known === false && (!boundedText(value.unknownReason) || (Array.isArray(value.fields) && value.fields.length > 0))) issues.push(`${path}:unknown_contract_incomplete`);
  return true;
}

function validateEntry(value: unknown, index: number, aliases: Set<string>, featureIds: Set<string>, issues: string[]): value is FeatureRegistryEntry {
  const path = `entries[${index}]`;
  if (!isRecord(value) || !exactKeys(value, ENTRY_KEYS)) { issues.push(`${path}:keys`); return false; }
  if (!boundedText(value.featureId, 256) || !SAFE_FEATURE_ID.test(value.featureId)) issues.push(`${path}:featureId`);
  else if (featureIds.has(value.featureId)) issues.push(`${path}:duplicate_featureId`);
  else featureIds.add(value.featureId);
  if (!Array.isArray(value.aliases) || value.aliases.length > MAX_ALIASES || !uniqueStrings(value.aliases)) issues.push(`${path}:aliases`);
  else for (const alias of value.aliases) {
    if (!boundedText(alias, 256)) issues.push(`${path}:alias`);
    else if (aliases.has(alias) || featureIds.has(alias)) issues.push(`${path}:alias_collision:${alias}`);
    else aliases.add(alias);
  }
  if (!Array.isArray(value.domains) || value.domains.length === 0
    || !uniqueStrings(value.domains, 32)
    || !value.domains.every(domain => enumValue(domain, FEATURE_DOMAINS))) issues.push(`${path}:domains`);
  validateParameterContract(value.parameterContract, `${path}:parameterContract`, issues);
  if (value.handlerId !== null && !boundedText(value.handlerId, 256)) issues.push(`${path}:handlerId`);
  if (!enumValue(value.executor, EXECUTORS)) issues.push(`${path}:executor`);
  if (!enumValue(value.fidelity, FIDELITIES)) issues.push(`${path}:fidelity`);
  if (!enumValue(value.fallbackPolicy, FALLBACK_POLICIES)) issues.push(`${path}:fallbackPolicy`);
  if (!Array.isArray(value.verificationIds) || value.verificationIds.length > MAX_LIST || !uniqueStrings(value.verificationIds, 256)) issues.push(`${path}:verificationIds`);
  if (!enumValue(value.messageKey, CAD_MESSAGE_CODES)) issues.push(`${path}:messageKey`);
  if (!enumValue(value.riskClass, RISK_CLASSES)) issues.push(`${path}:riskClass`);
  if (!Array.isArray(value.evidenceTestIds) || value.evidenceTestIds.length > MAX_LIST || !uniqueStrings(value.evidenceTestIds, 256)) issues.push(`${path}:evidenceTestIds`);
  if (!enumValue(value.status, REGISTRY_STATUSES)) issues.push(`${path}:status`);
  if (!boundedText(value.reason)) issues.push(`${path}:reason`);

  if (value.fidelity === 'EXACT') {
    if (value.handlerId === null) issues.push(`${path}:exact_handler_required`);
    if (value.executor !== 'OCCT_EXACT' && value.executor !== 'DOMAIN_HANDLER') issues.push(`${path}:exact_executor_required`);
    if (!Array.isArray(value.verificationIds) || value.verificationIds.length === 0) issues.push(`${path}:exact_verification_required`);
    if (!Array.isArray(value.evidenceTestIds) || value.evidenceTestIds.length === 0) issues.push(`${path}:exact_evidence_required`);
    if (value.fallbackPolicy !== 'BLOCK') issues.push(`${path}:exact_must_block_downgrade`);
    if (value.status !== 'BOUNDED') issues.push(`${path}:exact_status_required`);
    if (value.parameterContract && isRecord(value.parameterContract) && value.parameterContract.known !== true) issues.push(`${path}:exact_parameter_contract_required`);
  }
  if (value.fidelity === 'UNSUPPORTED') {
    if (value.handlerId !== null) issues.push(`${path}:unsupported_handler_forbidden`);
    if (value.executor !== 'UNAVAILABLE') issues.push(`${path}:unsupported_executor_required`);
    if (value.fallbackPolicy !== 'BLOCK') issues.push(`${path}:unsupported_must_block`);
    if (value.status !== 'UNSUPPORTED') issues.push(`${path}:unsupported_status_required`);
  }
  if (value.executor === 'MESH_PREVIEW' && value.fidelity === 'EXACT') issues.push(`${path}:mesh_exact_forbidden`);
  if (value.fidelity === 'PREVIEW') {
    if (value.executor !== 'MESH_PREVIEW') issues.push(`${path}:preview_executor_required`);
    if (value.fallbackPolicy !== 'PREVIEW_ONLY') issues.push(`${path}:preview_policy_required`);
    if (value.status !== 'PREVIEW_ONLY') issues.push(`${path}:preview_status_required`);
  }
  return true;
}

function coverageIssues(entries: readonly FeatureRegistryEntry[]): string[] {
  const aliases = new Set(entries.flatMap(entry => entry.aliases));
  const nativeMissing = NATIVE_FEATURE_TYPES.filter(type => !aliases.has(`native:${type}`));
  const treeMissing = CAD_FEATURE_KINDS.filter(kind => !aliases.has(`tree:${kind}`));
  return [
    ...nativeMissing.map(type => `native_missing:${type}`),
    ...treeMissing.map(kind => `tree_missing:${kind}`),
  ];
}

/** Strict, bounded validator for registry documents received from disk/network. */
export function validateFeatureRegistry(input: unknown): RegistryValidationResult {
  try {
    const issues = new BoundedIssues();
    if (!isRecord(input) || !exactKeys(input, DOCUMENT_KEYS)) return { ok: false, issues: ['document:keys'] };
    if (input.schema !== FEATURE_REGISTRY_SCHEMA) issues.push('document:schema');
    if (input.version !== FEATURE_REGISTRY_VERSION) issues.push('document:version');
    if (!Array.isArray(input.entries) || input.entries.length > MAX_ENTRIES) {
      issues.push('document:entries');
      return { ok: false, issues: issues.report() };
    }
    if (typeof input.registryHash !== 'string' || !SHA256.test(input.registryHash)) issues.push('document:registryHash');
    const aliases = new Set<string>();
    const featureIds = new Set<string>();
    const entries: FeatureRegistryEntry[] = [];
    input.entries.forEach((entry, index) => {
      if (validateEntry(entry, index, aliases, featureIds, issues)) entries.push(entry);
    });
    for (const featureId of featureIds) if (aliases.has(featureId)) issues.push(`feature_alias_collision:${featureId}`);
    issues.push(...coverageIssues(entries));
    if (entries.length === input.entries.length && input.registryHash !== hashFeatureRegistry(entries)) issues.push('document:hash_mismatch');
    const report = issues.report();
    return { ok: report.length === 0, issues: report };
  } catch {
    return { ok: false, issues: ['inspection_unreadable'] };
  }
}

const lookupMap = new Map<string, FeatureRegistryEntry>();
for (const entry of FEATURE_REGISTRY) {
  lookupMap.set(entry.featureId, entry);
  for (const alias of entry.aliases) lookupMap.set(alias, entry);
}

const cloneEntry = (entry: FeatureRegistryEntry): FeatureRegistryEntry => deepFreeze({
  ...entry,
  aliases: [...entry.aliases],
  domains: [...entry.domains],
  parameterContract: {
    ...entry.parameterContract,
    fields: entry.parameterContract.fields.map(fieldValue => ({ ...fieldValue })),
  },
  verificationIds: [...entry.verificationIds],
  evidenceTestIds: [...entry.evidenceTestIds],
});

/** Lookup is deliberately fail-closed: unknown IDs never select another feature. */
export function lookupFeature(featureId: unknown): FeatureLookupResult {
  if (typeof featureId !== 'string' || !SAFE_FEATURE_ID.test(featureId)) {
    return Object.freeze({
      ok: false,
      code: 'FEATURE_UNSUPPORTED',
      featureId: null,
      messageKey: 'CAD_FEATURE_UNSUPPORTED',
      reason: 'invalid_feature_id',
    });
  }
  const entry = lookupMap.get(featureId);
  if (!entry) return Object.freeze({ ok: false, code: 'FEATURE_UNSUPPORTED', featureId, messageKey: 'CAD_FEATURE_UNSUPPORTED', reason: 'unknown_feature_id' });
  return { ok: true, feature: cloneEntry(entry) };
}
