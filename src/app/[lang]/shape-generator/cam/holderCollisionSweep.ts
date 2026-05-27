/**
 * holderCollisionSweep.ts — Sweep the toolholder envelope along the
 * toolpath to detect collisions with the workpiece.
 *
 * The toolholder is much wider than the cutting tool. Long-overhang
 * tools have the same diameter holder, but they sit above the
 * cutting flute, so they can crash into:
 *
 *   - Tall stock walls.
 *   - Workholding (clamp, vise).
 *   - Previously machined wall edges.
 *
 * Module models the holder as a tapered cylinder (Dᵢ_top × Dᵢ_bot ×
 * H) and sweeps it along the path. Reports the first sample position
 * where any holder envelope point comes within tolerance of the
 * workpiece bounding-box.
 *
 * Workpiece is provided as axis-aligned bounding box(es).
 */

export interface Vec3 { x: number; y: number; z: number }

export interface HolderProfile {
  /** Diameter at the bottom of the holder (top of the cutting flute). */
  bottomDiameterMm: number;
  /** Diameter at the top of the holder. */
  topDiameterMm: number;
  /** Height (mm) of the holder. */
  heightMm: number;
  /** Z offset above the tool tip (= stickout + flute length). */
  zOffsetFromTipMm: number;
}

export interface AABB {
  min: Vec3;
  max: Vec3;
}

export interface SweepOptions {
  /** Number of intermediate samples between path points. */
  samplesPerSegment: number;
  /** Required clearance (mm). */
  clearanceMm: number;
}

export const DEFAULT_OPTIONS: SweepOptions = {
  samplesPerSegment: 5,
  clearanceMm: 1.0,
};

export type CollisionKind = 'workpiece' | 'fixture' | 'wall';

export interface CollisionEvent {
  pathIndex: number;
  position: Vec3;
  obstacleAabbId: string;
  /** How far inside the clearance the holder is. */
  penetrationMm: number;
  kind: CollisionKind;
}

export interface SweepResult {
  events: CollisionEvent[];
  totalSamplesChecked: number;
  worstPenetrationMm: number;
}

// ── Top-level entry ────────────────────────────────────────────

export function sweepHolder(
  path: Vec3[],
  holder: HolderProfile,
  obstacles: { id: string; aabb: AABB; kind: CollisionKind }[],
  options: Partial<SweepOptions> = {},
): SweepResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const events: CollisionEvent[] = [];
  let samples = 0;
  let worst = 0;
  if (path.length < 1) {
    return { events, totalSamplesChecked: 0, worstPenetrationMm: 0 };
  }
  for (let i = 0; i < path.length; i++) {
    const point = path[i]!;
    const inflated = inflateHolderEnvelope(point, holder, opts.clearanceMm);
    samples++;
    for (const obs of obstacles) {
      const pen = aabbPenetration(inflated, obs.aabb);
      if (pen > 0) {
        events.push({ pathIndex: i, position: point, obstacleAabbId: obs.id, penetrationMm: pen, kind: obs.kind });
        if (pen > worst) worst = pen;
      }
    }
    // Intermediate samples.
    if (i + 1 < path.length) {
      const next = path[i + 1]!;
      for (let s = 1; s < opts.samplesPerSegment; s++) {
        const t = s / opts.samplesPerSegment;
        const interp: Vec3 = {
          x: point.x + (next.x - point.x) * t,
          y: point.y + (next.y - point.y) * t,
          z: point.z + (next.z - point.z) * t,
        };
        samples++;
        const inflatedI = inflateHolderEnvelope(interp, holder, opts.clearanceMm);
        for (const obs of obstacles) {
          const pen = aabbPenetration(inflatedI, obs.aabb);
          if (pen > 0) {
            events.push({ pathIndex: i + s / opts.samplesPerSegment, position: interp, obstacleAabbId: obs.id, penetrationMm: pen, kind: obs.kind });
            if (pen > worst) worst = pen;
          }
        }
      }
    }
  }
  return { events, totalSamplesChecked: samples, worstPenetrationMm: worst };
}

// ── Holder envelope AABB ──────────────────────────────────────

function inflateHolderEnvelope(tip: Vec3, holder: HolderProfile, clearance: number): AABB {
  const rTop = holder.topDiameterMm / 2 + clearance;
  const rBot = holder.bottomDiameterMm / 2 + clearance;
  const r = Math.max(rTop, rBot);
  const zBottom = tip.z + holder.zOffsetFromTipMm;
  const zTop = zBottom + holder.heightMm;
  return {
    min: { x: tip.x - r, y: tip.y - r, z: zBottom },
    max: { x: tip.x + r, y: tip.y + r, z: zTop },
  };
}

function aabbPenetration(a: AABB, b: AABB): number {
  const overlapX = Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x);
  const overlapY = Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y);
  const overlapZ = Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z);
  if (overlapX <= 0 || overlapY <= 0 || overlapZ <= 0) return 0;
  return Math.min(overlapX, overlapY, overlapZ);
}

// ── Suggest fix ──────────────────────────────────────────────

export interface CollisionFix {
  recommendedStickoutMm: number;
  recommendedHolderTopDiaMm: number;
  rationale: string;
}

export function recommendFix(result: SweepResult, holder: HolderProfile): CollisionFix | null {
  if (result.events.length === 0) return null;
  const newStickout = holder.zOffsetFromTipMm + result.worstPenetrationMm + 2;
  const newDia = holder.topDiameterMm * 0.8;
  return {
    recommendedStickoutMm: newStickout,
    recommendedHolderTopDiaMm: newDia,
    rationale: `Worst penetration ${result.worstPenetrationMm.toFixed(2)} mm. Extend stickout by that + 2 mm safety margin or use a slimmer holder.`,
  };
}

// ── Summary ────────────────────────────────────────────────────

export interface SweepSummary {
  eventCount: number;
  worstPenetrationMm: number;
  byKind: Record<CollisionKind, number>;
  samplesChecked: number;
}

export function summarize(result: SweepResult): SweepSummary {
  const byKind: Record<CollisionKind, number> = { workpiece: 0, fixture: 0, wall: 0 };
  for (const e of result.events) byKind[e.kind]++;
  return {
    eventCount: result.events.length,
    worstPenetrationMm: result.worstPenetrationMm,
    byKind,
    samplesChecked: result.totalSamplesChecked,
  };
}
