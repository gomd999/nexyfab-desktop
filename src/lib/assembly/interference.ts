/**
 * interference — Phase 3.4 of NexyFab Pro own-CAD (ADR-013).
 *
 * Detects when assembled parts overlap (positions interpenetrate). For
 * Phase 3.4 we use axis-aligned bounding boxes (AABB) computed from each
 * part's local geometry envelope — cheap and conservative (false positives
 * possible when bboxes overlap but actual geometry doesn't; never false
 * negatives within their own scope).
 *
 * The full OCCT BRepAlgo intersection check is Phase 3.4.2 (slower, exact;
 * fall back when AABB pairs hit and the user wants a precise verdict).
 *
 * Scope (Phase 3.4 minimal):
 *   - AABB type + transformed-AABB helper (rotates 8 corners to keep AABB
 *     axis-aligned in world frame after rotation).
 *   - aabbOverlap(a, b) → boolean.
 *   - assemblyInterferences(state, bboxes) → list of (partA, partB) pairs.
 *   - Optional whitelist (mate-mated parts often touch by design — caller
 *     filters these out, e.g., concentric / coincident neighbours).
 */

import type { PartInstance } from './assemblyState';
import type { Vec3 } from '@/lib/sketch/sketchPlane';
import { add } from '@/lib/sketch/sketchPlane';
import { rotateVec } from './mateSolver';

// ─── AABB ─────────────────────────────────────────────────────────────────

export interface AABB {
  /** Lower corner. */
  min: Vec3;
  /** Upper corner. */
  max: Vec3;
}

export function aabb(min: Vec3, max: Vec3): AABB { return { min, max }; }

/**
 * Compute the world-space AABB of a part given its local AABB.
 * Rotates the 8 local corners by the part's orientation, then takes the
 * AABB of the result — guaranteed to enclose the rotated body (with some
 * slack for rotations > 0).
 */
export function transformAabb(local: AABB, part: PartInstance): AABB {
  const corners: Vec3[] = [
    { x: local.min.x, y: local.min.y, z: local.min.z },
    { x: local.max.x, y: local.min.y, z: local.min.z },
    { x: local.min.x, y: local.max.y, z: local.min.z },
    { x: local.max.x, y: local.max.y, z: local.min.z },
    { x: local.min.x, y: local.min.y, z: local.max.z },
    { x: local.max.x, y: local.min.y, z: local.max.z },
    { x: local.min.x, y: local.max.y, z: local.max.z },
    { x: local.max.x, y: local.max.y, z: local.max.z },
  ];
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const c of corners) {
    const rotated = rotateVec(c, part.orientation);
    const w = add(part.position, rotated);
    if (w.x < minX) minX = w.x;
    if (w.y < minY) minY = w.y;
    if (w.z < minZ) minZ = w.z;
    if (w.x > maxX) maxX = w.x;
    if (w.y > maxY) maxY = w.y;
    if (w.z > maxZ) maxZ = w.z;
  }
  return { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } };
}

// ─── overlap test ────────────────────────────────────────────────────────

export function aabbOverlap(a: AABB, b: AABB, tolerance: number = 0): boolean {
  // Positive tolerance excludes near-touches: only report overlap when
  // the boxes interpenetrate by at least `tolerance` on every axis.
  if (a.max.x - tolerance <= b.min.x) return false;
  if (b.max.x - tolerance <= a.min.x) return false;
  if (a.max.y - tolerance <= b.min.y) return false;
  if (b.max.y - tolerance <= a.min.y) return false;
  if (a.max.z - tolerance <= b.min.z) return false;
  if (b.max.z - tolerance <= a.min.z) return false;
  return true;
}

export function aabbPenetration(a: AABB, b: AABB): number {
  if (!aabbOverlap(a, b)) return 0;
  const dx = Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x);
  const dy = Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y);
  const dz = Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z);
  // Penetration = minimum of the 3 axis overlaps (depth of the most-shallow
  // axis to push apart along).
  return Math.min(dx, dy, dz);
}

// ─── assembly-wide scan ──────────────────────────────────────────────────

export interface InterferencePair {
  partA: string;
  partB: string;
  penetration: number;
  bboxA: AABB;
  bboxB: AABB;
}

/**
 * Given a map of part-id → local AABB, return all pairs of parts whose
 * world-space AABBs overlap.
 *
 * - `whitelist`: optional set of "PartA::PartB" strings (alphabetically
 *   sorted) to skip — useful to ignore deliberately mated pairs.
 * - O(N^2) pairwise scan — fine for assemblies up to a few hundred parts.
 *   Phase 3.4.3 will add a BVH for large assemblies.
 */
