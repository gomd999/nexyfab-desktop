/**
 * toolHolderLibrary.ts — Catalog of CNC tool holder specs.
 *
 * The holder is the mechanical interface between the spindle and
 * the cutting tool. Common families:
 *
 *   - **BT** (Japan): BT30 / BT40 / BT50 — 7/24 taper.
 *   - **CAT/CT** (USA): CAT40 / CAT50 — same taper, different
 *     pull-stud thread.
 *   - **HSK** (Germany, hollow shank): HSK63 / HSK100.
 *   - **ER collet** chucks: ER16 / ER20 / ER25 / ER32.
 *
 * Each spec carries:
 *
 *   - Body diameter at the gauge plane.
 *   - Length (top of taper → nose).
 *   - Pull stud thread.
 *   - Coolant-through capability.
 *   - Max RPM.
 *   - Balance grade (G2.5, G6.3, G16) for VHC.
 *
 * Used to verify a chosen tool fits the spindle + to estimate
 * holder clearance during toolpath collision checks.
 */

export type HolderFamily = 'BT' | 'CAT' | 'HSK' | 'ER';

export interface HolderSpec {
  id: string;
  family: HolderFamily;
  /** Designation (e.g., "BT40", "HSK63A", "ER32"). */
  designation: string;
  /** Gauge-line diameter (mm). */
  gaugeDiameterMm: number;
  /** Total length, gauge → nose (mm). */
  lengthMm: number;
  /** Max safe RPM. */
  maxRpm: number;
  /** Balance grade (G2.5 = 2.5, G6.3 = 6.3, etc.). */
  balanceGrade: number;
  /** Has coolant-through capability. */
  coolantThrough: boolean;
  /** Pull-stud thread label (BT/CAT only). */
  pullStudThread?: string;
  /** ER nominal collet size mm. */
  collectNominalMm?: number;
}

// ── Built-in catalog ───────────────────────────────────────────

export const HOLDER_LIBRARY: HolderSpec[] = [
  { id: 'BT30', family: 'BT', designation: 'BT30', gaugeDiameterMm: 31.75, lengthMm: 60, maxRpm: 15000, balanceGrade: 6.3, coolantThrough: true, pullStudThread: 'M12' },
  { id: 'BT40', family: 'BT', designation: 'BT40', gaugeDiameterMm: 44.45, lengthMm: 65, maxRpm: 12000, balanceGrade: 6.3, coolantThrough: true, pullStudThread: 'M16' },
  { id: 'BT50', family: 'BT', designation: 'BT50', gaugeDiameterMm: 69.85, lengthMm: 100, maxRpm: 8000, balanceGrade: 16, coolantThrough: true, pullStudThread: 'M24' },
  { id: 'CAT40', family: 'CAT', designation: 'CAT40', gaugeDiameterMm: 44.45, lengthMm: 65, maxRpm: 12000, balanceGrade: 6.3, coolantThrough: true, pullStudThread: '5/8-11' },
  { id: 'CAT50', family: 'CAT', designation: 'CAT50', gaugeDiameterMm: 69.85, lengthMm: 100, maxRpm: 8000, balanceGrade: 16, coolantThrough: true, pullStudThread: '1-8' },
  { id: 'HSK63A', family: 'HSK', designation: 'HSK63A', gaugeDiameterMm: 48, lengthMm: 60, maxRpm: 18000, balanceGrade: 2.5, coolantThrough: true },
  { id: 'HSK100A', family: 'HSK', designation: 'HSK100A', gaugeDiameterMm: 75, lengthMm: 80, maxRpm: 14000, balanceGrade: 2.5, coolantThrough: true },
  { id: 'ER16', family: 'ER', designation: 'ER16', gaugeDiameterMm: 17, lengthMm: 40, maxRpm: 20000, balanceGrade: 6.3, coolantThrough: false, collectNominalMm: 10 },
  { id: 'ER20', family: 'ER', designation: 'ER20', gaugeDiameterMm: 21, lengthMm: 50, maxRpm: 18000, balanceGrade: 6.3, coolantThrough: true, collectNominalMm: 13 },
  { id: 'ER25', family: 'ER', designation: 'ER25', gaugeDiameterMm: 26, lengthMm: 60, maxRpm: 15000, balanceGrade: 6.3, coolantThrough: true, collectNominalMm: 16 },
  { id: 'ER32', family: 'ER', designation: 'ER32', gaugeDiameterMm: 33, lengthMm: 70, maxRpm: 12000, balanceGrade: 6.3, coolantThrough: true, collectNominalMm: 20 },
];

