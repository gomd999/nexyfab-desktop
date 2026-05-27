/**
 * sketchAdvanced.ts — Conic curves, style spline, sketch slot,
 * equation-driven curve, belt/chain auto-fit.
 *
 * Stage-1 sketch covers line / arc / circle / rectangle / polygon /
 * spline. SolidWorks ships 5 more high-value primitives we haven't
 * implemented yet:
 *
 *   - **Conic curve** — parabola / hyperbola / general conic via
 *     5-parameter form. Used for aero / automotive surfaces.
 *   - **Style spline** — Bezier curve with direct control-polygon
 *     editing (cleaner G2 continuity than fit splines).
 *   - **Sketch slot** — straight + arc slot with width + length +
 *     auto coincident / tangent constraints to the rails.
 *   - **Equation-driven curve** — parametric x(t), y(t) for t ∈ [a,b].
 *   - **Belt / chain auto-fit** — sketch the routed belt around a
 *     set of pulleys with computed belt length + wrap angles.
 */

export interface SketchPoint {
  x: number;
  y: number;
}

// ── Conic curve ─────────────────────────────────────────────────

export type ConicKind = 'parabola' | 'hyperbola' | 'ellipse' | 'general';

export interface ConicCurve {
  kind: ConicKind;
  /** Start point. */
  start: SketchPoint;
  /** End point. */
  end: SketchPoint;
  /** Shoulder point — controls the curve's bulge. */
  shoulder: SketchPoint;
  /** Eccentricity: 0 = circle, < 1 = ellipse, 1 = parabola, > 1 = hyperbola. */
  eccentricity: number;
}

/** Sample N points along a conic curve. */
export function sampleConic(c: ConicCurve, samples: number = 32): SketchPoint[] {
  const out: SketchPoint[] = [];
  // Rational quadratic Bezier: P(t) = ((1-t)²·P0 + 2t(1-t)·w·P1 + t²·P2) / denom
  // where w = eccentricity-derived weight: w = ρ / (1 - ρ), ρ = sample-bulge.
  // Bayes approx: w = 0.5 for parabola, < 0.5 ellipse, > 0.5 hyperbola.
  let w: number;
  if (c.eccentricity === 1) w = 0.5;
  else if (c.eccentricity < 1) w = c.eccentricity / 2;
  else w = Math.min(0.95, 0.5 + (c.eccentricity - 1) * 0.2);

  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1);
    const u = 1 - t;
    const denom = u * u + 2 * t * u * w + t * t;
    const x = (u * u * c.start.x + 2 * t * u * w * c.shoulder.x + t * t * c.end.x) / denom;
    const y = (u * u * c.start.y + 2 * t * u * w * c.shoulder.y + t * t * c.end.y) / denom;
    out.push({ x, y });
  }
  return out;
}

// ── Style spline (Bezier with control polygon) ──────────────────

export interface StyleSpline {
  /** Control polygon — first + last are pinned through the curve. */
  controlPoints: SketchPoint[];
  /** Degree (typ 3 cubic, 5 quintic). */
  degree: number;
}

/** Evaluate the Bezier at parameter t (de Casteljau). */
export function evalStyleSpline(s: StyleSpline, t: number): SketchPoint {
  let pts = s.controlPoints.slice();
  while (pts.length > 1) {
    const next: SketchPoint[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      next.push({
        x: pts[i]!.x * (1 - t) + pts[i + 1]!.x * t,
        y: pts[i]!.y * (1 - t) + pts[i + 1]!.y * t,
      });
    }
    pts = next;
  }
  return pts[0]!;
}

/** Sample N points along the style spline. */
export function sampleStyleSpline(s: StyleSpline, samples: number = 32): SketchPoint[] {
  return Array.from({ length: samples }, (_, i) => evalStyleSpline(s, i / (samples - 1)));
}

// ── Sketch slot ─────────────────────────────────────────────────

export type SlotKind = 'straight' | 'arc' | 'centerpoint';

