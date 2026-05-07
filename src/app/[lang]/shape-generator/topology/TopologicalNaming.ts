/**
 * Topological Naming System for Nexyfab CAD
 *
 * Problem: When a parametric model is modified (e.g. box width changes), the
 * mesh is fully rebuilt and all face/edge indices shift. Any feature (fillet,
 * hole, chamfer) that referenced face #3 now references the wrong face.
 *
 * Solution: Assign *stable* string IDs to every face/edge based on its
 * geometric signature (normal direction, centroid position, area) rather than
 * its array index. When the mesh is rebuilt, the system matches new faces to
 * old IDs by signature similarity, so downstream features keep working.
 *
 * Architecture:
 *  - `TopologicalRegistry` : tracks face/edge stable IDs across rebuilds
 *  - `computeFaceSignature` : geometric fingerprint for a triangulated face group
 *  - `assignStableIds`     : label all faces on a new geometry using signatures
 *  - `resolveStableId`     : given a stable ID → current mesh face index
 *  - `TopologicalMap`      : serializable mapping used in FeatureInstance/HistoryNode
 */

import * as THREE from 'three';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FaceSignature {
  /** Dominant normal (unit vector, rounded to 4 dp) */
  normal: [number, number, number];
  /** Centroid of the face group (mm, rounded to 2 dp) */
  centroid: [number, number, number];
  /** Surface area (mm², rounded to 1 dp) */
  area: number;
  /** Number of triangles in this face group */
  triCount: number;
}

export interface StableFace {
  /** Persistent ID that survives parametric rebuilds */
  stableId: string;
  /** Face group index in the current geometry (changes on rebuild) */
  faceIndex: number;
  /** Geometric signature used for matching */
  signature: FaceSignature;
  /** Feature node id that created this face (for history tracking) */
  originFeatureId?: string;
  /** Human-readable tag derived from geometry role */
  tag?: string;
}

export interface TopologicalMap {
  /** stableId → StableFace */
  faces: Record<string, StableFace>;
  /** stableId → faceIndex (reverse lookup) */
  indexToStable: Record<number, string>;
  /** Generation counter — increments on each rebuild */
  generation: number;
  /** Build timestamp */
  builtAt: number;
}

// ─── Signature computation ─────────────────────────────────────────────────────

const R2 = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;
const R4 = (n: number) => R2(n, 4);

/**
 * Groups triangles by their face normal (within a tolerance) and computes a
 * geometric signature for each planar region.
 */
