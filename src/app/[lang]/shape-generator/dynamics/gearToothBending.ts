/**
 * gearToothBending.ts — Spur-gear tooth root bending stress via the Lewis
 * equation (with a velocity/Barth dynamic factor), and the bending safety
 * factor against an allowable stress.
 *
 *   tangential force  Wt = 2·T / d_pitch          (T in N·mm, d in mm → N)
 *   Lewis bending     σ  = Wt / (b · m · Y)        (Y = Lewis form factor)
 *   dynamic factor    Kv = (A + √v)/A  (Barth) or 6/(6+v) form
 *   design stress     σ_d = σ · Kv · Ko            (Ko overload)
 *
 * Y depends on tooth count + pressure angle; we use a small lookup +
 * interpolation for 20° full-depth teeth.
 */

export interface GearToothInput {
  torqueNm: number;
  pitchDiameterMm: number;
  moduleMm: number;
  faceWidthMm: number;
  toothCount: number;
  rotationalSpeedRpm: number;
  allowableStressMpa: number;
  overloadFactor?: number;     // Ko, default 1.25
  pressureAngleDeg?: number;   // default 20
}

export interface GearToothResult {
  tangentialForceN: number;
  pitchLineVelocityMS: number;
  lewisFormFactorY: number;
  dynamicFactorKv: number;
  bendingStressMpa: number;     // including Kv + Ko
  safetyFactor: number;
  passes: boolean;
  warnings: string[];
}

// Lewis form factor Y for 20° full-depth, by tooth count.
const LEWIS_Y: { teeth: number; Y: number }[] = [
  { teeth: 12, Y: 0.245 }, { teeth: 14, Y: 0.277 }, { teeth: 17, Y: 0.303 },
  { teeth: 20, Y: 0.322 }, { teeth: 25, Y: 0.340 }, { teeth: 30, Y: 0.358 },
  { teeth: 40, Y: 0.389 }, { teeth: 50, Y: 0.408 }, { teeth: 60, Y: 0.421 },
  { teeth: 100, Y: 0.446 }, { teeth: 400, Y: 0.480 },
];

export function lewisFormFactor(teeth: number): number {
  if (teeth <= LEWIS_Y[0]!.teeth) return LEWIS_Y[0]!.Y;
  const last = LEWIS_Y[LEWIS_Y.length - 1]!;
  if (teeth >= last.teeth) return last.Y;
  for (let i = 1; i < LEWIS_Y.length; i++) {
    const a = LEWIS_Y[i - 1]!, b = LEWIS_Y[i]!;
    if (teeth <= b.teeth) {
      const t = (teeth - a.teeth) / (b.teeth - a.teeth);
      return a.Y + t * (b.Y - a.Y);
    }
  }
  return last.Y;
}

export function compute(input: GearToothInput): GearToothResult {
  const warnings: string[] = [];
  if (input.pitchDiameterMm <= 0) warnings.push('Pitch diameter must be positive.');
  if (input.faceWidthMm <= 0 || input.moduleMm <= 0) warnings.push('Face width and module must be positive.');

  const Wt = input.pitchDiameterMm > 0 ? (input.torqueNm * 1000 * 2) / input.pitchDiameterMm : 0; // N
  const v = (Math.PI * (input.pitchDiameterMm / 1000) * input.rotationalSpeedRpm) / 60; // m/s
  const Y = lewisFormFactor(input.toothCount);

  // Barth dynamic factor (commercial-cut gears): Kv = (6.1 + v)/6.1.
  const Kv = (6.1 + v) / 6.1;
  const Ko = input.overloadFactor ?? 1.25;

  const sigmaLewis = (input.faceWidthMm * input.moduleMm * Y) > 0
    ? Wt / (input.faceWidthMm * input.moduleMm * Y)
    : Infinity;
  const sigmaDesign = sigmaLewis * Kv * Ko;

  const sf = sigmaDesign > 0 ? input.allowableStressMpa / sigmaDesign : Infinity;
  const passes = sf >= 1;
  if (!passes) warnings.push(`Bending SF ${sf.toFixed(2)} < 1: increase module/face width or use stronger material.`);

  return {
    tangentialForceN: Wt,
    pitchLineVelocityMS: v,
    lewisFormFactorY: Y,
    dynamicFactorKv: Kv,
    bendingStressMpa: sigmaDesign,
    safetyFactor: sf,
    passes,
    warnings,
  };
}

export function summarize(r: GearToothResult): { bendingStressMpa: number; safetyFactor: number; passes: boolean } {
  return { bendingStressMpa: r.bendingStressMpa, safetyFactor: r.safetyFactor, passes: r.passes };
}
