/**
 * lagrangianJacobian — Phase 3.2 of NexyFab Pro own-CAD (ADR-013).
 *
 * Closed-form analytic Jacobian rows for each mate kind, used by the
 * Newton-Lagrange solver. Companion module to `lagrangianSolver.ts` —
 * Phase 3.1 of that solver computed the Jacobian by forward differences
 * (cheap to implement, generic, but 6N+1 residual evaluations per Newton
 * step). This module replaces that with a per-mate-kind closed-form
 * derivative, eliminating the perturbation loop and shaving ~6-10×
 * Jacobian-assembly cost on typical fixtures while matching the numeric
 * value to within ~1e-9 in absolute terms.
 *
 * Derivation summary:
 *
 *   Each free part carries 6 DoF: (tx, ty, tz, rx, ry, rz) where the
 *   rotation triple is the Lie-algebra tangent at the part's current
 *   orientation. The local-to-world map for a body-frame point p_local is
 *   p_world = part.position + Rotate(part.orientation, p_local). Its
 *   derivative at the zero perturbation:
 *     ∂p_world / ∂t_i = e_i                (i = x, y, z)
 *     ∂p_world / ∂r_i = e_i × (p_world − part.position)
 *
 *   For a body-frame DIRECTION vector d (axis direction, plane normal),
 *   translation has no effect and rotation gives:
 *     ∂d_world / ∂t_i = 0
 *     ∂d_world / ∂r_i = e_i × d_world
 *
 *   The Jacobian row for a scalar residual r(p_world, d_world, ...) is
 *   then the chain rule of r through these primitives.
 *
 * Coverage (Phase 3.2 — 7 standard mate kinds):
 *
 *   ┌────────────────────┬──────────────────────────────────────────────┐
 *   │ mate kind          │ residual                                     │
 *   ├────────────────────┼──────────────────────────────────────────────┤
 *   │ concentric         │ skew distance between two axes               │
 *   │ coincident point   │ Euclidean distance between two points        │
 *   │ coincident plane   │ |signed distance from moved origin to plane| │
 *   │ parallel           │ |cross(a, b)|  (sin of angle between dirs)   │
 *   │ perpendicular      │ |dot(a, b)|    (cos of angle between dirs)   │
 *   │ distance pt/pt     │ ||p_a − p_b| − target|                       │
 *   │ distance plane     │ ||signed plane gap| − target|                │
 *   │ angle              │ |acos(dot(a, b)) − target_rad|               │
 *   └────────────────────┴──────────────────────────────────────────────┘
 *
 * Coverage (Phase 3.2.2 — 4 advanced mate kinds):
 *
 *   ┌────────────────────┬──────────────────────────────────────────────┐
 *   │ mate kind          │ residual decomposition (per lagrangianSolver)│
 *   ├────────────────────┼──────────────────────────────────────────────┤
 *   │ hinge              │ primary = concentric (axis/axis skew dist).  │
 *   │                    │ secondary = limit penalty (proxy, numeric).  │
 *   │ slot               │ primary = concentric (perpDist) + perpendic. │
 *   │ gear               │ primary = coplanarity (skew dist; parallel→0)│
 *   │ rack_pinion        │ primary = |perpDist - pinionRadius| + |cos|  │
 *   └────────────────────┴──────────────────────────────────────────────┘
 *
 *   The advanced residuals defined in `lagrangianSolver.computeResidualForMate`
 *   are SCALAR-SUMMED into a single row (one row per mate, matching the
 *   existing API). The analytic row sums the derivative of every term in
 *   the sum that has a closed form.
 *
 *   Secondary terms that fall back to numeric forward differences (when
 *   present in the mate IR — currently only HingeMate.limit is summed
 *   into the lagrangianSolver residual; slot/gear/rack_pinion ignore
 *   their length/backlash/travel options at the lagrangian level):
 *
 *     - HingeMate.limit (Phase 1 unsigned quaternion-dot proxy):
 *         when an active limit penalty contributes a non-zero secondary,
 *         analyticJacobianRow returns an EMPTY row to delegate to the
 *         per-row numeric fallback in lagrangianSolveAnalytic. This keeps
 *         the analytic path strictly correct: a partial analytic row
 *         mixed with numeric perturbations would silently misalign the
 *         Jacobian columns. When limit is absent OR the swing sits inside
 *         the allowed band (penalty = 0), the primary-only row is exact.
 *
 * Not yet analytic (Phase 3.2.1 follow-up):
 *
 *   tangent → supportsAnalyticJacobian returns FALSE. lagrangianSolveAnalytic
 *   falls back to the numeric forward-difference path on a per-mate basis so
 *   a single tangent mate in an otherwise standard assembly still gets the
 *   analytic speed-up on the rest of the rows.
 *
 * The two surfaced functions:
 *   - analyticJacobianRow(mate, moved, fixed, movedG, fixedG, mOff, fOff)
 *     → sparse row { cols, values } in the global DoF vector
 *   - supportsAnalyticJacobian(kind) → boolean dispatch helper
 *
 * Plus `lagrangianSolveAnalytic` (exported from lagrangianSolver) which is
 * a sibling to `lagrangianSolve` that uses this module to build J row by
 * row, falling back to the numeric path for unsupported mates.
 */

import type { PartInstance } from './assemblyState';
import type { HingeMate, Mate, MateKind } from './mate';
import type { ResolvedGeometry } from './iterativeSolver';
import { quatTwistAboutAxis } from './iterativeSolver';
import { type Vec3, sub, dot, lengthOf } from '@/lib/sketch/sketchPlane';

// ─── public API ──────────────────────────────────────────────────────────

/**
 * One row of the Jacobian (one mate → one scalar residual). Stored sparse:
 * only the DoF columns actually touched by this mate carry entries. For a
 * typical 2-part mate that's at most 12 entries (6 per part); the rest of
 * the row in the dense (M × 6N) Jacobian is implicitly zero.
 */
export interface AnalyticJacobianRow {
  /** Column indices in the global DoF vector (length 6N, 6 per free part). */
  cols: number[];
  /** Corresponding ∂r/∂q values, same length as cols. */
  values: number[];
}

/**
 * Return true if `analyticJacobianRow` has a closed-form derivative for
 * this mate kind (paired with the corresponding refKinds). When false,
 * callers should fall back to numeric forward differences for this row.
 */
export function supportsAnalyticJacobian(kind: MateKind): boolean {
  switch (kind) {
    case 'concentric':
    case 'coincident':
    case 'parallel':
    case 'perpendicular':
    case 'distance':
    case 'angle':
    // ── Phase 3.2.2 advanced mate analytic coverage ──────────────────────
    case 'hinge':
    case 'slot':
    case 'gear':
    case 'rack_pinion':
      return true;
    case 'tangent':
      return false;
  }
}

