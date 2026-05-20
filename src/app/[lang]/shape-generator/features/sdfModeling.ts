/**
 * sdfModeling.ts — Signed-distance-field (SDF) implicit modeling.
 *
 * SDF representation: a function f: ℝ³ → ℝ where f(p) < 0 means
 * "inside the shape" and |f(p)| = distance to the nearest surface.
 * Compared to B-Rep or mesh modeling, SDF gives:
 *
 *   - **Trivial booleans** — union = min, intersect = max,
 *     difference = max(a, -b). No topology fixup needed.
 *   - **Smooth blends** — `smin(a, b, k)` produces a fillet-like
 *     transition; `displacement` adds detail without re-meshing.
 *   - **Procedural texture & lattice** — modulating the field with
 *     noise / TPMS / function gives shapes that don't exist as B-Rep.
 *   - **Robust** — no self-intersection, no manifold check needed.
 *
 * Trade-offs vs B-Rep: features can't be edited parametrically; you
 * lose exact analytical edges (everything is sampled). NexyFab uses
 * SDF as a *parallel* representation alongside B-Rep for cases where
 * B-Rep is brittle (3D-print lattice infill, procedural relief
 * textures, scan-derived shapes).
 *
 * The output is a SdfField that can be evaluated at any 3D point.
 * For visualization the field is meshed via marching cubes (separate
 * module).
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type SdfField = (p: Vec3) => number;

// ── Primitives ──────────────────────────────────────────────────

/** Sphere centered at origin. */
export function sphere(radius: number): SdfField {
  return (p) => Math.hypot(p.x, p.y, p.z) - radius;
}

/** Axis-aligned box of given half-extents. */
export function box(half: Vec3): SdfField {
  return (p) => {
    const dx = Math.abs(p.x) - half.x;
    const dy = Math.abs(p.y) - half.y;
    const dz = Math.abs(p.z) - half.z;
    const ox = Math.max(dx, 0);
    const oy = Math.max(dy, 0);
    const oz = Math.max(dz, 0);
    const outside = Math.hypot(ox, oy, oz);
    const inside = Math.min(Math.max(dx, Math.max(dy, dz)), 0);
    return outside + inside;
  };
}

/** Box with rounded corners (offset = corner radius). */
export function roundBox(half: Vec3, cornerRadius: number): SdfField {
  const base = box({ x: half.x - cornerRadius, y: half.y - cornerRadius, z: half.z - cornerRadius });
  return (p) => base(p) - cornerRadius;
}

/** Torus around the Z axis, major radius + minor radius. */
export function torus(majorRadius: number, minorRadius: number): SdfField {
  return (p) => {
    const q = Math.hypot(p.x, p.y) - majorRadius;
    return Math.hypot(q, p.z) - minorRadius;
  };
}

/** Infinite cylinder along Z axis. */
export function cylinder(radius: number): SdfField {
  return (p) => Math.hypot(p.x, p.y) - radius;
}

/** Capped cylinder along Z axis, full height = 2h. */
export function cappedCylinder(radius: number, halfHeight: number): SdfField {
  return (p) => {
    const dxy = Math.hypot(p.x, p.y) - radius;
    const dz = Math.abs(p.z) - halfHeight;
    const ox = Math.max(dxy, 0);
    const oz = Math.max(dz, 0);
    return Math.hypot(ox, oz) + Math.min(Math.max(dxy, dz), 0);
  };
}

/** Cone with apex at origin, opening downward (+Z), base at height h. */
export function cone(angle: number, height: number): SdfField {
  const c = { x: Math.sin(angle), y: Math.cos(angle) };
  return (p) => {
    const q: [number, number] = [Math.hypot(p.x, p.y), p.z];
    const projDot = q[0] * c.x + q[1] * c.y;
    const d1 = Math.max(projDot, 0);
    const d2 = Math.max(q[1] - height, 0);
    return Math.hypot(d1, d2);
  };
}

/** Infinite plane with normal (0, 0, 1), offset at z=0. */
export function plane(normal: Vec3, offset: number): SdfField {
  const len = Math.hypot(normal.x, normal.y, normal.z) || 1;
  const n: Vec3 = { x: normal.x / len, y: normal.y / len, z: normal.z / len };
  return (p) => p.x * n.x + p.y * n.y + p.z * n.z - offset;
}

// ── Boolean operations ──────────────────────────────────────────

export function unionSdf(a: SdfField, b: SdfField): SdfField {
  return (p) => Math.min(a(p), b(p));
}

export function intersectSdf(a: SdfField, b: SdfField): SdfField {
  return (p) => Math.max(a(p), b(p));
}

export function subtractSdf(a: SdfField, b: SdfField): SdfField {
  return (p) => Math.max(a(p), -b(p));
}

// ── Smooth blends ───────────────────────────────────────────────

/** Polynomial smooth-min: produces a smooth fillet of radius k between
 *  the two surfaces. Reference: Inigo Quilez. */
export function smoothMin(a: SdfField, b: SdfField, k: number): SdfField {
  return (p) => {
    const va = a(p), vb = b(p);
    const h = Math.max(k - Math.abs(va - vb), 0) / k;
    return Math.min(va, vb) - h * h * k * 0.25;
  };
}

