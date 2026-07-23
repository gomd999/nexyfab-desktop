/**
 * M3 mate-solver unification, Step 2 PREP (260723): PlacedPart + AssemblyMate
 * (face indices) → api.ts `solveMates` input (#1), NOT wired into #3's live
 * path — see faceRefResolver.ts header doc for the full scoping context.
 */
import { describe, it, expect } from 'vitest';
import { buildShapeResult } from '@/app/[lang]/shape-generator/shapes';
import { solveMates } from '@/lib/assembly/api';
import {
  faceRefFromPlacedFace,
  classifyPlacedFaceRefMappingFailure,
  placedPartsAndAssemblyMatesToSolveMatesInput,
} from '@/app/[lang]/shape-generator/assembly/faceRefResolver';
import type { PlacedPart } from '@/app/[lang]/shape-generator/assembly/PartPlacementPanel';
import type { AssemblyMate } from '@/app/[lang]/shape-generator/assembly/AssemblyMates';

function boxPlaced(name: string, position: [number, number, number], rotation: [number, number, number] = [0, 0, 0]): PlacedPart {
  return {
    id: `id_${name}`,
    name,
    shapeId: 'box',
    params: { width: 10, height: 10, depth: 10 },
    qty: 1,
    position,
    rotation,
  };
}

describe('M3 faceRefResolver (mate-solver unification, Step 2 prep)', () => {
  it('faceRefFromPlacedFace returns a plane ref for coincident (local frame, finite)', () => {
    const r = buildShapeResult('box', { width: 10, height: 10, depth: 10 });
    if (!r) throw new Error('box');
    const ref = faceRefFromPlacedFace(r.geometry, 0, 'coincident');
    expect(ref.kind).toBe('plane');
    if (ref.kind !== 'plane') throw new Error('unreachable');
    expect(Number.isFinite(ref.origin.x)).toBe(true);
    expect(Math.hypot(ref.normal.x, ref.normal.y, ref.normal.z)).toBeGreaterThan(0.9);
  });

  it('faceRefFromPlacedFace returns an axis ref for concentric/hinge/gear', () => {
    const r = buildShapeResult('box', { width: 10, height: 10, depth: 10 });
    if (!r) throw new Error('box');
    for (const kind of ['concentric', 'hinge', 'gear'] as const) {
      const ref = faceRefFromPlacedFace(r.geometry, 0, kind);
      expect(ref.kind).toBe('axis');
    }
  });

  it('classifyPlacedFaceRefMappingFailure flags unsupported kinds (slider/limitDistance/limitAngle/width)', () => {
    const placed = [boxPlaced('A', [0, 0, 0]), boxPlaced('B', [40, 0, 0])];
    for (const type of ['slider', 'limitDistance', 'limitAngle', 'width'] as const) {
      const mate: AssemblyMate = { id: 'm', type, partA: 'A', partB: 'B', faceA: 0, faceB: 0, locked: false };
      expect(classifyPlacedFaceRefMappingFailure(mate, placed)).toBe('unsupported_kind');
    }
  });

  it('classifyPlacedFaceRefMappingFailure still catches missing parts/geometry (reused from #2)', () => {
    const placed = [boxPlaced('A', [0, 0, 0])];
    const mate: AssemblyMate = { id: 'm', type: 'coincident', partA: 'A', partB: 'Ghost', faceA: 0, faceB: 0, locked: false };
    expect(classifyPlacedFaceRefMappingFailure(mate, placed)).toBe('part_b_not_found');
  });

  it('placedPartsAndAssemblyMatesToSolveMatesInput builds a spec that solveMates actually converges (coincident)', () => {
    const placed = [boxPlaced('A', [0, 0, 0]), boxPlaced('B', [40, 0, 0])];
    const mates: AssemblyMate[] = [
      { id: 'm1', type: 'coincident', partA: 'A', partB: 'B', faceA: 0, faceB: 0, locked: false },
    ];
    const { parts, mates: solveMateSpecs, report } = placedPartsAndAssemblyMatesToSolveMatesInput(placed, mates);
    expect(report.includedMateIds).toEqual(['m1']);
    expect(report.failures).toHaveLength(0);
    expect(parts).toHaveLength(2);
    expect(parts[0]!.fixed).toBe(true);
    expect(parts[1]!.fixed).toBe(false);

    const result = solveMates(parts, solveMateSpecs);
    const before = 40;
    const after = result.part('id_B').position.x;
    // Coincident pulls B toward A (fixed at x=0) — same directional proof
    // used by mateSelectionMapping.test.ts's analogous #2 test.
    expect(Math.abs(after)).toBeLessThan(Math.abs(before));
  });

  it('splits included vs unsupported mates in the same call, never silently dropping either', () => {
    const placed = [boxPlaced('A', [0, 0, 0]), boxPlaced('B', [40, 0, 0])];
    const mates: AssemblyMate[] = [
      { id: 'm_ok', type: 'coincident', partA: 'A', partB: 'B', faceA: 0, faceB: 0, locked: false },
      { id: 'm_bad', type: 'width', partA: 'A', partB: 'B', faceA: 0, faceB: 0, locked: false },
    ];
    const { report } = placedPartsAndAssemblyMatesToSolveMatesInput(placed, mates);
    expect(report.includedMateIds).toEqual(['m_ok']);
    expect(report.failures).toEqual([{ mateId: 'm_bad', failure: 'unsupported_kind' }]);
  });

  it('carries orientation through as a real quaternion, not identity, for a rotated part', () => {
    const placed = [boxPlaced('A', [0, 0, 0], [0, 0, 0]), boxPlaced('B', [40, 0, 0], [0, 90, 0])];
    const { parts } = placedPartsAndAssemblyMatesToSolveMatesInput(placed, []);
    const b = parts[1]!.orientation!;
    // 90deg about Y is NOT the identity quaternion.
    expect(Math.abs(b.w - 1)).toBeGreaterThan(0.01);
  });
});
