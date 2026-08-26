import { Sha256 } from '@aws-crypto/sha256-js';
import { canonicalCadConsumerDraftJson, type CanonicalCadJsonValue } from '@/lib/cad/canonicalCadV2ConsumerDraft';
import { FEATURE_REGISTRY_HASH } from '@/lib/cad/featureRegistry';
import { decideFeatureExecution } from '@/lib/cad/featureRegistryDecision';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';
import type { OcctDetailedShapeInspection } from './bridge';
import { loadNodeOcctCommercialRuntime } from './nodeOcctCommercialRuntime';
import type { OcctShape } from './types';

export const NATIVE_MECHANICAL_EXACT_REQUEST_SCHEMA = 'nexyfab.precision-cad.native-mechanical-exact-request.v1' as const;
export const NATIVE_MECHANICAL_EXACT_RECEIPT_SCHEMA = 'nexyfab.precision-cad.native-mechanical-exact-receipt.v1' as const;

export type NativeMechanicalExactFeatureId =
  | 'cad.mechanical.variable-fillet'
  | 'cad.mechanical.draft'
  | 'cad.mechanical.thread'
  | 'cad.mechanical.scale'
  | 'cad.mechanical.move-copy'
  | 'cad.mechanical.mirror'
  | 'cad.mechanical.rib'
  | 'cad.mechanical.offset-face'
  | 'cad.mechanical.cut'
  | 'cad.mechanical.linear-pattern'
  | 'cad.mechanical.circular-pattern'
  | 'cad.mechanical.loft'
  | 'cad.mechanical.sweep'
  | 'cad.mechanical.sweep-path'
  | 'cad.mechanical.split-body'
  | 'cad.mechanical.delete-face'
  | 'cad.mechanical.bend'
  | 'cad.mechanical.flange';

interface CanonicalBaseBinding {
  schema: typeof NATIVE_MECHANICAL_EXACT_REQUEST_SCHEMA;
  featureId: NativeMechanicalExactFeatureId;
  operationId: string;
  projectId: string;
  documentId: string;
  baseRevisionId: string;
  baseSequence: number;
  baseContentSha256: string;
}

export interface ExactPrismHost {
  loop: ReadonlyArray<{ x: number; y: number }>;
  depth: number;
}

export interface VariableFilletExactRequest extends CanonicalBaseBinding {
  featureId: 'cad.mechanical.variable-fillet';
  parameters: {
    host: ExactPrismHost;
    edgeRadii: ReadonlyArray<{ edgeId: string; radius: number }>;
  };
}

export interface DraftExactRequest extends CanonicalBaseBinding {
  featureId: 'cad.mechanical.draft';
  parameters: {
    host: ExactPrismHost;
    angleDeg: number;
    pullDirection: readonly [number, number, number];
    neutralZ: number;
  };
}

export interface ThreadExactRequest extends CanonicalBaseBinding {
  featureId: 'cad.mechanical.thread';
  parameters: {
    center: readonly [number, number, number];
    axis: readonly [0, 0, 1];
    nominalDiameter: number;
    minorDiameter: number;
    hostDepth: number;
    pitch: number;
    threadLength: number;
    direction: 'right_hand' | 'left_hand';
  };
}

/** Bounded uniform scale about the global origin; non-uniform transforms are not accepted. */
export interface ScaleExactRequest extends CanonicalBaseBinding {
  featureId: 'cad.mechanical.scale';
  parameters: {
    host: ExactPrismHost;
    factor: number;
  };
}

/** Bounded single-body translated copy; assembly duplication and rotation remain blocked. */
export interface MoveCopyExactRequest extends CanonicalBaseBinding {
  featureId: 'cad.mechanical.move-copy';
  parameters: {
    host: ExactPrismHost;
    translation: readonly [number, number, number];
  };
}

/** Bounded single-body mirror through an explicit point/normal plane. */
export interface MirrorExactRequest extends CanonicalBaseBinding {
  featureId: 'cad.mechanical.mirror';
  parameters: {
    host: ExactPrismHost;
    planeOrigin: readonly [number, number, number];
    planeNormal: readonly [number, number, number];
  };
}

/** Bounded single straight rectangular rib, fused to the host prism's top face. */
export interface RibExactRequest extends CanonicalBaseBinding {
  featureId: 'cad.mechanical.rib';
  parameters: {
    host: ExactPrismHost;
    start: { x: number; y: number };
    end: { x: number; y: number };
    thickness: number;
    height: number;
    centered: boolean;
  };
}

/** Bounded positive top-cap offset on a convex prism. */
export interface OffsetFaceExactRequest extends CanonicalBaseBinding {
  featureId: 'cad.mechanical.offset-face';
  parameters: {
    host: ExactPrismHost;
    faceId: 'f.cap.top';
    distance: number;
  };
}

/** Bounded through-cut with one XY rectangular tool prism spanning host depth. */
export interface CutExactRequest extends CanonicalBaseBinding {
  featureId: 'cad.mechanical.cut';
  parameters: {
    host: ExactPrismHost;
    toolLoop: ReadonlyArray<{ x: number; y: number }>;
  };
}

/** Bounded connected fused linear pattern of one axis-aligned rectangular prism. */
export interface LinearPatternExactRequest extends CanonicalBaseBinding {
  featureId: 'cad.mechanical.linear-pattern';
  parameters: {
    host: ExactPrismHost;
    count: number;
    direction: readonly [number, number, number];
    spacing: number;
  };
}

/** Bounded connected fused circular pattern around a safe Z axis through the host center. */
export interface CircularPatternExactRequest extends CanonicalBaseBinding {
  featureId: 'cad.mechanical.circular-pattern';
  parameters: {
    host: ExactPrismHost;
    axisPoint: readonly [number, number, number];
    axisDirection: readonly [number, number, number];
    count: number;
    totalAngleDeg: number;
  };
}

/** Bounded ruled loft through two or three convex XY sections. */
export interface LoftExactRequest extends CanonicalBaseBinding {
  featureId: 'cad.mechanical.loft';
  parameters: {
    sections: ReadonlyArray<{
      z: number;
      loop: ReadonlyArray<{ x: number; y: number }>;
    }>;
  };
}

/** True non-straight rectangular-section pipe along two orthogonal segments. */
export interface SweepExactRequest extends CanonicalBaseBinding {
  featureId: 'cad.mechanical.sweep';
  parameters: {
    path: readonly [
      readonly [number, number, number],
      readonly [number, number, number],
      readonly [number, number, number],
    ];
    widthMm: number;
    heightMm: number;
  };
}

/**
 * Versioned path-sweep variant. The explicit frame and corner tokens prevent
 * broad FeatureTree sweep_path payloads from silently inheriting this narrow
 * exact kernel contract.
 */
export interface SweepPathExactRequest extends CanonicalBaseBinding {
  featureId: 'cad.mechanical.sweep-path';
  parameters: {
    path: readonly [
      readonly [number, number, number],
      readonly [number, number, number],
      readonly [number, number, number],
    ];
    widthMm: number;
    heightMm: number;
    profileFrame: 'normal_to_first_segment';
    transition: 'right_corner';
  };
}

/** Bounded axis-plane split that retains exactly one side as one closed solid. */
export interface SplitBodyExactRequest extends CanonicalBaseBinding {
  featureId: 'cad.mechanical.split-body';
  parameters: {
    host: ExactPrismHost;
    plane: 'XY' | 'XZ' | 'YZ';
    offset: number;
    keepSide: 'positive' | 'negative';
  };
}

/**
 * Bounded delete-face repair for one strict-interior blind cylindrical hole.
 * The explicit three-face set prevents this contract from being mistaken for
 * arbitrary surface extension or feature-tree suppression.
 */
export interface DeleteFaceExactRequest extends CanonicalBaseBinding {
  featureId: 'cad.mechanical.delete-face';
  parameters: {
    host: ExactPrismHost;
    hole: {
      center: { x: number; y: number };
      radiusMm: number;
      depthMm: number;
    };
    faceSet: readonly [
      'f.hole.wall',
      'f.hole.floor',
      'f.cap.top.perforated',
    ];
  };
}

export interface ExactRectangularSheetHost {
  lengthMm: number;
  widthMm: number;
  thicknessMm: number;
}

/** One upward idealized circular bend; material, tooling, and springback are excluded. */
export interface BendExactRequest extends CanonicalBaseBinding {
  featureId: 'cad.mechanical.bend';
  parameters: {
    host: ExactRectangularSheetHost;
    fixedLengthMm: number;
    innerRadiusMm: number;
    angleDeg: number;
    direction: 'up';
  };
}

/** One material-adding flange on the positive length end of a rectangular sheet. */
export interface FlangeExactRequest extends CanonicalBaseBinding {
  featureId: 'cad.mechanical.flange';
  parameters: {
    host: ExactRectangularSheetHost;
    straightLegLengthMm: number;
    innerRadiusMm: number;
    angleDeg: number;
    edge: 'positive_length_end';
    direction: 'up';
  };
}

export type NativeMechanicalExactFeatureRequest = VariableFilletExactRequest | DraftExactRequest | ThreadExactRequest | ScaleExactRequest | MoveCopyExactRequest | MirrorExactRequest | RibExactRequest | OffsetFaceExactRequest | CutExactRequest | LinearPatternExactRequest | CircularPatternExactRequest | LoftExactRequest | SweepExactRequest | SweepPathExactRequest | SplitBodyExactRequest | DeleteFaceExactRequest | BendExactRequest | FlangeExactRequest;

export type NativeMechanicalExactBlockerCode =
  | 'INVALID_REQUEST'
  | 'RUNTIME_UNAVAILABLE'
  | 'REGISTRY_HOLD'
  | 'HANDLER_UNAVAILABLE'
  | 'BASE_BUILD_FAILED'
  | 'FEATURE_EXECUTION_FAILED'
  | 'BREP_INVALID'
  | 'FEATURE_NO_GEOMETRIC_CHANGE'
  | 'STEP_EXPORT_FAILED'
  | 'STEP_REIMPORT_FAILED'
  | 'ROUNDTRIP_MISMATCH'
  | 'FEATURE_INVARIANT_MISMATCH'
  | 'RESOURCE_LIMIT_EXCEEDED';

export interface NativeMechanicalExactMeasurement {
  valid: boolean;
  solidCount: number;
  faceCount: number;
  edgeCount: number;
  adjacencyFaceCount: number;
  adjacencyEdgeCount: number;
  boundaryEdgeCount: number;
  nonManifoldEdgeCount: number;
  absoluteVolume: number;
  bboxMm: readonly [number, number, number, number, number, number];
}

export interface NativeMechanicalExactReceipt {
  schema: typeof NATIVE_MECHANICAL_EXACT_RECEIPT_SCHEMA;
  status: 'EXACT_PASS';
  featureId: NativeMechanicalExactFeatureId;
  operationId: string;
  projectId: string;
  documentId: string;
  baseRevisionId: string;
  baseSequence: number;
  baseContentSha256: string;
  registryHash: string;
  runtimeIdentitySha256: string;
  requestSha256: string;
  resultMeasurementSha256: string;
  roundtripMeasurementSha256: string;
  stepSha256: string;
  blockerCodes: readonly [];
  authoritativeCommit: false;
  commercialReleaseReady: false;
  receiptSha256: string;
}

export type NativeMechanicalExactFeatureResult =
  | { status: 'EXACT_PASS'; blockerCodes: readonly []; receipt: NativeMechanicalExactReceipt; stepArtifact: string }
  | { status: 'HOLD'; blockerCodes: readonly NativeMechanicalExactBlockerCode[]; receipt: null; stepArtifact: null };

const RECEIPT_KEYS = ['schema', 'status', 'featureId', 'operationId', 'projectId', 'documentId', 'baseRevisionId', 'baseSequence', 'baseContentSha256', 'registryHash', 'runtimeIdentitySha256', 'requestSha256', 'resultMeasurementSha256', 'roundtripMeasurementSha256', 'stepSha256', 'blockerCodes', 'authoritativeCommit', 'commercialReleaseReady', 'receiptSha256'] as const;
const RESULT_KEYS = ['status', 'blockerCodes', 'receipt', 'stepArtifact'] as const;
const BLOCKER_CODES: readonly NativeMechanicalExactBlockerCode[] = ['INVALID_REQUEST', 'RUNTIME_UNAVAILABLE', 'REGISTRY_HOLD', 'HANDLER_UNAVAILABLE', 'BASE_BUILD_FAILED', 'FEATURE_EXECUTION_FAILED', 'BREP_INVALID', 'FEATURE_NO_GEOMETRIC_CHANGE', 'STEP_EXPORT_FAILED', 'STEP_REIMPORT_FAILED', 'ROUNDTRIP_MISMATCH', 'FEATURE_INVARIANT_MISMATCH', 'RESOURCE_LIMIT_EXCEEDED'];