export interface SlotSpec {
  kind: SlotKind;
  /** Slot center 1 (or center for centerpoint slot). */
  center1: SketchPoint;
  /** Slot center 2 (ignored for centerpoint slot). */
  center2?: SketchPoint;
  /** Slot width (mm). */
  widthMm: number;
  /** Arc radius (for arc slot, mm). */
  arcRadiusMm?: number;
}

/** Build the sketch geometry (a closed polyline) for a slot. */
export function generateSlotGeometry(spec: SlotSpec, arcSamples: number = 16): SketchPoint[] {
  const r = spec.widthMm / 2;
  const points: SketchPoint[] = [];

  switch (spec.kind) {
    case 'straight': {
      if (!spec.center2) return points;
      const dx = spec.center2.x - spec.center1.x;
      const dy = spec.center2.y - spec.center1.y;
      const len = Math.hypot(dx, dy);
      if (len === 0) return points;
      const ux = dx / len, uy = dy / len;
      const perpX = -uy, perpY = ux;
      // Half-circle around center1, then half-circle around center2.
      for (let i = 0; i <= arcSamples; i++) {
        const a = Math.PI / 2 + (i / arcSamples) * Math.PI; // 90° → 270° around center1
        points.push({
          x: spec.center1.x + perpX * r * Math.cos(a) - ux * r * Math.sin(a) * -1,
          y: spec.center1.y + perpY * r * Math.cos(a) - uy * r * Math.sin(a) * -1,
        });
      }
      for (let i = 0; i <= arcSamples; i++) {
        const a = -Math.PI / 2 + (i / arcSamples) * Math.PI;
        points.push({
          x: spec.center2.x + perpX * r * Math.cos(a) + ux * r * Math.sin(a),
          y: spec.center2.y + perpY * r * Math.cos(a) + uy * r * Math.sin(a),
        });
      }
      break;
    }
    case 'centerpoint': {
      // Same as straight, but defined from center + half-length vector.
      if (!spec.center2) return points;
      // Treat center2 as half-length offset.
      const total = (count: number): SketchPoint[] => {
        const half = { x: spec.center2!.x, y: spec.center2!.y };
        const c1 = { x: spec.center1.x - half.x, y: spec.center1.y - half.y };
        const c2 = { x: spec.center1.x + half.x, y: spec.center1.y + half.y };
        return generateSlotGeometry({ kind: 'straight', center1: c1, center2: c2, widthMm: spec.widthMm }, count);
      };
      return total(arcSamples);
    }
    case 'arc': {
      if (!spec.center2 || !spec.arcRadiusMm) return points;
      // Arc slot: 4 quarter-arcs around the two endpoints + 2 arcs along the slot.
      const start = spec.center1;
      const end = spec.center2;
      const arcR = spec.arcRadiusMm;
      const startA = Math.atan2(start.y, start.x);
      const endA = Math.atan2(end.y, end.x);
      // Outer arc (radius + r).
      for (let i = 0; i <= arcSamples; i++) {
        const a = startA + (endA - startA) * (i / arcSamples);
        points.push({
          x: (arcR + r) * Math.cos(a),
          y: (arcR + r) * Math.sin(a),
        });
      }
      // Half circle at end.
      for (let i = 0; i <= arcSamples; i++) {
        const a = endA - Math.PI / 2 + (i / arcSamples) * Math.PI;
        points.push({
          x: arcR * Math.cos(endA) + r * Math.cos(a),
          y: arcR * Math.sin(endA) + r * Math.sin(a),
        });
      }
      // Inner arc (radius - r), reversed.
      for (let i = arcSamples; i >= 0; i--) {
        const a = startA + (endA - startA) * (i / arcSamples);
        points.push({
          x: (arcR - r) * Math.cos(a),
          y: (arcR - r) * Math.sin(a),
        });
      }
      break;
    }
  }
  return points;
}

// ── Equation-driven curve ───────────────────────────────────────

export interface EquationCurve {
  /** Function describing x(t). */
  xFn: (t: number) => number;
  /** Function describing y(t). */
  yFn: (t: number) => number;
  /** Parameter range [tStart, tEnd]. */
  tStart: number;
  tEnd: number;
}

