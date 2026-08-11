/**
 * kinematics — W5-F 2차 (mate 실구현 심화) of NexyFab Pro own-CAD (ADR-013).
 *
 * DRIVE semantics for transmission mates. The static solvers (iterative /
 * lagrangian) place parts so mate residuals vanish, but they deliberately
 * treat gear / rack_pinion as placement no-ops: those mates couple MOTION
 * (spin ↔ spin, spin ↔ slide), not static pose. Before this module the
 * coupling parameters (GearMate.ratio, RackPinionMate.pinionRadius as a
 * transmission constant) were validated but never consumed anywhere —
 * measured: solving a hinged gear pair with ratio 2, ratio 5, and
 * reverse=true produced byte-identical placements.
 *
 * This module makes the coupling REAL: `applyDrives` takes a solved
 * assembly, a driven mate, and a drive angle, and propagates the motion
 * through the transmission graph:
 *
 *   - gear (ratio = rot_a / rot_b): driving side `a` by θ rotates side `b`
 *     by  s·θ/ratio ; driving side `b` by θ rotates side `a` by s·θ·ratio.
 *     s = −1 by default (external mesh — opposite senses), s = +1 when
 *     `reverse` is true (internal mesh — same sense). Angles are measured
 *     right-hand about each side's OWN resolved world axis direction.
 *   - rack_pinion: pinion (side `a`) rotation θ_rad ↔ rack (side `b`)
 *     translation  s = pinionRadius · θ_rad  along the rack edge's world
 *     direction. SIGN CONVENTION (approximation, documented): positive θ
 *     (right-hand rule about the resolved pinion axis) translates the rack
 *     toward +rackDirection. The physical sign depends on which side of
 *     the rack the pinion meshes — contact geometry is not modeled.
 *   - hinge: ABSOLUTE angle drive. Requires the mate's Phase 2
 *     `zeroAngleRef`; the target swing is reached by rotating the free
 *     side about the shared axis. Respects `limit` (out-of-range targets
 *     are refused with the numbers).
 *
 * Propagation: BFS over all non-suppressed gear / rack_pinion mates from
 * the driven part. Chains (gear trains, gear→rack) work; inconsistent
 * loops, kind conflicts, and drives that would move a fixed part are
 * REFUSED with an explicit KinematicsError — never silently ignored.
 *
 * gear/rack drives are INCREMENTAL (relative to the current
 * configuration); hinge drives are ABSOLUTE (measured against
 * zeroAngleRef). Both are documented on DriveSpec.
 *
 * Preconditions: statics should be solved first (hinge drive verifies the
 * axes are actually aligned and refuses otherwise). `solveMates` wires
 * this automatically via its `drives` option.
 */

import type { AssemblyState, PartInstance, Quat } from './assemblyState';
import type { Mate } from './mate';
import type { GeometryResolver } from './iterativeSolver';
import {
  distanceAxisToAxis,
  quatMul,
  quatNormalize,
  rotateVec,
} from './mateSolver';
import { type Vec3, add, sub, dot, scale } from '@/lib/sketch/sketchPlane';

// ─── public types ────────────────────────────────────────────────────────

export class KinematicsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KinematicsError';
  }
}

export interface DriveSpec {
  /** Mate to drive. Must be kind 'gear' | 'rack_pinion' | 'hinge'. */
  mateId: string;
  /**
   * Drive angle in DEGREES.
   *   - gear / rack_pinion: INCREMENTAL rotation of the driven side from
   *     the current configuration (right-hand about its resolved axis).
   *   - hinge: ABSOLUTE target swing angle (requires mate.zeroAngleRef).
   */
  angleDeg: number;
  /**
   * Which side of the mate is driven.
   *   - gear: 'a' (default) or 'b'.
   *   - rack_pinion: only 'a' (the pinion) is drivable — driving the rack
   *     by an ANGLE is ill-typed; refused.
   *   - hinge: ignored (the free side is rotated).
   */
  side?: 'a' | 'b';
}

export interface DriveEffect {
  partId: string;
  kind: 'rotation' | 'translation';
  /** rotation: signed DEGREES about `axis`; translation: signed mm along
   *  `direction`. */
  amount: number;
  /** World axis used for a rotation effect. */
  axis?: { origin: Vec3; direction: Vec3 };
  /** World direction used for a translation effect (unit). */
  direction?: Vec3;
  /** Mate through which this effect was derived ('' never occurs; the
   *  seed carries the driven mate's id). */
  viaMateId: string;
}

