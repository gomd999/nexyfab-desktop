import { Sha256 } from '@aws-crypto/sha256-js';
import {
  canonicalCadConsumerDraftJson,
  type CanonicalCadJsonValue,
} from './canonicalCadV2ConsumerDraft';

/**
 * Structural-only gate for the first canonical sketch slice.
 *
 * This module deliberately does not invoke a solver, OCCT, a feature registry,
 * or a geometry kernel. A PASS only means that a bounded, deterministic,
 * single convex line-loop is safe to hand to a later solver/extrude stage.
 */
export const CANONICAL_SKETCH_PREFLIGHT_SCHEMA =
  'nexyfab.precision-cad.canonical-sketch-preflight.v1' as const;
export const CANONICAL_SKETCH_PREFLIGHT_HASH_DOMAIN =
  'nexyfab.precision-cad.canonical-sketch-preflight.sha256.v1' as const;

export type CanonicalSketchPlane = 'XY' | 'XZ' | 'YZ';

export interface CanonicalSketchRevision {
  revisionId: string;
  sequence: number;
  contentSha256: string;
}

export interface CanonicalSketchPoint {
  id: string;
  x: number;
  y: number;
}

export interface CanonicalSketchLineSegment {
  id: string;
  startPointId: string;
  endPointId: string;
}

export interface CanonicalSketchPreflightRequest {
  schema: typeof CANONICAL_SKETCH_PREFLIGHT_SCHEMA;
  projectId: string;
  documentId: string;
  currentRevision: CanonicalSketchRevision;
  sketchId: string;
  plane: CanonicalSketchPlane;
  points: ReadonlyArray<CanonicalSketchPoint>;
  lineSegments: ReadonlyArray<CanonicalSketchLineSegment>;
}

export interface CanonicalSketchLoop {
  pointIds: ReadonlyArray<string>;
  lineIds: ReadonlyArray<string>;
  signedDoubleArea: number;
}

export interface CanonicalSketchPreflightPass {
  schema: typeof CANONICAL_SKETCH_PREFLIGHT_SCHEMA;
  status: 'PRECHECK_PASS';
  verification: 'STRUCTURAL_ONLY';
  release: 'HOLD';
  projectId: string;
  documentId: string;
  currentRevision: CanonicalSketchRevision;
  sketchId: string;
  plane: CanonicalSketchPlane;
  points: ReadonlyArray<CanonicalSketchPoint>;
  lineSegments: ReadonlyArray<CanonicalSketchLineSegment>;
  loop: CanonicalSketchLoop;
  canonicalSketchSha256: string;
}

export interface CanonicalSketchPreflightIssue {
  code: string;
  path?: string;
}

export interface CanonicalSketchPreflightHold {
  schema: typeof CANONICAL_SKETCH_PREFLIGHT_SCHEMA;
  status: 'HOLD';
  verification: 'STRUCTURAL_ONLY';
  release: 'HOLD';
  issues: ReadonlyArray<CanonicalSketchPreflightIssue>;
}

export type CanonicalSketchPreflightResult =
  | CanonicalSketchPreflightPass
  | CanonicalSketchPreflightHold;

const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PLANES: readonly CanonicalSketchPlane[] = ['XY', 'XZ', 'YZ'];
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_DEPTH = 10;
const MAX_NODES = 4096;
const MAX_STRING_LENGTH = 512;
const MAX_POINTS = 128;
const MAX_LINES = 128;
const MAX_COORDINATE = 1_000_000;
const MAX_SEQUENCE = 2_000_000_000;
const SNAPSHOT_ISSUE_CODES = new Set([
  'SNAPSHOT_LIMIT',
  'SNAPSHOT_STRING_LIMIT',
  'SNAPSHOT_NUMBER',
  'SNAPSHOT_CYCLE_OR_TYPE',
  'SNAPSHOT_ARRAY_KEY',
  'SNAPSHOT_ARRAY_LIMIT',
  'SNAPSHOT_ACCESSOR',
  'SNAPSHOT_PROTOTYPE',
  'SNAPSHOT_OBJECT_KEY',
  'SNAPSHOT_PROXY',
]);

