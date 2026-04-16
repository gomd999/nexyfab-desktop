/**
 * Sheet metal material tables and bend formulas.
 *
 * Industry reference values (not a specific supplier spec). K-factors are the
 * commonly cited ranges from Machinery's Handbook / LinuxCNC / SolidWorks
 * defaults; minimum inner bend radius factors come from common press-brake
 * tolerance tables. A real shop will calibrate these against their own tooling
 * and material certs, so every lookup function exposes overrides.
 */

export type SheetMetalMaterial =
  | 'mildSteel'      // SPCC / 연강
  | 'stainless304'   // STS304 / SUS304
  | 'aluminum5052'   // AL5052 / 알루미늄
  | 'aluminum6061'   // AL6061
  | 'galvanized'     // 아연도금강판 (SGCC)
  | 'brass'          // 황동 C2680
  | 'copper';        // 동판 C1100

export interface SheetMetalMaterialInfo {
  id: SheetMetalMaterial;
  labelKo: string;
  labelEn: string;
  /** kg/m³ */
  density: number;
  /** Tensile strength N/mm² — used later for cut-time heuristics */
  tensileStrength: number;
  /** Minimum inner bend radius as a multiple of thickness (R_min = factor × T) */
  minBendRadiusFactor: number;
  /**
   * K-factor curve points as [innerRadius/thickness, k]. We linearly interpolate
   * between points, clamping at the ends. Source: empirical press-brake tables
   * for air bending — sharp bends pull K toward 0.33, wide radii push it toward
   * the neutral-fiber limit of ~0.5.
   */
  kFactorCurve: Array<{ rt: number; k: number }>;
}

// ─── Material database ─────────────────────────────────────────────────────

export const SHEET_METAL_MATERIALS: Record<SheetMetalMaterial, SheetMetalMaterialInfo> = {
  mildSteel: {
    id: 'mildSteel',
    labelKo: '연강 (SPCC)',
    labelEn: 'Mild Steel (SPCC)',
    density: 7850,
    tensileStrength: 270,
    minBendRadiusFactor: 1.0,
    kFactorCurve: [
      { rt: 0.5, k: 0.38 },
      { rt: 1.0, k: 0.42 },
      { rt: 2.0, k: 0.44 },
      { rt: 4.0, k: 0.47 },
      { rt: 10.0, k: 0.50 },
    ],
  },
  stainless304: {
    id: 'stainless304',
    labelKo: '스테인리스 STS304',
    labelEn: 'Stainless STS304',
    density: 8000,
    tensileStrength: 520,
    minBendRadiusFactor: 1.5,
    kFactorCurve: [
      { rt: 0.5, k: 0.33 },
      { rt: 1.0, k: 0.38 },
      { rt: 2.0, k: 0.43 },
      { rt: 4.0, k: 0.46 },
      { rt: 10.0, k: 0.50 },
    ],
  },
  aluminum5052: {
    id: 'aluminum5052',
    labelKo: '알루미늄 AL5052',
    labelEn: 'Aluminum 5052',
    density: 2680,
    tensileStrength: 230,
    minBendRadiusFactor: 1.0,
    kFactorCurve: [
      { rt: 0.5, k: 0.40 },
      { rt: 1.0, k: 0.43 },
      { rt: 2.0, k: 0.46 },
      { rt: 4.0, k: 0.48 },
      { rt: 10.0, k: 0.50 },
    ],
  },
  aluminum6061: {
    id: 'aluminum6061',
    labelKo: '알루미늄 AL6061',
    labelEn: 'Aluminum 6061',
    density: 2700,
    tensileStrength: 310,
    minBendRadiusFactor: 1.5,
    kFactorCurve: [
      { rt: 0.5, k: 0.36 },
      { rt: 1.0, k: 0.40 },
      { rt: 2.0, k: 0.43 },
      { rt: 4.0, k: 0.47 },
      { rt: 10.0, k: 0.50 },
    ],
  },
  galvanized: {
    id: 'galvanized',
    labelKo: '아연도금강판 (SGCC)',
    labelEn: 'Galvanized Steel (SGCC)',
    density: 7850,
    tensileStrength: 300,
    minBendRadiusFactor: 1.0,
    kFactorCurve: [
      { rt: 0.5, k: 0.40 },
      { rt: 1.0, k: 0.44 },
      { rt: 2.0, k: 0.46 },
      { rt: 4.0, k: 0.48 },
      { rt: 10.0, k: 0.50 },
    ],
  },
  brass: {
    id: 'brass',
    labelKo: '황동 C2680',
    labelEn: 'Brass C2680',
    density: 8530,
    tensileStrength: 350,
    minBendRadiusFactor: 0.5,
    kFactorCurve: [
      { rt: 0.5, k: 0.42 },
      { rt: 1.0, k: 0.45 },
      { rt: 2.0, k: 0.47 },
      { rt: 4.0, k: 0.49 },
      { rt: 10.0, k: 0.50 },
    ],
  },
  copper: {
    id: 'copper',
    labelKo: '동판 C1100',
    labelEn: 'Copper C1100',
    density: 8960,
    tensileStrength: 220,
    minBendRadiusFactor: 0.5,
    kFactorCurve: [
      { rt: 0.5, k: 0.42 },
      { rt: 1.0, k: 0.45 },
      { rt: 2.0, k: 0.47 },
      { rt: 4.0, k: 0.49 },
      { rt: 10.0, k: 0.50 },
    ],
  },
};

