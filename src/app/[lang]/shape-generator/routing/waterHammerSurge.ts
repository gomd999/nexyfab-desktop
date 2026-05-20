/**
 * waterHammerSurge.ts — Compute water-hammer (pressure surge) from sudden
 * valve closure using the Joukowsky equation and the pressure-wave
 * speed in an elastic pipe.
 *
 * Wave speed (Korteweg):
 *   a = sqrt( (K/ρ) / (1 + (K·D)/(E·t)) )
 *
 * where K = fluid bulk modulus, ρ = density, D = pipe ID, E = pipe
 * modulus, t = wall.
 *
 * Joukowsky surge for instantaneous closure (closure time < 2L/a):
 *   Δp = ρ · a · Δv
 *
 * For gradual closure (t_close > 2L/a) the surge is reduced ≈ by the
 * ratio (2L/a)/t_close (Michaud). Critical closure time = 2L/a (the wave
 * round-trip). We report wave speed, full Joukowsky surge, the actual
 * surge for the given closure time, and whether closure is "rapid".
 */

export interface WaterHammerInput {
  flowVelocityMS: number;        // Δv (full stop assumed)
  pipeLengthMm: number;          // L
  pipeInnerDiameterMm: number;   // D
  wallThicknessMm: number;       // t
  fluidDensityKgM3: number;      // ρ
  fluidBulkModulusPa: number;    // K (water ≈ 2.2e9)
  pipeYoungPa: number;           // E
  closureTimeSec?: number;       // valve close time; instantaneous if omitted
}

export interface WaterHammerResult {
  waveSpeedMS: number;
  criticalClosureTimeSec: number; // 2L/a
  joukowskySurgePa: number;       // instantaneous
  actualSurgePa: number;          // adjusted for closure time
  isRapidClosure: boolean;
  surgeHeadM: number;             // actual surge in metres of fluid
  warnings: string[];
}

const G = 9.80665;

export function compute(input: WaterHammerInput): WaterHammerResult {
  const warnings: string[] = [];
  const rho = input.fluidDensityKgM3;
  const K = input.fluidBulkModulusPa;
  const E = input.pipeYoungPa;
  const D = input.pipeInnerDiameterMm / 1000; // m
  const t = input.wallThicknessMm / 1000;     // m
  const L = input.pipeLengthMm / 1000;        // m
  if (rho <= 0 || K <= 0) warnings.push('Density and bulk modulus must be positive.');
  if (t <= 0) warnings.push('Wall thickness must be positive.');

  // Korteweg wave speed.
  const denom = 1 + (K * D) / (E * t);
  const a = denom > 0 ? Math.sqrt((K / rho) / denom) : 0;

  const tCrit = a > 0 ? (2 * L) / a : Infinity;

  const joukowsky = rho * a * input.flowVelocityMS;

  let actual = joukowsky;
  let rapid = true;
  if (input.closureTimeSec != null && input.closureTimeSec > 0) {
    rapid = input.closureTimeSec <= tCrit;
    if (!rapid) {
      // Michaud reduction for slow closure.
      actual = joukowsky * (tCrit / input.closureTimeSec);
    }
  }

  const surgeHeadM = rho > 0 ? actual / (rho * G) : 0;

  if (rapid && input.closureTimeSec != null) {
    warnings.push(`Closure ${input.closureTimeSec}s ≤ critical ${tCrit.toFixed(3)}s: full Joukowsky surge. Slow the valve or add a surge tank/accumulator.`);
  }

  return {
    waveSpeedMS: a,
    criticalClosureTimeSec: tCrit,
    joukowskySurgePa: joukowsky,
    actualSurgePa: actual,
    isRapidClosure: rapid,
    surgeHeadM,
    warnings,
  };
}

/** Minimum valve closure time to keep surge below a target pressure. */
export function minClosureTimeForSurge(input: WaterHammerInput, targetSurgePa: number): number {
  const r = compute({ ...input, closureTimeSec: undefined as unknown as number });
  if (targetSurgePa >= r.joukowskySurgePa) return r.criticalClosureTimeSec;
  if (targetSurgePa <= 0) return Infinity;
  // actual = joukowsky·(tCrit/tClose) ≤ target → tClose ≥ joukowsky·tCrit/target
  return (r.joukowskySurgePa * r.criticalClosureTimeSec) / targetSurgePa;
}

export function summarize(r: WaterHammerResult): { waveSpeedMS: number; actualSurgePa: number; isRapidClosure: boolean } {
  return { waveSpeedMS: r.waveSpeedMS, actualSurgePa: r.actualSurgePa, isRapidClosure: r.isRapidClosure };
}
