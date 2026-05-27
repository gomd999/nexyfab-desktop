import { describe, it, expect } from 'vitest';
import {
  analyzeAssemblyDof,
  detectLoops,
  diagnoseOverConstraints,
  MATE_DOF_REDUCTION,
  type MateRef,
  type PartRef,
} from './mateDofAnalysis';

describe('analyzeAssemblyDof', () => {
  it('single free part has 6 DOF', () => {
    const r = analyzeAssemblyDof([{ id: 'P1' }], []);
    expect(r.parts[0]!.remainingDof).toBe(6);
    expect(r.status).toBe('mobile');
  });

  it('ground has 0 intrinsic DOF', () => {
    const r = analyzeAssemblyDof([{ id: 'G', isGround: true }], []);
    expect(r.parts[0]!.intrinsicDof).toBe(0);
  });

  it('rigid mate to ground locks part (0 remaining DOF)', () => {
    const parts: PartRef[] = [{ id: 'G', isGround: true }, { id: 'P1' }];
    const mates: MateRef[] = [{ id: 'M1', kind: 'rigid', partA: 'G', partB: 'P1' }];
    const r = analyzeAssemblyDof(parts, mates);
    expect(r.parts.find(p => p.partId === 'P1')!.remainingDof).toBe(0);
    expect(r.status).toBe('fully-constrained');
  });

  it('hinge mate leaves 1 DOF (rotation about axis)', () => {
    const parts: PartRef[] = [{ id: 'G', isGround: true }, { id: 'P1' }];
    const mates: MateRef[] = [{ id: 'M1', kind: 'hinge', partA: 'G', partB: 'P1' }];
    const r = analyzeAssemblyDof(parts, mates);
    expect(r.parts.find(p => p.partId === 'P1')!.remainingDof).toBe(1);
    expect(r.status).toBe('mobile');
  });

  it('over-constrained when reduction exceeds intrinsic DOF', () => {
    const parts: PartRef[] = [{ id: 'G', isGround: true }, { id: 'P1' }];
    const mates: MateRef[] = [
      { id: 'M1', kind: 'rigid', partA: 'G', partB: 'P1' },
      { id: 'M2', kind: 'rigid', partA: 'G', partB: 'P1' },
    ];
    const r = analyzeAssemblyDof(parts, mates);
    expect(r.status).toBe('over-constrained');
  });

  it('mate between two free parts splits DOF reduction', () => {
    const parts: PartRef[] = [{ id: 'P1' }, { id: 'P2' }];
    const mates: MateRef[] = [{ id: 'M1', kind: 'concentric', partA: 'P1', partB: 'P2' }];
    const r = analyzeAssemblyDof(parts, mates);
    // concentric = 4 DOF reduction split → 2 each.
    expect(r.parts[0]!.reducedDof).toBe(2);
    expect(r.parts[1]!.reducedDof).toBe(2);
  });

  it('DOF reduction table covers all mate kinds', () => {
    const kinds = Object.keys(MATE_DOF_REDUCTION);
    expect(kinds).toContain('hinge');
    expect(kinds).toContain('rigid');
    expect(MATE_DOF_REDUCTION['rigid']).toBe(6);
  });
});

describe('detectLoops', () => {
  it('chain (no loop) → empty', () => {
    const parts: PartRef[] = [{ id: 'A' }, { id: 'B' }, { id: 'C' }];
    const mates: MateRef[] = [
      { id: 'M1', kind: 'hinge', partA: 'A', partB: 'B' },
      { id: 'M2', kind: 'hinge', partA: 'B', partB: 'C' },
    ];
    expect(detectLoops(parts, mates)).toHaveLength(0);
  });

  it('triangle → one loop', () => {
    const parts: PartRef[] = [{ id: 'A' }, { id: 'B' }, { id: 'C' }];
    const mates: MateRef[] = [
      { id: 'M1', kind: 'hinge', partA: 'A', partB: 'B' },
      { id: 'M2', kind: 'hinge', partA: 'B', partB: 'C' },
      { id: 'M3', kind: 'hinge', partA: 'C', partB: 'A' },
    ];
    const loops = detectLoops(parts, mates);
    expect(loops.length).toBeGreaterThanOrEqual(1);
    expect(loops[0]!.mateIds).toHaveLength(3);
  });

  it('4-bar linkage → one loop with 4 mates', () => {
    const parts: PartRef[] = [
      { id: 'frame', isGround: true },
      { id: 'crank' }, { id: 'coupler' }, { id: 'rocker' },
    ];
    const mates: MateRef[] = [
      { id: 'M1', kind: 'hinge', partA: 'frame', partB: 'crank' },
      { id: 'M2', kind: 'hinge', partA: 'crank', partB: 'coupler' },
      { id: 'M3', kind: 'hinge', partA: 'coupler', partB: 'rocker' },
      { id: 'M4', kind: 'hinge', partA: 'rocker', partB: 'frame' },
    ];
    const loops = detectLoops(parts, mates);
    expect(loops.length).toBeGreaterThanOrEqual(1);
  });
});

describe('diagnoseOverConstraints', () => {
  it('empty diagnosis when not over-constrained', () => {
    const r = diagnoseOverConstraints([{ id: 'P1' }], []);
    expect(r.redundantMateCandidates).toHaveLength(0);
  });

  it('flags redundant duplicate mate', () => {
    const parts: PartRef[] = [{ id: 'G', isGround: true }, { id: 'P1' }];
    const mates: MateRef[] = [
      { id: 'M1', kind: 'rigid', partA: 'G', partB: 'P1' },
      { id: 'M2', kind: 'rigid', partA: 'G', partB: 'P1' },
    ];
    const r = diagnoseOverConstraints(parts, mates);
    expect(r.redundantMateCandidates.length).toBeGreaterThan(0);
    expect(r.suggestedRemovals).toHaveLength(1);
  });
});
