import { Sha256 } from '@aws-crypto/sha256-js';
import {
  canonicalCadConsumerDraftJson,
  type CanonicalCadJsonValue,
} from './canonicalCadV2ConsumerDraft';
import {
  preflightCanonicalSketch,
  verifyCanonicalSketchPreflight,
  type CanonicalSketchPoint,
  type CanonicalSketchPreflightPass,
} from './canonicalSketchPreflight';
import {
  solveConstraints,
  type SolverResult,
} from '../../app/[lang]/shape-generator/sketch/constraintSolver';
import type {
  SketchConstraint,
  SketchSegment,
} from '../../app/[lang]/shape-generator/sketch/types';

/**
 * Bounded numeric sketch solve after the canonical structural preflight.
 *
 * This deliberately remains a HOLD receipt.  The LM implementation is useful
 * for a deterministic preview, but it is not a native/exact/kernel proof.
 */
export const CANONICAL_SKETCH_CONSTRAINT_SOLVE_SCHEMA =
  'nexyfab.precision-cad.canonical-sketch-constraint-solve.v1' as const;
export const CANONICAL_SKETCH_CONSTRAINT_SOLVER_ID =
  'constraintSolver.lm.v1' as const;

export type CanonicalSketchConstraintType =
  | 'fixed'
  | 'horizontal'
  | 'vertical'
  | 'coincident';

export interface CanonicalSketchConstraint {
  id: string;
  type: CanonicalSketchConstraintType;
  entityIds: ReadonlyArray<string>;
}

export interface CanonicalSketchConstraintSolveRequest {
  schema: typeof CANONICAL_SKETCH_CONSTRAINT_SOLVE_SCHEMA;
  preflight: CanonicalSketchPreflightPass;
  constraints: ReadonlyArray<CanonicalSketchConstraint>;
}

export interface CanonicalSketchConstraintSolveIssue {
  code: string;
  path?: string;
}

export interface CanonicalSketchConstraintSolveHold {
  schema: typeof CANONICAL_SKETCH_CONSTRAINT_SOLVE_SCHEMA;
  status: 'HOLD';
  verification: 'NUMERIC_ONLY';
  release: 'HOLD';
  issues: ReadonlyArray<CanonicalSketchConstraintSolveIssue>;
}

export interface CanonicalSketchConstraintSolvePass {
  schema: typeof CANONICAL_SKETCH_CONSTRAINT_SOLVE_SCHEMA;
  status: 'SOLVER_PASS';
  verification: 'NUMERIC_ONLY';
  release: 'HOLD';
  currentRevision: CanonicalSketchPreflightPass['currentRevision'];
  preflightSha256: string;
  inputSha256: string;
  replaySha256: string;
  outputSha256: string;
  solverId: typeof CANONICAL_SKETCH_CONSTRAINT_SOLVER_ID;
  solverStatus: 'ok' | 'under-defined';
  dof: number;
  residual: number;
  solvedPoints: ReadonlyArray<CanonicalSketchPoint>;
  topology: {
    pointIds: ReadonlyArray<string>;
    lineIds: ReadonlyArray<string>;
    signedDoubleArea: number;
  };
}

export type CanonicalSketchConstraintSolveResult =
  | CanonicalSketchConstraintSolvePass
  | CanonicalSketchConstraintSolveHold;

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_DEPTH = 12;
const MAX_NODES = 8192;
const MAX_STRING_LENGTH = 512;
const MAX_CONSTRAINTS = 128;
const MAX_COORDINATE = 1_000_000;
const SOLVER_MAX_ITERATIONS = 50;
const SOLVER_TOLERANCE = 1e-6;
const REPLAY_COORDINATE_TOLERANCE = 1e-9;
const REPLAY_RESIDUAL_TOLERANCE = 1e-12;

const REQUEST_KEYS = ['schema', 'preflight', 'constraints'] as const;
const CONSTRAINT_KEYS = ['id', 'type', 'entityIds'] as const;
const PASS_KEYS = [
  'schema', 'status', 'verification', 'release', 'currentRevision',
  'preflightSha256', 'inputSha256', 'replaySha256', 'outputSha256',
  'solverId', 'solverStatus', 'dof', 'residual', 'solvedPoints', 'topology',
] as const;
const HOLD_KEYS = ['schema', 'status', 'verification', 'release', 'issues'] as const;
const REVISION_KEYS = ['revisionId', 'sequence', 'contentSha256'] as const;
const POINT_KEYS = ['id', 'x', 'y'] as const;
const TOPOLOGY_KEYS = ['pointIds', 'lineIds', 'signedDoubleArea'] as const;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const SNAPSHOT_ISSUE_CODES = new Set([
  'SNAPSHOT_LIMIT', 'SNAPSHOT_STRING_LIMIT', 'SNAPSHOT_NUMBER',
  'SNAPSHOT_CYCLE_OR_TYPE', 'SNAPSHOT_ARRAY_KEY', 'SNAPSHOT_ARRAY_LIMIT',
  'SNAPSHOT_ACCESSOR', 'SNAPSHOT_PROTOTYPE', 'SNAPSHOT_OBJECT_KEY',
  'SNAPSHOT_PROXY',
]);

