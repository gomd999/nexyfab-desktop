/**
 * bendTable.ts — Per-shop bend-allowance override tables.
 *
 * The K-factor formula in sheetMetalTables is an *estimate*. Real
 * press-brake shops measure their own bend allowance per tool / die /
 * material combo and keep it in a spreadsheet. Many shops will rebuke
 * a quote if our flat pattern uses K-factor numbers instead of their
 * calibrated table values — variance of ±0.5mm on a 200mm flat blank
 * is enough to scrap a part with no relief margin.
 *
 * This module accepts user-supplied bend tables, performs lookup +
 * nearest-neighbour fallback, and falls back to the K-factor formula
 * only when no table entry is close enough. The downstream
 * `bendAllowance()` from sheetMetalTables stays the default; callers
 * opt into table lookup explicitly via `bendAllowanceWithTable`.
 *
 * Table format intentionally mirrors what a 1-person shop owner would
 * paste from Excel: material id, thickness, inner radius, angle, BA.
 */

import type { SheetMetalMaterial } from './sheetMetalTables';
import { bendAllowance as kFactorBendAllowance, getKFactor } from './sheetMetalTables';

export interface BendTableEntry {
  material: SheetMetalMaterial;
  /** Sheet thickness, mm. */
  thickness: number;
  /** Inner bend radius, mm. */
  innerRadius: number;
  /** Bend angle, degrees. */
  angle: number;
  /** Measured bend allowance, mm. */
  bendAllowance: number;
}

export interface BendTable {
  id: string;
  name: string;
  /** Shop / vendor that supplied the calibration data. */
  source?: string;
  entries: BendTableEntry[];
}

/** Maximum allowed delta for an exact match — anything tighter than
 *  this is a measurement-noise difference and we accept the table value. */
const EXACT_MATCH_TOL = {
  thickness: 0.01,
  innerRadius: 0.05,
  angle: 0.5,
};

function isExactMatch(
  entry: BendTableEntry,
  material: SheetMetalMaterial,
  thickness: number,
  innerRadius: number,
  angle: number,
): boolean {
  if (entry.material !== material) return false;
  if (Math.abs(entry.thickness - thickness) > EXACT_MATCH_TOL.thickness) return false;
  if (Math.abs(entry.innerRadius - innerRadius) > EXACT_MATCH_TOL.innerRadius) return false;
  if (Math.abs(entry.angle - angle) > EXACT_MATCH_TOL.angle) return false;
  return true;
}

/**
 * Look up the closest table entry for the requested (material, thickness,
 * innerRadius, angle). Returns null when:
 *  - no entry shares the material, OR
 *  - the closest candidate's parameter distance exceeds `maxDistance`
 *    (default 1.0 — roughly "off by 1mm thickness or 1° angle").
 *
 * Distance is the simple Euclidean over the normalised differences;
 * deliberately not weighted because shops keep tables dense enough
 * around the values they actually run.
 */
export function findBendTableMatch(
  table: BendTable,
  material: SheetMetalMaterial,
  thickness: number,
  innerRadius: number,
  angle: number,
  maxDistance = 1.0,
): { entry: BendTableEntry; exact: boolean; distance: number } | null {
  const candidates = table.entries.filter(e => e.material === material);
  if (candidates.length === 0) return null;

  // Exact match short-circuit.
  for (const e of candidates) {
    if (isExactMatch(e, material, thickness, innerRadius, angle)) {
      return { entry: e, exact: true, distance: 0 };
    }
  }

  // Nearest match.
  let best: { entry: BendTableEntry; distance: number } | null = null;
  for (const e of candidates) {
    const dt = (e.thickness - thickness) / Math.max(thickness, 0.5);
    const dr = (e.innerRadius - innerRadius) / Math.max(innerRadius, 0.5);
    const da = (e.angle - angle) / 90;
    const distance = Math.sqrt(dt * dt + dr * dr + da * da);
    if (!best || distance < best.distance) best = { entry: e, distance };
  }
  if (!best || best.distance > maxDistance) return null;
  return { entry: best.entry, exact: false, distance: best.distance };
}

