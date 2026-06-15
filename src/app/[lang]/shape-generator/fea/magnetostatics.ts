/**
 * magnetostatics.ts — closed-form magnetostatic fields (Biot-Savart) for canonical
 * current configurations:
 *
 *   circular loop, on axis:   B(z) = μ0·I·R² / (2·(R²+z²)^{3/2})    (μ0·I/2R at centre)
 *   finite solenoid, on axis: B = (μ0·n·I/2)·[cosα1 − cosα2]  → μ0·n·I (infinitely long)
 *   straight wire:            B = μ0·I / (2π·r)
 *   toroid:                   B = μ0·N·I / (2π·r)
 *
 * Verified: the loop-centre and 1/z³ far-field; the finite-solenoid closed form
 * matches a Biot-Savart integral over its loops and tends to μ0·n·I; and the wire/
 * toroid fields.
 */

export const MU0 = 4 * Math.PI * 1e-7; // vacuum permeability (T·m/A)

/** On-axis field of a circular current loop (radius R) at axial distance z. */
export function loopFieldOnAxis(I: number, R: number, z: number): number {
  return (MU0 * I * R * R) / (2 * Math.pow(R * R + z * z, 1.5));
}

/**
 * On-axis field of a finite solenoid (radius R, length L, n turns/length) at axial
 * position z measured from the centre: B = (μ0·n·I/2)·[(z+L/2)/√(R²+(z+L/2)²) −
 * (z−L/2)/√(R²+(z−L/2)²)].
 */
export function solenoidFieldOnAxis(I: number, n: number, R: number, L: number, z = 0): number {
  const x1 = z + L / 2, x2 = z - L / 2;
  const c1 = x1 / Math.sqrt(R * R + x1 * x1);
  const c2 = x2 / Math.sqrt(R * R + x2 * x2);
  return (MU0 * n * I / 2) * (c1 - c2);
}

/** Ideal (infinitely long) solenoid interior field: B = μ0·n·I. */
export function infiniteSolenoidField(I: number, n: number): number {
  return MU0 * n * I;
}

/** Field at distance r from a long straight wire: B = μ0·I/(2π·r). */
export function straightWireField(I: number, r: number): number {
  return (MU0 * I) / (2 * Math.PI * r);
}

/** Field inside a toroid (N total turns) at radius r: B = μ0·N·I/(2π·r). */
export function toroidField(I: number, N: number, r: number): number {
  return (MU0 * N * I) / (2 * Math.PI * r);
}

/** Biot-Savart integral of a finite solenoid as a stack of loops (cross-check). */
export function solenoidFieldByIntegration(I: number, n: number, R: number, L: number, z = 0, slices = 20000): number {
  const dz = L / slices;
  let B = 0;
  for (let i = 0; i < slices; i++) {
    const zi = -L / 2 + (i + 0.5) * dz;       // loop position
    B += loopFieldOnAxis(I, R, z - zi) * n * dz; // n·dz loops at this slice
  }
  return B;
}
