/**
 * sketchTransform — Phase 2.x of NexyFab Pro own-CAD (ADR-013).
 *
 * Global / selection-scoped affine ops on the solver's entities. Unlike
 * `sketchGroup` (which transforms an explicitly bundled set of entities
 * around a per-group anchor), this module operates on:
 *
 *   - `scope === 'all'`  → every point known to the solver, OR
 *   - `scope === string[]` → only the listed entity ids (point / line /
 *     circle / arc — expanded to underlying points, deduped).
 *
 * Four ops:
 *   - translate(dx, dy, scope)
 *   - rotate(angle, center, scope)
 *   - scale(factor, center, scope)
 *   - mirror(p1, p2, scope)            — reflect across the line through p1,p2.
 *
 * Plus `reset()` which restores every tracked point (and circle/arc radius)
 * to the values they held at the moment the transform wrapper was created.
 *
 * vs sketchGroup:
 *   - group: persistent bundle with anchor + lock; rotate/scale use the
 *     bundle's anchor as default center.
 *   - transform: stateless ops on the whole sketch or an ad-hoc selection;
 *     center must be supplied explicitly for rotate/scale, mirror takes
 *     two points defining the axis line, snapshot enables reset.
 *
 * Solver coupling:
 *   - Reads point coords via `solver.point()`.
 *   - Writes via `solver.movePoint()` — which throws on fixed points, so
 *     we pre-check `cur.fixed` and skip silently (same policy as
 *     sketchGroup). This is what "fixed point 보호" means in this module.
 *   - Reads circle/arc radius via `solver.circle()` / `solver.arc()` and
 *     writes via `solver.setCircleRadius()` / `solver.setArc({radius})`
 *     during scale + mirror-with-flip cases.
 *
 * solver.ts and sketchGroup.ts are intentionally NOT modified — this is a
 * pure wrapper over the solver's existing mutation API.
 */

import type {
  SketchSolver,
  PointId,
  LineId,
  CircleId,
  ArcId,
} from './solver';

// ---------- public types ----------

export type TransformScope = 'all' | ReadonlyArray<string>;

export interface SketchTransform {
  /** Translate all/selected by (dx, dy). Fixed points skipped silently. */
  translate(dx: number, dy: number, scope?: TransformScope): void;
  /** Rotate around `center` by `angleRad` (radians, CCW). Fixed points skipped. */
  rotate(
    angleRad: number,
    center: { x: number; y: number },
    scope?: TransformScope,
  ): void;
  /** Scale around `center` by `factor`. Also scales circle/arc radii. */
  scale(
    factor: number,
    center: { x: number; y: number },
    scope?: TransformScope,
  ): void;
  /**
   * Mirror across the infinite line through `lineP1` and `lineP2`.
   * `lineP1` and `lineP2` MUST be distinct points (zero-length axis is
   * undefined). Fixed points skipped.
   */
  mirror(
    lineP1: { x: number; y: number },
    lineP2: { x: number; y: number },
    scope?: TransformScope,
  ): void;
  /**
   * Restore every point (+ circle/arc radius) tracked at wrapper-creation
   * time back to its captured value. Points added to the solver AFTER the
   * wrapper was created are not touched (no entry in the snapshot).
   */
  reset(): void;
}

// ---------- impl ----------

type EntityKind = 'point' | 'line' | 'circle' | 'arc';

interface PointSnapshot {
  x: number;
  y: number;
}

interface CircleSnapshot {
  radius: number;
}

interface ArcSnapshot {
  radius: number;
}

/**
 * Reflective entity-kind probe. Same trick sketchGroup uses — the solver
 * doesn't expose a public `kindOf`, so we sniff the matching read-accessor
 * and let the misses throw. O(1) per entity.
 */
function probeKind(solver: SketchSolver, id: string): EntityKind | null {
  try { solver.point(id as PointId); return 'point'; } catch { /* fallthrough */ }
  try { solver.line(id as LineId); return 'line'; } catch { /* fallthrough */ }
  try { solver.circle(id as CircleId); return 'circle'; } catch { /* fallthrough */ }
  try { solver.arc(id as ArcId); return 'arc'; } catch { /* fallthrough */ }
  return null;
}

/** Underlying point ids for an entity (no dedup, caller dedups). */
function pointsOfEntity(solver: SketchSolver, entityId: string): PointId[] {
  const kind = probeKind(solver, entityId);
  if (kind === null) {
    throw new Error(`sketchTransform: unknown entity id ${entityId}`);
  }
  if (kind === 'point') return [entityId as PointId];
  if (kind === 'line') {
    const { p1, p2 } = solver.line(entityId as LineId);
    return [p1, p2];
  }
  if (kind === 'circle') {
    const { center } = solver.circle(entityId as CircleId);
    return [center];
  }
  // arc
  const { center, start, end } = solver.arc(entityId as ArcId);
  return [center, start, end];
}

