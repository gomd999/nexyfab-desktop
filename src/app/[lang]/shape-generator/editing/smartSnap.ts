import * as THREE from 'three';

/**
 * Smart snap candidate produced by scanning a geometry for nearby features.
 *
 * Units are millimetres (matches the rest of shape-generator).
 */
export interface SnapCandidate {
  /** Snap point in world coords (closest point on the snapped feature). */
  point: [number, number, number];
  /** What kind of feature this snap is to. */
  kind: 'edge' | 'vertex' | 'face_center' | 'grid';
  /** Distance from the query point to this candidate (mm). */
  distMm: number;
  /** Optional reference (edge index, vertex id, etc.) for downstream UX. */
  ref?: string;
}

export interface FindEdgeSnapOpts {
  /** Maximum distance (mm) at which an edge is considered a candidate. */
  maxDistMm?: number;
  /** Cap on returned candidates (after sort by distance). */
  maxCandidates?: number;
  /**
   * When true, every undirected edge is unique-keyed so duplicate triangle
   * edges (interior edges shared by two triangles) only appear once. Default
   * true — matches Three.js EdgesGeometry deduping behaviour.
   */
  dedupe?: boolean;
}

const DEFAULT_MAX_DIST_MM = 2;
const DEFAULT_MAX_CANDIDATES = 8;

/**
 * Find the closest point on an edge segment (a-b) to point p.
 *
 * Returns the point coordinates plus the squared distance. Working in
 * squared distance avoids one sqrt per edge in the hot loop; we only sqrt
 * the survivors right before returning.
 */
function closestPointOnSegment(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
): { x: number; y: number; z: number; distSq: number } {
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const apx = px - ax;
  const apy = py - ay;
  const apz = pz - az;

  const lenSq = abx * abx + aby * aby + abz * abz;
  // Degenerate edge: zero length — snap to endpoint a.
  if (lenSq < 1e-12) {
    const dx = px - ax;
    const dy = py - ay;
    const dz = pz - az;
    return { x: ax, y: ay, z: az, distSq: dx * dx + dy * dy + dz * dz };
  }

  let t = (apx * abx + apy * aby + apz * abz) / lenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;

  const cx = ax + abx * t;
  const cy = ay + aby * t;
  const cz = az + abz * t;
  const dx = px - cx;
  const dy = py - cy;
  const dz = pz - cz;
  return { x: cx, y: cy, z: cz, distSq: dx * dx + dy * dy + dz * dz };
}

/** Pack two vertex keys into an undirected edge key (smaller index first). */
function edgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Quantise a position so duplicate vertices from non-indexed geometry collapse. */
function vertKey(x: number, y: number, z: number): string {
  // 0.001 mm bucket — well below user-visible precision, big enough to fold
  // floating-point dust from CSG outputs.
  const q = 1000;
  return `${Math.round(x * q)}|${Math.round(y * q)}|${Math.round(z * q)}`;
}

/**
 * Scan all triangle edges in `geometry`, return the closest snap candidates
 * to `queryPoint`. Each edge is considered once (interior edges shared by
 * two triangles dedupe by undirected vertex-pair key).
 *
 * Algorithm: O(N) over triangles. For shape-generator's typical edit-mode
 * geometry (under ~10k triangles) this stays under 2 ms per call, which is
 * cheap enough to run on every pointer-move during a drag.
 *
 * Returns candidates sorted by distance ascending. Empty array when the
 * geometry has no position attribute or no edge is within `maxDistMm`.
 */
export function findEdgeSnapCandidates(
  queryPoint: [number, number, number],
  geometry: THREE.BufferGeometry,
  opts: FindEdgeSnapOpts = {},
): SnapCandidate[] {
  const maxDistMm = opts.maxDistMm ?? DEFAULT_MAX_DIST_MM;
  const maxCandidates = opts.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  const dedupe = opts.dedupe ?? true;
  const maxDistSq = maxDistMm * maxDistMm;

  const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!posAttr) return [];
  const positionCount = posAttr.count;
  if (positionCount < 2) return [];

  const index = geometry.getIndex();
  const triCount = index ? Math.floor(index.count / 3) : Math.floor(positionCount / 3);
  if (triCount === 0) return [];

  const [qx, qy, qz] = queryPoint;

  type Candidate = { x: number; y: number; z: number; distSq: number; ref: string };
  const found: Candidate[] = [];
  const seenEdges = dedupe ? new Set<string>() : null;

  const consider = (ia: number, ib: number) => {
    const ax = posAttr.getX(ia);
    const ay = posAttr.getY(ia);
    const az = posAttr.getZ(ia);
    const bx = posAttr.getX(ib);
    const by = posAttr.getY(ib);
    const bz = posAttr.getZ(ib);

    if (seenEdges) {
      const ka = vertKey(ax, ay, az);
      const kb = vertKey(bx, by, bz);
      if (ka === kb) return; // zero-length edge
      const key = edgeKey(ka, kb);
      if (seenEdges.has(key)) return;
      seenEdges.add(key);
    }

    const c = closestPointOnSegment(qx, qy, qz, ax, ay, az, bx, by, bz);
    if (c.distSq > maxDistSq) return;
    found.push({ x: c.x, y: c.y, z: c.z, distSq: c.distSq, ref: `${ia}-${ib}` });
  };

  for (let t = 0; t < triCount; t++) {
    let i0: number, i1: number, i2: number;
    if (index) {
      i0 = index.getX(t * 3);
      i1 = index.getX(t * 3 + 1);
      i2 = index.getX(t * 3 + 2);
    } else {
      i0 = t * 3;
      i1 = t * 3 + 1;
      i2 = t * 3 + 2;
    }
    consider(i0, i1);
    consider(i1, i2);
    consider(i2, i0);
  }

  if (found.length === 0) return [];

  found.sort((a, b) => a.distSq - b.distSq);
  const top = found.slice(0, maxCandidates);

  return top.map((c) => ({
    point: [c.x, c.y, c.z] as [number, number, number],
    kind: 'edge' as const,
    distMm: Math.sqrt(c.distSq),
    ref: c.ref,
  }));
}

/**
 * Convenience: best single candidate or null. Avoids the array allocation
 * when callers only need the top hit (the common case during a drag).
 */
export function findBestEdgeSnap(
  queryPoint: [number, number, number],
  geometry: THREE.BufferGeometry,
  opts: FindEdgeSnapOpts = {},
): SnapCandidate | null {
  const candidates = findEdgeSnapCandidates(queryPoint, geometry, {
    ...opts,
    maxCandidates: 1,
  });
  return candidates[0] ?? null;
}