/** Sample N points from a parametric curve. */
export function sampleEquationCurve(curve: EquationCurve, samples: number = 64): SketchPoint[] {
  const out: SketchPoint[] = [];
  for (let i = 0; i < samples; i++) {
    const t = curve.tStart + (curve.tEnd - curve.tStart) * (i / (samples - 1));
    out.push({ x: curve.xFn(t), y: curve.yFn(t) });
  }
  return out;
}

// ── Belt / chain auto-fit ───────────────────────────────────────

export interface Pulley {
  /** Center (sketch coords, mm). */
  center: SketchPoint;
  /** Pulley radius (mm). */
  radiusMm: number;
  /** Rotation direction relative to the belt — +1 driven, -1 idler reverse. */
  driveDirection: 1 | -1;
}

export interface BeltFit {
  /** Polyline of the belt centerline. */
  centerline: SketchPoint[];
  /** Wrap angle per pulley (degrees). */
  wrapAnglesDeg: number[];
  /** Total belt length (mm). */
  totalLengthMm: number;
}

/** Fit a belt around N pulleys (≥ 2). The belt is a closed loop
 *  tangent to each pulley + connecting straight segments. */
export function fitBelt(pulleys: Pulley[], samplesPerArc: number = 8): BeltFit {
  if (pulleys.length < 2) {
    return { centerline: [], wrapAnglesDeg: [], totalLengthMm: 0 };
  }
  const wrapAngles: number[] = new Array(pulleys.length).fill(0);
  const centerline: SketchPoint[] = [];
  let totalLength = 0;

  for (let i = 0; i < pulleys.length; i++) {
    const cur = pulleys[i]!;
    const next = pulleys[(i + 1) % pulleys.length]!;
    // Tangent line: depends on drive direction (cross- vs straight-belt).
    const dx = next.center.x - cur.center.x;
    const dy = next.center.y - cur.center.y;
    const D = Math.hypot(dx, dy);
    if (D === 0) continue;

    // Outer tangent.
    const angle = Math.atan2(dy, dx);
    // Tangent angle offset.
    const tangentOffset = Math.asin((cur.radiusMm - next.radiusMm) / D);

    // Tangent points on each pulley.
    const phiOut = angle + Math.PI / 2 - tangentOffset;
    const phiIn = angle + Math.PI / 2 - tangentOffset;
    const tangentOnCur: SketchPoint = {
      x: cur.center.x + cur.radiusMm * Math.cos(phiOut),
      y: cur.center.y + cur.radiusMm * Math.sin(phiOut),
    };
    const tangentOnNext: SketchPoint = {
      x: next.center.x + next.radiusMm * Math.cos(phiIn),
      y: next.center.y + next.radiusMm * Math.sin(phiIn),
    };

    // Wrap arc around current pulley.
    if (i > 0) {
      const prev = pulleys[(i - 1 + pulleys.length) % pulleys.length]!;
      const dxPrev = cur.center.x - prev.center.x;
      const dyPrev = cur.center.y - prev.center.y;
      const angleIn = Math.atan2(dyPrev, dxPrev) + Math.PI / 2;
      let wrapA = phiOut - angleIn;
      while (wrapA < 0) wrapA += Math.PI * 2;
      while (wrapA > Math.PI * 2) wrapA -= Math.PI * 2;
      wrapAngles[i] = wrapA * 180 / Math.PI;
      // Sample arc.
      for (let s = 0; s <= samplesPerArc; s++) {
        const a = angleIn + (phiOut - angleIn) * (s / samplesPerArc);
        centerline.push({
          x: cur.center.x + cur.radiusMm * Math.cos(a),
          y: cur.center.y + cur.radiusMm * Math.sin(a),
        });
      }
      totalLength += cur.radiusMm * wrapA;
    }

    // Straight segment to next pulley.
    centerline.push(tangentOnCur, tangentOnNext);
    totalLength += Math.hypot(
      tangentOnNext.x - tangentOnCur.x,
      tangentOnNext.y - tangentOnCur.y,
    );
  }
  return { centerline, wrapAnglesDeg: wrapAngles, totalLengthMm: totalLength };
}