/**
 * Internal accessor: enumerate every point currently known to the solver.
 *
 * The solver's tracking map (`SketchSolver.points`) is private, so we use
 * a reflective fallback: scan ids of the form `p<n>` produced by the
 * solver's `fresh<PointId>('p')` generator until `solver.point(id)` throws.
 * This is O(N) where N is the total entity count — acceptable for sketch
 * sizes (sketches with thousands of points are pathological).
 *
 * NOTE: this only catches points up through the highest-numbered point
 * that exists at call time. Points created mid-scan are fine because the
 * solver assigns ids monotonically. If a point was `removePoint`-ed
 * earlier, its id is skipped (the inner `point()` throws) — exactly what
 * we want.
 */
function enumerateAllPointIds(solver: SketchSolver): PointId[] {
  const out: PointId[] = [];
  // We don't know nextId, so probe forward until we hit a long stretch of
  // misses. In practice ids are dense, but a few may be removed; allow a
  // gap of 32 misses before bailing (cheap and resilient to small holes).
  const MAX_GAP = 32;
  let consecutiveMisses = 0;
  let i = 1;
  while (consecutiveMisses < MAX_GAP) {
    const id = `p${i}` as PointId;
    try {
      solver.point(id);
      out.push(id);
      consecutiveMisses = 0;
    } catch {
      consecutiveMisses++;
    }
    i++;
    // Safety cap so we don't loop forever on a degenerate solver
    // (shouldn't happen, but defensive).
    if (i > 1_000_000) break;
  }
  return out;
}

/** Distinct ordered union of point ids derived from a scope. */
function resolveScopePoints(
  solver: SketchSolver,
  scope: TransformScope,
): PointId[] {
  if (scope === 'all') {
    return enumerateAllPointIds(solver);
  }
  const seen = new Set<string>();
  const out: PointId[] = [];
  for (const eid of scope) {
    for (const pid of pointsOfEntity(solver, eid)) {
      if (!seen.has(pid)) {
        seen.add(pid);
        out.push(pid);
      }
    }
  }
  return out;
}

/**
 * Distinct circles/arcs derived from a scope. For 'all' we have no public
 * iterator either, so probe forward by id prefix the same way as points.
 */
function resolveScopeCirclesAndArcs(
  solver: SketchSolver,
  scope: TransformScope,
): { circles: CircleId[]; arcs: ArcId[] } {
  if (scope === 'all') {
    const circles: CircleId[] = [];
    const arcs: ArcId[] = [];
    const MAX_GAP = 32;
    // circles
    {
      let consecutiveMisses = 0;
      let i = 1;
      while (consecutiveMisses < MAX_GAP) {
        const id = `c${i}` as CircleId;
        try {
          solver.circle(id);
          circles.push(id);
          consecutiveMisses = 0;
        } catch {
          consecutiveMisses++;
        }
        i++;
        if (i > 1_000_000) break;
      }
    }
    // arcs
    {
      let consecutiveMisses = 0;
      let i = 1;
      while (consecutiveMisses < MAX_GAP) {
        const id = `a${i}` as ArcId;
        try {
          solver.arc(id);
          arcs.push(id);
          consecutiveMisses = 0;
        } catch {
          consecutiveMisses++;
        }
        i++;
        if (i > 1_000_000) break;
      }
    }
    return { circles, arcs };
  }
  const circles: CircleId[] = [];
  const arcs: ArcId[] = [];
  const seen = new Set<string>();
  for (const eid of scope) {
    if (seen.has(eid)) continue;
    seen.add(eid);
    const kind = probeKind(solver, eid);
    if (kind === 'circle') circles.push(eid as CircleId);
    else if (kind === 'arc') arcs.push(eid as ArcId);
  }
  return { circles, arcs };
}

