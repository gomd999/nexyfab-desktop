/**
 * M3 품질: `placedPartsToBomResults` ↔ `ShapeMesh` / `bomPartWorldMatrixFromBom` 단위 일치(도·mm).
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { placedPartsToBomResults } from '@/app/[lang]/shape-generator/assembly/PartPlacementPanel';
import { bomPartWorldMatrixFromBom } from '@/app/[lang]/shape-generator/assembly/bomPartWorldMatrix';
import type { PlacedPart } from '@/app/[lang]/shape-generator/assembly/PartPlacementPanel';
import { normalizeAssemblySnapshot } from '@/app/[lang]/shape-generator/io/nfabFormat';

describe('M3 BOM consistency', () => {
  it('placedPartsToBomResults keeps rotation in degrees and matches world matrix (Y 90°)', () => {
    const placed: PlacedPart[] = [
      {
        id: 'id_A',
        name: 'A',
        shapeId: 'box',
        params: { width: 10, height: 10, depth: 10 },
        qty: 1,
        position: [0, 0, 0],
        rotation: [0, 90, 0],
      },
    ];
    const bom = placedPartsToBomResults(placed);
    expect(bom).toHaveLength(1);
    expect(bom[0].rotation).toEqual([0, 90, 0]);
    const expected = new THREE.Matrix4().makeRotationFromEuler(
      new THREE.Euler(0, Math.PI / 2, 0, 'XYZ'),
    );
    const actual = bomPartWorldMatrixFromBom(bom[0]);
    for (let i = 0; i < 16; i++) {
      expect(actual.elements[i]).toBeCloseTo(expected.elements[i], 5);
    }
  });

  it('placedPartsToBomResults preserves mm positions (no stray ÷1000 on X)', () => {
    const placed: PlacedPart[] = [
      {
        id: 'id_A',
        name: 'A',
        shapeId: 'box',
        params: { width: 5, height: 5, depth: 5 },
        qty: 1,
        position: [120, 30, 40],
        rotation: [0, 0, 0],
      },
    ];
    const bom = placedPartsToBomResults(placed);
    expect(bom[0].position).toEqual([120, 30, 40]);
  });

  it('normalizeAssemblySnapshot is idempotent for a valid assembly blob', () => {
    const raw = {
      placedParts: [
        {
          id: 'id_A',
          name: 'A',
          shapeId: 'box',
          params: { width: 10, height: 10, depth: 10 },
          qty: 1,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
        },
      ],
      mates: [] as const,
    };
    const once = normalizeAssemblySnapshot(raw);
    const twice = normalizeAssemblySnapshot(once);
    expect(twice).toEqual(once);
  });
});
