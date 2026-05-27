/**
 * bodyManagement.ts — Multi-body bookkeeping + combine / split.
 *
 * SolidWorks lets a single part contain multiple solid + surface
 * bodies. The "Bodies" folder in the feature tree shows them; you can
 * toggle visibility, rename, combine (union/intersect/subtract), or
 * split one body into N.
 *
 * This module is the *registry* + *operations* layer. The Boolean
 * math itself lives in `meshBoolean` / `boolean`; this module
 * manages the body list lifecycle.
 */

import type { Vec3 } from './referenceGeometry';

export type BodyKind = 'solid' | 'surface' | 'sheet' | 'wire';

export interface Body {
  id: string;
  name: string;
  kind: BodyKind;
  /** Volume (mm³). 0 for surface/sheet/wire. */
  volumeMm3: number;
  /** Surface area (mm²). */
  surfaceAreaMm2: number;
  /** Bounding box. */
  bbox: { min: Vec3; max: Vec3 };
  /** True when shown in viewport. */
  visible: boolean;
  /** Optional material id. */
  materialId?: string;
  /** Optional color (hex). */
  color?: string;
  /** Lock state — locked bodies can't be edited. */
  locked: boolean;
  /** Tag list. */
  tags: string[];
}

export interface BodyRegistry {
  bodies: Map<string, Body>;
  /** Insertion order. */
  order: string[];
}

export function createRegistry(): BodyRegistry {
  return { bodies: new Map(), order: [] };
}

export function addBody(registry: BodyRegistry, body: Body): void {
  registry.bodies.set(body.id, body);
  if (!registry.order.includes(body.id)) registry.order.push(body.id);
}

export function removeBody(registry: BodyRegistry, id: string): boolean {
  const removed = registry.bodies.delete(id);
  if (removed) {
    const idx = registry.order.indexOf(id);
    if (idx >= 0) registry.order.splice(idx, 1);
  }
  return removed;
}

export function getBody(registry: BodyRegistry, id: string): Body | undefined {
  return registry.bodies.get(id);
}

export function listBodies(registry: BodyRegistry): Body[] {
  return registry.order.map(id => registry.bodies.get(id)!).filter(Boolean);
}

export function listByKind(registry: BodyRegistry, kind: BodyKind): Body[] {
  return listBodies(registry).filter(b => b.kind === kind);
}

export function listByTag(registry: BodyRegistry, tag: string): Body[] {
  return listBodies(registry).filter(b => b.tags.includes(tag));
}

// ── Visibility + locking ────────────────────────────────────────

export function setVisible(registry: BodyRegistry, id: string, visible: boolean): boolean {
  const body = registry.bodies.get(id);
  if (!body) return false;
  body.visible = visible;
  return true;
}

export function toggleVisible(registry: BodyRegistry, id: string): boolean {
  const body = registry.bodies.get(id);
  if (!body) return false;
  body.visible = !body.visible;
  return body.visible;
}

export function setLocked(registry: BodyRegistry, id: string, locked: boolean): boolean {
  const body = registry.bodies.get(id);
  if (!body) return false;
  body.locked = locked;
  return true;
}

// ── Reorder ─────────────────────────────────────────────────────

export function reorder(registry: BodyRegistry, id: string, toIndex: number): boolean {
  const fromIndex = registry.order.indexOf(id);
  if (fromIndex < 0) return false;
  registry.order.splice(fromIndex, 1);
  registry.order.splice(Math.max(0, Math.min(registry.order.length, toIndex)), 0, id);
  return true;
}

// ── Combine operations ──────────────────────────────────────────

export type CombineOp = 'union' | 'subtract' | 'intersect';

export interface CombineResult {
  /** New body id created by the combine. */
  resultId: string;
  /** Bodies consumed by the operation. */
  consumedIds: string[];
  /** Operation performed. */
  op: CombineOp;
  /** Estimated result volume. */
  estimatedVolumeMm3: number;
}

/** Estimate result volume without running the actual CSG. */
export function estimateCombineVolume(
  bodies: Body[],
  op: CombineOp,
): number {
  if (bodies.length === 0) return 0;
  switch (op) {
    case 'union': {
      // Lower bound: max single volume. Upper bound: sum. Estimate sum × 0.85.
      return bodies.reduce((s, b) => s + b.volumeMm3, 0) * 0.85;
    }
    case 'subtract': {
      const target = bodies[0]!;
      const toolVolume = bodies.slice(1).reduce((s, b) => s + b.volumeMm3, 0);
      return Math.max(0, target.volumeMm3 - toolVolume * 0.7);
    }
    case 'intersect': {
      return Math.min(...bodies.map(b => b.volumeMm3)) * 0.5;
    }
  }
}

