/**
 * torqueSpecGenerator.ts — Generate a torque specification table for
 * threaded fasteners in an assembly.
 *
 * For each fastener in the BOM, the module computes the recommended
 * tightening torque based on:
 *
 *   - Bolt size (M3..M30, #4..#1, 1/4"..1") with thread pitch.
 *   - Property class (4.6, 8.8, 10.9, 12.9 for metric; SAE 2/5/8 for
 *     imperial).
 *   - Friction coefficient (lubricated, dry, plated).
 *   - Joint type (through-bolt, blind, gasketed, anti-vibration).
 *
 * Formula (Shigley):
 *
 *   T = K · F_clamp · d
 *
 * where K is the nut factor (0.18 lubricated → 0.25 dry), F_clamp is
 * the target preload (usually 75% of proof load), and d is nominal
 * thread diameter.
 *
 * Output is a sortable table for the drawing's notes / shop floor.
 */

export type Metric = 'M3' | 'M4' | 'M5' | 'M6' | 'M8' | 'M10' | 'M12' | 'M16' | 'M20' | 'M24' | 'M30';
export type PropertyClass = '4.6' | '8.8' | '10.9' | '12.9' | 'A2-70' | 'A4-80';

export interface BoltSizeData {
  size: Metric;
  nominalDiameterMm: number;
  pitchMm: number;
  /** Stress area (mm²) per ISO 898-1. */
  stressAreaMm2: number;
}

export const METRIC_SIZES: Record<Metric, BoltSizeData> = {
  M3: { size: 'M3', nominalDiameterMm: 3, pitchMm: 0.5, stressAreaMm2: 5.03 },
  M4: { size: 'M4', nominalDiameterMm: 4, pitchMm: 0.7, stressAreaMm2: 8.78 },
  M5: { size: 'M5', nominalDiameterMm: 5, pitchMm: 0.8, stressAreaMm2: 14.2 },
  M6: { size: 'M6', nominalDiameterMm: 6, pitchMm: 1.0, stressAreaMm2: 20.1 },
  M8: { size: 'M8', nominalDiameterMm: 8, pitchMm: 1.25, stressAreaMm2: 36.6 },
  M10: { size: 'M10', nominalDiameterMm: 10, pitchMm: 1.5, stressAreaMm2: 58.0 },
  M12: { size: 'M12', nominalDiameterMm: 12, pitchMm: 1.75, stressAreaMm2: 84.3 },
  M16: { size: 'M16', nominalDiameterMm: 16, pitchMm: 2.0, stressAreaMm2: 157 },
  M20: { size: 'M20', nominalDiameterMm: 20, pitchMm: 2.5, stressAreaMm2: 245 },
  M24: { size: 'M24', nominalDiameterMm: 24, pitchMm: 3.0, stressAreaMm2: 353 },
  M30: { size: 'M30', nominalDiameterMm: 30, pitchMm: 3.5, stressAreaMm2: 561 },
};

/** Proof strength (MPa) per ISO 898-1 / A2-70. */
export const PROOF_STRENGTH_MPA: Record<PropertyClass, number> = {
  '4.6': 225,
  '8.8': 580,
  '10.9': 830,
  '12.9': 970,
  'A2-70': 450,
  'A4-80': 600,
};

export type JointType = 'through-bolt' | 'blind' | 'gasketed' | 'anti-vibration' | 'critical';

export interface FastenerEntry {
  id: string;
  size: Metric;
  propertyClass: PropertyClass;
  /** Number of identical fasteners (used in BOM rollup). */
  count: number;
  joint: JointType;
  /** Friction condition. */
  lubrication: 'dry' | 'lubricated' | 'plated' | 'anti-seize';
}

export interface TorqueSpec {
  id: string;
  size: Metric;
  propertyClass: PropertyClass;
  nutFactor: number;
  preloadKn: number;
  torqueNm: number;
  preloadFractionOfProof: number;
  warning?: string;
}

