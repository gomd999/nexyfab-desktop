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
import { IDENTITY_QUAT } from './assemblyState';
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

/**
 * Machine-readable approximation markers for a mate residual — same
 * honesty convention as brep-bridge's `fidelity` field (a silent
 * approximation is forbidden; the result must say so in a form code can
 * branch on).
 *
 *   - 'hinge-unsigned-proxy': the hinge has an angular `limit` but no
 *     `zeroAngleRef`, so the swing angle is the Phase 1 UNSIGNED
 *     quaternion-dot proxy. Because the sign is unresolved, the limit is
 *     applied pessimistically to both sign candidates — an in-limit
 *     +30° swing under limit [0°, 90°] still reports a 0.5236 rad
 *     penalty (measured; pinned in iterativeSolver.advanced.test.ts).
 *     Supply `zeroAngleRef` to get the exact signed measurement.
 */
export type MateResidualApproximation = 'hinge-unsigned-proxy';

export interface MateResidual {
  mateId: string;
  /** Distance/angle error from the mate being satisfied (in mm or radians,
   *  per-mate-kind). Higher = worse. */
  residual: number;
  /** True if this kind has an analytical placement implemented yet. */
  supported: boolean;
  /**
   * Present when the residual value is a documented APPROXIMATION rather
   * than an exact measurement. Absent = exact semantics. Additive field
   * (W5-F 3차) — existing consumers are unaffected.
   */
  approximation?: MateResidualApproximation;
}

/**
 * The approximation marker (if any) that applies to `mate`'s residual
 * under the current mate parameters. Single source of truth — both
 * engines stamp their residual reports through this.
 */
