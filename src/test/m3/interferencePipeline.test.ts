/**
 * M3-P2: 간섭 입력 = `bomPartWorldMatrixFromBom` + `placedPartsToBomResults` (메이트 적용 후 포함).
 */
import { describe, it, expect } from 'vitest';
import { detectInterference } from '@/app/[lang]/shape-generator/assembly/InterferenceDetection';
import { bomPartWorldMatrixFromBom } from '@/app/[lang]/shape-generator/assembly/bomPartWorldMatrix';
import { placedPartsToBomResults } from '@/app/[lang]/shape-generator/assembly/PartPlacementPanel';
import { applyGeometryMatesToPlaced } from '@/app/[lang]/shape-generator/assembly/applyGeometryMatesToPlaced';
import type { AssemblyMate } from '@/app/[lang]/shape-generator/assembly/AssemblyMates';
import type { PlacedPart } from '@/app/[lang]/shape-generator/assembly/PartPlacementPanel';
import { buildShapeResult } from '@/app/[lang]/shape-generator/shapes';
import type { BomPartResult } from '@/app/[lang]/shape-generator/ShapePreview';

function boxPlaced(name: string, position: [number, number, number]): PlacedPart {
  return {
    id: `id_${name}`,
    name,
    shapeId: 'box',
    params: { width: 24, height: 24, depth: 24 },
    qty: 1,
    position,
    rotation: [0, 0, 0],
  };
}

describe('M3 interference pipeline (P2)', () => {
  it('bomPartWorldMatrixFromBom + overlapping placements yield at least one interference pair', () => {
    const r = buildShapeResult('box', { width: 24, height: 24, depth: 24 });
    if (!r) throw new Error('box');
    const rows: BomPartResult[] = [
      { name: 'A', result: r, position: [0, 0, 0], rotation: [0, 0, 0] },
      { name: 'B', result: r, position: [0, 0, 0], rotation: [0, 0, 0] },
    ];
    const parts = rows.map((p, i) => ({
      id: p.name || `part_${i}`,
      geometry: p.result.geometry,
      transform: bomPartWorldMatrixFromBom(p),
    }));
    const hits = detectInterference(parts);
    expect(hits.length).toBeGreaterThan(0);
  });

  it('after applyGeometryMatesToPlaced, placedPartsToBomResults feeds detectInterference (coincident)', () => {
    const placed: PlacedPart[] = [boxPlaced('A', [0, 0, 0]), boxPlaced('B', [80, 0, 0])];
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
    const solved = applyGeometryMatesToPlaced(placed, mates, 20);
    const bom = placedPartsToBomResults(solved);
    expect(bom.length).toBe(2);
    const parts = bom.map((p, i) => ({
      id: p.name || `part_${i}`,
      geometry: p.result.geometry,
      transform: bomPartWorldMatrixFromBom(p),
    }));
    const hits = detectInterference(parts);
    expect(hits.length).toBeGreaterThan(0);
  });
});
