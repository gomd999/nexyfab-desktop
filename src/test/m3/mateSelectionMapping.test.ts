/**
 * M3: AssemblyMate + PlacedPart → MateSelection / AssemblyState 매핑.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildShapeResult } from '@/app/[lang]/shape-generator/shapes';
import { solveAssembly } from '@/app/[lang]/shape-generator/assembly';
import {
  placedPartWorldMatrix,
  faceCentroidLocal,
  faceNormalLocal,
  mateSelectionFromPlacedFace,
  assemblyMateToSolverMate,
  placedPartsAndAssemblyMatesToSolverState,
  classifyPlacedAssemblyMateMappingFailure,
  reportPlacedAssemblyMateMapping,
} from '@/app/[lang]/shape-generator/assembly/mateSelectionMapping';
import type { PlacedPart } from '@/app/[lang]/shape-generator/assembly/PartPlacementPanel';
import type { AssemblyMate } from '@/app/[lang]/shape-generator/assembly/AssemblyMates';

function boxPlaced(name: string, position: [number, number, number]): PlacedPart {
  return {
    id: `id_${name}`,
    name,
    shapeId: 'box',
    params: { width: 10, height: 10, depth: 10 },
    qty: 1,
    position,
    rotation: [0, 0, 0],
  };
}

describe('M3 mateSelectionMapping', () => {
  it('faceCentroidLocal / faceNormalLocal are finite for library box', () => {
    const r = buildShapeResult('box', { width: 10, height: 10, depth: 10 });
    if (!r) throw new Error('box');
    const c = faceCentroidLocal(r.geometry, 0);
    const n = faceNormalLocal(r.geometry, 0);
    expect(c.length()).toBeGreaterThan(0);
    expect(n.length()).toBeGreaterThan(0.9);
  });

  it('placedPartWorldMatrix matches AssemblyBody pose for mapping', () => {
    const r = buildShapeResult('box', { width: 10, height: 10, depth: 10 });
    if (!r) throw new Error('box');
    const p = boxPlaced('A', [20, 0, 0]);
    const M = placedPartWorldMatrix(p);
    const local = faceCentroidLocal(r.geometry, 0);
    const worldFromMat = local.clone().applyMatrix4(M);
    const body = placedPartsAndAssemblyMatesToSolverState([p], []).bodies[0]!;
    const B = new THREE.Matrix4().compose(
      body.position,
      new THREE.Quaternion().setFromEuler(body.rotation),
      new THREE.Vector3(1, 1, 1),
    );
    const worldFromBody = local.clone().applyMatrix4(B);
    expect(worldFromMat.distanceTo(worldFromBody)).toBeLessThan(1e-5);
  });

  it('mateSelectionFromPlacedFace returns face-type selection', () => {
    const r = buildShapeResult('box', { width: 10, height: 10, depth: 10 });
    if (!r) throw new Error('box');
    const s = mateSelectionFromPlacedFace(0, r.geometry, 0, 'coincident');
    expect(s.type).toBe('face');
    expect(s.bodyIndex).toBe(0);
    expect(s.localPoint.lengthSq()).toBeGreaterThan(0);
  });

  it('assemblyMateToSolverMate builds Mate with two selections', () => {
    const placed = [boxPlaced('A', [0, 0, 0]), boxPlaced('B', [40, 0, 0])];
    const mate: AssemblyMate = {
      id: 'm_test',
      type: 'coincident',
      partA: 'A',
      partB: 'B',
      faceA: 0,
      faceB: 0,
      locked: false,
    };
    const sm = assemblyMateToSolverMate(mate, placed);
    expect(sm).not.toBeNull();
    expect(sm!.selections).toHaveLength(2);
    expect(sm!.enabled).toBe(true);
  });

  it('classifyPlacedAssemblyMateMappingFailure detects missing part B', () => {
    const placed = [boxPlaced('A', [0, 0, 0]), boxPlaced('B', [40, 0, 0])];
    const mate: AssemblyMate = {
      id: 'm_x',
      type: 'coincident',
      partA: 'A',
      partB: 'Ghost',
      faceA: 0,
      faceB: 0,
      locked: false,
    };
    expect(classifyPlacedAssemblyMateMappingFailure(mate, placed)).toBe('part_b_not_found');
    expect(assemblyMateToSolverMate(mate, placed)).toBeNull();
  });

  it('reportPlacedAssemblyMateMapping splits included vs failures', () => {
    const placed = [boxPlaced('A', [0, 0, 0]), boxPlaced('B', [40, 0, 0])];
    const mates: AssemblyMate[] = [
      {
        id: 'm_ok',
        type: 'coincident',
        partA: 'A',
        partB: 'B',
        faceA: 0,
        faceB: 0,
        locked: false,
      },
      {
        id: 'm_bad',
        type: 'coincident',
        partA: 'A',
        partB: 'Nope',
        faceA: 0,
        faceB: 0,
        locked: false,
      },
    ];
    const rep = reportPlacedAssemblyMateMapping(placed, mates);
    expect(rep.includedMateIds).toEqual(['m_ok']);
    expect(rep.failures).toHaveLength(1);
    expect(rep.failures[0]!.mateId).toBe('m_bad');
    expect(rep.failures[0]!.failure).toBe('part_b_not_found');
  });

  it('placedPartsAndAssemblyMatesToSolverState feeds solveAssembly (coincident)', () => {
    const placed = [boxPlaced('A', [0, 0, 0]), boxPlaced('B', [40, 0, 0])];
    const mates: AssemblyMate[] = [
      {
        id: 'm1',
        type: 'coincident',
        partA: 'A',
        partB: 'B',
        faceA: 0,
        faceB: 0,
        locked: false,
      },
    ];
    const state = placedPartsAndAssemblyMatesToSolverState(placed, mates);
    expect(state.bodies).toHaveLength(2);
    expect(state.mates).toHaveLength(1);
    const before = state.bodies[1]!.position.x;
    const out = solveAssembly(state);
    expect(out.bodies[1]!.position.x).toBeLessThan(before);
  });
});
