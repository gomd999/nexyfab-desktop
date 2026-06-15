/**
 * stlWrite — Phase 5.4 of NexyFab Pro own-CAD (ADR-013).
 *
 * ASCII STL serializer. STL is the standard 3D-printing / mesh-exchange
 * format — every CAM/slicer/viewer reads it.
 *
 * Scope (Phase 5.4 minimal):
 *   - ASCII STL (`solid name ... endsolid name`).
 *   - Triangle-soup input (no edge/vertex sharing — STL doesn't have that
 *     anyway).
 *   - Normal computation from triangle winding (right-handed; CCW =
 *     outward-facing).
 *
 * Out of scope (Phase 5.4.2+):
 *   - Binary STL (faster + smaller; one extra serializer)
 *   - 3MF (zip-based, has color/material/units metadata — separate module)
 *   - Mesh validation (manifold check, hole detection)
 *   - Welding nearby vertices
 *
 * Input model: caller hands a triangle list. The render pipeline (Phase
 * 2.A UI work — not done yet) will derive triangles from OCCT
 * BRepMesh::IncrementalMesh and feed them here.
 */

export interface StlTriangle {
  /** Three vertex positions in mm. Order determines normal direction
   *  (right-handed CCW = outward). */
  vertices: readonly [
    { x: number; y: number; z: number },
    { x: number; y: number; z: number },
    { x: number; y: number; z: number },
  ];
  /** Optional precomputed normal. Computed from vertex winding if absent. */
  normal?: { x: number; y: number; z: number };
}

export interface StlSolid {
  /** Solid name (no whitespace; replaced with underscore if present). */
  name: string;
  triangles: ReadonlyArray<StlTriangle>;
}

export class StlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StlError';
  }
}

export function writeStlAscii(solid: StlSolid): string {
  if (solid.triangles.length === 0) {
    throw new StlError(`STL solid '${solid.name}' has no triangles`);
  }
  const safeName = solid.name.replace(/\s+/g, '_');
  const out: string[] = [`solid ${safeName}`];
  for (const t of solid.triangles) {
    const n = t.normal ?? computeNormal(t);
    out.push(`  facet normal ${fmt(n.x)} ${fmt(n.y)} ${fmt(n.z)}`);
    out.push(`    outer loop`);
    for (const v of t.vertices) {
      out.push(`      vertex ${fmt(v.x)} ${fmt(v.y)} ${fmt(v.z)}`);
    }
    out.push(`    endloop`);
    out.push(`  endfacet`);
  }
  out.push(`endsolid ${safeName}`);
  return out.join('\n');
}

// ─── normal computation ──────────────────────────────────────────────────

function computeNormal(t: StlTriangle): { x: number; y: number; z: number } {
  const [a, b, c] = t.vertices;
  const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
  const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (len < 1e-12) return { x: 0, y: 0, z: 0 };
  return { x: nx / len, y: ny / len, z: nz / len };
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) throw new StlError(`STL: non-finite number ${n}`);
  if (Math.abs(n) < 1e-12) return '0';
  // STL viewers tolerate up to ~6 digits well.
  return Number(n.toFixed(6)).toString();
}

// ─── triangle counting helper (binary STL needs this) ────────────────────

export function countTriangles(solid: StlSolid): number {
  return solid.triangles.length;
}
