/**
 * smartDimension.ts — Smart dimension preview + centerline auto-place
 * + GD&T smart-attach + dimension chain optimizer + hole table generator.
 *
 * Existing `dimXpert.ts` enumerates dimensions for recognized features.
 * This module adds the *productivity layer* SolidWorks ships:
 *
 *   - **Smart dimension preview** — given a user's selection (1 / 2
 *     / 3 entities), auto-pick the right dim type (length / distance /
 *     angle / radius / diameter) + initial placement.
 *   - **Centerline auto-place** — between symmetric features (paired
 *     holes / paired arcs), draw a centerline.
 *   - **GD&T smart attach** — analyze a face's geometry + attach the
 *     most-likely GD&T callout (flatness on plane, perpendicularity
 *     to primary datum, position on hole referenced to A|B|C).
 *   - **Dimension chain optimizer** — given a list of dims along an
 *     axis, decide chain vs baseline based on count + tolerance
 *     accumulation; mark stress points where breaker should split.
 *   - **Hole table generator** — replace N hole callouts with one
 *     compact table (X / Y / Ø / Notes).
 */

import type { GdtCallout } from '../quality/inspectionPlan';

// ── Smart dimension preview ─────────────────────────────────────

export type SelectionEntityKind = 'point' | 'line' | 'circle' | 'arc' | 'plane' | 'edge';

export interface SelectionEntity {
  kind: SelectionEntityKind;
  /** Anchor in sketch / drawing coords (mm). */
  position: [number, number];
  /** For lines/edges: direction unit vector. */
  direction?: [number, number];
  /** For circles/arcs: radius. */
  radiusMm?: number;
  /** For lines/edges: length. */
  lengthMm?: number;
}

export type SmartDimKind = 'linear' | 'angular' | 'radial' | 'diameter' | 'none';

export interface SmartDimPreview {
  kind: SmartDimKind;
  /** Resolved numeric value (mm or deg). */
  value: number;
  /** Suggested placement position on the drawing (mm). */
  placement: [number, number];
  /** Label string. */
  label: string;
  /** Reason for choice — shown as tooltip. */
  reason: string;
}

export function previewSmartDimension(entities: SelectionEntity[]): SmartDimPreview {
  if (entities.length === 0) {
    return { kind: 'none', value: 0, placement: [0, 0], label: '', reason: 'No selection' };
  }
  if (entities.length === 1) {
    const e = entities[0]!;
    if (e.kind === 'circle' && e.radiusMm != null) {
      return {
        kind: 'diameter',
        value: e.radiusMm * 2,
        placement: [e.position[0] + e.radiusMm, e.position[1] + e.radiusMm],
        label: `⌀${(e.radiusMm * 2).toFixed(2)}`,
        reason: 'Single circle → diameter callout',
      };
    }
    if (e.kind === 'arc' && e.radiusMm != null) {
      return {
        kind: 'radial',
        value: e.radiusMm,
        placement: [e.position[0] + e.radiusMm, e.position[1] + e.radiusMm],
        label: `R${e.radiusMm.toFixed(2)}`,
        reason: 'Single arc → radial callout',
      };
    }
    if ((e.kind === 'line' || e.kind === 'edge') && e.lengthMm != null) {
      return {
        kind: 'linear',
        value: e.lengthMm,
        placement: [e.position[0], e.position[1] - 10],
        label: `${e.lengthMm.toFixed(2)}`,
        reason: 'Single line → length callout',
      };
    }
    return { kind: 'none', value: 0, placement: e.position, label: '', reason: 'Selection has no dimension info' };
  }
  if (entities.length === 2) {
    const a = entities[0]!;
    const b = entities[1]!;
    // Two lines/edges → angular.
    if ((a.kind === 'line' || a.kind === 'edge') && (b.kind === 'line' || b.kind === 'edge') && a.direction && b.direction) {
      const dot = a.direction[0] * b.direction[0] + a.direction[1] * b.direction[1];
      const clamped = Math.max(-1, Math.min(1, dot));
      const angle = Math.acos(clamped) * 180 / Math.PI;
      return {
        kind: 'angular',
        value: angle,
        placement: [(a.position[0] + b.position[0]) / 2, (a.position[1] + b.position[1]) / 2],
        label: `${angle.toFixed(2)}°`,
        reason: 'Two lines → angular dimension',
      };
    }
    // Two points → linear distance.
    const dist = Math.hypot(b.position[0] - a.position[0], b.position[1] - a.position[1]);
    return {
      kind: 'linear',
      value: dist,
      placement: [(a.position[0] + b.position[0]) / 2, (a.position[1] + b.position[1]) / 2 - 10],
      label: `${dist.toFixed(2)}`,
      reason: 'Two entities → linear distance',
    };
  }
  // Three entities — angular if all lines, else linear chain.
  return { kind: 'none', value: 0, placement: entities[0]!.position, label: '', reason: 'Ambiguous 3-entity selection' };
}

