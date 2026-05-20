/**
 * diffuserThrow.ts — Estimate the throw, drop, and terminal velocity of
 * an air diffuser jet for room air distribution layout.
 *
 * Throw (T) = distance from the diffuser to where the jet decays to a
 * terminal velocity (typically 0.25 or 0.5 m/s). For a compact jet the
 * centre-line velocity decays as:
 *
 *   V_x / V_0 = K · sqrt(A_0) / x        (x = distance, A_0 = effective area)
 *
 * Solving for the throw to a terminal velocity V_t:
 *
 *   T = K · sqrt(A_0) · V_0 / V_t
 *
 * K is the diffuser throw constant (≈ 1.2–1.4 free jet; lower for spread
 * patterns). "Drop" is how far a cold jet falls before reaching the
 * occupied zone — driven by buoyancy (Archimedes number).
 */

export interface DiffuserThrowInput {
  faceVelocityMS: number;     // V_0 at the diffuser face
  effectiveAreaMm2: number;   // A_0
  throwConstant?: number;     // K, default 1.3
  terminalVelocityMS?: number;// V_t, default 0.25
  supplyTempC?: number;       // for drop / Archimedes
  roomTempC?: number;
  mountingHeightMm?: number;
}

export interface DiffuserThrowResult {
  throwM: number;
  terminalVelocityMS: number;
  archimedesNumber: number | null; // > 0 cold (drops), < 0 warm (rises)
  estimatedDropM: number | null;
  reachesOccupiedZone: boolean | null;
  warnings: string[];
}

export function compute(input: DiffuserThrowInput): DiffuserThrowResult {
  const warnings: string[] = [];
  if (input.faceVelocityMS <= 0) warnings.push('Face velocity must be positive.');
  if (input.effectiveAreaMm2 <= 0) warnings.push('Effective area must be positive.');

  const K = input.throwConstant ?? 1.3;
  const Vt = input.terminalVelocityMS ?? 0.25;
  const A0_m2 = input.effectiveAreaMm2 * 1e-6;

  // Throw: T = K·√A0·V0 / Vt   (metres)
  const throwM = Vt > 0 ? (K * Math.sqrt(A0_m2) * input.faceVelocityMS) / Vt : 0;

  let archimedes: number | null = null;
  let drop: number | null = null;
  let reaches: boolean | null = null;
  if (input.supplyTempC != null && input.roomTempC != null) {
    const dT = input.roomTempC - input.supplyTempC; // positive = cold supply
    const g = 9.80665;
    const Tabs = (input.roomTempC + 273.15);
    // Ar = g·√A0·ΔT / (V0²·T_abs)
    archimedes = (g * Math.sqrt(A0_m2) * dT) / (input.faceVelocityMS * input.faceVelocityMS * Tabs);
    // Empirical drop estimate over the throw distance.
    drop = Math.max(0, archimedes) * throwM * 2;
    if (input.mountingHeightMm != null) {
      const occupiedTopM = (input.mountingHeightMm / 1000) - 1.8; // occupied zone top ~1.8 m
      reaches = drop >= occupiedTopM;
    }
  }

  return {
    throwM,
    terminalVelocityMS: Vt,
    archimedesNumber: archimedes,
    estimatedDropM: drop,
    reachesOccupiedZone: reaches,
    warnings,
  };
}

/** Required face velocity to hit a target throw. */
export function faceVelocityForThrow(targetThrowM: number, effectiveAreaMm2: number, throwConstant: number = 1.3, terminalVelocityMS: number = 0.25): number {
  const A0_m2 = effectiveAreaMm2 * 1e-6;
  const denom = throwConstant * Math.sqrt(A0_m2);
  return denom > 0 ? (targetThrowM * terminalVelocityMS) / denom : 0;
}

export function summarize(r: DiffuserThrowResult): { throwM: number; estimatedDropM: number | null } {
  return { throwM: r.throwM, estimatedDropM: r.estimatedDropM };
}