/**
 * Compute the analytic Jacobian row for one mate.
 *
 * Inputs:
 *   - mate: the mate IR.
 *   - movedPart / fixedPart: the two PartInstances. "moved" is the side
 *     mapped to mate.a; "fixed" is the side mapped to mate.b. The naming
 *     is historical — both sides can be free; this function fills in the
 *     non-zero columns for whichever side is free (per the DoF offsets).
 *   - movedResolved / fixedResolved: world-frame geometry already resolved
 *     by the caller. Must match the mate's refKinds.
 *   - movedDofOffset / fixedDofOffset: the starting column index in the
 *     global DoF vector for each part. Pass −1 to indicate that side is
 *     FIXED (no DoF allocated) — its 6 contributions are dropped.
 *
 * Returns a sparse row; callers stamp the values into the dense Jacobian.
 * If the mate is unsupported (see `supportsAnalyticJacobian`) the row is
 * returned EMPTY — callers should detect this and fall back to numeric.
 */
export function analyticJacobianRow(
  mate: Mate,
  movedPart: PartInstance,
  fixedPart: PartInstance,
  movedResolved: ResolvedGeometry,
  fixedResolved: ResolvedGeometry,
  movedDofOffset: number,
  fixedDofOffset: number,
): AnalyticJacobianRow {
  if (!supportsAnalyticJacobian(mate.kind)) return EMPTY_ROW();

  // ── coincident: branch by refKind ────────────────────────────────────
  if (mate.kind === 'coincident') {
    if (movedResolved.kind === 'point' && fixedResolved.kind === 'point') {
      return coincidentPointRow(
        movedPart, fixedPart,
        movedResolved.world, fixedResolved.world,
        movedDofOffset, fixedDofOffset,
      );
    }
    if (movedResolved.kind === 'plane' && fixedResolved.kind === 'plane') {
      // W5-F 2차: the shared residual now adds a normal-alignment term
      // |n_a × n_b| · (1 + |o_b − o_a|) on top of the perpendicular-gap
      // term. No closed-form row is maintained for the length-scaled
      // product, so whenever the normals are actually misaligned the row
      // defers to numeric (empty row → per-row forward differences).
      // When the normals are aligned (|cross| < 1e-9) the alignment term
      // sits at its kink minimum — zero-gradient convention, same as the
      // standalone parallel mate — and the classic gap row is exact.
      const nA = movedResolved.world.normal;
      const nB = fixedResolved.world.normal;
      const cx = nA.y * nB.z - nA.z * nB.y;
      const cy = nA.z * nB.x - nA.x * nB.z;
      const cz = nA.x * nB.y - nA.y * nB.x;
      if (Math.sqrt(cx * cx + cy * cy + cz * cz) >= 1e-9) return EMPTY_ROW();
      return coincidentPlaneRow(
        movedPart, fixedPart,
        movedResolved.world.origin, movedResolved.world.normal,
        fixedResolved.world.origin, fixedResolved.world.normal,
        movedDofOffset, fixedDofOffset,
      );
    }
    return EMPTY_ROW();
  }

  // ── concentric axis/axis ─────────────────────────────────────────────
  if (mate.kind === 'concentric') {
    if (movedResolved.kind === 'axis' && fixedResolved.kind === 'axis') {
      return concentricRow(
        movedPart, fixedPart,
        movedResolved.world.origin, movedResolved.world.direction,
        fixedResolved.world.origin, fixedResolved.world.direction,
        movedDofOffset, fixedDofOffset,
      );
    }
    return EMPTY_ROW();
  }

  // ── parallel ─────────────────────────────────────────────────────────
  if (mate.kind === 'parallel') {
    const aDir = directionOf(movedResolved);
    const bDir = directionOf(fixedResolved);
    if (!aDir || !bDir) return EMPTY_ROW();
    return parallelRow(aDir, bDir, movedDofOffset, fixedDofOffset);
  }

  // ── perpendicular ────────────────────────────────────────────────────
  if (mate.kind === 'perpendicular') {
    const aDir = directionOf(movedResolved);
    const bDir = directionOf(fixedResolved);
    if (!aDir || !bDir) return EMPTY_ROW();
    return perpendicularRow(aDir, bDir, movedDofOffset, fixedDofOffset);
  }

  // ── distance ─────────────────────────────────────────────────────────
  if (mate.kind === 'distance') {
    if (movedResolved.kind === 'point' && fixedResolved.kind === 'point') {
      return distancePointRow(
        movedPart, fixedPart,
        movedResolved.world, fixedResolved.world,
        mate.value,
        movedDofOffset, fixedDofOffset,
      );
    }
    if (movedResolved.kind === 'plane' && fixedResolved.kind === 'plane') {
      return distancePlaneRow(
        movedPart, fixedPart,
        movedResolved.world.origin, movedResolved.world.normal,
        fixedResolved.world.origin, fixedResolved.world.normal,
        mate.value,
        movedDofOffset, fixedDofOffset,
      );
    }
    return EMPTY_ROW();
  }

  // ── angle ────────────────────────────────────────────────────────────
  if (mate.kind === 'angle') {
    const aDir = directionOf(movedResolved);
    const bDir = directionOf(fixedResolved);
    if (!aDir || !bDir) return EMPTY_ROW();
    return angleRow(aDir, bDir, mate.value, movedDofOffset, fixedDofOffset);
  }

  // ── hinge ────────────────────────────────────────────────────────────
  // Primary residual = concentric (axis/axis skew distance), reusing
  // concentricRow verbatim. When the mate carries a `limit` AND the
  // current swing has an active penalty (proxy form in lagrangianSolver),
  // the residual sum contains a quaternion-derivative term that we leave
  // to the numeric per-row fallback — emitting an empty row signals that
  // to lagrangianSolveAnalytic.
  if (mate.kind === 'hinge') {
    if (movedResolved.kind === 'axis' && fixedResolved.kind === 'axis') {
      // W5-F 2차: with a Phase 2 zeroAngleRef AND a limit, the shared
      // residual uses the signed-swing branch whose derivative involves
      // the body-frame reference vectors — not covered analytically.
      // Defer the whole row to numeric.
      if (mate.limit !== undefined && mate.zeroAngleRef !== undefined) {
        return EMPTY_ROW();
      }
      if (hingeLimitActive(mate, movedPart, fixedPart)) {
        // Defer to numeric (caller falls back when row is empty).
        return EMPTY_ROW();
      }
      return concentricRow(
        movedPart, fixedPart,
        movedResolved.world.origin, movedResolved.world.direction,
        fixedResolved.world.origin, fixedResolved.world.direction,
        movedDofOffset, fixedDofOffset,
      );
    }
    return EMPTY_ROW();
  }

  // ── slot ─────────────────────────────────────────────────────────────
  // Residual = perpDist(slot edge line, pin axis line)  +  |cos(d_slot, d_pin)|.
  // First term = concentric row; second term = perpendicular row. Sum the
  // two analytic rows column by column.
  if (mate.kind === 'slot') {
    if (movedResolved.kind === 'axis' && fixedResolved.kind === 'axis') {
      // W5-F 2차: the shared residual adds a slotLength segment penalty
      // (pin parametric coord t outside [0, slotLength]). When that
      // penalty is ACTIVE the analytic sum below is missing its gradient
      // — defer the row to numeric.
      if (mate.slotLength !== undefined) {
        // movedResolved = slot edge (mate.a), fixedResolved = pin (mate.b).
        const t =
          (fixedResolved.world.origin.x - movedResolved.world.origin.x) * movedResolved.world.direction.x +
          (fixedResolved.world.origin.y - movedResolved.world.origin.y) * movedResolved.world.direction.y +
          (fixedResolved.world.origin.z - movedResolved.world.origin.z) * movedResolved.world.direction.z;
        if (t < 0 || t > mate.slotLength) return EMPTY_ROW();
      }
      const cRow = concentricRow(
        movedPart, fixedPart,
        movedResolved.world.origin, movedResolved.world.direction,
        fixedResolved.world.origin, fixedResolved.world.direction,
        movedDofOffset, fixedDofOffset,
      );
      const pRow = perpendicularRow(
        movedResolved.world.direction, fixedResolved.world.direction,
        movedDofOffset, fixedDofOffset,
      );
      return sumRows(cRow, pRow);
    }
    return EMPTY_ROW();
  }

  // ── gear ─────────────────────────────────────────────────────────────
  // Residual = coplanarity error between shaft axes. The skew branch is
  // exactly the concentric skew formula; the parallel branch in
  // computeResidualForMate returns 0 (parallel shafts always coplanar) —
  // so we emit a ZERO row in that case (no gradient to follow).
  if (mate.kind === 'gear') {
    if (movedResolved.kind === 'axis' && fixedResolved.kind === 'axis') {
      // W5-F 2차: the shared residual adds a backlash dead-band penalty
      // max(0, θ − backlash) on shaft-direction misalignment. Outside the
      // dead-band the analytic coplanarity row is missing that gradient —
      // defer to numeric. Inside the band the penalty is identically 0
      // and the coplanarity row remains exact.
      if (mate.backlash !== undefined) {
        const dotDirs =
          movedResolved.world.direction.x * fixedResolved.world.direction.x +
          movedResolved.world.direction.y * fixedResolved.world.direction.y +
          movedResolved.world.direction.z * fixedResolved.world.direction.z;
        const cosClamped = Math.max(-1, Math.min(1, Math.abs(dotDirs)));
        if (Math.acos(cosClamped) > mate.backlash) return EMPTY_ROW();
      }
      return gearCoplanarityRow(
        movedPart, fixedPart,
        movedResolved.world.origin, movedResolved.world.direction,
        fixedResolved.world.origin, fixedResolved.world.direction,
        movedDofOffset, fixedDofOffset,
      );
    }
    return EMPTY_ROW();
  }

  // ── rack_pinion ──────────────────────────────────────────────────────
  // Residual = |perpDist(pinion, rack) - pinionRadius|  +  |cos(d_pinion, d_rack)|.
  // First term = a distance-to-target on axis/axis (new pattern, derived
  // from the concentric skew formula); second term = perpendicular row.
  if (mate.kind === 'rack_pinion') {
    if (movedResolved.kind === 'axis' && fixedResolved.kind === 'axis') {
      // W5-F 2차: the shared residual adds a travel penalty derived from
      // the pinion part's TWIST about its axis. When active, its gradient
      // (a quaternion derivative) is not in the analytic sum — defer.
      if (mate.rackTravel !== undefined) {
        const twistRad = quatTwistAboutAxis(
          movedPart.orientation, movedResolved.world.direction,
        );
        const rackPos = twistRad * mate.pinionRadius;
        if (rackPos < mate.rackTravel.min || rackPos > mate.rackTravel.max) {
          return EMPTY_ROW();
        }
      }
      const dRow = axisDistanceTargetRow(
        movedPart, fixedPart,
        movedResolved.world.origin, movedResolved.world.direction,
        fixedResolved.world.origin, fixedResolved.world.direction,
        mate.pinionRadius,
        movedDofOffset, fixedDofOffset,
      );
      const pRow = perpendicularRow(
        movedResolved.world.direction, fixedResolved.world.direction,
        movedDofOffset, fixedDofOffset,
      );
      return sumRows(dRow, pRow);
    }
    return EMPTY_ROW();
  }

  return EMPTY_ROW();
}

