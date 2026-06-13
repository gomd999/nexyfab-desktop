/**
 * sectionView.ts — Cutting-plane section view emission.
 *
 * The drawing module needs section views the moment users design
 * anything hollow (pockets, ribs, internal channels). Without
 * sections, the outside view alone can't communicate dimension
 * intent. Three variants:
 *
 *   - **Full section**: plane cuts the whole part; the half facing
 *     the viewer is removed.
 *   - **Half section**: only one symmetric half is cut. Common on
 *     axisymmetric parts.
 *   - **Offset section**: cutting plane has multiple parallel jogs
 *     so multiple features land on one section without crowding.
 *
 * Output is a list of cross-section polygons + a hatch generator
 * (ISO 128-50 standard hatch — parallel lines at 45°, 4mm pitch).
 * The polygons feed the SVG rendering pipeline in the Drawing route.
 */

export type SectionKind = 'full' | 'half' | 'offset';

export interface CuttingPlane {
  /** Plane through `origin` with `normal`. */
  origin: [number, number, number];
  normal: [number, number, number];
}

export interface SectionInput {
  /** Mesh geometry — triangles defined by (v0, v1, v2). */
  triangles: Array<[
    [number, number, number],
    [number, number, number],
    [number, number, number],
  ]>;
  kind: SectionKind;
  /** Cutting plane (offset has a list of jogs in `offsetJogs`). */
  plane: CuttingPlane;
  /** For 'offset' — additional planes after each jog. */
  offsetJogs?: CuttingPlane[];
  /** Pitch of section hatch (mm). */
  hatchPitchMm?: number;
}

export interface SectionPolygon {
  /** Closed polygon points (3-D coords on the cutting plane). */
  points: Array<[number, number, number]>;
}

export interface HatchLine {
  start: [number, number];
  end: [number, number];
}

export interface SectionResult {
  polygons: SectionPolygon[];
  /** Total area of cross-section (mm²). */
  areaMm2: number;
  /** Hatch lines in the section plane's local 2-D frame. */
  hatchLines: HatchLine[];
}