export function mateResidualApproximation(
  mate: Mate,
): MateResidualApproximation | undefined {
  if (
    mate.kind === 'hinge' &&
    mate.limit !== undefined &&
    mate.zeroAngleRef === undefined
  ) {
    return 'hinge-unsigned-proxy';
  }
  return undefined;
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
        const r = computeMateResidual(mate, a, b, resolve);
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
      const r = computeMateResidual(mate, a, b, resolve);
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
    const approximation = mateResidualApproximation(m);
    return {
      mateId: m.id,
      residual: computeMateResidual(m, a, b, resolve),
      supported: isAnalyticallySupported(m),
      ...(approximation !== undefined ? { approximation } : {}),
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
    return (
      (mate.a.refKind === 'point' && mate.b.refKind === 'point') ||
      (mate.a.refKind === 'plane' && mate.b.refKind === 'plane')
    );
  }
  if (mate.kind === 'parallel' || mate.kind === 'perpendicular') {
    // Supported when both sides are planes or both axes (or face/plane mix).
    const norms: ReadonlyArray<string> = ['plane', 'face', 'axis'];
    return norms.includes(mate.a.refKind) && norms.includes(mate.b.refKind);
  }
  if (mate.kind === 'distance') {
    // Supported when both sides are points or both are planes.
    return (
      (mate.a.refKind === 'point' && mate.b.refKind === 'point') ||
      (mate.a.refKind === 'plane' && mate.b.refKind === 'plane')
    );
  }
  if (mate.kind === 'angle') {
    return ['plane', 'face', 'axis'].includes(mate.a.refKind) &&
      ['plane', 'face', 'axis'].includes(mate.b.refKind);
  }
  // ── Phase 3.2.6 advanced mates ─────────────────────────────────────────
  // Hinge — analytical placement = concentric (axial spin DoF left free,
  // optional angular limit enforced via residual only).
  if (mate.kind === 'hinge') return true;
  // Slot — analytical placement: project pin onto slot edge line + align
  // pin direction perpendicular to slot direction. Phase 1: straight slot.
  if (mate.kind === 'slot') return true;
  // Gear — velocity coupling; placement is a no-op but residual is defined
  // (perpendicular distance + angle diff between the two shaft axes).
  if (mate.kind === 'gear') return true;
  // Rack & pinion — placement is a no-op; residual checks pinion axis
  // distance from rack edge against pinionRadius.
  if (mate.kind === 'rack_pinion') return true;
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

  // ── parallel: align directions (no translation) ─────────────────────
  if (mate.kind === 'parallel') {
    const a = directionOf(movedG);
    const b = directionOf(fixedG);
    if (!a || !b) return null;
    const rot = quatFromTo(a, b);
    return { position: curPos, orientation: quatNormalize(quatMul(rot, curOri)) };
  }

  // ── perpendicular: rotate moved direction to perp(target) ────────────
  if (mate.kind === 'perpendicular') {
    const a = directionOf(movedG);
    const b = directionOf(fixedG);
    if (!a || !b) return null;
    const cos = clamp(dot(a, b), -1, 1);
    const currentAngle = Math.acos(cos);
    // Axis (a × b) — positive rotation around this rotates a toward b
    // (right-hand rule). To get from currentAngle to π/2 we move AWAY
    // from b when currentAngle < π/2 → negative delta.
    const axis = normalizeSafe(crossVec(a, b));
    if (!axis) return null;
    const delta = currentAngle - Math.PI / 2;
    const rot = quatAxisAngle(axis, delta);
    return { position: curPos, orientation: quatNormalize(quatMul(rot, curOri)) };
  }

  // ── distance point/point: translate along separation axis to target ──
  if (mate.kind === 'distance' && movedG.kind === 'point' && fixedG.kind === 'point') {
    const target = mate.value;
    const diff = sub(movedG.world, fixedG.world);
    const currentDist = lengthAndDir(diff);
    if (!currentDist) return null;
    // Place moved at fixed + (target * unit-direction-from-fixed-to-moved).
    const newMovedWorld = add(fixedG.world, scale(currentDist.unit, target));
    const shift = sub(newMovedWorld, movedG.world);
    return { position: add(curPos, shift), orientation: curOri };
  }
  // ── distance plane/plane: align normals + translate to target gap ────
  // W5-F 3차: this placement used to translate ONLY, leaving the moved
  // part's rotation untouched — matching a residual that never penalized
  // normal misalignment (documented leftover of W5-F 2차). The residual
  // now carries a |n_a × n_b|·(1 + |o_b − o_a|) alignment term, so the
  // placement must consume it: rotate the moved plane's normal into the
  // NEAREST alignment with the fixed normal (parallel when dot ≥ 0,
  // anti-parallel otherwise — an unsigned gap accepts both, and choosing
  // the nearest keeps this a minimal correction), then translate along
  // the fixed normal to the target gap. Same rotate-about-part-pivot
  // origin bookkeeping as the coincident plane/plane placement above.
  if (mate.kind === 'distance' && movedG.kind === 'plane' && fixedG.kind === 'plane') {
    const target = mate.value;
    const towardFixed = dot(movedG.world.normal, fixedG.world.normal) >= 0;
    const targetNormal = towardFixed ? fixedG.world.normal : scale(fixedG.world.normal, -1);
    const rot = quatFromTo(movedG.world.normal, targetNormal);
    const newOri = quatNormalize(quatMul(rot, curOri));
    // The rotation happens around the part pivot (curPos) — recompute the
    // plane origin's world position after the rotation.
    const relOrigin = sub(movedG.world.origin, curPos);
    const rotatedRelOrigin = rotateVec(relOrigin, rot);
    const newPlaneOriginWorld = add(curPos, rotatedRelOrigin);
    // Signed perpendicular distance from fixed plane to moved plane.
    const currentSigned = dot(sub(newPlaneOriginWorld, fixedG.world.origin), fixedG.world.normal);
    const targetSigned = currentSigned >= 0 ? target : -target;
    const adjust = targetSigned - currentSigned;
    return { position: add(curPos, scale(fixedG.world.normal, adjust)), orientation: newOri };
  }

  // ── angle: rotate moved direction to target angle from fixed direction ──
  if (mate.kind === 'angle') {
    const a = directionOf(movedG);
    const b = directionOf(fixedG);
    if (!a || !b) return null;
    const targetRad = (mate.value * Math.PI) / 180;
    const cos = clamp(dot(a, b), -1, 1);
    const currentAngle = Math.acos(cos);
    const delta = currentAngle - targetRad;
    const axis = normalizeSafe(crossVec(a, b)) ?? (Math.abs(delta) > 1e-12 ? stablePerpendicular(a) : null);
    if (!axis) return null;
    // Same right-hand-rule convention as perpendicular: positive rotation
    // around (a × b) reduces the angle. Negate to move from currentAngle
    // to targetAngle.
    const rot = quatAxisAngle(axis, delta);
    return { position: curPos, orientation: quatNormalize(quatMul(rot, curOri)) };
  }

  // ── hinge: same placement as concentric (axes collinear). Angular limit
  //    is enforced only via computeResidual in Phase 1 — the placement
  //    leaves the free spin DoF at its existing value (minimum disruption).
  if (mate.kind === 'hinge' && movedG.kind === 'axis' && fixedG.kind === 'axis') {
    const rot = quatFromTo(movedG.world.direction, fixedG.world.direction);
    const newOri = quatNormalize(quatMul(rot, curOri));
    const relOrigin = sub(movedG.world.origin, curPos);
    const rotatedRelOrigin = rotateVec(relOrigin, rot);
    const newAxisOriginWorld = add(curPos, rotatedRelOrigin);
    const w = sub(fixedG.world.origin, newAxisOriginWorld);
    const along = dot(w, fixedG.world.direction); // free axial slide
    const perp = sub(w, scale(fixedG.world.direction, along));
    return { position: add(curPos, perp), orientation: newOri };
  }

  // ── slot: pin axis (moved) ↔ slot edge (fixed) ───────────────────────
  // Phase 1 assumption: slot is STRAIGHT, and the geometry resolver
  // exposes the slot edge as kind:'axis' with `origin` = slot start point
  // and `direction` = unit vector along the slot's length. The pin axis is
  // also kind:'axis'.
  //
  // Placement strategy:
  //   1. Snap the pin axis origin onto the slot's line at the point of
  //      closest approach (free to slide along the slot — projection of
  //      (pinOrigin - slotOrigin) onto slotDir gives the parametric coord,
  //      which we PRESERVE; the perpendicular component of the offset is
  //      removed so the pin sits on the slot line).
  //   2. Rotate the pin so its axis direction is PERPENDICULAR to the
  //      slot's direction (the pin protrudes out of the slot face). This
  //      is the standard slot mate: pin axis ⟂ slot length.
  //
  // What we don't do in Phase 1: enforce that the pin lies between
  // slotOrigin and slotOrigin + length (segment clamping). That's a
  // residual-only check via the parameter-out-of-range penalty.
  if (mate.kind === 'slot' && movedG.kind === 'axis' && fixedG.kind === 'axis') {
    // Step 1: align pin direction perpendicular to slot direction. If
    // already perpendicular, this is a no-op (delta = 0).
    const pinDir = movedG.world.direction;
    const slotDir = fixedG.world.direction;
    const cosPin = clamp(dot(pinDir, slotDir), -1, 1);
    const currentAngle = Math.acos(cosPin);
    let newOri = curOri;
    let rotApplied: Quat = IDENTITY_QUAT;
    const rotAxis = normalizeSafe(crossVec(pinDir, slotDir));
    if (rotAxis) {
      // Rotate pinDir AWAY from slotDir by (π/2 - currentAngle).
      const delta = currentAngle - Math.PI / 2;
      rotApplied = quatAxisAngle(rotAxis, delta);
      newOri = quatNormalize(quatMul(rotApplied, curOri));
    }
    // Step 2: re-project pin origin onto the slot line after rotation.
    const relOrigin = sub(movedG.world.origin, curPos);
    const rotatedRelOrigin = rotateVec(relOrigin, rotApplied);
    const newPinOriginWorld = add(curPos, rotatedRelOrigin);
    const w = sub(newPinOriginWorld, fixedG.world.origin);
    const along = dot(w, slotDir); // preserved (free slide DoF)
    const perp = sub(w, scale(slotDir, along));
    // Shift the part by -perp so the pin sits ON the slot line.
    return { position: sub(curPos, perp), orientation: newOri };
  }

  // ── gear: no positional placement (velocity coupling only) ───────────
  // GearMate constrains relative angular VELOCITIES of two shafts, not
  // their static positions. A hinge (or two hinges) is required alongside
  // the gear mate to fix the gears in space. Phase 1: no-op.
  // Residual still flags non-parallel / coincident axes as ill-posed.
  if (mate.kind === 'gear') return null;

  // ── rack & pinion: no positional placement (velocity coupling only) ──
  // RackPinionMate couples pinion rotation rate to rack translation rate.
  // Static placement is delegated to a separate hinge (pinion shaft) and
  // a slide constraint (rack). Phase 1: no-op.
  if (mate.kind === 'rack_pinion') return null;

  return null;
}