export function computeFaceGroups(geo: THREE.BufferGeometry): FaceSignature[] {
  const posAttr = geo.getAttribute('position');
  const normAttr = geo.getAttribute('normal');
  if (!posAttr || !normAttr) return [];

  const NORMAL_TOL = 0.02; // dot product tolerance for normal grouping
  const groups: { normal: THREE.Vector3; verts: THREE.Vector3[]; area: number }[] = [];

  const p0 = new THREE.Vector3();
  const p1 = new THREE.Vector3();
  const p2 = new THREE.Vector3();
  const n0 = new THREE.Vector3();
  const edge1 = new THREE.Vector3();
  const edge2 = new THREE.Vector3();
  const cross = new THREE.Vector3();

  const indexAttr = geo.getIndex();
  const triCount = indexAttr ? indexAttr.count / 3 : posAttr.count / 3;

  for (let t = 0; t < triCount; t++) {
    let i0: number, i1: number, i2: number;
    if (indexAttr) {
      i0 = indexAttr.getX(t * 3);
      i1 = indexAttr.getX(t * 3 + 1);
      i2 = indexAttr.getX(t * 3 + 2);
    } else {
      i0 = t * 3; i1 = t * 3 + 1; i2 = t * 3 + 2;
    }

    p0.fromBufferAttribute(posAttr, i0);
    p1.fromBufferAttribute(posAttr, i1);
    p2.fromBufferAttribute(posAttr, i2);

    // Average normal from vertex normals
    n0.fromBufferAttribute(normAttr, i0);
    const n1 = new THREE.Vector3().fromBufferAttribute(normAttr, i1);
    const n2 = new THREE.Vector3().fromBufferAttribute(normAttr, i2);
    n0.add(n1).add(n2).normalize();

    // Triangle area
    edge1.subVectors(p1, p0);
    edge2.subVectors(p2, p0);
    cross.crossVectors(edge1, edge2);
    const area = cross.length() * 0.5;

    // Centroid
    const cx = (p0.x + p1.x + p2.x) / 3;
    const cy = (p0.y + p1.y + p2.y) / 3;
    const cz = (p0.z + p1.z + p2.z) / 3;

    // Find matching group or create new one
    let matched = false;
    for (const g of groups) {
      if (g.normal.dot(n0) > 1 - NORMAL_TOL) {
        g.verts.push(new THREE.Vector3(cx, cy, cz));
        g.area += area;
        matched = true;
        break;
      }
    }
    if (!matched) {
      groups.push({
        normal: n0.clone(),
        verts: [new THREE.Vector3(cx, cy, cz)],
        area,
      });
    }
  }

  return groups.map(g => {
    const centroid = g.verts.reduce(
      (acc, v) => ({ x: acc.x + v.x, y: acc.y + v.y, z: acc.z + v.z }),
      { x: 0, y: 0, z: 0 }
    );
    const n = g.verts.length;
    return {
      normal: [R4(g.normal.x), R4(g.normal.y), R4(g.normal.z)],
      centroid: [R2(centroid.x / n), R2(centroid.y / n), R2(centroid.z / n)],
      area: R2(g.area, 1),
      triCount: g.verts.length,
    };
  });
}

// ─── ID generation ────────────────────────────────────────────────────────────

let _counter = 0;
function genStableId(prefix = 'f'): string {
  return `${prefix}-${Date.now().toString(36)}-${(++_counter).toString(36)}`;
}

/** Short human-readable tag derived from the face normal */
function tagFromNormal(n: [number, number, number]): string {
  const [x, y, z] = n;
  const abs = [Math.abs(x), Math.abs(y), Math.abs(z)];
  const max = Math.max(...abs);
  if (abs[0] === max) return x > 0 ? 'right' : 'left';
  if (abs[1] === max) return y > 0 ? 'top' : 'bottom';
  return z > 0 ? 'front' : 'back';
}

// ─── Signature matching ───────────────────────────────────────────────────────

/** Score how closely two signatures match (0–1, higher = better match) */
function matchScore(a: FaceSignature, b: FaceSignature): number {
  // Normal similarity (dot product of unit vectors)
  const normalDot =
    a.normal[0] * b.normal[0] +
    a.normal[1] * b.normal[1] +
    a.normal[2] * b.normal[2];
  if (normalDot < 0.9) return 0; // Different face orientation — no match

  // Relative area change score (penalise big area changes)
  const areaRatio = a.area === 0 ? 0 : Math.min(a.area, b.area) / Math.max(a.area, b.area);

  // Centroid proximity (in mm). Normalise by diagonal of bbox estimate
  const dx = a.centroid[0] - b.centroid[0];
  const dy = a.centroid[1] - b.centroid[1];
  const dz = a.centroid[2] - b.centroid[2];
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const centroidScore = 1 / (1 + dist * 0.05);

  return normalDot * 0.5 + areaRatio * 0.3 + centroidScore * 0.2;
}

// ─── Main API ─────────────────────────────────────────────────────────────────

/**
 * Build a TopologicalMap for a geometry.
 * If a previous map is provided, stable IDs are matched from it using signature
 * similarity so they survive a parametric rebuild.
 */
