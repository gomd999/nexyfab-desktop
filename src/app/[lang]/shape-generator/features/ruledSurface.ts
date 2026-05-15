// Ruled surface — linearly interpolate between two 3D curves to produce a
// quad-mesh surface. Foundational primitive for the surface-modeling
// toolkit alongside the existing boundarySurface + nurbsSurface modules.

import * as THREE from 'three';

export interface RuledSurfaceParams {
  /** First boundary polyline (any number of points, >= 2). */
  curveA: THREE.Vector3[];
  /** Second boundary polyline. Must have the same point count as curveA. */
  curveB: THREE.Vector3[];
  /** Optional refinement along the v (between-curves) axis. */
  vSegments?: number;
}

export function createRuledSurface(params: RuledSurfaceParams): THREE.BufferGeometry {
  const { curveA, curveB, vSegments = 1 } = params;
  if (curveA.length < 2 || curveA.length !== curveB.length) {
    throw new Error('Ruled surface requires two polylines of identical length, >= 2 points each');
  }
  const u = curveA.length;
  const v = Math.max(2, vSegments + 1);
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  // Generate the (u × v) grid of vertices.
  for (let j = 0; j < v; j++) {
    const t = j / (v - 1);
    for (let i = 0; i < u; i++) {
      const a = curveA[i];
      const b = curveB[i];
      positions.push(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
      normals.push(0, 0, 0); // computed below
    }
  }
  // Index the quads as two triangles each.
  for (let j = 0; j < v - 1; j++) {
    for (let i = 0; i < u - 1; i++) {
      const a = j * u + i;
      const b = a + 1;
      const c = a + u;
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Offset a surface by a constant distance along its vertex normals. Useful
 * for creating thickened "skin" surfaces. Does NOT prevent self-intersections
 * on tight curvatures — caller should validate with bounding-box analysis.
 */
export function offsetSurface(source: THREE.BufferGeometry, distance: number): THREE.BufferGeometry {
  const src = source.clone();
  src.computeVertexNormals();
  const pos = src.getAttribute('position') as THREE.BufferAttribute;
  const nor = src.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + nor.getX(i) * distance;
    const y = pos.getY(i) + nor.getY(i) * distance;
    const z = pos.getZ(i) + nor.getZ(i) * distance;
    pos.setXYZ(i, x, y, z);
  }
  pos.needsUpdate = true;
  src.computeVertexNormals();
  src.computeBoundingBox();
  src.computeBoundingSphere();
  return src;
}
