/**
 * M3-P0: 어셈블리 스냅샷 스키마 회귀 — `normalizeAssemblySnapshot` 단일 진입점.
 */
import { describe, it, expect } from 'vitest';
import { normalizeAssemblySnapshot } from '@/app/[lang]/shape-generator/io/nfabFormat';

function part(name: string, position: [number, number, number]) {
  return {
    id: `id_${name}`,
    name,
    shapeId: 'box',
    params: { width: 10, height: 10, depth: 10 },
    qty: 1,
    position,
    rotation: [0, 0, 0] as [number, number, number],
  };
}

describe('M3 assembly snapshot (P0)', () => {
  it('keeps two placed parts and one mate', () => {
    const raw = {
      placedParts: [part('A', [0, 0, 0]), part('B', [50, 0, 0])],
      mates: [
        {
          id: 'm1',
          type: 'coincident' as const,
          partA: 'A',
          partB: 'B',
          faceA: 0,
          faceB: 1,
          locked: true,
        },
      ],
    };
    const n = normalizeAssemblySnapshot(raw);
    expect(n.placedParts).toHaveLength(2);
    expect(n.mates).toHaveLength(1);
    expect(n.mates[0].type).toBe('coincident');
    expect(n.mates[0].partA).toBe('A');
    expect(n.mates[0].partB).toBe('B');
  });

  it('returns empty assembly for nullish input', () => {
    expect(normalizeAssemblySnapshot(null)).toEqual({ placedParts: [], mates: [] });
    expect(normalizeAssemblySnapshot(undefined)).toEqual({ placedParts: [], mates: [] });
  });
});
