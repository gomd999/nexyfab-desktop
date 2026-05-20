/**
 * breakLineGenerator.ts — Generate "break lines" used to shorten a long
 * uniform part on a drawing so it fits the sheet, per ANSI Y14.2.
 *
 * A conventional break removes a middle segment of a part and joins the
 * two remaining ends with a break symbol. Styles:
 *
 *   - zigzag      : straight line with a Z kink (long-break, thin line)
 *   - cylindrical : S-curve pair (used on round bars/tubes)
 *   - freehand    : wavy line (short-break, thick line)
 *
 * Given the part axis (start→end), a break interval [t0, t1] along the
 * axis (0..1), and a break width (perpendicular extent), we emit the two
 * break-symbol polylines and report the removed length + new drawn length.
 */

export interface Point2D { x: number; y: number }

export type BreakStyle = 'zigzag' | 'cylindrical' | 'freehand';

export interface BreakLineInput {
  axisStart: Point2D;
  axisEnd: Point2D;
  widthMm: number;       // perpendicular extent of the part at the break
  breakStartFrac: number; // t0 in [0,1)
  breakEndFrac: number;   // t1 in (t0,1]
  style: BreakStyle;
  amplitudeMm?: number;  // zigzag/freehand bump size, default width*0.15
}

export interface BreakLineResult {
  breakSymbols: Point2D[][]; // one or two polylines
  removedLengthMm: number;
  drawnLengthMm: number;
  style: BreakStyle;
  warnings: string[];
}

export function generate(input: BreakLineInput): BreakLineResult {
  const warnings: string[] = [];
  const dx = input.axisEnd.x - input.axisStart.x;
  const dy = input.axisEnd.y - input.axisStart.y;
  const axisLen = Math.hypot(dx, dy);
  if (axisLen < 1e-9) {
    return { breakSymbols: [], removedLengthMm: 0, drawnLengthMm: 0, style: input.style, warnings: ['Axis has zero length.'] };
  }
  if (input.breakEndFrac <= input.breakStartFrac) warnings.push('breakEndFrac must exceed breakStartFrac.');
  if (input.widthMm <= 0) warnings.push('Width must be positive.');

  const ux = dx / axisLen, uy = dy / axisLen;
  const px = -uy, py = ux; // perpendicular unit
  const amp = input.amplitudeMm ?? input.widthMm * 0.15;
  const half = input.widthMm / 2;

  const t0 = Math.max(0, Math.min(1, input.breakStartFrac));
  const t1 = Math.max(0, Math.min(1, input.breakEndFrac));
  const removed = Math.max(0, (t1 - t0)) * axisLen;

  const pointAt = (t: number, perpOffset: number): Point2D => ({
    x: input.axisStart.x + ux * (t * axisLen) + px * perpOffset,
    y: input.axisStart.y + uy * (t * axisLen) + py * perpOffset,
  });

  const breakSymbols: Point2D[][] = [];
  if (input.style === 'zigzag') {
    breakSymbols.push(zigzagSymbol(pointAt, t0, half, amp));
    breakSymbols.push(zigzagSymbol(pointAt, t1, half, amp));
  } else if (input.style === 'cylindrical') {
    breakSymbols.push(cylindricalSymbol(pointAt, t0, half, amp));
    breakSymbols.push(cylindricalSymbol(pointAt, t1, half, amp));
  } else {
    breakSymbols.push(freehandSymbol(pointAt, t0, half, amp));
    breakSymbols.push(freehandSymbol(pointAt, t1, half, amp));
  }

  const drawnLength = axisLen - removed;
  return { breakSymbols, removedLengthMm: removed, drawnLengthMm: drawnLength, style: input.style, warnings };
}

function zigzagSymbol(pointAt: (t: number, o: number) => Point2D, t: number, half: number, amp: number): Point2D[] {
  // straight across with a single Z kink in the middle
  const kinkT = t;
  return [
    pointAt(kinkT, -half),
    pointAt(kinkT, -amp),
    pointAt(kinkT + amp / 1000, amp), // tiny axial nudge for the Z
    pointAt(kinkT, half),
  ];
}

function cylindricalSymbol(pointAt: (t: number, o: number) => Point2D, t: number, half: number, amp: number): Point2D[] {
  // S-curve: top half bulges one way, bottom half the other
  const pts: Point2D[] = [];
  const steps = 12;
  for (let i = 0; i <= steps; i++) {
    const frac = i / steps;
    const offset = -half + frac * 2 * half;
    const bulge = Math.sin(frac * 2 * Math.PI) * amp;
    pts.push(pointAt(t + bulge / 1000, offset));
  }
  return pts;
}

function freehandSymbol(pointAt: (t: number, o: number) => Point2D, t: number, half: number, amp: number): Point2D[] {
  // wavy line across the width
  const pts: Point2D[] = [];
  const steps = 16;
  for (let i = 0; i <= steps; i++) {
    const frac = i / steps;
    const offset = -half + frac * 2 * half;
    const wave = Math.sin(frac * 6 * Math.PI) * amp;
    pts.push(pointAt(t + wave / 1000, offset));
  }
  return pts;
}

export function summarize(r: BreakLineResult): { style: BreakStyle; removedLengthMm: number; drawnLengthMm: number } {
  return { style: r.style, removedLengthMm: r.removedLengthMm, drawnLengthMm: r.drawnLengthMm };
}
