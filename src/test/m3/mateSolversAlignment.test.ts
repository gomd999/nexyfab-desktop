/**
 * M3: 동일 coincident 메이트에 대해 mesh 솔버 vs selection 솔버가 같은 방향(접근)으로 움직이는지 느슨하게 검증.
 */
import { describe, it, expect } from 'vitest';
import { applyGeometryMatesToPlaced } from '@/app/[lang]/shape-generator/assembly/applyGeometryMatesToPlaced';
import { solveAssembly } from '@/app/[lang]/shape-generator/assembly';
import { placedPartsAndAssemblyMatesToSolverState } from '@/app/[lang]/shape-generator/assembly/mateSelectionMapping';
import type { PlacedPart } from '@/app/[lang]/shape-generator/assembly/PartPlacementPanel';
import type { AssemblyMate } from '@/app/[lang]/shape-generator/assembly/AssemblyMates';

function boxPlaced(name: string, x: number): PlacedPart {
  return {
    id: `id_${name}`,
    name,
    shapeId: 'box',
    params: { width: 10, height: 10, depth: 10 },
    qty: 1,
    position: [x, 0, 0],
    rotation: [0, 0, 0],
  };
}

describe('M3 mate solvers coarse alignment', () => {
  it('both solvers move B toward A for coincident library boxes', () => {
    const placed: PlacedPart[] = [boxPlaced('A', 0), boxPlaced('B', 40)];
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

    const afterMesh = applyGeometryMatesToPlaced(placed, mates, 20);
    const bxMesh = afterMesh[1]!.position[0];

    const state0 = placedPartsAndAssemblyMatesToSolverState(placed, mates);
    const solved = solveAssembly(state0);
    const bxSolver = solved.bodies[1]!.position.x;

    expect(bxMesh).toBeLessThan(40);
    expect(bxSolver).toBeLessThan(40);
    expect(Math.abs(bxMesh - bxSolver)).toBeLessThan(25);
  });

  it('both solvers move B in the same direction for distance mate on library boxes', () => {
    const placed: PlacedPart[] = [boxPlaced('A', 0), boxPlaced('B', 40)];
    const mates: AssemblyMate[] = [
      {
        id: 'd1',
        type: 'distance',
        partA: 'A',
        partB: 'B',
        faceA: 0,
        faceB: 0,
        value: 8,
        locked: false,
      },
    ];

    const afterMesh = applyGeometryMatesToPlaced(placed, mates, 40);
    const bxMesh = afterMesh[1]!.position[0];

    const state0 = placedPartsAndAssemblyMatesToSolverState(placed, mates);
    const solved = solveAssembly(state0);
    const bxSolver = solved.bodies[1]!.position.x;

    expect(bxMesh).not.toBe(40);
    expect(bxSolver).not.toBe(40);
    expect(Math.sign(bxMesh - 40)).toBe(Math.sign(bxSolver - 40));
  });
});