// ─── helpers ─────────────────────────────────────────────────────────────

function EMPTY_ROW(): AnalyticJacobianRow {
  return { cols: [], values: [] };
}

function directionOf(g: ResolvedGeometry): Vec3 | null {
  if (g.kind === 'axis') return g.world.direction;
  if (g.kind === 'plane') return g.world.normal;
  return null;
}

/**
 * Push a (translation gradient, rotation gradient) pair onto the row for
 * the part whose DoF block starts at `offset`. When offset < 0 the part is
 * fixed and nothing is pushed.
 *
 * - tGrad: ∂r/∂(t_x, t_y, t_z) for this part.
 * - rGrad: ∂r/∂(r_x, r_y, r_z) for this part (Lie-algebra at zero).
 */
function pushPartContribution(
  row: AnalyticJacobianRow,
  offset: number,
  tGrad: Vec3,
  rGrad: Vec3,
): void {
  if (offset < 0) return;
  row.cols.push(offset + 0); row.values.push(tGrad.x);
  row.cols.push(offset + 1); row.values.push(tGrad.y);
  row.cols.push(offset + 2); row.values.push(tGrad.z);
  row.cols.push(offset + 3); row.values.push(rGrad.x);
  row.cols.push(offset + 4); row.values.push(rGrad.y);
  row.cols.push(offset + 5); row.values.push(rGrad.z);
}

/**
 * Cross product e_i × v for each i ∈ {x, y, z}. Returns the three rows
 * stacked into a Vec3 per component of e_i: i.e. (e_x × v, e_y × v, e_z × v).
 * Used to compute the rotational part of the position/direction gradient
 * via the chain rule.
 *
 * The result is the matrix [-v]_× transposed; we expose it as three Vec3s
 * to keep callers from re-deriving the cross product inline.
 */
function rotationalGradient(v: Vec3): { ex: Vec3; ey: Vec3; ez: Vec3 } {
  // e_x × v = (0, -v.z, v.y)
  // e_y × v = (v.z, 0, -v.x)
  // e_z × v = (-v.y, v.x, 0)
  return {
    ex: { x: 0, y: -v.z, z: v.y },
    ey: { x: v.z, y: 0, z: -v.x },
    ez: { x: -v.y, y: v.x, z: 0 },
  };
}

/**
 * Sign of x, returning 1 for x = 0 (so |x|'s derivative at zero is treated
 * as +1 — matches the LM solver's expectations on the absolute-value
 * residuals: any direction away from zero is "fine"; the kink at zero is
 * regularised by LM's λ damping).
 */
function signSafe(x: number): number {
  return x >= 0 ? 1 : -1;
}

// ─── per-mate-kind row builders ─────────────────────────────────────────

/**
 * coincident_point/point — residual = |p_moved − p_fixed| (Euclidean).
 *
 * Let d = p_m − p_f, r = |d|. Then:
 *   ∂r/∂p_m = d / r   (unit vector from fixed to moved)
 *   ∂r/∂p_f = −d / r
 *
 * Chain through ∂p_m/∂q_m (e_i for translation, e_i × (p_m − part_m.pos)
 * for rotation), and similarly for the fixed side.
 */