export function buildTopologicalMap(
  geo: THREE.BufferGeometry,
  prev?: TopologicalMap,
  originFeatureId?: string,
): TopologicalMap {
  const sigs = computeFaceGroups(geo);
  const generation = (prev?.generation ?? 0) + 1;
  const prevFaces = prev ? Object.values(prev.faces) : [];

  const faces: Record<string, StableFace> = {};
  const indexToStable: Record<number, string> = {};
  const usedPrevIds = new Set<string>();

  for (let i = 0; i < sigs.length; i++) {
    const sig = sigs[i];

    // Try to match against a previous face
    let bestId: string | null = null;
    let bestScore = 0.6; // minimum threshold

    for (const prev of prevFaces) {
      if (usedPrevIds.has(prev.stableId)) continue;
      const score = matchScore(sig, prev.signature);
      if (score > bestScore) {
        bestScore = score;
        bestId = prev.stableId;
      }
    }

    const stableId = bestId ?? genStableId('f');
    if (bestId) usedPrevIds.add(bestId);

    const face: StableFace = {
      stableId,
      faceIndex: i,
      signature: sig,
      originFeatureId,
      tag: tagFromNormal(sig.normal),
    };

    faces[stableId] = face;
    indexToStable[i] = stableId;
  }

  return { faces, indexToStable, generation, builtAt: Date.now() };
}

/**
 * Given a stable ID, returns the current face group index in the mesh,
 * or null if the face no longer exists.
 */
export function resolveStableId(map: TopologicalMap, stableId: string): number | null {
  return map.faces[stableId]?.faceIndex ?? null;
}

/**
 * Given a current face group index, returns the stable ID.
 */
export function getStableIdForIndex(map: TopologicalMap, index: number): string | null {
  return map.indexToStable[index] ?? null;
}

/**
 * Returns all stable IDs whose tag matches a given semantic role
 * (e.g. 'top', 'bottom', 'front', 'back', 'left', 'right').
 */
export function findFacesByTag(map: TopologicalMap, tag: string): StableFace[] {
  return Object.values(map.faces).filter(f => f.tag === tag);
}

/**
 * Returns all stable IDs created by a specific feature node.
 */
export function findFacesByFeature(map: TopologicalMap, featureId: string): StableFace[] {
  return Object.values(map.faces).filter(f => f.originFeatureId === featureId);
}

/**
 * Merge two topological maps (e.g. after a boolean union).
 * IDs from both maps are preserved; conflicts are resolved by keeping
 * the one with higher area (more representative face).
 */
export function mergeTopologicalMaps(a: TopologicalMap, b: TopologicalMap): TopologicalMap {
  const faces: Record<string, StableFace> = { ...a.faces };
  const indexToStable: Record<number, string> = { ...a.indexToStable };

  const offsetB = Object.keys(a.indexToStable).length;
  for (const [id, face] of Object.entries(b.faces)) {
    if (faces[id]) {
      // Conflict: keep higher-area face
      if (face.signature.area > faces[id].signature.area) {
        faces[id] = { ...face, faceIndex: face.faceIndex + offsetB };
      }
    } else {
      faces[id] = { ...face, faceIndex: face.faceIndex + offsetB };
    }
    indexToStable[face.faceIndex + offsetB] = id;
  }

  return {
    faces,
    indexToStable,
    generation: Math.max(a.generation, b.generation) + 1,
    builtAt: Date.now(),
  };
}

// ─── React-friendly hook utilities ───────────────────────────────────────────

/** Create an empty/initial topological map */
export function createEmptyTopologicalMap(): TopologicalMap {
  return { faces: {}, indexToStable: {}, generation: 0, builtAt: Date.now() };
}

/** Summarise a map for debug display */
export function summariseMap(map: TopologicalMap): string {
  const faceCount = Object.keys(map.faces).length;
  const tags = [...new Set(Object.values(map.faces).map(f => f.tag))].filter(Boolean).join(', ');
  return `${faceCount} faces | gen ${map.generation} | tags: ${tags || 'none'}`;
}
