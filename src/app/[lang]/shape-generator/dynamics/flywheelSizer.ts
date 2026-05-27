/**
 * flywheelSizer.ts — Size a flywheel to smooth speed fluctuation in a
 * machine with a fluctuating energy demand (press, engine, shear).
 *
 * The required mass moment of inertia from the coefficient of speed
 * fluctuation Cs and the energy swing ΔE over a cycle:
 *
 *   ΔE = I · ω_mean² · Cs       →    I = ΔE / (ω_mean² · Cs)
 *
 * where:
 *   Cs = (ω_max − ω_min) / ω_mean   (typical 0.002 generators … 0.2 presses)
 *   ω_mean = 2π·n/60   (n = rpm)
 *
 * For a solid disk: I = ½·m·r². For a rim-heavy wheel: I ≈ m·r² (mass at
 * rim). We solve the needed I, then the disk/rim mass for a chosen radius.
 */

export interface FlywheelInput {
  energySwingJ: number;        // ΔE over a cycle
  meanRpm: number;
  coefficientOfFluctuation: number; // Cs
  rimRadiusMm?: number;        // for mass solve
  geometry?: 'solid-disk' | 'rim';
}

export interface FlywheelResult {
  requiredInertiaKgM2: number;
  meanAngularVelocityRadS: number;
  kineticEnergyJ: number;      // mean KE = ½ I ω²
  diskMassKg: number | null;   // mass for the chosen radius + geometry
  maxRpm: number;
  minRpm: number;
  warnings: string[];
}

export function size(input: FlywheelInput): FlywheelResult {
  const warnings: string[] = [];
  if (input.meanRpm <= 0) warnings.push('Mean RPM must be positive.');
  if (input.coefficientOfFluctuation <= 0) warnings.push('Coefficient of fluctuation must be positive.');
  if (input.energySwingJ < 0) warnings.push('Energy swing must be non-negative.');

  const omega = (2 * Math.PI * input.meanRpm) / 60;
  const Cs = input.coefficientOfFluctuation;
  const I = (omega > 0 && Cs > 0) ? input.energySwingJ / (omega * omega * Cs) : 0;

  const ke = 0.5 * I * omega * omega;

  let diskMass: number | null = null;
  if (input.rimRadiusMm != null && input.rimRadiusMm > 0) {
    const r = input.rimRadiusMm / 1000; // m
    const geometry = input.geometry ?? 'solid-disk';
    // I = k·m·r² → m = I / (k·r²), k=0.5 disk, k=1 rim.
    const k = geometry === 'rim' ? 1 : 0.5;
    diskMass = I / (k * r * r);
  }

  // ω_max/min from Cs: Cs = (ωmax−ωmin)/ωmean, with mean midway.
  const omegaMax = omega * (1 + Cs / 2);
  const omegaMin = omega * (1 - Cs / 2);
  const maxRpm = omegaMax * 60 / (2 * Math.PI);
  const minRpm = omegaMin * 60 / (2 * Math.PI);

  return {
    requiredInertiaKgM2: I,
    meanAngularVelocityRadS: omega,
    kineticEnergyJ: ke,
    diskMassKg: diskMass,
    maxRpm,
    minRpm,
    warnings,
  };
}

/** Inertia of a solid disk (kg·m²). */
export function solidDiskInertia(massKg: number, radiusMm: number): number {
  const r = radiusMm / 1000;
  return 0.5 * massKg * r * r;
}

/** Rim hoop stress at speed (Pa) — bursting check: σ = ρ·v² = ρ·(ω·r)². */
export function rimHoopStressPa(densityKgM3: number, meanRpm: number, radiusMm: number): number {
  const omega = (2 * Math.PI * meanRpm) / 60;
  const v = omega * (radiusMm / 1000);
  return densityKgM3 * v * v;
}

export function summarize(r: FlywheelResult): { requiredInertiaKgM2: number; diskMassKg: number | null; kineticEnergyJ: number } {
  return { requiredInertiaKgM2: r.requiredInertiaKgM2, diskMassKg: r.diskMassKg, kineticEnergyJ: r.kineticEnergyJ };
}
