/**
 * explodeView — Phase 3.4.x of NexyFab Pro own-CAD (ADR-013).
 *
 * Schematic-style "exploded" / "disassembly" view of an assembly. Each
 * part is shifted along an axis derived from its mate context, producing
 * a visual breakdown like a CAD drawing's exploded BOM or an IKEA-style
 * disassembly diagram.
 *
 * Pure logic — no Three.js / OCCT dependency. The rendering layer
 * consumes `ExplodedState` (displaced placements + leader-line hints)
 * and draws it however it wants.
 *
 * Scope:
 *   - Per-part explode axis selection via 3 heuristics:
 *       mate_axes      — first connected mate's normal/axis
 *       bbox_center    — direction from assembly centroid to part centroid
 *       gravity_normal — world Z+ (everything floats upward)
 *   - Per-part explode distance: greater of (own bbox extent, max neighbour
 *     bbox extent along the axis) × scale + clearance — pulls each part
 *     clear of its connected neighbour.
 *   - Ordering: depth-first traversal of the mate-connectivity graph
 *     starting from root parts (fixed parts, or the most-connected part
 *     when nothing is fixed). Leaves explode FIRST, roots LAST — when an
 *     animator plays steps in order, the outermost parts peel off the
 *     assembly before the next layer below them moves.
 *   - Manual overrides via `manualSteps`: per-part axis/distance/order
 *     fields, missing fields fall back to computed values.
 *   - Animation interpolation: `interpolateExplode(state, exploded, t)`
 *     produces a partially-displaced AssemblyState, t in [0, 1].
 *
 * Out of scope (later phases):
 *   - Sub-assembly grouping (sub-assembly explodes as a single rigid
 *     body, then expands internally — Phase 3.5).
 *   - Rotational explode (some parts unscrew rather than translate).
 *   - Trail-line styling (rendering hint only — caller decides dash
 *     pattern, colour, label, etc.).
 *
 * NEW file — does not modify mate.ts or iterativeSolver.ts.
 */

import type { AssemblyState, PartInstance } from './assemblyState';
import type { Mate } from './mate';
import type { AABB } from './interference';
import type { Vec3 } from '@/lib/sketch/sketchPlane';
import { add, sub, scale, lengthOf, vec3 } from '@/lib/sketch/sketchPlane';

// ─── public types ────────────────────────────────────────────────────────

/**
 * A single per-part explode instruction. The part is shifted from its
 * resolved (assembled) position by `axis * distance`.
 *
 *   - `axis`  — unit vector in world frame.
 *   - `distance` — millimetres along `axis`.
 *   - `order` — animation slot (lower = animates first). Steps with the
 *               same `order` may be played simultaneously.
 */
export interface ExplodeStep {
  partId: string;
  axis: Vec3;
  /** Always ≥ 0 (sign is folded into `axis`). */
  distance: number;
  order: number;
}

export type ExplodeAxisHeuristic = 'mate_axes' | 'bbox_center' | 'gravity_normal';

export interface ExplodeConfig {
  state: AssemblyState;
  /**
   * Multiplier on the natural (bbox-derived) clearance distance.
   * Default 1.5 — parts are pulled 1.5× their own bbox span apart so the
   * gap between adjacent parts visually equals the part size.
   */
  scale?: number;
  /** Axis-selection strategy, default 'mate_axes'. */
  axisHeuristic?: ExplodeAxisHeuristic;
  /**
   * Per-part overrides. Each partial step is matched by `partId`; any
   * field present overrides the computed value, missing fields fall back
   * to the heuristic. An override entry without `partId` is ignored.
   */
  manualSteps?: ReadonlyArray<Partial<ExplodeStep>>;
  /**
   * Optional bounding-box source per part (local-frame AABB before the
   * part's placement). When omitted, a default unit cube is assumed so
   * the algorithm still produces sensible non-zero distances.
   */
  partBboxes?: ReadonlyMap<string, AABB>;
  /**
   * Extra clearance added to the natural distance, in mm. Default 0.
   * Useful when callers want every part to clear by at least N mm on
   * top of the bbox-derived value.
   */
  clearance?: number;
}

