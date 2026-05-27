import { describe, it, expect } from 'vitest';
import { meshBoolean, meshVolume, meshSurfaceArea, type TriangleMesh } from './meshBoolean';

/** Unit cube as a triangle mesh. */
function unitCube(offsetX = 0): TriangleMesh {
  const o = offsetX;
  return {
    positions: [
      0 + o, 0, 0,  1 + o, 0, 0,  1 + o, 1, 0,  0 + o, 1, 0,
      0 + o, 0, 1,  1 + o, 0, 1,  1 + o, 1, 1,  0 + o, 1, 1,
    ],
    indices: [
      0, 2, 1, 0, 3, 2,   // bottom
      4, 5, 6, 4, 6, 7,   // top
      0, 1, 5, 0, 5, 4,   // front
      2, 3, 7, 2, 7, 6,   // back
      1, 2, 6, 1, 6, 5,   // right
      0, 4, 7, 0, 7, 3,   // left
    ],
  };
}

describe('meshBoolean', () => {
  it('identical-mesh union returns single copy', () => {
    const a = unitCube();
    const r = meshBoolean({ a, b: unitCube(), op: 'union' });
    expect(r.mesh.indices.length).toBe(a.indices.length);
    expect(r.isClosed).toBe(true);
    expect(r.triangleOrigin.every(o => o === 0)).toBe(true);
  });

  it('disjoint union concatenates meshes', () => {
    const a = unitCube();
    const b = unitCube(5);
    const r = meshBoolean({ a, b, op: 'union' });
    expect(r.mesh.indices.length).toBe(a.indices.length + b.indices.length);
    expect(r.triangleOrigin.filter(o => o === 0).length).toBe(a.indices.length / 3);
    expect(r.triangleOrigin.filter(o => o === 1).length).toBe(b.indices.length / 3);
  });

  it('B indices offset correctly', () => {
    const a = unitCube();
    const b = unitCube(5);
    const r = meshBoolean({ a, b, op: 'union' });
    // Max index of A's contribution = 7. B's contribution starts at 8.
    const aTriEnd = a.indices.length;
    const firstBIdx = r.mesh.indices[aTriEnd];
    expect(firstBIdx).toBeGreaterThanOrEqual(8);
  });

  it('difference and intersection ops accepted (placeholder concat)', () => {
    const a = unitCube();
    const b = unitCube(0.5);
    expect(() => meshBoolean({ a, b, op: 'difference' })).not.toThrow();
    expect(() => meshBoolean({ a, b, op: 'intersection' })).not.toThrow();
  });
});

describe('meshVolume', () => {
  it('unit cube has volume 1', () => {
    expect(meshVolume(unitCube())).toBeCloseTo(1, 6);
  });

  it('scaled cube (s=2) has volume 8', () => {
    const m = unitCube();
    // Scale all positions by 2.
    m.positions = m.positions.map(v => v * 2);
    expect(meshVolume(m)).toBeCloseTo(8, 6);
  });

  it('empty mesh volume is 0', () => {
    expect(meshVolume({ positions: [], indices: [] })).toBe(0);
  });
});

describe('meshSurfaceArea', () => {
  it('unit cube surface area = 6', () => {
    expect(meshSurfaceArea(unitCube())).toBeCloseTo(6, 6);
  });

  it('empty mesh area is 0', () => {
    expect(meshSurfaceArea({ positions: [], indices: [] })).toBe(0);
  });
});
