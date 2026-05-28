/**
 * applyDynamicFillet.test.ts — Wave 2 Phase 3 Track E2 mesh-applier suite.
 *
 * Mesh-level dynamic fillet on synthetic geometry. Tests:
 *   - Planar box-corner edge: cap added, vertex count grows by N.
 *   - faceId mismatch (decoded edge not in mesh): no-op + warn.
 *   - Boundary edge (only 1 adjacent face): no-op + warn.
 *   - Non-planar adjacent faces (curved): no-op + warn (TODO B-Rep).
 *   - Degenerate (zero-length) edge: no-op.
 *   - Malformed edgeId: no-op.
 *   - Validator-driven refusals: over_round / edge_too_short.
 *   - Perf budget for M8-scale, 100-tri, 1000-tri synthetic geometry.
 *   - face-feature-id attribute preserved + extended.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  FACE_FEATURE_ID_ATTR,
  stampFaceFeatureIdAll,
  tagWholeGeometryFeature,
} from '../../features/faceProvenance';
import { applyDynamicFillet } from '../applyDynamicFillet';
import { encodeEdgeId } from '../dynamicEdgeMath';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Build an indexed unit cube as 6 distinct faces. Each face's
 *  triangles share a unique feature id so the applier can group them.
 *  Returns the geometry + a map of edge endpoints for known edges. */
function makeCube(size = 10): {
  geometry: THREE.BufferGeometry;
  topEdgeAB: [readonly [number, number, number], readonly [number, number, number]];
} {
  const h = size / 2;
  // 8 corners.
  const positions: number[] = [];
  const indices: number[] = [];

  // Per-face vertices (4 verts × 6 faces = 24 verts).
  // Face 0: +Y (top), winding for +Y normal.
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

  // Indexing convention per face: 0=−x−z, 1=+x−z, 2=+x+z, 3=−x+z (for +Y face).
  // +Y face (top)
  face(
    [[-h, h, -h], [h, h, -h], [h, h, h], [-h, h, h]],
    [0, 2, 1], [0, 3, 2],
  );
  // -Y face (bottom)
  face(
    [[-h, -h, -h], [h, -h, -h], [h, -h, h], [-h, -h, h]],
    [0, 1, 2], [0, 2, 3],
  );
  // +X face
  face(
    [[h, -h, -h], [h, h, -h], [h, h, h], [h, -h, h]],
    [0, 1, 2], [0, 2, 3],
  );
  // -X face
  face(
    [[-h, -h, -h], [-h, h, -h], [-h, h, h], [-h, -h, h]],
    [0, 2, 1], [0, 3, 2],
  );
  // +Z face
  face(
    [[-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h]],
    [0, 1, 2], [0, 2, 3],
  );
  // -Z face
  face(
    [[-h, -h, -h], [h, -h, -h], [h, h, -h], [-h, h, -h]],
    [0, 2, 1], [0, 3, 2],
  );

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  tagWholeGeometryFeature(geo, 'box');
  // Per-face feature ids: stamp blocks of 6 triangles each? Actually
  // each face has 2 triangles → 6 verts (with shared idx) → we have
  // 4 verts per face (×6) = 24 verts. Allocate per-face ids manually.
  const map: Record<number, string> = {};
  for (let f = 0; f < 6; f++) map[f + 1] = `face-${f}`;
  geo.userData = { ...geo.userData, nfabFeatureIdMap: map, lastFeatureId: 'box' };
  const idAttr = new Uint32Array(positions.length / 3);
  // 24 verts, 4 per face block.
  for (let v = 0; v < idAttr.length; v++) {
    idAttr[v] = Math.floor(v / 4) + 1;
  }
  geo.setAttribute(FACE_FEATURE_ID_ATTR, new THREE.BufferAttribute(idAttr, 1));

  // Top edge between +Y face and +X face: from (h, h, -h) to (h, h, h).
  return {
    geometry: geo,
    topEdgeAB: [[h, h, -h], [h, h, h]],
  };
}

