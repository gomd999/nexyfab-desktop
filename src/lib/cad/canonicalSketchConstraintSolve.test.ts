import { describe, expect, it } from 'vitest';
import {
  CANONICAL_SKETCH_CONSTRAINT_SOLVE_SCHEMA,
  solveCanonicalSketchConstraints,
  verifyCanonicalSketchConstraintSolve,
  type CanonicalSketchConstraintSolveRequest,
} from './canonicalSketchConstraintSolve';
import {
  preflightCanonicalSketch,
  type CanonicalSketchPreflightPass,
} from './canonicalSketchPreflight';

const revision = {
  revisionId: 'rev:1',
  sequence: 1,
  contentSha256: 'a'.repeat(64),
};

function preflight(): CanonicalSketchPreflightPass {
  const result = preflightCanonicalSketch({
    schema: 'nexyfab.precision-cad.canonical-sketch-preflight.v1',
    projectId: 'project:1',
    documentId: 'document:1',
    currentRevision: revision,
    sketchId: 'sketch:1',
    plane: 'XY',
    points: [
      { id: 'p0', x: 0, y: 0 },
      { id: 'p1', x: 10, y: 0 },
      { id: 'p2', x: 10, y: 10 },
      { id: 'p3', x: 0, y: 10 },
    ],
    lineSegments: [
      { id: 'l0', startPointId: 'p0', endPointId: 'p1' },
      { id: 'l1', startPointId: 'p1', endPointId: 'p2' },
      { id: 'l2', startPointId: 'p2', endPointId: 'p3' },
      { id: 'l3', startPointId: 'p3', endPointId: 'p0' },
    ],
  });
  if (result.status !== 'PRECHECK_PASS') throw new Error('fixture preflight failed');
  return result;
}

function request(constraints: unknown[] = [
  { id: 'fix:p0', type: 'fixed', entityIds: ['p0'] },
  { id: 'h:l0', type: 'horizontal', entityIds: ['l0'] },
  { id: 'v:l1', type: 'vertical', entityIds: ['l1'] },
  { id: 'h:l2', type: 'horizontal', entityIds: ['l2'] },
  { id: 'v:l3', type: 'vertical', entityIds: ['l3'] },
]): CanonicalSketchConstraintSolveRequest {
  return {
    schema: CANONICAL_SKETCH_CONSTRAINT_SOLVE_SCHEMA,
    preflight: preflight(),
    constraints: constraints as CanonicalSketchConstraintSolveRequest['constraints'],
  };
}

