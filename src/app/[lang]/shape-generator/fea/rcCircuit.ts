/**
 * rcCircuit.ts — first-order RC and RL transient response (charging, discharging, energy).
 *
 *   RC time constant:   τ = R·C
 *   RL time constant:   τ = L/R
 *   capacitor charge:   V_c(t) = V·(1 − exp(−t/τ))        (→ V; 63.2% at t=τ)
 *   capacitor discharge: V_c(t) = V₀·exp(−t/τ)            (→ 0; 36.8% at t=τ)
 *   inductor current:   i(t) = (V/R)·(1 − exp(−t/τ))      (→ V/R steady)
 *   stored energy:      ½CV²  (capacitor),  ½Li²  (inductor)
 *
 * Verified against the 63.2%/36.8% values at one time constant, the 0/∞ end conditions,
 * the inductor steady current V/R, and the capacitor energy ½CV².
 */

/** RC time constant τ = R·C. */
export function rcTimeConstant(R: number, C: number): number { return R * C; }
/** RL time constant τ = L/R. */
export function rlTimeConstant(L: number, R: number): number { return L / R; }
/** Capacitor charging voltage V_c(t) = V·(1 − exp(−t/τ)). */
export function capacitorCharging(V: number, t: number, tau: number): number { return V * (1 - Math.exp(-t / tau)); }
/** Capacitor discharging voltage V_c(t) = V₀·exp(−t/τ). */
export function capacitorDischarging(V0: number, t: number, tau: number): number { return V0 * Math.exp(-t / tau); }
/** Inductor current i(t) = (V/R)·(1 − exp(−t/τ)). */
export function inductorCurrent(V: number, R: number, t: number, tau: number): number {
  return (V / R) * (1 - Math.exp(-t / tau));
}
/** Capacitor stored energy ½CV². */
export function capacitorEnergy(C: number, V: number): number { return 0.5 * C * V * V; }