export interface ExplodeTrailLine {
  partId: string;
  /** World-frame position of the part origin BEFORE the explode. */
  start: Vec3;
  /** World-frame position of the part origin AFTER the explode. */
  end: Vec3;
}

export interface ExplodedState {
  steps: ReadonlyArray<ExplodeStep>;
  /** Assembly state with each part placement shifted per its step. */
  displacedState: AssemblyState;
  /** Leader lines (dashed in the rendering layer) from old → new. */
  trailLines: ReadonlyArray<ExplodeTrailLine>;
}

// ─── constants ───────────────────────────────────────────────────────────

const DEFAULT_SCALE = 1.5;
const DEFAULT_AXIS: Vec3 = { x: 0, y: 0, z: 1 };
const DEFAULT_BBOX: AABB = {
  min: { x: -0.5, y: -0.5, z: -0.5 },
  max: { x: 0.5, y: 0.5, z: 0.5 },
};
const EPS = 1e-9;

// ─── top-level entry point ───────────────────────────────────────────────

/**
 * Build the exploded view for an assembly. Pure function — returns a new
 * `ExplodedState`; the input `config.state` is not mutated.
 */
export function buildExplodedState(config: ExplodeConfig): ExplodedState {
  const state = config.state;
  const heuristic: ExplodeAxisHeuristic = config.axisHeuristic ?? 'mate_axes';
  const scaleFactor = config.scale ?? DEFAULT_SCALE;
  const clearance = config.clearance ?? 0;
  const manualByPart = indexManualSteps(config.manualSteps);

  // 1) compute per-part axis
  const axesByPart = new Map<string, Vec3>();
  for (const part of state.parts) {
    const override = manualByPart.get(part.id);
    const axis = override?.axis
      ? safeNormalize(override.axis) ?? DEFAULT_AXIS
      : computeExplodeAxis(state, part.id, heuristic);
    axesByPart.set(part.id, axis);
  }

  // 2) compute per-part distance
  const distancesByPart = new Map<string, number>();
  for (const part of state.parts) {
    const override = manualByPart.get(part.id);
    const axis = axesByPart.get(part.id) ?? DEFAULT_AXIS;
    let distance: number;
    if (override?.distance !== undefined && Number.isFinite(override.distance)) {
      distance = Math.max(0, override.distance);
    } else {
      const natural = computeExplodeDistance(state, part.id, axis, config.partBboxes);
      distance = natural * scaleFactor + clearance;
    }
    distancesByPart.set(part.id, distance);
  }

  // 3) ordering (depth-first, root → leaf; explode = leaf first)
  const orderedSteps = orderExplodeSteps(state, axesByPart, distancesByPart);

  // 4) apply manual-order overrides
  const stepsWithOverrides: ExplodeStep[] = orderedSteps.map((s) => {
    const override = manualByPart.get(s.partId);
    if (override?.order !== undefined && Number.isFinite(override.order)) {
      return { ...s, order: override.order };
    }
    return s;
  });

  // 5) build displaced state + trail lines
  const trailLines: ExplodeTrailLine[] = [];
  const displacedParts: PartInstance[] = state.parts.map((part) => {
    const step = stepsWithOverrides.find((s) => s.partId === part.id);
    if (!step || step.distance === 0) {
      trailLines.push({ partId: part.id, start: part.position, end: part.position });
      return { ...part };
    }
    const newPos = add(part.position, scale(step.axis, step.distance));
    trailLines.push({ partId: part.id, start: part.position, end: newPos });
    return { ...part, position: newPos };
  });

  const displacedState: AssemblyState = {
    parts: displacedParts,
    mates: state.mates,
  };

  return {
    steps: stepsWithOverrides,
    displacedState,
    trailLines,
  };
}