describe('canonical sketch constraint solve', () => {
  it('solves a bounded rectangle and stays HOLD/non-native', () => {
    const result = solveCanonicalSketchConstraints(request());
    expect(result).toMatchObject({
      status: 'SOLVER_PASS', verification: 'NUMERIC_ONLY', release: 'HOLD',
      solverId: 'constraintSolver.lm.v1',
    });
    if (result.status === 'SOLVER_PASS') {
      expect(result.solvedPoints).toHaveLength(4);
      expect(result.topology.pointIds).toEqual(expect.arrayContaining(['p0', 'p1', 'p2', 'p3']));
      expect(Number.isFinite(result.residual)).toBe(true);
    }
  });

  it('is deterministic and verifies by replay, not by hashes alone', () => {
    const input = request();
    const first = solveCanonicalSketchConstraints(input);
    const second = solveCanonicalSketchConstraints(input);
    expect(second).toEqual(first);
    expect(first.status).toBe('SOLVER_PASS');
    expect(verifyCanonicalSketchConstraintSolve(first, input)).toBe(true);
    if (first.status === 'SOLVER_PASS') {
      const tampered = { ...first, outputSha256: 'b'.repeat(64) };
      expect(verifyCanonicalSketchConstraintSolve(tampered, input)).toBe(false);
      const changedSource = request([{ id: 'unsupported', type: 'distance', entityIds: ['p0', 'p1'] }]);
      expect(verifyCanonicalSketchConstraintSolve(first, changedSource)).toBe(false);
    }
  });

  it('fails closed for empty, unsupported, missing, duplicate and semantic duplicate constraints', () => {
    expect(solveCanonicalSketchConstraints(request([]))).toMatchObject({ status: 'HOLD', issues: [{ code: 'EMPTY_EFFECTIVE_RESIDUAL' }] });
    expect(solveCanonicalSketchConstraints(request([{ id: 'x', type: 'distance', entityIds: ['p0', 'p1'] }]))).toMatchObject({ status: 'HOLD', issues: [{ code: 'CONSTRAINT_UNSUPPORTED' }] });
    expect(solveCanonicalSketchConstraints(request([{ id: 'x', type: 'horizontal', entityIds: ['missing'] }]))).toMatchObject({ status: 'HOLD', issues: [{ code: 'CONSTRAINT_REF_INVALID' }] });
    expect(solveCanonicalSketchConstraints(request([
      { id: 'x', type: 'horizontal', entityIds: ['l0'] },
      { id: 'x', type: 'vertical', entityIds: ['l1'] },
    ]))).toMatchObject({ status: 'HOLD', issues: [{ code: 'CONSTRAINT_ID_DUPLICATE' }] });
    expect(solveCanonicalSketchConstraints(request([
      { id: 'x', type: 'coincident', entityIds: ['p0', 'p1'] },
      { id: 'y', type: 'coincident', entityIds: ['p1', 'p0'] },
    ]))).toMatchObject({ status: 'HOLD', issues: [{ code: 'CONSTRAINT_SEMANTIC_DUPLICATE' }] });
  });

  it('rejects extra keys, expressions, units, self references and non-finite input', () => {
    expect(solveCanonicalSketchConstraints(request([{ id: 'x', type: 'horizontal', entityIds: ['l0'], expression: '1' }]))).toMatchObject({ status: 'HOLD', issues: [{ code: 'CONSTRAINT_KEYS_INVALID' }] });
    expect(solveCanonicalSketchConstraints(request([{ id: 'x', type: 'coincident', entityIds: ['p0', 'p0'] }]))).toMatchObject({ status: 'HOLD', issues: [{ code: 'CONSTRAINT_REF_INVALID' }] });
    const bad = request();
    (bad.preflight.points[0] as { x: number }).x = Number.NaN;
    expect(solveCanonicalSketchConstraints(bad)).toMatchObject({ status: 'HOLD' });
  });

  it('rejects descriptors, proxies, cycles, depth and resource oversize', () => {
    const getter = request();
    Object.defineProperty(getter.constraints, '0', { enumerable: true, get: () => getter.constraints[0] });
    expect(solveCanonicalSketchConstraints(getter)).toMatchObject({ status: 'HOLD' });
    const symbol = request();
    Object.defineProperty(symbol.constraints[0], Symbol('hidden'), { enumerable: true, value: 1 });
    expect(solveCanonicalSketchConstraints(symbol)).toMatchObject({ status: 'HOLD' });
    const hidden = request();
    Object.defineProperty(hidden.constraints[0], 'hidden', { enumerable: false, value: true });
    expect(solveCanonicalSketchConstraints(hidden)).toMatchObject({ status: 'HOLD' });
    expect(solveCanonicalSketchConstraints(new Proxy(request(), {}))).toMatchObject({ status: 'HOLD' });
    const cycle = request() as unknown as Record<string, unknown>;
    cycle.self = cycle;
    expect(solveCanonicalSketchConstraints(cycle)).toMatchObject({ status: 'HOLD' });
    const deep = request() as unknown as Record<string, unknown>;
    let cursor = deep;
    for (let index = 0; index < 14; index++) {
      cursor.next = {};
      cursor = cursor.next as Record<string, unknown>;
    }
    expect(solveCanonicalSketchConstraints(deep)).toMatchObject({ status: 'HOLD' });
    const oversized = request(new Array(129).fill(0).map((_, index) => ({ id: `h${index}`, type: 'horizontal', entityIds: ['l0'] })));
    expect(solveCanonicalSketchConstraints(oversized)).toMatchObject({ status: 'HOLD', issues: [{ code: 'RESOURCE_LIMIT' }] });
  });

  it('rejects redundant and inconsistent solver outcomes', () => {
    const redundant = request([
      { id: 'h1', type: 'horizontal', entityIds: ['l0'] },
      { id: 'h2', type: 'horizontal', entityIds: ['l0'] },
    ]);
    expect(solveCanonicalSketchConstraints(redundant)).toMatchObject({
      status: 'HOLD', issues: [{ code: 'CONSTRAINT_SEMANTIC_DUPLICATE' }],
    });
    const inconsistent = request([
      { id: 'fix0', type: 'fixed', entityIds: ['p0'] },
      { id: 'fix1', type: 'fixed', entityIds: ['p1'] },
      { id: 'co', type: 'coincident', entityIds: ['p0', 'p1'] },
    ]);
    expect(solveCanonicalSketchConstraints(inconsistent)).toMatchObject({ status: 'HOLD' });
  });
});
