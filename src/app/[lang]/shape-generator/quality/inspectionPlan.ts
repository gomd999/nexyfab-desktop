/**
 * inspectionPlan.ts — Generate a CMM inspection sequence from a GD&T tree.
 *
 * When a part ships, QC takes the drawing's tolerance + GD&T callouts
 * and runs them on a CMM (or hand gauges). Today operators write the
 * inspection program by hand. This module generates an ordered plan:
 *
 *   1. Collect every callout from the drawing (positional / form /
 *      orientation / size).
 *   2. Resolve datum dependencies — feature B that's "perpendicular
 *      to A" must be measured AFTER A is set as a datum.
 *   3. Pick a measurement strategy per feature type (face vs hole vs
 *      slot vs cylinder), sized to the feature.
 *   4. Order operations to minimize fixture changes — group by which
 *      face the CMM probe enters from.
 *   5. Estimate operation time so the user gets a total-inspection-
 *      time number for their quote.
 *
 * Output: a `Plan` with ordered `Operation[]` plus a summary.
 */

export type GdtCallout =
  | 'flatness'
  | 'straightness'
  | 'circularity'
  | 'cylindricity'
  | 'perpendicularity'
  | 'parallelism'
  | 'angularity'
  | 'concentricity'
  | 'symmetry'
  | 'position'
  | 'profile-line'
  | 'profile-surface'
  | 'runout-circular'
  | 'runout-total';

export type FeatureType = 'plane' | 'cylinder' | 'cone' | 'sphere' | 'slot' | 'hole';

export interface DrawingFeature {
  id: string;
  /** Display name (e.g. "Top face", "Hole H1"). */
  name: string;
  type: FeatureType;
  /** Estimated principal size — diameter for round, length for slots, area for planes (mm). */
  principalSizeMm: number;
  /** True when this feature is referenced by callouts as a datum. */
  isDatum?: boolean;
  /** Datum label (A, B, C, ...). */
  datumLabel?: string;
}

export interface GdtSpec {
  /** Stable id. */
  id: string;
  /** Feature this callout is applied to. */
  featureId: string;
  callout: GdtCallout;
  /** Tolerance value (mm). */
  toleranceMm: number;
  /** Datum references (e.g. ['A', 'B']). */
  datumRefs?: string[];
}

export type ProbeAxis = 'x' | 'y' | 'z' | '-x' | '-y' | '-z';

export interface InspectionOperation {
  /** Sequence number. */
  sequence: number;
  featureId: string;
  featureName: string;
  callout: GdtCallout | 'datum-set';
  toleranceMm: number | null;
  /** Number of probe touches recommended. */
  touchCount: number;
  /** Probe approach axis. */
  probeAxis: ProbeAxis;
  /** Estimated time (seconds). */
  timeSec: number;
  /** Notes for the operator. */
  note?: string;
}

export interface InspectionPlan {
  operations: InspectionOperation[];
  /** Total inspection time (seconds). */
  totalTimeSec: number;
  /** Total touch count. */
  totalTouches: number;
  /** Distinct datum-setup actions. */
  datumSetupCount: number;
  /** Warnings the user should resolve. */
  warnings: string[];
}

// ── Touch-count heuristic ────────────────────────────────────────

/** Min touches per feature type for a useful fit. */
const MIN_TOUCHES: Record<FeatureType, number> = {
  plane: 3,
  cylinder: 6,
  cone: 8,
  sphere: 4,
  slot: 6,
  hole: 4,
};

/** Bonus touches for tight tolerances + large features. */
function touchesFor(feature: DrawingFeature, callout: GdtCallout | 'datum-set', toleranceMm: number | null): number {
  let base = MIN_TOUCHES[feature.type];
  // Size scaling: larger features get more touches.
  if (feature.principalSizeMm > 50) base += 2;
  if (feature.principalSizeMm > 200) base += 4;
  // Tolerance scaling: tighter tol = more touches.
  if (toleranceMm != null && toleranceMm < 0.01) base += 4;
  else if (toleranceMm != null && toleranceMm < 0.05) base += 2;
  // Callout-specific bumps.
  if (callout === 'cylindricity' || callout === 'profile-surface') base += 4;
  if (callout === 'datum-set') base = Math.max(base, MIN_TOUCHES[feature.type]);
  return base;
}

