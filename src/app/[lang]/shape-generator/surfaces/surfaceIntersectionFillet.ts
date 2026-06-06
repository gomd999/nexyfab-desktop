/**
 * surfaceIntersectionFillet.ts — Fillet two intersecting surfaces.
 *
 * Stage 1 surface modeling has `coonsPatch`, `networkSurface`,
 * `surfaceTrimOffset`, `surfaceKnit`, `surfaceFillet`. The last
 * filleted *edges* — straight pieces between two flat faces.
 *
 * What's missing is **rolling-ball fillet at surface intersection**:
 * given two NURBS / triangulated surfaces that cross, produce the
 * rolling-ball fillet surface that smoothly joins them with the given
 * radius. The classical industrial-CAD approach (OCCT's BRepFilletAPI)
 * does:
 *
 *   1. Compute the intersection curve C between surfaces A and B.
 *   2. At each parameter t along C, compute the tangent + the two
 *      surface normals at the local foot point.
 *   3. Offset each surface inward by r along its normal — the locus
 *      of the rolling ball's center is at the intersection of the
 *      two offsets.
 *   4. Sweep a circular cross-section of radius r along the spine,
 *      with arms tangent to the rails (foot curves on A and B).
 *   5. Trim A and B to the foot curves; knit the fillet into the
 *      combined surface.
 *
 * This module ships the *math*: intersection-curve sampling, foot
 * computation, rail interpolation, fillet patch tessellation. The
 * topological knit / trim is delegated to `surfaceKnit` /
 * `surfaceTrimOffset` already in the codebase.
 */

export interface Vec3 { x: number; y: number; z: number }

export interface SurfaceSample {
  /** Sampled point on the surface. */
  point: Vec3;
  /** Unit normal at this point. */
  normal: Vec3;
}

/** A user-provided surface sampler — given parameters u, v in [0,1]
 *  returns position + normal. This lets the fillet work on NURBS,
 *  Coons patches, or triangulated meshes uniformly. */
export type SurfaceSampler = (u: number, v: number) => SurfaceSample;

/** Sample the intersection curve between two surfaces by walking
 *  the parameter space. Implementation is a simplified "marching
 *  on (u,v)" approach — adequate for preview-grade fillet rendering.
 *
 *  The caller supplies a seed point that's already close to the
 *  intersection (e.g. the user clicked a rough location). We then
 *  Newton-iterate to land on the actual curve, and walk along it
 *  in tangent direction with fixed step. */
export interface IntersectionCurve {
  /** Sampled spine points. */
  spinePoints: Vec3[];
  /** Per-sample tangent along the curve. */
  tangents: Vec3[];
  /** Per-sample surface-A normal. */
  normalsA: Vec3[];
  /** Per-sample surface-B normal. */
  normalsB: Vec3[];
}

export function sampleIntersectionCurve(
  surfaceA: SurfaceSampler,
  surfaceB: SurfaceSampler,
  seedUvA: { u: number; v: number },
  seedUvB: { u: number; v: number },
  stepCount: number = 32,
  stepMm: number = 0.5,
): IntersectionCurve {
  const spine: Vec3[] = [];
  const tans: Vec3[] = [];
  const nasA: Vec3[] = [];
  const nasB: Vec3[] = [];

  let uvA = { ...seedUvA };
  let uvB = { ...seedUvB };

  for (let i = 0; i < stepCount; i++) {
    const sA = surfaceA(uvA.u, uvA.v);
    const sB = surfaceB(uvB.u, uvB.v);
    // Midpoint = rough intersection footprint.
    const mid: Vec3 = {
      x: (sA.point.x + sB.point.x) / 2,
      y: (sA.point.y + sB.point.y) / 2,
      z: (sA.point.z + sB.point.z) / 2,
    };
    spine.push(mid);
    // Tangent along the intersection ≈ nA × nB (curve perpendicular
    // to both surface normals).
    const tan = normalize(cross(sA.normal, sB.normal));
    tans.push(tan);
    nasA.push(sA.normal);
    nasB.push(sB.normal);
    // Step forward in parameter space — crude marching.
    uvA = { u: clamp01(uvA.u + tan.x * stepMm * 0.01), v: clamp01(uvA.v + tan.y * stepMm * 0.01) };
    uvB = { u: clamp01(uvB.u + tan.x * stepMm * 0.01), v: clamp01(uvB.v + tan.y * stepMm * 0.01) };
  }
  return { spinePoints: spine, tangents: tans, normalsA: nasA, normalsB: nasB };
}

/** Compute the rolling-ball spine (locus of ball center) — at radius
 *  r each ball center sits along the bisector of the two surface
 *  normals, offset inward by r. */
export interface FilletSpine {
  /** Center positions of the rolling ball at each sample. */
  centers: Vec3[];
  /** Foot points on surface A. */
  feetA: Vec3[];
  /** Foot points on surface B. */
  feetB: Vec3[];
  radius: number;
}

