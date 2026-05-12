/**
 * I* — server mate solver v0 tests.
 */
import { describe, it, expect } from 'vitest';
import { serverMateAdapter } from '../serverMate';
import type { AssemblyMate } from '../types';

describe('serverMateAdapter', () => {
  it('isAvailable=true (no external deps)', () => {
    expect(serverMateAdapter.isAvailable()).toBe(true);
  });

  it('concentric mate emits zero translation when both at origin', async () => {
    const mates: AssemblyMate[] = [
      { id: 'm1', kind: 'concentric', handleA: 'a', handleB: 'b' },
    ];
    const r = await serverMateAdapter.solve(mates);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.transforms.b).toEqual([0, 0, 0]);
      expect(r.residual).toBe(0);
    }
  });

  it('coplanar mate snaps Z only', async () => {
    const mates: AssemblyMate[] = [
      { id: 'm1', kind: 'coplanar', handleA: 'a', handleB: 'b' },
    ];
    const r = await serverMateAdapter.solve(mates);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.transforms.b[2]).toBe(0);
  });

  it('distance mate moves B along +Z by value', async () => {
    const mates: AssemblyMate[] = [
      { id: 'm1', kind: 'distance', handleA: 'a', handleB: 'b', value: 25 },
    ];
    const r = await serverMateAdapter.solve(mates);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.transforms.b[2]).toBe(25);
  });

  it('distance without value fails typed', async () => {
    const mates: AssemblyMate[] = [
      { id: 'm1', kind: 'distance', handleA: 'a', handleB: 'b' },
    ];
    const r = await serverMateAdapter.solve(mates);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/numeric value/);
  });

  it('rotation-requiring mates return helpful upgrade message', async () => {
    for (const kind of ['tangent', 'parallel', 'perpendicular'] as const) {
      const r = await serverMateAdapter.solve([
        { id: 'm1', kind, handleA: 'a', handleB: 'b' },
      ]);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/rotation|Solvespace/i);
    }
  });

  it('multiple mates accumulate transforms', async () => {
    const mates: AssemblyMate[] = [
      { id: 'm1', kind: 'distance', handleA: 'fixed', handleB: 'a', value: 10 },
      { id: 'm2', kind: 'distance', handleA: 'a', handleB: 'b', value: 20 },
    ];
    const r = await serverMateAdapter.solve(mates);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.transforms.a[2]).toBe(10);
      // B is solved against A's *new* anchor (10,0,0), so b ends at 10+20=30.
      expect(r.transforms.b[2]).toBe(30);
    }
  });

  it('one bad mate fails the whole solve (atomic)', async () => {
    const mates: AssemblyMate[] = [
      { id: 'm1', kind: 'concentric', handleA: 'a', handleB: 'b' },
      { id: 'm2', kind: 'tangent', handleA: 'a', handleB: 'c' },
    ];
    const r = await serverMateAdapter.solve(mates);
    expect(r.ok).toBe(false);
  });
});