function probeAxisFor(feature: DrawingFeature): ProbeAxis {
  // Without geometry, default by feature type. Real impl would read
  // surface normals from the CAD.
  switch (feature.type) {
    case 'plane': return 'z';
    case 'cylinder': return 'x';
    case 'cone': return 'x';
    case 'sphere': return 'z';
    case 'slot': return 'z';
    case 'hole': return 'z';
  }
}

function timeForTouches(touchCount: number): number {
  // Empirical: 2 sec per touch + 3 sec setup.
  return 3 + touchCount * 2;
}

// ── Plan generator ───────────────────────────────────────────────

export function generateInspectionPlan(
  features: DrawingFeature[],
  specs: GdtSpec[],
): InspectionPlan {
  const operations: InspectionOperation[] = [];
  const warnings: string[] = [];
  const featuresById = new Map(features.map(f => [f.id, f]));

  // Step 1: datum setup ops first, in alphabetical label order.
  const datumFeatures = features
    .filter(f => f.isDatum)
    .sort((a, b) => (a.datumLabel ?? '').localeCompare(b.datumLabel ?? ''));

  let seq = 1;
  for (const datum of datumFeatures) {
    const touches = touchesFor(datum, 'datum-set', null);
    operations.push({
      sequence: seq++,
      featureId: datum.id,
      featureName: datum.name,
      callout: 'datum-set',
      toleranceMm: null,
      touchCount: touches,
      probeAxis: probeAxisFor(datum),
      timeSec: timeForTouches(touches),
      note: `Establish datum ${datum.datumLabel ?? ''}`.trim(),
    });
  }
  const datumSetupCount = datumFeatures.length;

  // Step 2: GD&T callouts. Sort by datum-dependency (callouts that
  // reference datums come after those that don't), then by tolerance
  // (tightest first for setup stability).
  const sortedSpecs = specs.slice().sort((a, b) => {
    const aHasDatum = (a.datumRefs?.length ?? 0) > 0 ? 1 : 0;
    const bHasDatum = (b.datumRefs?.length ?? 0) > 0 ? 1 : 0;
    if (aHasDatum !== bHasDatum) return aHasDatum - bHasDatum;
    return a.toleranceMm - b.toleranceMm;
  });

  for (const spec of sortedSpecs) {
    const feature = featuresById.get(spec.featureId);
    if (!feature) {
      warnings.push(`Callout ${spec.id} references unknown feature ${spec.featureId}`);
      continue;
    }
    // Check datum availability.
    if (spec.datumRefs) {
      const availableDatums = new Set(datumFeatures.map(d => d.datumLabel).filter(Boolean) as string[]);
      const missing = spec.datumRefs.filter(d => !availableDatums.has(d));
      if (missing.length > 0) {
        warnings.push(`Callout ${spec.id} references missing datum(s): ${missing.join(', ')}`);
      }
    }
    const touches = touchesFor(feature, spec.callout, spec.toleranceMm);
    operations.push({
      sequence: seq++,
      featureId: feature.id,
      featureName: feature.name,
      callout: spec.callout,
      toleranceMm: spec.toleranceMm,
      touchCount: touches,
      probeAxis: probeAxisFor(feature),
      timeSec: timeForTouches(touches),
      note: spec.datumRefs?.length
        ? `Reference datum ${spec.datumRefs.join(', ')}`
        : undefined,
    });
  }

  // Step 3: group ops by probe axis to minimize fixture changes.
  // Keep datum-set ops first, then re-sort the GD&T ops by axis.
  const datumOps = operations.filter(o => o.callout === 'datum-set');
  const gdtOps = operations.filter(o => o.callout !== 'datum-set')
    .sort((a, b) => a.probeAxis.localeCompare(b.probeAxis));
  const finalOps = [...datumOps, ...gdtOps].map((o, i) => ({ ...o, sequence: i + 1 }));

  const totalTime = finalOps.reduce((s, o) => s + o.timeSec, 0);
  const totalTouches = finalOps.reduce((s, o) => s + o.touchCount, 0);

  return {
    operations: finalOps,
    totalTimeSec: totalTime,
    totalTouches,
    datumSetupCount,
    warnings,
  };
}

/** Estimate cost from a plan. CMM rate typical $80/hr. */
export function estimateInspectionCostUsd(plan: InspectionPlan, hourlyRateUsd: number = 80): number {
  const hours = plan.totalTimeSec / 3600;
  return hours * hourlyRateUsd;
}