/** Dot product. */
function dot(a: [number, number, number], b: [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function sub(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function lerp(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Returns the signed distance from a point to the plane. */
function signedDist(plane: CuttingPlane, p: [number, number, number]): number {
  return dot(plane.normal, sub(p, plane.origin));
}

/** Intersect a triangle with a plane → 0, 1, or 2 intersection points. */
function intersectTrianglePlane(
  tri: SectionInput['triangles'][number],
  plane: CuttingPlane,
): Array<[number, number, number]> {
  const d0 = signedDist(plane, tri[0]);
  const d1 = signedDist(plane, tri[1]);
  const d2 = signedDist(plane, tri[2]);
  if ((d0 > 0 && d1 > 0 && d2 > 0) || (d0 < 0 && d1 < 0 && d2 < 0)) return [];
  const pts: Array<[number, number, number]> = [];
  const edges: Array<[number, number]> = [[d0, d1], [d1, d2], [d0, d2]];
  const verts: Array<[[number, number, number], [number, number, number]]> = [
    [tri[0], tri[1]],
    [tri[1], tri[2]],
    [tri[0], tri[2]],
  ];
  for (let i = 0; i < 3; i++) {
    const [a, b] = edges[i]!;
    if ((a > 0) !== (b > 0)) {
      const t = a / (a - b);
      pts.push(lerp(verts[i]![0], verts[i]![1], t));
    }
  }
  return pts;
}

/** Build a basis on the cutting plane (u, v vectors perpendicular to normal). */
export function planeBasis(normal: [number, number, number]): {
  u: [number, number, number]; v: [number, number, number];
} {
  // Pick any axis not parallel to normal; cross to get u; cross again for v.
  const ref: [number, number, number] = Math.abs(normal[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0];
  const u: [number, number, number] = [
    normal[1] * ref[2] - normal[2] * ref[1],
    normal[2] * ref[0] - normal[0] * ref[2],
    normal[0] * ref[1] - normal[1] * ref[0],
  ];
  const uLen = Math.hypot(...u);
  if (uLen > 0) { u[0] /= uLen; u[1] /= uLen; u[2] /= uLen; }
  const v: [number, number, number] = [
    normal[1] * u[2] - normal[2] * u[1],
    normal[2] * u[0] - normal[0] * u[2],
    normal[0] * u[1] - normal[1] * u[0],
  ];
  return { u, v };
}

/** Convert a 3-D point on the plane into 2-D (u, v) local coords. */
export function project2D(
  p: [number, number, number],
  origin: [number, number, number],
  u: [number, number, number],
  v: [number, number, number],
): [number, number] {
  const d = sub(p, origin);
  return [dot(d, u), dot(d, v)];
}

/** Generate hatch lines covering a bbox in 2-D plane coords. */
function generateHatch(
  minU: number, maxU: number, minV: number, maxV: number,
  pitch: number,
): HatchLine[] {
  const lines: HatchLine[] = [];
  // 45° lines: u + v = c. Iterate c across the bbox diagonal range.
  const cMin = minU + minV;
  const cMax = maxU + maxV;
  for (let c = Math.floor(cMin / pitch) * pitch; c <= cMax; c += pitch) {
    // Line u + v = c; clip against the bbox.
    const intersections: Array<[number, number]> = [];
    // u = minU → v = c - minU
    const vAtMinU = c - minU;
    if (vAtMinU >= minV && vAtMinU <= maxV) intersections.push([minU, vAtMinU]);
    // u = maxU → v = c - maxU
    const vAtMaxU = c - maxU;
    if (vAtMaxU >= minV && vAtMaxU <= maxV) intersections.push([maxU, vAtMaxU]);
    // v = minV → u = c - minV
    const uAtMinV = c - minV;
    if (uAtMinV >= minU && uAtMinV <= maxU) intersections.push([uAtMinV, minV]);
    // v = maxV → u = c - maxV
    const uAtMaxV = c - maxV;
    if (uAtMaxV >= minU && uAtMaxV <= maxU) intersections.push([uAtMaxV, maxV]);
    if (intersections.length >= 2) {
      lines.push({ start: intersections[0]!, end: intersections[1]! });
    }
  }
  return lines;
}

export function generateSection(input: SectionInput): SectionResult {
  const pitch = input.hatchPitchMm ?? 4;
  const segments: Array<[[number, number, number], [number, number, number]]> = [];
  for (const tri of input.triangles) {
    const pts = intersectTrianglePlane(tri, input.plane);
    if (pts.length === 2) segments.push([pts[0]!, pts[1]!]);
  }

  // Stitch segments into closed polygons by endpoint matching.
  const polygons: SectionPolygon[] = stitchSegments(segments);

  // Project + compute area + hatch.
  const { u, v } = planeBasis(input.plane.normal);
  let totalArea = 0;
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const poly of polygons) {
    const pts2d = poly.points.map(p => project2D(p, input.plane.origin, u, v));
    totalArea += polygonArea2D(pts2d);
    for (const [pu, pv] of pts2d) {
      minU = Math.min(minU, pu); maxU = Math.max(maxU, pu);
      minV = Math.min(minV, pv); maxV = Math.max(maxV, pv);
    }
  }

  // Shoelace area carries a winding sign; the hatch fires whenever
  // there is *any* polygon area, regardless of orientation.
  const hatchLines = polygons.length > 0
    ? generateHatch(minU, maxU, minV, maxV, pitch)
    : [];

  return {
    polygons,
    areaMm2: Math.abs(totalArea),
    hatchLines,
  };
}

/** Stitch line segments into polygons via shared endpoints. */
function stitchSegments(
  segments: Array<[[number, number, number], [number, number, number]]>,
  tol = 1e-4,
): SectionPolygon[] {
  if (segments.length === 0) return [];
  const used = new Array(segments.length).fill(false);
  const polygons: SectionPolygon[] = [];
  const sameVertex = (
    a: [number, number, number], b: [number, number, number],
  ) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < tol;

  for (let i = 0; i < segments.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const pts: Array<[number, number, number]> = [segments[i]![0], segments[i]![1]];
    let extended = true;
    while (extended) {
      extended = false;
      for (let j = 0; j < segments.length; j++) {
        if (used[j]) continue;
        const [a, b] = segments[j]!;
        const last = pts[pts.length - 1]!;
        if (sameVertex(last, a)) { pts.push(b); used[j] = true; extended = true; }
        else if (sameVertex(last, b)) { pts.push(a); used[j] = true; extended = true; }
      }
      // Closed?
      if (pts.length > 2 && sameVertex(pts[0]!, pts[pts.length - 1]!)) break;
    }
    if (pts.length >= 3) polygons.push({ points: pts });
  }
  return polygons;
}

function polygonArea2D(pts: Array<[number, number]>): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}
