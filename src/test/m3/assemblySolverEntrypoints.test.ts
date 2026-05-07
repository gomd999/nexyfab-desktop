/**
 * M3-P1: 공개 barrel에서 두 솔버 진입점이 함께 노출되고, 최소 호출이 성공하는지 고정.
 * (기하 회귀는 solveMatesRegression.test.ts, 간섭 파이프는 interferencePipeline.test.ts)
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  solveMates,
  solveAssembly,
  calculateDOF,
  type AssemblyState,
} from '@/app/[lang]/shape-generator/assembly';
import { applyGeometryMatesToPlaced } from '@/app/[lang]/shape-generator/assembly/applyGeometryMatesToPlaced';
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

describe('M3 assembly solver entrypoints (P1)', () => {
  it('exports solveMates + solveAssembly + calculateDOF from assembly barrel', () => {
    expect(typeof solveMates).toBe('function');
    expect(typeof solveAssembly).toBe('function');
    expect(typeof calculateDOF).toBe('function');
  });

  it('applyGeometryMatesToPlaced remains the nfab placement bridge (uses solveMates)', () => {
    expect(typeof applyGeometryMatesToPlaced).toBe('function');
    const placed: PlacedPart[] = [boxPlaced('A', [0, 0, 0]), boxPlaced('B', [50, 0, 0])];
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
    const out = applyGeometryMatesToPlaced(placed, mates, 4);
    expect(out).toHaveLength(2);
    expect(Math.abs(out[1]!.position[0])).toBeLessThan(45);
  });

  it('solveAssembly runs on minimal AssemblyState (panel path)', () => {
    const state: AssemblyState = {
      bodies: [
        {
          name: 'b0',
          position: new THREE.Vector3(0, 0, 0),
          rotation: new THREE.Euler(0, 0, 0),
          fixed: true,
        },
        {
          name: 'b1',
          position: new THREE.Vector3(1, 0, 0),
          rotation: new THREE.Euler(0, 0, 0),
          fixed: false,
        },
      ],
      mates: [],
    };
    const r = solveAssembly(state);
    expect(r.bodies).toHaveLength(2);
    expect(r.converged).toBe(true);
    expect(calculateDOF(state)).toBeGreaterThanOrEqual(0);
  });
});
