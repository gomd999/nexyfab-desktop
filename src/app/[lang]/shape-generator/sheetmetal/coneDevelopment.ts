/**
 * coneDevelopment.ts — Flat-pattern development of a (truncated) cone.
 *
 * Frustum with base radius R, top radius r, vertical height h:
 *   side slant   s = √(h² + (R − r)²)
 *   apex slant   L = R · s / (R − r)        (full-cone slant to base)
 *   top slant    l = L − s = r · s / (R − r)
 *   sector angle θ = 2π · R / L              (so outer arc = base circumference)
 *   outer arc    = 2π · R,   inner arc = 2π · r
 *   blank area   = ½ · θ · (L² − l²)
 *
 * For a full cone (r = 0): L = √(h² + R²), l = 0, θ = 2π·R/L.
 */

export interface ConeDevInput {
  baseRadiusMm: number;          // R
  topRadiusMm: number;           // r (0 = full cone)
  heightMm: number;              // h
}

export interface ConeDevResult {
  sideSlantMm: number;           // s
  outerDevRadiusMm: number;      // L
  innerDevRadiusMm: number;      // l
  sectorAngleDeg: number;        // θ
  outerArcLengthMm: number;
  innerArcLengthMm: number;
  blankAreaMm2: number;
  warnings: string[];
}

export function compute(input: ConeDevInput): ConeDevResult {
  const warnings: string[] = [];
  const { baseRadiusMm: R, topRadiusMm: r, heightMm: h } = input;

  if (R <= 0) warnings.push('Base radius must be positive.');
  if (r < 0) warnings.push('Top radius must be non-negative.');
  if (r >= R) warnings.push('Top radius must be smaller than base radius (R > r).');
  if (h <= 0) warnings.push('Height must be positive.');

  const s = Math.sqrt(h * h + (R - r) * (R - r));
  const dr = R - r;
  const L = dr > 0 ? (R * s) / dr : Infinity;
  const l = dr > 0 ? (r * s) / dr : Infinity;

  const theta = L > 0 && Number.isFinite(L) ? (2 * Math.PI * R) / L : 0; // rad
  const blankArea = Number.isFinite(L) && Number.isFinite(l)
    ? 0.5 * theta * (L * L - l * l)
    : Infinity;

  return {
    sideSlantMm: s,
    outerDevRadiusMm: L,
    innerDevRadiusMm: l,
    sectorAngleDeg: theta * 180 / Math.PI,
    outerArcLengthMm: 2 * Math.PI * R,
    innerArcLengthMm: 2 * Math.PI * r,
    blankAreaMm2: blankArea,
    warnings,
  };
}

/** Half apex angle (deg) of the cone the frustum belongs to. */
export function apexHalfAngleDeg(input: ConeDevInput): number {
  const dr = input.baseRadiusMm - input.topRadiusMm;
  return Math.atan2(dr, input.heightMm) * 180 / Math.PI;
}

export function summarize(r: ConeDevResult): {
  outerDevRadiusMm: number; sectorAngleDeg: number; blankAreaMm2: number;
} {
  return { outerDevRadiusMm: r.outerDevRadiusMm, sectorAngleDeg: r.sectorAngleDeg, blankAreaMm2: r.blankAreaMm2 };
}
