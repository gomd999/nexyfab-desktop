/**
 * buoyancy.ts — hydrostatic flotation and the metacentric stability of a floating body
 * (ship/barge/pontoon), from Archimedes' principle and the metacentre construction.
 *
 *   buoyant force:    F_B = ρ·g·V_disp                 (Archimedes)
 *   flotation:        V_disp = W/(ρg)                  (weight = buoyancy)
 *   metacentric BM:   BM = I_wp / V_disp               (I_wp = waterplane 2nd moment of area)
 *   metacentric GM:   GM = BM − BG                     (> 0 ⇒ stable, righting)
 *   righting moment:  M = W·GM·sinθ
 *
 * For a rectangular barge BM = B²/(12·d). Verified against the flotation balance
 * (F_B(V_disp)=W), the rectangular BM=B²/(12d), the GM=BM−BG stability sign, and the
 * widening-beam stabilising effect (BM ∝ B²).
 */

/** Buoyant force F_B = ρ·g·V_disp. */
export function buoyantForce(rho: number, g: number, V: number): number { return rho * g * V; }
/** Displaced volume for a floating weight V = W/(ρg). */
export function displacedVolume(W: number, rho: number, g: number): number { return W / (rho * g); }
/** Metacentric radius BM = I_wp/V_disp. */
export function metacentricRadius(Iwp: number, V: number): number { return Iwp / V; }
/** Metacentric height GM = BM − BG. */
export function metacentricHeight(Iwp: number, V: number, BG: number): number { return Iwp / V - BG; }
/** Righting moment M = W·GM·sinθ. */
export function rightingMoment(W: number, GM: number, theta: number): number { return W * GM * Math.sin(theta); }
/** Waterplane second moment of area of a rectangular barge I = L·B³/12. */
export function rectangularWaterplaneI(L: number, B: number): number { return (L * B ** 3) / 12; }