type PlainRecord = Record<string, unknown>;

function isPlainRecord(value: unknown): value is PlainRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
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
    return actual.length === wanted.length
      && actual.every((key, index) => key === wanted[index]);
  } catch {
    return false;
  }
}

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
  if (Array.isArray(value)) {
    const keys = Reflect.ownKeys(value);
    if (keys.some(key => key !== 'length'
      && (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key)))) {
      throw new Error('SNAPSHOT_ARRAY_KEY');
    }
    if (value.length > MAX_NODES) throw new Error('SNAPSHOT_ARRAY_LIMIT');
    const output: unknown[] = [];
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor?.enumerable || !('value' in descriptor)) throw new Error('SNAPSHOT_ACCESSOR');
      output.push(boundedSnapshot(descriptor.value, seen, budget, depth + 1));
    }
    return output;
  }
  if (!isPlainRecord(value)) throw new Error('SNAPSHOT_PROTOTYPE');
  const keys = Reflect.ownKeys(value);
  if (keys.length > MAX_NODES || keys.some(key => (
    typeof key !== 'string' || FORBIDDEN_KEYS.has(key)))) {
    throw new Error('SNAPSHOT_OBJECT_KEY');
  }
  const output: PlainRecord = {};
  for (const key of keys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !('value' in descriptor)) throw new Error('SNAPSHOT_ACCESSOR');
    output[key] = boundedSnapshot(descriptor.value, seen, budget, depth + 1);
  }
  return output;
}

function rejectProxy(value: unknown): void {
  const clone = (globalThis as { structuredClone?: (input: unknown) => unknown }).structuredClone;
  if (typeof clone !== 'function') return;
  try {
    clone(value);
  } catch {
    throw new Error('SNAPSHOT_PROXY');
  }
}

function sha256Json(value: unknown): string {
  const hash = new Sha256();
  hash.update(canonicalCadConsumerDraftJson(value as CanonicalCadJsonValue));
  return [...hash.digestSync()].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function issue(code: string, path?: string): CanonicalSketchConstraintSolveIssue {
  return path ? { code, path } : { code };
}

function hold(issues: ReadonlyArray<CanonicalSketchConstraintSolveIssue>): CanonicalSketchConstraintSolveHold {
  return {
    schema: CANONICAL_SKETCH_CONSTRAINT_SOLVE_SCHEMA,
    status: 'HOLD',
    verification: 'NUMERIC_ONLY',
    release: 'HOLD',
    issues,
  };
}

function safeId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_ID.test(value);
}

function finiteCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_COORDINATE;
}

function sorted<T extends { id: string }>(values: readonly T[]): T[] {
  return [...values].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function idsEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
  const leftSorted = [...left].sort(compare);
  const rightSorted = [...right].sort(compare);
  return leftSorted.every((id, index) => id === rightSorted[index]);
}