const REQUEST_KEYS = ['schema', 'featureId', 'operationId', 'projectId', 'documentId', 'baseRevisionId', 'baseSequence', 'baseContentSha256', 'parameters'] as const;
const PRISM_KEYS = ['loop', 'depth'] as const;
const POINT_KEYS = ['x', 'y'] as const;
const VARIABLE_KEYS = ['host', 'edgeRadii'] as const;
const EDGE_RADIUS_KEYS = ['edgeId', 'radius'] as const;
const DRAFT_KEYS = ['host', 'angleDeg', 'pullDirection', 'neutralZ'] as const;
const THREAD_KEYS = ['center', 'axis', 'nominalDiameter', 'minorDiameter', 'hostDepth', 'pitch', 'threadLength', 'direction'] as const;
const SCALE_KEYS = ['host', 'factor'] as const;
const MOVE_COPY_KEYS = ['host', 'translation'] as const;
const MIRROR_KEYS = ['host', 'planeOrigin', 'planeNormal'] as const;
const RIB_KEYS = ['host', 'start', 'end', 'thickness', 'height', 'centered'] as const;
const OFFSET_FACE_KEYS = ['host', 'faceId', 'distance'] as const;
const CUT_KEYS = ['host', 'toolLoop'] as const;
const LINEAR_PATTERN_KEYS = ['host', 'count', 'direction', 'spacing'] as const;
const CIRCULAR_PATTERN_KEYS = ['host', 'axisPoint', 'axisDirection', 'count', 'totalAngleDeg'] as const;
const LOFT_KEYS = ['sections'] as const;
const LOFT_SECTION_KEYS = ['z', 'loop'] as const;
const SWEEP_KEYS = ['path', 'widthMm', 'heightMm'] as const;
const SWEEP_PATH_KEYS = ['path', 'widthMm', 'heightMm', 'profileFrame', 'transition'] as const;
const SPLIT_BODY_KEYS = ['host', 'plane', 'offset', 'keepSide'] as const;
const DELETE_FACE_KEYS = ['host', 'hole', 'faceSet'] as const;
const DELETE_FACE_HOLE_KEYS = ['center', 'radiusMm', 'depthMm'] as const;
const DELETE_FACE_SET = ['f.hole.wall', 'f.hole.floor', 'f.cap.top.perforated'] as const;
const SHEET_HOST_KEYS = ['lengthMm', 'widthMm', 'thicknessMm'] as const;
const BEND_KEYS = ['host', 'fixedLengthMm', 'innerRadiusMm', 'angleDeg', 'direction'] as const;
const FLANGE_KEYS = ['host', 'straightLegLengthMm', 'innerRadiusMm', 'angleDeg', 'edge', 'direction'] as const;
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_TOPOLOGY_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const MAX_COORDINATE = 1_000_000;
const MAX_DEPTH = 10;
const MAX_NODES = 2_048;
const MAX_STRING_LENGTH = 8 * 1024 * 1024;
const MAX_STEP_BYTES = 8 * 1024 * 1024;
const MAX_FACE_COUNT = 100_000;
const MAX_EDGE_COUNT = 200_000;
const MAX_ELAPSED_MS = 60_000;
const PATTERN_OVERLAP_EPSILON = 1e-6;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

type PlainRecord = Record<string, unknown>;

function isRecord(value: unknown): value is PlainRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: PlainRecord, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}

function snapshot(value: unknown, seen = new Set<object>(), budget = { nodes: 0 }, depth = 0): unknown {
  if (depth > MAX_DEPTH || budget.nodes++ > MAX_NODES) throw new Error('snapshot_limit');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.length > MAX_STRING_LENGTH) throw new Error('snapshot_string');
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('snapshot_number');
    return value;
  }
  if (typeof value !== 'object' || seen.has(value)) throw new Error('snapshot_type');
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > MAX_NODES) throw new Error('snapshot_array');
      const ownKeys = Reflect.ownKeys(value);
      if (ownKeys.some(key => key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key)))) {
        throw new Error('snapshot_array_key');
      }
      return value.map((_, index) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw new Error('snapshot_accessor');
        return snapshot(descriptor.value, seen, budget, depth + 1);
      });
    }
    if (!isRecord(value)) throw new Error('snapshot_object');
    const result: PlainRecord = {};
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length > MAX_NODES || ownKeys.some(key => typeof key !== 'string' || FORBIDDEN_KEYS.has(key))) {
      throw new Error('snapshot_object_key');
    }
    for (const key of ownKeys as string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw new Error('snapshot_accessor');
      result[key] = snapshot(descriptor.value, seen, budget, depth + 1);
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

function finite(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function vector(value: unknown, length: number): value is number[] {
  return Array.isArray(value) && value.length === length && value.every(item => finite(item, -MAX_COORDINATE, MAX_COORDINATE));
}

function prismHost(value: unknown): value is ExactPrismHost {
  if (!isRecord(value) || !exactKeys(value, PRISM_KEYS) || !Array.isArray(value.loop)
    || value.loop.length < 3 || value.loop.length > 256 || !finite(value.depth, 0.001, MAX_COORDINATE)) return false;
  return value.loop.every(point => isRecord(point) && exactKeys(point, POINT_KEYS)
    && finite(point.x, -MAX_COORDINATE, MAX_COORDINATE) && finite(point.y, -MAX_COORDINATE, MAX_COORDINATE));
}

function rectangularSheetHost(value: unknown): value is ExactRectangularSheetHost {
  return isRecord(value) && exactKeys(value, SHEET_HOST_KEYS)
    && finite(value.lengthMm, 0.001, 100_000)
    && finite(value.widthMm, 0.001, 100_000)
    && finite(value.thicknessMm, 0.001, 100_000);
}

function mirroredPrismWithinBounds(
  host: ExactPrismHost,
  planeOrigin: readonly number[],
  planeNormal: readonly number[],
): boolean {
  const length = Math.hypot(planeNormal[0]!, planeNormal[1]!, planeNormal[2]!);
  if (!(length > 1e-12)) return false;
  const normal = planeNormal.map(value => value / length);
  const xs = host.loop.map(point => point.x);
  const ys = host.loop.map(point => point.y);
  const bounds = [Math.min(...xs), Math.min(...ys), 0, Math.max(...xs), Math.max(...ys), host.depth];
  for (let mask = 0; mask < 8; mask++) {
    const point = [
      (mask & 1) === 0 ? bounds[0]! : bounds[3]!,
      (mask & 2) === 0 ? bounds[1]! : bounds[4]!,
      (mask & 4) === 0 ? bounds[2]! : bounds[5]!,
    ];
    const distance = point.reduce(
      (sum, value, axis) => sum + (value - planeOrigin[axis]!) * normal[axis]!,
      0,
    );
    if (point.some((value, axis) =>
      Math.abs(value - 2 * distance * normal[axis]!) > MAX_COORDINATE)) return false;
  }
  return true;
}

type Point2d = { x: number; y: number };

function ribCorners(parameters: { start: Point2d; end: Point2d; thickness: number }): [Point2d, Point2d, Point2d, Point2d] | null {
  const dx = parameters.end.x - parameters.start.x;
  const dy = parameters.end.y - parameters.start.y;
  const length = Math.hypot(dx, dy);
  if (!(length > 1e-9)) return null;
  const nx = -dy / length * parameters.thickness / 2;
  const ny = dx / length * parameters.thickness / 2;
  return [
    { x: parameters.start.x + nx, y: parameters.start.y + ny },
    { x: parameters.end.x + nx, y: parameters.end.y + ny },
    { x: parameters.end.x - nx, y: parameters.end.y - ny },
    { x: parameters.start.x - nx, y: parameters.start.y - ny },
  ];
}

function strictConvexPolygon(loop: ReadonlyArray<Point2d>): boolean {
  let sign = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]!;
    const b = loop[(i + 1) % loop.length]!;
    const c = loop[(i + 2) % loop.length]!;
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-9) return false;
    const nextSign = cross > 0 ? 1 : -1;
    if (sign !== 0 && nextSign !== sign) return false;
    sign = nextSign;
  }
  return sign !== 0;
}

function polygonArea(loop: ReadonlyArray<Point2d>): number {
  let twiceArea = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]!;
    const b = loop[(i + 1) % loop.length]!;
    twiceArea += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twiceArea) / 2;
}

function rectangularToolWithinHost(host: ExactPrismHost, value: unknown): value is ReadonlyArray<Point2d> {
  if (!Array.isArray(value) || value.length !== 4 || !strictConvexPolygon(host.loop)) return false;
  const loop = value as Point2d[];
  if (!loop.every(point => isRecord(point) && exactKeys(point, POINT_KEYS)
    && finite(point.x, -MAX_COORDINATE, MAX_COORDINATE)
    && finite(point.y, -MAX_COORDINATE, MAX_COORDINATE))) return false;
  if (!(polygonArea(loop) > 1e-9)) return false;
  const lengths = loop.map((point, index) => {
    const next = loop[(index + 1) % loop.length]!;
    return Math.hypot(next.x - point.x, next.y - point.y);
  });
  if (lengths.some(length => !(length > 1e-9))) return false;
  for (let i = 0; i < 4; i++) {
    const a = loop[i]!;
    const b = loop[(i + 1) % 4]!;
    const c = loop[(i + 2) % 4]!;
    const ux = b.x - a.x;
    const uy = b.y - a.y;
    const vx = c.x - b.x;
    const vy = c.y - b.y;
    if (Math.abs(ux * vx + uy * vy) > 1e-8 * lengths[i]! * lengths[(i + 1) % 4]!) return false;
    if (Math.abs(lengths[i]! - lengths[(i + 2) % 4]!) > 1e-8 * Math.max(lengths[i]!, lengths[(i + 2) % 4]!)) return false;
  }
  return loop.every(point => pointInsideConvexPolygon(point, host.loop));
}

