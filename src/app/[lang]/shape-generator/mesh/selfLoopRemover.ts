/**
 * selfLoopRemover.ts — Remove degenerate "self-loop" triangles from a
 * mesh: triangles with two or three vertices coincident.
 *
 * Self-loop / degenerate triangles arise from:
 *   - Boolean operations producing zero-area triangles.
 *   - STL exporters with too-coarse rounding.
 *   - User-driven mesh edits.
 *
 * They cause:
 *   - Zero-area faces break normal computation.
 *   - Slicing skips or crashes.
 *   - FEA produces singular elements.
 *
 * Module:
 *   - Detects triangles with two coincident vertex indices (self-loop).
 *   - Detects triangles with vertices that are spatially within
 *     `coincidenceTolerance`.
 *   - Returns a cleaned triangle list + report.
 */

export interface Vec3 { x: number; y: number; z: number }

export interface Triangle {
  id: string;
  v0: number;
  v1: number;
  v2: number;
}

export interface MeshData {
  vertices: Vec3[];
  triangles: Triangle[];
}

export interface RemoveOptions {
  /** Vertices closer than this are coincident. */
  coincidenceToleranceMm: number;
  /** Minimum area below which triangle is degenerate. */
  minAreaMm2: number;
}

export const DEFAULT_OPTIONS: RemoveOptions = {
  coincidenceToleranceMm: 1e-6,
  minAreaMm2: 1e-9,
};

export type DegenerateKind = 'index-duplicate' | 'spatial-coincidence' | 'zero-area';

export interface DegenerateTriangle {
  triangleId: string;
  kind: DegenerateKind;
}

export interface RemoveResult {
  cleanedTriangles: Triangle[];
  removed: DegenerateTriangle[];
  removedByKind: Record<DegenerateKind, number>;
}

// ── Top-level entry ────────────────────────────────────────────

export function removeSelfLoops(mesh: MeshData, options: Partial<RemoveOptions> = {}): RemoveResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const cleaned: Triangle[] = [];
  const removed: DegenerateTriangle[] = [];
  const counts: Record<DegenerateKind, number> = { 'index-duplicate': 0, 'spatial-coincidence': 0, 'zero-area': 0 };

  for (const tri of mesh.triangles) {
    const kind = classifyTriangle(tri, mesh.vertices, opts);
    if (kind !== null) {
      removed.push({ triangleId: tri.id, kind });
      counts[kind]++;
    } else {
      cleaned.push(tri);
    }
  }
  return { cleanedTriangles: cleaned, removed, removedByKind: counts };
}

function classifyTriangle(tri: Triangle, vertices: Vec3[], opts: RemoveOptions): DegenerateKind | null {
  if (tri.v0 === tri.v1 || tri.v1 === tri.v2 || tri.v0 === tri.v2) return 'index-duplicate';
  const a = vertices[tri.v0];
  const b = vertices[tri.v1];
  const c = vertices[tri.v2];
  if (!a || !b || !c) return 'index-duplicate';
  if (closeEnough(a, b, opts.coincidenceToleranceMm) || closeEnough(b, c, opts.coincidenceToleranceMm) || closeEnough(a, c, opts.coincidenceToleranceMm)) {
    return 'spatial-coincidence';
  }
  const area = triangleArea(a, b, c);
  if (area < opts.minAreaMm2) return 'zero-area';
  return null;
}

function closeEnough(a: Vec3, b: Vec3, tol: number): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) <= tol;
}

function triangleArea(a: Vec3, b: Vec3, c: Vec3): number {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const acx = c.x - a.x, acy = c.y - a.y, acz = c.z - a.z;
  const nx = aby * acz - abz * acy;
  const ny = abz * acx - abx * acz;
  const nz = abx * acy - aby * acx;
  return Math.hypot(nx, ny, nz) / 2;
}

// ── Index remap when removing unused vertices ─────────────────

export function pruneUnusedVertices(mesh: MeshData, cleaned: Triangle[]): MeshData {
  const used = new Set<number>();
  for (const t of cleaned) {
    used.add(t.v0);
    used.add(t.v1);
    used.add(t.v2);
  }
  const remap = new Map<number, number>();
  const newVertices: Vec3[] = [];
  for (let i = 0; i < mesh.vertices.length; i++) {
    if (used.has(i)) {
      remap.set(i, newVertices.length);
      newVertices.push(mesh.vertices[i]!);
    }
  }
  const newTriangles = cleaned.map(t => ({
    id: t.id,
    v0: remap.get(t.v0)!,
    v1: remap.get(t.v1)!,
    v2: remap.get(t.v2)!,
  }));
  return { vertices: newVertices, triangles: newTriangles };
}

// ── Reporting ─────────────────────────────────────────────────

export function reportText(result: RemoveResult): string {
  const total = result.removed.length;
  if (total === 0) return 'No degenerate triangles found.';
  return `Removed ${total} degenerate triangle(s): ${result.removedByKind['index-duplicate']} index-duplicate, ${result.removedByKind['spatial-coincidence']} spatial-coincidence, ${result.removedByKind['zero-area']} zero-area.`;
}

// ── Summary ────────────────────────────────────────────────────

export interface RemoveSummary {
  originalCount: number;
  cleanedCount: number;
  removedCount: number;
  removedFraction: number;
}

export function summarize(mesh: MeshData, result: RemoveResult): RemoveSummary {
  return {
    originalCount: mesh.triangles.length,
    cleanedCount: result.cleanedTriangles.length,
    removedCount: result.removed.length,
    removedFraction: mesh.triangles.length === 0 ? 0 : result.removed.length / mesh.triangles.length,
  };
}