export function smoothMax(a: SdfField, b: SdfField, k: number): SdfField {
  return (p) => -smoothMin((q) => -a(q), (q) => -b(q), k)(p);
}

export function smoothSubtract(a: SdfField, b: SdfField, k: number): SdfField {
  return (p) => -smoothMin((q) => -a(q), b, k)(p);
}

// ── Transformations ─────────────────────────────────────────────

export function translate(field: SdfField, offset: Vec3): SdfField {
  return (p) => field({ x: p.x - offset.x, y: p.y - offset.y, z: p.z - offset.z });
}

/** Rotation around Z axis (radians). */
export function rotateZ(field: SdfField, angle: number): SdfField {
  const c = Math.cos(angle), s = Math.sin(angle);
  return (p) => field({ x: c * p.x + s * p.y, y: -s * p.x + c * p.y, z: p.z });
}

/** Rotation around Y axis. */
export function rotateY(field: SdfField, angle: number): SdfField {
  const c = Math.cos(angle), s = Math.sin(angle);
  return (p) => field({ x: c * p.x - s * p.z, y: p.y, z: s * p.x + c * p.z });
}

/** Rotation around X axis. */
export function rotateX(field: SdfField, angle: number): SdfField {
  const c = Math.cos(angle), s = Math.sin(angle);
  return (p) => field({ x: p.x, y: c * p.y + s * p.z, z: -s * p.y + c * p.z });
}

/** Uniform scale (negates exact-distance property; use sparingly). */
export function scale(field: SdfField, factor: number): SdfField {
  if (factor <= 0) return field;
  return (p) => field({ x: p.x / factor, y: p.y / factor, z: p.z / factor }) * factor;
}

// ── Distortion / domain ops ─────────────────────────────────────

/** Add a displacement field to a shape (e.g., wood-grain noise). */
export function displace(field: SdfField, disp: (p: Vec3) => number): SdfField {
  return (p) => field(p) + disp(p);
}

/** Shell: take a thin shell of thickness 2t centered on the surface. */
export function shell(field: SdfField, thickness: number): SdfField {
  return (p) => Math.abs(field(p)) - thickness;
}

/** Round a shape's surface (e.g., turn a box into a rounded box). */
export function round(field: SdfField, radius: number): SdfField {
  return (p) => field(p) - radius;
}

/** Repeat shape in a 3D lattice with given cell size. */
export function repeat(field: SdfField, cellSize: Vec3): SdfField {
  return (p) => {
    const wrap = (x: number, c: number) => x - c * Math.round(x / c);
    return field({ x: wrap(p.x, cellSize.x), y: wrap(p.y, cellSize.y), z: wrap(p.z, cellSize.z) });
  };
}

// ── Field utilities ─────────────────────────────────────────────

/** Numerical gradient via central differences. Useful for normals. */
export function gradient(field: SdfField, p: Vec3, eps: number = 1e-3): Vec3 {
  return {
    x: (field({ x: p.x + eps, y: p.y, z: p.z }) - field({ x: p.x - eps, y: p.y, z: p.z })) / (2 * eps),
    y: (field({ x: p.x, y: p.y + eps, z: p.z }) - field({ x: p.x, y: p.y - eps, z: p.z })) / (2 * eps),
    z: (field({ x: p.x, y: p.y, z: p.z + eps }) - field({ x: p.x, y: p.y, z: p.z - eps })) / (2 * eps),
  };
}

/** Unit surface normal at p (assumes p is near surface). */
export function surfaceNormal(field: SdfField, p: Vec3, eps: number = 1e-3): Vec3 {
  const g = gradient(field, p, eps);
  const len = Math.hypot(g.x, g.y, g.z) || 1;
  return { x: g.x / len, y: g.y / len, z: g.z / len };
}

// ── Sample grid ─────────────────────────────────────────────────

export interface SampleGrid {
  values: Float32Array;
  nx: number;
  ny: number;
  nz: number;
  min: Vec3;
  max: Vec3;
}

export function sampleField(field: SdfField, min: Vec3, max: Vec3, resolution: number): SampleGrid {
  const dx = (max.x - min.x) / (resolution - 1);
  const dy = (max.y - min.y) / (resolution - 1);
  const dz = (max.z - min.z) / (resolution - 1);
  const values = new Float32Array(resolution * resolution * resolution);
  for (let k = 0; k < resolution; k++) {
    for (let j = 0; j < resolution; j++) {
      for (let i = 0; i < resolution; i++) {
        const p: Vec3 = {
          x: min.x + i * dx,
          y: min.y + j * dy,
          z: min.z + k * dz,
        };
        values[k * resolution * resolution + j * resolution + i] = field(p);
      }
    }
  }
  return { values, nx: resolution, ny: resolution, nz: resolution, min, max };
}

/** Approximate volume by sampling: count cells where field < 0. */
export function estimateVolume(field: SdfField, min: Vec3, max: Vec3, resolution: number): number {
  const grid = sampleField(field, min, max, resolution);
  let insideCount = 0;
  for (const v of grid.values) if (v < 0) insideCount++;
  const cellVol = ((max.x - min.x) * (max.y - min.y) * (max.z - min.z)) / (resolution * resolution * resolution);
  return insideCount * cellVol;
}
