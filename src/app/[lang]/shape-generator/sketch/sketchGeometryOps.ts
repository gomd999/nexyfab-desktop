// sketchGeometryOps.ts — pure 2D sketch geometry helpers extracted from
// SketchCanvas.tsx so they can be unit-tested in isolation. No React/three
// imports here, so tests load fast and deterministically. Behaviour is
// identical to the prior in-component definitions (pure move).
import type { SketchPoint, SketchSegment } from "./types";

// ─── Named constants ─────────────────────────────────────────────────────────

export const SNAP_GRID_SIZE = 5;        // grid cell size in mm
export const SNAP_GRID_PX = 8;          // grid snap threshold in pixels
export const SNAP_POINT_PX = 12;        // endpoint snap radius in pixels
export const ENDPOINT_EPSILON = 1e-10;  // floating point equality tolerance

// ─── ID generator ───────────────────────────────────────────────────────────
// Module-level counter is intentionally stable across re-renders;
// IDs only need to be unique within a session, not across SSR/client.
// genId is called only in event handlers and helper functions (never during render),
// so it does not cause hydration mismatches.
export let _idCounter = 0;
export function genId(prefix: string = 'e'): string {
  return `${prefix}_${Date.now().toString(36)}_${(++_idCounter).toString(36)}`;
}

// ─── Self-intersection detection ────────────────────────────────────────────
// 두 선분 AB, CD가 교차하는지 검사 (끝점 공유는 교차로 간주하지 않음)
export function segmentsIntersect(
  a: { x: number; y: number }, b: { x: number; y: number },
  c: { x: number; y: number }, d: { x: number; y: number }
): boolean {
  const eps = 1e-9;
  // 끝점이 거의 같으면 교차가 아닌 연결점
  const sameEnd = (p: {x:number;y:number}, q: {x:number;y:number}) =>
    Math.abs(p.x - q.x) < eps && Math.abs(p.y - q.y) < eps;
  if (sameEnd(a, c) || sameEnd(a, d) || sameEnd(b, c) || sameEnd(b, d)) return false;
  const d1 = (d.x - c.x) * (a.y - c.y) - (d.y - c.y) * (a.x - c.x);
  const d2 = (d.x - c.x) * (b.y - c.y) - (d.y - c.y) * (b.x - c.x);
  const d3 = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d4 = (b.x - a.x) * (d.y - a.y) - (b.y - a.y) * (d.x - a.x);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
         ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export function snap(val: number, gridSize: number, pxThreshold: number, scale: number): number {
  const nearest = Math.round(val / gridSize) * gridSize;
  if (Math.abs(val - nearest) * scale < pxThreshold) return nearest;
  return val;
}

export function snapPoint(p: SketchPoint, scale: number): SketchPoint {
  return { x: snap(p.x, SNAP_GRID_SIZE, SNAP_GRID_PX, scale), y: snap(p.y, SNAP_GRID_SIZE, SNAP_GRID_PX, scale) };
}

export function dist(a: SketchPoint, b: SketchPoint): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

/** Compute center of a circle through 3 points. Returns null if colinear. */
export function circleThrough3(p1: SketchPoint, p2: SketchPoint, p3: SketchPoint): { cx: number; cy: number; r: number } | null {
  const ax = p1.x, ay = p1.y, bx = p2.x, by = p2.y, cx = p3.x, cy = p3.y;
  const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(D) < ENDPOINT_EPSILON) return null;
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / D;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / D;
  return { cx: ux, cy: uy, r: Math.sqrt((ax - ux) ** 2 + (ay - uy) ** 2) };
}

