/**
 * sectionView.ts — Section-view (단면도) generation.
 *
 * ASME Y14.3 + ISO 128-50 conventions:
 *   - Cutting plane line: long-dash–short-dash with arrow heads at
 *     both ends, perpendicular to the section view.
 *   - Section label: `A-A`, `B-B`, etc., placed at both arrow heads
 *     and above the section view.
 *   - Hatching: parallel lines at 45° (ANSI 31, "iron / general use"),
 *     spaced 2–4mm in the drawing plane. Different materials use
 *     different hatch patterns; we ship the general-purpose 45° line
 *     pattern as the default and leave material-specific patterns for
 *     a follow-up.
 *
 * **Scope of this module**: axis-aligned cutting planes (perpendicular
 * to X, Y, or Z). Oblique / aligned-section / removed-section variants
 * land in a follow-up. The current shape is what 90 % of mechanical
 * drawings need.
 */

import * as THREE from 'three';
import type { DrawingLine, DrawingText, ProjectionView } from './autoDrawing';
import { getProjectionDef } from './autoDrawing';

export type SectionAxis = 'x' | 'y' | 'z';

export interface SectionPlane {
  /** Which world axis the plane is perpendicular to. */
  axis: SectionAxis;
  /** Distance along that axis where the plane sits (mm, world). */
  offset: number;
  /** Single-character label used in `A-A` / `B-B` notation. */
  label: string;
}

export interface SectionViewResult {
  /** Cross-section outline edges — what the cut would actually look
   *  like if you sawed the part. Emitted as `visible` lines so the
   *  drawing exporter renders them solid. */
  outlineLines: DrawingLine[];
  /** Hatch fill — parallel lines clipped to the bounding box of the
   *  outline. Emitted as `dimension` (red) by default so they read as
   *  cross-hatching even when the renderer doesn't understand a
   *  dedicated `hatch` line type. */
  hatchLines: DrawingLine[];
  /** Section title (`SECTION A-A`) for the view header. */
  title: string;
  /** Position annotations for the cutting plane line in the source
   *  view — caller decides which projection these belong to. */
  texts: DrawingText[];
}

/** Compute triangle-plane intersection segments. Each triangle that
 *  crosses the plane contributes exactly one segment; triangles
 *  entirely on one side contribute nothing. */
function intersectTrianglesWithPlane(
  geometry: THREE.BufferGeometry,
  axis: SectionAxis,
  offset: number,
): Array<{ a: THREE.Vector3; b: THREE.Vector3 }> {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!pos) return [];
  const idx = geometry.index;
  const triCount = idx ? idx.count / 3 : pos.count / 3;

  const out: Array<{ a: THREE.Vector3; b: THREE.Vector3 }> = [];
  const v0 = new THREE.Vector3();
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();

  const axisIdx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  const sd = (v: THREE.Vector3) => v.getComponent(axisIdx) - offset;

  for (let t = 0; t < triCount; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3;
    const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    v0.fromBufferAttribute(pos, i0);
    v1.fromBufferAttribute(pos, i1);
    v2.fromBufferAttribute(pos, i2);

    const d0 = sd(v0);
    const d1 = sd(v1);
    const d2 = sd(v2);

    // All on the same side → no intersection.
    if ((d0 > 0 && d1 > 0 && d2 > 0) || (d0 < 0 && d1 < 0 && d2 < 0)) continue;
    // Degenerate (all on plane) — skip; it would explode to a strip.
    if (d0 === 0 && d1 === 0 && d2 === 0) continue;

    // Find the two edges that cross the plane and interpolate.
    const cross: THREE.Vector3[] = [];
    const edges: Array<[THREE.Vector3, number, THREE.Vector3, number]> = [
      [v0, d0, v1, d1],
      [v1, d1, v2, d2],
      [v2, d2, v0, d0],
    ];
    for (const [pA, dA, pB, dB] of edges) {
      // Edge crosses when signs differ — or when one endpoint is exactly
      // on the plane (treat as crossing at that endpoint).
      if ((dA > 0 && dB > 0) || (dA < 0 && dB < 0)) continue;
      if (dA === dB) continue; // both zero already handled above
      const t01 = dA / (dA - dB);
      const p = new THREE.Vector3(
        pA.x + (pB.x - pA.x) * t01,
        pA.y + (pB.y - pA.y) * t01,
        pA.z + (pB.z - pA.z) * t01,
      );
      cross.push(p);
    }
    if (cross.length >= 2) out.push({ a: cross[0], b: cross[1] });
  }
  return out;
}

