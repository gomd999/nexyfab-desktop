/**
 * I* (Stage 4 wired) — Server-side mate solver.
 *
 * Delegates to {@link assemblyMateSolve}, the real bridge onto the assembly
 * iterativeSolve. Given the per-handle anchors that solve_mates derives from
 * the session placements, it builds an AssemblyState + Mate IR and returns the
 * world deltas. (The previous v0 used a hard-coded origin anchor for every
 * handle, so every mate resolved to no movement.)
 *
 * Scope (inherited from the core): concentric + coplanar (→ coincident plane)
 * resolve analytically as translations; tangent / parallel / perpendicular
 * need rotation and surface as a non-zero residual rather than a wrong
 * assembly. When no anchors are supplied, parts solve from the origin.
 */
import type { MateAdapter } from './tools';
import { assemblyMateSolve, type MateAnchor } from './assemblyMateSolve';

export const serverMateAdapter: MateAdapter = {
  isAvailable() {
    return true;
  },

  async solve(mates, anchors) {
    const a: Record<string, MateAnchor> = anchors ?? {};
    const r = assemblyMateSolve(mates, a);
    if (!r.ok) return { ok: false, reason: r.reason };
    return { ok: true, transforms: r.transforms, residual: r.residual };
  },
};