/** Generate SVG arc path from 3 points */
export function arcPathFromPoints(start: SketchPoint, through: SketchPoint, end: SketchPoint): string {
  const circle = circleThrough3(start, through, end);
  if (!circle) return `L ${end.x} ${-end.y}`;
  const r = circle.r;
  const cross = (through.x - start.x) * (end.y - start.y) - (through.y - start.y) * (end.x - start.x);
  const sweepFlag = cross > 0 ? 0 : 1;
  const angleStart = Math.atan2(start.y - circle.cy, start.x - circle.cx);
  const angleThrough = Math.atan2(through.y - circle.cy, through.x - circle.cx);
  const angleEnd = Math.atan2(end.y - circle.cy, end.x - circle.cx);

  function normalizeAngle(a: number, ref: number): number {
    while (a < ref) a += 2 * Math.PI;
    while (a > ref + 2 * Math.PI) a -= 2 * Math.PI;
    return a;
  }

  const aEnd = normalizeAngle(angleEnd, angleStart);
  const aThrough = normalizeAngle(angleThrough, angleStart);
  const largeArc = (aThrough < aEnd) ? 0 : 1;
  const largeArcFlag = largeArc ^ sweepFlag;

  return `A ${r} ${r} 0 ${largeArcFlag} ${sweepFlag} ${end.x} ${-end.y}`;
}

