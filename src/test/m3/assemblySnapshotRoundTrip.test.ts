/**
 * M3: `.nfab`에 넣을 수 있는 어셈블리 스냅샷이 JSON 왕복 후에도 `normalizeAssemblySnapshot`으로 동일 의미를 유지하는지 검증.
 */
import { describe, it, expect } from 'vitest';
import { normalizeAssemblySnapshot } from '@/app/[lang]/shape-generator/io/nfabFormat';

function placed(
  name: string,
  position: [number, number, number],
  rotation: [number, number, number] = [0, 0, 0],
) {
  return {
    id: `id_${name}`,
    name,
    shapeId: 'box',
    params: { width: 12, height: 12, depth: 12 },
    qty: 1,
    position,
    rotation,
  };
}

describe('M3 assembly JSON round-trip', () => {
  it('preserves placedParts and mates after JSON.parse/stringify', () => {
    const raw = {
      placedParts: [placed('A', [0, 0, 0]), placed('B', [40, 0, 0], [0, 15, 0])],
      mates: [
        {
          id: 'mate_1',
          type: 'coincident' as const,
          partA: 'A',
          partB: 'B',
          faceA: 2,
          faceB: 4,
          locked: false,
        },
      ],
    };
    const once = normalizeAssemblySnapshot(raw);
    const wire = JSON.stringify(once);
    const twice = normalizeAssemblySnapshot(JSON.parse(wire));
    expect(twice.placedParts).toHaveLength(2);
    expect(twice.mates).toHaveLength(1);
    expect(twice.placedParts[0].name).toBe('A');
    expect(twice.placedParts[1].rotation[1]).toBe(15);
    expect(twice.mates[0].faceA).toBe(2);
    expect(twice.mates[0].partB).toBe('B');
  });

  it('drops mates with invalid type and keeps valid parts', () => {
    const raw = {
      placedParts: [placed('A', [0, 0, 0])],
      mates: [
        { id: 'bad', type: 'not_a_mate', partA: 'A', partB: 'X', locked: false },
        {
          id: 'ok',
          type: 'parallel' as const,
          partA: 'A',
          partB: 'A',
          locked: true,
        },
      ],
    };
    const n = normalizeAssemblySnapshot(raw);
    expect(n.placedParts).toHaveLength(1);
    expect(n.mates).toHaveLength(1);
    expect(n.mates[0].type).toBe('parallel');
  });

  it('preserves optional bodies + activeBodyId when well-formed', () => {
    const raw = {
      placedParts: [] as ReturnType<typeof placed>[],
      mates: [] as { id: string; type: 'coincident'; partA: string; partB: string; locked: boolean }[],
      bodies: [
        {
          id: 'body-1',
          name: 'Body1',
          color: '#8b9cf4',
          visible: true,
          locked: false,
        },
      ],
      activeBodyId: 'body-1',
      selectedBodyIds: ['body-1'],
    };
    const once = normalizeAssemblySnapshot(raw);
    const twice = normalizeAssemblySnapshot(JSON.parse(JSON.stringify(once)));
    expect(twice.bodies).toHaveLength(1);
    expect(twice.activeBodyId).toBe('body-1');
    expect(twice.selectedBodyIds).toEqual(['body-1']);
  });
});