const REQUEST_KEYS = [
  'schema', 'projectId', 'documentId', 'currentRevision', 'sketchId', 'plane', 'points', 'lineSegments',
] as const;
const REVISION_KEYS = ['revisionId', 'sequence', 'contentSha256'] as const;
const POINT_KEYS = ['id', 'x', 'y'] as const;
const LINE_KEYS = ['id', 'startPointId', 'endPointId'] as const;
const PASS_KEYS = [
  'schema', 'status', 'verification', 'release', 'projectId', 'documentId', 'currentRevision',
  'sketchId', 'plane', 'points', 'lineSegments', 'loop', 'canonicalSketchSha256',
] as const;
const LOOP_KEYS = ['pointIds', 'lineIds', 'signedDoubleArea'] as const;

type PlainRecord = Record<string, unknown>;

function isPlainRecord(value: unknown): value is PlainRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function hasExactKeys(value: PlainRecord, expected: readonly string[]): boolean {
  try {
    const keys = Reflect.ownKeys(value);
    if (keys.some(key => typeof key !== 'string')) return false;
    if (keys.some(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return !descriptor?.enumerable || !('value' in descriptor);
    })) return false;
    const actual = (keys as string[]).sort();
    const wanted = [...expected].sort();
    return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
  } catch {
    return false;
  }
}

/** Clone only enumerable data descriptors; getters, symbols, cycles and
 * exotic prototypes never reach validation or hashing. */
function boundedSnapshot(
  value: unknown,
  seen = new Set<object>(),
  budget = { nodes: 0 },
  depth = 0,
): unknown {
  if (depth > MAX_DEPTH || budget.nodes++ >= MAX_NODES) throw new Error('SNAPSHOT_LIMIT');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.length > MAX_STRING_LENGTH) throw new Error('SNAPSHOT_STRING_LIMIT');
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('SNAPSHOT_NUMBER');
    return value;
  }
  if (typeof value !== 'object' || seen.has(value)) throw new Error('SNAPSHOT_CYCLE_OR_TYPE');
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const keys = Reflect.ownKeys(value);
      if (keys.some(key => key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key)))) {
        throw new Error('SNAPSHOT_ARRAY_KEY');
      }
      if (value.length > MAX_NODES) throw new Error('SNAPSHOT_ARRAY_LIMIT');
      const out: unknown[] = [];
      for (let index = 0; index < value.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor?.enumerable || !('value' in descriptor)) throw new Error('SNAPSHOT_ACCESSOR');
        out.push(boundedSnapshot(descriptor.value, seen, budget, depth + 1));
      }
      return out;
    }
    if (!isPlainRecord(value)) throw new Error('SNAPSHOT_PROTOTYPE');
    const keys = Reflect.ownKeys(value);
    if (keys.length > MAX_NODES || keys.some(key => typeof key !== 'string' || FORBIDDEN_KEYS.has(key))) {
      throw new Error('SNAPSHOT_OBJECT_KEY');
    }
    const out: PlainRecord = {};
    for (const key of keys as string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !('value' in descriptor)) throw new Error('SNAPSHOT_ACCESSOR');
      out[key] = boundedSnapshot(descriptor.value, seen, budget, depth + 1);
    }
    return out;
  } catch (error) {
    throw error;
  }
}

function rejectProxy(value: unknown): void {
  // Node 22 and current supported browsers reject Proxy values through
  // structuredClone. The descriptor walk above remains the primary safety
  // barrier; this extra check closes transparent proxy test doubles when the
  // host provides structuredClone. It is deliberately skipped if unavailable.
  const clone = (globalThis as { structuredClone?: (input: unknown) => unknown }).structuredClone;
  if (typeof clone !== 'function') return;
  try {
    clone(value);
  } catch {
    throw new Error('SNAPSHOT_PROXY');
  }
}

function issue(code: string, path?: string): CanonicalSketchPreflightIssue {
  return path ? { code, path } : { code };
}

function finiteCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_COORDINATE;
}

function validateId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_ID.test(value);
}

function cross(a: CanonicalSketchPoint, b: CanonicalSketchPoint, c: CanonicalSketchPoint): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function orientation(a: CanonicalSketchPoint, b: CanonicalSketchPoint, c: CanonicalSketchPoint): number {
  const value = cross(a, b, c);
  return value === 0 ? 0 : value > 0 ? 1 : -1;
}

function onSegment(a: CanonicalSketchPoint, b: CanonicalSketchPoint, c: CanonicalSketchPoint): boolean {
  return Math.min(a.x, b.x) <= c.x && c.x <= Math.max(a.x, b.x)
    && Math.min(a.y, b.y) <= c.y && c.y <= Math.max(a.y, b.y);
}