function coincidentPointRow(
  movedPart: PartInstance, fixedPart: PartInstance,
  pMoved: Vec3, pFixed: Vec3,
  mOff: number, fOff: number,
): AnalyticJacobianRow {
  const row = EMPTY_ROW();
  const d = sub(pMoved, pFixed);
  const r = lengthOf(d);
  if (r < 1e-12) {
    // Residual is at its kink (|0|). Gradient is undefined; LM damping
    // handles this — emit a zero row so this mate doesn't drag the
    // step. (Numeric forward-diff also returns ~0 here.)
    return row;
  }
  const u: Vec3 = { x: d.x / r, y: d.y / r, z: d.z / r };

  // Moved side: ∂r/∂p_m = u
  // ∂p_m/∂t = I  → translation gradient = u
  // ∂p_m/∂rot_i = e_i × (p_m − movedPart.position)
  //   → rotation gradient component i = u · (e_i × (p_m − movedPart.position))
  //   = (movedRel × u) · e_i, since u · (e × r) = (r × u) · e (triple product)
  // Wait — that's u · (e × r) = e · (r × u). So rot grad = (movedRel × u) on
  // the e_i basis. Equivalently rotationalGradient(movedRel) dotted with u.
  const movedRel = sub(pMoved, movedPart.position);
  const movedRotG = rotationalGradient(movedRel);
  const movedTGrad: Vec3 = { x: u.x, y: u.y, z: u.z };
  const movedRGrad: Vec3 = {
    x: dot(movedRotG.ex, u),
    y: dot(movedRotG.ey, u),
    z: dot(movedRotG.ez, u),
  };
  pushPartContribution(row, mOff, movedTGrad, movedRGrad);

  // Fixed side gets the OPPOSITE sign: ∂r/∂p_f = −u.
  const fixedRel = sub(pFixed, fixedPart.position);
  const fixedRotG = rotationalGradient(fixedRel);
  const fixedTGrad: Vec3 = { x: -u.x, y: -u.y, z: -u.z };
  const fixedRGrad: Vec3 = {
    x: -dot(fixedRotG.ex, u),
    y: -dot(fixedRotG.ey, u),
    z: -dot(fixedRotG.ez, u),
  };
  pushPartContribution(row, fOff, fixedTGrad, fixedRGrad);

  return row;
}

/**
 * coincident_plane/plane — residual = |(o_b − o_a) · n_a|.
 *
 * The lagrangianSolver `computeResidualForMate` uses the MOVED plane's
 * normal (ag.world.normal) as the "reference" normal — the residual reads
 * the perpendicular distance from the fixed plane's origin (o_b) to the
 * moved plane (o_a, n_a). Mirroring that:
 *   signed s = (o_b − o_a) · n_a
 *   r = |s|
 *
 * Partial wrt the moved plane's origin (translation of moved part):
 *   ∂s/∂o_a = −n_a       → ∂r/∂o_a = −sign(s) · n_a
 * Partial wrt moved plane's normal (rotation of moved part):
 *   ∂s/∂n_a = (o_b − o_a) → ∂r/∂n_a = sign(s) · (o_b − o_a)
 * Partial wrt fixed plane's origin (translation of fixed part):
 *   ∂s/∂o_b = n_a         → ∂r/∂o_b = sign(s) · n_a
 * Fixed normal does not enter the residual → 0.
 *
 * Then chain origins and normals through ∂(origin or normal)/∂DoF.
 */
function coincidentPlaneRow(
  movedPart: PartInstance, fixedPart: PartInstance,
  oA: Vec3, nA: Vec3,
  oB: Vec3, _nB: Vec3,
  mOff: number, fOff: number,
): AnalyticJacobianRow {
  void _nB; // not used; the moved-plane normal carries the constraint.
  const row = EMPTY_ROW();
  const diff = sub(oB, oA);
  const s = dot(diff, nA);
  const sgn = signSafe(s);
  // Moved side:
  //   ∂r/∂o_a · ∂o_a/∂t_moved = −sgn · n_a
  //   ∂r/∂o_a · ∂o_a/∂rot_moved = −sgn · n_a · (e_i × (o_a − pos_moved))
  //   ∂r/∂n_a · ∂n_a/∂rot_moved = sgn · diff · (e_i × n_a)
  // No translational contribution from n_a (directions don't translate).
  const movedRelO = sub(oA, movedPart.position);
  const rotGmO = rotationalGradient(movedRelO);
  const rotGmN = rotationalGradient(nA);
  const tM: Vec3 = { x: -sgn * nA.x, y: -sgn * nA.y, z: -sgn * nA.z };
  const rM: Vec3 = {
    x: -sgn * dot(rotGmO.ex, nA) + sgn * dot(rotGmN.ex, diff),
    y: -sgn * dot(rotGmO.ey, nA) + sgn * dot(rotGmN.ey, diff),
    z: -sgn * dot(rotGmO.ez, nA) + sgn * dot(rotGmN.ez, diff),
  };
  pushPartContribution(row, mOff, tM, rM);

  // Fixed side: ∂o_b is the only origin contribution; ∂n_b doesn't appear.
  const fixedRelO = sub(oB, fixedPart.position);
  const rotGfO = rotationalGradient(fixedRelO);
  const tF: Vec3 = { x: sgn * nA.x, y: sgn * nA.y, z: sgn * nA.z };
  const rF: Vec3 = {
    x: sgn * dot(rotGfO.ex, nA),
    y: sgn * dot(rotGfO.ey, nA),
    z: sgn * dot(rotGfO.ez, nA),
  };
  pushPartContribution(row, fOff, tF, rF);
  return row;
}

/**
 * concentric axis/axis — residual = skew distance between the two axis
 * lines.
 *
 * Let d_a = direction of moved axis, d_b = direction of fixed axis.
 * c = d_a × d_b, |c| = sin(θ).
 *
 *   If |c| < 1e-9 (axes are parallel / anti-parallel): residual is
 *   point-to-line distance from moved origin to the fixed line. We use
 *   the formula  r = |(o_a − o_b) − ((o_a − o_b)·d_b) d_b|  and derive its
 *   gradient analytically (a standard distance-of-point-to-line gradient).
 *
 *   Else: residual = |(o_b − o_a) · c| / |c|. Sign is captured in the
 *   numerator (we use the absolute-value residual to match `computeResidual`).
 *
 * For the closed-form Jacobian we differentiate the abs-value form. The
 * normalized cross-product n = c / |c| satisfies (o_b − o_a) · n = signed
 * skew distance; that is the WELL-DEFINED quantity, and r = |s|.
 *   ∂s/∂o_a = −n
 *   ∂s/∂o_b = +n
 *   ∂s/∂d_a, ∂s/∂d_b: involves derivatives of c/|c| — derived below.
 *
 * For the parallel-axis fallback (|c| small), `closed form` collapses to
 * the standard point-to-line distance derivatives:
 *   w = o_a − o_b
 *   p = w − (w · d_b) d_b  (component of w perpendicular to d_b)
 *   r = |p|
 *   ∂r/∂o_a = p / r
 *   ∂r/∂o_b = −p / r
 *   ∂r/∂d_b = −((w · d_b) p + (p · d_b) w) / r  — both terms reduce since
 *     p · d_b = 0 by construction:
 *        ∂r/∂d_b = −(w · d_b) p / r
 *   ∂r/∂d_a = 0  (moved direction doesn't enter the distance when axes
 *     are parallel — it's the geometry that matters, not its orientation
 *     when both lines are already aligned).
 */