function normalizeSource(value: unknown): { preflight: CanonicalSketchPreflightPass; constraints: CanonicalSketchConstraint[] } | CanonicalSketchConstraintSolveIssue[] {
  if (!isPlainRecord(value) || !hasExactKeys(value, REQUEST_KEYS)) return [issue('REQUEST_KEYS_INVALID')];
  if (value.schema !== CANONICAL_SKETCH_CONSTRAINT_SOLVE_SCHEMA) return [issue('SCHEMA_INVALID', 'schema')];
  if (!verifyCanonicalSketchPreflight(value.preflight)) return [issue('PREFLIGHT_INVALID', 'preflight')];
  const preflight = value.preflight as CanonicalSketchPreflightPass;
  if (!Array.isArray(value.constraints)) return [issue('CONSTRAINTS_INVALID', 'constraints')];
  if (value.constraints.length === 0) return [issue('EMPTY_EFFECTIVE_RESIDUAL', 'constraints')];
  if (value.constraints.length > MAX_CONSTRAINTS) return [issue('RESOURCE_LIMIT', 'constraints')];

  const pointIds = new Set(preflight.points.map(point => point.id));
  const lineIds = new Set(preflight.lineSegments.map(line => line.id));
  const constraintIds = new Set<string>();
  const semantic = new Set<string>();
  const constraints: CanonicalSketchConstraint[] = [];
  for (let index = 0; index < value.constraints.length; index++) {
    const raw = value.constraints[index];
    if (!isPlainRecord(raw) || !hasExactKeys(raw, CONSTRAINT_KEYS)) return [issue('CONSTRAINT_KEYS_INVALID', `constraints[${index}]`)];
    if (!safeId(raw.id)) return [issue('CONSTRAINT_ID_INVALID', `constraints[${index}].id`)];
    if (constraintIds.has(raw.id)) return [issue('CONSTRAINT_ID_DUPLICATE', `constraints[${index}].id`)];
    constraintIds.add(raw.id);
    if (!Array.isArray(raw.entityIds) || raw.entityIds.some(id => !safeId(id))) return [issue('CONSTRAINT_REFS_INVALID', `constraints[${index}].entityIds`)];
    const entityIds = raw.entityIds as string[];
    const type = raw.type;
    let refs: string[];
    if (type === 'fixed') {
      if (entityIds.length !== 1 || !pointIds.has(entityIds[0]!)) return [issue('CONSTRAINT_REF_INVALID', `constraints[${index}]`)];
      refs = entityIds;
    } else if (type === 'horizontal' || type === 'vertical') {
      if (entityIds.length !== 1 || !lineIds.has(entityIds[0]!)) return [issue('CONSTRAINT_REF_INVALID', `constraints[${index}]`)];
      refs = entityIds;
    } else if (type === 'coincident') {
      if (entityIds.length !== 2 || entityIds[0] === entityIds[1]
        || !pointIds.has(entityIds[0]!) || !pointIds.has(entityIds[1]!)) {
        return [issue('CONSTRAINT_REF_INVALID', `constraints[${index}]`)];
      }
      refs = [...entityIds].sort();
    } else {
      return [issue('CONSTRAINT_UNSUPPORTED', `constraints[${index}].type`)];
    }
    const semanticKey = `${type}:${refs.join(',')}`;
    if (semantic.has(semanticKey)) return [issue('CONSTRAINT_SEMANTIC_DUPLICATE', `constraints[${index}]`)];
    semantic.add(semanticKey);
    constraints.push({ id: raw.id, type, entityIds: refs });
  }
  if (constraints.every(constraint => constraint.type === 'fixed')) return [issue('EMPTY_EFFECTIVE_RESIDUAL')];
  return { preflight, constraints: sorted(constraints) };
}

function buildSolverInput(
  preflight: CanonicalSketchPreflightPass,
  constraints: readonly CanonicalSketchConstraint[],
): { segments: SketchSegment[]; solverConstraints: SketchConstraint[] } {
  const segments: SketchSegment[] = sorted(preflight.lineSegments).map(line => {
    const start = preflight.points.find(point => point.id === line.startPointId)!;
    const end = preflight.points.find(point => point.id === line.endPointId)!;
    return {
      id: line.id,
      type: 'line',
      points: [
        { id: start.id, x: start.x, y: start.y },
        { id: end.id, x: end.x, y: end.y },
      ],
    };
  });
  const solverConstraints: SketchConstraint[] = constraints.map(constraint => ({
    id: constraint.id,
    type: constraint.type,
    entityIds: [...constraint.entityIds],
    satisfied: false,
  }));
  return { segments, solverConstraints };
}

function solveOnce(preflight: CanonicalSketchPreflightPass, constraints: readonly CanonicalSketchConstraint[]): SolverResult {
  const input = buildSolverInput(preflight, constraints);
  return solveConstraints(input.segments, input.solverConstraints, [], SOLVER_MAX_ITERATIONS, SOLVER_TOLERANCE);
}

function resultPoints(result: SolverResult, preflight: CanonicalSketchPreflightPass): CanonicalSketchPoint[] | null {
  const points: CanonicalSketchPoint[] = [];
  for (const point of preflight.points) {
    const solved = result.points.get(point.id);
    if (!solved || !finiteCoordinate(solved.x) || !finiteCoordinate(solved.y)) return null;
    points.push({ id: point.id, x: solved.x, y: solved.y });
  }
  return sorted(points);
}

