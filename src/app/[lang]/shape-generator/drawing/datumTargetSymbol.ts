/**
 * datumTargetSymbol.ts — Lay out ASME Y14.5 datum target symbols: the
 * circular callout (split top/bottom) plus the target geometry on the
 * part (point ✕, line, or area circle/rectangle).
 *
 * A datum target callout is a circle divided by a horizontal line:
 *   - bottom half: the datum letter + target number (e.g. "A1")
 *   - top half (area targets): the target size (e.g. "Ø6")
 *
 * Target geometry types:
 *   - point : drawn as an ✕
 *   - line  : a phantom line between two points
 *   - area  : a hatched circle (Ø) or rectangle (the contact patch)
 *
 * We compute the callout circle placement (offset from the target with a
 * leader) and the target marker geometry.
 */

export interface Point2D { x: number; y: number }

export type TargetType = 'point' | 'line' | 'area-circle' | 'area-rect';

export interface DatumTargetInput {
  datumLetter: string;   // "A"
  targetNumber: number;  // 1, 2, 3 ...
  type: TargetType;
  location: Point2D;     // primary target location on the part
  secondaryLocation?: Point2D; // for line targets (the other end)
  areaDiameterMm?: number;     // for area-circle
  areaWidthMm?: number;        // for area-rect
  areaHeightMm?: number;       // for area-rect
  calloutOffsetMm?: number;    // leader length to the callout circle, default 15
  calloutRadiusMm?: number;    // default 5
}

export interface DatumTargetResult {
  calloutCircle: { centre: Point2D; radiusMm: number };
  calloutTopText: string;    // size for area targets, else ""
  calloutBottomText: string; // "A1"
  leaderStart: Point2D;      // on the target
  leaderEnd: Point2D;        // on the callout circle
  targetMarker: { type: TargetType; geometry: Point2D[] };
  warnings: string[];
}

export function build(input: DatumTargetInput): DatumTargetResult {
  const warnings: string[] = [];
  if (!input.datumLetter) warnings.push('Datum letter is required.');
  if (input.targetNumber <= 0) warnings.push('Target number should be positive.');

  const offset = input.calloutOffsetMm ?? 15;
  const radius = input.calloutRadiusMm ?? 5;

  const bottom = `${input.datumLetter}${input.targetNumber}`;
  let top = '';
  const geometry: Point2D[] = [];

  switch (input.type) {
    case 'point':
      geometry.push(...crossMarker(input.location, 2));
      break;
    case 'line':
      if (!input.secondaryLocation) {
        warnings.push('Line target needs a secondary location.');
        geometry.push(input.location);
      } else {
        geometry.push(input.location, input.secondaryLocation);
      }
      break;
    case 'area-circle':
      if (!input.areaDiameterMm || input.areaDiameterMm <= 0) warnings.push('Area-circle target needs a positive diameter.');
      top = `Ø${formatNum(input.areaDiameterMm ?? 0)}`;
      geometry.push(...circleMarker(input.location, (input.areaDiameterMm ?? 0) / 2, 16));
      break;
    case 'area-rect':
      if (!input.areaWidthMm || !input.areaHeightMm) warnings.push('Area-rect target needs width and height.');
      top = `${formatNum(input.areaWidthMm ?? 0)}×${formatNum(input.areaHeightMm ?? 0)}`;
      geometry.push(...rectMarker(input.location, input.areaWidthMm ?? 0, input.areaHeightMm ?? 0));
      break;
  }

  // Callout circle placed up-right of the target by `offset`.
  const dir = { x: Math.SQRT1_2, y: Math.SQRT1_2 };
  const calloutCentre = { x: input.location.x + dir.x * offset, y: input.location.y + dir.y * offset };
  const leaderEnd = { x: calloutCentre.x - dir.x * radius, y: calloutCentre.y - dir.y * radius };

  return {
    calloutCircle: { centre: calloutCentre, radiusMm: radius },
    calloutTopText: top,
    calloutBottomText: bottom,
    leaderStart: input.location,
    leaderEnd,
    targetMarker: { type: input.type, geometry },
    warnings,
  };
}

function crossMarker(c: Point2D, size: number): Point2D[] {
  return [
    { x: c.x - size, y: c.y - size }, { x: c.x + size, y: c.y + size },
    { x: c.x - size, y: c.y + size }, { x: c.x + size, y: c.y - size },
  ];
}

function circleMarker(c: Point2D, r: number, steps: number): Point2D[] {
  const pts: Point2D[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    pts.push({ x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) });
  }
  return pts;
}

function rectMarker(c: Point2D, w: number, h: number): Point2D[] {
  const hw = w / 2, hh = h / 2;
  return [
    { x: c.x - hw, y: c.y - hh }, { x: c.x + hw, y: c.y - hh },
    { x: c.x + hw, y: c.y + hh }, { x: c.x - hw, y: c.y + hh },
    { x: c.x - hw, y: c.y - hh },
  ];
}

function formatNum(n: number): string {
  return Number.isInteger(n) ? `${n}` : n.toFixed(2).replace(/\.?0+$/, '');
}

/** Full callout label, e.g. "Ø6 / A1". */
export function fullLabel(result: DatumTargetResult): string {
  return result.calloutTopText ? `${result.calloutTopText} / ${result.calloutBottomText}` : result.calloutBottomText;
}

export function summarize(r: DatumTargetResult): { label: string; type: TargetType } {
  return { label: r.calloutBottomText, type: r.targetMarker.type };
}