/** Approximate arc points for preview */
export function sampleArc(start: SketchPoint, through: SketchPoint, end: SketchPoint, n: number = 20): SketchPoint[] {
  const circle = circleThrough3(start, through, end);
  if (!circle) return [start, end];
  const { cx, cy, r } = circle;
  const a1 = Math.atan2(start.y - cy, start.x - cx);
  let a2 = Math.atan2(end.y - cy, end.x - cx);
  const aMid = Math.atan2(through.y - cy, through.x - cx);

  function normAngle(a: number, ref: number): number {
    while (a < ref) a += 2 * Math.PI;
    while (a > ref + 2 * Math.PI) a -= 2 * Math.PI;
    return a;
  }
  a2 = normAngle(a2, a1);
  const aMidN = normAngle(aMid, a1);

  let sweep: number;
  if (aMidN <= a2) {
    sweep = a2 - a1;
  } else {
    sweep = a2 - a1 - 2 * Math.PI;
  }

  const pts: SketchPoint[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = a1 + sweep * t;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}

/** Generate circle points approximated as line segments */
export function generateCircleSegments(center: SketchPoint, radius: number, sides: number = 32): SketchSegment[] {
  const segs: SketchSegment[] = [];
  for (let i = 0; i < sides; i++) {
    const a1 = (2 * Math.PI * i) / sides;
    const a2 = (2 * Math.PI * (i + 1)) / sides;
    segs.push({
      type: 'line',
      points: [
        { x: center.x + radius * Math.cos(a1), y: center.y + radius * Math.sin(a1), id: genId('cp') },
        { x: center.x + radius * Math.cos(a2), y: center.y + radius * Math.sin(a2), id: genId('cp') },
      ],
      id: genId('cseg'),
    });
  }
  return segs;
}

/** Generate rectangle as 4 line segments */
export function generateRectSegments(corner1: SketchPoint, corner2: SketchPoint): SketchSegment[] {
  const tl: SketchPoint = { x: Math.min(corner1.x, corner2.x), y: Math.max(corner1.y, corner2.y), id: genId('rp') };
  const tr: SketchPoint = { x: Math.max(corner1.x, corner2.x), y: Math.max(corner1.y, corner2.y), id: genId('rp') };
  const br: SketchPoint = { x: Math.max(corner1.x, corner2.x), y: Math.min(corner1.y, corner2.y), id: genId('rp') };
  const bl: SketchPoint = { x: Math.min(corner1.x, corner2.x), y: Math.min(corner1.y, corner2.y), id: genId('rp') };
  return [
    { type: 'line', points: [tl, tr], id: genId('rseg') },
    { type: 'line', points: [tr, br], id: genId('rseg') },
    { type: 'line', points: [br, bl], id: genId('rseg') },
    { type: 'line', points: [bl, tl], id: genId('rseg') },
  ];
}

/** Generate regular polygon segments */
export function generatePolygonSegments(center: SketchPoint, radiusPt: SketchPoint, sides: number): SketchSegment[] {
  const r = dist(center, radiusPt);
  const baseAngle = Math.atan2(radiusPt.y - center.y, radiusPt.x - center.x);
  const segs: SketchSegment[] = [];
  const pts: SketchPoint[] = [];
  for (let i = 0; i < sides; i++) {
    const a = baseAngle + (2 * Math.PI * i) / sides;
    pts.push({ x: center.x + r * Math.cos(a), y: center.y + r * Math.sin(a), id: genId('pp') });
  }
  for (let i = 0; i < sides; i++) {
    segs.push({
      type: 'line',
      points: [pts[i], pts[(i + 1) % sides]],
      id: genId('pseg'),
    });
  }
  return segs;
}

/** Generate ellipse approximated as line segments */
export function generateEllipseSegments(center: SketchPoint, rx: number, ry: number, sides: number = 36): SketchSegment[] {
  const segs: SketchSegment[] = [];
  for (let i = 0; i < sides; i++) {
    const a1 = (2 * Math.PI * i) / sides;
    const a2 = (2 * Math.PI * (i + 1)) / sides;
    segs.push({
      type: 'line',
      points: [
        { x: center.x + rx * Math.cos(a1), y: center.y + ry * Math.sin(a1), id: genId('ep') },
        { x: center.x + rx * Math.cos(a2), y: center.y + ry * Math.sin(a2), id: genId('ep') },
      ],
      id: genId('eseg'),
    });
  }
  // Store center info on first segment for geometry snap
  if (segs.length > 0) {
    (segs[0] as SketchSegment & { _ellipseCenter?: SketchPoint })._ellipseCenter = center;
  }
  return segs;
}

/** Generate slot: two semicircles + two tangent lines */
export function generateSlotSegments(c1: SketchPoint, c2: SketchPoint, radius: number, sides: number = 32): SketchSegment[] {
  const dx = c2.x - c1.x;
  const dy = c2.y - c1.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 0.01) return generateEllipseSegments(c1, radius, radius);
  // Perpendicular direction (normalised)
  const nx = -dy / len;
  const ny = dx / len;
  const segs: SketchSegment[] = [];
  const halfSides = Math.floor(sides / 2);
  // Direction angle of c1→c2
  const baseAngle = Math.atan2(dy, dx);
  // Cap 1 (at c1, facing away from c2)
  for (let i = 0; i < halfSides; i++) {
    const a1 = baseAngle + Math.PI / 2 + (Math.PI * i) / halfSides;
    const a2 = baseAngle + Math.PI / 2 + (Math.PI * (i + 1)) / halfSides;
    segs.push({
      type: 'line',
      points: [
        { x: c1.x + radius * Math.cos(a1), y: c1.y + radius * Math.sin(a1), id: genId('sp') },
        { x: c1.x + radius * Math.cos(a2), y: c1.y + radius * Math.sin(a2), id: genId('sp') },
      ],
      id: genId('slseg'),
    });
  }
  // Top tangent line: c1 top → c2 top
  segs.push({
    type: 'line',
    points: [
      { x: c1.x + nx * radius, y: c1.y + ny * radius, id: genId('sp') },
      { x: c2.x + nx * radius, y: c2.y + ny * radius, id: genId('sp') },
    ],
    id: genId('slseg'),
  });
  // Cap 2 (at c2, facing away from c1)
  for (let i = 0; i < halfSides; i++) {
    const a1 = baseAngle - Math.PI / 2 + (Math.PI * i) / halfSides;
    const a2 = baseAngle - Math.PI / 2 + (Math.PI * (i + 1)) / halfSides;
    segs.push({
      type: 'line',
      points: [
        { x: c2.x + radius * Math.cos(a1), y: c2.y + radius * Math.sin(a1), id: genId('sp') },
        { x: c2.x + radius * Math.cos(a2), y: c2.y + radius * Math.sin(a2), id: genId('sp') },
      ],
      id: genId('slseg'),
    });
  }
  // Bottom tangent line: c2 bottom → c1 bottom
  segs.push({
    type: 'line',
    points: [
      { x: c2.x - nx * radius, y: c2.y - ny * radius, id: genId('sp') },
      { x: c1.x - nx * radius, y: c1.y - ny * radius, id: genId('sp') },
    ],
    id: genId('slseg'),
  });
  return segs;
}