function segmentsIntersect(
  a: CanonicalSketchPoint,
  b: CanonicalSketchPoint,
  c: CanonicalSketchPoint,
  d: CanonicalSketchPoint,
): boolean {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(a, b, c)) return true;
  if (o2 === 0 && onSegment(a, b, d)) return true;
  if (o3 === 0 && onSegment(c, d, a)) return true;
  if (o4 === 0 && onSegment(c, d, b)) return true;
  return false;
}

function lexicographicallyLess(a: readonly string[], b: readonly string[]): boolean {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i]! < b[i]!;
  }
  return a.length < b.length;
}

function canonicalLoop(
  points: ReadonlyArray<CanonicalSketchPoint>,
  lines: ReadonlyArray<CanonicalSketchLineSegment>,
): { pointIds: string[]; lineIds: string[] } | null {
  const pointById = new Map(points.map(point => [point.id, point]));
  const lineByPair = new Map<string, CanonicalSketchLineSegment>();
  const neighbours = new Map<string, string[]>();
  for (const point of points) neighbours.set(point.id, []);
  for (const line of lines) {
    const key = [line.startPointId, line.endPointId].sort().join('\u0000');
    lineByPair.set(key, line);
    neighbours.get(line.startPointId)!.push(line.endPointId);
    neighbours.get(line.endPointId)!.push(line.startPointId);
  }
  for (const ids of neighbours.values()) ids.sort();
  const start = [...neighbours.keys()].sort()[0];
  if (!start) return null;
  const firstNeighbours = neighbours.get(start)!;
  if (firstNeighbours.length !== 2) return null;

  const candidates: string[][] = [];
  for (const first of firstNeighbours) {
    const path = [start, first];
    let previous = start;
    let current = first;
    while (true) {
      const nexts = (neighbours.get(current) ?? []).filter(id => id !== previous);
      if (nexts.length !== 1) return null;
      const next = nexts[0]!;
      if (next === start) break;
      if (path.includes(next) || path.length > points.length) return null;
      path.push(next);
      previous = current;
      current = next;
    }
    if (path.length !== points.length) return null;
    candidates.push(path);
  }
  const pointIds = lexicographicallyLess(candidates[0]!, candidates[1]!) ? candidates[0]! : candidates[1]!;
  const lineIds: string[] = [];
  for (let index = 0; index < pointIds.length; index++) {
    const a = pointIds[index]!;
    const b = pointIds[(index + 1) % pointIds.length]!;
    const line = lineByPair.get([a, b].sort().join('\u0000'));
    if (!line) return null;
    lineIds.push(line.id);
  }
  return { pointIds, lineIds };
}

function canonicalPayload(value: CanonicalSketchPreflightPass | CanonicalSketchPreflightRequest): CanonicalCadJsonValue {
  return {
    schema: CANONICAL_SKETCH_PREFLIGHT_SCHEMA,
    projectId: value.projectId,
    documentId: value.documentId,
    currentRevision: value.currentRevision,
    sketchId: value.sketchId,
    plane: value.plane,
    points: value.points,
    lineSegments: value.lineSegments,
    loop: 'loop' in value ? value.loop : null,
  } as unknown as CanonicalCadJsonValue;
}

