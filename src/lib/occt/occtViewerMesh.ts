/**
 * occtViewerMesh — OCCT B-rep → renderable buffers for a 3D viewer (K6 of
 * ADR-014).
 *
 * Reuses the K5 tessellation core (tessellateToPolyhedron) and packs it into the
 * three buffers a viewer needs:
 *   - flat-shaded triangle soup (positions + per-face normals) for the solid,
 *   - feature-edge line segments (sharp / boundary edges only — the same
 *     dihedral threshold projectView uses, so curved faces don't show their
 *     tessellation seams) for the black "edge overlay" CAD look,
 *   - a bounding sphere/box for camera framing.
 * Buffers are plain number[] (flat XYZ); the caller wraps them in a
 * THREE.BufferAttribute. The packing helpers are pure + unit-tested; only the
 * top-level convenience that meshes a live shape touches OCCT.
 */

import type { Polyhedron } from '@/lib/cad/featureMesh';
import { polyhedronEdges } from '@/lib/cad/featureMesh';
import { dot } from '@/lib/sketch/sketchPlane';
import type { OcctModule } from './nodeOcctLoader';
import { tessellateToPolyhedron } from './occtTessellate';

export interface MeshBuffers {
  /** Flat XYZ triangle vertices (length = 9 × triangleCount). */
  positions: number[];
  /** Flat XYZ per-vertex normals (flat-shaded → same normal across a triangle). */
  normals: number[];
  triangleCount: number;
}

export interface ViewerMesh extends MeshBuffers {
  /** Flat XYZ endpoint pairs of feature edges (length = 6 × edgeCount). */
  edges: number[];
  edgeCount: number;
  bounds: { center: [number, number, number]; size: [number, number, number]; radius: number };
}

/** Flat-shaded triangle soup. Triangular faces only (tessellation output). */
export function polyhedronToMesh(poly: Polyhedron): MeshBuffers {
  const positions: number[] = [];
  const normals: number[] = [];
  let triangleCount = 0;
  for (const f of poly.faces) {
    if (f.vertices.length !== 3) continue; // tessellation is all triangles
    const [a, b, c] = f.vertices;
    for (const vi of [a, b, c]) {
      const v = poly.vertices[vi];
      positions.push(v.x, v.y, v.z);
      normals.push(f.normal.x, f.normal.y, f.normal.z);
    }
    triangleCount++;
  }
  return { positions, normals, triangleCount };
}

/**
 * Feature-edge line segments: boundary edges plus manifold edges whose adjacent
 * faces meet at more than `angleDeg` (so flat-face seams and smooth curved-face
 * facets are dropped, sharp creases + silhouette-defining edges kept).
 */
export function polyhedronFeatureEdges(poly: Polyhedron, angleDeg = 25): number[] {
  const cos = Math.cos((angleDeg * Math.PI) / 180);
  const out: number[] = [];
  for (const e of polyhedronEdges(poly)) {
    let keep = true;
    if (e.faces.length === 2) {
      keep = dot(poly.faces[e.faces[0]].normal, poly.faces[e.faces[1]].normal) < cos;
    }
    if (!keep) continue;
    const a = poly.vertices[e.a];
    const b = poly.vertices[e.b];
    out.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }
  return out;
}

/** Axis-aligned bounds + framing sphere for the camera. */
export function meshBounds(poly: Polyhedron): ViewerMesh['bounds'] {
  if (poly.vertices.length === 0) {
    return { center: [0, 0, 0], size: [0, 0, 0], radius: 0 };
  }
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const v of poly.vertices) {
    minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
    minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
    minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z);
  }
  const center: [number, number, number] = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
  const size: [number, number, number] = [maxX - minX, maxY - minY, maxZ - minZ];
  const radius = 0.5 * Math.hypot(size[0], size[1], size[2]);
  return { center, size, radius };
}

/** Mesh a live OCCT shape into full viewer buffers. */
export function tessellateToMesh(oc: OcctModule, shape: unknown, deflection = 0.1): ViewerMesh {
  const poly = tessellateToPolyhedron(oc, shape, deflection);
  const mesh = polyhedronToMesh(poly);
  const edges = polyhedronFeatureEdges(poly);
  return { ...mesh, edges, edgeCount: edges.length / 6, bounds: meshBounds(poly) };
}
