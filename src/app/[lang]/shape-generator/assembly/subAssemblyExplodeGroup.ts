/**
 * subAssemblyExplodeGroup.ts — Group sub-assembly parts so they
 * explode together as a single rigid unit.
 *
 * When users explode a complex assembly, individual sub-assemblies
 * (e.g., "gearbox subassembly") should move as a unit — not have
 * their internal parts fly apart. This module:
 *
 *   1. Identifies each sub-assembly's centroid + bounding box.
 *   2. Computes a *group offset* in the explode direction.
 *   3. Applies the same offset to every member of the group.
 *   4. Optionally allows internal explosion *within* the
 *      sub-assembly (two-stage explode).
 */

export interface Vec3 { x: number; y: number; z: number }

export interface PartInSubassembly {
  partId: string;
  /** Optional sub-assembly id; null = top-level. */
  subAssemblyId: string | null;
  /** Assembled position. */
  assembledPos: Vec3;
}

export interface SubAssemblyDef {
  id: string;
  /** Sub-assembly name. */
  name?: string;
  /** Parent sub-assembly id (null = top-level). */
  parentId: string | null;
}

export interface ExplodeGroupResult {
  /** Per-part exploded position. */
  explodedPositions: Map<string, Vec3>;
  /** Per-sub-assembly centroid + offset applied. */
  subAssemblyOffsets: Map<string, { centroid: Vec3; offset: Vec3 }>;
  /** Top-level parts (not in any sub-assembly) — moved individually. */
  topLevelPartIds: string[];
}

export interface ExplodeOptions {
  /** Explode magnitude per sub-assembly (mm). */
  groupSpacingMm: number;
  /** Spacing for top-level parts. */
  topLevelSpacingMm: number;
  /** Explode direction unit vector. */
  direction: Vec3;
  /** Internal-explode magnitude within each sub-assembly. */
  internalSpacingMm: number;
}

export const DEFAULT_OPTIONS: ExplodeOptions = {
  groupSpacingMm: 50,
  topLevelSpacingMm: 30,
  direction: { x: 0, y: 0, z: 1 },
  internalSpacingMm: 10,
};

// ── Top-level entry ────────────────────────────────────────────

export function explodeWithGroups(
  parts: PartInSubassembly[],
  subAssemblies: SubAssemblyDef[],
  options: Partial<ExplodeOptions> = {},
): ExplodeGroupResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const dir = normalize(opts.direction);

  // Group parts by sub-assembly id.
  const groupMembers = new Map<string, PartInSubassembly[]>();
  const topLevel: PartInSubassembly[] = [];
  for (const p of parts) {
    if (p.subAssemblyId === null) {
      topLevel.push(p);
    } else {
      const list = groupMembers.get(p.subAssemblyId) ?? [];
      list.push(p);
      groupMembers.set(p.subAssemblyId, list);
    }
  }

  const offsets = new Map<string, { centroid: Vec3; offset: Vec3 }>();
  const explodedPositions = new Map<string, Vec3>();

  // Compute centroids + assign per-sub-assembly offsets along direction.
  // Order sub-assemblies by their centroid projection on direction so they spread along.
  const subCentroids: Array<{ subId: string; centroid: Vec3; projection: number }> = [];
  for (const [subId, members] of groupMembers) {
    const centroid = centroidOf(members.map(m => m.assembledPos));
    subCentroids.push({ subId, centroid, projection: dotVec(centroid, dir) });
  }
  subCentroids.sort((a, b) => a.projection - b.projection);

  // Assign offsets sequentially.
  for (let i = 0; i < subCentroids.length; i++) {
    const sub = subCentroids[i]!;
    const stepIdx = i - (subCentroids.length - 1) / 2;
    const offset = scaleVec(dir, stepIdx * opts.groupSpacingMm);
    offsets.set(sub.subId, { centroid: sub.centroid, offset });
    const members = groupMembers.get(sub.subId)!;
    // Compute internal centroid for internal-explode.
    const internalCentroid = sub.centroid;
    for (let m = 0; m < members.length; m++) {
      const part = members[m]!;
      const internalDir = subVec(part.assembledPos, internalCentroid);
      const internalLen = lenVec(internalDir);
      const internalOffset = internalLen > 0
        ? scaleVec(normalize(internalDir), opts.internalSpacingMm)
        : { x: 0, y: 0, z: 0 };
      explodedPositions.set(part.partId, addVec(addVec(part.assembledPos, offset), internalOffset));
    }
  }

  // Top-level parts.
  topLevel.sort((a, b) => dotVec(a.assembledPos, dir) - dotVec(b.assembledPos, dir));
  for (let i = 0; i < topLevel.length; i++) {
    const part = topLevel[i]!;
    const stepIdx = i - (topLevel.length - 1) / 2;
    const offset = scaleVec(dir, stepIdx * opts.topLevelSpacingMm);
    explodedPositions.set(part.partId, addVec(part.assembledPos, offset));
  }

  return {
    explodedPositions,
    subAssemblyOffsets: offsets,
    topLevelPartIds: topLevel.map(p => p.partId),
  };
}

// ── Sub-assembly hierarchy helpers ───────────────────────────

export function listDescendants(subId: string, allSubs: SubAssemblyDef[]): string[] {
  const out: string[] = [subId];
  const queue = [subId];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const s of allSubs) {
      if (s.parentId === cur) {
        out.push(s.id);
        queue.push(s.id);
      }
    }
  }
  return out;
}

// ── Helpers ────────────────────────────────────────────────────

function centroidOf(positions: Vec3[]): Vec3 {
  let cx = 0, cy = 0, cz = 0;
  for (const p of positions) {
    cx += p.x; cy += p.y; cz += p.z;
  }
  const n = Math.max(1, positions.length);
  return { x: cx / n, y: cy / n, z: cz / n };
}

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z);
  if (len < 1e-9) return { x: 0, y: 0, z: 1 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function dotVec(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function scaleVec(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

function addVec(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function subVec(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function lenVec(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

// ── Summary ────────────────────────────────────────────────────

export interface ExplodeSummary {
  partCount: number;
  subAssemblyCount: number;
  topLevelCount: number;
  maxOffsetMm: number;
}

export function summarize(result: ExplodeGroupResult): ExplodeSummary {
  let maxOff = 0;
  for (const { offset } of result.subAssemblyOffsets.values()) {
    const m = lenVec(offset);
    if (m > maxOff) maxOff = m;
  }
  return {
    partCount: result.explodedPositions.size,
    subAssemblyCount: result.subAssemblyOffsets.size,
    topLevelCount: result.topLevelPartIds.length,
    maxOffsetMm: maxOff,
  };
}
