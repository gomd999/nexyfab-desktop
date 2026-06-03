/**
 * sketchGroup — Phase 2.x of NexyFab Pro own-CAD (ADR-013).
 *
 * Group entity support for SketchSolver: bundle multiple sketch entities
 * (point / line / circle / arc) under a single addressable handle, then
 * translate / rotate / scale them as a unit around an anchor.
 *
 * Group is an **external layer concept** — planegcs itself has no notion
 * of "group". This module wraps SketchSolver with pure(-ish) functions
 * that drive the solver's existing per-point mutation API
 * (`movePoint` / `setPointX` / `setPointY`). solver.ts is intentionally
 * not modified.
 *
 * Transform algorithm:
 *   - translate(dx,dy)         : each underlying point += (dx,dy)
 *   - rotate(theta)            : each point rotated around `group.anchor`
 *   - scale(factor, center?)   : each point scaled around `center` (default
 *                                = group.anchor)
 *
 * Entity → points expansion:
 *   - point  : itself
 *   - line   : p1, p2
 *   - circle : center           (radius unchanged by translate/rotate,
 *                                scaled by `factor` on scale())
 *   - arc    : center, start, end (radius/angles updated on scale/rotate)
 *
 * Each underlying point is collected into a **deduped** set so a point
 * that's shared across multiple entities in the same group only gets
 * transformed once (avoids double-translate when e.g. a line and a circle
 * both reference the same point).
 *
 * Lock policy:
 *   `locked: true` is purely an advisory flag the caller honors via
 *   `isInGroup(entityId)` + checking the corresponding `groups[]` entry.
 *   This module enforces lock only inside its own transform methods:
 *     - translate/rotate/scale on a locked group throw (treated as
 *       explicit edits that the lock is meant to gate).
 *   `toggleLock` is always allowed regardless of state.
 *   Callers are expected to consult `isInGroup` before issuing any other
 *   solver mutation (e.g. movePoint) on a member entity.
 */

import type { SketchSolver, PointId, LineId, CircleId, ArcId } from './solver';

// ---------- public types ----------

export interface SketchGroup {
  id: string;
  name: string;
  entityIds: ReadonlyArray<string>;
  /** Anchor point used as the rotation / default scale center. */
  anchor: { x: number; y: number };
  /** Locked: caller should not edit member entities individually. */
  locked: boolean;
}

export interface SketchGroupManager {
  /** Current snapshot of all groups (stable order = insertion order). */
  readonly groups: ReadonlyArray<SketchGroup>;
  create(
    name: string,
    entityIds: string[],
    anchor?: { x: number; y: number },
  ): SketchGroup;
  remove(groupId: string): void;
  translate(groupId: string, dx: number, dy: number): void;
  rotate(groupId: string, angleRad: number): void;
  scale(groupId: string, factor: number, center?: { x: number; y: number }): void;
  toggleLock(groupId: string): void;
  /** Returns the id of the group that owns `entityId`, else `null`. */
  isInGroup(entityId: string): string | null;
}

// ---------- impl ----------

/**
 * Reflective entity-kind probe. We can't import the solver's private
 * `kindOf` so instead we sniff the matching read-accessor and catch the
 * "Expected X id" / "Unknown entity id" throws. This is O(1) per entity
 * and only runs at group-create time.
 */
type EntityKind = 'point' | 'line' | 'circle' | 'arc';

function probeKind(solver: SketchSolver, id: string): EntityKind | null {
  // Order: cheap → expensive. point() asserts via assertPoint which only
  // checks the JS-side map; line/circle/arc each consult their own set
  // before calling into sketch_index.
  try { solver.point(id as PointId); return 'point'; } catch { /* fallthrough */ }
  try { solver.line(id as LineId); return 'line'; } catch { /* fallthrough */ }
  try { solver.circle(id as CircleId); return 'circle'; } catch { /* fallthrough */ }
  try { solver.arc(id as ArcId); return 'arc'; } catch { /* fallthrough */ }
  return null;
}