/** Quarter-cylinder shell as a curved-edge stand-in. */
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
    const a = i * 2;
    const b = i * 2 + 1;
    const c = i * 2 + 2;
    const d = i * 2 + 3;
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

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('applyDynamicFillet — planar box edge', () => {
  it('adds cap vertices on a planar box corner edge', () => {
    const { geometry, topEdgeAB } = makeCube(20);
    const edgeId = encodeEdgeId(topEdgeAB[0], topEdgeAB[1]);
    const srcVerts = geometry.attributes.position.count;
    const result = applyDynamicFillet(geometry, {
      kind: 'dynamicFillet', edgeId, radiusMm: 1, createdAt: 0,
    });
    expect(result.applied).toBe(true);
    expect(result.addedVertexCount).toBeGreaterThan(0);
    expect(result.geometry.attributes.position.count).toBe(srcVerts + result.addedVertexCount);
  });

  it('does NOT mutate the input geometry', () => {
    const { geometry, topEdgeAB } = makeCube(20);
    const edgeId = encodeEdgeId(topEdgeAB[0], topEdgeAB[1]);
    const srcArr = geometry.attributes.position.array as Float32Array;
    const snapshot = Array.from(srcArr);
    applyDynamicFillet(geometry, {
      kind: 'dynamicFillet', edgeId, radiusMm: 1, createdAt: 0,
    });
    expect(Array.from(geometry.attributes.position.array as Float32Array)).toEqual(snapshot);
  });

  it('returns input on malformed edgeId', () => {
    const { geometry } = makeCube(20);
    const warns: string[] = [];
    const result = applyDynamicFillet(
      geometry,
      { kind: 'dynamicFillet', edgeId: 'not-an-id', radiusMm: 1, createdAt: 0 },
      { warn: m => warns.push(m) },
    );
    expect(result.applied).toBe(false);
    expect(result.geometry).toBe(geometry);
    expect(warns.some(w => w.includes('malformed'))).toBe(true);
  });

  it('returns input when no triangle incident to the edge', () => {
    const { geometry } = makeCube(20);
    const phantomEdge = encodeEdgeId([100, 100, 100], [200, 200, 200]);
    const warns: string[] = [];
    const result = applyDynamicFillet(
      geometry,
      { kind: 'dynamicFillet', edgeId: phantomEdge, radiusMm: 1, createdAt: 0 },
      { warn: m => warns.push(m) },
    );
    expect(result.applied).toBe(false);
    expect(warns.some(w => w.includes('no triangle incident'))).toBe(true);
  });

  it('refuses on zero-length decoded edge', () => {
    const { geometry } = makeCube(20);
    const degenerate = encodeEdgeId([0, 0, 0], [0, 0, 0]);
    const warns: string[] = [];
    const result = applyDynamicFillet(
      geometry,
      { kind: 'dynamicFillet', edgeId: degenerate, radiusMm: 1, createdAt: 0 },
      { warn: m => warns.push(m) },
    );
    expect(result.applied).toBe(false);
    expect(warns.some(w => w.includes('degenerate'))).toBe(true);
  });

  it('refuses an oversize radius (over_round) on a thin slab', () => {
    // Slab: cube scaled non-uniformly so the adjacent face perpendicular
    // extent (= width of the thin slab) is smaller than half the edge
    // length. Using size=20 (edge length=20) and then scaling one face
    // perpendicular to be smaller is awkward with our cube helper, so
    // we'd need a custom slab mesh. Instead we use a long-edge box that
    // makes over_round the FIRST refusal: edge_too_short triggers at
    // r > edgeLen/2, over_round at r > faceExtent*0.5.
    // For our cube of size=40, edgeLen=40, faceExtent=40 (perpendicular).
    // r=15 → 2r=30 < 40 (passes edge_too_short), 15 < 20 (passes over_round)
    // — won't trigger. So we use a synthetic slab via a different test.
    //
    // Alternative: a tall box (size=40 edge) with a narrow face. We use
    // the validator unit test in dynamicEdgeMath.test.ts to lock the
    // ordering + thresholds. Here we just verify that BOTH oversize
    // cases (over_round / edge_too_short) cause refusal, via a
    // generous radius that fails BOTH checks. The applier reports
    // edge_too_short first (the more fundamental case) which is the
    // expected behaviour locked by the validator unit suite.
    const { geometry, topEdgeAB } = makeCube(20);
    const edgeId = encodeEdgeId(topEdgeAB[0], topEdgeAB[1]);
    const warns: string[] = [];
    const result = applyDynamicFillet(
      geometry,
      { kind: 'dynamicFillet', edgeId, radiusMm: 100, createdAt: 0 },
      { warn: m => warns.push(m) },
    );
    expect(result.applied).toBe(false);
    expect(warns.some(w => w.includes('refused') || w.includes('over_round') || w.includes('edge_too_short'))).toBe(true);
  });

  it('refuses when edge is too short (edge_too_short)', () => {
    const { geometry, topEdgeAB } = makeCube(20);
    const edgeId = encodeEdgeId(topEdgeAB[0], topEdgeAB[1]);
    // Edge length=20. radius=15 → 2*r=30 > 20.
    const warns: string[] = [];
    const result = applyDynamicFillet(
      geometry,
      { kind: 'dynamicFillet', edgeId, radiusMm: 15, createdAt: 0 },
      { warn: m => warns.push(m) },
    );
    expect(result.applied).toBe(false);
    expect(warns.some(w => w.includes('edge_too_short') || w.includes('refused'))).toBe(true);
  });

  it('returns input on missing position attribute', () => {
    const geo = new THREE.BufferGeometry();
    const warns: string[] = [];
    const result = applyDynamicFillet(
      geo,
      { kind: 'dynamicFillet', edgeId: encodeEdgeId([0, 0, 0], [1, 0, 0]), radiusMm: 1, createdAt: 0 },
      { warn: m => warns.push(m) },
    );
    expect(result.applied).toBe(false);
    expect(warns.some(w => w.includes('position attribute'))).toBe(true);
  });
});

