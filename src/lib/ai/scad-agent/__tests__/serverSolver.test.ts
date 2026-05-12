/**
 * H* — Solvespace adapter foundation tests (JS fallback subset).
 *
 * The real Solvespace WASM is a user-side build; until it ships these
 * tests pin the JS fallback's behavior on the trivial constraint set
 * we can solve without numerical optimization.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { serverSolverAdapter, _resetSolverCache } from '../serverSolver';
import type { SketchState } from '../types';

beforeEach(() => _resetSolverCache());

function sketch(overrides: Partial<SketchState> = {}): SketchState {
  return {
    name: 's',
    entities: [],
    constraints: [],
    solved: false,
    ...overrides,
  };
}

describe('serverSolverAdapter — JS fallback', () => {
  it('isAvailable=true (fallback always there)', () => {
    expect(serverSolverAdapter.isAvailable()).toBe(true);
  });

  it('horizontal: snaps line second-point Y to first-point Y', async () => {
    const s = sketch({
      entities: [{ id: 'l1', kind: 'line', points: [[0, 0], [10, 5]] }],
      constraints: [{ id: 'h', kind: 'horizontal', entityIds: ['l1'] }],
    });
    const r = await serverSolverAdapter.solve(s);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const l = r.updatedEntities.find(e => e.id === 'l1')!;
      expect(l.points[1][1]).toBe(0);
      expect(r.residual).toBe(0);
    }
  });

  it('vertical: snaps line second-point X to first-point X', async () => {
    const s = sketch({
      entities: [{ id: 'l1', kind: 'line', points: [[3, 0], [10, 5]] }],
      constraints: [{ id: 'v', kind: 'vertical', entityIds: ['l1'] }],
    });
    const r = await serverSolverAdapter.solve(s);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const l = r.updatedEntities.find(e => e.id === 'l1')!;
      expect(l.points[1][0]).toBe(3);
    }
  });

  it('distance: moves unfixed point along same direction to length', async () => {
    const s = sketch({
      entities: [
        { id: 'p1', kind: 'point', points: [[0, 0]] },
        { id: 'p2', kind: 'point', points: [[3, 4]] },  // initial distance 5
      ],
      constraints: [
        { id: 'fp', kind: 'fix_point', entityIds: ['p1'] },
        { id: 'd', kind: 'distance', entityIds: ['p1', 'p2'], value: 10 },
      ],
    });
    const r = await serverSolverAdapter.solve(s);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const p2 = r.updatedEntities.find(e => e.id === 'p2')!;
      // direction (3,4)/5 × 10 = (6, 8)
      expect(p2.points[0][0]).toBeCloseTo(6, 4);
      expect(p2.points[0][1]).toBeCloseTo(8, 4);
    }
  });

  it('distance with both endpoints fixed: handled but no change', async () => {
    const s = sketch({
      entities: [
        { id: 'p1', kind: 'point', points: [[0, 0]] },
        { id: 'p2', kind: 'point', points: [[5, 0]] },
      ],
      constraints: [
        { id: 'fp1', kind: 'fix_point', entityIds: ['p1'] },
        { id: 'fp2', kind: 'fix_point', entityIds: ['p2'] },
        { id: 'd', kind: 'distance', entityIds: ['p1', 'p2'], value: 5 },
      ],
    });
    const r = await serverSolverAdapter.solve(s);
    expect(r.ok).toBe(true);  // 5 == 5, residual ok
  });

  it('returns failure with helpful upgrade hint when fallback can\'t solve', async () => {
    const s = sketch({
      entities: [
        { id: 'l1', kind: 'line', points: [[0, 0], [10, 0]] },
        { id: 'l2', kind: 'line', points: [[0, 5], [5, 0]] },
      ],
      constraints: [
        { id: 'par', kind: 'parallel', entityIds: ['l1', 'l2'] },
      ],
    });
    const r = await serverSolverAdapter.solve(s);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/Solvespace WASM/);
      expect(r.reason).toMatch(/0\/1/);
    }
  });

  it('mixed: solves the trivial subset, reports unhandled', async () => {
    const s = sketch({
      entities: [
        { id: 'l1', kind: 'line', points: [[0, 0], [10, 5]] },
        { id: 'p1', kind: 'point', points: [[0, 0]] },
        { id: 'p2', kind: 'point', points: [[3, 0]] },
      ],
      constraints: [
        { id: 'h', kind: 'horizontal', entityIds: ['l1'] },
        { id: 'fp', kind: 'fix_point', entityIds: ['p1'] },
        { id: 'd', kind: 'distance', entityIds: ['p1', 'p2'], value: 7 },
        { id: 't', kind: 'tangent', entityIds: ['l1', 'p2'] }, // unhandled
      ],
    });
    const r = await serverSolverAdapter.solve(s);
    expect(r.ok).toBe(false);  // unhandled tangent + non-zero residual
    if (!r.ok) expect(r.reason).toMatch(/3\/4/);  // 3 of 4 handled
  });

  it('round-trip preserves entity ids', async () => {
    const s = sketch({
      entities: [{ id: 'unique-abc', kind: 'line', points: [[0, 0], [1, 1]] }],
      constraints: [{ id: 'h', kind: 'horizontal', entityIds: ['unique-abc'] }],
    });
    const r = await serverSolverAdapter.solve(s);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.updatedEntities[0].id).toBe('unique-abc');
  });
});