// ── Lookup ─────────────────────────────────────────────────────

export function getByDesignation(designation: string): HolderSpec | null {
  return HOLDER_LIBRARY.find(h => h.designation === designation) ?? null;
}

export function listByFamily(family: HolderFamily): HolderSpec[] {
  return HOLDER_LIBRARY.filter(h => h.family === family);
}

// ── Compatibility check ───────────────────────────────────────

export interface CompatibilityCheck {
  /** Spindle / machine interface. */
  spindleFamily: HolderFamily;
  /** Spindle max RPM. */
  spindleMaxRpm: number;
  /** Required cutter shank diameter (mm). */
  cutterShankMm?: number;
  /** Required coolant-through capability. */
  coolantThroughRequired: boolean;
}

export interface CompatibilityResult {
  compatible: boolean;
  reasons: string[];
}

export function checkCompatibility(holder: HolderSpec, check: CompatibilityCheck): CompatibilityResult {
  const reasons: string[] = [];
  if (holder.family !== check.spindleFamily) {
    reasons.push(`Holder family ${holder.family} does not match spindle ${check.spindleFamily}.`);
  }
  if (holder.maxRpm < check.spindleMaxRpm * 0.5) {
    reasons.push(`Holder maxRpm ${holder.maxRpm} much lower than spindle ${check.spindleMaxRpm}.`);
  }
  if (check.coolantThroughRequired && !holder.coolantThrough) {
    reasons.push('Coolant-through required but holder does not support it.');
  }
  if (holder.family === 'ER' && check.cutterShankMm !== undefined && holder.collectNominalMm !== undefined) {
    if (check.cutterShankMm > holder.collectNominalMm) {
      reasons.push(`Cutter shank ${check.cutterShankMm}mm exceeds collet ${holder.collectNominalMm}mm.`);
    }
  }
  return { compatible: reasons.length === 0, reasons };
}

// ── Recommend ─────────────────────────────────────────────────

export function recommendHolder(check: CompatibilityCheck): HolderSpec | null {
  const candidates = listByFamily(check.spindleFamily)
    .filter(h => checkCompatibility(h, check).compatible)
    .sort((a, b) => a.gaugeDiameterMm - b.gaugeDiameterMm);
  return candidates[0] ?? null;
}

// ── Summary ────────────────────────────────────────────────────

export interface CatalogSummary {
  totalHolders: number;
  familyCounts: Record<HolderFamily, number>;
  maxRpmInCatalog: number;
  bestBalanceGrade: number;
}

export function summarize(): CatalogSummary {
  const counts: Record<HolderFamily, number> = { BT: 0, CAT: 0, HSK: 0, ER: 0 };
  let maxRpm = 0;
  let bestBalance = Infinity;
  for (const h of HOLDER_LIBRARY) {
    counts[h.family]++;
    if (h.maxRpm > maxRpm) maxRpm = h.maxRpm;
    if (h.balanceGrade < bestBalance) bestBalance = h.balanceGrade;
  }
  return {
    totalHolders: HOLDER_LIBRARY.length,
    familyCounts: counts,
    maxRpmInCatalog: maxRpm,
    bestBalanceGrade: bestBalance,
  };
}