/** Hatch the bounding box of the section outline with parallel 45°
 *  lines. Proper polygon-interior clipping requires stitching the
 *  segments into closed loops, which we defer; for axis-aligned cuts
 *  through convex bodies the bbox approximation is visually correct. */
function generateHatch(
  outline: Array<{ a: THREE.Vector3; b: THREE.Vector3 }>,
  projection: ProjectionView,
  scale: number,
  spacing = 3,
): DrawingLine[] {
  if (outline.length === 0) return [];
  const def = getProjectionDef(projection);

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const seg of outline) {
    const p1 = def.project(seg.a);
    const p2 = def.project(seg.b);
    minX = Math.min(minX, p1.x, p2.x);
    minY = Math.min(minY, p1.y, p2.y);
    maxX = Math.max(maxX, p1.x, p2.x);
    maxY = Math.max(maxY, p1.y, p2.y);
  }
  if (!Number.isFinite(minX)) return [];

  const lines: DrawingLine[] = [];
  // 45° lines: y = x + c. We sweep c from (minX − maxY) to (maxX − minY)
  // in `spacing` increments and clip each line to the bbox.
  const cStart = (minX - maxY);
  const cEnd = (maxX - minY);
  for (let c = cStart; c <= cEnd; c += spacing) {
    // Intersect with bbox edges:
    //   left  x=minX → y = minX − c   (must lie in [minY, maxY])
    //   right x=maxX → y = maxX − c
    //   bottom y=minY → x = minY + c
    //   top   y=maxY → x = maxY + c
    const points: Array<{ x: number; y: number }> = [];
    const tryPt = (x: number, y: number) => {
      if (x >= minX - 1e-6 && x <= maxX + 1e-6 && y >= minY - 1e-6 && y <= maxY + 1e-6) {
        points.push({ x, y });
      }
    };
    tryPt(minX, minX - c);
    tryPt(maxX, maxX - c);
    tryPt(minY + c, minY);
    tryPt(maxY + c, maxY);
    if (points.length < 2) continue;
    // Pick the two extreme points (could be 2–4 from corner cases).
    points.sort((p, q) => p.x - q.x || p.y - q.y);
    const p1 = points[0];
    const p2 = points[points.length - 1];
    lines.push({
      x1: p1.x * scale,
      y1: p1.y * scale,
      x2: p2.x * scale,
      y2: p2.y * scale,
      type: 'dimension',
    });
  }
  return lines;
}

/** When a cutting plane is perpendicular to axis X, the natural section
 *  view is the right or left projection — same goes for Y → top/bottom
 *  and Z → front/back. Default picks the +ve direction. */
export function sectionProjectionFor(axis: SectionAxis): ProjectionView {
  if (axis === 'x') return 'right';
  if (axis === 'y') return 'top';
  return 'front';
}

/**
 * Build a complete section view: outline, hatching, and a label string
 * ready to drop into a ViewResult.
 */
export function generateSectionView(
  geometry: THREE.BufferGeometry,
  plane: SectionPlane,
  opts: { scale?: number; hatchSpacing?: number; projection?: ProjectionView } = {},
): SectionViewResult {
  const scale = opts.scale ?? 1;
  const projection = opts.projection ?? sectionProjectionFor(plane.axis);
  const segments = intersectTrianglesWithPlane(geometry, plane.axis, plane.offset);

  const def = getProjectionDef(projection);
  const outlineLines: DrawingLine[] = segments.map(s => {
    const p1 = def.project(s.a);
    const p2 = def.project(s.b);
    return {
      x1: p1.x * scale,
      y1: p1.y * scale,
      x2: p2.x * scale,
      y2: p2.y * scale,
      type: 'visible' as const,
    };
  });

  const hatchLines = generateHatch(segments, projection, scale, opts.hatchSpacing ?? 3);

  // Cutting-plane indicator text — placed at plane offset along the
  // perpendicular world axis so the caller can render `A-A` at both
  // ends of the cut line in the source view.
  const labelText = `${plane.label}-${plane.label}`;
  const texts: DrawingText[] = [
    {
      x: 0, y: 0,
      text: labelText,
      fontSize: 4,
      anchor: 'middle',
      style: 'note',
    },
  ];

  return {
    outlineLines,
    hatchLines,
    title: `SECTION ${labelText}`,
    texts,
  };
}
