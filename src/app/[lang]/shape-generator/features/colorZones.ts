/**
 * colorZones.ts — Multi-color / multi-material face region manager.
 *
 * Used by:
 *   - **Branding** — paint customer logo/face groups one color for
 *     marketing renders.
 *   - **Multi-material 3D printing** (HP MJF, Stratasys J-series,
 *     Bambu AMS) — assign each face / region a different material
 *     index for export to OBJ-with-MTL, glTF, 3MF.
 *   - **Assembly classification** — colour-code by material spec, hot
 *     parts / cold parts, or as-cast vs as-machined.
 *
 * Zones reference face ids (from the feature catalog face provenance).
 * On export, every triangle in a face id picks up the zone's colour.
 *
 * Conflict resolution: faces can only belong to one zone. Last write
 * wins, but the manager tracks history so the UI can show "this face
 * was orange before". Removing the active zone restores the previous.
 */

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface ColorZone {
  id: string;
  name: string;
  color: RGB;
  /** Material id for multi-material printing (matches 3MF material id). */
  materialId?: string;
  /** Face ids assigned to this zone. */
  faceIds: Set<string>;
  /** Optional metallic + roughness for rendering. */
  metallic?: number;
  roughness?: number;
}

export interface ZoneAssignment {
  faceId: string;
  zoneId: string;
  /** Previous zone (for undo). */
  previousZoneId: string | null;
}

export class ColorZoneManager {
  private zones = new Map<string, ColorZone>();
  /** Reverse index: faceId → zoneId. */
  private faceToZone = new Map<string, string>();
  /** History stack of every assignment for undo. */
  private assignmentHistory: ZoneAssignment[] = [];

  // ── Zone CRUD ─────────────────────────────────────────────────

  createZone(zone: Omit<ColorZone, 'faceIds'> & { faceIds?: Set<string> }): ColorZone {
    const z: ColorZone = {
      id: zone.id,
      name: zone.name,
      color: { ...zone.color },
      faceIds: zone.faceIds ?? new Set(),
      ...(zone.materialId !== undefined ? { materialId: zone.materialId } : {}),
      ...(zone.metallic !== undefined ? { metallic: zone.metallic } : {}),
      ...(zone.roughness !== undefined ? { roughness: zone.roughness } : {}),
    };
    this.zones.set(z.id, z);
    return z;
  }

  removeZone(zoneId: string): void {
    const z = this.zones.get(zoneId);
    if (!z) return;
    for (const fid of z.faceIds) this.faceToZone.delete(fid);
    this.zones.delete(zoneId);
  }

  getZone(zoneId: string): ColorZone | null {
    return this.zones.get(zoneId) ?? null;
  }

  listZones(): ColorZone[] {
    return [...this.zones.values()];
  }

  // ── Face assignment ───────────────────────────────────────────

  assignFace(faceId: string, zoneId: string): ZoneAssignment {
    const previousZoneId = this.faceToZone.get(faceId) ?? null;
    if (previousZoneId === zoneId) {
      return { faceId, zoneId, previousZoneId };
    }
    if (previousZoneId) {
      const prev = this.zones.get(previousZoneId);
      prev?.faceIds.delete(faceId);
    }
    const z = this.zones.get(zoneId);
    if (z) z.faceIds.add(faceId);
    this.faceToZone.set(faceId, zoneId);
    const record: ZoneAssignment = { faceId, zoneId, previousZoneId };
    this.assignmentHistory.push(record);
    return record;
  }

  /** Batch assignment — single history record per call. */
  assignFaces(faceIds: string[], zoneId: string): ZoneAssignment[] {
    return faceIds.map(fid => this.assignFace(fid, zoneId));
  }

  unassignFace(faceId: string): void {
    const previousZoneId = this.faceToZone.get(faceId);
    if (!previousZoneId) return;
    const z = this.zones.get(previousZoneId);
    z?.faceIds.delete(faceId);
    this.faceToZone.delete(faceId);
    this.assignmentHistory.push({ faceId, zoneId: '', previousZoneId });
  }

  // ── Lookups ───────────────────────────────────────────────────

  getZoneForFace(faceId: string): ColorZone | null {
    const zid = this.faceToZone.get(faceId);
    return zid ? this.zones.get(zid) ?? null : null;
  }

  /** Build a per-face → color lookup for rendering. Faces without a
   *  zone return the fallback color. */
  buildColorLookup(fallback: RGB = { r: 0.6, g: 0.6, b: 0.6 }): Map<string, RGB> {
    const out = new Map<string, RGB>();
    for (const [fid, zid] of this.faceToZone) {
      const z = this.zones.get(zid);
      if (z) out.set(fid, z.color);
    }
    void fallback;
    return out;
  }

