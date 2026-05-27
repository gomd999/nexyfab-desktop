/**
 * cornerReliefPlacer.ts — Auto-place corner reliefs at sheet metal
 * bend intersections.
 *
 * When two flanges meet at a corner, the material must be removed
 * along the bend tangent to avoid tearing during forming. The
 * "corner relief" is a small notch — usually one of:
 *
 *   - Round: drilled hole at the corner (smooth stress dist).
 *   - Square: rectangular notch (easiest punch).
 *   - V-notch: diagonal slot.
 *   - Tear-drop: combination round + slot.
 *
 * Module:
 *   - For every pair of bend lines that intersect, determines the
 *     intersection point and the bend-tangent angle.
 *   - Picks a relief style based on the angle + sheet thickness.
 *   - Sizes the relief: diameter ≥ sheet thickness × 1.5 for round.
 *   - Emits relief geometry suggestions.
 *
 * Used by the flat-pattern toolchain to inject reliefs before
 * unfolding.
 */

export type ReliefStyle = 'round' | 'square' | 'v-notch' | 'tear-drop';

export interface BendCorner {
  id: string;
  /** Intersection point in flat-pattern coords. */
  point: { x: number; y: number };
  /** Angle between the two bend lines (degrees). */
  angleDeg: number;
  /** Which bend IDs meet here. */
  bendAId: string;
  bendBId: string;
}

export interface ReliefOptions {
  /** Sheet thickness (mm). */
  thicknessMm: number;
  /** Override per-corner style. */
  forcedStyle?: ReliefStyle;
  /** Round-relief diameter multiplier (× thickness). Default 1.5. */
  roundDiameterFactor: number;
  /** Tear-drop ratio (slot length / diameter). Default 2.5. */
  tearDropRatio: number;
}

export const DEFAULT_OPTIONS: Omit<ReliefOptions, 'thicknessMm'> = {
  roundDiameterFactor: 1.5,
  tearDropRatio: 2.5,
};

export interface Relief {
  cornerId: string;
  style: ReliefStyle;
  /** Centre point in flat-pattern (may be offset from corner). */
  centre: { x: number; y: number };
  /** Primary diameter / width (mm). */
  primaryDimMm: number;
  /** Secondary dimension (slot length) for tear-drop / v-notch. */
  secondaryDimMm?: number;
  /** Why this style was chosen. */
  rationale: string;
}

// ── Top-level entry ────────────────────────────────────────────

export function placeReliefs(corners: BendCorner[], options: ReliefOptions): Relief[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  return corners.map(c => placeAtCorner(c, opts));
}

function placeAtCorner(corner: BendCorner, opts: ReliefOptions): Relief {
  const style = opts.forcedStyle ?? pickStyle(corner, opts.thicknessMm);
  const dia = opts.thicknessMm * opts.roundDiameterFactor;
  switch (style) {
    case 'round':
      return {
        cornerId: corner.id,
        style: 'round',
        centre: corner.point,
        primaryDimMm: dia,
        rationale: `Round relief Ø${dia.toFixed(2)} (${opts.roundDiameterFactor}t) for clean stress distribution at ${corner.angleDeg.toFixed(0)}° corner.`,
      };
    case 'square':
      return {
        cornerId: corner.id,
        style: 'square',
        centre: corner.point,
        primaryDimMm: dia,
        secondaryDimMm: dia,
        rationale: `Square notch ${dia.toFixed(2)} × ${dia.toFixed(2)} — fast to punch on shared tooling.`,
      };
    case 'v-notch':
      return {
        cornerId: corner.id,
        style: 'v-notch',
        centre: corner.point,
        primaryDimMm: dia,
        secondaryDimMm: dia * 1.5,
        rationale: `V-notch — acute ${corner.angleDeg.toFixed(0)}° corner; angled relief avoids material thinning.`,
      };
    case 'tear-drop':
      return {
        cornerId: corner.id,
        style: 'tear-drop',
        centre: corner.point,
        primaryDimMm: dia,
        secondaryDimMm: dia * opts.tearDropRatio,
        rationale: `Tear-drop (Ø${dia.toFixed(2)} + slot ${(dia * opts.tearDropRatio).toFixed(2)}) — accommodates form tolerance.`,
      };
  }
}