/** Apply fillet between two lines meeting at a vertex — replaces the corner with an arc */
export function applyFilletAtVertex(
  segments: SketchSegment[],
  vertexPt: SketchPoint,
  radius: number,
  eps: number = 1,
): SketchSegment[] {
  // Find the two line segments that share this vertex
  const sharesVertex = (seg: SketchSegment, pt: SketchPoint): 0 | 1 | -1 => {
    if (seg.type !== 'line' || seg.points.length < 2) return 0;
    if (dist(seg.points[0], pt) < eps) return 1;
    if (dist(seg.points[seg.points.length - 1], pt) < eps) return -1;
    return 0;
  };
  const matched: Array<{ idx: number; end: 0 | 1 | -1 }> = [];
  for (let i = 0; i < segments.length; i++) {
    const e = sharesVertex(segments[i], vertexPt);
    if (e !== 0) matched.push({ idx: i, end: e });
  }
  if (matched.length < 2) return segments;
  const [m0, m1] = matched;
  const s0 = segments[m0.idx];
  const s1 = segments[m1.idx];
  // Direction from vertex along each segment
  const dir0 = m0.end === 1
    ? { x: s0.points[1].x - s0.points[0].x, y: s0.points[1].y - s0.points[0].y }
    : { x: s0.points[0].x - s0.points[s0.points.length - 1].x, y: s0.points[0].y - s0.points[s0.points.length - 1].y };
  const dir1 = m1.end === 1
    ? { x: s1.points[1].x - s1.points[0].x, y: s1.points[1].y - s1.points[0].y }
    : { x: s1.points[0].x - s1.points[s1.points.length - 1].x, y: s1.points[0].y - s1.points[s1.points.length - 1].y };
  const len0 = Math.sqrt(dir0.x ** 2 + dir0.y ** 2);
  const len1 = Math.sqrt(dir1.x ** 2 + dir1.y ** 2);
  if (len0 < 0.01 || len1 < 0.01) return segments;
  const u0 = { x: dir0.x / len0, y: dir0.y / len0 };
  const u1 = { x: dir1.x / len1, y: dir1.y / len1 };
  // Setback distance
  const dot = u0.x * u1.x + u0.y * u1.y;
  const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
  const setback = angle < 0.01 ? radius : radius / Math.tan(angle / 2);
  if (setback > Math.min(len0, len1) * 0.9) return segments; // radius too large
  // Fillet tangent points
  const tp0: SketchPoint = { x: vertexPt.x + u0.x * setback, y: vertexPt.y + u0.y * setback, id: genId('fp') };
  const tp1: SketchPoint = { x: vertexPt.x + u1.x * setback, y: vertexPt.y + u1.y * setback, id: genId('fp') };
  // Mid-arc point (bisector direction)
  const bisLen = Math.sqrt((u0.x + u1.x) ** 2 + (u0.y + u1.y) ** 2);
  const midDir = bisLen > 0.001
    ? { x: (u0.x + u1.x) / bisLen, y: (u0.y + u1.y) / bisLen }
    : { x: -u0.y, y: u0.x };
  const arcMidDist = radius / Math.max(0.01, Math.cos((Math.PI - angle) / 2));
  const arcMid: SketchPoint = { x: vertexPt.x + midDir.x * arcMidDist * 0.7, y: vertexPt.y + midDir.y * arcMidDist * 0.7, id: genId('fp') };
  // Trim segments
  const newSegs = segments.map((seg, i) => {
    if (i === m0.idx) {
      if (m0.end === 1) return { ...seg, points: [tp0, ...seg.points.slice(1)] };
      const pts = [...seg.points]; pts[pts.length - 1] = tp0; return { ...seg, points: pts };
    }
    if (i === m1.idx) {
      if (m1.end === 1) return { ...seg, points: [tp1, ...seg.points.slice(1)] };
      const pts = [...seg.points]; pts[pts.length - 1] = tp1; return { ...seg, points: pts };
    }
    return seg;
  });
  // Insert fillet arc
  const arcSeg: SketchSegment = { type: 'arc', points: [tp0, arcMid, tp1], id: genId('fillet') };
  const insertIdx = Math.max(m0.idx, m1.idx) + 1;
  newSegs.splice(insertIdx, 0, arcSeg);
  return newSegs;
}

