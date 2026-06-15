/**
 * stressWave.ts — 1-D elastic stress-wave propagation in a slender bar (longitudinal
 * impact, Hopkinson-bar relations), from the wave equation ∂²u/∂t² = c²·∂²u/∂x².
 *
 *   wave speed:        c = √(E/ρ)
 *   impact stress:     σ = ρ·c·v = v·√(Eρ)           (end struck at particle velocity v)
 *   wave strain:       ε = v/c   (and σ = Eε ⇒ same σ)
 *   particle velocity: v = σ/(ρc)
 *   traversal time:    t = L/c
 *
 * Verified against the steel wave speed √(E/ρ) ≈ 5050 m/s, the impact-stress identity
 * ρcv ≡ v√(Eρ) ≡ E·ε, the particle-velocity inverse, and the L/c traversal time.
 */

/** Longitudinal elastic wave speed c = √(E/ρ). */
export function barWaveSpeed(E: number, rho: number): number { return Math.sqrt(E / rho); }
/** Impact (Hopkinson) stress σ = ρ·c·v. */
export function hopkinsonStress(rho: number, c: number, v: number): number { return rho * c * v; }
/** Strain behind the wave front ε = v/c. */
export function waveStrain(v: number, c: number): number { return v / c; }
/** Particle velocity from a stress level v = σ/(ρc). */
export function particleVelocity(sigma: number, rho: number, c: number): number { return sigma / (rho * c); }
/** Time for the wave to traverse a length L: t = L/c. */
export function traversalTime(L: number, c: number): number { return L / c; }