// ── Top-level entry ────────────────────────────────────────────

export function generateTorqueSpecs(fasteners: FastenerEntry[]): TorqueSpec[] {
  return fasteners.map(computeSpec);
}

function computeSpec(f: FastenerEntry): TorqueSpec {
  const size = METRIC_SIZES[f.size];
  const proof = PROOF_STRENGTH_MPA[f.propertyClass];
  const k = nutFactor(f.lubrication);
  // Target preload: 75% of proof load (default joint).
  let preloadFraction = 0.75;
  if (f.joint === 'gasketed') preloadFraction = 0.50;
  if (f.joint === 'anti-vibration') preloadFraction = 0.90;
  if (f.joint === 'critical') preloadFraction = 0.65;
  const preloadKn = preloadFraction * proof * size.stressAreaMm2 / 1000;
  const torqueNm = k * preloadKn * 1000 * size.nominalDiameterMm / 1000;
  const spec: TorqueSpec = {
    id: f.id,
    size: f.size,
    propertyClass: f.propertyClass,
    nutFactor: k,
    preloadKn,
    torqueNm,
    preloadFractionOfProof: preloadFraction,
  };
  if (f.joint === 'gasketed' && f.lubrication === 'dry') {
    spec.warning = 'Gasketed joint with dry threads: torque scatter ±25%; consider plated or lubricated.';
  }
  return spec;
}

function nutFactor(lub: FastenerEntry['lubrication']): number {
  switch (lub) {
    case 'dry': return 0.25;
    case 'lubricated': return 0.18;
    case 'plated': return 0.20;
    case 'anti-seize': return 0.16;
  }
}

// ── BOM-level rollup ──────────────────────────────────────────

export interface TorqueTotal {
  totalFasteners: number;
  totalTorqueWorkNm: number;
  bySize: Record<Metric, number>;
}

export function rollup(fasteners: FastenerEntry[], specs: TorqueSpec[]): TorqueTotal {
  const bySize: Record<Metric, number> = {
    M3: 0, M4: 0, M5: 0, M6: 0, M8: 0, M10: 0, M12: 0, M16: 0, M20: 0, M24: 0, M30: 0,
  };
  let total = 0;
  let totalTorque = 0;
  for (let i = 0; i < fasteners.length; i++) {
    const f = fasteners[i]!;
    const spec = specs[i]!;
    bySize[f.size] += f.count;
    total += f.count;
    totalTorque += spec.torqueNm * f.count;
  }
  return { totalFasteners: total, totalTorqueWorkNm: totalTorque, bySize };
}

// ── Format for drawing note ───────────────────────────────────

export function formatNoteTable(specs: TorqueSpec[]): string[] {
  const lines: string[] = ['SIZE | CLASS | TORQUE (N·m) | PRELOAD (kN)'];
  for (const s of specs) {
    lines.push(`${s.size} | ${s.propertyClass} | ${s.torqueNm.toFixed(1)} | ${s.preloadKn.toFixed(1)}`);
  }
  return lines;
}

// ── Summary ────────────────────────────────────────────────────

export interface TorqueSummary {
  fastenerCount: number;
  maxTorqueNm: number;
  minTorqueNm: number;
  warningCount: number;
}

export function summarize(specs: TorqueSpec[]): TorqueSummary {
  if (specs.length === 0) {
    return { fastenerCount: 0, maxTorqueNm: 0, minTorqueNm: 0, warningCount: 0 };
  }
  let maxT = 0;
  let minT = Infinity;
  let warn = 0;
  for (const s of specs) {
    if (s.torqueNm > maxT) maxT = s.torqueNm;
    if (s.torqueNm < minT) minT = s.torqueNm;
    if (s.warning) warn++;
  }
  return { fastenerCount: specs.length, maxTorqueNm: maxT, minTorqueNm: minT, warningCount: warn };
}