// ── Centerline auto-place ───────────────────────────────────────

export interface SymmetricPair {
  entityIdA: string;
  entityIdB: string;
  /** Center between the two. */
  centerline: { from: [number, number]; to: [number, number] };
}

/** Find pairs of symmetric features sharing an X-axis or Y-axis. */
export function detectCenterlines(entities: Array<{ id: string; position: [number, number] }>): SymmetricPair[] {
  const out: SymmetricPair[] = [];
  const tolerance = 0.1;
  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      const a = entities[i]!;
      const b = entities[j]!;
      // Mirror about Y-axis (X coords mirror, Y matches).
      if (Math.abs(a.position[0] + b.position[0]) < tolerance && Math.abs(a.position[1] - b.position[1]) < tolerance) {
        const mid = [0, a.position[1]] as [number, number];
        out.push({
          entityIdA: a.id, entityIdB: b.id,
          centerline: { from: [mid[0], mid[1] - 5], to: [mid[0], mid[1] + 5] },
        });
      } else if (Math.abs(a.position[0] - b.position[0]) < tolerance && Math.abs(a.position[1] + b.position[1]) < tolerance) {
        const mid = [a.position[0], 0] as [number, number];
        out.push({
          entityIdA: a.id, entityIdB: b.id,
          centerline: { from: [mid[0] - 5, mid[1]], to: [mid[0] + 5, mid[1]] },
        });
      }
    }
  }
  return out;
}

// ── GD&T smart attach ───────────────────────────────────────────

export type FaceGeometryKind = 'planar' | 'cylindrical' | 'spherical' | 'conical' | 'freeform';

export interface FaceForGdt {
  id: string;
  kind: FaceGeometryKind;
  /** Surface area (mm²). */
  areaMm2: number;
  /** Is this face a datum? */
  isDatum?: boolean;
  /** Primary direction (face normal or cylinder axis). */
  direction: [number, number, number];
  /** Available datums by label. */
}

export interface GdtSuggestion {
  faceId: string;
  callout: GdtCallout;
  toleranceMm: number;
  datumRefs: string[];
  rationale: string;
}

/** Suggest a GD&T callout for each non-datum face. */
export function suggestGdt(faces: FaceForGdt[]): GdtSuggestion[] {
  const datums = faces.filter(f => f.isDatum);
  const datumLabels = datums.map((_d, i) => String.fromCharCode(65 + i));
  const out: GdtSuggestion[] = [];
  for (const face of faces) {
    if (face.isDatum) continue;
    let callout: GdtCallout;
    let tol = 0.1;
    let rationale: string;
    switch (face.kind) {
      case 'planar':
        if (datums.length > 0) {
          // Perpendicular or parallel to primary datum based on direction alignment.
          const primary = datums[0]!;
          const dot = Math.abs(
            face.direction[0] * primary.direction[0]
            + face.direction[1] * primary.direction[1]
            + face.direction[2] * primary.direction[2],
          );
          if (dot < 0.2) {
            callout = 'perpendicularity';
            rationale = 'Planar face perpendicular to primary datum';
          } else if (dot > 0.8) {
            callout = 'parallelism';
            rationale = 'Planar face parallel to primary datum';
          } else {
            callout = 'flatness';
            rationale = 'Planar face with no clear datum relation → form-only';
          }
        } else {
          callout = 'flatness';
          rationale = 'Planar face, no datums yet — form-only';
        }
        tol = face.areaMm2 > 10000 ? 0.2 : 0.05;
        break;
      case 'cylindrical':
        callout = 'cylindricity';
        rationale = 'Cylindrical face → cylindricity form';
        tol = 0.02;
        break;
      case 'spherical':
        callout = 'circularity';
        rationale = 'Spherical face → circularity proxy';
        tol = 0.05;
        break;
      case 'conical':
        callout = 'angularity';
        rationale = 'Conical face → angularity';
        tol = 0.1;
        break;
      case 'freeform':
        callout = 'profile-surface';
        rationale = 'Freeform surface → profile of a surface';
        tol = 0.2;
        break;
    }
    out.push({
      faceId: face.id,
      callout,
      toleranceMm: tol,
      datumRefs: datumLabels.slice(0, 3),
      rationale,
    });
  }
  return out;
}