function concentricRow(
  movedPart: PartInstance, fixedPart: PartInstance,
  oA: Vec3, dA: Vec3,
  oB: Vec3, dB: Vec3,
  mOff: number, fOff: number,
): AnalyticJacobianRow {
  const row = EMPTY_ROW();
  // cross(d_a, d_b)
  const c: Vec3 = {
    x: dA.y * dB.z - dA.z * dB.y,
    y: dA.z * dB.x - dA.x * dB.z,
    z: dA.x * dB.y - dA.y * dB.x,
  };
  const cLen = lengthOf(c);

  if (cLen < 1e-9) {
    // ── Parallel branch: point-to-line distance ──────────────────────
    const w = sub(oA, oB);
    const along = dot(w, dB);
    const p: Vec3 = {
      x: w.x - dB.x * along,
      y: w.y - dB.y * along,
      z: w.z - dB.z * along,
    };
    const r = lengthOf(p);
    if (r < 1e-12) return row; // already coincident, zero row
    const pu: Vec3 = { x: p.x / r, y: p.y / r, z: p.z / r };

    // Moved side: ∂r/∂o_a = pu; ∂r/∂d_a = 0 (parallel branch).
    const movedRelO = sub(oA, movedPart.position);
    const rotGmO = rotationalGradient(movedRelO);
    const tM: Vec3 = { x: pu.x, y: pu.y, z: pu.z };
    const rM: Vec3 = {
      x: dot(rotGmO.ex, pu),
      y: dot(rotGmO.ey, pu),
      z: dot(rotGmO.ez, pu),
    };
    pushPartContribution(row, mOff, tM, rM);

    // Fixed side: ∂r/∂o_b = −pu;
    //            ∂r/∂d_b = −along · pu / r ... but we've already
    //   normalised by r once in pu; recompute carefully:
    //   ∂r/∂d_b = − along · pu  (gradient w.r.t. d_b vector — derivation
    //   above had a 1/r that got absorbed by pu = p/r).
    const fixedRelO = sub(oB, fixedPart.position);
    const rotGfO = rotationalGradient(fixedRelO);
    const rotGfD = rotationalGradient(dB);
    const tF: Vec3 = { x: -pu.x, y: -pu.y, z: -pu.z };
    // dr/d(d_b)_i = − along · pu_i. Chain through ∂d_b/∂rot:
    //   (∂d_b/∂rot_i)_j = (e_i × d_b)_j
    //   contribution to row[i] = sum_j (−along · pu_j) · (e_i × d_b)_j
    //                          = −along · (rotGfD.e_i · pu)
    const rF: Vec3 = {
      x: -dot(rotGfO.ex, pu) - along * dot(rotGfD.ex, pu),
      y: -dot(rotGfO.ey, pu) - along * dot(rotGfD.ey, pu),
      z: -dot(rotGfO.ez, pu) - along * dot(rotGfD.ez, pu),
    };
    pushPartContribution(row, fOff, tF, rF);
    return row;
  }

  // ── Skew (general) branch: signed skew distance via normalized cross ─
  const n: Vec3 = { x: c.x / cLen, y: c.y / cLen, z: c.z / cLen };
  const wob = sub(oB, oA);
  const s = dot(wob, n);
  const sgn = signSafe(s);

  // Origin partials (chain rule):
  //   ∂|s|/∂o_a = −sgn · n  (because ∂s/∂o_a = −n)
  //   ∂|s|/∂o_b = +sgn · n
  // Direction partials: ∂s/∂d_a, ∂s/∂d_b — involve ∂n/∂d.
  //   ∂c/∂(d_a)_i = e_i × d_b
  //   ∂c/∂(d_b)_i = d_a × e_i = − e_i × d_a
  //   ∂n/∂c = (I − n n^T) / |c|
  //   ∂s/∂d_a (column i) = wob · ((I − n n^T)(e_i × d_b)) / |c|
  //                      = (wob_perp) · (e_i × d_b) / |c|
  //     where wob_perp = wob − (wob · n) n. Then bring sgn out.
  // Note: this is the standard formula for the gradient of skew distance
  // wrt the two direction vectors — see Schneider/Eberly §11.

  const wobPerp: Vec3 = {
    x: wob.x - s * n.x,
    y: wob.y - s * n.y,
    z: wob.z - s * n.z,
  };

  // For rotation derivatives we need both:
  //   - the origin contribution (e × movedRelO) chained against −sgn·n
  //   - the direction contribution: chain ∂d_a/∂rot = e × d_a
  //     into ∂s/∂d_a, getting ∂s/∂(rot_i)|via_dir.
  // Specifically: ∂s/∂(rot_i)|via_d_a = wobPerp · (e_i × d_b derivative)
  // where e_i × d_b derivative is d/d(rot_i) of d_a = e_i × d_a — wait,
  // we want d/d(rot_i) of n = d/dc · ∂c/∂d_a · (e_i × d_a) — the chain
  // becomes:
  //   ∂s/∂(rot_i)|via_d_a = (wobPerp / |c|) · ( (e_i × d_a) × d_b )
  //
  // That's the cleanest form. Similarly:
  //   ∂s/∂(rot_i)|via_d_b = (wobPerp / |c|) · ( d_a × (e_i × d_b) )

  const invCLen = 1 / cLen;

  // Moved side: dofset for moved part. Origin gradient + direction gradient.
  const movedRelO = sub(oA, movedPart.position);
  const rotGmO = rotationalGradient(movedRelO);
  const tM: Vec3 = { x: -sgn * n.x, y: -sgn * n.y, z: -sgn * n.z };
  // Origin rotation part: ∂(|s|)/∂rot_i (via o_a) = −sgn · n · (e_i × movedRelO)
  // Direction rotation part: (e_i × d_a) × d_b dotted with sgn·wobPerp/|c|
  const ex_dA: Vec3 = { x: 0, y: -dA.z, z: dA.y };
  const ey_dA: Vec3 = { x: dA.z, y: 0, z: -dA.x };
  const ez_dA: Vec3 = { x: -dA.y, y: dA.x, z: 0 };
  const dirRotMx = crossScalar(ex_dA, dB);
  const dirRotMy = crossScalar(ey_dA, dB);
  const dirRotMz = crossScalar(ez_dA, dB);
  const rM: Vec3 = {
    x: -sgn * dot(rotGmO.ex, n) + sgn * invCLen * dot(wobPerp, dirRotMx),
    y: -sgn * dot(rotGmO.ey, n) + sgn * invCLen * dot(wobPerp, dirRotMy),
    z: -sgn * dot(rotGmO.ez, n) + sgn * invCLen * dot(wobPerp, dirRotMz),
  };
  pushPartContribution(row, mOff, tM, rM);

  // Fixed side: dofset for fixed part.
  const fixedRelO = sub(oB, fixedPart.position);
  const rotGfO = rotationalGradient(fixedRelO);
  const ex_dB: Vec3 = { x: 0, y: -dB.z, z: dB.y };
  const ey_dB: Vec3 = { x: dB.z, y: 0, z: -dB.x };
  const ez_dB: Vec3 = { x: -dB.y, y: dB.x, z: 0 };
  const dirRotFx = crossScalar(dA, ex_dB);
  const dirRotFy = crossScalar(dA, ey_dB);
  const dirRotFz = crossScalar(dA, ez_dB);
  const tF: Vec3 = { x: sgn * n.x, y: sgn * n.y, z: sgn * n.z };
  const rF: Vec3 = {
    x: sgn * dot(rotGfO.ex, n) + sgn * invCLen * dot(wobPerp, dirRotFx),
    y: sgn * dot(rotGfO.ey, n) + sgn * invCLen * dot(wobPerp, dirRotFy),
    z: sgn * dot(rotGfO.ez, n) + sgn * invCLen * dot(wobPerp, dirRotFz),
  };
  pushPartContribution(row, fOff, tF, rF);

  return row;
}