// ─── per-step helpers (exposed) ──────────────────────────────────────────

/**
 * Select the explode axis for a single part. Returns a unit vector in
 * world frame. Falls back to world-Z+ when the chosen heuristic cannot
 * determine a meaningful direction (e.g., `bbox_center` for the centroid
 * part itself, or `mate_axes` when the part has no mates).
 */
export function computeExplodeAxis(
  state: AssemblyState,
  partId: string,
  heuristic: ExplodeAxisHeuristic,
): Vec3 {
  switch (heuristic) {
    case 'gravity_normal':
      return DEFAULT_AXIS;
    case 'bbox_center':
      return axisFromBboxCenter(state, partId);
    case 'mate_axes':
    default:
      return axisFromMateConnectivity(state, partId);
  }
}

/**
 * Compute the natural explode distance for a part along the given axis.
 * Returns the MAX projected extent (own bbox along axis OR nearest mated
 * neighbour's bbox along axis), so the part clears the neighbour even
 * after scaling. Returns 0 for fixed parts (anchors don't move).
 */
export function computeExplodeDistance(
  state: AssemblyState,
  partId: string,
  axis: Vec3,
  partBboxes?: ReadonlyMap<string, AABB>,
): number {
  const part = state.parts.find((p) => p.id === partId);
  if (!part) return 0;
  if (part.fixed) return 0;
  const ownExtent = projectedExtent(getBbox(partBboxes, partId), axis);
  let neighbourExtent = 0;
  for (const neighbourId of neighbourIds(state, partId)) {
    const e = projectedExtent(getBbox(partBboxes, neighbourId), axis);
    if (e > neighbourExtent) neighbourExtent = e;
  }
  return Math.max(ownExtent, neighbourExtent);
}

/**
 * Order the explode steps via depth-first traversal of the mate
 * connectivity graph.
 *
 * Root selection:
 *   - All fixed parts are roots. If no part is fixed, the most-connected
 *     part (highest mate degree) is the root.
 *   - Roots get order = 0 and zero distance (they don't visually
 *     explode — they anchor the diagram).
 *
 * Traversal:
 *   - DFS from each root, recording each part's shortest depth from a
 *     root. Order is then `maxDepth - depth`, so leaves (deepest parts)
 *     get order 0 and roots get the highest order. Sorting the returned
 *     steps ASCENDING by order therefore yields LEAF → ROOT — the outer
 *     layer peels off first when an animator plays steps in array order.
 *   - Fixed roots keep distance 0 (they anchor the diagram, never shift).
 *
 * The returned array is pre-sorted ascending by (order, partId). Tests
 * assert the ordering field directly.
 */
export function orderExplodeSteps(
  state: AssemblyState,
  axes: ReadonlyMap<string, Vec3>,
  distances?: ReadonlyMap<string, number>,
): ExplodeStep[] {
  const graph = buildConnectivityGraph(state);
  const roots = pickRoots(state, graph);
  const depthByPart = new Map<string, number>();

  // DFS from each root, recording first-seen depth.
  for (const rootId of roots) {
    dfsAssignDepth(rootId, graph, depthByPart, 0);
  }

  // Any part not reached from a root (disconnected island) is treated as
  // its own root at depth 0.
  for (const part of state.parts) {
    if (!depthByPart.has(part.id)) {
      dfsAssignDepth(part.id, graph, depthByPart, 0);
    }
  }

  // Build steps. Leaves (highest depth) should explode FIRST → invert
  // depth so animation order ascending matches "leaf first".
  const maxDepth = Math.max(0, ...Array.from(depthByPart.values()));
  const steps: ExplodeStep[] = state.parts.map((part) => {
    const axis = axes.get(part.id) ?? DEFAULT_AXIS;
    const distance = distances?.get(part.id) ?? 0;
    const depth = depthByPart.get(part.id) ?? 0;
    const order = maxDepth - depth; // leaves (depth = max) get order 0
    return {
      partId: part.id,
      axis,
      distance: part.fixed ? 0 : distance,
      order,
    };
  });

  // Sort ascending so the array matches the play order.
  steps.sort((a, b) => a.order - b.order || a.partId.localeCompare(b.partId));
  return steps;
}

