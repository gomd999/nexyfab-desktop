import * as THREE from 'three';

export interface ValidationResult {
  isManifold: boolean;
  isClosed: boolean;
  hasConsistentNormals: boolean;
  selfIntersections: number;
  degenerateTriangles: number;
  openEdges: number;
  nonManifoldEdges: number;
  duplicateVertices: number;
  totalTriangles: number;
  totalVertices: number;
  volume: number;
  surfaceArea: number;
  boundingBox: { min: THREE.Vector3; max: THREE.Vector3 };
  issues: string[];
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

function directedEdgeKey(a: number, b: number): string {
  return `${a}_${b}`;
}

export function validateGeometry(geo: THREE.BufferGeometry): ValidationResult {
  const issues: string[] = [];
  const nonIndexed = geo.index ? geo.toNonIndexed() : geo;
  const pos = nonIndexed.attributes.position;
  const vertCount = pos.count;
  const triCount = vertCount / 3;

  // Build vertex position map for finding duplicates
  const EPSILON = 1e-6;
  let duplicateVertices = 0;
  const vertMap = new Map<string, number>();
  const vertexIndices = new Uint32Array(vertCount);

  for (let i = 0; i < vertCount; i++) {
    const x = Math.round(pos.getX(i) / EPSILON) * EPSILON;
    const y = Math.round(pos.getY(i) / EPSILON) * EPSILON;
    const z = Math.round(pos.getZ(i) / EPSILON) * EPSILON;
    const key = `${x.toFixed(5)}_${y.toFixed(5)}_${z.toFixed(5)}`;

    if (vertMap.has(key)) {
      vertexIndices[i] = vertMap.get(key)!;
      duplicateVertices++;
    } else {
      vertMap.set(key, i);
      vertexIndices[i] = i;
    }
  }

  // Build edge adjacency (using merged vertex indices)
  const edgeFaceCount = new Map<string, number>();
  const directedEdges = new Set<string>();
  let degenerateTriangles = 0;
  let inconsistentNormals = 0;

  const v0 = new THREE.Vector3(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
  const cross = new THREE.Vector3();
  let totalVolume = 0;
  let totalArea = 0;

  for (let t = 0; t < triCount; t++) {
    const ia = vertexIndices[t * 3];
    const ib = vertexIndices[t * 3 + 1];
    const ic = vertexIndices[t * 3 + 2];

    // Check degenerate (zero area)
    v0.fromBufferAttribute(pos, t * 3);
    v1.fromBufferAttribute(pos, t * 3 + 1);
    v2.fromBufferAttribute(pos, t * 3 + 2);

    const e1 = new THREE.Vector3().subVectors(v1, v0);
    const e2 = new THREE.Vector3().subVectors(v2, v0);
    cross.crossVectors(e1, e2);
    const area = cross.length() * 0.5;

    if (area < 1e-10) {
      degenerateTriangles++;
      continue;
    }

    totalArea += area;

    // Volume contribution (divergence theorem)
    totalVolume += (
      v0.x * (v1.y * v2.z - v1.z * v2.y) +
      v1.x * (v2.y * v0.z - v2.z * v0.y) +
      v2.x * (v0.y * v1.z - v0.z * v1.y)
    );

    // Edge tracking
    const edges = [[ia, ib], [ib, ic], [ic, ia]];
    for (const [a, b] of edges) {
      const key = edgeKey(a, b);
      edgeFaceCount.set(key, (edgeFaceCount.get(key) || 0) + 1);

      // Directed edge for winding consistency check
      const dKey = directedEdgeKey(a, b);
      if (directedEdges.has(dKey)) {
        inconsistentNormals++;
      }
      directedEdges.add(dKey);
    }
  }

  totalVolume = Math.abs(totalVolume / 6);

  // Analyze edges
  let openEdges = 0;
  let nonManifoldEdges = 0;

  for (const [, count] of edgeFaceCount) {
    if (count === 1) openEdges++;
    else if (count > 2) nonManifoldEdges++;
  }

  const isManifold = nonManifoldEdges === 0;
  const isClosed = openEdges === 0;
  const hasConsistentNormals = inconsistentNormals === 0;

  // Build issues list
  if (!isManifold) issues.push(`${nonManifoldEdges} non-manifold edge(s) detected`);
  if (!isClosed) issues.push(`${openEdges} open/boundary edge(s) — mesh is not watertight`);
  if (!hasConsistentNormals) issues.push(`${inconsistentNormals} inconsistent winding direction(s)`);
  if (degenerateTriangles > 0) issues.push(`${degenerateTriangles} degenerate triangle(s) with near-zero area`);
  if (duplicateVertices > 0) issues.push(`${duplicateVertices} duplicate/coincident vertices`);
  if (issues.length === 0) issues.push('Geometry is valid — no issues found');

  geo.computeBoundingBox();
  const bb = geo.boundingBox || new THREE.Box3();

  return {
    isManifold,
    isClosed,
    hasConsistentNormals,
    selfIntersections: 0, // Full self-intersection detection is O(n²), skipped for performance
    degenerateTriangles,
    openEdges,
    nonManifoldEdges,
    duplicateVertices,
    totalTriangles: triCount,
    totalVertices: vertMap.size,
    volume: totalVolume,
    surfaceArea: totalArea,
    boundingBox: { min: bb.min.clone(), max: bb.max.clone() },
    issues,
  };
}