export function createSketchTransform(solver: SketchSolver): SketchTransform {
  // ---- snapshot at construction time (for reset) ----
  const pointSnap = new Map<PointId, PointSnapshot>();
  const circleSnap = new Map<CircleId, CircleSnapshot>();
  const arcSnap = new Map<ArcId, ArcSnapshot>();

  for (const pid of enumerateAllPointIds(solver)) {
    const p = solver.point(pid);
    pointSnap.set(pid, { x: p.x, y: p.y });
  }
  {
    const { circles, arcs } = resolveScopeCirclesAndArcs(solver, 'all');
    for (const cid of circles) {
      circleSnap.set(cid, { radius: solver.circle(cid).radius });
    }
    for (const aid of arcs) {
      arcSnap.set(aid, { radius: solver.arc(aid).radius });
    }
  }

  function translate(dx: number, dy: number, scope: TransformScope = 'all'): void {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
      throw new Error(`sketchTransform.translate: dx/dy must be finite (${dx}, ${dy})`);
    }
    const pts = resolveScopePoints(solver, scope);
    for (const pid of pts) {
      const cur = solver.point(pid);
      if (cur.fixed) continue;
      solver.movePoint(pid, cur.x + dx, cur.y + dy);
    }
  }

  function rotate(
    angleRad: number,
    center: { x: number; y: number },
    scope: TransformScope = 'all',
  ): void {
    if (!Number.isFinite(angleRad)) {
      throw new Error(`sketchTransform.rotate: angle must be finite (${angleRad})`);
    }
    if (!center || !Number.isFinite(center.x) || !Number.isFinite(center.y)) {
      throw new Error('sketchTransform.rotate: center must have finite x/y');
    }
    const cos = Math.cos(angleRad);
    const sin = Math.sin(angleRad);
    const cx = center.x;
    const cy = center.y;
    const pts = resolveScopePoints(solver, scope);
    for (const pid of pts) {
      const cur = solver.point(pid);
      if (cur.fixed) continue;
      const rx = cur.x - cx;
      const ry = cur.y - cy;
      const nx = cx + rx * cos - ry * sin;
      const ny = cy + rx * sin + ry * cos;
      solver.movePoint(pid, nx, ny);
    }
  }

  function scale(
    factor: number,
    center: { x: number; y: number },
    scope: TransformScope = 'all',
  ): void {
    if (!Number.isFinite(factor)) {
      throw new Error(`sketchTransform.scale: factor must be finite (${factor})`);
    }
    if (factor === 0) {
      throw new Error('sketchTransform.scale: factor must be non-zero');
    }
    if (!center || !Number.isFinite(center.x) || !Number.isFinite(center.y)) {
      throw new Error('sketchTransform.scale: center must have finite x/y');
    }
    const cx = center.x;
    const cy = center.y;
    const pts = resolveScopePoints(solver, scope);
    for (const pid of pts) {
      const cur = solver.point(pid);
      if (cur.fixed) continue;
      const nx = cx + (cur.x - cx) * factor;
      const ny = cy + (cur.y - cy) * factor;
      solver.movePoint(pid, nx, ny);
    }
    // Scale circle / arc radii proportionally. Use |factor| so a negative
    // factor (point-inversion via scale) still yields a positive radius;
    // the underlying centers already moved through the point pass above.
    const { circles, arcs } = resolveScopeCirclesAndArcs(solver, scope);
    const absF = Math.abs(factor);
    for (const cid of circles) {
      const r = solver.circle(cid).radius * absF;
      if (r > 0 && Number.isFinite(r)) solver.setCircleRadius(cid, r);
    }
    for (const aid of arcs) {
      const r = solver.arc(aid).radius * absF;
      if (r > 0 && Number.isFinite(r)) solver.setArc(aid, { radius: r });
    }
  }

  function mirror(
    lineP1: { x: number; y: number },
    lineP2: { x: number; y: number },
    scope: TransformScope = 'all',
  ): void {
    if (!lineP1 || !lineP2) {
      throw new Error('sketchTransform.mirror: both line points required');
    }
    if (
      !Number.isFinite(lineP1.x) || !Number.isFinite(lineP1.y) ||
      !Number.isFinite(lineP2.x) || !Number.isFinite(lineP2.y)
    ) {
      throw new Error('sketchTransform.mirror: line points must have finite coords');
    }
    // Line direction
    const dx = lineP2.x - lineP1.x;
    const dy = lineP2.y - lineP1.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) {
      throw new Error('sketchTransform.mirror: lineP1 and lineP2 must be distinct');
    }
    // Unit normal to the line.
    const len = Math.sqrt(lenSq);
    const nx = -dy / len;
    const ny = dx / len;

    // Reflection of P about line through p1 with normal n:
    //   d = (P - p1) · n          (signed perpendicular distance)
    //   P' = P - 2 * d * n
    const pts = resolveScopePoints(solver, scope);
    for (const pid of pts) {
      const cur = solver.point(pid);
      if (cur.fixed) continue;
      const vx = cur.x - lineP1.x;
      const vy = cur.y - lineP1.y;
      const d = vx * nx + vy * ny;
      const rx = cur.x - 2 * d * nx;
      const ry = cur.y - 2 * d * ny;
      solver.movePoint(pid, rx, ry);
    }
    // Radii are invariant under reflection (mirror is rigid + orientation-
    // flipping; |radius| unchanged). Centers already moved through the
    // point pass above. We deliberately do NOT touch circle/arc radii here.
  }

  function reset(): void {
    // Restore every snapshotted point. Skip fixed (movePoint would throw)
    // and skip points whose current value already matches (cheap, avoids
    // pointless writes). Points that were removed from the solver since
    // construction are silently skipped (point() throws).
    for (const [pid, snap] of pointSnap) {
      try {
        const cur = solver.point(pid);
        if (cur.fixed) continue;
        if (cur.x === snap.x && cur.y === snap.y) continue;
        solver.movePoint(pid, snap.x, snap.y);
      } catch {
        // Point no longer exists in the solver — skip.
      }
    }
    for (const [cid, snap] of circleSnap) {
      try {
        const cur = solver.circle(cid);
        if (cur.radius === snap.radius) continue;
        solver.setCircleRadius(cid, snap.radius);
      } catch {
        // Circle no longer exists — skip.
      }
    }
    for (const [aid, snap] of arcSnap) {
      try {
        const cur = solver.arc(aid);
        if (cur.radius === snap.radius) continue;
        solver.setArc(aid, { radius: snap.radius });
      } catch {
        // Arc no longer exists — skip.
      }
    }
  }

  return {
    translate,
    rotate,
    scale,
    mirror,
    reset,
  };
}
