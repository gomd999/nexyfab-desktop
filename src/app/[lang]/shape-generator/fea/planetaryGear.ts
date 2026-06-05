/**
 * planetaryGear.ts — epicyclic (planetary) gear-train kinematics by Willis' equation.
 * A sun, planets on a carrier, and an internal ring share one axis; any two of the three
 * (sun / ring / carrier) drive the third.
 *
 *   geometry:   N_ring = N_sun + 2·N_planet               (coaxial constraint)
 *   Willis:     (ω_s − ω_c)/(ω_r − ω_c) = −N_r/N_s        (internal ring ⇒ minus sign)
 *   carrier:    ω_c = (N_s·ω_s + N_r·ω_r)/(N_s + N_r)     (solved from Willis)
 *   fixed ring: ω_s/ω_c = 1 + N_r/N_s                     (sun in, carrier out, big reduction)
 *
 * Verified against the tooth-count geometry, the fixed-ring reduction ratio derived two
 * ways, the all-locked rigid-body case (ω_c = ω when ω_s = ω_r = ω), and the >1 reduction.
 */

/** Ring tooth count from the coaxial constraint N_ring = N_sun + 2·N_planet. */
export function ringTeeth(sunTeeth: number, planetTeeth: number): number {
  return sunTeeth + 2 * planetTeeth;
}
/** Carrier speed from Willis: ω_c = (N_s·ω_s + N_r·ω_r)/(N_s + N_r). */
export function carrierSpeed(sunTeeth: number, ringTeeth_: number, omegaSun: number, omegaRing: number): number {
  return (sunTeeth * omegaSun + ringTeeth_ * omegaRing) / (sunTeeth + ringTeeth_);
}
/** Fixed-ring speed reduction ω_sun/ω_carrier = 1 + N_ring/N_sun. */
export function carrierRatioFixedRing(sunTeeth: number, ringTeeth_: number): number {
  return 1 + ringTeeth_ / sunTeeth;
}
/** Ring speed from Willis given sun and carrier: ω_r = ((N_s+N_r)ω_c − N_s·ω_s)/N_r. */
export function ringSpeed(sunTeeth: number, ringTeeth_: number, omegaSun: number, omegaCarrier: number): number {
  return ((sunTeeth + ringTeeth_) * omegaCarrier - sunTeeth * omegaSun) / ringTeeth_;
}
