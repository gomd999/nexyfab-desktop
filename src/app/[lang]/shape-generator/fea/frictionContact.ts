/**
 * frictionContact.ts — Coulomb friction at a contact interface, by a STICK/SLIP
 * return mapping (the frictional analogue of plastic return). The tangential traction
 * is bounded by the friction cone |t_t| ≤ μ·p_n:
 *
 *   trial:  t* = k_t·(u_t − s)              (elastic stick prediction, s = accumulated slip)
 *   stick:  |t*| ≤ μ·p_n  ⇒  t = t*, s unchanged
 *   slip:   |t*| > μ·p_n   ⇒  t = μ·p_n·sign(t*),  Δs = (|t*|−μ·p_n)/k_t·sign(t*)
 *
 * Verified: a block sticks while the demanded force is below μ·N (friction = applied
 * force) and slips at the cap μ·N above it; an incline slips when tan θ > μ; the
 * traction never leaves the friction cone; and a sliding cycle dissipates energy.
 */

export interface FrictionState { traction: number; slip: number; slipping: boolean; }

/** Stick/slip return for the tangential traction at a contact point. */
export function coulombReturn(uTangential: number, normalPressure: number, mu: number, kt: number, slipPrev = 0): FrictionState {
  const bound = Math.max(0, mu * normalPressure);
  const trial = kt * (uTangential - slipPrev);
  if (Math.abs(trial) <= bound) {
    return { traction: trial, slip: slipPrev, slipping: false };       // stick
  }
  const sign = Math.sign(trial);
  const traction = bound * sign;
  const dSlip = ((Math.abs(trial) - bound) / kt) * sign;
  return { traction, slip: slipPrev + dSlip, slipping: true };          // slip
}

/** Macroscopic friction force on a rigid block: opposes motion, capped at μ·N. */
export function frictionForce(appliedTangential: number, normalForce: number, mu: number): number {
  const bound = mu * Math.max(0, normalForce);
  return Math.sign(appliedTangential) * Math.min(Math.abs(appliedTangential), bound);
}

/** True if a block on an incline of `angle` (rad) slips: tan θ > μ. */
export function inclineSlips(angle: number, mu: number): boolean {
  return Math.tan(angle) > mu + 1e-12;
}

/** Critical (angle-of-repose) incline angle where sliding begins: θ_c = atan(μ). */
export function angleOfRepose(mu: number): number { return Math.atan(mu); }

/**
 * Energy dissipated by friction over a tangential displacement history (∮ t·du in
 * the slipping phases). Returns the total dissipation and the traction history.
 */
export function frictionWork(history: number[], normalPressure: number, mu: number, kt: number): { dissipated: number; traction: number[] } {
  let slip = 0, prevU = history[0] ?? 0;
  let prevT = coulombReturn(prevU, normalPressure, mu, kt, slip).traction;
  const traction: number[] = [prevT];
  let dissipated = 0;
  for (let i = 1; i < history.length; i++) {
    const st = coulombReturn(history[i], normalPressure, mu, kt, slip);
    // dissipation = traction × slip increment (only the irreversible part).
    dissipated += st.traction * (st.slip - slip);
    slip = st.slip;
    traction.push(st.traction);
    prevU = history[i]; prevT = st.traction;
  }
  void prevU; void prevT;
  return { dissipated, traction };
}