/**
 * Animation interpolator: returns an AssemblyState whose part positions
 * are linearly interpolated between original (t = 0) and fully-exploded
 * (t = 1). Clamps t to [0, 1]. Orientations are preserved.
 */
export function interpolateExplode(
  state: AssemblyState,
  exploded: ExplodedState,
  tRaw: number,
): AssemblyState {
  const t = Math.max(0, Math.min(1, Number.isFinite(tRaw) ? tRaw : 0));
  const stepsByPart = new Map<string, ExplodeStep>();
  for (const step of exploded.steps) stepsByPart.set(step.partId, step);
  const parts: PartInstance[] = state.parts.map((part) => {
    const step = stepsByPart.get(part.id);
    if (!step || step.distance === 0) return { ...part };
    const shift = scale(step.axis, step.distance * t);
    return { ...part, position: add(part.position, shift) };
  });
  return { parts, mates: state.mates };
}

// ─── internals: axis heuristics ──────────────────────────────────────────

function axisFromMateConnectivity(state: AssemblyState, partId: string): Vec3 {
  // First connected mate's "axial" hint:
  //   - concentric / hinge / slot / gear / rack_pinion: vector from this
  //     part's origin to its mate partner's origin (proxies the axis
  //     direction relative to neighbour position).
  //   - coincident / distance plane/plane: same partner-direction proxy.
  //   - When no mate touches this part, fall back to gravity normal.
  for (const mate of state.mates) {
    if (mate.suppressed) continue;
    const partnerId = otherPart(mate, partId);
    if (!partnerId) continue;
    const part = state.parts.find((p) => p.id === partId);
    const partner = state.parts.find((p) => p.id === partnerId);
    if (!part || !partner) continue;
    const dir = sub(part.position, partner.position);
    const norm = safeNormalize(dir);
    if (norm) return norm;
    // Degenerate (same origin) — fall back below.
  }
  return DEFAULT_AXIS;
}

function axisFromBboxCenter(state: AssemblyState, partId: string): Vec3 {
  const part = state.parts.find((p) => p.id === partId);
  if (!part) return DEFAULT_AXIS;
  if (state.parts.length === 0) return DEFAULT_AXIS;
  let sx = 0, sy = 0, sz = 0;
  for (const p of state.parts) {
    sx += p.position.x;
    sy += p.position.y;
    sz += p.position.z;
  }
  const centroid = vec3(sx / state.parts.length, sy / state.parts.length, sz / state.parts.length);
  const dir = sub(part.position, centroid);
  return safeNormalize(dir) ?? DEFAULT_AXIS;
}

// ─── internals: connectivity graph ───────────────────────────────────────

interface ConnectivityGraph {
  /** partId → set of neighbour partIds. */
  neighbours: Map<string, Set<string>>;
  /** partId → mate-degree (count of mates that touch the part). */
  degree: Map<string, number>;
}

function buildConnectivityGraph(state: AssemblyState): ConnectivityGraph {
  const neighbours = new Map<string, Set<string>>();
  const degree = new Map<string, number>();
  for (const part of state.parts) {
    neighbours.set(part.id, new Set<string>());
    degree.set(part.id, 0);
  }
  for (const mate of state.mates) {
    if (mate.suppressed) continue;
    const aId = mate.a.partId;
    const bId = mate.b.partId;
    if (!neighbours.has(aId) || !neighbours.has(bId)) continue;
    neighbours.get(aId)!.add(bId);
    neighbours.get(bId)!.add(aId);
    degree.set(aId, (degree.get(aId) ?? 0) + 1);
    degree.set(bId, (degree.get(bId) ?? 0) + 1);
  }
  return { neighbours, degree };
}