function outputRequest(preflight: CanonicalSketchPreflightPass, points: readonly CanonicalSketchPoint[]): unknown {
  return {
    schema: preflight.schema,
    projectId: preflight.projectId,
    documentId: preflight.documentId,
    currentRevision: preflight.currentRevision,
    sketchId: preflight.sketchId,
    plane: preflight.plane,
    points,
    lineSegments: sorted(preflight.lineSegments),
  };
}

function numericResult(result: SolverResult, points: readonly CanonicalSketchPoint[]): boolean {
  const solve = result.solveResult;
  return result.satisfied
    && result.unsatisfiedConstraints.length === 0
    && !!solve
    && (solve.status === 'ok' || solve.status === 'under-defined')
    && !solve.redundant?.length
    && typeof solve.dof === 'number'
    && Number.isInteger(solve.dof)
    && solve.dof >= 0
    && Number.isFinite(solve.residual)
    && points.every(point => finiteCoordinate(point.x) && finiteCoordinate(point.y));
}

function sameNumericResult(first: SolverResult, second: SolverResult, firstPoints: readonly CanonicalSketchPoint[], secondPoints: readonly CanonicalSketchPoint[]): boolean {
  const a = first.solveResult;
  const b = second.solveResult;
  if (!a || !b || a.status !== b.status || a.dof !== b.dof
    || !Number.isFinite(a.residual) || !Number.isFinite(b.residual)
    || Math.abs(a.residual! - b.residual!) > REPLAY_RESIDUAL_TOLERANCE
    || !idsEqual(firstPoints.map(point => point.id), secondPoints.map(point => point.id))) return false;
  return firstPoints.every((point, index) => {
    const other = secondPoints[index]!;
    return point.id === other.id
      && Math.abs(point.x - other.x) <= REPLAY_COORDINATE_TOLERANCE
      && Math.abs(point.y - other.y) <= REPLAY_COORDINATE_TOLERANCE;
  });
}

function solveNormalized(preflight: CanonicalSketchPreflightPass, constraints: readonly CanonicalSketchConstraint[]): CanonicalSketchConstraintSolvePass | CanonicalSketchConstraintSolveIssue[] {
  const first = solveOnce(preflight, constraints);
  const replay = solveOnce(preflight, constraints);
  const firstPoints = resultPoints(first, preflight);
  const replayPoints = resultPoints(replay, preflight);
  if (!firstPoints || !replayPoints) return [issue('SOLVER_NONFINITE')];
  if (!numericResult(first, firstPoints) || !numericResult(replay, replayPoints)) {
    const status = first.solveResult?.status;
    return [issue(status === 'inconsistent' ? 'SOLVER_INCONSISTENT' : status === 'over-defined' ? 'SOLVER_OVER_DEFINED' : 'SOLVER_NOT_SATISFIED')];
  }
  const firstStatus = first.solveResult!.status;
  const replayStatus = replay.solveResult!.status;
  if ((firstStatus !== 'ok' && firstStatus !== 'under-defined')
    || (replayStatus !== 'ok' && replayStatus !== 'under-defined')) {
    return [issue('SOLVER_STATUS_INVALID')];
  }
  if (!sameNumericResult(first, replay, firstPoints, replayPoints)) return [issue('SOLVER_NONDETERMINISTIC')];

  const output = preflightCanonicalSketch(outputRequest(preflight, firstPoints));
  if (output.status !== 'PRECHECK_PASS') return [issue('OUTPUT_STRUCTURAL_INVALID')];
  if (!idsEqual(output.loop.pointIds, preflight.loop.pointIds)
    || !idsEqual(output.loop.lineIds, preflight.loop.lineIds)
    || Math.sign(output.loop.signedDoubleArea) !== Math.sign(preflight.loop.signedDoubleArea)) {
    return [issue('OUTPUT_TOPOLOGY_CHANGED')];
  }
  const inputPayload = {
    schema: CANONICAL_SKETCH_CONSTRAINT_SOLVE_SCHEMA,
    preflightSha256: preflight.canonicalSketchSha256,
    currentRevision: preflight.currentRevision,
    sketchId: preflight.sketchId,
    plane: preflight.plane,
    points: preflight.points,
    lineSegments: preflight.lineSegments,
    constraints,
  };
  const replayPayload = {
    solverId: CANONICAL_SKETCH_CONSTRAINT_SOLVER_ID,
    solverStatus: replay.solveResult!.status,
    dof: replay.solveResult!.dof,
    residual: replay.solveResult!.residual,
    solvedPoints: replayPoints,
  };
  const outputPayload = {
    inputSha256: sha256Json(inputPayload),
    replaySha256: sha256Json(replayPayload),
    outputStructuralSha256: output.canonicalSketchSha256,
    solvedPoints: firstPoints,
  };
  return {
    schema: CANONICAL_SKETCH_CONSTRAINT_SOLVE_SCHEMA,
    status: 'SOLVER_PASS',
    verification: 'NUMERIC_ONLY',
    release: 'HOLD',
    currentRevision: preflight.currentRevision,
    preflightSha256: preflight.canonicalSketchSha256,
    inputSha256: sha256Json(inputPayload),
    replaySha256: sha256Json(replayPayload),
    outputSha256: sha256Json(outputPayload),
    solverId: CANONICAL_SKETCH_CONSTRAINT_SOLVER_ID,
    solverStatus: firstStatus,
    dof: first.solveResult!.dof!,
    residual: first.solveResult!.residual!,
    solvedPoints: firstPoints,
    topology: {
      pointIds: [...output.loop.pointIds],
      lineIds: [...output.loop.lineIds],
      signedDoubleArea: output.loop.signedDoubleArea,
    },
  };
}