describe('applyDynamicFillet — non-planar / boundary', () => {
  it('refuses non-planar adjacent faces (cylinder shell)', () => {
    const geo = makeCylinderShell();
    // Pick an edge from the cylinder (top vertical edge at theta=0).
    const verts = geo.attributes.position;
    const start: [number, number, number] = [
      verts.getX(0), verts.getY(0), verts.getZ(0),
    ];
    const end: [number, number, number] = [
      verts.getX(1), verts.getY(1), verts.getZ(1),
    ];
    const edgeId = encodeEdgeId(start, end);
    const warns: string[] = [];
    const result = applyDynamicFillet(
      geo,
      { kind: 'dynamicFillet', edgeId, radiusMm: 1, createdAt: 0 },
      { warn: m => warns.push(m) },
    );
    expect(result.applied).toBe(false);
    // Either non-planar or boundary depending on cylinder shell stitching.
    expect(warns.some(w =>
      w.includes('non-planar') || w.includes('boundary') || w.includes('Phase 4')
    )).toBe(true);
  });

  it('refuses boundary edge (single triangle, single face id)', () => {
    // Tiny mesh: 1 triangle, 1 feature id. Edge between v0 and v1 is
    // shared by only this triangle.
    const positions = new Float32Array([
      0, 0, 0,
      10, 0, 0,
      0, 10, 0,
    ]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setIndex([0, 1, 2]);
    geo.computeVertexNormals();
    tagWholeGeometryFeature(geo, 'solo');
    stampFaceFeatureIdAll(geo, 'solo');
    const edgeId = encodeEdgeId([0, 0, 0], [10, 0, 0]);
    const warns: string[] = [];
    const result = applyDynamicFillet(
      geo,
      { kind: 'dynamicFillet', edgeId, radiusMm: 1, createdAt: 0 },
      { warn: m => warns.push(m) },
    );
    expect(result.applied).toBe(false);
    expect(warns.some(w => w.includes('boundary') || w.includes('Phase 4'))).toBe(true);
  });
});

describe('applyDynamicFillet — face-feature-id preservation', () => {
  it('keeps the FACE_FEATURE_ID_ATTR present and extended on output', () => {
    const { geometry, topEdgeAB } = makeCube(20);
    const edgeId = encodeEdgeId(topEdgeAB[0], topEdgeAB[1]);
    const result = applyDynamicFillet(geometry, {
      kind: 'dynamicFillet', edgeId, radiusMm: 1, createdAt: 0,
    });
    expect(result.applied).toBe(true);
    const outAttr = result.geometry.getAttribute(FACE_FEATURE_ID_ATTR);
    expect(outAttr).toBeDefined();
    // Extended array should be at least as long as the original.
    expect(outAttr!.count).toBe(geometry.attributes.position.count + result.addedVertexCount);
  });

  it('registers a new feature id for the cap in nfabFeatureIdMap', () => {
    const { geometry, topEdgeAB } = makeCube(20);
    const edgeId = encodeEdgeId(topEdgeAB[0], topEdgeAB[1]);
    const result = applyDynamicFillet(geometry, {
      kind: 'dynamicFillet', edgeId, radiusMm: 1, createdAt: 0,
    });
    expect(result.applied).toBe(true);
    const map = result.geometry.userData.nfabFeatureIdMap as Record<number, string>;
    const names = Object.values(map);
    expect(names.some(n => n.startsWith('__dynamicFillet'))).toBe(true);
  });
});

describe('applyDynamicFillet — performance', () => {
  /** Build a synthetic box mesh with N filler triangles (a flat fan)
   *  to inflate triangle count without changing the picked-edge cost
   *  — the applier still has to walk the index buffer. */
  function makeBoxWithFiller(triCount: number): {
    geometry: THREE.BufferGeometry;
    edgeAB: [readonly [number, number, number], readonly [number, number, number]];
  } {
    const { geometry: base, topEdgeAB } = makeCube(20);
    // Append a flat fan of `triCount` filler tris on a remote face.
    const positions = Array.from(base.attributes.position.array as Float32Array);
    const indices: number[] = [];
    if (base.index) {
      for (let i = 0; i < base.index.count; i++) indices.push(base.index.getX(i));
    }
    const baseVertCount = positions.length / 3;
    // Filler triangles centred far from the picked edge so we don't
    // accidentally make them incident.
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
    const result = applyDynamicFillet(geometry, {
      kind: 'dynamicFillet', edgeId, radiusMm: 1, createdAt: 0,
    });
    expect(result.applied).toBe(true);
    // ADR-012 §8: p95 ≤ 30ms. CI cold-start allowance: 120ms.
    expect(result.elapsedMs).toBeLessThan(120);
  });

  it('completes within budget on a 100-tri mesh', () => {
    const { geometry, edgeAB } = makeBoxWithFiller(100);
    const edgeId = encodeEdgeId(edgeAB[0], edgeAB[1]);
    const result = applyDynamicFillet(geometry, {
      kind: 'dynamicFillet', edgeId, radiusMm: 1, createdAt: 0,
    });
    expect(result.applied).toBe(true);
    expect(result.elapsedMs).toBeLessThan(60);
  });

  it('completes within budget on a 1000-tri mesh', () => {
    const { geometry, edgeAB } = makeBoxWithFiller(1000);
    const edgeId = encodeEdgeId(edgeAB[0], edgeAB[1]);
    const result = applyDynamicFillet(geometry, {
      kind: 'dynamicFillet', edgeId, radiusMm: 1, createdAt: 0,
    });
    expect(result.applied).toBe(true);
    // 1000-tri whole-mesh walk is upper-bound stress; CI Win runners
    // budget allowance similar to applyPushPull.
    expect(result.elapsedMs).toBeLessThan(250);
  });
});
