import * as THREE from 'three';
import { describe, it, expect } from 'vitest';
import { makeEdges } from '@/app/[lang]/shape-generator/shapes';
import type { BomPartResult } from '@/app/[lang]/shape-generator/ShapePreview';
import type { AssemblyMate } from '@/app/[lang]/shape-generator/assembly/AssemblyMates';
import {
  assemblyMateToSolverMateForBom,
  bomPartResultsAndAssemblyMatesToSolverState,
  classifyBomAssemblyMateMappingFailure,
  reportBomAssemblyMateMapping,
} from '@/app/[lang]/shape-generator/assembly/mateSelectionMapping';

function boxBom(name: string, x: number): BomPartResult {
  const g = new THREE.BoxGeometry(10, 10, 10);
  return {
    name,
    position: [x, 0, 0],
    result: {
      geometry: g,
      edgeGeometry: makeEdges(g),
      volume_cm3: 1000,
      surface_area_cm2: 600,
      bbox: { w: 10, h: 10, d: 10 },
    },
  };
}

describe('mateSelectionMapping BOM geometry path', () => {
  it('assemblyMateToSolverMateForBom uses mesh geometry indices', () => {
    const bom: BomPartResult[] = [boxBom('Body1', 0), boxBom('Body2', 30)];
    const mate: AssemblyMate = {
      id: 'm1',
      type: 'coincident',
      partA: 'Body1',
      partB: 'Body2',
      faceA: 0,
      faceB: 0,
      locked: false,
    };
    const sm = assemblyMateToSolverMateForBom(mate, bom);
    expect(sm).not.toBeNull();
    expect(sm!.selections[0]!.bodyIndex).toBe(0);
    expect(sm!.selections[1]!.bodyIndex).toBe(1);
  });

  it('classifyBomAssemblyMateMappingFailure when part name missing', () => {
    const bom: BomPartResult[] = [boxBom('Body1', 0), boxBom('Body2', 30)];
    const mate: AssemblyMate = {
      id: 'm1',
      type: 'coincident',
      partA: 'Body1',
      partB: 'Unknown',
      faceA: 0,
      faceB: 0,
      locked: false,
    };
    expect(classifyBomAssemblyMateMappingFailure(mate, bom)).toBe('part_b_not_found');
    expect(assemblyMateToSolverMateForBom(mate, bom)).toBeNull();
  });

  it('reportBomAssemblyMateMapping lists failures', () => {
    const bom = [boxBom('Body1', 0), boxBom('Body2', 25)];
    const mates: AssemblyMate[] = [
      {
        id: 'ok',
        type: 'coincident',
        partA: 'Body1',
        partB: 'Body2',
        faceA: 0,
        faceB: 0,
        locked: false,
      },
      {
        id: 'bad',
        type: 'coincident',
        partA: 'Body1',
        partB: 'X',
        faceA: 0,
        faceB: 0,
        locked: false,
      },
    ];
    const r = reportBomAssemblyMateMapping(bom, mates);
    expect(r.includedMateIds).toEqual(['ok']);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]!.failure).toBe('part_b_not_found');
  });

  it('bomPartResultsAndAssemblyMatesToSolverState builds two bodies and one mate', () => {
    const bom = [boxBom('Body1', 0), boxBom('Body2', 25)];
    const mates: AssemblyMate[] = [
      {
        id: 'm1',
        type: 'coincident',
        partA: 'Body1',
        partB: 'Body2',
        faceA: 0,
        faceB: 0,
        locked: false,
      },
    ];
    const state = bomPartResultsAndAssemblyMatesToSolverState(bom, mates);
    expect(state.bodies).toHaveLength(2);
    expect(state.mates).toHaveLength(1);
    expect(state.bodies[0]!.fixed).toBe(true);
    expect(state.bodies[1]!.fixed).toBe(false);
  });
});
