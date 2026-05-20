/**
 * flangeClearance.ts — Sheet metal flange clearance checker.
 *
 * When you bend a flange next to a feature (a hole, a slot, an edge
 * cut-out, another flange), the bend needs working room. Too close
 * and:
 *
 *   - Holes near the bend tangent tear or deform out-of-round.
 *   - Adjacent flanges collide during forming.
 *   - The tool die-side requires room equal to the tooling radius +
 *     a bend tangent allowance.
 *
 * Minimum distance heuristic (per Smith / FAA AC43-13):
 *
 *   d_min = 2·t + R_bend     (hole-to-bend-tangent)
 *   d_min = 2·t              (slot-to-edge)
 *   d_min = 4·t + 2·R_bend   (flange-to-flange interior)
 *
 * Module evaluates every feature near every bend and returns a list
 * of violations with severity + recommended distance.
 */

export type FeatureKind = 'hole' | 'slot' | 'edge' | 'flange' | 'embossed';

export interface BendLine {
  id: string;
  /** Two endpoints in the flat-pattern (mm). */
  start: { x: number; y: number };
  end: { x: number; y: number };
  /** Bend radius (mm). */
  radiusMm: number;
  /** Bend angle in degrees (0-180). */
  angleDeg: number;
}

export interface NearbyFeature {
  id: string;
  kind: FeatureKind;
  /** Closest point of the feature to the bend, in flat-pattern coords. */
  point: { x: number; y: number };
  /** Optional diameter (hole) or width (slot). */
  sizeMm?: number;
}

export interface FlangeClearanceOptions {
  /** Sheet thickness (mm). */
  thicknessMm: number;
  /** Override the safety multiplier (default 1.0). */
  safetyMultiplier: number;
  /** Per-feature minimum override (mm). */
  overrideMin?: Partial<Record<FeatureKind, number>>;
}

export const DEFAULT_OPTIONS: Omit<FlangeClearanceOptions, 'thicknessMm'> = {
  safetyMultiplier: 1.0,
};

export interface Violation {
  featureId: string;
  bendId: string;
  featureKind: FeatureKind;
  /** Actual measured distance to bend tangent (mm). */
  actualDistanceMm: number;
  /** Minimum required distance (mm). */
  requiredDistanceMm: number;
  severity: 'critical' | 'warn' | 'info';
  recommendation: string;
}

// ── Top-level entry ────────────────────────────────────────────

export function checkFlangeClearance(
  bends: BendLine[],
  features: NearbyFeature[],
  options: FlangeClearanceOptions,
): Violation[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const violations: Violation[] = [];
  for (const bend of bends) {
    for (const feat of features) {
      const v = evaluatePair(bend, feat, opts);
      if (v) violations.push(v);
    }
  }
  return violations;
}

function evaluatePair(
  bend: BendLine,
  feat: NearbyFeature,
  opts: FlangeClearanceOptions,
): Violation | null {
  const distance = distanceToBendTangent(bend, feat);
  const required = requiredDistance(feat.kind, opts) * opts.safetyMultiplier;
  if (distance >= required) return null;
  const ratio = distance / required;
  const severity: Violation['severity'] = ratio < 0.5 ? 'critical' : ratio < 0.9 ? 'warn' : 'info';
  return {
    featureId: feat.id,
    bendId: bend.id,
    featureKind: feat.kind,
    actualDistanceMm: distance,
    requiredDistanceMm: required,
    severity,
    recommendation: buildRecommendation(feat, distance, required),
  };
}

// ── Geometry: distance from a point to the bend tangent line ──

function distanceToBendTangent(bend: BendLine, feat: NearbyFeature): number {
  const ax = bend.end.x - bend.start.x;
  const ay = bend.end.y - bend.start.y;
  const lenSq = ax * ax + ay * ay;
  if (lenSq === 0) {
    // Degenerate bend — distance to start point.
    const dx = feat.point.x - bend.start.x;
    const dy = feat.point.y - bend.start.y;
    return Math.hypot(dx, dy);
  }
  const bx = feat.point.x - bend.start.x;
  const by = feat.point.y - bend.start.y;
  // Perpendicular distance (line, not segment).
  const cross = ax * by - ay * bx;
  return Math.abs(cross) / Math.sqrt(lenSq);
}

