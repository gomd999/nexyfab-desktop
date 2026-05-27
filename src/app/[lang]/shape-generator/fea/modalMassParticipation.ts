/**
 * modalMassParticipation.ts — Modal mass participation factor per
 * mode for FEA modal analysis.
 *
 * After computing eigenvectors φᵢ and the consistent mass matrix M,
 * the *participation factor* Γᵢ for direction d̂ is:
 *
 *     Γᵢ = φᵢᵀ · M · d̂
 *
 * The *effective modal mass* Mᵢ_eff = Γᵢ² (mass-normalized
 * eigenvectors). The *cumulative participation* of the first N modes
 * tells you how much of the total mass is captured. Engineers must
 * include modes until cumulative ≥ 90% for response-spectrum
 * analysis.
 *
 * This module assumes:
 *
 *   - Mass-normalized eigenvectors (i.e., φᵢᵀ·M·φᵢ = 1).
 *   - A diagonal lumped mass matrix passed as a per-DOF vector.
 */

export interface Mode {
  index: number;
  /** Mass-normalized eigenvector. */
  eigenvector: number[];
  /** Natural frequency, Hz. */
  frequencyHz: number;
}

export interface ParticipationResult {
  /** Per-mode + per-direction participation factor Γ. */
  perMode: Array<{
    modeIndex: number;
    frequencyHz: number;
    gamma: { x: number; y: number; z: number };
    effectiveMass: { x: number; y: number; z: number };
  }>;
  /** Total mass per direction (sum of m·d²). */
  totalMass: { x: number; y: number; z: number };
  /** Cumulative effective-mass fraction per direction. */
  cumulativeFraction: Array<{
    modeIndex: number;
    fraction: { x: number; y: number; z: number };
  }>;
  /** Minimum mode count needed to reach `targetFraction` per direction. */
  modesToReachTarget: { x: number; y: number; z: number; targetFraction: number };
}

export interface ParticipationOptions {
  /** Cumulative target (default 0.9 = 90%). */
  targetFraction: number;
}

export const DEFAULT_OPTIONS: ParticipationOptions = {
  targetFraction: 0.9,
};

// ── Top-level entry ────────────────────────────────────────────

export function computeParticipation(
  modes: Mode[],
  massPerDof: number[],
  options: Partial<ParticipationOptions> = {},
): ParticipationResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  if (modes.length === 0 || massPerDof.length === 0) {
    return {
      perMode: [],
      totalMass: { x: 0, y: 0, z: 0 },
      cumulativeFraction: [],
      modesToReachTarget: { x: -1, y: -1, z: -1, targetFraction: opts.targetFraction },
    };
  }

  const dofCount = massPerDof.length;
  // Assume DOFs are flat (vertex × 3 axes). massPerDof aligns to vertices.
  // For simplicity treat each entry as belonging to one DOF; for direction
  // d̂ along X, the participation is Σ_v m_v · φᵢ(v).x.
  const totalMass = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < dofCount; i++) {
    totalMass.x += massPerDof[i]!;
    totalMass.y += massPerDof[i]!;
    totalMass.z += massPerDof[i]!;
  }

  const perMode: ParticipationResult['perMode'] = [];
  for (const mode of modes) {
    const ev = mode.eigenvector;
    let gx = 0, gy = 0, gz = 0;
    for (let v = 0; v < dofCount; v++) {
      const m = massPerDof[v]!;
      gx += m * (ev[v * 3] ?? 0);
      gy += m * (ev[v * 3 + 1] ?? 0);
      gz += m * (ev[v * 3 + 2] ?? 0);
    }
    perMode.push({
      modeIndex: mode.index,
      frequencyHz: mode.frequencyHz,
      gamma: { x: gx, y: gy, z: gz },
      effectiveMass: { x: gx * gx, y: gy * gy, z: gz * gz },
    });
  }

  // Cumulative fractions.
  const cumulative: ParticipationResult['cumulativeFraction'] = [];
  let cumX = 0, cumY = 0, cumZ = 0;
  for (const m of perMode) {
    cumX += m.effectiveMass.x;
    cumY += m.effectiveMass.y;
    cumZ += m.effectiveMass.z;
    cumulative.push({
      modeIndex: m.modeIndex,
      fraction: {
        x: totalMass.x > 0 ? cumX / totalMass.x : 0,
        y: totalMass.y > 0 ? cumY / totalMass.y : 0,
        z: totalMass.z > 0 ? cumZ / totalMass.z : 0,
      },
    });
  }

  // Find first mode index that crosses target per direction.
  const target = opts.targetFraction;
  const modesToReach = { x: -1, y: -1, z: -1, targetFraction: target };
  for (let i = 0; i < cumulative.length; i++) {
    if (modesToReach.x === -1 && cumulative[i]!.fraction.x >= target) modesToReach.x = i + 1;
    if (modesToReach.y === -1 && cumulative[i]!.fraction.y >= target) modesToReach.y = i + 1;
    if (modesToReach.z === -1 && cumulative[i]!.fraction.z >= target) modesToReach.z = i + 1;
  }

  return { perMode, totalMass, cumulativeFraction: cumulative, modesToReachTarget: modesToReach };
}

// ── Convergence helper ────────────────────────────────────────

export interface SufficiencyCheck {
  passesX: boolean;
  passesY: boolean;
  passesZ: boolean;
  worstFraction: number;
  recommendedAdditionalModes: number;
}

export function checkSufficiency(result: ParticipationResult): SufficiencyCheck {
  if (result.cumulativeFraction.length === 0) {
    return { passesX: false, passesY: false, passesZ: false, worstFraction: 0, recommendedAdditionalModes: 10 };
  }
  const last = result.cumulativeFraction[result.cumulativeFraction.length - 1]!.fraction;
  const target = result.modesToReachTarget.targetFraction;
  const passesX = last.x >= target;
  const passesY = last.y >= target;
  const passesZ = last.z >= target;
  const worst = Math.min(last.x, last.y, last.z);
  const gap = Math.max(0, target - worst);
  const additional = Math.ceil(gap * 100); // very rough estimate
  return {
    passesX, passesY, passesZ,
    worstFraction: worst,
    recommendedAdditionalModes: additional,
  };
}

// ── Summary ────────────────────────────────────────────────────

export interface ParticipationSummary {
  modeCount: number;
  totalMassX: number;
  finalCumulativeX: number;
  finalCumulativeY: number;
  finalCumulativeZ: number;
  passesTarget: boolean;
}

export function summarize(result: ParticipationResult): ParticipationSummary {
  const last = result.cumulativeFraction[result.cumulativeFraction.length - 1]?.fraction ?? { x: 0, y: 0, z: 0 };
  const target = result.modesToReachTarget.targetFraction;
  return {
    modeCount: result.perMode.length,
    totalMassX: result.totalMass.x,
    finalCumulativeX: last.x,
    finalCumulativeY: last.y,
    finalCumulativeZ: last.z,
    passesTarget: last.x >= target && last.y >= target && last.z >= target,
  };
}
