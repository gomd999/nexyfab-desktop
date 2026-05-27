/**
 * instancing.ts — Group identical-geometry parts for instanced rendering.
 *
 * Mechanical assemblies are dominated by repeated fasteners — a single
 * bracket can carry 24 M6 bolts + 24 washers + 24 nuts. Drawing them
 * as 72 separate meshes burns 72 draw calls per frame; with instancing
 * the GPU draws all 24 bolts in one call.
 *
 * This module decides:
 *   1. Which parts share geometry (hash of triangles + vertex coords).
 *   2. Whether the group is worth instancing (count ≥ threshold).
 *   3. The per-instance transform matrix list that the renderer feeds
 *      into THREE.InstancedMesh.
 *
 * The actual InstancedMesh creation lives at the renderer integration
 * layer; this module is pure data and unit-testable without WebGL.
 */

export interface PartInstance {
  /** Stable part id (e.g. `bolt-7`). */
  id: string;
  /** Geometry hash — typically a content hash of vertex+index buffers. */
  geometryHash: string;
  /** 4×4 column-major transform for this instance. */
  transform: number[];
}

export interface InstanceGroup {
  geometryHash: string;
  /** Per-instance id list, parallel to `transforms`. */
  instanceIds: string[];
  /** Per-instance transform matrices. Length = instanceIds × 16. */
  transforms: number[][];
}

export interface InstancingOptions {
  /** Minimum count for a geometry to be worth instancing. Default 4. */
  minGroupSize?: number;
}

/** Group parts by geometry hash + filter by minGroupSize. Returns
 *  ordered by descending group size so the renderer can prioritise. */
export function buildInstanceGroups(
  parts: PartInstance[],
  opts: InstancingOptions = {},
): InstanceGroup[] {
  const threshold = opts.minGroupSize ?? 4;
  const byHash = new Map<string, { ids: string[]; transforms: number[][] }>();
  for (const p of parts) {
    let entry = byHash.get(p.geometryHash);
    if (!entry) {
      entry = { ids: [], transforms: [] };
      byHash.set(p.geometryHash, entry);
    }
    entry.ids.push(p.id);
    entry.transforms.push(p.transform);
  }
  const groups: InstanceGroup[] = [];
  for (const [hash, entry] of byHash) {
    if (entry.ids.length >= threshold) {
      groups.push({
        geometryHash: hash,
        instanceIds: entry.ids,
        transforms: entry.transforms,
      });
    }
  }
  groups.sort((a, b) => b.instanceIds.length - a.instanceIds.length);
  return groups;
}

/** Parts that didn't make any group — these still need standalone
 *  mesh draws. Useful so the renderer knows what to skip from the
 *  instanced pass. */
export function nonInstancedParts(
  parts: PartInstance[],
  groups: InstanceGroup[],
): PartInstance[] {
  const groupedIds = new Set<string>();
  for (const g of groups) for (const id of g.instanceIds) groupedIds.add(id);
  return parts.filter(p => !groupedIds.has(p.id));
}

/** Telemetry: how many draw calls did instancing save? Each group
 *  collapses (count) calls into 1, so savings = (count − 1) per group. */
export function drawCallSavings(groups: InstanceGroup[]): number {
  return groups.reduce((s, g) => s + (g.instanceIds.length - 1), 0);
}
