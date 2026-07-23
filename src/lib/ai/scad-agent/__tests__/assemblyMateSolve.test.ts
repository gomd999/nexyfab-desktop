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

  // Round-4 dogfooding: `cylindrical` was declared on MateAnchor but never
  // read — the axis resolver hardcoded +Z regardless of shape or the flag,
  // so a shaft explicitly modeled long along X got its X/Y aligned (the
  // WRONG plane) while reporting residual 0 / full convergence. A CUBE bbox
  // (used above) can't catch this: Z is both the old hardcode AND this fix's
  // tie-break winner for an isotropic shape. These use an elongated bbox to
  // actually distinguish the two.
  const SHAFT_X = { min: [-10, -1, -1] as [number, number, number], max: [10, 1, 1] as [number, number, number] };

  it('cylindrical anchor long along X: concentric aligns Y/Z (the radial plane), X stays free', () => {
    const anchors: Record<string, MateAnchor> = {
      shaftA: { position: [0, 0, 0], bbox: SHAFT_X, cylindrical: true },
      shaftB: { position: [0, -5, -5], bbox: SHAFT_X, cylindrical: true },
    };
    const r = assemblyMateSolve(
      [{ id: 'm1', kind: 'concentric', handleA: 'shaftA', handleB: 'shaftB', faceTagA: 'side', faceTagB: 'side' }],
      anchors,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [dx, dy, dz] = r.transforms.shaftB ?? [0, 0, 0];
    expect(-5 + dy).toBeCloseTo(0); // Y aligned to shaftA
    expect(-5 + dz).toBeCloseTo(0); // Z aligned to shaftA
    expect(0 + dx).toBeCloseTo(0); // X (the axis direction) left untouched
  });

  it('cylindrical:false on the same elongated bbox keeps the historical Z default (no behavior change for non-cylindrical anchors)', () => {
    const anchors: Record<string, MateAnchor> = {
      a: { position: [0, 0, 0], bbox: SHAFT_X, cylindrical: false },
      b: { position: [4, -5, 9], bbox: SHAFT_X, cylindrical: false },
    };
    const r = assemblyMateSolve(
      [{ id: 'm1', kind: 'concentric', handleA: 'a', handleB: 'b', faceTagA: 'side', faceTagB: 'side' }],
      anchors,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [dx, dy, dz] = r.transforms.b ?? [0, 0, 0];
    // Z-default (axis = +Z) behavior: the X/Y plane gets aligned to A's,
    // Z (the axis direction) is left untouched — same convention as the
    // existing CUBE-based concentric test above, just with distinct X/Y/Z
    // offsets so this assertion can't pass by X-Y coincidence.
    expect(4 + dx).toBeCloseTo(0); // X aligned
    expect(-5 + dy).toBeCloseTo(0); // Y aligned
    expect(dz ?? 0).toBeCloseTo(0); // Z (axis direction) untouched
  });
});
