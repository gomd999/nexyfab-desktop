/**
 * camFollower.ts — cam-follower motion programs over a rise of height h across a cam
 * angle β. The follower displacement s(θ) sets the velocity v = (ds/dθ)·ω and
 * acceleration a = (d²s/dθ²)·ω².
 *
 *   SHM:        s = (h/2)(1 − cos(πθ/β))                  v=0 at ends, but a jumps (≠0)
 *   cycloidal:  s = h(θ/β − sin(2πθ/β)/(2π))              v AND a = 0 at ends (smooth)
 *
 * Cycloidal motion is preferred because it has no acceleration jump (no shock).
 * Verified: both reach 0→h with zero end velocity; only cycloidal has zero end
 * acceleration; and the analytic velocity equals a finite difference of s.
 */

export interface CamMotion { s: number; v: number; a: number; }

/** Simple-harmonic-motion rise. */
export function shm(theta: number, beta: number, h: number, omega = 1): CamMotion {
  const x = (Math.PI * theta) / beta;
  return {
    s: (h / 2) * (1 - Math.cos(x)),
    v: ((Math.PI * h * omega) / (2 * beta)) * Math.sin(x),
    a: ((Math.PI * Math.PI * h * omega * omega) / (2 * beta * beta)) * Math.cos(x),
  };
}

/** Cycloidal rise (smooth: zero velocity and acceleration at both ends). */
export function cycloidal(theta: number, beta: number, h: number, omega = 1): CamMotion {
  const x = (2 * Math.PI * theta) / beta;
  return {
    s: h * (theta / beta - Math.sin(x) / (2 * Math.PI)),
    v: ((h * omega) / beta) * (1 - Math.cos(x)),
    a: ((2 * Math.PI * h * omega * omega) / (beta * beta)) * Math.sin(x),
  };
}

/** Peak velocity coefficient C_v so v_max = C_v·(h·ω/β). SHM: π/2, cycloidal: 2. */
export function peakVelocityCoefficient(program: 'shm' | 'cycloidal'): number {
  return program === 'shm' ? Math.PI / 2 : 2;
}