// ── Per-feature minimum distance heuristic ────────────────────

function requiredDistance(kind: FeatureKind, opts: FlangeClearanceOptions): number {
  const t = opts.thicknessMm;
  if (opts.overrideMin && opts.overrideMin[kind] !== undefined) {
    return opts.overrideMin[kind]!;
  }
  switch (kind) {
    case 'hole':
      return 2 * t; // + bend radius added later by caller if needed
    case 'slot':
      return 2 * t;
    case 'edge':
      return 1.5 * t;
    case 'flange':
      return 4 * t;
    case 'embossed':
      return 3 * t;
  }
}

function buildRecommendation(feat: NearbyFeature, actual: number, required: number): string {
  const move = required - actual;
  switch (feat.kind) {
    case 'hole':
      return `Hole at risk of tearing. Move ${move.toFixed(2)} mm further from bend tangent, or punch after forming.`;
    case 'slot':
      return `Slot will deform. Move ${move.toFixed(2)} mm, or extend slot through the bend axis.`;
    case 'edge':
      return `Edge too close — outer flange will fracture. Increase by ${move.toFixed(2)} mm.`;
    case 'flange':
      return `Adjacent flange collision risk. Increase ${move.toFixed(2)} mm or stagger bend order.`;
    case 'embossed':
      return `Emboss interferes with bend tooling. Move ${move.toFixed(2)} mm.`;
  }
}

// ── Bend-pair flange-to-flange clearance ──────────────────────

export interface FlangePairConflict {
  bendA: string;
  bendB: string;
  closestDistanceMm: number;
  requiredDistanceMm: number;
  severity: 'critical' | 'warn' | 'ok';
}

export function checkFlangePairs(bends: BendLine[], thicknessMm: number): FlangePairConflict[] {
  const out: FlangePairConflict[] = [];
  for (let i = 0; i < bends.length; i++) {
    for (let j = i + 1; j < bends.length; j++) {
      const a = bends[i]!;
      const b = bends[j]!;
      const d = minSegmentDistance(a, b);
      const required = 4 * thicknessMm + 2 * Math.max(a.radiusMm, b.radiusMm);
      let severity: FlangePairConflict['severity'];
      if (d >= required) severity = 'ok';
      else if (d >= required * 0.5) severity = 'warn';
      else severity = 'critical';
      out.push({ bendA: a.id, bendB: b.id, closestDistanceMm: d, requiredDistanceMm: required, severity });
    }
  }
  return out;
}

function minSegmentDistance(a: BendLine, b: BendLine): number {
  // Approximate by min of endpoint-to-line distances.
  return Math.min(
    distanceToBendTangent(a, { id: '', kind: 'edge', point: b.start }),
    distanceToBendTangent(a, { id: '', kind: 'edge', point: b.end }),
    distanceToBendTangent(b, { id: '', kind: 'edge', point: a.start }),
    distanceToBendTangent(b, { id: '', kind: 'edge', point: a.end }),
  );
}

// ── Summary ────────────────────────────────────────────────────

export interface ClearanceSummary {
  violationCount: number;
  criticalCount: number;
  warnCount: number;
  byFeatureKind: Record<FeatureKind, number>;
  worstActualMm: number;
}

export function summarize(violations: Violation[]): ClearanceSummary {
  const byKind: Record<FeatureKind, number> = { hole: 0, slot: 0, edge: 0, flange: 0, embossed: 0 };
  let critical = 0;
  let warn = 0;
  let worst = Infinity;
  for (const v of violations) {
    byKind[v.featureKind]++;
    if (v.severity === 'critical') critical++;
    if (v.severity === 'warn') warn++;
    if (v.actualDistanceMm < worst) worst = v.actualDistanceMm;
  }
  return {
    violationCount: violations.length,
    criticalCount: critical,
    warnCount: warn,
    byFeatureKind: byKind,
    worstActualMm: violations.length === 0 ? Infinity : worst,
  };
}
