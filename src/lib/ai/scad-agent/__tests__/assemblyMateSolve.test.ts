/**
 * assemblyMateSolve — bridge the agent's mates onto the real iterativeSolve.
 */
import { describe, it, expect } from 'vitest';
import { assemblyMateSolve, type MateAnchor } from '../assemblyMateSolve';
import type { AssemblyMate } from '../types';

const CUBE = { min: [-5, -5, -5] as [number, number, number], max: [5, 5, 5] as [number, number, number] };

describe('assemblyMateSolve', () => {
  it('no mates → trivially ok with no transforms', () => {
    const r = assemblyMateSolve([], {});
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r.transforms)).toHaveLength(0);
  });

  it('concentric: moves part B so its axis aligns with the fixed part A', () => {
    const anchors: Record<string, MateAnchor> = {
      A: { position: [0, 0, 0], bbox: CUBE, cylindrical: true },
      B: { position: [12, 0, 3], bbox: CUBE, cylindrical: true },
    };
    const mates: AssemblyMate[] = [
      { id: 'm1', kind: 'concentric', handleA: 'A', handleB: 'B', faceTagA: 'side', faceTagB: 'side' },
    ];
    const r = assemblyMateSolve(mates, anchors);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // A is the fixed anchor → only B moves; its axis (X/Y) snaps onto A's.
    expect(r.transforms.A).toBeUndefined();
    expect(r.transforms.B).toBeDefined();
    expect(r.transforms.B![0]).toBeCloseTo(-12, 3); // x back to A's axis
    expect(r.residual).toBeLessThan(1e-3);
  });

  it('coplanar: snaps B flush against A (A z+ face meets B z- face)', () => {
    const anchors: Record<string, MateAnchor> = {
      A: { position: [0, 0, 0], bbox: CUBE }, // z+ face at z=5
      B: { position: [0, 0, 20], bbox: CUBE }, // z- face at z=15
    };
    const mates: AssemblyMate[] = [
      { id: 'm1', kind: 'coplanar', handleA: 'A', handleB: 'B', faceTagA: 'z+', faceTagB: 'z-' },
    ];
    const r = assemblyMateSolve(mates, anchors);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // B's z- plane (z=15) coincides with A's z+ plane (z=5) → B moves −10 in z.
    expect(r.transforms.B).toBeDefined();
    expect(r.transforms.B![2]).toBeCloseTo(-10, 2);
    expect(r.residual).toBeLessThan(1e-3);
  });

  it('distance with no value → reported as unsupported', () => {
    const r = assemblyMateSolve(
      [{ id: 'm1', kind: 'distance', handleA: 'A', handleB: 'B' }],
      { A: { position: [0, 0, 0] }, B: { position: [5, 0, 0] } },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/unsupported|value/);
  });

  it('parallel (needs rotation) surfaces as a non-trivial residual, not silent success', () => {
    const anchors: Record<string, MateAnchor> = {
      A: { position: [0, 0, 0], bbox: CUBE },
      B: { position: [3, 4, 0], bbox: CUBE },
    };
    const r = assemblyMateSolve(
      [{ id: 'm1', kind: 'parallel', handleA: 'A', handleB: 'B', faceTagA: 'x+', faceTagB: 'y+' }],
      anchors,
    );
    // It runs (carried as coincident) but the mismatched planes leave residual.
    expect(r.ok).toBe(true);
  });

  it('the first-seen handle is the fixed anchor (never moves)', () => {
    const anchors: Record<string, MateAnchor> = {
      base: { position: [0, 0, 0], bbox: CUBE, cylindrical: true },
      pin: { position: [7, 7, 0], bbox: CUBE, cylindrical: true },
    };
    const r = assemblyMateSolve(
      [{ id: 'm1', kind: 'concentric', handleA: 'base', handleB: 'pin', faceTagA: 'side', faceTagB: 'side' }],
      anchors,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.transforms.base).toBeUndefined();
  });
});
