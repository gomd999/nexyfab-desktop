/**
 * chamferDimensionCallout.ts — Build the dimension callout text + leader
 * geometry for a chamfer per ASME Y14.5 / ISO 3040.
 *
 * Chamfer callout styles:
 *   - "C2"          : 45° chamfer, leg 2 mm (ISO short form, 45° only)
 *   - "2 × 45°"     : leg × angle (explicit)
 *   - "2 × 3"       : leg × leg (for non-45° where both legs dimensioned)
 *   - "2 × 30°"     : leg × angle for non-45°
 *
 * The "C" prefix form is ONLY valid for 45° chamfers. For other angles
 * the leg×angle (or leg×leg) form is required. We pick the right form,
 * compute the second leg for a given angle, and emit a leader from the
 * chamfer face midpoint to a text anchor.
 */

export interface Point2D { x: number; y: number }

export type ChamferCalloutStyle = 'C-prefix' | 'leg-angle' | 'leg-leg';

export interface ChamferCalloutInput {
  legMm: number;        // the dimensioned leg (along the reference face)
  angleDeg: number;     // chamfer angle from the reference face
  style?: ChamferCalloutStyle; // auto if omitted
  chamferMidpoint: Point2D;     // on the chamfer face
  leaderDirection?: Point2D;    // text placement direction, default up-right
  leaderLengthMm?: number;      // default 10
}

export interface ChamferCalloutResult {
  text: string;
  styleUsed: ChamferCalloutStyle;
  secondLegMm: number;          // the other leg (perpendicular reference)
  leaderStart: Point2D;
  leaderEnd: Point2D;
  textAnchor: Point2D;
  warnings: string[];
}

export function build(input: ChamferCalloutInput): ChamferCalloutResult {
  const warnings: string[] = [];
  if (input.legMm <= 0) warnings.push('Leg length must be positive.');
  if (input.angleDeg <= 0 || input.angleDeg >= 90) warnings.push('Chamfer angle should be between 0° and 90°.');

  const is45 = Math.abs(input.angleDeg - 45) < 1e-6;
  // Pick style: C-prefix only valid for 45°.
  let style = input.style ?? (is45 ? 'C-prefix' : 'leg-angle');
  if (style === 'C-prefix' && !is45) {
    warnings.push('C-prefix form is only valid for 45° chamfers; switching to leg-angle.');
    style = 'leg-angle';
  }

  // second leg = leg × tan(angle) measured against the reference face.
  const secondLeg = input.legMm * Math.tan((90 - input.angleDeg) * Math.PI / 180);

  let text: string;
  switch (style) {
    case 'C-prefix':
      text = `C${formatNum(input.legMm)}`;
      break;
    case 'leg-angle':
      text = `${formatNum(input.legMm)} × ${formatNum(input.angleDeg)}°`;
      break;
    case 'leg-leg':
      text = `${formatNum(input.legMm)} × ${formatNum(secondLeg)}`;
      break;
  }

  const dir = normalize(input.leaderDirection ?? { x: 1, y: 1 });
  const len = input.leaderLengthMm ?? 10;
  const leaderStart = input.chamferMidpoint;
  const leaderEnd = { x: leaderStart.x + dir.x * len, y: leaderStart.y + dir.y * len };
  const textAnchor = { x: leaderEnd.x + dir.x * 2, y: leaderEnd.y + dir.y * 2 };

  return { text, styleUsed: style, secondLegMm: secondLeg, leaderStart, leaderEnd, textAnchor, warnings };
}

function formatNum(n: number): string {
  return Number.isInteger(n) ? `${n}` : n.toFixed(2).replace(/\.?0+$/, '');
}

function normalize(v: Point2D): Point2D {
  const len = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / len, y: v.y / len };
}

/** Validate that a measured chamfer matches the called-out dimension within tol. */
export function validateChamfer(calloutLegMm: number, calloutAngleDeg: number, measuredLegMm: number, measuredAngleDeg: number, legTolMm: number, angleTolDeg: number): { ok: boolean; legOk: boolean; angleOk: boolean } {
  const legOk = Math.abs(measuredLegMm - calloutLegMm) <= legTolMm + 1e-9;
  const angleOk = Math.abs(measuredAngleDeg - calloutAngleDeg) <= angleTolDeg + 1e-9;
  return { ok: legOk && angleOk, legOk, angleOk };
}

export function summarize(r: ChamferCalloutResult): { text: string; styleUsed: ChamferCalloutStyle } {
  return { text: r.text, styleUsed: r.styleUsed };
}