/** Mirror all segments about a vertical or horizontal axis through the given point */
export function mirrorSegments(segs: SketchSegment[], axis: 'x' | 'y', pivot: number): SketchSegment[] {
  return segs.map(seg => ({
    ...seg,
    id: genId('mir'),
    points: seg.points.map(p => ({
      ...p,
      id: genId('mirp'),
      x: axis === 'y' ? 2 * pivot - p.x : p.x,
      y: axis === 'x' ? 2 * pivot - p.y : p.y,
    })),
  }));
}

/** Convert N Catmull-Rom control points into line-segment approximations */
export function catmullRomToSegments(points: SketchPoint[], tension = 0.5): Array<{ start: SketchPoint; end: SketchPoint }> {
  if (points.length < 2) return [];
  const segs: Array<{ start: SketchPoint; end: SketchPoint }> = [];
  const steps = 12; // line segments per span

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];

    let prev = p1;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const x = 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2*p0.x - 5*p1.x + 4*p2.x - p3.x) * t2 + (-p0.x + 3*p1.x - 3*p2.x + p3.x) * t3);
      const y = 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2*p0.y - 5*p1.y + 4*p2.y - p3.y) * t2 + (-p0.y + 3*p1.y - 3*p2.y + p3.y) * t3);
      const curr = { x, y };
      segs.push({ start: { ...prev }, end: { ...curr } });
      prev = curr;
    }
  }
  // suppress unused-variable warning for tension param (reserved for future use)
  void tension;
  return segs;
}

/** Find intersection of two line segments. Returns intersection point or null. */
export function lineLineIntersect(a1: SketchPoint, a2: SketchPoint, b1: SketchPoint, b2: SketchPoint): SketchPoint | null {
  const d1x = a2.x - a1.x, d1y = a2.y - a1.y;
  const d2x = b2.x - b1.x, d2y = b2.y - b1.y;
  const cross = d1x * d2y - d1y * d2x;
  if (Math.abs(cross) < 1e-10) return null;
  const t = ((b1.x - a1.x) * d2y - (b1.y - a1.y) * d2x) / cross;
  const u = ((b1.x - a1.x) * d1y - (b1.y - a1.y) * d1x) / cross;
  if (t < -0.001 || t > 1.001 || u < -0.001 || u > 1.001) return null;
  return { x: a1.x + t * d1x, y: a1.y + t * d1y };
}

/** Trim a line segment at its nearest intersection with any other segment in the profile.
 *  Returns trimmed segment or null if no intersections found. */