function hashPayload(payload: CanonicalCadJsonValue): string {
  const hash = new Sha256();
  hash.update(`${CANONICAL_SKETCH_PREFLIGHT_HASH_DOMAIN}\n${canonicalCadConsumerDraftJson(payload)}`);
  return [...hash.digestSync()].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function hold(issues: CanonicalSketchPreflightIssue[]): CanonicalSketchPreflightHold {
  return {
    schema: CANONICAL_SKETCH_PREFLIGHT_SCHEMA,
    status: 'HOLD',
    verification: 'STRUCTURAL_ONLY',
    release: 'HOLD',
    issues: issues.slice(0, 32),
  };
}

function validateRequest(snapshot: unknown): CanonicalSketchPreflightPass | CanonicalSketchPreflightIssue[] {
  if (!isPlainRecord(snapshot) || !hasExactKeys(snapshot, REQUEST_KEYS)) return [issue('REQUEST_KEYS_INVALID')];
  if (snapshot.schema !== CANONICAL_SKETCH_PREFLIGHT_SCHEMA) return [issue('SCHEMA_INVALID', 'schema')];
  if (!validateId(snapshot.projectId)) return [issue('ID_INVALID', 'projectId')];
  if (!validateId(snapshot.documentId)) return [issue('ID_INVALID', 'documentId')];
  if (!validateId(snapshot.sketchId)) return [issue('ID_INVALID', 'sketchId')];
  if (!PLANES.includes(snapshot.plane as CanonicalSketchPlane)) return [issue('PLANE_INVALID', 'plane')];

  const revision = snapshot.currentRevision;
  if (!isPlainRecord(revision) || !hasExactKeys(revision, REVISION_KEYS)) return [issue('REVISION_KEYS_INVALID', 'currentRevision')];
  if (!validateId(revision.revisionId)) return [issue('ID_INVALID', 'currentRevision.revisionId')];
  if (typeof revision.sequence !== 'number' || !Number.isSafeInteger(revision.sequence) || revision.sequence < 0 || revision.sequence > MAX_SEQUENCE) {
    return [issue('REVISION_SEQUENCE_INVALID', 'currentRevision.sequence')];
  }
  if (typeof revision.contentSha256 !== 'string' || !SHA256.test(revision.contentSha256)) return [issue('HASH_INVALID', 'currentRevision.contentSha256')];
  const revisionId = revision.revisionId as string;
  const sequence = revision.sequence as number;
  const contentSha256 = revision.contentSha256 as string;

  if (!Array.isArray(snapshot.points) || snapshot.points.length < 3 || snapshot.points.length > MAX_POINTS) return [issue('POINTS_BOUNDS', 'points')];
  if (!Array.isArray(snapshot.lineSegments) || snapshot.lineSegments.length < 3 || snapshot.lineSegments.length > MAX_LINES) return [issue('LINES_BOUNDS', 'lineSegments')];

  const points: CanonicalSketchPoint[] = [];
  const pointIds = new Set<string>();
  for (let index = 0; index < snapshot.points.length; index++) {
    const point = snapshot.points[index];
    if (!isPlainRecord(point) || !hasExactKeys(point, POINT_KEYS)) return [issue('POINT_KEYS_INVALID', `points[${index}]`)];
    if (!validateId(point.id)) return [issue('ID_INVALID', `points[${index}].id`)];
    if (pointIds.has(point.id)) return [issue('ID_DUPLICATE', `points[${index}].id`)];
    if (!finiteCoordinate(point.x) || !finiteCoordinate(point.y)) return [issue('COORDINATE_INVALID', `points[${index}]`)];
    pointIds.add(point.id);
    points.push({ id: point.id, x: point.x, y: point.y });
  }

  const lines: CanonicalSketchLineSegment[] = [];
  const lineIds = new Set<string>();
  const undirectedEdges = new Set<string>();
  const degree = new Map<string, number>(points.map(point => [point.id, 0]));
  for (let index = 0; index < snapshot.lineSegments.length; index++) {
    const line = snapshot.lineSegments[index];
    if (!isPlainRecord(line) || !hasExactKeys(line, LINE_KEYS)) return [issue('LINE_KEYS_INVALID', `lineSegments[${index}]`)];
    if (!validateId(line.id)) return [issue('ID_INVALID', `lineSegments[${index}].id`)];
    if (lineIds.has(line.id)) return [issue('ID_DUPLICATE', `lineSegments[${index}].id`)];
    if (typeof line.startPointId !== 'string' || typeof line.endPointId !== 'string'
      || !pointIds.has(line.startPointId) || !pointIds.has(line.endPointId)) return [issue('REFERENCE_INVALID', `lineSegments[${index}]`)];
    if (line.startPointId === line.endPointId) return [issue('ZERO_LENGTH_SEGMENT', `lineSegments[${index}]`)];
    const edgeKey = [line.startPointId, line.endPointId].sort().join('\u0000');
    if (undirectedEdges.has(edgeKey)) return [issue('SEGMENT_DUPLICATE', `lineSegments[${index}]`)];
    lineIds.add(line.id);
    undirectedEdges.add(edgeKey);
    degree.set(line.startPointId, degree.get(line.startPointId)! + 1);
    degree.set(line.endPointId, degree.get(line.endPointId)! + 1);
    lines.push({ id: line.id, startPointId: line.startPointId, endPointId: line.endPointId });
  }
  if ([...degree.values()].some(value => value !== 2)) return [issue('LOOP_DEGREE_INVALID')];

  const loop = canonicalLoop(points, lines);
  if (!loop) return [issue('LOOP_NOT_SINGLE_CONNECTED_CYCLE')];
  const pointById = new Map(points.map(point => [point.id, point]));
  const orderedPoints = loop.pointIds.map(id => pointById.get(id)!);
  let signedDoubleArea = 0;
  for (let index = 0; index < orderedPoints.length; index++) {
    const a = orderedPoints[index]!;
    const b = orderedPoints[(index + 1) % orderedPoints.length]!;
    signedDoubleArea += a.x * b.y - b.x * a.y;
  }
  if (!Number.isFinite(signedDoubleArea) || signedDoubleArea === 0) return [issue('AREA_INVALID')];
  const firstSign = Math.sign(cross(orderedPoints[orderedPoints.length - 1]!, orderedPoints[0]!, orderedPoints[1]!));
  if (firstSign === 0) return [issue('CONVEXITY_INVALID')];
  for (let index = 0; index < orderedPoints.length; index++) {
    const turn = cross(
      orderedPoints[index]!,
      orderedPoints[(index + 1) % orderedPoints.length]!,
      orderedPoints[(index + 2) % orderedPoints.length]!,
    );
    if (Math.sign(turn) !== firstSign) return [issue('CONVEXITY_INVALID')];
  }
  for (let i = 0; i < orderedPoints.length; i++) {
    const a = orderedPoints[i]!;
    const b = orderedPoints[(i + 1) % orderedPoints.length]!;
    for (let j = i + 1; j < orderedPoints.length; j++) {
      if (j === i + 1 || (i === 0 && j === orderedPoints.length - 1)) continue;
      const c = orderedPoints[j]!;
      const d = orderedPoints[(j + 1) % orderedPoints.length]!;
      if (segmentsIntersect(a, b, c, d)) return [issue('SELF_INTERSECTION')];
    }
  }

  points.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  lines.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const canonical: CanonicalSketchPreflightPass = {
    schema: CANONICAL_SKETCH_PREFLIGHT_SCHEMA,
    status: 'PRECHECK_PASS',
    verification: 'STRUCTURAL_ONLY',
    release: 'HOLD',
    projectId: snapshot.projectId,
    documentId: snapshot.documentId,
    currentRevision: { revisionId, sequence, contentSha256 },
    sketchId: snapshot.sketchId,
    plane: snapshot.plane as CanonicalSketchPlane,
    points,
    lineSegments: lines,
    loop: { pointIds: loop.pointIds, lineIds: loop.lineIds, signedDoubleArea },
    canonicalSketchSha256: '',
  };
  canonical.canonicalSketchSha256 = hashPayload(canonicalPayload(canonical));
  return canonical;
}

export function preflightCanonicalSketch(value: unknown): CanonicalSketchPreflightResult {
  try {
    rejectProxy(value);
    const snapshot = boundedSnapshot(value);
    const result = validateRequest(snapshot);
    return Array.isArray(result) ? hold(result) : result;
  } catch (error) {
    const code = error instanceof Error && SNAPSHOT_ISSUE_CODES.has(error.message)
      ? error.message
      : 'PREFLIGHT_INVALID';
    return hold([issue(code)]);
  }
}

/** Verify an already-issued PASS after storage or transport. */
export function verifyCanonicalSketchPreflight(value: unknown): boolean {
  try {
    rejectProxy(value);
    const snapshot = boundedSnapshot(value);
    if (!isPlainRecord(snapshot) || !hasExactKeys(snapshot, PASS_KEYS)) return false;
    if (snapshot.schema !== CANONICAL_SKETCH_PREFLIGHT_SCHEMA || snapshot.status !== 'PRECHECK_PASS'
      || snapshot.verification !== 'STRUCTURAL_ONLY' || snapshot.release !== 'HOLD') return false;
    const loop = snapshot.loop;
    if (!isPlainRecord(loop) || !hasExactKeys(loop, LOOP_KEYS)) return false;
    if (typeof snapshot.canonicalSketchSha256 !== 'string' || !SHA256.test(snapshot.canonicalSketchSha256)) return false;
    const recomputed = validateRequest({
      schema: snapshot.schema,
      projectId: snapshot.projectId,
      documentId: snapshot.documentId,
      currentRevision: snapshot.currentRevision,
      sketchId: snapshot.sketchId,
      plane: snapshot.plane,
      points: snapshot.points,
      lineSegments: snapshot.lineSegments,
    });
    if (Array.isArray(recomputed)) return false;
    return canonicalCadConsumerDraftJson(snapshot as unknown as CanonicalCadJsonValue)
      === canonicalCadConsumerDraftJson(recomputed as unknown as CanonicalCadJsonValue);
  } catch {
    return false;
  }
}
