/**
 * iterativeSolver — Phase 3.2.2 of NexyFab Pro own-CAD (ADR-013).
 *
 * Multi-mate assembly solver. Phase 3.2.1 handles a single mate
 * analytically; this module relaxes arbitrary mate graphs by Gauss-Seidel
 * iteration: for each free part, sequentially apply the analytical
 * single-mate correction for each mate that touches it, then repeat
 * until residuals stabilize.
 *
 * Why Gauss-Seidel and not Newton-Lagrange?
 *   - Gauss-Seidel needs no Jacobian assembly — much simpler to implement
 *     and reasonable for the "100s of mates" range typical in
 *     mechanical assemblies.
 *   - Newton-Lagrange is faster on degenerate / over-constrained systems
 *     and gives clean redundancy detection — Phase 3.2.3 upgrade path.
 *   - Phase 3.2.1's analytical placements act as the per-step "correction"
 *     building block.
 *
 * Scope (Phase 3.2.2 minimal):
 *   - 3 mate kinds work analytically: concentric, coincident point/point,
 *     coincident plane/plane.
 *   - Other mate kinds (parallel, perpendicular, distance, angle, tangent)
 *     fall through to a no-op for now (Phase 3.2.4 — add their analytical
 *     forms). Solver still reports them in unresolved residuals.
 *   - Requires a `geometryResolver` callback that turns a (partId, refId,
 *     refKind) tuple into the world-frame primitive (axis, point, plane).
 *     This decouples the solver from the part geometry registry, which is
 *     part of Phase 2 (already exists conceptually via FeatureTree replay
 *     but not yet wired).
 *
 * Convergence:
 *   - max iterations cap (default 100)
 *   - residual tolerance (default 1e-4)
 *   - returns SolveResult with success flag, iteration count, per-mate
 *     residuals, and the new AssemblyState
 */

import type { AssemblyState, PartInstance, Quat } from './assemblyState';
import type { Mate, MateRef } from './mate';
import {
  distanceAxisToAxis,
  quatFromTo,
  quatMul,
  quatNormalize,
  rotateVec,
  type AxisInWorld,
  type PlaneInWorld,
  type Placement,
} from './mateSolver';
import { type Vec3, sub, add, dot, scale, lengthOf } from '@/lib/sketch/sketchPlane';

// ─── geometry resolver contract ──────────────────────────────────────────

export type ResolvedGeometry =
  | { kind: 'point'; world: Vec3 }
  | { kind: 'axis'; world: AxisInWorld }
  | { kind: 'plane'; world: PlaneInWorld };

/**
 * Caller-supplied function that resolves a MateRef into world-frame
 * geometry given the current part placement. The solver invokes this
 * every iteration after moving parts.
 *
 * For tests, callers can mock this directly. In production, this will
 * wrap the FeatureTree replay output (Phase 4 will plumb feature →
 * registry → world refs).
 */
export type GeometryResolver = (
  ref: MateRef,
  part: PartInstance,
) => ResolvedGeometry | null;

// ─── solver config ───────────────────────────────────────────────────────

export interface IterativeSolverOptions {
  /** Max passes over the mate list. Default 100. */
  maxIterations?: number;
  /** Stop when max residual < this. Default 1e-4. */
  tolerance?: number;
  /** Relaxation factor in [0, 1]. Lower = more damping (slower but
   *  stabler on noisy systems). Default 1.0 (no damping). */
  relaxation?: number;
}

export interface MateResidual {
  mateId: string;
  /** Distance/angle error from the mate being satisfied (in mm or radians,
   *  per-mate-kind). Higher = worse. */
  residual: number;
  /** True if this kind has an analytical placement implemented yet. */
  supported: boolean;
}

export interface IterativeSolveResult {
  /** New AssemblyState with updated placements. */
  state: AssemblyState;
  success: boolean;
  iterations: number;
  /** Max residual across all mates at the final iteration. */
  finalMaxResidual: number;
  /** Per-mate residual at convergence (or at maxIterations). */
  residuals: ReadonlyArray<MateResidual>;
}

// ─── main solver ─────────────────────────────────────────────────────────