export const DEFAULT_MATERIAL: SheetMetalMaterial = 'mildSteel';

// ─── K-factor lookup ────────────────────────────────────────────────────────

/**
 * Return the K-factor for air bending at inner radius / thickness ratio, using
 * linear interpolation between tabulated curve points. For the classic formula
 *
 *     BA = π · (R + K · T) · A / 180
 *
 * this is the K that matches the material's neutral-axis shift.
 */
export function getKFactor(
  material: SheetMetalMaterial,
  innerRadius: number,
  thickness: number,
): number {
  if (thickness <= 0) return 0.44;
  const info = SHEET_METAL_MATERIALS[material] ?? SHEET_METAL_MATERIALS[DEFAULT_MATERIAL];
  const rt = innerRadius / thickness;
  const curve = info.kFactorCurve;

  if (rt <= curve[0].rt) return curve[0].k;
  if (rt >= curve[curve.length - 1].rt) return curve[curve.length - 1].k;

  for (let i = 0; i < curve.length - 1; i++) {
    const a = curve[i];
    const b = curve[i + 1];
    if (rt >= a.rt && rt <= b.rt) {
      const f = (rt - a.rt) / (b.rt - a.rt);
      return a.k + (b.k - a.k) * f;
    }
  }
  return 0.44;
}

// ─── Bend allowance & deduction ─────────────────────────────────────────────

/**
 * Bend Allowance — arc length of the neutral fiber through the bend region.
 *   BA = π · (R + K·T) · A / 180    (A in degrees)
 */
export function bendAllowance(
  angle: number,
  innerRadius: number,
  thickness: number,
  kFactor: number,
): number {
  return Math.PI * (innerRadius + kFactor * thickness) * (angle / 180);
}

/**
 * Outside setback — distance from the bend tangent to the outside-mold-line
 * apex. For angles ≤ 90° this is straightforward; for > 90° we use the
 * complement so the formula stays on the correct side of the tangent.
 *   OSSB = tan(A/2) · (R + T)       (A in degrees)
 */
export function outsideSetback(
  angle: number,
  innerRadius: number,
  thickness: number,
): number {
  const a = (angle * Math.PI) / 180;
  return Math.tan(a / 2) * (innerRadius + thickness);
}

/**
 * Bend Deduction — the number you subtract from the sum of outside dimensions
 * to get the flat blank length.
 *   BD = 2·OSSB − BA
 */
export function bendDeduction(
  angle: number,
  innerRadius: number,
  thickness: number,
  kFactor: number,
): number {
  return 2 * outsideSetback(angle, innerRadius, thickness)
       - bendAllowance(angle, innerRadius, thickness, kFactor);
}

// ─── Validation ─────────────────────────────────────────────────────────────

export interface SheetMetalBendWarning {
  severity: 'warning' | 'error';
  code: 'radiusTooSmall' | 'angleOutOfRange' | 'thicknessOutOfRange';
  messageKo: string;
  messageEn: string;
}

/**
 * Check a single bend against the material's minimum bend radius and sane
 * parameter ranges. Caller decides whether to block or merely warn.
 */
export function validateBend(
  material: SheetMetalMaterial,
  thickness: number,
  innerRadius: number,
  angle: number,
): SheetMetalBendWarning[] {
  const out: SheetMetalBendWarning[] = [];
  const info = SHEET_METAL_MATERIALS[material] ?? SHEET_METAL_MATERIALS[DEFAULT_MATERIAL];
  const minR = info.minBendRadiusFactor * thickness;

  if (innerRadius < minR - 1e-6) {
    out.push({
      severity: 'error',
      code: 'radiusTooSmall',
      messageKo: `내측 반경 ${innerRadius.toFixed(2)}mm가 최소 허용값 ${minR.toFixed(2)}mm 미만입니다 (${info.labelKo}, 두께 ${thickness}mm). 크랙이 발생할 수 있습니다.`,
      messageEn: `Inner radius ${innerRadius.toFixed(2)}mm is below the minimum ${minR.toFixed(2)}mm for ${info.labelEn} at ${thickness}mm thickness. Cracking likely.`,
    });
  }
  if (angle <= 0 || angle > 180) {
    out.push({
      severity: 'error',
      code: 'angleOutOfRange',
      messageKo: `굽힘 각도 ${angle}°는 유효 범위(0–180°)를 벗어났습니다.`,
      messageEn: `Bend angle ${angle}° outside valid range (0–180°).`,
    });
  }
  if (thickness <= 0 || thickness > 25) {
    out.push({
      severity: 'warning',
      code: 'thicknessOutOfRange',
      messageKo: `두께 ${thickness}mm는 일반 프레스 브레이크 범위를 벗어납니다.`,
      messageEn: `Thickness ${thickness}mm is outside typical press-brake range.`,
    });
  }
  return out;
}
