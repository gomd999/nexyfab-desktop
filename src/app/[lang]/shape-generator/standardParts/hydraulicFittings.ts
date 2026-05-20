/**
 * hydraulicFittings.ts — Hydraulic / pneumatic standard fittings.
 *
 * Hydraulic systems use a different standard family than
 * mechanical fasteners. Common standards:
 *
 *   - **ISO 6149** — metric thread O-ring port (industry preferred
 *     for new designs).
 *   - **SAE J1926 / SAE J514** — ANSI inch UN/UNF straight thread
 *     O-ring boss.
 *   - **BSPP (ISO 228)** — British parallel pipe thread, common
 *     in EU + Asia.
 *   - **JIS B 2351** — Japan/Korea metric flare.
 *
 * Each spec defines: thread type, port profile, sealing method,
 * pressure rating, body material.
 */

export type HydraulicStandard = 'ISO 6149' | 'SAE J1926' | 'BSPP' | 'JIS B 2351';

export type FittingShape =
  | 'straight'   // M-F adapter
  | 'elbow-90'
  | 'elbow-45'
  | 'tee'
  | 'cross'
  | 'reducer'
  | 'cap'        // plug
  | 'plug'       // male thread cap
  | 'flange';    // 4-bolt code-61/62

export interface HydraulicFitting {
  standard: HydraulicStandard;
  shape: FittingShape;
  /** Nominal thread size (e.g. "M10x1.0", "1/4-19" BSPP). */
  threadSize: string;
  /** Nominal flow size — usually equal to bore (mm). */
  boreMm: number;
  /** Working pressure rating (bar). */
  workingPressureBar: number;
  /** Material — typically steel / stainless. */
  material: 'steel-zinc' | 'stainless-316' | 'brass';
  /** Sealing method. */
  seal: 'o-ring' | 'flare' | 'metal-on-metal' | 'tapered-pipe';
}

/** Sample catalog — covers the most common low-pressure ports. */
export const HYDRAULIC_CATALOG: ReadonlyArray<HydraulicFitting> = [
  // ISO 6149 (M-port O-ring)
  { standard: 'ISO 6149', shape: 'straight', threadSize: 'M10x1.0',  boreMm:  5, workingPressureBar: 350, material: 'steel-zinc', seal: 'o-ring' },
  { standard: 'ISO 6149', shape: 'straight', threadSize: 'M12x1.5',  boreMm:  6, workingPressureBar: 350, material: 'steel-zinc', seal: 'o-ring' },
  { standard: 'ISO 6149', shape: 'straight', threadSize: 'M16x1.5',  boreMm:  8, workingPressureBar: 350, material: 'steel-zinc', seal: 'o-ring' },
  { standard: 'ISO 6149', shape: 'straight', threadSize: 'M22x1.5',  boreMm: 12, workingPressureBar: 350, material: 'steel-zinc', seal: 'o-ring' },
  { standard: 'ISO 6149', shape: 'elbow-90', threadSize: 'M16x1.5',  boreMm:  8, workingPressureBar: 350, material: 'steel-zinc', seal: 'o-ring' },
  { standard: 'ISO 6149', shape: 'tee',      threadSize: 'M16x1.5',  boreMm:  8, workingPressureBar: 350, material: 'steel-zinc', seal: 'o-ring' },

  // SAE J1926 (inch UN/UNF O-ring boss)
  { standard: 'SAE J1926', shape: 'straight', threadSize: '7/16-20 UNF',  boreMm:  6, workingPressureBar: 240, material: 'steel-zinc', seal: 'o-ring' },
  { standard: 'SAE J1926', shape: 'straight', threadSize: '9/16-18 UNF',  boreMm:  8, workingPressureBar: 240, material: 'steel-zinc', seal: 'o-ring' },
  { standard: 'SAE J1926', shape: 'straight', threadSize: '3/4-16 UNF',   boreMm: 12, workingPressureBar: 240, material: 'steel-zinc', seal: 'o-ring' },
  { standard: 'SAE J1926', shape: 'elbow-90', threadSize: '9/16-18 UNF',  boreMm:  8, workingPressureBar: 240, material: 'steel-zinc', seal: 'o-ring' },

  // BSPP (ISO 228 parallel pipe)
  { standard: 'BSPP', shape: 'straight', threadSize: 'G 1/8',  boreMm:  5, workingPressureBar: 160, material: 'brass', seal: 'metal-on-metal' },
  { standard: 'BSPP', shape: 'straight', threadSize: 'G 1/4',  boreMm:  8, workingPressureBar: 160, material: 'brass', seal: 'metal-on-metal' },
  { standard: 'BSPP', shape: 'elbow-90', threadSize: 'G 1/4',  boreMm:  8, workingPressureBar: 160, material: 'brass', seal: 'metal-on-metal' },

  // JIS B 2351 (Japan/Korea flare)
  { standard: 'JIS B 2351', shape: 'straight', threadSize: 'M12x1.5',  boreMm:  6, workingPressureBar: 210, material: 'steel-zinc', seal: 'flare' },
  { standard: 'JIS B 2351', shape: 'straight', threadSize: 'M18x1.5',  boreMm: 10, workingPressureBar: 210, material: 'steel-zinc', seal: 'flare' },
];

/** Find fittings matching size + standard. */
export function findHydraulicFittings(
  query: { standard?: HydraulicStandard; shape?: FittingShape; minBoreMm?: number; maxBoreMm?: number },
): HydraulicFitting[] {
  return HYDRAULIC_CATALOG.filter(f => {
    if (query.standard && f.standard !== query.standard) return false;
    if (query.shape && f.shape !== query.shape) return false;
    if (query.minBoreMm != null && f.boreMm < query.minBoreMm) return false;
    if (query.maxBoreMm != null && f.boreMm > query.maxBoreMm) return false;
    return true;
  });
}

/** Recommend a fitting size for a given flow rate (L/min).
 *  Rule of thumb: keep velocity < 6 m/s for pressure lines,
 *  < 4 m/s for return, < 1.2 m/s for suction. */
export function recommendFittingForFlow(
  flowLpm: number,
  lineKind: 'pressure' | 'return' | 'suction',
): HydraulicFitting | null {
  const maxVelMs: Record<typeof lineKind, number> = {
    pressure: 6,
    return: 4,
    suction: 1.2,
  };
  const v = maxVelMs[lineKind];
  // Q = A · v. A = π · (d/2)². d = 2 · √(Q / (π · v))
  // Convert L/min to m³/s.
  const qM3s = flowLpm / 1000 / 60;
  const dMin = 2 * Math.sqrt(qM3s / (Math.PI * v)) * 1000; // mm
  return HYDRAULIC_CATALOG
    .filter(f => f.shape === 'straight' && f.boreMm >= dMin)
    .sort((a, b) => a.boreMm - b.boreMm)[0] ?? null;
}