function pointInsideConvexPolygon(point: Point2d, loop: ReadonlyArray<Point2d>): boolean {
  const signs = loop.map((a, i) => {
    const b = loop[(i + 1) % loop.length]!;
    return (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
  });
  const positive = signs.every(value => value > 1e-9);
  const negative = signs.every(value => value < -1e-9);
  return positive || negative;
}

interface AxisAlignedRectangle {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

function axisAlignedRectangle(host: ExactPrismHost): AxisAlignedRectangle | null {
  if (host.loop.length !== 4 || !strictConvexPolygon(host.loop)) return null;
  const xs = [...new Set(host.loop.map(point => point.x))];
  const ys = [...new Set(host.loop.map(point => point.y))];
  if (xs.length !== 2 || ys.length !== 2) return null;
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = maxX - minX;
  const height = maxY - minY;
  if (!(width > 1e-9) || !(height > 1e-9)) return null;
  const expectedCorners = [
    [minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY],
  ] as const;
  if (!expectedCorners.every(([x, y]) => host.loop.some(point => point.x === x && point.y === y))) return null;
  for (let index = 0; index < host.loop.length; index++) {
    const current = host.loop[index]!;
    const next = host.loop[(index + 1) % host.loop.length]!;
    const horizontal = current.y === next.y && current.x !== next.x;
    const vertical = current.x === next.x && current.y !== next.y;
    if (!horizontal && !vertical) return null;
  }
  return { minX, minY, maxX, maxY, width, height };
}

function validDeleteFaceParameters(
  parameters: PlainRecord,
): parameters is PlainRecord & DeleteFaceExactRequest['parameters'] {
  if (!exactKeys(parameters, DELETE_FACE_KEYS)
    || !prismHost(parameters.host)
    || !axisAlignedRectangle(parameters.host)
    || !isRecord(parameters.hole)
    || !exactKeys(parameters.hole, DELETE_FACE_HOLE_KEYS)
    || !isRecord(parameters.hole.center)
    || !exactKeys(parameters.hole.center, POINT_KEYS)
    || !finite(parameters.hole.center.x, -MAX_COORDINATE, MAX_COORDINATE)
    || !finite(parameters.hole.center.y, -MAX_COORDINATE, MAX_COORDINATE)
    || !finite(parameters.hole.radiusMm, 0.001, 100_000)
    || !finite(parameters.hole.depthMm, 0.001, MAX_COORDINATE)
    || !(parameters.hole.depthMm < parameters.host.depth - PATTERN_OVERLAP_EPSILON)
    || !Array.isArray(parameters.faceSet)
    || parameters.faceSet.length !== DELETE_FACE_SET.length
    || !parameters.faceSet.every((faceId, index) => faceId === DELETE_FACE_SET[index])) return false;
  const rectangle = axisAlignedRectangle(parameters.host);
  if (!rectangle) return false;
  const clearance = parameters.hole.radiusMm + PATTERN_OVERLAP_EPSILON;
  return parameters.hole.center.x > rectangle.minX + clearance
    && parameters.hole.center.x < rectangle.maxX - clearance
    && parameters.hole.center.y > rectangle.minY + clearance
    && parameters.hole.center.y < rectangle.maxY - clearance;
}

interface SplitBodyClip {
  loop: ReadonlyArray<Point2d>;
  z0: number;
  height: number;
  expectedBbox: readonly [number, number, number, number, number, number];
}

function splitBodyClip(parameters: SplitBodyExactRequest['parameters']): SplitBodyClip | null {
  const rectangle = axisAlignedRectangle(parameters.host);
  if (!rectangle) return null;
  const hostBbox = [
    rectangle.minX, rectangle.minY, 0,
    rectangle.maxX, rectangle.maxY, parameters.host.depth,
  ] as const;
  const axis = parameters.plane === 'YZ' ? 0 : parameters.plane === 'XZ' ? 1 : 2;
  const minimum = hostBbox[axis]!;
  const maximum = hostBbox[axis + 3]!;
  if (!(parameters.offset > minimum + PATTERN_OVERLAP_EPSILON)
    || !(parameters.offset < maximum - PATTERN_OVERLAP_EPSILON)) return null;
  const keptMinimum = parameters.keepSide === 'positive' ? parameters.offset : minimum;
  const keptMaximum = parameters.keepSide === 'positive' ? maximum : parameters.offset;
  const expectedBbox = [...hostBbox] as [number, number, number, number, number, number];
  expectedBbox[axis] = keptMinimum;
  expectedBbox[axis + 3] = keptMaximum;

  const minX = axis === 0 ? keptMinimum : rectangle.minX;
  const maxX = axis === 0 ? keptMaximum : rectangle.maxX;
  const minY = axis === 1 ? keptMinimum : rectangle.minY;
  const maxY = axis === 1 ? keptMaximum : rectangle.maxY;
  const z0 = axis === 2 ? keptMinimum : 0;
  const height = axis === 2 ? keptMaximum - keptMinimum : parameters.host.depth;
  if (!(maxX > minX) || !(maxY > minY) || !(height > 0)) return null;
  return {
    loop: [
      { x: minX, y: minY }, { x: maxX, y: minY },
      { x: maxX, y: maxY }, { x: minX, y: maxY },
    ],
    z0,
    height,
    expectedBbox,
  };
}

interface BendConstruction {
  fixedLengthMm: number;
  straightLengthMm: number;
  widthMm: number;
  thicknessMm: number;
  innerRadiusMm: number;
  angleDeg: number;
  flatLoop: ReadonlyArray<Point2d>;
  expectedBbox: readonly [number, number, number, number, number, number];
}

function bendConstruction(parameters: BendExactRequest['parameters']): BendConstruction | null {
  const { host } = parameters;
  const values = [host.lengthMm, host.widthMm, host.thicknessMm, parameters.fixedLengthMm, parameters.innerRadiusMm, parameters.angleDeg];
  if (!values.every(value => Number.isFinite(value) && value >= 0.001 && value <= 100_000)
    || parameters.direction !== 'up'
    || parameters.angleDeg < 5 || parameters.angleDeg > 90
    || !(parameters.fixedLengthMm < host.lengthMm - PATTERN_OVERLAP_EPSILON)) return null;
  const angle = parameters.angleDeg * Math.PI / 180;
  const neutralArcLength = angle * (parameters.innerRadiusMm + host.thicknessMm / 2);
  const movingDevelopedLength = host.lengthMm - parameters.fixedLengthMm;
  const straightLengthMm = movingDevelopedLength - neutralArcLength;
  if (!(straightLengthMm >= 0.001)) return null;
  const outerRadius = parameters.innerRadiusMm + host.thicknessMm;
  const outerEndX = outerRadius * Math.sin(angle);
  const innerEndY = outerRadius - parameters.innerRadiusMm * Math.cos(angle);
  const maximumX = outerEndX + Math.cos(angle) * straightLengthMm;
  const maximumY = innerEndY + Math.sin(angle) * straightLengthMm;
  const expectedBbox = [
    -parameters.fixedLengthMm, 0, 0,
    maximumX, maximumY, host.widthMm,
  ] as const;
  if (!expectedBbox.every(value => Number.isFinite(value) && Math.abs(value) <= MAX_COORDINATE)) return null;
  return {
    fixedLengthMm: parameters.fixedLengthMm,
    straightLengthMm,
    widthMm: host.widthMm,
    thicknessMm: host.thicknessMm,
    innerRadiusMm: parameters.innerRadiusMm,
    angleDeg: parameters.angleDeg,
    flatLoop: [
      { x: -parameters.fixedLengthMm, y: 0 },
      { x: movingDevelopedLength, y: 0 },
      { x: movingDevelopedLength, y: host.thicknessMm },
      { x: -parameters.fixedLengthMm, y: host.thicknessMm },
    ],
    expectedBbox,
  };
}

function flangeConstruction(parameters: FlangeExactRequest['parameters']): BendConstruction | null {
  const { host } = parameters;
  const values = [host.lengthMm, host.widthMm, host.thicknessMm, parameters.straightLegLengthMm, parameters.innerRadiusMm, parameters.angleDeg];
  if (!values.every(value => Number.isFinite(value) && value >= 0.001 && value <= 100_000)
    || parameters.edge !== 'positive_length_end' || parameters.direction !== 'up'
    || parameters.angleDeg < 5 || parameters.angleDeg > 90) return null;
  const angle = parameters.angleDeg * Math.PI / 180;
  const outerRadius = parameters.innerRadiusMm + host.thicknessMm;
  const maximumX = outerRadius * Math.sin(angle) + Math.cos(angle) * parameters.straightLegLengthMm;
  const maximumY = outerRadius - parameters.innerRadiusMm * Math.cos(angle)
    + Math.sin(angle) * parameters.straightLegLengthMm;
  const expectedBbox = [
    -host.lengthMm, 0, 0,
    maximumX, maximumY, host.widthMm,
  ] as const;
  if (!expectedBbox.every(value => Number.isFinite(value) && Math.abs(value) <= MAX_COORDINATE)) return null;
  return {
    fixedLengthMm: host.lengthMm,
    straightLengthMm: parameters.straightLegLengthMm,
    widthMm: host.widthMm,
    thicknessMm: host.thicknessMm,
    innerRadiusMm: parameters.innerRadiusMm,
    angleDeg: parameters.angleDeg,
    flatLoop: [
      { x: -host.lengthMm, y: 0 }, { x: 0, y: 0 },
      { x: 0, y: host.thicknessMm }, { x: -host.lengthMm, y: host.thicknessMm },
    ],
    expectedBbox,
  };
}

function linearPatternDirection(value: unknown): value is readonly [number, number, number] {
  return Array.isArray(value) && value.length === 3
    && ((value[0] === 1 || value[0] === -1) && value[1] === 0 && value[2] === 0
      || value[0] === 0 && (value[1] === 1 || value[1] === -1) && value[2] === 0);
}

function linearPatternWithinBounds(
  rectangle: AxisAlignedRectangle,
  direction: readonly [number, number, number],
  count: number,
  spacing: number,
): boolean {
  const delta = (count - 1) * spacing;
  if (!Number.isFinite(delta)) return false;
  const minX = rectangle.minX + Math.min(0, direction[0] * delta);
  const minY = rectangle.minY + Math.min(0, direction[1] * delta);
  const maxX = rectangle.maxX + Math.max(0, direction[0] * delta);
  const maxY = rectangle.maxY + Math.max(0, direction[1] * delta);
  return [minX, minY, maxX, maxY].every(value => Number.isFinite(value) && Math.abs(value) <= MAX_COORDINATE);
}

function circularPatternAxisDirection(value: unknown): value is readonly [number, number, number] {
  return Array.isArray(value) && value.length === 3
    && value[0] === 0 && value[1] === 0 && (value[2] === 1 || value[2] === -1);
}

function circularPatternExpectedBbox(
  host: ExactPrismHost,
  axisPoint: readonly [number, number, number],
  axisDirection: readonly [number, number, number],
  count: number,
  totalAngleDeg: number,
): readonly [number, number, number, number, number, number] | null {
  const rectangle = axisAlignedRectangle(host);
  if (!rectangle || !Number.isFinite(totalAngleDeg) || !Number.isFinite(axisPoint[0])
    || !Number.isFinite(axisPoint[1]) || !Number.isFinite(axisPoint[2])) return null;
  const min = [Infinity, Infinity, 0];
  const max = [-Infinity, -Infinity, host.depth];
  const directionSign = axisDirection[2];
  for (let index = 0; index < count; index++) {
    const angle = totalAngleDeg * index / (count - 1) * directionSign * Math.PI / 180;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    for (const point of host.loop) {
      const dx = point.x - axisPoint[0];
      const dy = point.y - axisPoint[1];
      const x = axisPoint[0] + dx * cosine - dy * sine;
      const y = axisPoint[1] + dx * sine + dy * cosine;
      min[0] = Math.min(min[0]!, x);
      min[1] = Math.min(min[1]!, y);
      max[0] = Math.max(max[0]!, x);
      max[1] = Math.max(max[1]!, y);
    }
  }
  const bbox = [min[0]!, min[1]!, 0, max[0]!, max[1]!, host.depth] as const;
  return bbox.every(Number.isFinite) ? bbox : null;
}

function circularPatternAxisIsSafe(
  rectangle: AxisAlignedRectangle,
  axisPoint: readonly [number, number, number],
): boolean {
  const centerX = (rectangle.minX + rectangle.maxX) / 2;
  const centerY = (rectangle.minY + rectangle.maxY) / 2;
  return axisPoint[0] === centerX && axisPoint[1] === centerY && axisPoint[2] === 0;
}

type LoftSectionValue = {
  z: number;
  loop: ReadonlyArray<Point2d>;
};

function loftAggregateBbox(
  sections: ReadonlyArray<LoftSectionValue>,
): readonly [number, number, number, number, number, number] | null {
  if (sections.length < 2) return null;
  const minX = Math.min(...sections.flatMap(section => section.loop.map(point => point.x)));
  const minY = Math.min(...sections.flatMap(section => section.loop.map(point => point.y)));
  const maxX = Math.max(...sections.flatMap(section => section.loop.map(point => point.x)));
  const maxY = Math.max(...sections.flatMap(section => section.loop.map(point => point.y)));
  const minZ = sections[0]!.z;
  const maxZ = sections[sections.length - 1]!.z;
  const bbox = [minX, minY, minZ, maxX, maxY, maxZ] as const;
  return bbox.every(value => Number.isFinite(value) && Math.abs(value) <= MAX_COORDINATE)
    && maxX > minX && maxY > minY && maxZ > minZ ? bbox : null;
}

function validLoftSections(value: unknown): value is ReadonlyArray<LoftSectionValue> {
  if (!Array.isArray(value) || (value.length !== 2 && value.length !== 3)) return false;
  let vertexCount: number | null = null;
  let winding: number | null = null;
  let previousZ = -Infinity;
  for (const section of value) {
    if (!isRecord(section) || !exactKeys(section, LOFT_SECTION_KEYS)
      || !finite(section.z, -MAX_COORDINATE, MAX_COORDINATE)
      || !(section.z > previousZ + PATTERN_OVERLAP_EPSILON)
      || !Array.isArray(section.loop) || section.loop.length < 3 || section.loop.length > 32) return false;
    previousZ = section.z;
    if (vertexCount === null) vertexCount = section.loop.length;
    if (section.loop.length !== vertexCount) return false;
    const loop = section.loop as Point2d[];
    if (!loop.every(point => isRecord(point) && exactKeys(point, POINT_KEYS)
      && finite(point.x, -MAX_COORDINATE, MAX_COORDINATE)
      && finite(point.y, -MAX_COORDINATE, MAX_COORDINATE))) return false;
    if (!strictConvexPolygon(loop) || !(polygonArea(loop) > 1e-9)) return false;
    let twiceArea = 0;
    for (let index = 0; index < loop.length; index++) {
      const current = loop[index]!;
      const next = loop[(index + 1) % loop.length]!;
      twiceArea += current.x * next.y - next.x * current.y;
    }
    const sectionWinding = twiceArea > 0 ? 1 : -1;
    if (winding === null) winding = sectionWinding;
    if (winding !== sectionWinding) return false;
  }
  return loftAggregateBbox(value) !== null;
}

function sweepSegment(
  left: readonly number[],
  right: readonly number[],
): { axis: 0 | 1 | 2; length: number } | null {
  const delta = right.map((value, index) => value - left[index]!);
  const nonZero = delta
    .map((value, axis) => ({ value, axis }))
    .filter(item => Math.abs(item.value) > 1e-9);
  if (nonZero.length !== 1) return null;
  const item = nonZero[0]!;
  const length = Math.abs(item.value);
  return length >= 0.001 && length <= MAX_COORDINATE
    ? { axis: item.axis as 0 | 1 | 2, length }
    : null;
}

function validOrthogonalSweepParameters(value: PlainRecord): value is PlainRecord & SweepExactRequest['parameters'] {
  if (!exactKeys(value, SWEEP_KEYS) || !Array.isArray(value.path) || value.path.length !== 3
    || !value.path.every(point => vector(point, 3))
    || !finite(value.widthMm, 0.001, 100_000)
    || !finite(value.heightMm, 0.001, 100_000)) return false;
  const path = value.path as number[][];
  const first = sweepSegment(path[0]!, path[1]!);
  const second = sweepSegment(path[1]!, path[2]!);
  if (!first || !second || first.axis === second.axis) return false;
  const halfDiagonal = Math.hypot(value.widthMm, value.heightMm) / 2;
  if (!(halfDiagonal < Math.min(first.length, second.length) / 4)) return false;
  const min = [0, 1, 2].map(axis => Math.min(...path.map(point => point[axis]!)) - halfDiagonal);
  const max = [0, 1, 2].map(axis => Math.max(...path.map(point => point[axis]!)) + halfDiagonal);
  return [...min, ...max].every(coordinate => Math.abs(coordinate) <= MAX_COORDINATE);
}

function validOrthogonalSweepPathParameters(
  value: PlainRecord,
): value is PlainRecord & SweepPathExactRequest['parameters'] {
  if (!exactKeys(value, SWEEP_PATH_KEYS)
    || value.profileFrame !== 'normal_to_first_segment'
    || value.transition !== 'right_corner') return false;
  return validOrthogonalSweepParameters({
    path: value.path,
    widthMm: value.widthMm,
    heightMm: value.heightMm,
  });
}

function ribWithinHost(host: ExactPrismHost, parameters: { start: Point2d; end: Point2d; thickness: number }): boolean {
  if (!strictConvexPolygon(host.loop)) return false;
  const corners = ribCorners(parameters);
  if (!corners) return false;
  return corners.every(point => pointInsideConvexPolygon(point, host.loop)
    && Math.abs(point.x) <= MAX_COORDINATE && Math.abs(point.y) <= MAX_COORDINATE);
}

function validateRequest(input: unknown): NativeMechanicalExactFeatureRequest | null {
  let copied: unknown;
  try { copied = snapshot(input); } catch { return null; }
  if (!isRecord(copied) || !exactKeys(copied, REQUEST_KEYS)) return null;
  if (copied.schema !== NATIVE_MECHANICAL_EXACT_REQUEST_SCHEMA
    || typeof copied.featureId !== 'string'
    || !['cad.mechanical.variable-fillet', 'cad.mechanical.draft', 'cad.mechanical.thread', 'cad.mechanical.scale', 'cad.mechanical.move-copy', 'cad.mechanical.mirror', 'cad.mechanical.rib', 'cad.mechanical.offset-face', 'cad.mechanical.cut', 'cad.mechanical.linear-pattern', 'cad.mechanical.circular-pattern', 'cad.mechanical.loft', 'cad.mechanical.sweep', 'cad.mechanical.sweep-path', 'cad.mechanical.split-body', 'cad.mechanical.delete-face', 'cad.mechanical.bend', 'cad.mechanical.flange'].includes(copied.featureId)
    || ![copied.operationId, copied.projectId, copied.documentId, copied.baseRevisionId].every(value => typeof value === 'string' && SAFE_ID.test(value))
    || !Number.isSafeInteger(copied.baseSequence) || (copied.baseSequence as number) < 0
    || typeof copied.baseContentSha256 !== 'string' || !SHA256.test(copied.baseContentSha256)
    || !isRecord(copied.parameters)) return null;

  const parameters = copied.parameters;
  if (copied.featureId === 'cad.mechanical.variable-fillet') {
    if (!exactKeys(parameters, VARIABLE_KEYS) || !prismHost(parameters.host)
      || !Array.isArray(parameters.edgeRadii) || parameters.edgeRadii.length < 1 || parameters.edgeRadii.length > 64) return null;
    const ids = new Set<string>();
    for (const edge of parameters.edgeRadii) {
      if (!isRecord(edge) || !exactKeys(edge, EDGE_RADIUS_KEYS) || typeof edge.edgeId !== 'string'
        || !SAFE_TOPOLOGY_ID.test(edge.edgeId) || ids.has(edge.edgeId) || !finite(edge.radius, 0.001, 100_000)) return null;
      ids.add(edge.edgeId);
    }
  } else if (copied.featureId === 'cad.mechanical.draft') {
    if (!exactKeys(parameters, DRAFT_KEYS) || !prismHost(parameters.host)
      || !finite(parameters.angleDeg, 0.001, 45) || !vector(parameters.pullDirection, 3)
      || Math.hypot(...parameters.pullDirection) < 1e-9 || !finite(parameters.neutralZ, -MAX_COORDINATE, MAX_COORDINATE)) return null;
  } else if (copied.featureId === 'cad.mechanical.thread') {
    if (!exactKeys(parameters, THREAD_KEYS) || !vector(parameters.center, 3)
      || !Array.isArray(parameters.axis) || parameters.axis.length !== 3 || parameters.axis[0] !== 0 || parameters.axis[1] !== 0 || parameters.axis[2] !== 1
      || !finite(parameters.nominalDiameter, 0.01, 100_000) || !finite(parameters.minorDiameter, 0.001, 100_000)
      || !(parameters.minorDiameter < parameters.nominalDiameter)
      || !finite(parameters.hostDepth, 0.01, MAX_COORDINATE) || !finite(parameters.pitch, 0.001, 100_000)
      || !finite(parameters.threadLength, 0.01, MAX_COORDINATE) || parameters.threadLength > parameters.hostDepth
      || parameters.threadLength / parameters.pitch > 8
      || (parameters.direction !== 'right_hand' && parameters.direction !== 'left_hand')) return null;
  } else if (copied.featureId === 'cad.mechanical.scale') {
    if (!exactKeys(parameters, SCALE_KEYS) || !prismHost(parameters.host) || !finite(parameters.factor, 0.001, 1_000)
      || Math.abs((parameters.factor as number) - 1) < 1e-9
      || (parameters.host as ExactPrismHost).depth * (parameters.factor as number) > MAX_COORDINATE
      || (parameters.host as ExactPrismHost).loop.some(point => Math.abs(point.x * (parameters.factor as number)) > MAX_COORDINATE
        || Math.abs(point.y * (parameters.factor as number)) > MAX_COORDINATE)) return null;
  } else if (copied.featureId === 'cad.mechanical.move-copy') {
    if (!exactKeys(parameters, MOVE_COPY_KEYS) || !prismHost(parameters.host) || !vector(parameters.translation, 3)
      || Math.hypot(...parameters.translation) < 1e-9
      || (parameters.host as ExactPrismHost).loop.some(point =>
        Math.abs(point.x + (parameters.translation as number[])[0]!) > MAX_COORDINATE
        || Math.abs(point.y + (parameters.translation as number[])[1]!) > MAX_COORDINATE)
      || Math.abs((parameters.translation as number[])[2]!) > MAX_COORDINATE
      || Math.abs((parameters.translation as number[])[2]! + (parameters.host as ExactPrismHost).depth) > MAX_COORDINATE) return null;
  } else if (copied.featureId === 'cad.mechanical.mirror') {
    if (!exactKeys(parameters, MIRROR_KEYS) || !prismHost(parameters.host)
      || !vector(parameters.planeOrigin, 3) || !vector(parameters.planeNormal, 3)
      || Math.hypot(...parameters.planeNormal) < 1e-12
      || !mirroredPrismWithinBounds(
        parameters.host,
        parameters.planeOrigin,
        parameters.planeNormal,
      )) return null;
  } else if (copied.featureId === 'cad.mechanical.rib') {
    if (!exactKeys(parameters, RIB_KEYS) || !prismHost(parameters.host)
      || !isRecord(parameters.start) || !exactKeys(parameters.start, POINT_KEYS)
      || !isRecord(parameters.end) || !exactKeys(parameters.end, POINT_KEYS)
      || !finite(parameters.start.x, -MAX_COORDINATE, MAX_COORDINATE)
      || !finite(parameters.start.y, -MAX_COORDINATE, MAX_COORDINATE)
      || !finite(parameters.end.x, -MAX_COORDINATE, MAX_COORDINATE)
      || !finite(parameters.end.y, -MAX_COORDINATE, MAX_COORDINATE)
      || !finite(parameters.thickness, 0.001, 100_000)
      || !finite(parameters.height, 0.001, 100_000)
      // The bounded kernel path constructs a symmetric footprint. Reject the
      // alternate semantic until an independently verified offset-rib path exists.
      || parameters.centered !== true
      || !ribWithinHost(parameters.host, parameters as unknown as { start: Point2d; end: Point2d; thickness: number })
      || parameters.host.depth + (parameters.height as number) > MAX_COORDINATE) return null;
  } else if (copied.featureId === 'cad.mechanical.offset-face') {
    if (!exactKeys(parameters, OFFSET_FACE_KEYS) || !prismHost(parameters.host)
      || parameters.faceId !== 'f.cap.top'
      || !finite(parameters.distance, 0.001, 100_000)
      || parameters.host.depth + (parameters.distance as number) > MAX_COORDINATE
      || !strictConvexPolygon(parameters.host.loop)
      || !(polygonArea(parameters.host.loop) > 1e-9)) return null;
  } else if (copied.featureId === 'cad.mechanical.cut') {
    if (!exactKeys(parameters, CUT_KEYS) || !prismHost(parameters.host)
      || !rectangularToolWithinHost(parameters.host, parameters.toolLoop)) return null;
  } else if (copied.featureId === 'cad.mechanical.linear-pattern') {
    if (!exactKeys(parameters, LINEAR_PATTERN_KEYS) || !prismHost(parameters.host)
      || !axisAlignedRectangle(parameters.host)
      || typeof parameters.count !== 'number' || !Number.isSafeInteger(parameters.count) || parameters.count < 2 || parameters.count > 8
      || !linearPatternDirection(parameters.direction)
      || !finite(parameters.spacing, 0.000001, MAX_COORDINATE)) return null;
    const rectangle = axisAlignedRectangle(parameters.host);
    if (!rectangle
      || !(parameters.spacing < (parameters.direction[0] !== 0 ? rectangle.width : rectangle.height) - PATTERN_OVERLAP_EPSILON)
      || !linearPatternWithinBounds(rectangle, parameters.direction, parameters.count, parameters.spacing)) return null;
  } else if (copied.featureId === 'cad.mechanical.circular-pattern') {
    if (!exactKeys(parameters, CIRCULAR_PATTERN_KEYS) || !prismHost(parameters.host)
      || !axisAlignedRectangle(parameters.host)
      || !vector(parameters.axisPoint, 3)
      || !circularPatternAxisDirection(parameters.axisDirection)
      || typeof parameters.count !== 'number' || !Number.isSafeInteger(parameters.count) || parameters.count < 2 || parameters.count > 8
      || typeof parameters.totalAngleDeg !== 'number' || !Number.isFinite(parameters.totalAngleDeg)
      || Math.abs(parameters.totalAngleDeg) < 0.000001 || Math.abs(parameters.totalAngleDeg) >= 360) return null;
    const rectangle = axisAlignedRectangle(parameters.host);
    const axisPoint = parameters.axisPoint as unknown as readonly [number, number, number];
    const expectedBbox = circularPatternExpectedBbox(
      parameters.host, axisPoint, parameters.axisDirection, parameters.count, parameters.totalAngleDeg,
    );
    if (!rectangle || !circularPatternAxisIsSafe(rectangle, axisPoint)
      || !expectedBbox || !expectedBbox.every(value => Math.abs(value) <= MAX_COORDINATE)) return null;
  } else if (copied.featureId === 'cad.mechanical.loft') {
    if (!exactKeys(parameters, LOFT_KEYS) || !validLoftSections(parameters.sections)) return null;
  } else if (copied.featureId === 'cad.mechanical.sweep') {
    if (!validOrthogonalSweepParameters(parameters)) return null;
  } else if (copied.featureId === 'cad.mechanical.sweep-path') {
    if (!validOrthogonalSweepPathParameters(parameters)) return null;
  } else if (copied.featureId === 'cad.mechanical.split-body') {
    if (!exactKeys(parameters, SPLIT_BODY_KEYS)
      || !prismHost(parameters.host)
      || (parameters.plane !== 'XY' && parameters.plane !== 'XZ' && parameters.plane !== 'YZ')
      || !finite(parameters.offset, -MAX_COORDINATE, MAX_COORDINATE)
      || (parameters.keepSide !== 'positive' && parameters.keepSide !== 'negative')
      || !splitBodyClip(parameters as unknown as SplitBodyExactRequest['parameters'])) return null;
  } else if (copied.featureId === 'cad.mechanical.delete-face') {
    if (!validDeleteFaceParameters(parameters)) return null;
  } else if (copied.featureId === 'cad.mechanical.bend') {
    if (!exactKeys(parameters, BEND_KEYS)
      || !rectangularSheetHost(parameters.host)
      || !finite(parameters.fixedLengthMm, 0.001, 100_000)
      || !finite(parameters.innerRadiusMm, 0.001, 100_000)
      || !finite(parameters.angleDeg, 5, 90)
      || parameters.direction !== 'up'
      || !bendConstruction(parameters as unknown as BendExactRequest['parameters'])) return null;
  } else if (!exactKeys(parameters, FLANGE_KEYS)
    || !rectangularSheetHost(parameters.host)
    || !finite(parameters.straightLegLengthMm, 0.001, 100_000)
    || !finite(parameters.innerRadiusMm, 0.001, 100_000)
    || !finite(parameters.angleDeg, 5, 90)
    || parameters.edge !== 'positive_length_end'
    || parameters.direction !== 'up'
    || !flangeConstruction(parameters as unknown as FlangeExactRequest['parameters'])) {
    return null;
  }
  return copied as unknown as NativeMechanicalExactFeatureRequest;
}

function hashString(value: string): string {
  const hash = new Sha256();
  hash.update(value);
  return [...hash.digestSync()].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function hashCanonical(value: unknown): string {
  return hashString(canonicalCadConsumerDraftJson(value as CanonicalCadJsonValue));
}

/**
 * Validate an exact-loop result at an untrusted boundary. Every read is made
 * from a descriptor snapshot, so hostile accessors/proxies and malformed
 * values fail closed without escaping an exception.
 *
 * When `stepArtifact` is supplied it is treated as an independently transported
 * artifact and must hash-bind to the receipt. The result's embedded artifact is
 * always checked.
 */
export function validateNativeMechanicalExactFeatureResult(input: unknown, stepArtifact?: unknown): input is NativeMechanicalExactFeatureResult {
  try {
    const copied = snapshot(input);
    if (!isRecord(copied) || !exactKeys(copied, RESULT_KEYS) || (copied.status !== 'EXACT_PASS' && copied.status !== 'HOLD')
      || !Array.isArray(copied.blockerCodes) || copied.blockerCodes.some(code => typeof code !== 'string' || !BLOCKER_CODES.includes(code as NativeMechanicalExactBlockerCode))) return false;
    if (copied.status === 'HOLD') {
      return copied.blockerCodes.length > 0 && new Set(copied.blockerCodes).size === copied.blockerCodes.length
        && copied.receipt === null && copied.stepArtifact === null
        && stepArtifact === undefined;
    }
    if (copied.blockerCodes.length !== 0 || typeof copied.stepArtifact !== 'string'
      || !copied.stepArtifact.startsWith('ISO-10303-21;')
      || !copied.stepArtifact.includes('ADVANCED_BREP_SHAPE_REPRESENTATION')
      || !isRecord(copied.receipt)) return false;
    if (stepArtifact !== undefined) {
      const external = snapshot(stepArtifact);
      if (typeof external !== 'string' || external !== copied.stepArtifact) return false;
    }
    return validateNativeMechanicalExactReceiptSnapshot(copied.receipt, copied.stepArtifact);
  } catch {
    return false;
  }
}

function validateNativeMechanicalExactReceiptSnapshot(receipt: PlainRecord, stepArtifact: string): boolean {
  if (!exactKeys(receipt, RECEIPT_KEYS) || receipt.schema !== NATIVE_MECHANICAL_EXACT_RECEIPT_SCHEMA || receipt.status !== 'EXACT_PASS'
    || typeof receipt.featureId !== 'string' || !['cad.mechanical.variable-fillet', 'cad.mechanical.draft', 'cad.mechanical.thread', 'cad.mechanical.scale', 'cad.mechanical.move-copy', 'cad.mechanical.mirror', 'cad.mechanical.rib', 'cad.mechanical.offset-face', 'cad.mechanical.cut', 'cad.mechanical.linear-pattern', 'cad.mechanical.circular-pattern', 'cad.mechanical.loft', 'cad.mechanical.sweep', 'cad.mechanical.split-body', 'cad.mechanical.bend', 'cad.mechanical.flange'].includes(receipt.featureId)
    || ![receipt.operationId, receipt.projectId, receipt.documentId, receipt.baseRevisionId].every(value => typeof value === 'string' && SAFE_ID.test(value))
    || !Number.isSafeInteger(receipt.baseSequence) || (receipt.baseSequence as number) < 0
    || ![receipt.baseContentSha256, receipt.registryHash, receipt.runtimeIdentitySha256, receipt.requestSha256, receipt.resultMeasurementSha256, receipt.roundtripMeasurementSha256, receipt.stepSha256, receipt.receiptSha256].every(value => typeof value === 'string' && SHA256.test(value))
    || !Array.isArray(receipt.blockerCodes) || receipt.blockerCodes.length !== 0
    || receipt.authoritativeCommit !== false || receipt.commercialReleaseReady !== false
    || receipt.stepSha256 !== hashString(stepArtifact)) return false;
  const { receiptSha256: _receiptSha256, ...core } = receipt;
  return hashCanonical(core) === receipt.receiptSha256;
}

/** Validate a receipt only while binding it to its independently transported STEP artifact. */
export function validateNativeMechanicalExactReceipt(receipt: unknown, stepArtifact: unknown): receipt is NativeMechanicalExactReceipt {
  try {
    const copied = snapshot(receipt);
    if (!isRecord(copied) || typeof stepArtifact !== 'string') return false;
    const artifact = snapshot(stepArtifact);
    return typeof artifact === 'string' && artifact.startsWith('ISO-10303-21;')
      && artifact.includes('ADVANCED_BREP_SHAPE_REPRESENTATION')
      && validateNativeMechanicalExactReceiptSnapshot(copied, artifact);
  } catch {
    return false;
  }
}

function measurement(inspection: OcctDetailedShapeInspection): NativeMechanicalExactMeasurement {
  const adjacency = inspection.faceAdjacency;
  return {
    valid: inspection.valid,
    solidCount: inspection.solidCount,
    faceCount: inspection.faceCount,
    edgeCount: inspection.edgeCount,
    adjacencyFaceCount: adjacency.status === 'available' ? adjacency.faceCount : -1,
    adjacencyEdgeCount: adjacency.status === 'available' ? adjacency.uniqueEdgeCount : -1,
    boundaryEdgeCount: adjacency.status === 'available' ? adjacency.boundaryEdgeCount : -1,
    nonManifoldEdgeCount: adjacency.status === 'available' ? adjacency.nonManifoldEdgeCount : -1,
    absoluteVolume: inspection.absoluteVolume,
    bboxMm: [
      inspection.bbox.min.x, inspection.bbox.min.y, inspection.bbox.min.z,
      inspection.bbox.max.x, inspection.bbox.max.y, inspection.bbox.max.z,
    ],
  };
}

function measurementValid(value: NativeMechanicalExactMeasurement): boolean {
  return value.valid && value.solidCount === 1 && value.faceCount > 0 && value.edgeCount > 0
    && value.adjacencyFaceCount === value.faceCount
    && value.adjacencyEdgeCount === value.edgeCount
    && value.boundaryEdgeCount === 0 && value.nonManifoldEdgeCount === 0
    && Number.isFinite(value.absoluteVolume) && value.absoluteVolume > 0
    && value.bboxMm.every(Number.isFinite);
}

function measurementWithinBudget(value: NativeMechanicalExactMeasurement): boolean {
  return value.faceCount <= MAX_FACE_COUNT && value.edgeCount <= MAX_EDGE_COUNT
    && value.bboxMm.every(coordinate => Math.abs(coordinate) <= MAX_COORDINATE);
}

function scaleInvariant(
  before: NativeMechanicalExactMeasurement,
  after: NativeMechanicalExactMeasurement,
  factor: number,
): boolean {
  const expectedVolume = before.absoluteVolume * factor ** 3;
  const volumeError = Math.abs(after.absoluteVolume - expectedVolume) / Math.max(expectedVolume, 1e-12);
  const bboxError = Math.max(...before.bboxMm.map((value, index) => {
    const expected = value * factor;
    return Math.abs(after.bboxMm[index]! - expected) / Math.max(1, Math.abs(expected));
  }));
  return before.solidCount === after.solidCount
    && before.faceCount === after.faceCount
    && before.edgeCount === after.edgeCount
    && volumeError <= 1e-8
    && bboxError <= 1e-8;
}

function translationInvariant(
  before: NativeMechanicalExactMeasurement,
  after: NativeMechanicalExactMeasurement,
  offset: readonly [number, number, number],
): boolean {
  const volumeError = Math.abs(after.absoluteVolume - before.absoluteVolume) / Math.max(before.absoluteVolume, 1e-12);
  const bboxError = Math.max(...before.bboxMm.map((value, index) => {
    const expected = value + offset[index % 3]!;
    return Math.abs(after.bboxMm[index]! - expected) / Math.max(1, Math.abs(expected));
  }));
  return before.solidCount === after.solidCount
    && before.faceCount === after.faceCount
    && before.edgeCount === after.edgeCount
    && volumeError <= 1e-8
    && bboxError <= 1e-8;
}

function mirrorInvariant(
  before: NativeMechanicalExactMeasurement,
  after: NativeMechanicalExactMeasurement,
  planeOrigin: readonly [number, number, number],
  planeNormal: readonly [number, number, number],
): boolean {
  const normalLength = Math.hypot(planeNormal[0], planeNormal[1], planeNormal[2]);
  if (!(normalLength > 1e-12)) return false;
  const n: [number, number, number] = [
    planeNormal[0] / normalLength, planeNormal[1] / normalLength, planeNormal[2] / normalLength,
  ];
  const expectedMin = [Infinity, Infinity, Infinity];
  const expectedMax = [-Infinity, -Infinity, -Infinity];
  for (let mask = 0; mask < 8; mask++) {
    const point: [number, number, number] = [
      (mask & 1) === 0 ? before.bboxMm[0] : before.bboxMm[3],
      (mask & 2) === 0 ? before.bboxMm[1] : before.bboxMm[4],
      (mask & 4) === 0 ? before.bboxMm[2] : before.bboxMm[5],
    ];
    const distance = (point[0] - planeOrigin[0]) * n[0]
      + (point[1] - planeOrigin[1]) * n[1]
      + (point[2] - planeOrigin[2]) * n[2];
    const reflected: [number, number, number] = [
      point[0] - 2 * distance * n[0],
      point[1] - 2 * distance * n[1],
      point[2] - 2 * distance * n[2],
    ];
    for (let axis = 0; axis < 3; axis++) {
      expectedMin[axis] = Math.min(expectedMin[axis]!, reflected[axis]!);
      expectedMax[axis] = Math.max(expectedMax[axis]!, reflected[axis]!);
    }
  }
  const expected = [...expectedMin, ...expectedMax];
  const bboxError = Math.max(...expected.map((value, index) =>
    Math.abs(after.bboxMm[index]! - value) / Math.max(1, Math.abs(value))));
  const volumeError = Math.abs(after.absoluteVolume - before.absoluteVolume) / Math.max(before.absoluteVolume, 1e-12);
  return before.solidCount === after.solidCount
    && before.faceCount === after.faceCount
    && before.edgeCount === after.edgeCount
    && volumeError <= 1e-8
    && bboxError <= 1e-8;
}

function ribInvariant(
  before: NativeMechanicalExactMeasurement,
  after: NativeMechanicalExactMeasurement,
  parameters: RibExactRequest['parameters'],
): boolean {
  const corners = ribCorners(parameters);
  if (!corners) return false;
  const length = Math.hypot(parameters.end.x - parameters.start.x, parameters.end.y - parameters.start.y);
  const expectedVolume = before.absoluteVolume + length * parameters.thickness * parameters.height;
  const volumeError = Math.abs(after.absoluteVolume - expectedVolume) / Math.max(expectedVolume, 1e-12);
  const expected = [
    Math.min(before.bboxMm[0], ...corners.map(point => point.x)),
    Math.min(before.bboxMm[1], ...corners.map(point => point.y)),
    before.bboxMm[2],
    Math.max(before.bboxMm[3], ...corners.map(point => point.x)),
    Math.max(before.bboxMm[4], ...corners.map(point => point.y)),
    before.bboxMm[5] + parameters.height,
  ];
  const bboxError = Math.max(...expected.map((value, index) =>
    Math.abs(after.bboxMm[index]! - value) / Math.max(1, Math.abs(value))));
  return after.solidCount === 1 && after.faceCount > 0 && after.edgeCount > 0
    && volumeError <= 1e-6 && bboxError <= 1e-6;
}

function offsetFaceInvariant(
  before: NativeMechanicalExactMeasurement,
  after: NativeMechanicalExactMeasurement,
  parameters: OffsetFaceExactRequest['parameters'],
): boolean {
  const area = polygonArea(parameters.host.loop);
  const expectedVolume = before.absoluteVolume + area * parameters.distance;
  const volumeError = Math.abs(after.absoluteVolume - expectedVolume) / Math.max(expectedVolume, 1e-12);
  const expected = [
    before.bboxMm[0], before.bboxMm[1], before.bboxMm[2],
    before.bboxMm[3], before.bboxMm[4], before.bboxMm[5] + parameters.distance,
  ];
  const bboxError = Math.max(...expected.map((value, index) =>
    Math.abs(after.bboxMm[index]! - value) / Math.max(1, Math.abs(value))));
  return after.solidCount === 1 && after.faceCount > 0 && after.edgeCount > 0
    && volumeError <= 1e-6 && bboxError <= 1e-6;
}

function cutInvariant(
  before: NativeMechanicalExactMeasurement,
  after: NativeMechanicalExactMeasurement,
  parameters: CutExactRequest['parameters'],
): boolean {
  const removedVolume = polygonArea(parameters.toolLoop) * parameters.host.depth;
  const expectedVolume = before.absoluteVolume - removedVolume;
  if (!(expectedVolume > 0)) return false;
  const volumeError = Math.abs(after.absoluteVolume - expectedVolume) / Math.max(expectedVolume, 1e-12);
  const bboxError = Math.max(...before.bboxMm.map((value, index) =>
    Math.abs(after.bboxMm[index]! - value) / Math.max(1, Math.abs(value))));
  return after.solidCount === 1 && after.faceCount > 0 && after.edgeCount > 0
    && volumeError <= 1e-6 && bboxError <= 1e-6;
}

function linearPatternInvariant(
  before: NativeMechanicalExactMeasurement,
  after: NativeMechanicalExactMeasurement,
  parameters: LinearPatternExactRequest['parameters'],
): boolean {
  const rectangle = axisAlignedRectangle(parameters.host);
  if (!rectangle) return false;
  const delta = (parameters.count - 1) * parameters.spacing;
  const alongX = parameters.direction[0] !== 0;
  const repeatedLength = (alongX ? rectangle.width : rectangle.height) + delta;
  const crossSection = (alongX ? rectangle.height : rectangle.width) * parameters.host.depth;
  const expectedVolume = repeatedLength * crossSection;
  if (!(expectedVolume > 0)) return false;
  const volumeError = Math.abs(after.absoluteVolume - expectedVolume) / Math.max(expectedVolume, 1e-12);
  const expected = [
    before.bboxMm[0] + Math.min(0, parameters.direction[0] * delta),
    before.bboxMm[1] + Math.min(0, parameters.direction[1] * delta),
    before.bboxMm[2],
    before.bboxMm[3] + Math.max(0, parameters.direction[0] * delta),
    before.bboxMm[4] + Math.max(0, parameters.direction[1] * delta),
    before.bboxMm[5],
  ];
  const bboxError = Math.max(...expected.map((value, index) =>
    Math.abs(after.bboxMm[index]! - value) / Math.max(1, Math.abs(value))));
  return after.solidCount === 1 && after.faceCount > 0 && after.edgeCount > 0
    && volumeError <= 1e-6 && bboxError <= 1e-6;
}

function circularPatternInvariant(
  before: NativeMechanicalExactMeasurement,
  after: NativeMechanicalExactMeasurement,
  parameters: CircularPatternExactRequest['parameters'],
): boolean {
  const expectedBbox = circularPatternExpectedBbox(
    parameters.host,
    parameters.axisPoint,
    parameters.axisDirection,
    parameters.count,
    parameters.totalAngleDeg,
  );
  if (!expectedBbox || !(after.absoluteVolume > 0)) return false;
  const lowerVolume = before.absoluteVolume * (1 - 1e-6);
  const upperVolume = before.absoluteVolume * parameters.count * (1 + 1e-6);
  const bboxError = Math.max(...expectedBbox.map((value, index) =>
    Math.abs(after.bboxMm[index]! - value) / Math.max(1, Math.abs(value))));
  return after.solidCount === 1 && after.faceCount > 0 && after.edgeCount > 0
    && after.absoluteVolume >= lowerVolume && after.absoluteVolume <= upperVolume
    && bboxError <= 1e-6;
}

function loftInvariant(
  after: NativeMechanicalExactMeasurement,
  sections: LoftExactRequest['parameters']['sections'],
): boolean {
  const expectedBbox = loftAggregateBbox(sections);
  if (!expectedBbox || !(after.absoluteVolume > 1e-9)) return false;
  const bboxVolume = (expectedBbox[3] - expectedBbox[0])
    * (expectedBbox[4] - expectedBbox[1])
    * (expectedBbox[5] - expectedBbox[2]);
  if (!(bboxVolume > 0) || after.absoluteVolume > bboxVolume * (1 + 1e-6)) return false;
  const bboxError = Math.max(...expectedBbox.map((value, index) =>
    Math.abs(after.bboxMm[index]! - value) / Math.max(1, Math.abs(value))));
  return after.solidCount === 1 && after.faceCount > 0 && after.edgeCount > 0 && bboxError <= 1e-6;
}

function sweepInvariant(
  after: NativeMechanicalExactMeasurement,
  parameters: SweepExactRequest['parameters'],
): boolean {
  const [start, elbow, end] = parameters.path;
  const first = sweepSegment(start, elbow);
  const second = sweepSegment(elbow, end);
  if (!first || !second || first.axis === second.axis) return false;
  const expectedVolume = parameters.widthMm * parameters.heightMm * (first.length + second.length);
  if (!(expectedVolume > 0)) return false;
  const volumeError = Math.abs(after.absoluteVolume - expectedVolume) / expectedVolume;
  const halfDiagonal = Math.hypot(parameters.widthMm, parameters.heightMm) / 2;
  const pathMin = [0, 1, 2].map(axis => Math.min(...parameters.path.map(point => point[axis]!)));
  const pathMax = [0, 1, 2].map(axis => Math.max(...parameters.path.map(point => point[axis]!)));
  const tolerance = 1e-5;
  for (let axis = 0; axis < 3; axis += 1) {
    if (after.bboxMm[axis]! > pathMin[axis]! + tolerance
      || after.bboxMm[axis + 3]! < pathMax[axis]! - tolerance
      || after.bboxMm[axis]! < pathMin[axis]! - halfDiagonal - tolerance
      || after.bboxMm[axis + 3]! > pathMax[axis]! + halfDiagonal + tolerance) return false;
  }
  const firstSpan = after.bboxMm[first.axis + 3]! - after.bboxMm[first.axis]!;
  const secondSpan = after.bboxMm[second.axis + 3]! - after.bboxMm[second.axis]!;
  return after.solidCount === 1 && after.faceCount >= 6 && after.edgeCount >= 12
    && volumeError <= 1e-6
    && firstSpan >= first.length - tolerance
    && secondSpan >= second.length - tolerance;
}

function splitBodyInvariant(
  before: NativeMechanicalExactMeasurement,
  after: NativeMechanicalExactMeasurement,
  parameters: SplitBodyExactRequest['parameters'],
): boolean {
  const clip = splitBodyClip(parameters);
  if (!clip) return false;
  const axis = parameters.plane === 'YZ' ? 0 : parameters.plane === 'XZ' ? 1 : 2;
  const originalLength = before.bboxMm[axis + 3]! - before.bboxMm[axis]!;
  const keptLength = clip.expectedBbox[axis + 3]! - clip.expectedBbox[axis]!;
  const expectedVolume = before.absoluteVolume * keptLength / originalLength;
  if (!(originalLength > 0) || !(expectedVolume > 0) || !(expectedVolume < before.absoluteVolume)) return false;
  const volumeError = Math.abs(after.absoluteVolume - expectedVolume) / expectedVolume;
  const bboxError = Math.max(...clip.expectedBbox.map((value, index) =>
    Math.abs(after.bboxMm[index]! - value) / Math.max(1, Math.abs(value))));
  return after.solidCount === 1 && after.faceCount === 6 && after.edgeCount === 12
    && volumeError <= 1e-6 && bboxError <= 1e-6;
}

function deleteFaceInvariant(
  before: NativeMechanicalExactMeasurement,
  after: NativeMechanicalExactMeasurement,
  parameters: DeleteFaceExactRequest['parameters'],
): boolean {
  const rectangle = axisAlignedRectangle(parameters.host);
  if (!rectangle) return false;
  const fullVolume = rectangle.width * rectangle.height * parameters.host.depth;
  const removedVolume = Math.PI * parameters.hole.radiusMm ** 2 * parameters.hole.depthMm;
  const expectedBefore = fullVolume - removedVolume;
  const beforeError = Math.abs(before.absoluteVolume - expectedBefore) / expectedBefore;
  const afterError = Math.abs(after.absoluteVolume - fullVolume) / fullVolume;
  const expectedBbox = [
    rectangle.minX, rectangle.minY, 0,
    rectangle.maxX, rectangle.maxY, parameters.host.depth,
  ] as const;
  const bboxError = Math.max(...expectedBbox.map((value, index) =>
    Math.abs(after.bboxMm[index]! - value) / Math.max(1, Math.abs(value))));
  return before.solidCount === 1 && before.faceCount === 8
    && after.solidCount === 1 && after.faceCount === 6 && after.edgeCount === 12
    && beforeError <= 1e-6 && afterError <= 1e-6 && bboxError <= 1e-6;
}

function deleteFaceSignatureValid(inspection: OcctDetailedShapeInspection): boolean {
  if (inspection.surfaceTypes.status !== 'available') return false;
  const counts = inspection.surfaceTypes.counts;
  const adjacency = inspection.faceAdjacency;
  return counts.plane === 6 && Object.keys(counts).length === 1
    && (inspection.cylindricalRadii?.length ?? 0) === 0
    && adjacency.status === 'available'
    && adjacency.boundaryEdgeCount === 0
    && adjacency.nonManifoldEdgeCount === 0;
}

function bendInvariant(
  before: NativeMechanicalExactMeasurement,
  after: NativeMechanicalExactMeasurement,
  parameters: BendExactRequest['parameters'],
): boolean {
  const construction = bendConstruction(parameters);
  if (!construction) return false;
  const expectedVolume = parameters.host.widthMm * parameters.host.thicknessMm * parameters.host.lengthMm;
  const beforeVolumeError = Math.abs(before.absoluteVolume - expectedVolume) / expectedVolume;
  const afterVolumeError = Math.abs(after.absoluteVolume - expectedVolume) / expectedVolume;
  const bboxError = Math.max(...construction.expectedBbox.map((value, index) =>
    Math.abs(after.bboxMm[index]! - value) / Math.max(1, Math.abs(value))));
  return beforeVolumeError <= 1e-6 && afterVolumeError <= 1e-6 && bboxError <= 1e-6
    && after.solidCount === 1 && after.faceCount === 10 && after.edgeCount === 24;
}

function analyticSheetSignatureValid(
  inspection: OcctDetailedShapeInspection,
  host: ExactRectangularSheetHost,
  innerRadiusMm: number,
  developedLengthMm: number,
): boolean {
  if (inspection.surfaceTypes.status !== 'available') return false;
  const counts = inspection.surfaceTypes.counts;
  const radii = inspection.cylindricalRadii ?? [];
  const expectedSurfaceArea = 2 * (developedLengthMm * host.widthMm
    + host.widthMm * host.thicknessMm + developedLengthMm * host.thicknessMm);
  const areaError = Math.abs(inspection.surfaceArea - expectedSurfaceArea) / expectedSurfaceArea;
  return counts.plane === 8 && counts.cylinder === 2
    && Object.keys(counts).length === 2
    && radii.length === 2
    && Math.abs(radii[0]! - innerRadiusMm) <= 1e-7
    && Math.abs(radii[1]! - (innerRadiusMm + host.thicknessMm)) <= 1e-7
    && areaError <= 1e-6;
}

function flangeInvariant(
  before: NativeMechanicalExactMeasurement,
  after: NativeMechanicalExactMeasurement,
  parameters: FlangeExactRequest['parameters'],
): boolean {
  const construction = flangeConstruction(parameters);
  if (!construction) return false;
  const arcLength = parameters.angleDeg * Math.PI / 180
    * (parameters.innerRadiusMm + parameters.host.thicknessMm / 2);
  const developedLength = parameters.host.lengthMm + arcLength + parameters.straightLegLengthMm;
  const expectedBefore = parameters.host.widthMm * parameters.host.thicknessMm * parameters.host.lengthMm;
  const expectedAfter = parameters.host.widthMm * parameters.host.thicknessMm * developedLength;
  const beforeError = Math.abs(before.absoluteVolume - expectedBefore) / expectedBefore;
  const afterError = Math.abs(after.absoluteVolume - expectedAfter) / expectedAfter;
  const bboxError = Math.max(...construction.expectedBbox.map((value, index) =>
    Math.abs(after.bboxMm[index]! - value) / Math.max(1, Math.abs(value))));
  return beforeError <= 1e-6 && afterError <= 1e-6 && bboxError <= 1e-6
    && after.solidCount === 1 && after.faceCount === 10 && after.edgeCount === 24;
}

function roundtripEqual(left: NativeMechanicalExactMeasurement, right: NativeMechanicalExactMeasurement): boolean {
  const volumeError = Math.abs(left.absoluteVolume - right.absoluteVolume) / Math.max(left.absoluteVolume, 1e-9);
  const bboxError = Math.max(...left.bboxMm.map((value, index) => Math.abs(value - right.bboxMm[index]!)));
  return left.solidCount === right.solidCount && volumeError <= 1e-6 && bboxError <= 1e-5;
}

function hold(...codes: NativeMechanicalExactBlockerCode[]): NativeMechanicalExactFeatureResult {
  return { status: 'HOLD', blockerCodes: [...new Set(codes)], receipt: null, stepArtifact: null };
}

function prismFeature(host: ExactPrismHost): ExtrudeFeature {
  return { kind: 'extrude', loop: host.loop.map(point => ({ ...point })), depth: host.depth, direction: 'one_sided', mode: 'add' };
}

/**
 * Server-side bounded exact loop. It loads the trusted runtime internally and
 * never accepts a bridge, runtime identity, handler list, verifier list, or
 * fallback result from the caller.
 */
export async function executeNativeMechanicalExactFeature(input: unknown): Promise<NativeMechanicalExactFeatureResult> {
  const startedAt = Date.now();
  const overBudget = (): boolean => Date.now() - startedAt > MAX_ELAPSED_MS;
  const request = validateRequest(input);
  if (!request) return hold('INVALID_REQUEST');
  const requestSha256 = hashCanonical(request);
  const runtime = await loadNodeOcctCommercialRuntime();
  if (overBudget()) return hold('RESOURCE_LIMIT_EXCEEDED');
  if (!runtime.ok) return hold('RUNTIME_UNAVAILABLE');
  const decision = decideFeatureExecution({ featureId: request.featureId, intent: 'AUTHORITATIVE', runtime: runtime.capabilities });
  if (decision.status !== 'ALLOW_EXACT') return hold('REGISTRY_HOLD');

  const { bridge } = runtime;
  if (!bridge.inspectShapeDetailed || !bridge.exportSTEP || !bridge.importSTEP) return hold('HANDLER_UNAVAILABLE');
  const owned = new Map<string, OcctShape>();
  const own = (shape: OcctShape): OcctShape => { owned.set(shape.id, shape); return shape; };
  try {
    let baseMeasurement: NativeMechanicalExactMeasurement | null = null;
    let featureResult;
    if (request.featureId === 'cad.mechanical.loft') {
      if (!bridge.buildLoftSections) return hold('HANDLER_UNAVAILABLE');
      featureResult = await bridge.buildLoftSections(request.parameters.sections);
    } else if (request.featureId === 'cad.mechanical.sweep'
      || request.featureId === 'cad.mechanical.sweep-path') {
      if (!bridge.buildOrthogonalPolylineSweep) return hold('HANDLER_UNAVAILABLE');
      featureResult = await bridge.buildOrthogonalPolylineSweep({
        path: request.parameters.path,
        widthMm: request.parameters.widthMm,
        heightMm: request.parameters.heightMm,
      });
    } else {
    let baseResult;
    if (request.featureId === 'cad.mechanical.thread') {
      if (!bridge.buildCylinderAt) return hold('HANDLER_UNAVAILABLE');
      const p = request.parameters;
      baseResult = await bridge.buildCylinderAt(p.center, p.axis, p.nominalDiameter / 2, p.hostDepth);
    } else if (request.featureId === 'cad.mechanical.delete-face') {
      if (!bridge.buildCylinderAt || typeof bridge.boolean?.subtract !== 'function') return hold('HANDLER_UNAVAILABLE');
      const p = request.parameters;
      const hostResult = await bridge.buildFromExtrude(prismFeature(p.host));
      if (!hostResult.ok || !hostResult.shape) return hold('BASE_BUILD_FAILED');
      const hostShape = own(hostResult.shape);
      const cutterResult = await bridge.buildCylinderAt(
        [p.hole.center.x, p.hole.center.y, p.host.depth - p.hole.depthMm],
        [0, 0, 1],
        p.hole.radiusMm,
        p.hole.depthMm,
      );
      if (!cutterResult.ok || !cutterResult.shape) return hold('BASE_BUILD_FAILED');
      const cutterShape = own(cutterResult.shape);
      baseResult = await bridge.boolean.subtract(hostShape, cutterShape, {
        baseId: `${request.operationId}:host`,
        toolId: `${request.operationId}:blind-hole`,
        opId: `${request.operationId}:base-cut`,
      });
    } else if (request.featureId === 'cad.mechanical.bend') {
      if (!bridge.buildPrismAt) return hold('HANDLER_UNAVAILABLE');
      const construction = bendConstruction(request.parameters);
      if (!construction) return hold('INVALID_REQUEST');
      baseResult = await bridge.buildPrismAt(construction.flatLoop, 0, construction.widthMm);
    } else if (request.featureId === 'cad.mechanical.flange') {
      if (!bridge.buildPrismAt) return hold('HANDLER_UNAVAILABLE');
      const construction = flangeConstruction(request.parameters);
      if (!construction) return hold('INVALID_REQUEST');
      baseResult = await bridge.buildPrismAt(construction.flatLoop, 0, construction.widthMm);
    } else {
      baseResult = await bridge.buildFromExtrude(prismFeature(request.parameters.host));
    }
    if (!baseResult.ok || !baseResult.shape) return hold('BASE_BUILD_FAILED');
    const base = own(baseResult.shape);
    const before = measurement(await bridge.inspectShapeDetailed(base));
    if (!measurementValid(before)) return hold('BREP_INVALID');
    if (!measurementWithinBudget(before) || overBudget()) return hold('RESOURCE_LIMIT_EXCEEDED');
    baseMeasurement = before;
    if (request.featureId === 'cad.mechanical.variable-fillet') {
      if (!bridge.variableFillet) return hold('HANDLER_UNAVAILABLE');
      featureResult = await bridge.variableFillet(base, request.parameters.edgeRadii);
    } else if (request.featureId === 'cad.mechanical.draft') {
      if (!bridge.draft) return hold('HANDLER_UNAVAILABLE');
      const p = request.parameters;
      featureResult = await bridge.draft(base, { angleDeg: p.angleDeg, pullDir: [...p.pullDirection], neutralZ: p.neutralZ });
    } else if (request.featureId === 'cad.mechanical.thread') {
      if (!bridge.buildThreadHelixCutter) return hold('HANDLER_UNAVAILABLE');
      const p = request.parameters;
      const cutterResult = await bridge.buildThreadHelixCutter({
        center: { x: p.center[0], y: p.center[1] },
        z0: p.center[2],
        innerRadius: p.minorDiameter / 2,
        outerRadius: p.nominalDiameter / 2 + 0.01,
        pitch: p.pitch,
        lengthMm: p.threadLength,
        direction: p.direction,
        threadKind: 'external',
      });
      if (!cutterResult.ok || !cutterResult.shape) return hold('FEATURE_EXECUTION_FAILED');
      const cutter = own(cutterResult.shape);
      featureResult = await bridge.boolean.subtract(base, cutter, { baseId: request.operationId, toolId: `${request.operationId}:cutter`, opId: request.operationId });
    } else if (request.featureId === 'cad.mechanical.scale') {
      if (!bridge.uniformScale) return hold('HANDLER_UNAVAILABLE');
      featureResult = await bridge.uniformScale(base, request.parameters.factor);
    } else if (request.featureId === 'cad.mechanical.move-copy') {
      if (!bridge.translate) return hold('HANDLER_UNAVAILABLE');
      featureResult = await bridge.translate(base, request.parameters.translation);
    } else if (request.featureId === 'cad.mechanical.rib') {
      if (!bridge.buildPrismAt || typeof bridge.boolean?.union !== 'function') return hold('HANDLER_UNAVAILABLE');
      const p = request.parameters;
      const corners = ribCorners(p);
      if (!corners) return hold('INVALID_REQUEST');
      const ribResult = await bridge.buildPrismAt(corners, p.host.depth, p.height);
      if (!ribResult.ok || !ribResult.shape) return hold('FEATURE_EXECUTION_FAILED');
      const ribShape = own(ribResult.shape);
      featureResult = await bridge.boolean.union(base, ribShape, {
        baseId: request.operationId,
        toolId: `${request.operationId}:rib`,
        opId: request.operationId,
      });
    } else if (request.featureId === 'cad.mechanical.offset-face') {
      if (!bridge.listFaceRefs || !bridge.pushPullFace) return hold('HANDLER_UNAVAILABLE');
      const faceRefs = await bridge.listFaceRefs(base);
      if (!faceRefs.includes('f.cap.top')) return hold('FEATURE_EXECUTION_FAILED');
      const p = request.parameters;
      featureResult = await bridge.pushPullFace(base, p.faceId, p.distance);
    } else if (request.featureId === 'cad.mechanical.cut') {
      if (!bridge.buildPrismAt || typeof bridge.boolean?.subtract !== 'function') return hold('HANDLER_UNAVAILABLE');
      const p = request.parameters;
      const toolResult = await bridge.buildPrismAt(p.toolLoop, 0, p.host.depth);
      if (!toolResult.ok || !toolResult.shape) return hold('FEATURE_EXECUTION_FAILED');
      const tool = own(toolResult.shape);
      featureResult = await bridge.boolean.subtract(base, tool, {
        baseId: request.operationId,
        toolId: `${request.operationId}:tool`,
        opId: request.operationId,
      });
    } else if (request.featureId === 'cad.mechanical.linear-pattern') {
      if (!bridge.translate || typeof bridge.boolean?.union !== 'function') return hold('HANDLER_UNAVAILABLE');
      const p = request.parameters;
      let accumulator = base;
      for (let index = 1; index < p.count; index++) {
        const offset: readonly [number, number, number] = [
          p.direction[0] * p.spacing * index,
          p.direction[1] * p.spacing * index,
          0,
        ];
        const copyResult = await bridge.translate(base, offset);
        if (!copyResult.ok || !copyResult.shape) return hold('FEATURE_EXECUTION_FAILED');
        const copy = own(copyResult.shape);
        const copyMeasurement = measurement(await bridge.inspectShapeDetailed(copy));
        if (!measurementValid(copyMeasurement)) return hold('BREP_INVALID');
        if (!measurementWithinBudget(copyMeasurement)) return hold('RESOURCE_LIMIT_EXCEEDED');
        const unionResult = await bridge.boolean.union(accumulator, copy, {
          baseId: request.operationId,
          toolId: `${request.operationId}:copy:${index}`,
          opId: `${request.operationId}:union:${index}`,
        });
        if (!unionResult.ok || !unionResult.shape) return hold('FEATURE_EXECUTION_FAILED');
        accumulator = own(unionResult.shape);
        const stepMeasurement = measurement(await bridge.inspectShapeDetailed(accumulator));
        if (!measurementValid(stepMeasurement)) return hold('BREP_INVALID');
        if (!measurementWithinBudget(stepMeasurement)) return hold('RESOURCE_LIMIT_EXCEEDED');
        if (overBudget()) return hold('RESOURCE_LIMIT_EXCEEDED');
      }
      featureResult = { ok: true, shape: accumulator, warnings: [] };
    } else if (request.featureId === 'cad.mechanical.circular-pattern') {
      if (!bridge.rotate || typeof bridge.boolean?.union !== 'function') return hold('HANDLER_UNAVAILABLE');
      const p = request.parameters;
      let accumulator = base;
      let previousVolume = before.absoluteVolume;
      for (let index = 1; index < p.count; index++) {
        const angleDeg = p.totalAngleDeg * index / (p.count - 1);
        const copyResult = await bridge.rotate(base, p.axisPoint, p.axisDirection, angleDeg);
        if (!copyResult.ok || !copyResult.shape) return hold('FEATURE_EXECUTION_FAILED');
        const copy = own(copyResult.shape);
        const copyMeasurement = measurement(await bridge.inspectShapeDetailed(copy));
        if (!measurementValid(copyMeasurement)) return hold('BREP_INVALID');
        if (!measurementWithinBudget(copyMeasurement) || overBudget()) return hold('RESOURCE_LIMIT_EXCEEDED');
        const copyVolumeError = Math.abs(copyMeasurement.absoluteVolume - before.absoluteVolume)
          / Math.max(before.absoluteVolume, 1e-12);
        if (copyVolumeError > 1e-6) return hold('FEATURE_INVARIANT_MISMATCH');
        const unionResult = await bridge.boolean.union(accumulator, copy, {
          baseId: request.operationId,
          toolId: `${request.operationId}:copy:${index}`,
          opId: `${request.operationId}:union:${index}`,
        });
        if (!unionResult.ok || !unionResult.shape) return hold('FEATURE_EXECUTION_FAILED');
        accumulator = own(unionResult.shape);
        const stepMeasurement = measurement(await bridge.inspectShapeDetailed(accumulator));
        if (!measurementValid(stepMeasurement)) return hold('BREP_INVALID');
        if (!measurementWithinBudget(stepMeasurement) || overBudget()) return hold('RESOURCE_LIMIT_EXCEEDED');
        const tolerance = Math.max(1e-8, before.absoluteVolume * 1e-8);
        const overlapVolume = previousVolume + copyMeasurement.absoluteVolume - stepMeasurement.absoluteVolume;
        const upperVolume = before.absoluteVolume * (index + 1) * (1 + 1e-6);
        if (stepMeasurement.absoluteVolume <= previousVolume + tolerance
          || stepMeasurement.absoluteVolume > upperVolume
          || !(overlapVolume > tolerance)) return hold('FEATURE_INVARIANT_MISMATCH');
        previousVolume = stepMeasurement.absoluteVolume;
      }
      featureResult = { ok: true, shape: accumulator, warnings: [] };
    } else if (request.featureId === 'cad.mechanical.split-body') {
      if (!bridge.buildPrismAt || typeof bridge.boolean?.intersect !== 'function') return hold('HANDLER_UNAVAILABLE');
      const clip = splitBodyClip(request.parameters);
      if (!clip) return hold('INVALID_REQUEST');
      const clipResult = await bridge.buildPrismAt(clip.loop, clip.z0, clip.height);
      if (!clipResult.ok || !clipResult.shape) return hold('FEATURE_EXECUTION_FAILED');
      const clipShape = own(clipResult.shape);
      featureResult = await bridge.boolean.intersect(base, clipShape, {
        baseId: request.operationId,
        toolId: `${request.operationId}:retained-half-space`,
        opId: request.operationId,
      });
    } else if (request.featureId === 'cad.mechanical.delete-face') {
      if (!bridge.deleteBlindHoleFacesAndCap) return hold('HANDLER_UNAVAILABLE');
      const p = request.parameters;
      featureResult = await bridge.deleteBlindHoleFacesAndCap(base, {
        hostLoop: p.host.loop,
        hostDepthMm: p.host.depth,
        holeCenter: [p.hole.center.x, p.hole.center.y],
        holeRadiusMm: p.hole.radiusMm,
        holeDepthMm: p.hole.depthMm,
      });
    } else if (request.featureId === 'cad.mechanical.bend') {
      if (!bridge.buildSingleRectangularSheetBend) return hold('HANDLER_UNAVAILABLE');
      const construction = bendConstruction(request.parameters);
      if (!construction) return hold('INVALID_REQUEST');
      featureResult = await bridge.buildSingleRectangularSheetBend(construction);
    } else if (request.featureId === 'cad.mechanical.flange') {
      if (!bridge.buildSingleRectangularSheetBend) return hold('HANDLER_UNAVAILABLE');
      const construction = flangeConstruction(request.parameters);
      if (!construction) return hold('INVALID_REQUEST');
      featureResult = await bridge.buildSingleRectangularSheetBend(construction);
    } else {
      if (!bridge.mirror) return hold('HANDLER_UNAVAILABLE');
      featureResult = await bridge.mirror(base, request.parameters.planeOrigin, request.parameters.planeNormal);
    }
    }
    if (!featureResult.ok || !featureResult.shape) return hold('FEATURE_EXECUTION_FAILED');
    const resultShape = own(featureResult.shape);
    const resultInspection = await bridge.inspectShapeDetailed(resultShape);
    const resultMeasurement = measurement(resultInspection);
    if (!measurementValid(resultMeasurement)) return hold('BREP_INVALID');
    if (!measurementWithinBudget(resultMeasurement) || overBudget()) return hold('RESOURCE_LIMIT_EXCEEDED');
    if (request.featureId === 'cad.mechanical.loft') {
      if (!loftInvariant(resultMeasurement, request.parameters.sections)) return hold('FEATURE_INVARIANT_MISMATCH');
    } else if (request.featureId === 'cad.mechanical.sweep'
      || request.featureId === 'cad.mechanical.sweep-path') {
      if (!sweepInvariant(resultMeasurement, request.parameters)) return hold('FEATURE_INVARIANT_MISMATCH');
    } else {
      const before = baseMeasurement;
      if (!before) return hold('BREP_INVALID');
      const relativeChange = Math.abs(before.absoluteVolume - resultMeasurement.absoluteVolume) / Math.max(before.absoluteVolume, 1e-9);
      const bboxChange = Math.max(...before.bboxMm.map((value, index) => Math.abs(value - resultMeasurement.bboxMm[index]!)));
      if (relativeChange < 1e-8 && bboxChange < 1e-8) return hold('FEATURE_NO_GEOMETRIC_CHANGE');
      if (request.featureId === 'cad.mechanical.scale'
        && !scaleInvariant(before, resultMeasurement, request.parameters.factor)) return hold('FEATURE_INVARIANT_MISMATCH');
      if (request.featureId === 'cad.mechanical.move-copy'
        && !translationInvariant(before, resultMeasurement, request.parameters.translation)) return hold('FEATURE_INVARIANT_MISMATCH');
      if (request.featureId === 'cad.mechanical.mirror'
        && !mirrorInvariant(before, resultMeasurement, request.parameters.planeOrigin, request.parameters.planeNormal)) return hold('FEATURE_INVARIANT_MISMATCH');
      if (request.featureId === 'cad.mechanical.rib'
        && !ribInvariant(before, resultMeasurement, request.parameters)) return hold('FEATURE_INVARIANT_MISMATCH');
      if (request.featureId === 'cad.mechanical.offset-face'
        && !offsetFaceInvariant(before, resultMeasurement, request.parameters)) return hold('FEATURE_INVARIANT_MISMATCH');
      if (request.featureId === 'cad.mechanical.cut'
        && !cutInvariant(before, resultMeasurement, request.parameters)) return hold('FEATURE_INVARIANT_MISMATCH');
      if (request.featureId === 'cad.mechanical.linear-pattern'
        && !linearPatternInvariant(before, resultMeasurement, request.parameters)) return hold('FEATURE_INVARIANT_MISMATCH');
      if (request.featureId === 'cad.mechanical.circular-pattern'
        && !circularPatternInvariant(before, resultMeasurement, request.parameters)) return hold('FEATURE_INVARIANT_MISMATCH');
      if (request.featureId === 'cad.mechanical.split-body'
        && !splitBodyInvariant(before, resultMeasurement, request.parameters)) return hold('FEATURE_INVARIANT_MISMATCH');
      if (request.featureId === 'cad.mechanical.delete-face'
        && (!deleteFaceInvariant(before, resultMeasurement, request.parameters)
          || !deleteFaceSignatureValid(resultInspection))) return hold('FEATURE_INVARIANT_MISMATCH');
      if (request.featureId === 'cad.mechanical.bend'
        && (!bendInvariant(before, resultMeasurement, request.parameters)
          || !analyticSheetSignatureValid(resultInspection, request.parameters.host, request.parameters.innerRadiusMm, request.parameters.host.lengthMm))) return hold('FEATURE_INVARIANT_MISMATCH');
      if (request.featureId === 'cad.mechanical.flange') {
        const developedLength = request.parameters.host.lengthMm + request.parameters.straightLegLengthMm
          + request.parameters.angleDeg * Math.PI / 180
          * (request.parameters.innerRadiusMm + request.parameters.host.thicknessMm / 2);
        if (!flangeInvariant(before, resultMeasurement, request.parameters)
          || !analyticSheetSignatureValid(resultInspection, request.parameters.host, request.parameters.innerRadiusMm, developedLength)) return hold('FEATURE_INVARIANT_MISMATCH');
      }
    }

    let step: string;
    try { step = await bridge.exportSTEP(resultShape); } catch { return hold('STEP_EXPORT_FAILED'); }
    if (!step.startsWith('ISO-10303-21;') || !step.includes('ADVANCED_BREP_SHAPE_REPRESENTATION')) return hold('STEP_EXPORT_FAILED');
    if (new TextEncoder().encode(step).byteLength > MAX_STEP_BYTES || overBudget()) return hold('RESOURCE_LIMIT_EXCEEDED');
    const imported = await bridge.importSTEP(step);
    if (!imported.ok || !imported.shape) return hold('STEP_REIMPORT_FAILED');
    const importedShape = own(imported.shape);
    const roundtripInspection = await bridge.inspectShapeDetailed(importedShape);
    const roundtripMeasurement = measurement(roundtripInspection);
    if (!measurementValid(roundtripMeasurement) || !roundtripEqual(resultMeasurement, roundtripMeasurement)) return hold('ROUNDTRIP_MISMATCH');
    if (request.featureId === 'cad.mechanical.bend'
      && (!baseMeasurement || !bendInvariant(baseMeasurement, roundtripMeasurement, request.parameters)
        || !analyticSheetSignatureValid(roundtripInspection, request.parameters.host, request.parameters.innerRadiusMm, request.parameters.host.lengthMm))) return hold('ROUNDTRIP_MISMATCH');
    if (request.featureId === 'cad.mechanical.delete-face'
      && (!baseMeasurement || !deleteFaceInvariant(baseMeasurement, roundtripMeasurement, request.parameters)
        || !deleteFaceSignatureValid(roundtripInspection))) return hold('ROUNDTRIP_MISMATCH');
    if (request.featureId === 'cad.mechanical.flange') {
      const developedLength = request.parameters.host.lengthMm + request.parameters.straightLegLengthMm
        + request.parameters.angleDeg * Math.PI / 180
        * (request.parameters.innerRadiusMm + request.parameters.host.thicknessMm / 2);
      if (!baseMeasurement || !flangeInvariant(baseMeasurement, roundtripMeasurement, request.parameters)
        || !analyticSheetSignatureValid(roundtripInspection, request.parameters.host, request.parameters.innerRadiusMm, developedLength)) return hold('ROUNDTRIP_MISMATCH');
    }
    if (!measurementWithinBudget(roundtripMeasurement) || overBudget()) return hold('RESOURCE_LIMIT_EXCEEDED');

    const core = {
      schema: NATIVE_MECHANICAL_EXACT_RECEIPT_SCHEMA,
      status: 'EXACT_PASS' as const,
      featureId: request.featureId,
      operationId: request.operationId,
      projectId: request.projectId,
      documentId: request.documentId,
      baseRevisionId: request.baseRevisionId,
      baseSequence: request.baseSequence,
      baseContentSha256: request.baseContentSha256,
      registryHash: FEATURE_REGISTRY_HASH,
      runtimeIdentitySha256: runtime.identity.runtimeIdentitySha256,
      requestSha256,
      resultMeasurementSha256: hashCanonical(resultMeasurement),
      roundtripMeasurementSha256: hashCanonical(roundtripMeasurement),
      stepSha256: hashString(step),
      blockerCodes: [] as const,
      authoritativeCommit: false as const,
      commercialReleaseReady: false as const,
    };
    const receipt: NativeMechanicalExactReceipt = Object.freeze({ ...core, receiptSha256: hashCanonical(core) });
    return { status: 'EXACT_PASS', blockerCodes: [], receipt, stepArtifact: step };
  } catch {
    return hold('FEATURE_EXECUTION_FAILED');
  } finally {
    for (const shape of owned.values()) {
      try { bridge.release(shape); } catch { /* best-effort native cleanup */ }
    }
  }
}