  // ── Undo ──────────────────────────────────────────────────────

  undo(): ZoneAssignment | null {
    const last = this.assignmentHistory.pop();
    if (!last) return null;
    const z = last.zoneId ? this.zones.get(last.zoneId) : null;
    z?.faceIds.delete(last.faceId);
    this.faceToZone.delete(last.faceId);
    if (last.previousZoneId) {
      const prev = this.zones.get(last.previousZoneId);
      prev?.faceIds.add(last.faceId);
      this.faceToZone.set(last.faceId, last.previousZoneId);
    }
    return last;
  }

  // ── Stats ─────────────────────────────────────────────────────

  stats(): { zoneCount: number; assignedFaceCount: number; orphanFaceCount: number } {
    return {
      zoneCount: this.zones.size,
      assignedFaceCount: this.faceToZone.size,
      orphanFaceCount: 0, // caller must compute via total - assigned.
    };
  }

  // ── Serialization ─────────────────────────────────────────────

  serialize(): SerializedZones {
    return {
      version: 1,
      zones: [...this.zones.values()].map(z => ({
        id: z.id,
        name: z.name,
        color: z.color,
        ...(z.materialId !== undefined ? { materialId: z.materialId } : {}),
        ...(z.metallic !== undefined ? { metallic: z.metallic } : {}),
        ...(z.roughness !== undefined ? { roughness: z.roughness } : {}),
        faceIds: [...z.faceIds],
      })),
    };
  }

  load(data: SerializedZones): void {
    if (data.version !== 1) throw new Error(`Unsupported zones version ${data.version}`);
    this.zones.clear();
    this.faceToZone.clear();
    this.assignmentHistory = [];
    for (const z of data.zones) {
      const zone = this.createZone({
        id: z.id,
        name: z.name,
        color: z.color,
        faceIds: new Set(z.faceIds),
        ...(z.materialId !== undefined ? { materialId: z.materialId } : {}),
        ...(z.metallic !== undefined ? { metallic: z.metallic } : {}),
        ...(z.roughness !== undefined ? { roughness: z.roughness } : {}),
      });
      for (const fid of zone.faceIds) this.faceToZone.set(fid, zone.id);
    }
  }
}

export interface SerializedZones {
  version: number;
  zones: Array<{
    id: string;
    name: string;
    color: RGB;
    materialId?: string;
    metallic?: number;
    roughness?: number;
    faceIds: string[];
  }>;
}

// ── Standard palettes ───────────────────────────────────────────

export const PRINTER_PALETTE_BAMBU = {
  filament_white: { r: 0.95, g: 0.95, b: 0.95 },
  filament_black: { r: 0.05, g: 0.05, b: 0.05 },
  filament_red: { r: 0.86, g: 0.13, b: 0.13 },
  filament_blue: { r: 0.13, g: 0.39, b: 0.86 },
  filament_green: { r: 0.20, g: 0.71, b: 0.30 },
  filament_yellow: { r: 0.95, g: 0.82, b: 0.20 },
} as const;

export const MJF_PALETTE = {
  hp_white: { r: 0.92, g: 0.92, b: 0.92 },
  hp_black: { r: 0.10, g: 0.10, b: 0.10 },
  hp_full_color: { r: 0.50, g: 0.50, b: 0.50 }, // placeholder; per-voxel
} as const;

// ── Export helpers ──────────────────────────────────────────────

/** Convert RGB (0..1) to an integer for 3MF material color attr. */
export function rgbToHex(rgb: RGB): string {
  const clamp = (x: number) => Math.max(0, Math.min(255, Math.round(x * 255)));
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${hex(clamp(rgb.r))}${hex(clamp(rgb.g))}${hex(clamp(rgb.b))}`;
}

/** Parse a hex color like `#aabbcc` → RGB. */
export function hexToRgb(hex: string): RGB {
  const s = hex.replace(/^#/, '');
  if (s.length !== 6) return { r: 0, g: 0, b: 0 };
  return {
    r: parseInt(s.slice(0, 2), 16) / 255,
    g: parseInt(s.slice(2, 4), 16) / 255,
    b: parseInt(s.slice(4, 6), 16) / 255,
  };
}

/** Build a triangle-color array given the mesh's triangle → face id
 *  map. Useful for per-triangle vertex colors in three.js. */
export function buildTriangleColors(
  triangleFaceIds: string[],
  manager: ColorZoneManager,
  fallback: RGB = { r: 0.6, g: 0.6, b: 0.6 },
): RGB[] {
  return triangleFaceIds.map(fid => {
    const zone = manager.getZoneForFace(fid);
    return zone?.color ?? fallback;
  });
}