/** Build a CombineResult descriptor (preview). Caller runs the CSG
 *  separately + updates the registry with the actual result mesh. */
export function planCombine(
  registry: BodyRegistry,
  ids: string[],
  op: CombineOp,
): CombineResult | null {
  if (ids.length < 2) return null;
  const bodies = ids.map(id => registry.bodies.get(id)).filter((b): b is Body => b != null);
  if (bodies.length !== ids.length) return null;
  if (bodies.some(b => b.locked)) return null;
  const estimated = estimateCombineVolume(bodies, op);
  return {
    resultId: `${op}-${ids.join('-')}-${Date.now().toString(36)}`,
    consumedIds: ids,
    op,
    estimatedVolumeMm3: estimated,
  };
}

// ── Split body ──────────────────────────────────────────────────

export interface SplitPlan {
  /** Source body id. */
  sourceId: string;
  /** Cutting plane (point + normal). */
  cutPlane: { point: Vec3; normal: Vec3 };
  /** Whether to keep both halves (true) or discard the negative half. */
  keepBoth: boolean;
}

export interface SplitResult {
  positiveBodyId: string;
  negativeBodyId: string | null;
  /** Estimated volume of each half. */
  positiveVolumeMm3: number;
  negativeVolumeMm3: number;
}

/** Plan a body split. The 50/50 estimate is rough; caller runs the
 *  actual CSG to get exact values. */
export function planSplit(registry: BodyRegistry, plan: SplitPlan): SplitResult | null {
  const source = registry.bodies.get(plan.sourceId);
  if (!source) return null;
  if (source.locked) return null;
  // Estimate: cut plane through centroid → 50/50.
  const cx = (source.bbox.min[0] + source.bbox.max[0]) / 2;
  const cy = (source.bbox.min[1] + source.bbox.max[1]) / 2;
  const cz = (source.bbox.min[2] + source.bbox.max[2]) / 2;
  const planeDot = (cx - plan.cutPlane.point[0]) * plan.cutPlane.normal[0]
                 + (cy - plan.cutPlane.point[1]) * plan.cutPlane.normal[1]
                 + (cz - plan.cutPlane.point[2]) * plan.cutPlane.normal[2];
  // Crude: distance / bbox-extent gives a ratio.
  const bboxExtent = Math.hypot(
    source.bbox.max[0] - source.bbox.min[0],
    source.bbox.max[1] - source.bbox.min[1],
    source.bbox.max[2] - source.bbox.min[2],
  );
  const ratio = bboxExtent > 0 ? Math.max(0.1, Math.min(0.9, 0.5 + planeDot / bboxExtent)) : 0.5;
  return {
    positiveBodyId: `${plan.sourceId}-pos-${Date.now().toString(36)}`,
    negativeBodyId: plan.keepBoth ? `${plan.sourceId}-neg-${Date.now().toString(36)}` : null,
    positiveVolumeMm3: source.volumeMm3 * ratio,
    negativeVolumeMm3: source.volumeMm3 * (1 - ratio),
  };
}

// ── Summary ─────────────────────────────────────────────────────

export interface RegistrySummary {
  bodyCount: number;
  totalVolumeMm3: number;
  totalAreaMm2: number;
  byKind: Record<BodyKind, number>;
  visibleCount: number;
  lockedCount: number;
}

export function summarizeRegistry(registry: BodyRegistry): RegistrySummary {
  const all = listBodies(registry);
  const byKind: Record<BodyKind, number> = { solid: 0, surface: 0, sheet: 0, wire: 0 };
  let totalVol = 0;
  let totalArea = 0;
  let visibleCount = 0;
  let lockedCount = 0;
  for (const b of all) {
    byKind[b.kind]++;
    totalVol += b.volumeMm3;
    totalArea += b.surfaceAreaMm2;
    if (b.visible) visibleCount++;
    if (b.locked) lockedCount++;
  }
  return {
    bodyCount: all.length,
    totalVolumeMm3: totalVol,
    totalAreaMm2: totalArea,
    byKind,
    visibleCount,
    lockedCount,
  };
}