export function assemblyInterferences(
  parts: ReadonlyArray<PartInstance>,
  localBoxes: ReadonlyMap<string, AABB>,
  whitelist?: ReadonlySet<string>,
): InterferencePair[] {
  // Pre-compute world-space AABBs.
  const worldBoxes = new Map<string, AABB>();
  for (const p of parts) {
    const local = localBoxes.get(p.id);
    if (!local) continue;
    worldBoxes.set(p.id, transformAabb(local, p));
  }
  const out: InterferencePair[] = [];
  for (let i = 0; i < parts.length; i++) {
    const a = parts[i]!;
    const ab = worldBoxes.get(a.id);
    if (!ab) continue;
    for (let j = i + 1; j < parts.length; j++) {
      const b = parts[j]!;
      const bb = worldBoxes.get(b.id);
      if (!bb) continue;
      const pairKey = a.id < b.id ? `${a.id}::${b.id}` : `${b.id}::${a.id}`;
      if (whitelist && whitelist.has(pairKey)) continue;
      if (aabbOverlap(ab, bb)) {
        out.push({
          partA: a.id,
          partB: b.id,
          penetration: aabbPenetration(ab, bb),
          bboxA: ab,
          bboxB: bb,
        });
      }
    }
  }
  return out;
}

// ─── spatial broad-phase (A4: scales to 10k+ parts) ────────────────────────

export interface SpatialBroadPhaseOptions {
  /** Grid cell size (world units). Default: mean part AABB max-extent. */
  cellSize?: number;
  /**
   * If a box spans more cells than this, it goes to an "oversized" bucket
   * tested against everything (avoids exploding insertions for huge parts).
   */
  maxCellsPerBox?: number;
}

/**
 * Same result as {@link assemblyInterferences} but with a uniform spatial-hash
 * broad-phase instead of the O(N²) all-pairs scan — the Phase-3.4.3 BVH gap.
 *
 * EXACT, not approximate: two AABBs can only overlap if they share a grid cell,
 * and every box is inserted into ALL cells it spans, so no overlapping pair is
 * ever missed. Only candidate pairs that co-occupy a cell run `aabbOverlap`,
 * making the cost ≈ O(N) for spatially-distributed assemblies (vs N²/2).
 * `partA`/`partB` are emitted id-sorted for deterministic, comparable output.
 */
export function assemblyInterferencesSpatial(
  parts: ReadonlyArray<PartInstance>,
  localBoxes: ReadonlyMap<string, AABB>,
  whitelist?: ReadonlySet<string>,
  opts?: SpatialBroadPhaseOptions,
): InterferencePair[] {
  const worldBoxes = new Map<string, AABB>();
  const ids: string[] = [];
  let extentSum = 0;
  for (const p of parts) {
    const local = localBoxes.get(p.id);
    if (!local) continue;
    const wb = transformAabb(local, p);
    worldBoxes.set(p.id, wb);
    ids.push(p.id);
    extentSum += Math.max(wb.max.x - wb.min.x, wb.max.y - wb.min.y, wb.max.z - wb.min.z);
  }
  if (ids.length < 2) return [];

  const cell = opts?.cellSize ?? Math.max(1e-6, extentSum / ids.length);
  const maxCells = opts?.maxCellsPerBox ?? 64;
  const ci = (v: number): number => Math.floor(v / cell);

  const grid = new Map<string, string[]>();
  const oversized: string[] = [];
  const bucket = (k: string, id: string): void => {
    let arr = grid.get(k);
    if (!arr) { arr = []; grid.set(k, arr); }
    arr.push(id);
  };
  for (const id of ids) {
    const b = worldBoxes.get(id)!;
    const x0 = ci(b.min.x), x1 = ci(b.max.x);
    const y0 = ci(b.min.y), y1 = ci(b.max.y);
    const z0 = ci(b.min.z), z1 = ci(b.max.z);
    const span = (x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1);
    if (span > maxCells) { oversized.push(id); continue; }
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++)
        for (let z = z0; z <= z1; z++) bucket(`${x},${y},${z}`, id);
  }

  const seen = new Set<string>();
  const out: InterferencePair[] = [];
  const consider = (a: string, b: string): void => {
    if (a === b) return;
    const [pa, pb] = a < b ? [a, b] : [b, a];
    const key = `${pa}::${pb}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (whitelist && whitelist.has(key)) return;
    const ab = worldBoxes.get(pa)!;
    const bb = worldBoxes.get(pb)!;
    if (aabbOverlap(ab, bb)) {
      out.push({ partA: pa, partB: pb, penetration: aabbPenetration(ab, bb), bboxA: ab, bboxB: bb });
    }
  };

  for (const arr of grid.values()) {
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) consider(arr[i]!, arr[j]!);
      for (const o of oversized) consider(o, arr[i]!);
    }
  }
  for (let i = 0; i < oversized.length; i++)
    for (let j = i + 1; j < oversized.length; j++) consider(oversized[i]!, oversized[j]!);

  return out;
}