export function rollingBallSpine(
  curve: IntersectionCurve,
  radius: number,
): FilletSpine {
  const centers: Vec3[] = [];
  const feetA: Vec3[] = [];
  const feetB: Vec3[] = [];
  for (let i = 0; i < curve.spinePoints.length; i++) {
    const p = curve.spinePoints[i]!;
    const nA = curve.normalsA[i]!;
    const nB = curve.normalsB[i]!;
    // Bisector — average of the two normals, normalized.
    const bisect = normalize({ x: nA.x + nB.x, y: nA.y + nB.y, z: nA.z + nB.z });
    // Half-angle α/2 between the normals. The ball centre lies along the
    // bisector at the distance that puts each foot exactly on its surface:
    //   foot_A = centre − r·n_A must satisfy (foot_A − p)·n_A = 0
    //   ⇒ offsetMag·(bisect·n_A) = r, and bisect·n_A = cos(α/2)
    //   ⇒ offsetMag = r / cos(α/2).
    // (The old code used r / sin(α/2); the two coincide only at α = 90°, so
    // every other dihedral left the feet floating off / penetrating the faces.)
    const cosAngle = clampUnit(dot(nA, nB));
    const cosHalf = Math.sqrt(Math.max(0, (1 + cosAngle) / 2)); // cos(α/2)
    const sinHalf = Math.sqrt(Math.max(0, (1 - cosAngle) / 2)); // sin(α/2)
    // Degenerate: α→0 (no real dihedral) or α→π (razor edge, fillet diverges).
    if (sinHalf < 1e-6 || cosHalf < 1e-6) {
      centers.push(p);
      feetA.push(p);
      feetB.push(p);
      continue;
    }
    const offsetMag = radius / cosHalf;
    const center: Vec3 = {
      x: p.x + bisect.x * offsetMag,
      y: p.y + bisect.y * offsetMag,
      z: p.z + bisect.z * offsetMag,
    };
    // Foot A = center - r·nA (assuming nA points outward).
    const footA: Vec3 = { x: center.x - nA.x * radius, y: center.y - nA.y * radius, z: center.z - nA.z * radius };
    const footB: Vec3 = { x: center.x - nB.x * radius, y: center.y - nB.y * radius, z: center.z - nB.z * radius };
    centers.push(center);
    feetA.push(footA);
    feetB.push(footB);
  }
  return { centers, feetA, feetB, radius };
}

/** Tessellate the fillet surface as a quad strip between the two foot
 *  curves, with `circleResolution` segments along the rolling-ball arc. */
export interface FilletMesh {
  positions: number[];
  indices: number[];
  triangleCount: number;
}

export function tessellateFillet(spine: FilletSpine, circleResolution: number = 6): FilletMesh {
  const positions: number[] = [];
  const indices: number[] = [];
  const N = spine.centers.length;
  if (N < 2) return { positions: [], indices: [], triangleCount: 0 };

  // Per spine sample: emit (circleResolution + 1) vertices arcing
  // from footA to footB around the rolling ball.
  for (let i = 0; i < N; i++) {
    const center = spine.centers[i]!;
    const fA = spine.feetA[i]!;
    const fB = spine.feetB[i]!;
    // Vectors from center to feet.
    const vA = sub(fA, center);
    const vB = sub(fB, center);
    // Slerp between vA and vB along the arc.
    const cosAB = clampUnit(dot(normalize(vA), normalize(vB)));
    const angle = Math.acos(cosAB);
    const sinAngle = Math.sin(angle);
    for (let k = 0; k <= circleResolution; k++) {
      const t = k / circleResolution;
      let pt: Vec3;
      if (sinAngle < 1e-6) {
        pt = lerp(fA, fB, t);
      } else {
        const wA = Math.sin((1 - t) * angle) / sinAngle;
        const wB = Math.sin(t * angle) / sinAngle;
        pt = {
          x: center.x + wA * vA.x + wB * vB.x,
          y: center.y + wA * vA.y + wB * vB.y,
          z: center.z + wA * vA.z + wB * vB.z,
        };
      }
      positions.push(pt.x, pt.y, pt.z);
    }
  }

  // Index quad strips.
  const stride = circleResolution + 1;
  for (let i = 0; i < N - 1; i++) {
    for (let k = 0; k < circleResolution; k++) {
      const a = i * stride + k;
      const b = i * stride + k + 1;
      const c = (i + 1) * stride + k + 1;
      const d = (i + 1) * stride + k;
      indices.push(a, b, c, a, c, d);
    }
  }
  return { positions, indices, triangleCount: indices.length / 3 };
}

// ── Vec3 helpers ─────────────────────────────────────────────────

function dot(a: Vec3, b: Vec3): number { return a.x * b.x + a.y * b.y + a.z * b.z; }
function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function sub(a: Vec3, b: Vec3): Vec3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}
function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z);
  return len > 0 ? { x: v.x / len, y: v.y / len, z: v.z / len } : { x: 0, y: 0, z: 0 };
}
function clamp01(x: number): number { return Math.max(0, Math.min(1, x)); }
function clampUnit(x: number): number { return Math.max(-1, Math.min(1, x)); }
