/**
 * chamferDeburrPath.ts — Generate a chamfer / deburr toolpath that
 * traces a part's edge loop with a chamfer or deburr tool, offset so the
 * tool's cutting point rides the edge at the right depth.
 *
 * For a chamfer tool of half-angle θ (e.g. 45° → θ=45) cutting a chamfer
 * of width w, the tool centre is offset from the true edge by:
 *
 *   lateralOffset = w + toolTipOffset
 *   depthBelowTop = w · tan(90° − θ)  (for a 45° tool, depth = w)
 *
 * The path follows the edge loop (polyline) offset inward by the lateral
 * amount, at a constant Z = −depth. We also compute the contact length
 * and an estimated cycle time at a given feed.
 */

export interface Point2D { x: number; y: number }
export type EdgeLoop = Point2D[]; // ordered, may be closed

export interface ChamferDeburrInput {
  edgeLoop: EdgeLoop;
  closed?: boolean;
  chamferWidthMm: number;
  toolHalfAngleDeg?: number; // default 45
  toolTipOffsetMm?: number;  // extra standoff, default 0.2
  feedMmPerMin?: number;
}

export interface ChamferPathPoint { x: number; y: number; z: number }

export interface ChamferDeburrResult {
  path: ChamferPathPoint[];
  lateralOffsetMm: number;
  depthMm: number;
  contactLengthMm: number;
  cycleTimeMin: number | null;
  warnings: string[];
}

export function generatePath(input: ChamferDeburrInput): ChamferDeburrResult {
  const warnings: string[] = [];
  if (input.edgeLoop.length < 2) warnings.push('Edge loop needs at least 2 points.');
  if (input.chamferWidthMm <= 0) warnings.push('Chamfer width must be positive.');

  const halfAngle = input.toolHalfAngleDeg ?? 45;
  const tipOffset = input.toolTipOffsetMm ?? 0.2;
  const lateral = input.chamferWidthMm + tipOffset;
  const depth = input.chamferWidthMm * Math.tan((90 - halfAngle) * Math.PI / 180);

  if (input.edgeLoop.length < 2) {
    return { path: [], lateralOffsetMm: lateral, depthMm: depth, contactLengthMm: 0, cycleTimeMin: null, warnings };
  }

  const closed = input.closed ?? false;
  const offsetLoop = offsetPolyline(input.edgeLoop, lateral, closed);
  const path: ChamferPathPoint[] = offsetLoop.map(p => ({ x: p.x, y: p.y, z: -depth }));

  let contact = 0;
  for (let i = 1; i < path.length; i++) {
    contact += Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.y - path[i - 1]!.y);
  }

  const cycleTime = input.feedMmPerMin && input.feedMmPerMin > 0 ? contact / input.feedMmPerMin : null;

  return { path, lateralOffsetMm: lateral, depthMm: depth, contactLengthMm: contact, cycleTimeMin: cycleTime, warnings };
}

/** Offset a polyline inward (to the right of travel for CW, configurable) by `dist`. */
function offsetPolyline(loop: EdgeLoop, dist: number, closed: boolean): Point2D[] {
  const n = loop.length;
  const out: Point2D[] = [];
  for (let i = 0; i < n; i++) {
    const prev = loop[(i - 1 + n) % n]!;
    const curr = loop[i]!;
    const next = loop[(i + 1) % n]!;

    // Edge normals (inward = left normal for CCW). Use averaged vertex normal.
    let nx = 0, ny = 0;
    if (closed || i > 0) {
      const e1 = normalize(curr.x - prev.x, curr.y - prev.y);
      nx += -e1.y; ny += e1.x;
    }
    if (closed || i < n - 1) {
      const e2 = normalize(next.x - curr.x, next.y - curr.y);
      nx += -e2.y; ny += e2.x;
    }
    const len = Math.hypot(nx, ny) || 1;
    out.push({ x: curr.x + (nx / len) * dist, y: curr.y + (ny / len) * dist });
  }
  return out;
}

function normalize(x: number, y: number): { x: number; y: number } {
  const len = Math.hypot(x, y) || 1;
  return { x: x / len, y: y / len };
}

/** Recommend feed based on chamfer width + material hardness factor. */
export function recommendFeed(chamferWidthMm: number, hardnessFactor: number = 1.0): number {
  // baseline 600 mm/min for 0.5mm chamfer in aluminium; scale down for bigger chamfer / harder material.
  const base = 600;
  return Math.max(50, base / (1 + chamferWidthMm) / Math.max(0.2, hardnessFactor));
}

export function summarize(r: ChamferDeburrResult): { pointCount: number; depthMm: number; contactLengthMm: number } {
  return { pointCount: r.path.length, depthMm: r.depthMm, contactLengthMm: r.contactLengthMm };
}
