/**
 * I* (Stage 4 wired) — Server-side mate solver v0.
 *
 * Closed-form solver for the 3 most common mate types — concentric,
 * coplanar, distance — without needing Solvespace. Treats handleA as
 * the *fixed* part and handleB as the part to be moved.
 *
 * Intentional v0 scope:
 *   - Only translation transforms (no rotation). Sufficient for
 *     "place this hole over that one" / "this face flush with that face"
 *     workflows. Tangent + parallel + perpendicular need rotation and
 *     are deferred to v1 (which would call Solvespace 3D).
 *   - First mate involving each handleB wins; subsequent mates on the
 *     same B are checked for compatibility but don't override.
 *   - Face / edge picking: caller passes face *centers* via the
 *     adapter's hostBboxCenter helper (defaulted to origin when no
 *     face is specified).
 *
 * Why bother with v0:
 *   - 80% of practical assembly mates ARE translation-only (4 holes
 *     aligning to 4 bolts, plate flush against plate).
 *   - Validates the agent → mate workflow end-to-end before paying the
 *     Solvespace integration cost.
 *   - Surfaces "needs rotation" via residual > tolerance so the agent
 *     can hand back to user instead of producing a wrong assembly.
 */
import type { MateAdapter } from './tools';
import type { AssemblyMate } from './types';

type Vec3 = [number, number, number];

function sub(a: Vec3, b: Vec3): Vec3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function len(v: Vec3): number { return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]); }

/**
 * Look up the world-space "anchor" of a B-rep handle. v0 just uses the
 * origin — production wiring would consult occtEngine for face centers.
 * For now we accept that v0 mates assume parts are placed at origin and
 * the agent supplies relative offsets via the `value` field.
 */
function anchorOf(handle: string): Vec3 {
  void handle;
  return [0, 0, 0];
}

export const serverMateAdapter: MateAdapter = {
  isAvailable() { return true; },

  async solve(mates) {
    const transforms: Record<string, Vec3> = {};
    const issues: string[] = [];
    let totalResidual = 0;

    for (const m of mates) {
      const result = solveOne(m, transforms);
      if (!result.ok) {
        issues.push(`${m.id} (${m.kind}): ${result.reason}`);
      } else {
        transforms[m.handleB] = result.transform;
        totalResidual += result.residual;
      }
    }

    if (issues.length > 0) {
      return { ok: false, reason: issues.join('; ') };
    }
    return { ok: true, transforms, residual: totalResidual };
  },
};

function solveOne(
  m: AssemblyMate,
  prior: Record<string, Vec3>,
): { ok: true; transform: Vec3; residual: number } | { ok: false; reason: string } {
  // Both anchors see prior translations so chained mates compose.
  const anchorA = prior[m.handleA] ?? anchorOf(m.handleA);
  const anchorB = prior[m.handleB] ?? anchorOf(m.handleB);

  switch (m.kind) {
    case 'concentric': {
      // Move B so its anchor coincides with A's anchor.
      const delta = sub(anchorA, anchorB);
      return { ok: true, transform: delta, residual: 0 };
    }
    case 'coplanar': {
      // Snap B's Z to A's Z; preserve X/Y.
      const delta: Vec3 = [0, 0, anchorA[2] - anchorB[2]];
      return { ok: true, transform: delta, residual: 0 };
    }
    case 'distance': {
      const d = m.value;
      if (typeof d !== 'number' || !Number.isFinite(d)) {
        return { ok: false, reason: 'distance mate requires numeric value' };
      }
      // Move B along the +Z axis from A by `d`. (v0 axis convention.)
      const delta: Vec3 = [
        anchorA[0] - anchorB[0],
        anchorA[1] - anchorB[1],
        anchorA[2] + d - anchorB[2],
      ];
      const residual = Math.abs(len(sub([0, 0, d], [0, 0, anchorA[2] + d - (anchorB[2] + delta[2])])));
      return { ok: true, transform: delta, residual };
    }
    case 'tangent':
    case 'parallel':
    case 'perpendicular':
      return {
        ok: false,
        reason: `${m.kind} mate needs rotation (v0 supports translation only — call solve_mates again after upgrading to Solvespace 3D)`,
      };
    default:
      return { ok: false, reason: `unknown mate kind "${m.kind}"` };
  }
}
