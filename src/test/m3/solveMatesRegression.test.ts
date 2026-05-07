/**
 * M3-P1: `AssemblyMates.solveMates` 회귀 — nfab / `applyGeometryMatesToPlaced`와 동일 솔버.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  solveMates,
  type AssemblyMate,
  type AssemblyPart,
} from '@/app/[lang]/shape-generator/assembly/AssemblyMates';

describe('M3 solveMates mesh iterative (P1)', () => {
  it('moves part B toward A for a coincident mate (unlocked)', () => {
    const g = new THREE.BoxGeometry(10, 10, 10);
    g.computeVertexNormals();
    const mA = new THREE.Matrix4().setPosition(0, 0, 0);
    const mB = new THREE.Matrix4().setPosition(100, 0, 0);
    const parts: AssemblyPart[] = [
      { id: 'A', geometry: g, transform: mA },
      { id: 'B', geometry: g, transform: mB },
    ];
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
    const out = solveMates(parts, mates, 12);
    expect(out.has('B')).toBe(true);
    const pos = new THREE.Vector3();
    out.get('B')!.decompose(pos, new THREE.Quaternion(), new THREE.Vector3());
    expect(Math.abs(pos.x)).toBeLessThan(80);
  });
});
