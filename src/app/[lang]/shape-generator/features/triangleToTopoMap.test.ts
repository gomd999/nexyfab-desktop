import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  TriangleTopoMapBuilder,
  attachTopoMap,
  topoHashForTriangle,
  trianglesForTopoHash,
  permuteTopoMap,
  clustersFromTopoMap,
  recordSweptFace,
  recordCap,
} from './triangleToTopoMap';

describe('TriangleTopoMapBuilder', () => {
  it('records single triangle with new hash', () => {
    const b = new TriangleTopoMapBuilder();
    b.recordTriangle('ext1_sweep_seg0');
    expect(b.triangleCount).toBe(1);
    expect(b.uniqueHashCount).toBe(1);
  });

  it('de-dupes repeated hashes (same key)', () => {
    const b = new TriangleTopoMapBuilder();
    b.recordTriangle('ext1_sweep_seg0');
    b.recordTriangle('ext1_sweep_seg0');
    b.recordTriangle('ext1_cap_top');
    expect(b.triangleCount).toBe(3);
    expect(b.uniqueHashCount).toBe(2);
  });

  it('recordTriangleRange = N copies of same hash', () => {
    const b = new TriangleTopoMapBuilder();
    b.recordTriangleRange('ext1_cap_top', 5);
    expect(b.triangleCount).toBe(5);
    expect(b.uniqueHashCount).toBe(1);
  });

  it('build returns triangleToKey + reverse keyToTriangles', () => {
    const b = new TriangleTopoMapBuilder();
    b.recordTriangle('A');
    b.recordTriangle('B');
    b.recordTriangle('A');
    const m = b.build();
    expect(m.triangleToKey.length).toBe(3);
    expect(m.keyToHash).toEqual(['A', 'B']);
    expect(m.keyToTriangles[0]).toEqual([0, 2]);
    expect(m.keyToTriangles[1]).toEqual([1]);
  });
});

describe('attach + lookup', () => {
  it('topoHashForTriangle returns recorded hash', () => {
    const b = new TriangleTopoMapBuilder();
    b.recordTriangle('A');
    b.recordTriangle('B');
    const geo = new THREE.BufferGeometry();
    attachTopoMap(geo, b.build());
    expect(topoHashForTriangle(geo, 0)).toBe('A');
    expect(topoHashForTriangle(geo, 1)).toBe('B');
  });

  it('out-of-range index → null', () => {
    const b = new TriangleTopoMapBuilder();
    b.recordTriangle('A');
    const geo = new THREE.BufferGeometry();
    attachTopoMap(geo, b.build());
    expect(topoHashForTriangle(geo, 99)).toBeNull();
    expect(topoHashForTriangle(geo, -1)).toBeNull();
  });

  it('no map attached → null', () => {
    const geo = new THREE.BufferGeometry();
    expect(topoHashForTriangle(geo, 0)).toBeNull();
  });

  it('trianglesForTopoHash returns all matches', () => {
    const b = new TriangleTopoMapBuilder();
    b.recordTriangleRange('A', 3);
    b.recordTriangle('B');
    b.recordTriangle('A');
    const geo = new THREE.BufferGeometry();
    attachTopoMap(geo, b.build());
    expect(trianglesForTopoHash(geo, 'A')).toEqual([0, 1, 2, 4]);
    expect(trianglesForTopoHash(geo, 'B')).toEqual([3]);
  });

  it('unknown hash → empty array', () => {
    const b = new TriangleTopoMapBuilder();
    b.recordTriangle('A');
    const geo = new THREE.BufferGeometry();
    attachTopoMap(geo, b.build());
    expect(trianglesForTopoHash(geo, 'nope')).toEqual([]);
  });
});

describe('permuteTopoMap', () => {
  it('preserves triangle hashes across permutation', () => {
    const b = new TriangleTopoMapBuilder();
    b.recordTriangle('A'); // tri 0
    b.recordTriangle('B'); // tri 1
    b.recordTriangle('C'); // tri 2
    const m = b.build();
    // Permutation: new[0] = old[2], new[1] = old[0], new[2] = old[1].
    const p = permuteTopoMap(m, [2, 0, 1]);
    expect(p.keyToHash[p.triangleToKey[0]!]).toBe('C');
    expect(p.keyToHash[p.triangleToKey[1]!]).toBe('A');
    expect(p.keyToHash[p.triangleToKey[2]!]).toBe('B');
  });

  it('rebuilds reverse keyToTriangles after permutation', () => {
    const b = new TriangleTopoMapBuilder();
    b.recordTriangleRange('A', 2);
    b.recordTriangle('B');
    const m = b.build();
    const p = permuteTopoMap(m, [2, 1, 0]);
    expect(p.keyToTriangles[0]?.sort()).toEqual([1, 2]); // 'A' tris
    expect(p.keyToTriangles[1]).toEqual([0]); // 'B'
  });
});

describe('clustersFromTopoMap', () => {
  it('groups triangles by hash', () => {
    const b = new TriangleTopoMapBuilder();
    b.recordTriangleRange('cap_top', 3);
    b.recordTriangleRange('cap_bottom', 3);
    b.recordTriangleRange('sweep_seg0', 4);
    const clusters = clustersFromTopoMap(b.build());
    expect(clusters).toHaveLength(3);
    const sweep = clusters.find(c => c.hash === 'sweep_seg0');
    expect(sweep?.triangleIndices.length).toBe(4);
  });

  it('excludes empty clusters', () => {
    // Manually craft a map with an empty cluster (shouldn't happen in
    // practice but the function should still filter it).
    const map = {
      triangleToKey: new Uint32Array([0, 0]),
      keyToHash: ['A', 'B'],
      keyToTriangles: [[0, 1], []],
    };
    expect(clustersFromTopoMap(map).map(c => c.hash)).toEqual(['A']);
  });
});

describe('recordSweptFace + recordCap', () => {
  it('swept face emits 2N triangles for N quads', () => {
    const b = new TriangleTopoMapBuilder();
    recordSweptFace(b, 'ext1', 'seg0', 5); // 5 quads → 10 tris
    const m = b.build();
    expect(m.triangleToKey.length).toBe(10);
    expect(m.keyToHash[0]).toBe('ext1_sweep_seg0');
  });

  it('cap with given triangle count', () => {
    const b = new TriangleTopoMapBuilder();
    recordCap(b, 'ext1', 'top', 8);
    const m = b.build();
    expect(m.triangleToKey.length).toBe(8);
    expect(m.keyToHash[0]).toBe('ext1_cap_top');
  });

  it('mixed swept + caps produce distinct hashes', () => {
    const b = new TriangleTopoMapBuilder();
    recordCap(b, 'ext1', 'bottom', 4);
    recordSweptFace(b, 'ext1', 'seg0', 3);
    recordSweptFace(b, 'ext1', 'seg1', 3);
    recordCap(b, 'ext1', 'top', 4);
    const m = b.build();
    expect(m.keyToHash).toHaveLength(4);
    expect(m.triangleToKey.length).toBe(4 + 6 + 6 + 4);
  });
});