/**
 * Resolve the bend allowance with optional table override. The lookup
 * priority is:
 *  1. Exact table match (within EXACT_MATCH_TOL).
 *  2. Nearest table match (within `maxTableDistance`).
 *  3. K-factor formula fallback using the material's curve.
 *
 * Returns both the resolved value and the source it came from so the
 * UI / quote pipeline can show "from shop table 'ABC'" vs "K-factor
 * estimate".
 */
export type BendAllowanceSource = 'table-exact' | 'table-nearest' | 'k-factor';

export interface BendAllowanceResult {
  value: number;
  source: BendAllowanceSource;
  /** When source = table-*, identifies the matched entry. */
  matchedEntry?: BendTableEntry;
  /** When source = table-nearest, the parameter distance to the match. */
  matchDistance?: number;
  /** When source = k-factor, the K value used. */
  kFactor?: number;
}

export function bendAllowanceWithTable(
  material: SheetMetalMaterial,
  thickness: number,
  innerRadius: number,
  angle: number,
  table?: BendTable | null,
  opts: { maxTableDistance?: number } = {},
): BendAllowanceResult {
  if (table) {
    const m = findBendTableMatch(
      table,
      material,
      thickness,
      innerRadius,
      angle,
      opts.maxTableDistance ?? 1.0,
    );
    if (m) {
      return {
        value: m.entry.bendAllowance,
        source: m.exact ? 'table-exact' : 'table-nearest',
        matchedEntry: m.entry,
        matchDistance: m.distance,
      };
    }
  }
  const k = getKFactor(material, innerRadius, thickness);
  return {
    value: kFactorBendAllowance(angle, innerRadius, thickness, k),
    source: 'k-factor',
    kFactor: k,
  };
}

/** Validate a bend table — useful when the user pastes one from Excel
 *  and we want to flag obvious data-entry errors before the lookup
 *  silently returns wrong numbers. */
export interface BendTableIssue {
  entryIndex: number;
  severity: 'warning' | 'error';
  messageKo: string;
  messageEn: string;
}

export function validateBendTable(table: BendTable): BendTableIssue[] {
  const out: BendTableIssue[] = [];
  for (let i = 0; i < table.entries.length; i++) {
    const e = table.entries[i];
    if (!(e.thickness > 0 && e.thickness <= 25)) {
      out.push({
        entryIndex: i, severity: 'error',
        messageKo: `행 ${i + 1}: 두께 ${e.thickness}mm는 유효 범위(0.1–25)를 벗어났습니다.`,
        messageEn: `Row ${i + 1}: thickness ${e.thickness}mm outside 0.1–25 range.`,
      });
    }
    if (!(e.innerRadius >= 0 && e.innerRadius <= 50)) {
      out.push({
        entryIndex: i, severity: 'error',
        messageKo: `행 ${i + 1}: 반경 ${e.innerRadius}mm는 유효 범위(0–50)를 벗어났습니다.`,
        messageEn: `Row ${i + 1}: radius ${e.innerRadius}mm outside 0–50 range.`,
      });
    }
    if (!(e.angle > 0 && e.angle <= 180)) {
      out.push({
        entryIndex: i, severity: 'error',
        messageKo: `행 ${i + 1}: 각도 ${e.angle}°는 유효 범위(0–180)를 벗어났습니다.`,
        messageEn: `Row ${i + 1}: angle ${e.angle}° outside 0–180 range.`,
      });
    }
    // Sanity: BA should never exceed the outside arc length of the bend.
    const maxBA = Math.PI * (e.innerRadius + e.thickness) * (e.angle / 180);
    if (e.bendAllowance > maxBA * 1.1) {
      out.push({
        entryIndex: i, severity: 'warning',
        messageKo: `행 ${i + 1}: BA ${e.bendAllowance.toFixed(2)}mm가 외경 호 길이 ${maxBA.toFixed(2)}mm를 초과합니다. 측정 오류 가능.`,
        messageEn: `Row ${i + 1}: BA ${e.bendAllowance.toFixed(2)}mm exceeds outside arc length ${maxBA.toFixed(2)}mm — measurement error likely.`,
      });
    }
  }
  return out;
}