export function trimSegmentAtIntersections(
  seg: SketchSegment,
  allSegs: SketchSegment[],
  clickPt: SketchPoint,
): SketchSegment | null {
  if (seg.type !== 'line' || seg.points.length < 2) return null;
  const [p0, p1] = seg.points;

  // Collect all intersection points along this segment
  const intersections: Array<{ t: number; pt: SketchPoint }> = [];
  for (const other of allSegs) {
    if (other === seg) continue;
    if (other.type === 'line' && other.points.length >= 2) {
      const ip = lineLineIntersect(p0, p1, other.points[0], other.points[1]);
      if (ip) {
        const dx = p1.x - p0.x, dy = p1.y - p0.y;
        const len2 = dx * dx + dy * dy;
        const t = len2 > 0 ? ((ip.x - p0.x) * dx + (ip.y - p0.y) * dy) / len2 : 0;
        if (t > 0.001 && t < 0.999) {
          intersections.push({ t, pt: ip });
        }
      }
    }
  }
  if (intersections.length === 0) return null;
  intersections.sort((a, b) => a.t - b.t);

  // Determine which portion the click point is in — find its t
  const dx = p1.x - p0.x, dy = p1.y - p0.y;
  const len2 = dx * dx + dy * dy;
  const clickT = len2 > 0 ? ((clickPt.x - p0.x) * dx + (clickPt.y - p0.y) * dy) / len2 : 0;

  // Find boundary intersections: the first one before and after clickT
  const before = intersections.filter(i => i.t <= clickT);
  const after = intersections.filter(i => i.t > clickT);

  const newP0 = before.length > 0 ? { ...before[before.length - 1].pt, id: genId('tp') } : p0;
  const newP1 = after.length > 0 ? { ...after[0].pt, id: genId('tp') } : p1;

  return { ...seg, points: [newP0, newP1], id: genId('seg') };
}

/** Offset a segment by a perpendicular distance */
export function offsetSegment(seg: SketchSegment, distance: number): SketchSegment | null {
  if (seg.type === 'line' && seg.points.length >= 2) {
    const p0 = seg.points[0];
    const p1 = seg.points[1];
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.001) return null;
    const nx = -dy / len;
    const ny = dx / len;
    return {
      ...seg,
      id: genId('offseg'),
      points: [
        { x: p0.x + nx * distance, y: p0.y + ny * distance, id: genId('offp') },
        { x: p1.x + nx * distance, y: p1.y + ny * distance, id: genId('offp') },
      ],
    };
  }
  if (seg.type === 'arc' && seg.points.length === 3) {
    // Arc: find center, offset radius by distance
    const [start, through, end] = seg.points;
    const ax = start.x, ay = start.y, bx = through.x, by = through.y, cx = end.x, cy = end.y;
    const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(D) < 1e-10) return null;
    const ux = ((ax*ax+ay*ay)*(by-cy) + (bx*bx+by*by)*(cy-ay) + (cx*cx+cy*cy)*(ay-by)) / D;
    const uy = ((ax*ax+ay*ay)*(cx-bx) + (bx*bx+by*by)*(ax-cx) + (cx*cx+cy*cy)*(bx-ax)) / D;
    const r = Math.sqrt((ax-ux)**2 + (ay-uy)**2);
    const newR = r + distance;
    if (newR <= 0) return null;
    // Scale each point outward from center
    const scalePoint = (p: SketchPoint): SketchPoint => {
      const dr = Math.sqrt((p.x-ux)**2 + (p.y-uy)**2);
      if (dr < 0.001) return p;
      const f = newR / dr;
      return { x: ux + (p.x-ux)*f, y: uy + (p.y-uy)*f, id: genId('offp') };
    };
    return { ...seg, id: genId('offseg'), points: [scalePoint(start), scalePoint(through), scalePoint(end)] };
  }
  return null;
}

