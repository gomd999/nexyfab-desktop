import { describe, it, expect } from 'vitest';
import { generateSection, type SectionInput } from './sectionView';

type Tri = SectionInput['triangles'][number];

function cubeTris(size = 10): Tri[] {
  // Build a cube centered at origin from 12 triangles.
  const s = size / 2;
  const v = (x: number, y: number, z: number): [number, number, number] => [x, y, z];
  const faces: Array<[number, number, number, number]> = [
    // bottom (z=-s), top (z=+s)
    [0, 1, 2, 3], [4, 5, 6, 7],
    // sides
    [0, 1, 5, 4], [1, 2, 6, 5],
    [2, 3, 7, 6], [3, 0, 4, 7],
  ];
  const verts = [
    v(-s, -s, -s), v( s, -s, -s), v( s,  s, -s), v(-s,  s, -s),
    v(-s, -s,  s), v( s, -s,  s), v( s,  s,  s), v(-s,  s,  s),
  ];
  const tris: Tri[] = [];
  for (const [a, b, c, d] of faces) {
    tris.push([verts[a]!, verts[b]!, verts[c]!]);
    tris.push([verts[a]!, verts[c]!, verts[d]!]);
  }
  return tris;
}

describe('generateSection', () => {
  it('produces an empty result when plane misses the model', () => {
    const r = generateSection({
      triangles: cubeTris(10),
      kind: 'full',
      plane: { origin: [100, 0, 0], normal: [1, 0, 0] },
    });
    expect(r.polygons).toHaveLength(0);
    expect(r.areaMm2).toBe(0);
    expect(r.hatchLines).toHaveLength(0);
  });

  it('produces a closed polygon for a cube cut at midplane', () => {
    const r = generateSection({
      triangles: cubeTris(10),
      kind: 'full',
      plane: { origin: [0, 0, 0], normal: [0, 0, 1] }, // XY plane
    });
    expect(r.polygons.length).toBeGreaterThanOrEqual(1);
    // Cross-section of 10mm cube is 100 mm².
    expect(r.areaMm2).toBeGreaterThan(50);
    expect(r.areaMm2).toBeLessThan(200);
  });

  it('emits hatch lines for non-empty cross-section', () => {
    const r = generateSection({
      triangles: cubeTris(10),
      kind: 'full',
      plane: { origin: [0, 0, 0], normal: [0, 0, 1] },
    });
    expect(r.hatchLines.length).toBeGreaterThan(0);
  });

  it('respects custom hatch pitch', () => {
    const fine = generateSection({
      triangles: cubeTris(10),
      kind: 'full',
      plane: { origin: [0, 0, 0], normal: [0, 0, 1] },
      hatchPitchMm: 2,
    });
    const coarse = generateSection({
      triangles: cubeTris(10),
      kind: 'full',
      plane: { origin: [0, 0, 0], normal: [0, 0, 1] },
      hatchPitchMm: 8,
    });
    expect(fine.hatchLines.length).toBeGreaterThan(coarse.hatchLines.length);
  });

  it('handles tilted cutting plane', () => {
    const r = generateSection({
      triangles: cubeTris(10),
      kind: 'full',
      plane: { origin: [0, 0, 0], normal: [1, 1, 0] },
    });
    expect(r.areaMm2).toBeGreaterThan(0);
  });
});
