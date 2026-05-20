/**
 * revisionCloudLayout.ts — Generate the bumpy "revision cloud" outline
 * around a region of a drawing to flag what changed in a revision.
 *
 * The standard cloud is a polyline of small convex arcs (scallops) that
 * traces the bounding outline of the changed feature(s). ANSI Y14.35M
 * recommends an arc chord length of 3–6 mm (¼" common).
 *
 * Process:
 *   1. Inflate the input polygon by an offset margin.
 *   2. Subdivide each edge into segments of length ≈ chord.
 *   3. For each segment, build a small outward arc with sagitta s = chord/4.
 *   4. Concatenate sampled arc points to form the cloud polyline.
 */

export interface Point2D { x: number; y: number }
export type Polygon = Point2D[];

export interface RevisionCloudInput {
  outlinePolygon: Polygon;
  offsetMarginMm?: number; // default 2.0
  chordLengthMm?: number;  // default 4.0
  arcSamplesPerScallop?: number; // default 4
}

export interface RevisionCloudResult {
  cloudPolyline: Point2D[];
  scallopCount: number;
  totalLengthMm: number;
  warnings: string[];
}

export function buildCloud(input: RevisionCloudInput): RevisionCloudResult {
  const warnings: string[] = [];
  if (input.outlinePolygon.length < 3) warnings.push('Outline polygon needs at least 3 vertices.');

  const offset = input.offsetMarginMm ?? 2.0;
  const chord = input.chordLengthMm ?? 4.0;
  const samples = Math.max(2, input.arcSamplesPerScallop ?? 4);

  const inflated = inflatePolygon(input.outlinePolygon, offset);
  if (inflated.length < 3) {
    return { cloudPolyline: [], scallopCount: 0, totalLengthMm: 0, warnings: ['Inflated polygon degenerate.'] };
  }

  const cloud: Point2D[] = [];
  let scallops = 0;
  for (let i = 0; i < inflated.length; i++) {
    const a = inflated[i]!;
    const b = inflated[(i + 1) % inflated.length]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    const ux = dx / len, uy = dy / len;
    const nx = uy, ny = -ux; // outward right-normal for CCW polygon
    const N = Math.max(1, Math.round(len / chord));
    const seg = len / N;
    const sagitta = seg / 4; // bulge factor
    for (let k = 0; k < N; k++) {
      const t0 = k * seg;
      const t1 = (k + 1) * seg;
      // Arc spans (start, end) along segment; outward bump magnitude = sagitta.
      const s = { x: a.x + ux * t0, y: a.y + uy * t0 };
      const e = { x: a.x + ux * t1, y: a.y + uy * t1 };
      for (let j = 0; j <= samples; j++) {
        const tau = j / samples;
        // Quadratic bezier-like bump: bulge sin(π·τ) outward.
        const bump = Math.sin(tau * Math.PI) * sagitta;
        cloud.push({
          x: s.x + (e.x - s.x) * tau + nx * bump,
          y: s.y + (e.y - s.y) * tau + ny * bump,
        });
      }
      scallops++;
    }
  }

  const totalLen = polylineLength(cloud);
  return { cloudPolyline: cloud, scallopCount: scallops, totalLengthMm: totalLen, warnings };
}

function inflatePolygon(polygon: Polygon, offset: number): Polygon {
  // Simplistic CCW assumption + outward normal offset of each vertex.
  if (polygon.length < 3) return polygon;
  const out: Polygon = [];
  for (let i = 0; i < polygon.length; i++) {
    const prev = polygon[(i - 1 + polygon.length) % polygon.length]!;
    const curr = polygon[i]!;
    const next = polygon[(i + 1) % polygon.length]!;
    // Outward normals of the two adjacent edges, then average.
    const n1 = outwardNormal(prev, curr);
    const n2 = outwardNormal(curr, next);
    const ax = (n1.nx + n2.nx) / 2;
    const ay = (n1.ny + n2.ny) / 2;
    const len = Math.hypot(ax, ay) || 1;
    out.push({ x: curr.x + (ax / len) * offset, y: curr.y + (ay / len) * offset });
  }
  return out;
}

function outwardNormal(a: Point2D, b: Point2D): { nx: number; ny: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { nx: dy / len, ny: -dx / len };
}

function polylineLength(pts: Point2D[]): number {
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  }
  return total;
}

/** Build a cloud around a rectangular region for the common case. */
export function rectangularCloud(
  rect: { minX: number; minY: number; maxX: number; maxY: number },
  options?: Pick<RevisionCloudInput, 'offsetMarginMm' | 'chordLengthMm'>,
): RevisionCloudResult {
  const polygon: Polygon = [
    { x: rect.minX, y: rect.minY },
    { x: rect.maxX, y: rect.minY },
    { x: rect.maxX, y: rect.maxY },
    { x: rect.minX, y: rect.maxY },
  ];
  return buildCloud({ outlinePolygon: polygon, ...options });
}

export function summarize(r: RevisionCloudResult): { scallopCount: number; totalLengthMm: number; pointCount: number } {
  return { scallopCount: r.scallopCount, totalLengthMm: r.totalLengthMm, pointCount: r.cloudPolyline.length };
}
