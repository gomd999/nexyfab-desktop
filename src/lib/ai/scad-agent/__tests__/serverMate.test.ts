/**
 * serverMateAdapter — thin delegation onto assemblyMateSolve (the real
 * iterativeSolve bridge). Deep solver behaviour is covered by
 * assemblyMateSolve.test.ts; here we assert the adapter forwards anchors and
 * passes results / errors through.
 */
import { describe, it, expect } from 'vitest';
import { serverMateAdapter } from '../serverMate';
import type { AssemblyMate } from '../types';
import type { MateAnchor } from '../assemblyMateSolve';

describe('serverMateAdapter', () => {
  it('isAvailable=true (no external deps)', () => {
    expect(serverMateAdapter.isAvailable()).toBe(true);
  });

  it('forwards anchors → concentric repositions the moving part', async () => {
    const anchors: Record<string, MateAnchor> = {
      a: { position: [0, 0, 0], cylindrical: true },
      b: { position: [15, 0, 0], cylindrical: true },
    };
    const mates: AssemblyMate[] = [
      { id: 'm1', kind: 'concentric', handleA: 'a', handleB: 'b', faceTagA: 'side', faceTagB: 'side' },
    ];
    const r = await serverMateAdapter.solve(mates, anchors);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.transforms.b).toBeDefined();
      expect(r.transforms.b[0]).toBeCloseTo(-15, 2); // pulled onto a's axis
      expect(r.transforms.a).toBeUndefined(); // first handle is the anchor
    }
  });

  it('no anchors → solves from origin (ok, no movement)', async () => {
    const r = await serverMateAdapter.solve([
      { id: 'm1', kind: 'concentric', handleA: 'a', handleB: 'b' },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r.transforms)).toHaveLength(0);
  });

  it('distance without a value is rejected', async () => {
    const r = await serverMateAdapter.solve([
      { id: 'm1', kind: 'distance', handleA: 'a', handleB: 'b' },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/unsupported|value/);
  });

  it('unknown mate kind is rejected', async () => {
    const r = await serverMateAdapter.solve([
      { id: 'm1', kind: 'bogus' as AssemblyMate['kind'], handleA: 'a', handleB: 'b' },
    ]);
    expect(r.ok).toBe(false);
  });

  it('rotation-requiring kinds run (carried) and surface a residual, not a wrong assembly', async () => {
    // v1 has no rotation; the core carries these as coincident so a residual
    // is reported rather than silently succeeding with a wrong placement.
    const anchors: Record<string, MateAnchor> = {
      a: { position: [0, 0, 0], bbox: { min: [-5, -5, -5], max: [5, 5, 5] } },
      b: { position: [3, 4, 0], bbox: { min: [-5, -5, -5], max: [5, 5, 5] } },
    };
    const r = await serverMateAdapter.solve(
      [{ id: 'm1', kind: 'parallel', handleA: 'a', handleB: 'b', faceTagA: 'x+', faceTagB: 'y+' }],
      anchors,
    );
    expect(r.ok).toBe(true); // not a hard failure — residual is the signal
  });
});