// ── Dimension chain optimizer ───────────────────────────────────

export type ChainStrategy = 'chain' | 'baseline' | 'mixed';

export interface DimensionPoint {
  /** Position along the chain axis (mm). */
  positionMm: number;
  /** Per-dim tolerance (±mm). */
  toleranceMm: number;
}

export interface ChainOptimization {
  strategy: ChainStrategy;
  /** Total accumulated tolerance (mm). */
  accumulatedTolerance: number;
  /** Number of points where a baseline reset (chain breaker) is recommended. */
  recommendedBreakerCount: number;
  /** Indices of recommended chain breakers. */
  breakerIndices: number[];
}

export function optimizeChain(points: DimensionPoint[], maxAccumMm: number = 0.5): ChainOptimization {
  if (points.length < 2) {
    return { strategy: 'baseline', accumulatedTolerance: 0, recommendedBreakerCount: 0, breakerIndices: [] };
  }
  // Sort by position.
  const sorted = points.slice().sort((a, b) => a.positionMm - b.positionMm);
  // Chain accumulation: RSS of N consecutive tolerances.
  let runningSumSq = 0;
  let chainAccum = 0;
  const breakers: number[] = [];
  for (let i = 0; i < sorted.length; i++) {
    runningSumSq += sorted[i]!.toleranceMm ** 2;
    chainAccum = Math.sqrt(runningSumSq);
    if (chainAccum > maxAccumMm && i < sorted.length - 1) {
      breakers.push(i);
      runningSumSq = 0; // reset
    }
  }
  let strategy: ChainStrategy;
  if (breakers.length === 0 && sorted.length <= 5) strategy = 'chain';
  else if (breakers.length >= sorted.length / 2) strategy = 'baseline';
  else strategy = 'mixed';
  return {
    strategy,
    accumulatedTolerance: chainAccum,
    recommendedBreakerCount: breakers.length,
    breakerIndices: breakers,
  };
}

// ── Hole table generator ────────────────────────────────────────

export interface HoleEntry {
  id: string;
  positionMm: [number, number];
  diameterMm: number;
  depthMm?: number;
  threadId?: string;
}

export interface HoleTable {
  rows: Array<{
    label: string;
    xMm: number;
    yMm: number;
    diameterMm: number;
    notes: string;
  }>;
  /** Compact placement on the sheet (mm). */
  placement: [number, number];
}

/** Generate a hole table from a hole list, alphabetic labeling (A1, A2…). */
export function generateHoleTable(holes: HoleEntry[], placement: [number, number] = [200, 200]): HoleTable {
  // Group by diameter to share the prefix letter.
  const byDia = new Map<number, HoleEntry[]>();
  for (const h of holes) {
    const key = Math.round(h.diameterMm * 100) / 100;
    if (!byDia.has(key)) byDia.set(key, []);
    byDia.get(key)!.push(h);
  }
  const rows: HoleTable['rows'] = [];
  let letterCode = 65; // 'A'
  for (const [dia, group] of Array.from(byDia.entries()).sort((a, b) => a[0] - b[0])) {
    const letter = String.fromCharCode(letterCode++);
    for (let i = 0; i < group.length; i++) {
      const h = group[i]!;
      const notes: string[] = [];
      if (h.threadId) notes.push(h.threadId);
      if (h.depthMm != null) notes.push(`▽${h.depthMm.toFixed(1)}`);
      rows.push({
        label: `${letter}${i + 1}`,
        xMm: h.positionMm[0],
        yMm: h.positionMm[1],
        diameterMm: dia,
        notes: notes.join(' '),
      });
    }
  }
  return { rows, placement };
}
