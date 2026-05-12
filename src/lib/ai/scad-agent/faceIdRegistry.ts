/**
 * Z2 — Stable face/edge ID registry with topology propagation.
 *
 * A3 gave us role tags for primitives ("top", "side", "x+"). V2 extends
 * this through derived ops (boolean, fillet, chamfer, shell) so a face
 * referenced once stays referenced even after the topology changes.
 *
 * How propagation works:
 *   - Every face starts with a primitive parent + a role tag.
 *     id = "{parentHandle}:{role}" e.g. "occt:1:top".
 *   - A derived op (boolean, fillet, …) creates a new handle whose faces
 *     inherit IDs from one of the parents when geometry survives the op.
 *   - The provenance map for the derived handle records which parent face
 *     each new-handle-face came from. We approximate this with:
 *       (a) For primitives, deterministic role-based ids.
 *       (b) For booleans/fillets, "best match by centroid + normal proximity"
 *           is left to the host adapter to fill via `recordPropagation()`.
 *           When the adapter doesn't fill it, we fall back to a synthesized
 *           id "{newHandle}:f{index}" so refs are at least unique.
 *
 * The runtime resolver `resolveFaceIndex(stableId, handle)` returns the
 * current face index for a stable id given the live topology. Best-effort
 * — caller should treat it as a hint (and re-resolve if a downstream op
 * invalidated it).
 */

export interface FaceProvenance {
  /** Stable id for this face, e.g. "occt:1:top". */
  stableId: string;
  /** Current face index in the live topology. May change after derived ops. */
  faceIndex: number;
  /** Optional centroid in world coords for matching after re-tessellation. */
  centroid?: [number, number, number];
  /** Optional outward normal at the centroid. */
  normal?: [number, number, number];
  /** Optional surface area in mm² — used as a tiebreak in matching. */
  area?: number;
}

export interface FaceIdRegistry {
  /** handle → list of face provenances. */
  byHandle: Map<string, FaceProvenance[]>;
  /** stableId → handle (for reverse lookup). */
  byId: Map<string, string>;
}

export function createFaceIdRegistry(): FaceIdRegistry {
  return { byHandle: new Map(), byId: new Map() };
}

/**
 * Assign role tags to a primitive's faces. Mirrors A3's `list_face_tags`
 * mapping but stores them as full provenance entries.
 */
export function assignPrimitiveFaceIds(
  reg: FaceIdRegistry,
  handle: string,
  primitiveKind: 'cube' | 'box' | 'cylinder' | 'sphere' | 'helix',
): FaceProvenance[] {
  const tags = primitiveTags(primitiveKind);
  const provs: FaceProvenance[] = tags.map((tag, idx) => ({
    stableId: `${handle}:${tag}`,
    faceIndex: idx,
  }));
  reg.byHandle.set(handle, provs);
  for (const p of provs) reg.byId.set(p.stableId, handle);
  return provs;
}

function primitiveTags(kind: string): string[] {
  switch (kind) {
    case 'cube':
    case 'box':
      return ['x+', 'x-', 'y+', 'y-', 'z+', 'z-'];
    case 'cylinder':
      return ['top', 'bottom', 'side'];
    case 'sphere':
      return ['surf'];
    case 'helix':
      return ['side'];
    default:
      return [];
  }
}

/**
 * Record propagation from parent handles to a new (derived) handle.
 *
 * Caller passes a list of (parentStableId, newFaceIndex) — typically
 * computed by the host adapter from OCCT's face-mapping output. When
 * the adapter doesn't have the data, omit `mappings` and we'll synthesize
 * synthetic ids that are unique but have no semantic link to parents.
 */
export function recordPropagation(
  reg: FaceIdRegistry,
  newHandle: string,
  newFaceCount: number,
  mappings?: Array<{ parentStableId: string; newFaceIndex: number; centroid?: [number, number, number]; normal?: [number, number, number] }>,
): FaceProvenance[] {
  const provs: FaceProvenance[] = [];
  const mapped = new Set<number>();

  if (mappings) {
    for (const m of mappings) {
      provs.push({
        stableId: m.parentStableId,    // inherit parent's stable id directly
        faceIndex: m.newFaceIndex,
        centroid: m.centroid,
        normal: m.normal,
      });
      mapped.add(m.newFaceIndex);
      // The same stableId now points to the new handle (parent's ref is stale).
      reg.byId.set(m.parentStableId, newHandle);
    }
  }

  // Any face we didn't explicitly map gets a synthetic id — still unique,
  // still resolvable, just not semantically tied to a parent role.
  for (let i = 0; i < newFaceCount; i++) {
    if (mapped.has(i)) continue;
    const synthetic = `${newHandle}:f${i}`;
    provs.push({ stableId: synthetic, faceIndex: i });
    reg.byId.set(synthetic, newHandle);
  }

  reg.byHandle.set(newHandle, provs);
  return provs;
}

/**
 * Resolve a stable face id to the current face index on its live handle.
 * Returns null when the id is unknown OR the topology no longer contains it.
 */
export function resolveFaceIndex(
  reg: FaceIdRegistry,
  stableId: string,
): { handle: string; faceIndex: number } | null {
  const handle = reg.byId.get(stableId);
  if (!handle) return null;
  const provs = reg.byHandle.get(handle);
  if (!provs) return null;
  const match = provs.find(p => p.stableId === stableId);
  if (!match) return null;
  return { handle, faceIndex: match.faceIndex };
}

/** Get all stable ids for a handle, in face-index order. */
export function listFaceIds(reg: FaceIdRegistry, handle: string): FaceProvenance[] {
  return reg.byHandle.get(handle) ?? [];
}

/**
 * Drop all entries for a handle. Called when a node is removed from the
 * feature tree so we don't leak stale ids.
 */
export function unregister(reg: FaceIdRegistry, handle: string): void {
  const provs = reg.byHandle.get(handle);
  if (!provs) return;
  for (const p of provs) reg.byId.delete(p.stableId);
  reg.byHandle.delete(handle);
}
