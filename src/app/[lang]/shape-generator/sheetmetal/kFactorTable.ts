/**
 * kFactorTable.ts — K-factor lookup for sheet metal bend allowance.
 *
 * The K-factor positions the neutral axis between the inner and
 * outer bend radii. It governs the bend allowance:
 *
 *     BA = θ × (R + K × T)
 *
 *   θ = bend angle (rad), R = inside radius, T = thickness, K = K-factor.
 *
 * The "right" K depends on three things: material (yield + work
 * hardening), thickness, and the **bend radius ratio R/T**. Stage-1
 * NexyFab shipped a flat 0.42 default — fine for first cut, but
 * wrong by 5-10% across the corner cases. This module ships a
 * proper interpolated table and lets fabricators dial in their own
 * empirical numbers per shop.
 *
 * Reference: ASM Metals Handbook + standard press-brake test plates.
 */

export type SheetMetalMaterial =
  | 'aluminum-5052'
  | 'aluminum-6061'
  | 'steel-cold-rolled'
  | 'steel-stainless-304'
  | 'steel-hot-rolled'
  | 'copper-c110'
  | 'brass-260';

/** K factor data, indexed by [R/T ratio]. Linear interpolated. */
const TABLE: Record<SheetMetalMaterial, Array<[number, number]>> = {
  // [R/T, K-factor]
  'aluminum-5052': [
    [0.5, 0.33], [1, 0.38], [2, 0.43], [3, 0.46], [5, 0.48], [10, 0.50],
  ],
  'aluminum-6061': [
    [0.5, 0.35], [1, 0.40], [2, 0.44], [3, 0.47], [5, 0.49], [10, 0.50],
  ],
  'steel-cold-rolled': [
    [0.5, 0.38], [1, 0.41], [2, 0.45], [3, 0.47], [5, 0.49], [10, 0.50],
  ],
  'steel-stainless-304': [
    [0.5, 0.36], [1, 0.40], [2, 0.43], [3, 0.45], [5, 0.47], [10, 0.49],
  ],
  'steel-hot-rolled': [
    [0.5, 0.40], [1, 0.43], [2, 0.46], [3, 0.47], [5, 0.49], [10, 0.50],
  ],
  'copper-c110': [
    [0.5, 0.32], [1, 0.37], [2, 0.41], [3, 0.44], [5, 0.46], [10, 0.48],
  ],
  'brass-260': [
    [0.5, 0.34], [1, 0.39], [2, 0.43], [3, 0.45], [5, 0.47], [10, 0.49],
  ],
};

export interface KFactorQuery {
  material: SheetMetalMaterial;
  /** Thickness (mm). */
  thicknessMm: number;
  /** Inside bend radius (mm). */
  insideRadiusMm: number;
}

export interface KFactorResult {
  kFactor: number;
  ratio: number;
  /** True when ratio fell outside the table range and we clamped. */
  extrapolated: boolean;
  source: 'table' | 'override';
}

/** User-supplied override map: shopId → material → R/T → K. Optional. */
export type KFactorOverrides = Partial<Record<SheetMetalMaterial, Array<[number, number]>>>;

function lookupK(table: Array<[number, number]>, ratio: number): { k: number; extrap: boolean } {
  if (ratio <= table[0]![0]) return { k: table[0]![1], extrap: true };
  const last = table[table.length - 1]!;
  if (ratio >= last[0]) return { k: last[1], extrap: true };
  for (let i = 0; i < table.length - 1; i++) {
    const [r0, k0] = table[i]!;
    const [r1, k1] = table[i + 1]!;
    if (ratio >= r0 && ratio <= r1) {
      const t = (ratio - r0) / (r1 - r0);
      return { k: k0 + t * (k1 - k0), extrap: false };
    }
  }
  return { k: last[1], extrap: true };
}

export function lookupKFactor(
  q: KFactorQuery,
  overrides?: KFactorOverrides,
): KFactorResult {
  if (q.thicknessMm <= 0) {
    return { kFactor: 0.42, ratio: 0, extrapolated: true, source: 'table' };
  }
  const ratio = q.insideRadiusMm / q.thicknessMm;
  const overrideTable = overrides?.[q.material];
  const table = overrideTable ?? TABLE[q.material];
  const { k, extrap } = lookupK(table, ratio);
  return {
    kFactor: Math.round(k * 1000) / 1000,
    ratio: Math.round(ratio * 1000) / 1000,
    extrapolated: extrap,
    source: overrideTable ? 'override' : 'table',
  };
}

/** Compute bend allowance (BA) — the flat length needed for a bend. */
export function bendAllowance(
  q: KFactorQuery,
  bendAngleRad: number,
  overrides?: KFactorOverrides,
): number {
  const { kFactor } = lookupKFactor(q, overrides);
  return bendAngleRad * (q.insideRadiusMm + kFactor * q.thicknessMm);
}

/** Bend deduction — the difference between the sum of flange lengths
 *  measured to the outside vs the actual flat blank length. Used by
 *  flat-pattern emitters that work from outside-to-outside dimensions. */
export function bendDeduction(
  q: KFactorQuery,
  bendAngleRad: number,
  overrides?: KFactorOverrides,
): number {
  // BD = 2 × OSSB - BA
  //   OSSB = (R + T) × tan(θ/2)
  const ossb = (q.insideRadiusMm + q.thicknessMm) * Math.tan(bendAngleRad / 2);
  return 2 * ossb - bendAllowance(q, bendAngleRad, overrides);
}
