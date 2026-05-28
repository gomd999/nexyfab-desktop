/**
 * applyDynamicChamfer.test.ts — Wave 2 Phase 3 Track E2 mesh-applier suite.
 *
 * Mesh-level dynamic chamfer on synthetic geometry. Tests:
 *   - Planar box-corner edge: chamfer adds 4 vertices.
 *   - Malformed edgeId: no-op.
 *   - Phantom edgeId (not in mesh): no-op.
 *   - Boundary edge: no-op.
 *   - Non-planar adjacent faces: no-op.
 *   - Validator-driven refusals: distance ≥ edge length, over_chamfer.
 *   - Perf budget for M8-scale and 1000-tri meshes.
 *   - face-feature-id preservation + new id registered.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  FACE_FEATURE_ID_ATTR,
  stampFaceFeatureIdAll,
  tagWholeGeometryFeature,
} from '../../features/faceProvenance';
import { applyDynamicChamfer } from '../applyDynamicChamfer';
import { encodeEdgeId } from '../dynamicEdgeMath';

function makeCube(size = 10): {
  geometry: THREE.BufferGeometry;
  topEdgeAB: [readonly [number, number, number], readonly [number, number, number]];
} {
  const h = size / 2;
  const positions: number[] = [];
  const indices: number[] = [];

  const face = (
    pts: Array<[number, number, number]>,
    triA: [number, number, number],
    triB: [number, number, number],
  ): void => {
    const base = positions.length / 3;
    for (const p of pts) positions.push(...p);
    indices.push(base + triA[0], base + triA[1], base + triA[2]);
    indices.push(base + triB[0], base + triB[1], base + triB[2]);
  };

  face([[-h, h, -h], [h, h, -h], [h, h, h], [-h, h, h]], [0, 2, 1], [0, 3, 2]);
  face([[-h, -h, -h], [h, -h, -h], [h, -h, h], [-h, -h, h]], [0, 1, 2], [0, 2, 3]);
  face([[h, -h, -h], [h, h, -h], [h, h, h], [h, -h, h]], [0, 1, 2], [0, 2, 3]);
  face([[-h, -h, -h], [-h, h, -h], [-h, h, h], [-h, -h, h]], [0, 2, 1], [0, 3, 2]);
  face([[-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h]], [0, 1, 2], [0, 2, 3]);
  face([[-h, -h, -h], [h, -h, -h], [h, h, -h], [-h, h, -h]], [0, 2, 1], [0, 3, 2]);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  tagWholeGeometryFeature(geo, 'box');
  const map: Record<number, string> = {};
  for (let f = 0; f < 6; f++) map[f + 1] = `face-${f}`;
  geo.userData = { ...geo.userData, nfabFeatureIdMap: map, lastFeatureId: 'box' };
  const idAttr = new Uint32Array(positions.length / 3);
  for (let v = 0; v < idAttr.length; v++) idAttr[v] = Math.floor(v / 4) + 1;
  geo.setAttribute(FACE_FEATURE_ID_ATTR, new THREE.BufferAttribute(idAttr, 1));
  return { geometry: geo, topEdgeAB: [[h, h, -h], [h, h, h]] };
}

function makeCylinderShell(radius = 10, height = 20, segments = 16): THREE.BufferGeometry {
  const verts: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const theta = (i / segments) * (Math.PI / 2);
    const x = Math.cos(theta) * radius;
    const z = Math.sin(theta) * radius;
    verts.push(x, 0, z);
    verts.push(x, height, z);
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
    indices.push(a, c, d);
    indices.push(a, d, b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  tagWholeGeometryFeature(geo, 'shell');
  return geo;
}

describe('applyDynamicChamfer — planar box edge', () => {
  it('adds 4 cap vertices on a planar box corner edge', () => {
    const { geometry, topEdgeAB } = makeCube(20);
    const edgeId = encodeEdgeId(topEdgeAB[0], topEdgeAB[1]);
    const srcVerts = geometry.attributes.position.count;
    const result = applyDynamicChamfer(geometry, {
      kind: 'dynamicChamfer', edgeId, distanceMm: 1, createdAt: 0,
    });
    expect(result.applied).toBe(true);
    expect(result.addedVertexCount).toBe(4);
    expect(result.geometry.attributes.position.count).toBe(srcVerts + 4);
  });

  it('does NOT mutate the input geometry', () => {
    const { geometry, topEdgeAB } = makeCube(20);
    const edgeId = encodeEdgeId(topEdgeAB[0], topEdgeAB[1]);
    const snapshot = Array.from(geometry.attributes.position.array as Float32Array);
    applyDynamicChamfer(geometry, {
      kind: 'dynamicChamfer', edgeId, distanceMm: 1, createdAt: 0,
    });
    expect(Array.from(geometry.attributes.position.array as Float32Array)).toEqual(snapshot);
  });

  it('returns input on malformed edgeId', () => {
    const { geometry } = makeCube(20);
    const warns: string[] = [];
    const result = applyDynamicChamfer(
      geometry,
      { kind: 'dynamicChamfer', edgeId: 'not-an-id', distanceMm: 1, createdAt: 0 },
      { warn: m => warns.push(m) },
    );
    expect(result.applied).toBe(false);
    expect(warns.some(w => w.includes('malformed'))).toBe(true);
  });

  it('returns input when no triangle incident to edge', () => {
    const { geometry } = makeCube(20);
    const phantom = encodeEdgeId([999, 999, 999], [888, 888, 888]);
    const result = applyDynamicChamfer(geometry, {
      kind: 'dynamicChamfer', edgeId: phantom, distanceMm: 1, createdAt: 0,
    });
    expect(result.applied).toBe(false);
  });

  it('refuses distance exceeding edge length', () => {
    const { geometry, topEdgeAB } = makeCube(20);
    const edgeId = encodeEdgeId(topEdgeAB[0], topEdgeAB[1]);
    // Edge length=20, distance=25.
    const warns: string[] = [];
    const result = applyDynamicChamfer(
      geometry,
      { kind: 'dynamicChamfer', edgeId, distanceMm: 25, createdAt: 0 },
      { warn: m => warns.push(m) },
    );
    expect(result.applied).toBe(false);
    expect(warns.some(w =>
      w.includes('distance_exceeds_edge') || w.includes('refused'),
    )).toBe(true);
  });

  it('returns input on missing position attribute', () => {
    const geo = new THREE.BufferGeometry();
    const result = applyDynamicChamfer(geo, {
      kind: 'dynamicChamfer',
      edgeId: encodeEdgeId([0, 0, 0], [1, 0, 0]),
      distanceMm: 1, createdAt: 0,
    });
    expect(result.applied).toBe(false);
  });
});

describe('applyDynamicChamfer — non-planar / boundary', () => {
  it('refuses non-planar adjacent faces (cylinder shell)', () => {
    const geo = makeCylinderShell();
    const verts = geo.attributes.position;
    const start: [number, number, number] = [
      verts.getX(0), verts.getY(0), verts.getZ(0),
    ];
    const end: [number, number, number] = [
      verts.getX(1), verts.getY(1), verts.getZ(1),
    ];
    const edgeId = encodeEdgeId(start, end);
    const warns: string[] = [];
    const result = applyDynamicChamfer(
      geo,
      { kind: 'dynamicChamfer', edgeId, distanceMm: 1, createdAt: 0 },
      { warn: m => warns.push(m) },
    );
    expect(result.applied).toBe(false);
    expect(warns.some(w =>
      w.includes('non-planar') || w.includes('boundary') || w.includes('Phase 4'),
    )).toBe(true);
  });

  it('refuses boundary edge (single triangle)', () => {
    const positions = new Float32Array([
      0, 0, 0, 10, 0, 0, 0, 10, 0,
    ]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setIndex([0, 1, 2]);
    geo.computeVertexNormals();
    tagWholeGeometryFeature(geo, 'solo');
    stampFaceFeatureIdAll(geo, 'solo');
    const edgeId = encodeEdgeId([0, 0, 0], [10, 0, 0]);
    const warns: string[] = [];
    const result = applyDynamicChamfer(
      geo,
      { kind: 'dynamicChamfer', edgeId, distanceMm: 1, createdAt: 0 },
      { warn: m => warns.push(m) },
    );
    expect(result.applied).toBe(false);
    expect(warns.some(w => w.includes('boundary') || w.includes('Phase 4'))).toBe(true);
  });
});

describe('applyDynamicChamfer — face-feature-id', () => {
  it('extends the FACE_FEATURE_ID_ATTR and adds a new map entry', () => {
    const { geometry, topEdgeAB } = makeCube(20);
    const edgeId = encodeEdgeId(topEdgeAB[0], topEdgeAB[1]);
    const result = applyDynamicChamfer(geometry, {
      kind: 'dynamicChamfer', edgeId, distanceMm: 1, createdAt: 0,
    });
    expect(result.applied).toBe(true);
    const outAttr = result.geometry.getAttribute(FACE_FEATURE_ID_ATTR);
    expect(outAttr).toBeDefined();
    expect(outAttr!.count).toBe(geometry.attributes.position.count + 4);
    const map = result.geometry.userData.nfabFeatureIdMap as Record<number, string>;
    expect(Object.values(map).some(n => n.startsWith('__dynamicChamfer'))).toBe(true);
  });
});

describe('applyDynamicChamfer — performance', () => {
  function makeBoxWithFiller(triCount: number): {
    geometry: THREE.BufferGeometry;
    edgeAB: [readonly [number, number, number], readonly [number, number, number]];
  } {
    const { geometry: base, topEdgeAB } = makeCube(20);
    const positions = Array.from(base.attributes.position.array as Float32Array);
    const indices: number[] = [];
    if (base.index) for (let i = 0; i < base.index.count; i++) indices.push(base.index.getX(i));
    const baseVertCount = positions.length / 3;
    positions.push(-50, -50, -50);
    for (let i = 0; i <= triCount; i++) {
      const a = (i / triCount) * Math.PI * 2;
      positions.push(-50 + Math.cos(a), -50, -50 + Math.sin(a));
    }
    for (let i = 0; i < triCount; i++) {
      indices.push(baseVertCount, baseVertCount + 1 + i, baseVertCount + 2 + i);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    geo.userData = { ...base.userData };
    if (base.getAttribute(FACE_FEATURE_ID_ATTR)) {
      const src = base.getAttribute(FACE_FEATURE_ID_ATTR) as THREE.BufferAttribute;
      const extra = new Uint32Array(positions.length / 3);
      extra.set(src.array as Uint32Array);
      geo.setAttribute(FACE_FEATURE_ID_ATTR, new THREE.BufferAttribute(extra, 1));
    }
    return { geometry: geo, edgeAB: topEdgeAB };
  }

  it('completes within budget on a typical M8-scale mesh (~500 tris)', () => {
    const { geometry, edgeAB } = makeBoxWithFiller(500);
    const edgeId = encodeEdgeId(edgeAB[0], edgeAB[1]);
    const result = applyDynamicChamfer(geometry, {
      kind: 'dynamicChamfer', edgeId, distanceMm: 1, createdAt: 0,
    });
    expect(result.applied).toBe(true);
    expect(result.elapsedMs).toBeLessThan(120);
  });

  it('completes within budget on a 100-tri mesh', () => {
    const { geometry, edgeAB } = makeBoxWithFiller(100);
    const edgeId = encodeEdgeId(edgeAB[0], edgeAB[1]);
    const result = applyDynamicChamfer(geometry, {
      kind: 'dynamicChamfer', edgeId, distanceMm: 1, createdAt: 0,
    });
    expect(result.applied).toBe(true);
    expect(result.elapsedMs).toBeLessThan(60);
  });

  it('completes within budget on a 1000-tri mesh', () => {
    const { geometry, edgeAB } = makeBoxWithFiller(1000);
    const edgeId = encodeEdgeId(edgeAB[0], edgeAB[1]);
    const result = applyDynamicChamfer(geometry, {
      kind: 'dynamicChamfer', edgeId, distanceMm: 1, createdAt: 0,
    });
    expect(result.applied).toBe(true);
    expect(result.elapsedMs).toBeLessThan(250);
  });
});