/**
 * Collect deduped underlying point ids for an entity.
 *
 * For lines/circles/arcs we read structural references via the solver's
 * public accessors. The returned ids are the point ids that move when
 * the group's transform is applied.
 */
function pointsOfEntity(solver: SketchSolver, entityId: string): PointId[] {
  const kind = probeKind(solver, entityId);
  if (kind === null) {
    throw new Error(`sketchGroup: unknown entity id ${entityId}`);
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

/** Distinct ordered union of the points each entity transitively owns. */
function collectAllPoints(solver: SketchSolver, entityIds: ReadonlyArray<string>): PointId[] {
  const seen = new Set<string>();
  const out: PointId[] = [];
  for (const eid of entityIds) {
    for (const pid of pointsOfEntity(solver, eid)) {
      if (!seen.has(pid)) {
        seen.add(pid);
        out.push(pid);
      }
    }
  }
  return out;
}

/** Average position of the given points — fallback anchor when caller omits one. */
function averagePoint(
  solver: SketchSolver,
  pointIds: ReadonlyArray<PointId>,
): { x: number; y: number } {
  if (pointIds.length === 0) return { x: 0, y: 0 };
  let sx = 0, sy = 0;
  for (const id of pointIds) {
    const p = solver.point(id);
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / pointIds.length, y: sy / pointIds.length };
}

export function createSketchGroupManager(
  solver: SketchSolver,
  initialGroups?: ReadonlyArray<SketchGroup>,
): SketchGroupManager {
  const groups: SketchGroup[] = initialGroups ? initialGroups.map(cloneGroup) : [];
  let nextId = 1;

  function findIndex(groupId: string): number {
    return groups.findIndex((g) => g.id === groupId);
  }

  function getOrThrow(groupId: string): SketchGroup {
    const idx = findIndex(groupId);
    if (idx < 0) throw new Error(`sketchGroup: unknown group ${groupId}`);
    return groups[idx];
  }

  function assertUnlocked(g: SketchGroup, op: string): void {
    if (g.locked) {
      throw new Error(`sketchGroup: ${op} blocked — group ${g.id} is locked`);
    }
  }

  function create(
    name: string,
    entityIds: string[],
    anchor?: { x: number; y: number },
  ): SketchGroup {
    if (entityIds.length === 0) {
      throw new Error('sketchGroup: cannot create empty group');
    }
    // Verify every entity exists in the solver. probeKind throws via the
    // collectAllPoints path, so we surface a clearer error up-front.
    for (const eid of entityIds) {
      const kind = probeKind(solver, eid);
      if (kind === null) {
        throw new Error(`sketchGroup: entity ${eid} not found in solver`);
      }
    }
    const allPoints = collectAllPoints(solver, entityIds);
    const resolvedAnchor = anchor ?? averagePoint(solver, allPoints);
    const group: SketchGroup = {
      id: `g${nextId++}`,
      name,
      entityIds: [...entityIds],
      anchor: { x: resolvedAnchor.x, y: resolvedAnchor.y },
      locked: false,
    };
    groups.push(group);
    return cloneGroup(group);
  }

  function remove(groupId: string): void {
    const idx = findIndex(groupId);
    if (idx < 0) return;
    groups.splice(idx, 1);
  }

  function translate(groupId: string, dx: number, dy: number): void {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
      throw new Error(`sketchGroup.translate: dx/dy must be finite (${dx}, ${dy})`);
    }
    const g = getOrThrow(groupId);
    assertUnlocked(g, 'translate');
    const pts = collectAllPoints(solver, g.entityIds);
    for (const pid of pts) {
      const cur = solver.point(pid);
      if (cur.fixed) continue; // skip fixed points (solver.movePoint would throw)
      solver.movePoint(pid, cur.x + dx, cur.y + dy);
    }
    // Anchor follows the group so subsequent rotate/scale still feels right.
    g.anchor = { x: g.anchor.x + dx, y: g.anchor.y + dy };
  }

  function rotate(groupId: string, angleRad: number): void {
    if (!Number.isFinite(angleRad)) {
      throw new Error(`sketchGroup.rotate: angle must be finite (${angleRad})`);
    }
    const g = getOrThrow(groupId);
    assertUnlocked(g, 'rotate');
    const cos = Math.cos(angleRad);
    const sin = Math.sin(angleRad);
    const ax = g.anchor.x;
    const ay = g.anchor.y;
    const pts = collectAllPoints(solver, g.entityIds);
    for (const pid of pts) {
      const cur = solver.point(pid);
      if (cur.fixed) continue;
      const rx = cur.x - ax;
      const ry = cur.y - ay;
      const nx = ax + rx * cos - ry * sin;
      const ny = ay + rx * sin + ry * cos;
      solver.movePoint(pid, nx, ny);
    }
    // Anchor itself is invariant under rotation around itself — no change.
  }

  function scale(
    groupId: string,
    factor: number,
    center?: { x: number; y: number },
  ): void {
    if (!Number.isFinite(factor)) {
      throw new Error(`sketchGroup.scale: factor must be finite (${factor})`);
    }
    if (factor === 0) {
      throw new Error('sketchGroup.scale: factor must be non-zero');
    }
    const g = getOrThrow(groupId);
    assertUnlocked(g, 'scale');
    const cx = center?.x ?? g.anchor.x;
    const cy = center?.y ?? g.anchor.y;
    const pts = collectAllPoints(solver, g.entityIds);
    for (const pid of pts) {
      const cur = solver.point(pid);
      if (cur.fixed) continue;
      const nx = cx + (cur.x - cx) * factor;
      const ny = cy + (cur.y - cy) * factor;
      solver.movePoint(pid, nx, ny);
    }
    // Also scale stored radius on circles/arcs so the rendered geometry
    // tracks (the underlying center point already moved above).
    for (const eid of g.entityIds) {
      const kind = probeKind(solver, eid);
      if (kind === 'circle') {
        const c = solver.circle(eid as CircleId);
        const newR = c.radius * Math.abs(factor);
        if (newR > 0 && Number.isFinite(newR)) {
          solver.setCircleRadius(eid as CircleId, newR);
        }
      } else if (kind === 'arc') {
        const a = solver.arc(eid as ArcId);
        const newR = a.radius * Math.abs(factor);
        if (newR > 0 && Number.isFinite(newR)) {
          solver.setArc(eid as ArcId, { radius: newR });
        }
      }
    }
    // Anchor moves under non-anchor-centered scale (so the group stays
    // visually centered for follow-up rotates).
    if (center && (center.x !== g.anchor.x || center.y !== g.anchor.y)) {
      g.anchor = {
        x: cx + (g.anchor.x - cx) * factor,
        y: cy + (g.anchor.y - cy) * factor,
      };
    }
  }

  function toggleLock(groupId: string): void {
    const g = getOrThrow(groupId);
    g.locked = !g.locked;
  }

  function isInGroup(entityId: string): string | null {
    for (const g of groups) {
      if (g.entityIds.includes(entityId)) return g.id;
    }
    return null;
  }

  return {
    get groups(): ReadonlyArray<SketchGroup> {
      // Return a defensive snapshot so external mutation can't corrupt state.
      return groups.map(cloneGroup);
    },
    create,
    remove,
    translate,
    rotate,
    scale,
    toggleLock,
    isInGroup,
  };
}

function cloneGroup(g: SketchGroup): SketchGroup {
  return {
    id: g.id,
    name: g.name,
    entityIds: [...g.entityIds],
    anchor: { x: g.anchor.x, y: g.anchor.y },
    locked: g.locked,
  };
}