/** Deterministic rotation axis for parallel/anti-parallel angle mates. */
function stablePerpendicular(direction: Vec3): Vec3 | null {
  const ax = Math.abs(direction.x), ay = Math.abs(direction.y), az = Math.abs(direction.z);
  const basis = ax <= ay && ax <= az ? { x: 1, y: 0, z: 0 }
    : ay <= az ? { x: 0, y: 1, z: 0 }
      : { x: 0, y: 0, z: 1 };
  return normalizeSafe(crossVec(direction, basis));
}

// ─── small helpers for the analytical block above ────────────────────────

function directionOf(g: ResolvedGeometry): Vec3 | null {
  if (g.kind === 'axis') return g.world.direction;
  if (g.kind === 'plane') return g.world.normal;
  return null;
}

function crossVec(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function normalizeSafe(v: Vec3): Vec3 | null {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  if (len < 1e-9) return null;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

/** Project `v` onto the plane perpendicular to unit `axis`. */
function projectPerp(v: Vec3, axis: Vec3): Vec3 {
  const along = v.x * axis.x + v.y * axis.y + v.z * axis.z;
  return {
    x: v.x - axis.x * along,
    y: v.y - axis.y * along,
    z: v.z - axis.z * along,
  };
}

function lengthAndDir(v: Vec3): { length: number; unit: Vec3 } | null {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  if (len < 1e-9) return null;
  return { length: len, unit: { x: v.x / len, y: v.y / len, z: v.z / len } };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function quatAxisAngle(axis: Vec3, angle: number): Quat {
  const h = angle / 2;
  const s = Math.sin(h);
  return { x: axis.x * s, y: axis.y * s, z: axis.z * s, w: Math.cos(h) };
}

/**
 * Signed TWIST component of quaternion `q` about unit axis `u`
 * (swing-twist decomposition), in radians, wrapped to (−π, π].
 *
 * twist = 2·atan2(q_vec · u, q_w) after canonicalizing q to w ≥ 0.
 * A rotation of angle θ about u returns exactly θ; any rotation about an
 * axis perpendicular to u returns exactly 0. Exported for the kinematics
 * drive layer and the rack_pinion travel measurement.
 */
export function quatTwistAboutAxis(q: Quat, u: Vec3): number {
  const len = Math.sqrt(u.x * u.x + u.y * u.y + u.z * u.z);
  if (len < 1e-12) return 0;
  const ux = u.x / len;
  const uy = u.y / len;
  const uz = u.z / len;
  // Canonicalize (q and −q are the same rotation; force w ≥ 0 so the
  // twist lands in (−π, π]).
  const s = q.w < 0 ? -1 : 1;
  const proj = s * (q.x * ux + q.y * uy + q.z * uz);
  const w = s * q.w;
  return 2 * Math.atan2(proj, w);
}

/**
 * Scalar residual for one mate at the given part placements.
 *
 * EXPORTED (W5-F 2차): this is the single source of truth for mate
 * residual semantics. `lagrangianSolver.computeResidualForMate` delegates
 * here so the Gauss-Seidel and Newton engines can never drift apart again
 * (they had: the Newton copy lacked the slot slotLength penalty, the gear
 * backlash penalty, the rack_pinion travel penalty, the hinge Phase 2
 * signed-swing branch, and the plane-coincident normal-alignment term).
 */
export function computeMateResidual(
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
  // ── coincident plane/plane: gap along normal + NORMAL ALIGNMENT ──────
  // W5-F 2차 fix: the scalar residual used to measure only the
  // perpendicular offset of the fixed plane's origin along the MOVED
  // plane's normal. That leaves the moved part's rotation DoF unpenalized:
  // the Newton engine (which has no analytical placement step) could tilt
  // the part and FALSELY converge on a point of the residual-zero manifold
  // far from the intended coplanar pose (measured: expected x=20, Newton
  // landed x≈15.91 — scripts/dogfood/06, test E note).
  //
  // Added term: |n_a × n_b| · (1 + |o_b − o_a|).
  //   - |n_a × n_b| = sin(angle between the normals); 0 for parallel AND
  //     anti-parallel normals (both are valid coplanar poses).
  //   - The (1 + |o_b − o_a|) length scale is REQUIRED, not cosmetic:
  //     the gap term's slope w.r.t. a rotation is bounded by |o_b − o_a|
  //     (mm/rad), so an unscaled dimensionless sin term (slope ≤ 1/rad)
  //     loses the tug-of-war at the gap's |·| kink and the Newton engine
  //     stalls in a spurious local minimum of the summed scalar
  //     (measured: unscaled → stall at residual 0.81, x≈15.96; scaled →
  //     see the regression in scripts/dogfood/07). With the scale, the
  //     alignment slope ≥ the largest possible gap win, so un-tilting is
  //     always locally profitable. Units become mm-homogeneous as a bonus.
  if (mate.kind === 'coincident' && ag.kind === 'plane' && bg.kind === 'plane') {
    const diff = sub(bg.world.origin, ag.world.origin);
    const gap = Math.abs(dot(diff, ag.world.normal));
    const nCross = crossVec(ag.world.normal, bg.world.normal);
    const sinErr = Math.sqrt(nCross.x * nCross.x + nCross.y * nCross.y + nCross.z * nCross.z);
    const lengthScale = 1 + lengthOf(diff);
    return gap + sinErr * lengthScale;
  }
  if (mate.kind === 'distance' && ag.kind === 'point' && bg.kind === 'point') {
    return Math.abs(lengthOf(sub(bg.world, ag.world)) - mate.value);
  }
  // ── distance plane/plane: gap error + NORMAL ALIGNMENT ───────────────
  // W5-F 3차 fix (was the documented leftover of the W5-F 2차 commit):
  // the residual measured only ||signed gap| − target| along the side-A
  // normal. With the normals misaligned the "gap" is not even well
  // defined, yet the scalar could still hit 0 — measured fake
  // convergence on a 30°-tilted block: BOTH engines reported
  // converged=true, residual 0.0e+0 (gauss) / 1.5e-11 (newton), z=20,
  // tilt=30.000° (repro in iterativeSolver.extended.test.ts).
  //
  // Added term: |n_a × n_b| · (1 + |o_b − o_a|) — identical structure and
  // length-scale rationale as the plane-coincident residual above (the
  // gap term's slope w.r.t. rotation is bounded by |o_b − o_a| mm/rad,
  // so the unscaled sin term can lose the tug-of-war at the |·| kink).
  // |n_a × n_b| is 0 for BOTH parallel and anti-parallel normals — both
  // are valid poses for an unsigned gap constraint.
  //
  // The Gauss-Seidel placement step for this mate kind now rotates the
  // moved plane into the nearest (±) normal alignment before translating
  // (see applyAnalyticalPlacement), so the gauss engine consumes this
  // term analytically; the Newton engine falls back to numeric rows
  // while misaligned (lagrangianJacobian guard, same as coincident).
  if (mate.kind === 'distance' && ag.kind === 'plane' && bg.kind === 'plane') {
    const diff = sub(bg.world.origin, ag.world.origin);
    const signed = dot(diff, ag.world.normal);
    const gapErr = Math.abs(Math.abs(signed) - mate.value);
    const nCross = crossVec(ag.world.normal, bg.world.normal);
    const sinErr = Math.sqrt(nCross.x * nCross.x + nCross.y * nCross.y + nCross.z * nCross.z);
    const lengthScale = 1 + lengthOf(diff);
    return gapErr + sinErr * lengthScale;
  }
  if (mate.kind === 'parallel') {
    const aDir = directionOf(ag);
    const bDir = directionOf(bg);
    if (!aDir || !bDir) return 0;
    // Parallel iff |a × b| ≈ 0. Sin of the angle between them.
    return Math.hypot(
      aDir.y * bDir.z - aDir.z * bDir.y,
      aDir.z * bDir.x - aDir.x * bDir.z,
      aDir.x * bDir.y - aDir.y * bDir.x,
    );
  }
  if (mate.kind === 'perpendicular') {
    const aDir = directionOf(ag);
    const bDir = directionOf(bg);
    if (!aDir || !bDir) return 0;
    // Perp iff a · b ≈ 0.
    return Math.abs(aDir.x * bDir.x + aDir.y * bDir.y + aDir.z * bDir.z);
  }
  if (mate.kind === 'angle') {
    const aDir = directionOf(ag);
    const bDir = directionOf(bg);
    if (!aDir || !bDir) return 0;
    const cos = Math.max(-1, Math.min(1, aDir.x * bDir.x + aDir.y * bDir.y + aDir.z * bDir.z));
    const angleRad = Math.acos(cos);
    const targetRad = (mate.value * Math.PI) / 180;
    return Math.abs(angleRad - targetRad);
  }
  // ── hinge: same as concentric (axes collinear) + optional limit ──────
  // Total residual = primary (axis alignment) + secondary (limit penalty).
  //
  // Branch on whether the mate provides a Phase 2 body-frame zero-angle
  // reference:
  //
  //   Phase 1 (mate.zeroAngleRef === undefined) — UNSIGNED PROXY:
  //     We approximate the current swing angle as the FULL relative
  //     rotation between the two parts' orientation quaternions:
  //       dot(q_a, q_b) = cos(θ/2)  where θ = angle between the two frames
  //       approxAngle = 2·acos(|dot|)
  //     Sign is unresolved (magnitude only), so the bounds are treated
  //     symmetrically: any |approxAngle| outside `[min, max]` is
  //     penalised. mm-vs-rad unit mixing is the documented trade-off.
  //
  //   Phase 2 (mate.zeroAngleRef provided) — SIGNED SWING:
  //     Each side supplies a body-frame unit vector lying in the swing
  //     plane (perpendicular to that side's hinge axis). Transformed to
  //     world frame:
  //       A_world = rotateVec(ref.a, q_a)
  //       B_world = rotateVec(ref.b, q_b)
  //     The hinge axis in world is taken from ag.world.direction (the
  //     side-A resolved axis; concentric residual already ensures the
  //     two sides agree to within `alignErr`). The signed swing angle:
  //       swing = atan2((A × B) · axis, A · B)
  //     Limit residual = max(0, min - swing, swing - max), converted to
  //     radians.
  //
  // Edge case: when the two world axes are not yet aligned (concentric
  // residual > 0), the Phase 2 swing still computes (it just measures the
  // signed angle from A to B around the side-A axis — graceful, not NaN).
  if (mate.kind === 'hinge' && ag.kind === 'axis' && bg.kind === 'axis') {
    const alignErr = distanceAxisToAxis(ag.world, bg.world);
    if (mate.limit === undefined && mate.zeroAngleRef === undefined) {
      return alignErr;
    }
    // ── Phase 2 signed swing branch ───────────────────────────────────
    if (mate.zeroAngleRef !== undefined) {
      const ref = mate.zeroAngleRef;
      const aWorld = rotateVec(ref.a, a.orientation);
      const bWorld = rotateVec(ref.b, b.orientation);
      // Use the side-A world axis as the swing axis (concentric residual
      // bounds the disagreement). Normalize defensively in case the
      // resolver hands back a non-unit direction.
      const axis = normalizeSafe(ag.world.direction) ?? ag.world.direction;
      // Project A and B onto the plane perpendicular to axis so atan2
      // measures only the swing component (not any tilt out of plane).
      const aPerp = projectPerp(aWorld, axis);
      const bPerp = projectPerp(bWorld, axis);
      const cosSwing = dot(aPerp, bPerp);
      const crossAB = crossVec(aPerp, bPerp);
      const sinSwing = dot(crossAB, axis);
      const swingRad = Math.atan2(sinSwing, cosSwing);
      if (mate.limit === undefined) return alignErr;
      const minRad = (mate.limit.minAngleDeg * Math.PI) / 180;
      const maxRad = (mate.limit.maxAngleDeg * Math.PI) / 180;
      let limitPenaltyRad = 0;
      if (swingRad > maxRad) limitPenaltyRad = swingRad - maxRad;
      else if (swingRad < minRad) limitPenaltyRad = minRad - swingRad;
      return alignErr + limitPenaltyRad;
    }
    // ── Phase 1 unsigned proxy branch (back-compat) ───────────────────
    const qa = a.orientation;
    const qb = b.orientation;
    const dotQ = qa.x * qb.x + qa.y * qb.y + qa.z * qb.z + qa.w * qb.w;
    const cosHalf = Math.min(1, Math.abs(dotQ));
    const approxAngleRad = 2 * Math.acos(cosHalf);
    const approxAngleDeg = (approxAngleRad * 180) / Math.PI;
    // Symmetric bound: penalty triggered when |angle| exceeds either
    // limit endpoint's absolute value.
    const minDeg = mate.limit!.minAngleDeg;
    const maxDeg = mate.limit!.maxAngleDeg;
    let limitPenaltyDeg = 0;
    if (approxAngleDeg > maxDeg) {
      limitPenaltyDeg = approxAngleDeg - maxDeg;
    } else if (-approxAngleDeg < minDeg) {
      // Negative-side violation (mirror of the proxy, since |angle| only).
      limitPenaltyDeg = minDeg - -approxAngleDeg;
    }
    // Convert to radians so the secondary term has the same units as
    // the alignErr (mm vs rad is mixed — documented Phase 1 trade-off).
    const limitPenaltyRad = (limitPenaltyDeg * Math.PI) / 180;
    return alignErr + limitPenaltyRad;
  }

  // ── slot: perpendicular distance from pin axis to slot edge line +
  //    perpendicularity error + optional length-clamp penalty.
  //
  // Total residual = perpDist + perpErr + lengthPenalty
  //   - perpDist: pin axis line to slot edge line (mm).
  //   - perpErr: |cos(angle(pinDir, slotDir))| — alignment error.
  //   - lengthPenalty: if slotLength set, project pin origin onto slot
  //     direction → t. Penalize t < 0 with |t|, t > slotLength with
  //     (t - slotLength). Pre-existing behavior when slotLength is
  //     undefined: lengthPenalty = 0.
  if (mate.kind === 'slot' && ag.kind === 'axis' && bg.kind === 'axis') {
    // ag = slot edge (refKind 'edge' but exposed as 'axis' by resolver);
    // bg = pin axis. The residual measures how far the pin's axis line
    // is from the slot edge's line.
    const perpDist = distanceAxisToAxis(ag.world, bg.world);
    // Pin direction should be PERPENDICULAR to slot direction. |cos|
    // captures the alignment error (0 = perfectly perpendicular).
    const cos = ag.world.direction.x * bg.world.direction.x +
      ag.world.direction.y * bg.world.direction.y +
      ag.world.direction.z * bg.world.direction.z;
    const perpErr = Math.abs(cos);
    let lengthPenalty = 0;
    if (mate.slotLength !== undefined) {
      // t = (pin.origin - slot.origin) · slotDir  (parametric coord
      // along the slot, measured from slot's start point).
      const dx = bg.world.origin.x - ag.world.origin.x;
      const dy = bg.world.origin.y - ag.world.origin.y;
      const dz = bg.world.origin.z - ag.world.origin.z;
      const t = dx * ag.world.direction.x +
        dy * ag.world.direction.y +
        dz * ag.world.direction.z;
      if (t < 0) lengthPenalty = -t;
      else if (t > mate.slotLength) lengthPenalty = t - mate.slotLength;
    }
    return perpDist + perpErr + lengthPenalty;
  }

  // ── gear: shafts must be COPLANAR (parallel-at-any-offset OR
  //    intersecting). Skew shafts (non-parallel AND non-intersecting)
  //    cannot mesh and produce a nonzero residual.
  //
  // Total residual = coplanarityErr + backlashPenalty.
  //   - coplanarityErr: skew distance between the two shaft lines.
  //   - backlashPenalty (Phase 3.2.5.1, report-only): angular alignment
  //     error between the shaft direction vectors, dampened by the
  //     backlash dead-band. The angle is `acos(|d_a · d_b|)` (we treat
  //     anti-parallel as equivalent — gear shafts may face either way).
  //     With backlash > 0, the penalty is `max(0, theta - backlash)`.
  //     Phase 1 caveat: gear placement is a no-op so this term affects
  //     RESIDUAL REPORTING only — it surfaces meshing tolerance in
  //     diagnostics. A future dynamics pass will use backlash for
  //     velocity-coupling deadzone.
  //
  //    Coplanarity test: |(p_b - p_a) · (d_a × d_b)| == 0.
  //    - If d_a × d_b == 0 (parallel/anti-parallel): always coplanar
  //      regardless of offset. coplanarityErr = 0 (parallel gears at any
  //      offset are mesh-compatible — the offset is the gear-pair pitch
  //      distance and is a separate design constraint, not a mate
  //      constraint).
  //    - If d_a × d_b ≠ 0: coplanarityErr = signed-volume / |d_a × d_b|
  //      = closest-approach (skew) distance. 0 for intersecting axes
  //      (bevel-gear case), nonzero for fully skew axes.
  if (mate.kind === 'gear' && ag.kind === 'axis' && bg.kind === 'axis') {
    const cx = ag.world.direction.y * bg.world.direction.z -
      ag.world.direction.z * bg.world.direction.y;
    const cy = ag.world.direction.z * bg.world.direction.x -
      ag.world.direction.x * bg.world.direction.z;
    const cz = ag.world.direction.x * bg.world.direction.y -
      ag.world.direction.y * bg.world.direction.x;
    const crossLen = Math.sqrt(cx * cx + cy * cy + cz * cz);
    let coplanarityErr: number;
    if (crossLen < 1e-9) {
      // Parallel/anti-parallel shafts — always coplanar; mesh OK.
      coplanarityErr = 0;
    } else {
      // Skew distance: |(b.origin - a.origin) · (cross / |cross|)|.
      const dx = bg.world.origin.x - ag.world.origin.x;
      const dy = bg.world.origin.y - ag.world.origin.y;
      const dz = bg.world.origin.z - ag.world.origin.z;
      coplanarityErr = Math.abs(dx * cx + dy * cy + dz * cz) / crossLen;
    }
    // Backlash secondary term (report-only). Only contributes when the
    // mate explicitly declares a `backlash` — back-compat with the
    // Phase 3.2.6 baseline where bevel-gear (perpendicular intersecting)
    // and skew-shaft setups report only the coplanarity error.
    let backlashPenalty = 0;
    if (mate.backlash !== undefined) {
      const dotDirs = ag.world.direction.x * bg.world.direction.x +
        ag.world.direction.y * bg.world.direction.y +
        ag.world.direction.z * bg.world.direction.z;
      const cosClamped = Math.max(-1, Math.min(1, Math.abs(dotDirs)));
      const theta = Math.acos(cosClamped);
      // Standard mesh geometry pairs PARALLEL (theta ≈ 0) shafts; the
      // dead-band tolerates `backlash` radians of misalignment.
      backlashPenalty = Math.max(0, theta - mate.backlash);
    }
    return coplanarityErr + backlashPenalty;
  }

  // ── rack & pinion: pinion axis must lie at perpendicular distance
  //    equal to `pinionRadius` from the rack edge (pinion pitch circle
  //    tangent to rack pitch line).
  //
  // Total residual = mountErr + travelPenalty.
  //   - mountErr: |perpDist - pinionRadius| + |cos(pinionDir, rackDir)|.
  //   - travelPenalty: if rackTravel set, derive the pinion's current
  //     angular phase from its part orientation quaternion (Phase 1
  //     proxy: full quaternion angle, sign unresolved), convert to
  //     linear rack position via `pos = approxAngle_rad × pinionRadius`,
  //     and penalize when pos is outside [min, max].
  if (mate.kind === 'rack_pinion' && ag.kind === 'axis' && bg.kind === 'axis') {
    // mate.a = pinion axis (resolved into ag against part `a`).
    // mate.b = rack edge (resolved into bg against part `b`). The
    // resolver exposes both as 'axis'-kind geometry. Pinion axis should
    // ideally be perpendicular to rack edge (cos ≈ 0) AND at distance
    // = pinionRadius.
    const perpDist = distanceAxisToAxis(ag.world, bg.world);
    const cos = ag.world.direction.x * bg.world.direction.x +
      ag.world.direction.y * bg.world.direction.y +
      ag.world.direction.z * bg.world.direction.z;
    const perpErr = Math.abs(cos);
    const mountErr = Math.abs(perpDist - mate.pinionRadius) + perpErr;
    let travelPenalty = 0;
    if (mate.rackTravel !== undefined) {
      // W5-F 2차: the pinion's spin is measured as the TWIST component of
      // part `a`'s orientation about the resolved pinion axis (swing-twist
      // decomposition), replacing the old full-quaternion-angle proxy.
      // The old proxy (2·acos(|q.w|)) penalized ANY rotation of the part
      // — measured: tilting the part 60° about an axis unrelated to the
      // pinion axis produced a spurious travel penalty of 5.47 mm. The
      // twist measurement is exactly 0 for rotations perpendicular to the
      // pinion axis and exactly the spin angle for rotations about it.
      // Remaining approximation (documented): the zero reference is part
      // `a`'s IDENTITY orientation (no body-frame zero vector yet), and
      // the twist is wrapped to (−π, π] — travel beyond ±half a turn
      // aliases. Signed rack position: pos = twist_rad × pinionRadius.
      const twistRad = quatTwistAboutAxis(a.orientation, ag.world.direction);
      const rackPos = twistRad * mate.pinionRadius;
      if (rackPos < mate.rackTravel.min) {
        travelPenalty = mate.rackTravel.min - rackPos;
      } else if (rackPos > mate.rackTravel.max) {
        travelPenalty = rackPos - mate.rackTravel.max;
      }
    }
    return mountErr + travelPenalty;
  }

  // Tangent: not yet supported analytically; residual undefined.
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