export interface DriveResult {
  state: AssemblyState;
  /** One entry per moved part, in application order (seed first). */
  effects: ReadonlyArray<DriveEffect>;
}

// ─── internals ───────────────────────────────────────────────────────────

/** Hinge-axis alignment tolerance before a hinge drive is allowed (mm). */
const HINGE_ALIGN_TOL = 1e-3;
/** Consistency tolerance for propagation loops (rad / mm). */
const LOOP_TOL = 1e-9;

type Assignment =
  | {
      kind: 'rotation';
      angleRad: number;
      axis: { origin: Vec3; direction: Vec3 };
      viaMateId: string;
    }
  | { kind: 'translation'; dist: number; direction: Vec3; viaMateId: string };

function quatAxisAngle(axis: Vec3, angle: number): Quat {
  const h = angle / 2;
  const s = Math.sin(h);
  return { x: axis.x * s, y: axis.y * s, z: axis.z * s, w: Math.cos(h) };
}

function normalizeOrThrow(v: Vec3, context: string): Vec3 {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  if (len < 1e-12) {
    throw new KinematicsError(`${context}: degenerate (zero-length) axis direction`);
  }
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function crossVec(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

/** Project v onto the plane perpendicular to unit axis u. */
function projectPerp(v: Vec3, u: Vec3): Vec3 {
  const along = dot(v, u);
  return sub(v, scale(u, along));
}

/** Resolve a mate side to a world axis or refuse with the reason. */
function resolveAxis(
  resolve: GeometryResolver,
  mate: Mate,
  sideKey: 'a' | 'b',
  part: PartInstance,
): { origin: Vec3; direction: Vec3 } {
  const ref = sideKey === 'a' ? mate.a : mate.b;
  const g = resolve(ref, part);
  if (!g || g.kind !== 'axis') {
    throw new KinematicsError(
      `drive '${mate.id}': ref '${ref.partId}.${ref.refId}' did not resolve to an axis ` +
        `(got ${g ? g.kind : 'null'}) — transmission drives need axis geometry`,
    );
  }
  return {
    origin: g.world.origin,
    direction: normalizeOrThrow(g.world.direction, `drive '${mate.id}' side ${sideKey}`),
  };
}

/** Rotate a part rigidly about a world axis LINE (orientation + position). */
function rotatePartAboutAxis(
  part: PartInstance,
  axisOrigin: Vec3,
  axisDirection: Vec3,
  angleRad: number,
): PartInstance {
  const dq = quatAxisAngle(axisDirection, angleRad);
  const newOri = quatNormalize(quatMul(dq, part.orientation));
  const rel = sub(part.position, axisOrigin);
  const newPos = add(axisOrigin, rotateVec(rel, dq));
  return { ...part, position: newPos, orientation: newOri };
}

/**
 * Signed swing angle of a hinge with a Phase 2 zeroAngleRef, measured the
 * same way as the residual: atan2((A × B)·axis, A·B) with A, B projected
 * onto the plane perpendicular to the (side-a resolved) world axis.
 */
export function measureHingeSwingRad(
  mate: Extract<Mate, { kind: 'hinge' }>,
  partA: PartInstance,
  partB: PartInstance,
  axisDirection: Vec3,
): number {
  const ref = mate.zeroAngleRef;
  if (!ref) {
    throw new KinematicsError(
      `hinge '${mate.id}': swing measurement requires zeroAngleRef (Phase 2 signed swing)`,
    );
  }
  const aWorld = rotateVec(ref.a, partA.orientation);
  const bWorld = rotateVec(ref.b, partB.orientation);
  const aPerp = projectPerp(aWorld, axisDirection);
  const bPerp = projectPerp(bWorld, axisDirection);
  const cosSwing = dot(aPerp, bPerp);
  const sinSwing = dot(crossVec(aPerp, bPerp), axisDirection);
  return Math.atan2(sinSwing, cosSwing);
}

// ─── propagation ─────────────────────────────────────────────────────────

function propagateFromSeed(
  state: AssemblyState,
  resolve: GeometryResolver,
  partById: Map<string, PartInstance>,
  seedPartId: string,
  seedAssignment: Assignment,
): Map<string, Assignment> {
  const assignments = new Map<string, Assignment>();
  assignments.set(seedPartId, seedAssignment);
  const queue: string[] = [seedPartId];

  const transmissionMates = state.mates.filter(
    (m): m is Extract<Mate, { kind: 'gear' | 'rack_pinion' }> =>
      !m.suppressed && (m.kind === 'gear' || m.kind === 'rack_pinion'),
  );

  while (queue.length > 0) {
    const pid = queue.shift()!;
    const current = assignments.get(pid)!;

    for (const m of transmissionMates) {
      let fromSide: 'a' | 'b';
      if (m.a.partId === pid) fromSide = 'a';
      else if (m.b.partId === pid) fromSide = 'b';
      else continue;
      const toSide: 'a' | 'b' = fromSide === 'a' ? 'b' : 'a';
      const toRef = toSide === 'a' ? m.a : m.b;
      const toPart = partById.get(toRef.partId);
      if (!toPart) {
        throw new KinematicsError(
          `drive propagation: mate '${m.id}' references unknown part '${toRef.partId}'`,
        );
      }

      let next: Assignment;
      if (m.kind === 'gear') {
        if (current.kind !== 'rotation') {
          throw new KinematicsError(
            `drive propagation: gear mate '${m.id}' needs a ROTATION on part '${pid}' ` +
              `but the chain assigned a translation — mixed transmission chain refused`,
          );
        }
        const s = m.reverse ? 1 : -1;
        const angleRad =
          fromSide === 'a'
            ? (s * current.angleRad) / m.ratio // rot_b = s·rot_a / ratio
            : s * current.angleRad * m.ratio; // rot_a = s·rot_b · ratio
        const axis = resolveAxis(resolve, m, toSide, toPart);
        next = { kind: 'rotation', angleRad, axis, viaMateId: m.id };
      } else {
        // rack_pinion: a = pinion (rotation), b = rack (translation).
        if (fromSide === 'a') {
          if (current.kind !== 'rotation') {
            throw new KinematicsError(
              `drive propagation: rack_pinion '${m.id}' pinion side needs a rotation on ` +
                `part '${pid}' but the chain assigned a translation`,
            );
          }
          const rackAxis = resolveAxis(resolve, m, 'b', toPart);
          next = {
            kind: 'translation',
            dist: current.angleRad * m.pinionRadius,
            direction: rackAxis.direction,
            viaMateId: m.id,
          };
        } else {
          if (current.kind !== 'translation') {
            throw new KinematicsError(
              `drive propagation: rack_pinion '${m.id}' rack side needs a translation on ` +
                `part '${pid}' but the chain assigned a rotation`,
            );
          }
          const pinionAxis = resolveAxis(resolve, m, 'a', toPart);
          next = {
            kind: 'rotation',
            angleRad: current.dist / m.pinionRadius,
            axis: pinionAxis,
            viaMateId: m.id,
          };
        }
      }

      const existing = assignments.get(toRef.partId);
      if (existing) {
        // Loop closure: assignments must agree or the chain is
        // kinematically inconsistent.
        if (existing.kind !== next.kind) {
          throw new KinematicsError(
            `drive propagation: part '${toRef.partId}' receives a ${next.kind} via mate ` +
              `'${m.id}' but already has a ${existing.kind} via mate '${existing.viaMateId}' — inconsistent loop`,
          );
        }
        const delta =
          existing.kind === 'rotation'
            ? Math.abs(existing.angleRad - (next as Extract<Assignment, { kind: 'rotation' }>).angleRad)
            : Math.abs(existing.dist - (next as Extract<Assignment, { kind: 'translation' }>).dist);
        if (delta > LOOP_TOL) {
          throw new KinematicsError(
            `drive propagation: inconsistent loop at part '${toRef.partId}' — mate '${m.id}' ` +
              `implies ${fmtAssign(next)} but mate '${existing.viaMateId}' already implies ` +
              `${fmtAssign(existing)} (|Δ| = ${delta.toExponential(3)})`,
          );
        }
        continue; // consistent — no re-propagation needed
      }

      // Refuse to move fixed parts (a zero-magnitude assignment is fine).
      const magnitude = next.kind === 'rotation' ? Math.abs(next.angleRad) : Math.abs(next.dist);
      if (toPart.fixed && magnitude > LOOP_TOL) {
        throw new KinematicsError(
          `drive propagation: chain would move FIXED part '${toRef.partId}' by ` +
            `${fmtAssign(next)} via mate '${m.id}' — unfix it or drive elsewhere`,
        );
      }

      assignments.set(toRef.partId, next);
      queue.push(toRef.partId);
    }
  }

  return assignments;
}

function fmtAssign(a: Assignment): string {
  return a.kind === 'rotation'
    ? `rotation ${((a.angleRad * 180) / Math.PI).toFixed(6)}°`
    : `translation ${a.dist.toFixed(6)} mm`;
}

// ─── single-drive application ────────────────────────────────────────────

/**
 * Return one side of a mechanism after removing the hinge being driven.
 * Other hinges stay connected because a single-axis sweep holds every other
 * joint at its current angle. Gear and rack-pinion mates are motion couplings,
 * not rigid carriers, and remain handled by transmission propagation.
 */
function connectedComponentWithoutMate(
  state: AssemblyState,
  startPartId: string,
  excludedMateId: string,
): Set<string> {
  const component = new Set<string>([startPartId]);
  const queue = [startPartId];
  const edges = state.mates.filter(mate => !mate.suppressed && mate.id !== excludedMateId
    && mate.kind !== 'gear' && mate.kind !== 'rack_pinion');
  while (queue.length) {
    const current = queue.shift()!;
    for (const edge of edges) {
      const next = edge.a.partId === current ? edge.b.partId : edge.b.partId === current ? edge.a.partId : null;
      if (next && !component.has(next)) {
        component.add(next);
        queue.push(next);
      }
    }
  }
  return component;
}

function applyOneDrive(
  state: AssemblyState,
  resolve: GeometryResolver,
  drive: DriveSpec,
): { state: AssemblyState; effects: DriveEffect[] } {
  const mate = state.mates.find((m) => m.id === drive.mateId);
  if (!mate) {
    const known = state.mates.map((m) => m.id).join(', ');
    throw new KinematicsError(
      `drive: mate '${drive.mateId}' not found (known mates: ${known})`,
    );
  }
  if (mate.suppressed) {
    throw new KinematicsError(`drive: mate '${drive.mateId}' is suppressed — unsuppress to drive`);
  }
  if (!Number.isFinite(drive.angleDeg)) {
    throw new KinematicsError(`drive '${drive.mateId}': angleDeg must be finite`);
  }
  if (mate.kind !== 'gear' && mate.kind !== 'rack_pinion' && mate.kind !== 'hinge') {
    throw new KinematicsError(
      `drive: mate '${drive.mateId}' has kind '${mate.kind}' — drivable kinds are ` +
        `'gear', 'rack_pinion', 'hinge'`,
    );
  }

  const parts = state.parts.map((p) => ({ ...p }));
  const partById = new Map(parts.map((p) => [p.id, p]));
  const partA = partById.get(mate.a.partId);
  const partB = partById.get(mate.b.partId);
  if (!partA || !partB) {
    throw new KinematicsError(
      `drive '${drive.mateId}': mate references unknown part ` +
        `'${!partA ? mate.a.partId : mate.b.partId}'`,
    );
  }

  let seedPartId: string;
  let seedAssignment: Assignment;
  let hingeRigidPartIds: Set<string> | null = null;

  if (mate.kind === 'hinge') {
    // ── hinge: ABSOLUTE swing target ─────────────────────────────────────
    if (mate.zeroAngleRef === undefined) {
      throw new KinematicsError(
        `drive '${mate.id}': hinge angle drive requires zeroAngleRef (Phase 2 signed ` +
          `swing reference) — declare it on the mate`,
      );
    }
    if (mate.limit !== undefined) {
      if (drive.angleDeg < mate.limit.minAngleDeg || drive.angleDeg > mate.limit.maxAngleDeg) {
        throw new KinematicsError(
          `drive '${mate.id}': target swing ${drive.angleDeg}° is outside the hinge limit ` +
            `[${mate.limit.minAngleDeg}°, ${mate.limit.maxAngleDeg}°] — refused`,
        );
      }
    }
    const axisA = resolveAxis(resolve, mate, 'a', partA);
    const axisB = resolveAxis(resolve, mate, 'b', partB);
    const alignErr = distanceAxisToAxis(
      { origin: axisA.origin, direction: axisA.direction },
      { origin: axisB.origin, direction: axisB.direction },
    );
    if (alignErr > HINGE_ALIGN_TOL) {
      throw new KinematicsError(
        `drive '${mate.id}': hinge axes are misaligned by ${alignErr.toExponential(3)} mm ` +
          `(> ${HINGE_ALIGN_TOL}) — solve statics first`,
      );
    }
    const swingRad = measureHingeSwingRad(mate, partA, partB, axisA.direction);
    const targetRad = (drive.angleDeg * Math.PI) / 180;
    // Rotating part a by φ about the axis changes the swing by −φ;
    // rotating part b by φ changes it by +φ.
    const componentA = connectedComponentWithoutMate(state, partA.id, mate.id);
    const componentB = connectedComponentWithoutMate(state, partB.id, mate.id);
    if ([...componentA].some(id => componentB.has(id))) {
      throw new KinematicsError(`drive '${mate.id}': hinge remains connected through an alternate mate path — closed-loop hinge drive requires a mechanism solver`);
    }
    const aGrounded = [...componentA].some(id => partById.get(id)?.fixed);
    const bGrounded = [...componentB].some(id => partById.get(id)?.fixed);
    if (aGrounded && bGrounded) {
      throw new KinematicsError(`drive '${mate.id}': both hinge branches contain fixed parts — nothing can move`);
    }
    if (bGrounded) {
      seedPartId = partA.id;
      seedAssignment = {
        kind: 'rotation',
        angleRad: swingRad - targetRad,
        axis: axisA,
        viaMateId: mate.id,
      };
      hingeRigidPartIds = componentA;
    } else {
      seedPartId = partB.id;
      seedAssignment = {
        kind: 'rotation',
        angleRad: targetRad - swingRad,
        axis: axisB,
        viaMateId: mate.id,
      };
      hingeRigidPartIds = componentB;
    }
  } else {
    // ── gear / rack_pinion: INCREMENTAL rotation of the driven side ─────
    const side = drive.side ?? 'a';
    if (mate.kind === 'rack_pinion' && side !== 'a') {
      throw new KinematicsError(
        `drive '${mate.id}': only the pinion (side 'a') accepts an angle drive — ` +
          `the rack (side 'b') moves linearly; refused`,
      );
    }
    const drivenPart = side === 'a' ? partA : partB;
    if (drivenPart.fixed) {
      throw new KinematicsError(
        `drive '${mate.id}': driven part '${drivenPart.id}' is fixed — unfix it or drive the other side`,
      );
    }
    const axis = resolveAxis(resolve, mate, side, drivenPart);
    seedPartId = drivenPart.id;
    seedAssignment = {
      kind: 'rotation',
      angleRad: (drive.angleDeg * Math.PI) / 180,
      axis,
      viaMateId: mate.id,
    };
  }

  const assignments = hingeRigidPartIds
    ? new Map([...hingeRigidPartIds].map(partId => [partId, seedAssignment] as const))
    : propagateFromSeed(state, resolve, partById, seedPartId, seedAssignment);

  // Apply all assignments. Seed first, then insertion order (BFS order).
  const effects: DriveEffect[] = [];
  for (const [partId, assign] of assignments) {
    const part = partById.get(partId)!;
    if (assign.kind === 'rotation') {
      const updated = rotatePartAboutAxis(part, assign.axis.origin, assign.axis.direction, assign.angleRad);
      partById.set(partId, updated);
      effects.push({
        partId,
        kind: 'rotation',
        amount: (assign.angleRad * 180) / Math.PI,
        axis: assign.axis,
        viaMateId: assign.viaMateId,
      });
    } else {
      const updated = {
        ...part,
        position: add(part.position, scale(assign.direction, assign.dist)),
      };
      partById.set(partId, updated);
      effects.push({
        partId,
        kind: 'translation',
        amount: assign.dist,
        direction: assign.direction,
        viaMateId: assign.viaMateId,
      });
    }
  }

  const newParts = parts.map((p) => partById.get(p.id)!);
  return { state: { parts: newParts, mates: state.mates }, effects };
}

// ─── public API ──────────────────────────────────────────────────────────

/**
 * Apply one or more drives to a (statics-solved) assembly. Drives are
 * applied SEQUENTIALLY in array order — each sees the state produced by
 * the previous one. Returns the driven state and the per-part effects.
 *
 * Refuses (KinematicsError, always with the reason):
 *   - unknown / suppressed / non-drivable mate
 *   - hinge drive without zeroAngleRef, outside limit, or with misaligned axes
 *   - driving or propagating into a fixed part
 *   - rack side of a rack_pinion driven by angle
 *   - kinematically inconsistent transmission loops
 */
export function applyDrives(
  state: AssemblyState,
  resolve: GeometryResolver,
  drives: ReadonlyArray<DriveSpec>,
): DriveResult {
  let current = state;
  const effects: DriveEffect[] = [];
  for (const drive of drives) {
    const step = applyOneDrive(current, resolve, drive);
    current = step.state;
    effects.push(...step.effects);
  }
  return { state: current, effects };
}