function pickStyle(corner: BendCorner, thicknessMm: number): ReliefStyle {
  if (corner.angleDeg < 60) return 'v-notch';
  if (corner.angleDeg > 120) return 'square';
  if (thicknessMm <= 1) return 'round';
  return 'tear-drop';
}

// ── Validation ─────────────────────────────────────────────────

export interface ReliefIssue {
  cornerId: string;
  severity: 'error' | 'warn';
  message: string;
}

export function validateReliefs(reliefs: Relief[], thicknessMm: number): ReliefIssue[] {
  const issues: ReliefIssue[] = [];
  for (const r of reliefs) {
    if (r.primaryDimMm < thicknessMm) {
      issues.push({ cornerId: r.cornerId, severity: 'error', message: `Primary dim ${r.primaryDimMm.toFixed(2)} mm < sheet thickness ${thicknessMm} mm. Will tear.` });
    } else if (r.primaryDimMm < thicknessMm * 1.5) {
      issues.push({ cornerId: r.cornerId, severity: 'warn', message: `Primary dim ${r.primaryDimMm.toFixed(2)} mm marginal (< 1.5t).` });
    }
  }
  return issues;
}

// ── Geometry emission ────────────────────────────────────────

export interface ReliefPolyline {
  cornerId: string;
  points: { x: number; y: number }[];
}

export function emitPolylines(reliefs: Relief[]): ReliefPolyline[] {
  return reliefs.map(r => {
    if (r.style === 'square') {
      const half = r.primaryDimMm / 2;
      return {
        cornerId: r.cornerId,
        points: [
          { x: r.centre.x - half, y: r.centre.y - half },
          { x: r.centre.x + half, y: r.centre.y - half },
          { x: r.centre.x + half, y: r.centre.y + half },
          { x: r.centre.x - half, y: r.centre.y + half },
          { x: r.centre.x - half, y: r.centre.y - half },
        ],
      };
    }
    if (r.style === 'round') {
      const segments = 24;
      const pts: { x: number; y: number }[] = [];
      for (let i = 0; i <= segments; i++) {
        const t = (i / segments) * Math.PI * 2;
        pts.push({ x: r.centre.x + Math.cos(t) * r.primaryDimMm / 2, y: r.centre.y + Math.sin(t) * r.primaryDimMm / 2 });
      }
      return { cornerId: r.cornerId, points: pts };
    }
    // tear-drop / v-notch — simplified polyline.
    const sec = r.secondaryDimMm ?? r.primaryDimMm;
    return {
      cornerId: r.cornerId,
      points: [
        { x: r.centre.x, y: r.centre.y },
        { x: r.centre.x + sec, y: r.centre.y },
        { x: r.centre.x + sec, y: r.centre.y + r.primaryDimMm },
        { x: r.centre.x, y: r.centre.y + r.primaryDimMm },
        { x: r.centre.x, y: r.centre.y },
      ],
    };
  });
}

// ── Summary ────────────────────────────────────────────────────

export interface ReliefSummary {
  reliefCount: number;
  byStyle: Record<ReliefStyle, number>;
  worstPrimaryDimMm: number;
  errorCount: number;
}

export function summarize(reliefs: Relief[], thicknessMm: number): ReliefSummary {
  const byStyle: Record<ReliefStyle, number> = { round: 0, square: 0, 'v-notch': 0, 'tear-drop': 0 };
  let worst = Infinity;
  for (const r of reliefs) {
    byStyle[r.style]++;
    if (r.primaryDimMm < worst) worst = r.primaryDimMm;
  }
  const issues = validateReliefs(reliefs, thicknessMm);
  return {
    reliefCount: reliefs.length,
    byStyle,
    worstPrimaryDimMm: reliefs.length === 0 ? 0 : worst,
    errorCount: issues.filter(i => i.severity === 'error').length,
  };
}
