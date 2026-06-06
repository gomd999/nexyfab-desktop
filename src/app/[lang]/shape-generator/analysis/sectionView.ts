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

/** Hatch the section INTERIOR with parallel 45° lines, clipped to the actual
 *  cross-section outline (not just its bounding box). Each 45° line x − y = c is
 *  intersected with every projected outline segment; the crossings are sorted
 *  along the line and filled in even-odd pairs, so the hatch stays inside the
 *  real cut — correct for round, non-convex, and multi-loop sections, where a
 *  bbox fill used to spill hatching into the empty corners of e.g. a circular
 *  bore. (Works directly off the segment soup — no loop stitching needed.) */
function generateHatch(
  outline: Array<{ a: THREE.Vector3; b: THREE.Vector3 }>,
  projection: ProjectionView,
  scale: number,
  spacing = 3,
): DrawingLine[] {
  if (outline.length === 0) return [];
  const def = getProjectionDef(projection);

  // Project the outline segments once.
  const segs = outline.map(s => ({ p: def.project(s.a), q: def.project(s.b) }));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const { p, q } of segs) {
    minX = Math.min(minX, p.x, q.x); minY = Math.min(minY, p.y, q.y);
    maxX = Math.max(maxX, p.x, q.x); maxY = Math.max(maxY, p.y, q.y);
  }
  if (!Number.isFinite(minX)) return [];

  const lines: DrawingLine[] = [];
  // 45° lines have constant x − y = c (slope dy/dx = 1). Sweep c across the
  // section extent; for each line collect its crossings with the outline.
  const cStart = minX - maxY;
  const cEnd = maxX - minY;
  for (let c = cStart; c <= cEnd; c += spacing) {
    const xs: number[] = [];
    for (const { p, q } of segs) {
      const fp = p.x - p.y - c;
      const fq = q.x - q.y - c;
      // The line separates the segment's endpoints iff fp and fq differ in sign.
      if ((fp > 0 && fq > 0) || (fp < 0 && fq < 0)) continue;
      if (fp === fq) continue; // segment lies along the hatch direction — skip
      const tt = fp / (fp - fq);
      if (tt < 0 || tt > 1) continue;
      xs.push(p.x + (q.x - p.x) * tt); // crossing x (its y is x − c)
    }
    if (xs.length < 2) continue;
    xs.sort((m, n) => m - n);
    // Dedupe crossings that coincide at a shared vertex (counted on both of the
    // segments meeting there) so the even-odd parity stays correct.
    const uniq: number[] = [];
    for (const x of xs) if (!uniq.length || x - uniq[uniq.length - 1] > 1e-6) uniq.push(x);
    // Fill between consecutive inside pairs (even-odd rule).
    for (let i = 0; i + 1 < uniq.length; i += 2) {
      const x1 = uniq[i], x2 = uniq[i + 1];
      lines.push({
        x1: x1 * scale, y1: (x1 - c) * scale,
        x2: x2 * scale, y2: (x2 - c) * scale,
        type: 'dimension',
      });
    }
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