function pickRoots(state: AssemblyState, graph: ConnectivityGraph): string[] {
  const fixed = state.parts.filter((p) => p.fixed).map((p) => p.id);
  if (fixed.length > 0) return fixed;
  if (state.parts.length === 0) return [];
  // Most-connected part (ties broken by id for determinism).
  let bestId: string | null = null;
  let bestDeg = -1;
  for (const part of state.parts) {
    const d = graph.degree.get(part.id) ?? 0;
    if (d > bestDeg || (d === bestDeg && bestId !== null && part.id < bestId)) {
      bestDeg = d;
      bestId = part.id;
    }
  }
  return bestId ? [bestId] : [];
}

function dfsAssignDepth(
  startId: string,
  graph: ConnectivityGraph,
  depthByPart: Map<string, number>,
  startDepth: number,
): void {
  // Iterative DFS so deep chains don't blow the stack.
  const stack: Array<{ id: string; depth: number }> = [{ id: startId, depth: startDepth }];
  while (stack.length > 0) {
    const { id, depth } = stack.pop()!;
    const existing = depthByPart.get(id);
    if (existing !== undefined && existing <= depth) continue;
    depthByPart.set(id, depth);
    const nbrs = graph.neighbours.get(id);
    if (!nbrs) continue;
    // Determinism: visit neighbours in sorted order.
    const sorted = Array.from(nbrs).sort();
    for (const nbrId of sorted) {
      const nbrDepth = depthByPart.get(nbrId);
      if (nbrDepth === undefined || nbrDepth > depth + 1) {
        stack.push({ id: nbrId, depth: depth + 1 });
      }
    }
  }
}

// ─── internals: small utilities ──────────────────────────────────────────

function safeNormalize(v: Vec3): Vec3 | null {
  const len = lengthOf(v);
  if (len < EPS) return null;
  return scale(v, 1 / len);
}

function otherPart(mate: Mate, partId: string): string | null {
  if (mate.a.partId === partId) return mate.b.partId;
  if (mate.b.partId === partId) return mate.a.partId;
  return null;
}

function neighbourIds(state: AssemblyState, partId: string): string[] {
  const set = new Set<string>();
  for (const mate of state.mates) {
    if (mate.suppressed) continue;
    const other = otherPart(mate, partId);
    if (other) set.add(other);
  }
  return Array.from(set);
}

function getBbox(
  partBboxes: ReadonlyMap<string, AABB> | undefined,
  partId: string,
): AABB {
  return partBboxes?.get(partId) ?? DEFAULT_BBOX;
}

/**
 * Project an AABB onto a unit axis and return the FULL EXTENT (max - min)
 * of the projection. Used as the "natural" explode distance baseline so
 * adjacent parts don't visually clip after the explode shift.
 */
function projectedExtent(bbox: AABB, axis: Vec3): number {
  // For a unit axis u, the projection of a corner c is dot(c, u). For an
  // AABB the min projection is dot(min', u) where min'[k] = min[k] if
  // axis[k] >= 0 else max[k] (and vice versa for max projection). The
  // extent simplifies to:
  //   extent = (max.x - min.x) * |u.x| + (max.y - min.y) * |u.y| + ...
  const dx = bbox.max.x - bbox.min.x;
  const dy = bbox.max.y - bbox.min.y;
  const dz = bbox.max.z - bbox.min.z;
  return dx * Math.abs(axis.x) + dy * Math.abs(axis.y) + dz * Math.abs(axis.z);
}

function indexManualSteps(
  manual: ReadonlyArray<Partial<ExplodeStep>> | undefined,
): Map<string, Partial<ExplodeStep>> {
  const out = new Map<string, Partial<ExplodeStep>>();
  if (!manual) return out;
  for (const entry of manual) {
    if (entry.partId) out.set(entry.partId, entry);
  }
  return out;
}
