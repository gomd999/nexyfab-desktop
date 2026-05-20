import { describe, it, expect } from 'vitest';
import {
  transferAttributes,
  closestPointOnMesh,
  bakeVertexColors,
  summarize,
  type MeshArrays,
  type VertexAttribute,
} from './attributeTransfer';

function unitQuad(): MeshArrays {
  return {
    positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
    indices: [0, 1, 2, 0, 2, 3],
  };
}

function singleTri(): MeshArrays {
  return {
    positions: [0, 0, 0, 10, 0, 0, 5, 10, 0],
    indices: [0, 1, 2],
  };
}

describe('closestPointOnMesh', () => {
  it('point on vertex returns barycentric = (1, 0, 0)', () => {
    const hit = closestPointOnMesh([0, 0, 0], singleTri());
    expect(hit.barycentric.u).toBeCloseTo(1, 5);
    expect(hit.distance).toBeCloseTo(0, 5);
  });

  it('point above triangle returns perpendicular distance', () => {
    const hit = closestPointOnMesh([5, 5, 7], singleTri());
    expect(hit.distance).toBeCloseTo(7, 5);
  });

  it('point off the side returns segment closest', () => {
    const hit = closestPointOnMesh([-5, 0, 0], singleTri());
    expect(hit.point[0]).toBeCloseTo(0, 5);
  });

  it('barycentric sums to ~1', () => {
    const hit = closestPointOnMesh([3, 3, 1], singleTri());
    const s = hit.barycentric.u + hit.barycentric.v + hit.barycentric.w;
    expect(s).toBeCloseTo(1, 5);
  });
});

describe('transferAttributes', () => {
  it('passes through colors when target = source', () => {
    const source = singleTri();
    const target = singleTri();
    const colors: VertexAttribute = { name: 'color', kind: 'rgb', data: [1, 0, 0, 0, 1, 0, 0, 0, 1] };
    const r = transferAttributes(source, [colors], target);
    expect(r.attributes[0]!.data[0]).toBeCloseTo(1, 5); // vertex 0 → red
    expect(r.attributes[0]!.data[4]).toBeCloseTo(1, 5); // vertex 1 → green channel
  });

  it('reports per-vertex distance', () => {
    const source = singleTri();
    const target: MeshArrays = {
      positions: [5, 5, 5, 6, 6, 6],
      indices: [0, 1, 0],
    };
    const colors: VertexAttribute = { name: 'color', kind: 'rgb', data: [1, 0, 0, 0, 1, 0, 0, 0, 1] };
    const r = transferAttributes(source, [colors], target);
    expect(r.perVertexDistance.length).toBe(2);
    expect(r.perVertexDistance[0]).toBeGreaterThan(0);
  });

  it('multiple attributes transferred', () => {
    const source = singleTri();
    const target = singleTri();
    const colors: VertexAttribute = { name: 'color', kind: 'rgb', data: [1, 0, 0, 0, 1, 0, 0, 0, 1] };
    const weights: VertexAttribute = { name: 'weight', kind: 'scalar', data: [0, 0.5, 1] };
    const r = transferAttributes(source, [colors, weights], target);
    expect(r.attributes).toHaveLength(2);
    expect(r.attributes[1]!.data).toHaveLength(3);
  });

  it('vec2 (UV) transfer works', () => {
    const source: MeshArrays = unitQuad();
    const target = unitQuad();
    const uvs: VertexAttribute = { name: 'uv', kind: 'vec2', data: [0, 0, 1, 0, 1, 1, 0, 1] };
    const r = transferAttributes(source, [uvs], target);
    expect(r.attributes[0]!.data).toHaveLength(8);
  });
});

describe('bakeVertexColors', () => {
  it('returns RGB attribute named "color"', () => {
    const source = singleTri();
    const target = singleTri();
    const r = bakeVertexColors(source, [1, 0, 0, 0, 1, 0, 0, 0, 1], target);
    expect(r.attributes[0]!.name).toBe('color');
    expect(r.attributes[0]!.kind).toBe('rgb');
  });
});

describe('summarize', () => {
  it('reports counts + withinSnap fraction', () => {
    const source = singleTri();
    const target = singleTri();
    const colors: VertexAttribute = { name: 'color', kind: 'rgb', data: [1, 0, 0, 0, 1, 0, 0, 0, 1] };
    const r = transferAttributes(source, [colors], target);
    const s = summarize(r, 1);
    expect(s.targetVertexCount).toBe(3);
    expect(s.attributeCount).toBe(1);
    expect(s.withinSnap).toBe(1);
  });

  it('withinSnap < 1 when target far from source', () => {
    const source = singleTri();
    const target: MeshArrays = { positions: [100, 100, 100], indices: [0, 0, 0] };
    const colors: VertexAttribute = { name: 'color', kind: 'rgb', data: [1, 0, 0, 0, 1, 0, 0, 0, 1] };
    const r = transferAttributes(source, [colors], target);
    const s = summarize(r, 1);
    expect(s.withinSnap).toBe(0);
  });
});