/** Find nearest segment to a point (in mm coords) */
export function findNearestSegment(
  segments: SketchSegment[],
  pt: SketchPoint,
  threshold: number,
): { index: number; distance: number } | null {
  let bestIdx = -1;
  let bestDist = Infinity;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.type === 'line' && seg.points.length >= 2) {
      const a = seg.points[0];
      const b = seg.points[1];
      // Point-to-segment distance
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lenSq = dx * dx + dy * dy;
      let t = 0;
      if (lenSq > 0) {
        t = Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / lenSq));
      }
      const proj = { x: a.x + t * dx, y: a.y + t * dy };
      const d = dist(pt, proj);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    } else if (seg.type === 'arc' && seg.points.length >= 3) {
      const circle = circleThrough3(seg.points[0], seg.points[1], seg.points[2]);
      if (circle) {
        const d = Math.abs(dist(pt, { x: circle.cx, y: circle.cy }) - circle.r);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
    }
  }

  if (bestIdx >= 0 && bestDist <= threshold) {
    return { index: bestIdx, distance: bestDist };
  }
  return null;
}

/** Hit-test a segment BODY (edge/perimeter) for whole-segment dragging.
 *  Unlike `findNearestSegment` (line/arc only — the tools that call it only
 *  operate on line geometry), this covers every typed segment in the data
 *  model so circle/rect/polygon/ellipse/slot bodies coming from imports,
 *  scripts or AI generation are body-draggable too. */
export function findNearestSegmentBody(
  segments: SketchSegment[],
  pt: SketchPoint,
  threshold: number,
): { index: number; distance: number } | null {
  const lineDist = (a: SketchPoint, b: SketchPoint): number => {
    const dx = b.x - a.x, dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq > 0 ? Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / lenSq)) : 0;
    return dist(pt, { x: a.x + t * dx, y: a.y + t * dy });
  };
  let bestIdx = -1;
  let bestDist = Infinity;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const p = seg.points;
    let d = Infinity;
    switch (seg.type) {
      case 'line':
        if (p.length >= 2) d = lineDist(p[0], p[1]);
        break;
      case 'arc':
        if (p.length >= 3) {
          const c = circleThrough3(p[0], p[1], p[2]);
          if (c) d = Math.abs(dist(pt, { x: c.cx, y: c.cy }) - c.r);
        }
        break;
      case 'circle':
      case 'polygon': // [center, edge] — perimeter ≈ circumscribed circle
        if (p.length >= 2) d = Math.abs(dist(pt, p[0]) - dist(p[0], p[1]));
        break;
      case 'rect':
        if (p.length >= 2) {
          const x1 = Math.min(p[0].x, p[1].x), x2 = Math.max(p[0].x, p[1].x);
          const y1 = Math.min(p[0].y, p[1].y), y2 = Math.max(p[0].y, p[1].y);
          d = Math.min(
            lineDist({ x: x1, y: y2 }, { x: x2, y: y2 }),
            lineDist({ x: x2, y: y2 }, { x: x2, y: y1 }),
            lineDist({ x: x2, y: y1 }, { x: x1, y: y1 }),
            lineDist({ x: x1, y: y1 }, { x: x1, y: y2 }),
          );
        }
        break;
      case 'ellipse':
        if (p.length >= 3) {
          const rx = Math.max(1e-6, dist(p[0], p[1]));
          const ry = Math.max(1e-6, dist(p[0], p[2]));
          // Scaled-space approximation of distance to the ellipse outline.
          const u = (pt.x - p[0].x) / rx;
          const v = (pt.y - p[0].y) / ry;
          d = Math.abs(Math.hypot(u, v) - 1) * Math.min(rx, ry);
        }
        break;
      case 'slot':
        if (p.length >= 3) {
          const r = dist(p[0], p[2]); // radius pt on the first cap's outer edge
          d = Math.abs(lineDist(p[0], p[1]) - r); // capsule boundary
        }
        break;
      case 'nurbs':
        // Approximate with the control polygon — good enough for a grab.
        for (let k = 0; k + 1 < p.length; k++) d = Math.min(d, lineDist(p[k], p[k + 1]));
        break;
    }
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  if (bestIdx >= 0 && bestDist <= threshold) {
    return { index: bestIdx, distance: bestDist };
  }
  return null;
}

