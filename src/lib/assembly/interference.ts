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
