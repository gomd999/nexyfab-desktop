/**
 * cuttingForceEstimator.ts — Estimate cutting forces during milling.
 *
 * Mechanistic cutting force model (Altintas / Kienzle):
 *
 *   F_tangential = kc · b · h
 *   F_normal     = kr · F_tangential
 *
 * where:
 *   kc = specific cutting force = kc1.1 · h^(-mc)
 *   b  = chip width (axial DOC)
 *   h  = chip thickness (function of feed-per-tooth and engagement
 *        angle)
 *
 * For each cutter rotation, the force varies because chip thickness
 * varies along the cutting arc. Module reports:
 *
 *   - Peak tangential / normal force.
 *   - Average force.
 *   - RMS force (driving fatigue).
 *   - Spindle torque (force × tool radius).
 */

export interface ToolParams {
  diameterMm: number;
  flutes: number;
  /** Helix angle (deg). */
  helixDeg: number;
}

export interface MaterialParams {
  /** Specific cutting force coefficient kc1.1 (N/mm²). */
  kc11: number;
  /** Kienzle exponent (typ 0.2-0.3). */
  mc: number;
  /** Normal/tangential ratio kr (typ 0.3-0.5). */
  kr: number;
}

export interface MillingCut {
  /** Axial depth of cut (mm). */
  axialDocMm: number;
  /** Radial DOC / engagement (mm). */
  radialDocMm: number;
  /** Feed per tooth (mm). */
  feedPerToothMm: number;
  /** Spindle RPM. */
  rpm: number;
}

export interface ForceResult {
  /** Peak tangential force (N). */
  peakTangentialN: number;
  /** Peak normal force (N). */
  peakNormalN: number;
  /** Average force over rotation (N). */
  averageForceN: number;
  /** RMS force (N). */
  rmsForceN: number;
  /** Spindle torque (N·m). */
  spindleTorqueNm: number;
  /** Spindle power (W). */
  spindlePowerW: number;
  warnings: string[];
}

// ── Top-level entry ────────────────────────────────────────────

export function estimateForce(tool: ToolParams, material: MaterialParams, cut: MillingCut): ForceResult {
  const warnings: string[] = [];
  const radius = tool.diameterMm / 2;
  const engagementAngleRad = computeEngagementAngle(cut.radialDocMm, radius);

  if (engagementAngleRad <= 0 || radius <= 0) {
    warnings.push('Invalid engagement geometry.');
    return { peakTangentialN: 0, peakNormalN: 0, averageForceN: 0, rmsForceN: 0, spindleTorqueNm: 0, spindlePowerW: 0, warnings };
  }

  // Sample around engagement arc.
  const samples = 36;
  const forces: number[] = [];
  let maxF = 0;
  for (let i = 0; i <= samples; i++) {
    const phi = (i / samples) * engagementAngleRad;
    const h = cut.feedPerToothMm * Math.sin(phi);
    if (h <= 0) { forces.push(0); continue; }
    const kc = material.kc11 / Math.pow(h, material.mc);
    const ft = kc * cut.axialDocMm * h;
    forces.push(ft);
    if (ft > maxF) maxF = ft;
  }
  // Per tooth force × number of teeth engaged simultaneously.
  const teethEngaged = Math.max(1, (engagementAngleRad / (2 * Math.PI)) * tool.flutes);
  const peakTan = maxF * teethEngaged;
  const peakNor = peakTan * material.kr;
  const avgPerSample = forces.reduce((s, v) => s + v, 0) / Math.max(1, forces.length);
  const avgForce = avgPerSample * teethEngaged;
  const rms = Math.sqrt(forces.reduce((s, v) => s + v * v, 0) / Math.max(1, forces.length)) * teethEngaged;
  const torqueNm = (avgForce * radius) / 1000;
  const omega = (2 * Math.PI * cut.rpm) / 60;
  const powerW = torqueNm * omega;
  return {
    peakTangentialN: peakTan,
    peakNormalN: peakNor,
    averageForceN: avgForce,
    rmsForceN: rms,
    spindleTorqueNm: torqueNm,
    spindlePowerW: powerW,
    warnings,
  };
}

function computeEngagementAngle(radialDoc: number, radius: number): number {
  if (radius <= 0 || radialDoc <= 0) return 0;
  const ae = Math.min(2 * radius, radialDoc);
  const arg = 1 - ae / radius;
  return Math.acos(Math.max(-1, Math.min(1, arg)));
}

// ── Force budget vs machine limits ───────────────────────────

export interface ForceBudget {
  withinLimit: boolean;
  utilisationPct: number;
}

export function checkBudget(result: ForceResult, maxAllowableN: number): ForceBudget {
  return {
    withinLimit: result.peakTangentialN <= maxAllowableN,
    utilisationPct: (result.peakTangentialN / Math.max(0.01, maxAllowableN)) * 100,
  };
}

// ── Material kc table ────────────────────────────────────────

export const DEFAULT_MATERIALS: Record<string, MaterialParams> = {
  'aluminum-6061': { kc11: 800, mc: 0.25, kr: 0.3 },
  'steel-1018': { kc11: 2000, mc: 0.25, kr: 0.4 },
  'stainless-304': { kc11: 2400, mc: 0.30, kr: 0.45 },
  'titanium-Ti6Al4V': { kc11: 2100, mc: 0.30, kr: 0.40 },
  'inconel-718': { kc11: 3000, mc: 0.30, kr: 0.50 },
};

// ── Summary ────────────────────────────────────────────────────

export interface ForceSummary {
  peakTangentialN: number;
  averageForceN: number;
  spindlePowerW: number;
  warningCount: number;
}

export function summarize(result: ForceResult): ForceSummary {
  return {
    peakTangentialN: result.peakTangentialN,
    averageForceN: result.averageForceN,
    spindlePowerW: result.spindlePowerW,
    warningCount: result.warnings.length,
  };
}