export function solveCanonicalSketchConstraints(value: unknown): CanonicalSketchConstraintSolveResult {
  try {
    const snapshot = boundedSnapshot(value);
    rejectProxy(value);
    const normalized = normalizeSource(snapshot);
    if (Array.isArray(normalized)) return hold(normalized);
    const solved = solveNormalized(normalized.preflight, normalized.constraints);
    return Array.isArray(solved) ? hold(solved) : solved;
  } catch (error) {
    const code = error instanceof Error && SNAPSHOT_ISSUE_CODES.has(error.message)
      ? error.message
      : 'SOLVE_INPUT_INVALID';
    return hold([issue(code)]);
  }
}

function validatePassShape(value: PlainRecord): boolean {
  if (!hasExactKeys(value, PASS_KEYS)
    || value.schema !== CANONICAL_SKETCH_CONSTRAINT_SOLVE_SCHEMA
    || value.status !== 'SOLVER_PASS'
    || value.verification !== 'NUMERIC_ONLY'
    || value.release !== 'HOLD'
    || value.solverId !== CANONICAL_SKETCH_CONSTRAINT_SOLVER_ID
    || (value.solverStatus !== 'ok' && value.solverStatus !== 'under-defined')) return false;
  if (!isPlainRecord(value.currentRevision) || !hasExactKeys(value.currentRevision, REVISION_KEYS)) return false;
  if (!isPlainRecord(value.topology) || !hasExactKeys(value.topology, TOPOLOGY_KEYS)) return false;
  if (!Array.isArray(value.solvedPoints) || value.solvedPoints.length === 0) return false;
  if (![value.preflightSha256, value.inputSha256, value.replaySha256, value.outputSha256].every(hash => typeof hash === 'string' && SHA256.test(hash))) return false;
  if (typeof value.dof !== 'number' || !Number.isInteger(value.dof) || value.dof < 0) return false;
  if (typeof value.residual !== 'number' || !Number.isFinite(value.residual)) return false;
  if (!Array.isArray(value.topology.pointIds) || !Array.isArray(value.topology.lineIds)
    || !value.topology.pointIds.every(safeId) || !value.topology.lineIds.every(safeId)
    || !finiteCoordinate(value.topology.signedDoubleArea) || value.topology.signedDoubleArea === 0) return false;
  const ids = new Set<string>();
  for (const point of value.solvedPoints) {
    if (!isPlainRecord(point) || !hasExactKeys(point, POINT_KEYS)
      || !safeId(point.id) || ids.has(point.id)
      || !finiteCoordinate(point.x) || !finiteCoordinate(point.y)) return false;
    ids.add(point.id);
  }
  return true;
}

/** Re-run source validation and both solver passes; never trusts receipt hashes alone. */
export function verifyCanonicalSketchConstraintSolve(receipt: unknown, source: unknown): boolean {
  try {
    const receiptSnapshot = boundedSnapshot(receipt);
    const sourceSnapshot = boundedSnapshot(source);
    rejectProxy(receipt);
    rejectProxy(source);
    if (!isPlainRecord(receiptSnapshot) || !validatePassShape(receiptSnapshot)) return false;
    const normalized = normalizeSource(sourceSnapshot);
    if (Array.isArray(normalized)) return false;
    const expected = solveNormalized(normalized.preflight, normalized.constraints);
    if (Array.isArray(expected)) return false;
    return canonicalCadConsumerDraftJson(receiptSnapshot as unknown as CanonicalCadJsonValue)
      === canonicalCadConsumerDraftJson(expected as unknown as CanonicalCadJsonValue);
  } catch {
    return false;
  }
}