export function iterativeSolve(
  state: AssemblyState,
  resolve: GeometryResolver,
  opts: IterativeSolverOptions = {},
): IterativeSolveResult {
  const maxIter = opts.maxIterations ?? 100;
  const tol = opts.tolerance ?? 1e-4;
  const relax = opts.relaxation ?? 1.0;

  const parts: PartInstance[] = state.parts.map((p) => ({ ...p }));
  const mates = state.mates.filter((m) => !m.suppressed);
  const partById = new Map<string, PartInstance>(parts.map((p) => [p.id, p]));

  let iter = 0;
  let lastMaxResidual = Infinity;

  for (; iter < maxIter; iter++) {
    let maxResidual = 0;
    // Within one iteration, prefer to move a part that hasn't been moved
    // yet by an earlier mate. Avoids the "two mates tug-of-war on the same
    // part" deadlock in chain assemblies.
    const movedThisIter = new Set<string>();

    for (const mate of mates) {
      const a = partById.get(mate.a.partId);
      const b = partById.get(mate.b.partId);
      if (!a || !b) continue;

      // Decide which side is the "free" part to move (if both fixed, skip).
      const aFree = !a.fixed;
      const bFree = !b.fixed;
      if (!aFree && !bFree) {
        const r = computeResidual(mate, a, b, resolve);
        if (r > maxResidual) maxResidual = r;
        continue;
      }
      // Selection: prefer the side that hasn't moved yet this iteration.
      // Falls back to lower-id for determinism if both/neither moved.
      let moveA: boolean;
      if (!aFree) moveA = false;
      else if (!bFree) moveA = true;
      else {
        const aMoved = movedThisIter.has(a.id);
        const bMoved = movedThisIter.has(b.id);
        if (aMoved && !bMoved) moveA = false;
        else if (bMoved && !aMoved) moveA = true;
        else moveA = a.id < b.id;
      }
      const movedPart = moveA ? a : b;
      const fixedPart = moveA ? b : a;
      const movedRef = moveA ? mate.a : mate.b;
      const fixedRef = moveA ? mate.b : mate.a;

      const movedResolved = resolve(movedRef, movedPart);
      const fixedResolved = resolve(fixedRef, fixedPart);
      if (!movedResolved || !fixedResolved) continue;

      // Apply analytical placement for the supported mate kinds.
      const newPlacement = applyAnalyticalPlacement(mate, movedPart, movedResolved, fixedResolved);
      if (newPlacement) {
        // Damped update.
        movedPart.position = lerp3(movedPart.position, newPlacement.position, relax);
        movedPart.orientation = slerp(movedPart.orientation, newPlacement.orientation, relax);
        movedThisIter.add(movedPart.id);
      }
      const r = computeResidual(mate, a, b, resolve);
      if (r > maxResidual) maxResidual = r;
    }

    lastMaxResidual = maxResidual;
    if (maxResidual < tol) {
      iter += 1; // count the converged iteration
      break;
    }
  }

  const finalResiduals: MateResidual[] = state.mates.map((m) => {
    const a = partById.get(m.a.partId);
    const b = partById.get(m.b.partId);
    if (!a || !b || m.suppressed) {
      return { mateId: m.id, residual: 0, supported: true };
    }
    return {
      mateId: m.id,
      residual: computeResidual(m, a, b, resolve),
      supported: isAnalyticallySupported(m),
    };
  });

  return {
    state: { parts, mates: state.mates },
    success: lastMaxResidual < tol,
    iterations: iter,
    finalMaxResidual: lastMaxResidual,
    residuals: finalResiduals,
  };
}

// ─── per-mate dispatch ───────────────────────────────────────────────────

function isAnalyticallySupported(mate: Mate): boolean {
  if (mate.kind === 'concentric') return true;
  if (mate.kind === 'coincident') {
    // Only point/point and plane/plane analytical so far.
    return (
      (mate.a.refKind === 'point' && mate.b.refKind === 'point') ||
      (mate.a.refKind === 'plane' && mate.b.refKind === 'plane')
    );
  }
  return false;
}

/**
 * Compute the new placement for `movedPart` that minimally satisfies `mate`.
 * All inputs (movedG, fixedG) are in WORLD frame already.
 */