function crossScalar(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

/**
 * parallel — residual = |cross(a, b)| (i.e., sin θ).
 *
 * Let c = a × b, r = |c|. Direction-only constraint (no translation in
 * the residual): all translational columns = 0.
 *
 *   ∂c/∂a_i = e_i × b
 *   ∂c/∂b_i = a × e_i = −(e_i × a)
 *   ∂r/∂c   = c / |c| = c_hat
 *   ∂r/∂a_i = c_hat · (e_i × b)
 *           = (b × c_hat) · e_i      (triple-product identity)
 *   ∂r/∂b_i = c_hat · (−e_i × a) = (a × c_hat) · e_i · (−1)
 *           wait — let's redo: c_hat · (−e_i × a) = −(a × c_hat) · e_i ·(−1)
 *           = (c_hat × a) · e_i ... clearer to leave dot expression.
 *
 * Then chain ∂a/∂rot_moved = e_i × a and ∂b/∂rot_fixed = e_i × b.
 */
function parallelRow(
  a: Vec3, b: Vec3,
  mOff: number, fOff: number,
): AnalyticJacobianRow {
  const row = EMPTY_ROW();
  const c = crossScalar(a, b);
  const r = lengthOf(c);
  if (r < 1e-12) return row; // already parallel — zero gradient (kink)

  const cHat: Vec3 = { x: c.x / r, y: c.y / r, z: c.z / r };

  // Moved direction's derivative w.r.t. rot_i is (e_i × a). Chain:
  //   ∂r/∂rot_i (moved) = c_hat · (∂c/∂a) · (e_i × a)
  // Use ∂c/∂a as the matrix B such that B_ij = (cross product) — but it's
  // simpler to compose directly:
  //   The first-order rotation of a around e_i is a' = a + (e_i × a).
  //   Then c' = a' × b = (a × b) + ((e_i × a) × b)
  //   So Δc = (e_i × a) × b
  //   Δr ≈ c_hat · Δc = c_hat · ((e_i × a) × b)
  const ex_a: Vec3 = { x: 0, y: -a.z, z: a.y };
  const ey_a: Vec3 = { x: a.z, y: 0, z: -a.x };
  const ez_a: Vec3 = { x: -a.y, y: a.x, z: 0 };
  const rMx = crossScalar(ex_a, b);
  const rMy = crossScalar(ey_a, b);
  const rMz = crossScalar(ez_a, b);
  const rM: Vec3 = {
    x: dot(cHat, rMx),
    y: dot(cHat, rMy),
    z: dot(cHat, rMz),
  };
  pushPartContribution(row, mOff, { x: 0, y: 0, z: 0 }, rM);

  // Fixed direction's derivative: c' = a × (b + e_i × b) ⇒ Δc = a × (e_i × b).
  const ex_b: Vec3 = { x: 0, y: -b.z, z: b.y };
  const ey_b: Vec3 = { x: b.z, y: 0, z: -b.x };
  const ez_b: Vec3 = { x: -b.y, y: b.x, z: 0 };
  const rFx = crossScalar(a, ex_b);
  const rFy = crossScalar(a, ey_b);
  const rFz = crossScalar(a, ez_b);
  const rF: Vec3 = {
    x: dot(cHat, rFx),
    y: dot(cHat, rFy),
    z: dot(cHat, rFz),
  };
  pushPartContribution(row, fOff, { x: 0, y: 0, z: 0 }, rF);
  return row;
}

/**
 * perpendicular — residual = |a · b| (i.e., |cos θ|). Direction-only.
 *
 *   s = a · b, r = |s|.
 *   ∂s/∂a_i = b_i, ∂s/∂b_i = a_i
 *   ∂a/∂rot_i = e_i × a   ⇒  ∂s/∂rot_i (moved) = b · (e_i × a) = (a × b) · e_i
 *   ∂s/∂rot_i (fixed) = a · (e_i × b) = (b × a) · e_i = −(a × b) · e_i
 *   ∂r/∂rot_i = sgn(s) · ∂s/∂rot_i.
 *
 * Translation contributions: 0 (direction-only).
 */
function perpendicularRow(
  a: Vec3, b: Vec3,
  mOff: number, fOff: number,
): AnalyticJacobianRow {
  const row = EMPTY_ROW();
  const s = dot(a, b);
  const sgn = signSafe(s);
  const aXb = crossScalar(a, b);
  const rM: Vec3 = { x: sgn * aXb.x, y: sgn * aXb.y, z: sgn * aXb.z };
  // (b × a) · e_i = −aXb_i
  const rF: Vec3 = { x: -sgn * aXb.x, y: -sgn * aXb.y, z: -sgn * aXb.z };
  pushPartContribution(row, mOff, { x: 0, y: 0, z: 0 }, rM);
  pushPartContribution(row, fOff, { x: 0, y: 0, z: 0 }, rF);
  return row;
}

/**
 * distance point/point — residual = | |p_m − p_f| − target |.
 *
 *   Let d = p_m − p_f, ρ = |d|, s = ρ − target, r = |s|.
 *   ∂ρ/∂p_m = d/ρ = u, ∂ρ/∂p_f = −u.
 *   ∂r/∂p_m = sgn(s) · u, ∂r/∂p_f = −sgn(s) · u.
 *
 * Then chain through ∂p/∂q as in coincidentPointRow.
 */
function distancePointRow(
  movedPart: PartInstance, fixedPart: PartInstance,
  pMoved: Vec3, pFixed: Vec3,
  target: number,
  mOff: number, fOff: number,
): AnalyticJacobianRow {
  const row = EMPTY_ROW();
  const d = sub(pMoved, pFixed);
  const rho = lengthOf(d);
  if (rho < 1e-12) return row;
  const u: Vec3 = { x: d.x / rho, y: d.y / rho, z: d.z / rho };
  const s = rho - target;
  const sgn = signSafe(s);

  const movedRel = sub(pMoved, movedPart.position);
  const movedRotG = rotationalGradient(movedRel);
  const tM: Vec3 = { x: sgn * u.x, y: sgn * u.y, z: sgn * u.z };
  const rM: Vec3 = {
    x: sgn * dot(movedRotG.ex, u),
    y: sgn * dot(movedRotG.ey, u),
    z: sgn * dot(movedRotG.ez, u),
  };
  pushPartContribution(row, mOff, tM, rM);

  const fixedRel = sub(pFixed, fixedPart.position);
  const fixedRotG = rotationalGradient(fixedRel);
  const tF: Vec3 = { x: -sgn * u.x, y: -sgn * u.y, z: -sgn * u.z };
  const rF: Vec3 = {
    x: -sgn * dot(fixedRotG.ex, u),
    y: -sgn * dot(fixedRotG.ey, u),
    z: -sgn * dot(fixedRotG.ez, u),
  };
  pushPartContribution(row, fOff, tF, rF);
  return row;
}

/**
 * distance plane/plane — residual = | |signed plane gap| − target |.
 *
 *   signed = (o_b − o_a) · n_a  (matches lagrangianSolver convention)
 *   abs    = |signed|
 *   s      = abs − target
 *   r      = |s|
 *   d(r) = sgn(s) · sgn(signed) · d(signed)  (chain through both abs ops)
 *
 * d(signed) gradients are identical to coincidentPlaneRow (just without
 * the outer sgn(signed) — that absorbs into our outer sgn product).
 */
function distancePlaneRow(
  movedPart: PartInstance, fixedPart: PartInstance,
  oA: Vec3, nA: Vec3,
  oB: Vec3, _nB: Vec3,
  target: number,
  mOff: number, fOff: number,
): AnalyticJacobianRow {
  void _nB;
  const row = EMPTY_ROW();
  const diff = sub(oB, oA);
  const signed = dot(diff, nA);
  const abs = Math.abs(signed);
  const s = abs - target;
  const sgnOuter = signSafe(s);
  const sgnInner = signSafe(signed);
  const k = sgnOuter * sgnInner;

  // d(signed)/∂o_a = −n_a    ⇒ d(r)/∂o_a = −k · n_a
  // d(signed)/∂n_a = diff    ⇒ d(r)/∂n_a = k · diff
  // d(signed)/∂o_b = n_a     ⇒ d(r)/∂o_b = k · n_a
  const movedRelO = sub(oA, movedPart.position);
  const rotGmO = rotationalGradient(movedRelO);
  const rotGmN = rotationalGradient(nA);
  const tM: Vec3 = { x: -k * nA.x, y: -k * nA.y, z: -k * nA.z };
  const rM: Vec3 = {
    x: -k * dot(rotGmO.ex, nA) + k * dot(rotGmN.ex, diff),
    y: -k * dot(rotGmO.ey, nA) + k * dot(rotGmN.ey, diff),
    z: -k * dot(rotGmO.ez, nA) + k * dot(rotGmN.ez, diff),
  };
  pushPartContribution(row, mOff, tM, rM);

  const fixedRelO = sub(oB, fixedPart.position);
  const rotGfO = rotationalGradient(fixedRelO);
  const tF: Vec3 = { x: k * nA.x, y: k * nA.y, z: k * nA.z };
  const rF: Vec3 = {
    x: k * dot(rotGfO.ex, nA),
    y: k * dot(rotGfO.ey, nA),
    z: k * dot(rotGfO.ez, nA),
  };
  pushPartContribution(row, fOff, tF, rF);
  return row;
}

/**
 * angle — residual = |acos(clamp(a · b, −1, 1)) − target_rad|.
 *
 *   Let c = a · b (clamped), θ = acos(c), s = θ − target_rad, r = |s|.
 *   ∂θ/∂c = −1 / sqrt(1 − c²)
 *   ∂c/∂a_i = b_i, ∂c/∂b_i = a_i
 *   ∂θ/∂rot_i (moved) = ∂θ/∂c · b · (e_i × a) = (−1/√(1−c²)) · (a × b)·e_i
 *   ∂θ/∂rot_i (fixed) = ∂θ/∂c · a · (e_i × b) = (−1/√(1−c²)) · −(a × b)·e_i
 *   ∂r/∂rot_i = sgn(s) · ∂θ/∂rot_i.
 *
 * At c = ±1 (sin = 0) the derivative is unbounded; return a zero row so
 * LM's λ-damping carries the step. Numeric forward-diff also goes to zero
 * there (the residual is symmetric around θ = 0 / π).
 */
function angleRow(
  a: Vec3, b: Vec3,
  targetDeg: number,
  mOff: number, fOff: number,
): AnalyticJacobianRow {
  const row = EMPTY_ROW();
  const c = Math.max(-1, Math.min(1, dot(a, b)));
  const sin2 = 1 - c * c;
  if (sin2 < 1e-18) return row;
  const sinInv = 1 / Math.sqrt(sin2);
  const theta = Math.acos(c);
  const target = (targetDeg * Math.PI) / 180;
  const s = theta - target;
  const sgn = signSafe(s);
  // dθ/dc = −sinInv. dr/dc = sgn · (−sinInv).
  const coef = -sgn * sinInv;
  const aXb = crossScalar(a, b);
  // dr/d(rot_moved)_i = coef · (a × b)·e_i  (from b · (e_i × a))
  const rM: Vec3 = { x: coef * aXb.x, y: coef * aXb.y, z: coef * aXb.z };
  const rF: Vec3 = { x: -coef * aXb.x, y: -coef * aXb.y, z: -coef * aXb.z };
  pushPartContribution(row, mOff, { x: 0, y: 0, z: 0 }, rM);
  pushPartContribution(row, fOff, { x: 0, y: 0, z: 0 }, rF);
  return row;
}

// ─── Phase 3.2.2 advanced-mate row builders ─────────────────────────────-

/**
 * Sum two sparse rows column-wise. Cols may overlap (slot + rack_pinion
 * combine a concentric/distance row with a perpendicular row that touches
 * the SAME 6N×2 rotation columns), so we merge into a Map keyed by col
 * and emit one entry per unique col with the summed value.
 *
 * Zero entries that survive after summing are kept (matching the
 * convention of the other row builders: rows expose all DoF blocks they
 * touched even if one component happens to be zero).
 */
function sumRows(a: AnalyticJacobianRow, b: AnalyticJacobianRow): AnalyticJacobianRow {
  const acc = new Map<number, number>();
  for (let i = 0; i < a.cols.length; i++) {
    const c = a.cols[i]!;
    acc.set(c, (acc.get(c) ?? 0) + a.values[i]!);
  }
  for (let i = 0; i < b.cols.length; i++) {
    const c = b.cols[i]!;
    acc.set(c, (acc.get(c) ?? 0) + b.values[i]!);
  }
  // Preserve column ordering (smaller first) so test inspection is stable
  // and matches the order produced by pushPartContribution.
  const cols = [...acc.keys()].sort((x, y) => x - y);
  const values = cols.map((c) => acc.get(c)!);
  return { cols, values };
}

/**
 * Decide whether a hinge mate carries an active limit penalty at the
 * given orientations. Mirrors the Phase 1 unsigned-proxy branch used in
 * `lagrangianSolver.computeResidualForMate`:
 *   approxAngleRad = 2·acos(|dot(q_a, q_b)|)
 *   approxAngleDeg = approxAngleRad · 180/π
 *   active = approxAngleDeg > max  OR  −approxAngleDeg < min
 *
 * Returns false when the mate has no limit at all (the residual is then
 * purely concentric and the analytic row is exact).
 */
function hingeLimitActive(mate: HingeMate, a: PartInstance, b: PartInstance): boolean {
  if (mate.limit === undefined) return false;
  const qa = a.orientation;
  const qb = b.orientation;
  const dotQ = qa.x * qb.x + qa.y * qb.y + qa.z * qb.z + qa.w * qb.w;
  const cosHalf = Math.min(1, Math.abs(dotQ));
  const approxAngleRad = 2 * Math.acos(cosHalf);
  const approxAngleDeg = (approxAngleRad * 180) / Math.PI;
  const minDeg = mate.limit.minAngleDeg;
  const maxDeg = mate.limit.maxAngleDeg;
  if (approxAngleDeg > maxDeg) return true;
  if (-approxAngleDeg < minDeg) return true;
  return false;
}

/**
 * gear coplanarity row — residual = skew distance between the two shaft
 * axes when the cross-product `|d_a × d_b|` ≥ 1e-9; 0 (parallel branch)
 * otherwise.
 *
 * In the skew branch the formula matches the skew-axis branch of the
 * concentric residual exactly, so the gradient is the same. In the
 * parallel branch the residual is constant 0 — we emit an empty row.
 *
 * (Concentric in the parallel branch would emit a point-to-line distance
 * gradient — that is WRONG for gear, which says parallel shafts are
 * always coplanar regardless of offset. Don't reuse concentricRow.)
 */
function gearCoplanarityRow(
  movedPart: PartInstance, fixedPart: PartInstance,
  oA: Vec3, dA: Vec3,
  oB: Vec3, dB: Vec3,
  mOff: number, fOff: number,
): AnalyticJacobianRow {
  const row = EMPTY_ROW();
  const c: Vec3 = {
    x: dA.y * dB.z - dA.z * dB.y,
    y: dA.z * dB.x - dA.x * dB.z,
    z: dA.x * dB.y - dA.y * dB.x,
  };
  const cLen = lengthOf(c);
  if (cLen < 1e-9) {
    // Parallel/anti-parallel: residual is identically 0. Zero gradient.
    return row;
  }

  // Skew branch: identical derivation to concentricRow's skew branch.
  const n: Vec3 = { x: c.x / cLen, y: c.y / cLen, z: c.z / cLen };
  const wob = sub(oB, oA);
  const s = dot(wob, n);
  const sgn = signSafe(s);

  const wobPerp: Vec3 = {
    x: wob.x - s * n.x,
    y: wob.y - s * n.y,
    z: wob.z - s * n.z,
  };
  const invCLen = 1 / cLen;

  const movedRelO = sub(oA, movedPart.position);
  const rotGmO = rotationalGradient(movedRelO);
  const tM: Vec3 = { x: -sgn * n.x, y: -sgn * n.y, z: -sgn * n.z };
  const ex_dA: Vec3 = { x: 0, y: -dA.z, z: dA.y };
  const ey_dA: Vec3 = { x: dA.z, y: 0, z: -dA.x };
  const ez_dA: Vec3 = { x: -dA.y, y: dA.x, z: 0 };
  const dirRotMx = crossScalar(ex_dA, dB);
  const dirRotMy = crossScalar(ey_dA, dB);
  const dirRotMz = crossScalar(ez_dA, dB);
  const rM: Vec3 = {
    x: -sgn * dot(rotGmO.ex, n) + sgn * invCLen * dot(wobPerp, dirRotMx),
    y: -sgn * dot(rotGmO.ey, n) + sgn * invCLen * dot(wobPerp, dirRotMy),
    z: -sgn * dot(rotGmO.ez, n) + sgn * invCLen * dot(wobPerp, dirRotMz),
  };
  pushPartContribution(row, mOff, tM, rM);

  const fixedRelO = sub(oB, fixedPart.position);
  const rotGfO = rotationalGradient(fixedRelO);
  const ex_dB: Vec3 = { x: 0, y: -dB.z, z: dB.y };
  const ey_dB: Vec3 = { x: dB.z, y: 0, z: -dB.x };
  const ez_dB: Vec3 = { x: -dB.y, y: dB.x, z: 0 };
  const dirRotFx = crossScalar(dA, ex_dB);
  const dirRotFy = crossScalar(dA, ey_dB);
  const dirRotFz = crossScalar(dA, ez_dB);
  const tF: Vec3 = { x: sgn * n.x, y: sgn * n.y, z: sgn * n.z };
  const rF: Vec3 = {
    x: sgn * dot(rotGfO.ex, n) + sgn * invCLen * dot(wobPerp, dirRotFx),
    y: sgn * dot(rotGfO.ey, n) + sgn * invCLen * dot(wobPerp, dirRotFy),
    z: sgn * dot(rotGfO.ez, n) + sgn * invCLen * dot(wobPerp, dirRotFz),
  };
  pushPartContribution(row, fOff, tF, rF);
  return row;
}

/**
 * axis-distance-to-target row — residual = |distanceAxisToAxis − target|.
 *
 * Used by rack_pinion (target = pinionRadius). Chain rule of the absolute
 * value outer wrapper:
 *   d = distanceAxisToAxis(a, b)   (already unsigned)
 *   s = d − target
 *   r = |s| = |d − target|
 *   dr/dq = sgn(s) · dd/dq
 *
 * The unsigned skew distance `d` is the same residual as the concentric
 * mate, so dd/dq is the concentricRow's gradient (NOT the |d − target|
 * version — we scale by sgn(s) instead of sgn(d), the latter is always
 * positive). We compute the row via concentricRow and then scale every
 * value by sgn(s).
 *
 * Parallel branch: concentricRow falls back to point-to-line distance,
 * which is also unsigned and ≥ 0 — same scaling treatment applies.
 */
function axisDistanceTargetRow(
  movedPart: PartInstance, fixedPart: PartInstance,
  oA: Vec3, dA: Vec3,
  oB: Vec3, dB: Vec3,
  target: number,
  mOff: number, fOff: number,
): AnalyticJacobianRow {
  const concentric = concentricRow(movedPart, fixedPart, oA, dA, oB, dB, mOff, fOff);
  // Recompute `d` so we can derive sgn(s = d − target).
  const c: Vec3 = {
    x: dA.y * dB.z - dA.z * dB.y,
    y: dA.z * dB.x - dA.x * dB.z,
    z: dA.x * dB.y - dA.y * dB.x,
  };
  const cLen = lengthOf(c);
  let d: number;
  if (cLen < 1e-9) {
    // Parallel: point-to-line distance from oA to the (oB, dB) line.
    const w = sub(oA, oB);
    const along = dot(w, dB);
    const p: Vec3 = {
      x: w.x - dB.x * along,
      y: w.y - dB.y * along,
      z: w.z - dB.z * along,
    };
    d = lengthOf(p);
  } else {
    const n: Vec3 = { x: c.x / cLen, y: c.y / cLen, z: c.z / cLen };
    d = Math.abs(dot(sub(oB, oA), n));
  }
  const sgn = signSafe(d - target);
  if (sgn === 1) return concentric;
  // sgn(s) = −1 → flip every value in the row.
  return {
    cols: concentric.cols,
    values: concentric.values.map((v) => -v),
  };
}
