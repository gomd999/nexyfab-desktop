/**
 * npsh.ts — pump suction performance: Net Positive Suction Head and cavitation onset.
 *
 *   vapour head:   H_v   = P_vapour/(ρg)
 *   NPSH avail.:   NPSHa = (P_atm − P_vapour)/(ρg) − H_s − h_f
 *                          (H_s = static suction lift, h_f = suction friction loss)
 *   cavitation:    occurs when NPSHa < NPSHr (pump-required)
 *   Thoma number:  σ = NPSHa/H                         (H = pump total head)
 *
 * Verified against the NPSHa head balance, the cavitation criterion NPSHa<NPSHr, the
 * suction-lift sensitivity (more lift ⇒ less margin), and hotter liquid (higher vapour
 * pressure) reducing NPSHa toward cavitation.
 */

/** Vapour-pressure head H_v = P_vapour/(ρg). */
export function vaporPressureHead(Pvapor: number, rho: number, g: number): number { return Pvapor / (rho * g); }
/** Available NPSH = (P_atm − P_vapour)/(ρg) − H_s − h_f. */
export function npshAvailable(Patm: number, Pvapor: number, rho: number, g: number, suctionLift: number, frictionLoss: number): number {
  return (Patm - Pvapor) / (rho * g) - suctionLift - frictionLoss;
}
/** Cavitation onset: true when NPSHa < NPSHr. */
export function cavitates(NPSHa: number, NPSHr: number): boolean { return NPSHa < NPSHr; }
/** Thoma cavitation number σ = NPSHa/H. */
export function thomaNumber(NPSHa: number, H: number): number { return NPSHa / H; }