function applyAnalyticalPlacement(
  mate: Mate,
  movedPart: PartInstance,
  movedG: ResolvedGeometry,
  fixedG: ResolvedGeometry,
): Placement | null {
  const curPos = movedPart.position;
  const curOri = movedPart.orientation;

  // ── coincident point/point: pure translation by world-frame shift ────
  if (mate.kind === 'coincident' && movedG.kind === 'point' && fixedG.kind === 'point') {
    const shift = sub(fixedG.world, movedG.world);
    return { position: add(curPos, shift), orientation: curOri };
  }

  // ── coincident plane/plane: rotate to anti-parallel + translate along normal ──
  if (mate.kind === 'coincident' && movedG.kind === 'plane' && fixedG.kind === 'plane') {
    const targetAnti = scale(fixedG.world.normal, -1);
    const rot = quatFromTo(movedG.world.normal, targetAnti);
    // Rotate the moved-part placement around its origin (curPos).
    const newOri = quatNormalize(quatMul(rot, curOri));
    // After rotation, the plane's world origin shifts because the rotation
    // happens around curPos. Compute the rotated plane origin in world.
    const relOrigin = sub(movedG.world.origin, curPos);
    const rotatedRelOrigin = rotateVec(relOrigin, rot);
    const newPlaneOriginWorld = add(curPos, rotatedRelOrigin);
    // Translate along the target normal so the planes are coincident.
    const along = dot(sub(fixedG.world.origin, newPlaneOriginWorld), fixedG.world.normal);
    return {
      position: add(curPos, scale(fixedG.world.normal, along)),
      orientation: newOri,
    };
  }

  // ── concentric axis/axis: align direction + perpendicular shift ──────
  if (mate.kind === 'concentric' && movedG.kind === 'axis' && fixedG.kind === 'axis') {
    const rot = quatFromTo(movedG.world.direction, fixedG.world.direction);
    const newOri = quatNormalize(quatMul(rot, curOri));
    // Rotate the axis origin around the part's pivot.
    const relOrigin = sub(movedG.world.origin, curPos);
    const rotatedRelOrigin = rotateVec(relOrigin, rot);
    const newAxisOriginWorld = add(curPos, rotatedRelOrigin);
    // Perpendicular shift so the (rotated) axis line passes through
    // the fixed axis line.
    const w = sub(fixedG.world.origin, newAxisOriginWorld);
    const along = dot(w, fixedG.world.direction); // free axial slide
    const perp = sub(w, scale(fixedG.world.direction, along));
    return { position: add(curPos, perp), orientation: newOri };
  }

  return null;
}

function computeResidual(
  mate: Mate,
  a: PartInstance,
  b: PartInstance,
  resolve: GeometryResolver,
): number {
  const ag = resolve(mate.a, a);
  const bg = resolve(mate.b, b);
  if (!ag || !bg) return 0;
  if (mate.kind === 'concentric' && ag.kind === 'axis' && bg.kind === 'axis') {
    return distanceAxisToAxis(ag.world, bg.world);
  }
  if (mate.kind === 'coincident' && ag.kind === 'point' && bg.kind === 'point') {
    return lengthOf(sub(ag.world, bg.world));
  }
  if (mate.kind === 'coincident' && ag.kind === 'plane' && bg.kind === 'plane') {
    // Residual = perpendicular gap between planes.
    return Math.abs(dot(sub(bg.world.origin, ag.world.origin), ag.world.normal));
  }
  if (mate.kind === 'distance' && ag.kind === 'point' && bg.kind === 'point') {
    return Math.abs(lengthOf(sub(bg.world, ag.world)) - mate.value);
  }
  // Unsupported mate kinds: residual undefined → report 0 so solver
  // doesn't false-alarm on them. Caller sees them in supported=false flags.
  return 0;
}

// ─── lerp helpers (light damping) ────────────────────────────────────────

function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

/**
 * Spherical-linear interpolation between two quaternions. Used when the
 * iterative solver applies a damped (relaxation < 1) orientation update.
 * For relaxation = 1, this returns b exactly.
 */
function slerp(a: Quat, b: Quat, t: number): Quat {
  if (t >= 1) return b;
  if (t <= 0) return a;
  let cosHalf = a.w * b.w + a.x * b.x + a.y * b.y + a.z * b.z;
  let bx = b.x, by = b.y, bz = b.z, bw = b.w;
  if (cosHalf < 0) {
    cosHalf = -cosHalf;
    bx = -bx; by = -by; bz = -bz; bw = -bw;
  }
  if (cosHalf > 1 - 1e-9) {
    // Nearly identical — linear blend.
    return normalizeQ({
      x: a.x + (bx - a.x) * t,
      y: a.y + (by - a.y) * t,
      z: a.z + (bz - a.z) * t,
      w: a.w + (bw - a.w) * t,
    });
  }
  const half = Math.acos(cosHalf);
  const sinHalf = Math.sin(half);
  const wa = Math.sin((1 - t) * half) / sinHalf;
  const wb = Math.sin(t * half) / sinHalf;
  return {
    x: wa * a.x + wb * bx,
    y: wa * a.y + wb * by,
    z: wa * a.z + wb * bz,
    w: wa * a.w + wb * bw,
  };
}

function normalizeQ(q: Quat): Quat {
  const len = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
  return { x: q.x / len, y: q.y / len, z: q.z / len, w: q.w / len };
}

