/**
 * centerlineAutoExtender.ts — Auto-extend centerlines beyond
 * symmetric features on a drawing.
 *
 * Per ASME Y14.2 / ISO 128-24:
 *
 *   - Centerlines (chain-dash) extend beyond the feature by
 *     2-4 mm to make the symmetry visible.
 *   - For cylindrical holes / shafts, the centerline crosses the
 *     entire feature with that overhang.
 *   - For bolt-circle patterns, a single centerline runs through
 *     each hole on the circle.
 *
 * Module:
 *   - For every cylindrical feature (hole / shaft / pin), produces
 *     two centerline segments along principal axes.
 *   - Adds overhang beyond the feature bbox.
 *   - For patterns, adds the bolt-circle centerline plus per-hole
 *     centerlines.
 *   - Trims centerlines at view edges.
 */

export interface Vec2 { x: number; y: number }

export type CenterlineKind = 'horizontal' | 'vertical' | 'bolt-circle' | 'angular';

export interface CylindricalFeature {
  id: string;
  centre: Vec2;
  diameterMm: number;
  /** Optional rectangular bbox if not circular (slot). */
  width?: number;
  height?: number;
}

export interface BoltCirclePattern {
  id: string;
  centre: Vec2;
  pitchCircleDiameterMm: number;
  holeCount: number;
  startAngleDeg: number;
}

export interface ViewBounds {
  min: Vec2;
  max: Vec2;
}

export interface ExtendOptions {
  overhangMm: number;
  clipToView: boolean;
}

export const DEFAULT_OPTIONS: ExtendOptions = {
  overhangMm: 3,
  clipToView: true,
};

export interface CenterlineSegment {
  featureId: string;
  kind: CenterlineKind;
  start: Vec2;
  end: Vec2;
  /** Dash pattern hint: 'long-dash-short-dash'. */
  patternName: string;
}

// ── Top-level entry ────────────────────────────────────────────

export function generateCenterlines(
  cylinders: CylindricalFeature[],
  patterns: BoltCirclePattern[],
  view: ViewBounds,
  options: Partial<ExtendOptions> = {},
): CenterlineSegment[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const out: CenterlineSegment[] = [];

  for (const cyl of cylinders) {
    const halfX = (cyl.width ?? cyl.diameterMm) / 2;
    const halfY = (cyl.height ?? cyl.diameterMm) / 2;
    // Horizontal centerline.
    let h: CenterlineSegment = {
      featureId: cyl.id,
      kind: 'horizontal',
      start: { x: cyl.centre.x - halfX - opts.overhangMm, y: cyl.centre.y },
      end: { x: cyl.centre.x + halfX + opts.overhangMm, y: cyl.centre.y },
      patternName: 'long-dash-short-dash',
    };
    if (opts.clipToView) h = clipSegment(h, view);
    out.push(h);

    // Vertical centerline.
    let v: CenterlineSegment = {
      featureId: cyl.id,
      kind: 'vertical',
      start: { x: cyl.centre.x, y: cyl.centre.y - halfY - opts.overhangMm },
      end: { x: cyl.centre.x, y: cyl.centre.y + halfY + opts.overhangMm },
      patternName: 'long-dash-short-dash',
    };
    if (opts.clipToView) v = clipSegment(v, view);
    out.push(v);
  }

  for (const pat of patterns) {
    // Bolt-circle centerline = circle PCD shown as chain dash.
    out.push({
      featureId: pat.id,
      kind: 'bolt-circle',
      start: { x: pat.centre.x, y: pat.centre.y },
      end: { x: pat.centre.x + pat.pitchCircleDiameterMm / 2, y: pat.centre.y },
      patternName: 'long-dash-short-dash',
    });
    // Per-hole radial centerlines from centre to bolt-circle position.
    for (let i = 0; i < pat.holeCount; i++) {
      const angle = (pat.startAngleDeg + i * 360 / pat.holeCount) * Math.PI / 180;
      const r = pat.pitchCircleDiameterMm / 2 + opts.overhangMm;
      out.push({
        featureId: pat.id,
        kind: 'angular',
        start: { x: pat.centre.x, y: pat.centre.y },
        end: { x: pat.centre.x + r * Math.cos(angle), y: pat.centre.y + r * Math.sin(angle) },
        patternName: 'long-dash-short-dash',
      });
    }
  }

  return out;
}

// ── Liang-Barsky line clipping ────────────────────────────────

function clipSegment(seg: CenterlineSegment, view: ViewBounds): CenterlineSegment {
  const { start, end } = seg;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  let t0 = 0, t1 = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [start.x - view.min.x, view.max.x - start.x, start.y - view.min.y, view.max.y - start.y];
  for (let i = 0; i < 4; i++) {
    const pi = p[i]!;
    const qi = q[i]!;
    if (pi === 0) {
      if (qi < 0) return { ...seg, start: { ...start }, end: { ...start } };
    } else {
      const r = qi / pi;
      if (pi < 0) {
        if (r > t1) return { ...seg, start: { ...start }, end: { ...start } };
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return { ...seg, start: { ...start }, end: { ...start } };
        if (r < t1) t1 = r;
      }
    }
  }
  return {
    ...seg,
    start: { x: start.x + t0 * dx, y: start.y + t0 * dy },
    end: { x: start.x + t1 * dx, y: start.y + t1 * dy },
  };
}

// ── Length helper ─────────────────────────────────────────────

export function totalCenterlineLength(segments: CenterlineSegment[]): number {
  let total = 0;
  for (const s of segments) {
    total += Math.hypot(s.end.x - s.start.x, s.end.y - s.start.y);
  }
  return total;
}

// ── Summary ────────────────────────────────────────────────────

export interface CenterlineSummary {
  segmentCount: number;
  cylinderCount: number;
  patternCount: number;
  totalLengthMm: number;
}

export function summarize(
  segments: CenterlineSegment[],
  cylinders: CylindricalFeature[],
  patterns: BoltCirclePattern[],
): CenterlineSummary {
  return {
    segmentCount: segments.length,
    cylinderCount: cylinders.length,
    patternCount: patterns.length,
    totalLengthMm: totalCenterlineLength(segments),
  };
}
