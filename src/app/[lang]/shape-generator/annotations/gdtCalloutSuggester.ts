/**
 * gdtCalloutSuggester.ts — Suggest GD&T callouts from analyzed geometry.
 *
 * `gdtAutoMeasure.ts` runs measurements (flatness, parallelism, ...)
 * but doesn't suggest *which* callouts a designer should add. This
 * module operates on a higher abstraction: given a list of recognized
 * features (planes, cylinders, holes, hole patterns), it suggests
 * the most common GD&T callouts a draftsman would add.
 *
 * Suggestion rules (a subset of common practice):
 *
 *   1. **Datum candidates** — bottom-most large planar face = A,
 *      then a perpendicular planar face = B, then another = C.
 *   2. **Position tolerance on hole patterns** — every hole referenced
 *      by mounting screws gets `⌖ ⌀0.1 Ⓜ A Ⓜ B C`.
 *   3. **Cylindricity on shafts** — every cylindrical face with L/D > 1.
 *   4. **Parallelism on opposite planar faces** — two faces with
 *      opposite normals get `∥ 0.05 A`.
 *   5. **Perpendicularity on mating faces** — non-parallel face pairs
 *      get `⊥ 0.05 A`.
 *   6. **Profile on freeform faces** — surface profile `∪ 0.2 A B C`.
 *
 * Output: a list of `SuggestedCallout` entries with confidence (0..1).
 * Confidence drives UI sort order — "obvious" callouts first.
 */

export type GdtSymbol =
  | 'position' | 'flatness' | 'parallelism' | 'perpendicularity'
  | 'concentricity' | 'cylindricity' | 'circularity'
  | 'profile-surface' | 'profile-line' | 'runout' | 'total-runout';

export interface AnalyzedFeature {
  id: string;
  kind: 'planar' | 'cylindrical' | 'conical' | 'toroidal' | 'spherical' | 'freeform';
  /** Area in mm². */
  areaMm2: number;
  /** Surface normal (for planar) or axis (for cyl/conic). */
  direction: [number, number, number];
  /** Position (centroid or axis origin). */
  position: [number, number, number];
  /** Radius (cyl/sphere/torus) or 0 for planar. */
  radiusMm?: number;
  /** Cylinder length (axial extent). */
  lengthMm?: number;
  /** Hole pattern membership — share an id if these holes form a pattern. */
  patternId?: string;
}

export interface SuggestedCallout {
  /** Feature id the callout applies to. */
  featureId: string;
  symbol: GdtSymbol;
  /** Tolerance value (mm). */
  toleranceMm: number;
  /** Datum references. */
  datumRefs: string[];
  /** Material-condition modifiers per datum + on the feature. */
  modifiers: {
    feature?: 'MMC' | 'LMC' | 'RFS';
    datums?: Array<{ datum: string; modifier: 'MMC' | 'LMC' | 'RFS' }>;
  };
  /** Confidence in this suggestion (0..1). */
  confidence: number;
  /** Human-readable reason. */
  reason: string;
}

export interface DatumAssignment {
  featureId: string;
  letter: 'A' | 'B' | 'C';
}

export interface SuggestionResult {
  /** Suggested datum primaries / secondaries / tertiaries. */
  datums: DatumAssignment[];
  /** Suggested feature-control-frame callouts. */
  callouts: SuggestedCallout[];
  /** Coverage: % of features with at least one suggestion. */
  coverageFraction: number;
}

// ── Top-level entry ─────────────────────────────────────────────

export function suggestGdtCallouts(features: AnalyzedFeature[]): SuggestionResult {
  const datums = pickDatumCandidates(features);
  const datumLetters = new Map(datums.map(d => [d.featureId, d.letter]));

  const callouts: SuggestedCallout[] = [];

  // 1. Flatness on each datum plane.
  for (const d of datums) {
    callouts.push({
      featureId: d.featureId,
      symbol: 'flatness',
      toleranceMm: 0.05,
      datumRefs: [],
      modifiers: {},
      confidence: 0.95,
      reason: `Flatness on datum ${d.letter}`,
    });
  }

  // 2. Position tolerance on hole patterns.
  const patternGroups = groupBy(features.filter(f => f.patternId), f => f.patternId!);
  for (const [_pid, holes] of patternGroups) {
    if (holes.length < 2) continue;
    for (const h of holes) {
      callouts.push({
        featureId: h.id,
        symbol: 'position',
        toleranceMm: 0.1,
        datumRefs: datums.map(d => d.letter),
        modifiers: {
          feature: 'MMC',
          datums: datums.length > 0 ? [{ datum: datums[0]!.letter, modifier: 'MMC' }] : [],
        },
        confidence: 0.85,
        reason: 'Pattern of holes — position tolerance with bonus',
      });
    }
  }

  // 3. Cylindricity on long shafts (L/D > 1).
  for (const f of features) {
    if (f.kind !== 'cylindrical' || !f.radiusMm || !f.lengthMm) continue;
    const dia = 2 * f.radiusMm;
    if (dia === 0) continue;
    if (f.lengthMm / dia > 1) {
      callouts.push({
        featureId: f.id,
        symbol: 'cylindricity',
        toleranceMm: 0.02,
        datumRefs: [],
        modifiers: {},
        confidence: 0.75,
        reason: `Long shaft (L/D = ${(f.lengthMm / dia).toFixed(1)})`,
      });
    }
  }

  // 4. Parallelism on opposite planar pairs.
  const planar = features.filter(f => f.kind === 'planar');
  for (let i = 0; i < planar.length; i++) {
    for (let j = i + 1; j < planar.length; j++) {
      const a = planar[i]!, b = planar[j]!;
      const dot = a.direction[0] * b.direction[0] + a.direction[1] * b.direction[1] + a.direction[2] * b.direction[2];
      if (dot < -0.95) {
        const primary = datumLetters.get(a.id);
        if (primary) {
          callouts.push({
            featureId: b.id,
            symbol: 'parallelism',
            toleranceMm: 0.05,
            datumRefs: [primary],
            modifiers: {},
            confidence: 0.70,
            reason: `Parallel to datum ${primary}`,
          });
        }
      }
    }
  }

  // 5. Perpendicularity on mating faces.
  for (let i = 0; i < planar.length; i++) {
    for (let j = i + 1; j < planar.length; j++) {
      const a = planar[i]!, b = planar[j]!;
      const dot = a.direction[0] * b.direction[0] + a.direction[1] * b.direction[1] + a.direction[2] * b.direction[2];
      if (Math.abs(dot) < 0.05) {
        const primary = datumLetters.get(a.id);
        if (primary && !datumLetters.has(b.id)) {
          callouts.push({
            featureId: b.id,
            symbol: 'perpendicularity',
            toleranceMm: 0.05,
            datumRefs: [primary],
            modifiers: {},
            confidence: 0.60,
            reason: `Perpendicular to datum ${primary}`,
          });
        }
      }
    }
  }

  // 6. Profile on freeform faces.
  for (const f of features) {
    if (f.kind !== 'freeform') continue;
    callouts.push({
      featureId: f.id,
      symbol: 'profile-surface',
      toleranceMm: 0.2,
      datumRefs: datums.map(d => d.letter),
      modifiers: {},
      confidence: 0.65,
      reason: 'Freeform surface — surface profile',
    });
  }

  // Sort callouts by descending confidence.
  callouts.sort((a, b) => b.confidence - a.confidence);

  // Coverage.
  const featuresCovered = new Set(callouts.map(c => c.featureId));
  const coverage = features.length > 0 ? featuresCovered.size / features.length : 0;

  return { datums, callouts, coverageFraction: coverage };
}

// ── Datum selection ─────────────────────────────────────────────

export function pickDatumCandidates(features: AnalyzedFeature[]): DatumAssignment[] {
  const planar = features.filter(f => f.kind === 'planar');
  if (planar.length === 0) return [];

  // Primary = largest planar face (most stable seat).
  planar.sort((a, b) => b.areaMm2 - a.areaMm2);
  const primary = planar[0]!;
  const assignments: DatumAssignment[] = [{ featureId: primary.id, letter: 'A' }];

  // Secondary = largest face perpendicular to primary.
  let bestPerp: AnalyzedFeature | null = null;
  let bestPerpArea = 0;
  for (const f of planar) {
    if (f.id === primary.id) continue;
    const dot = Math.abs(
      f.direction[0] * primary.direction[0] +
      f.direction[1] * primary.direction[1] +
      f.direction[2] * primary.direction[2]
    );
    if (dot < 0.1 && f.areaMm2 > bestPerpArea) {
      bestPerp = f;
      bestPerpArea = f.areaMm2;
    }
  }
  if (bestPerp) {
    assignments.push({ featureId: bestPerp.id, letter: 'B' });

    // Tertiary = largest face perpendicular to both A and B.
    let bestTri: AnalyzedFeature | null = null;
    let bestTriArea = 0;
    for (const f of planar) {
      if (f.id === primary.id || f.id === bestPerp.id) continue;
      const dotA = Math.abs(
        f.direction[0] * primary.direction[0] +
        f.direction[1] * primary.direction[1] +
        f.direction[2] * primary.direction[2]
      );
      const dotB = Math.abs(
        f.direction[0] * bestPerp.direction[0] +
        f.direction[1] * bestPerp.direction[1] +
        f.direction[2] * bestPerp.direction[2]
      );
      if (dotA < 0.1 && dotB < 0.1 && f.areaMm2 > bestTriArea) {
        bestTri = f;
        bestTriArea = f.areaMm2;
      }
    }
    if (bestTri) assignments.push({ featureId: bestTri.id, letter: 'C' });
  }

  return assignments;
}

// ── Helpers ─────────────────────────────────────────────────────

function groupBy<T, K>(items: T[], keyFn: (item: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const item of items) {
    const k = keyFn(item);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(item);
  }
  return m;
}

// ── Stats / counts ──────────────────────────────────────────────

export interface CalloutSummary {
  totalCallouts: number;
  bySymbol: Record<GdtSymbol, number>;
  highConfidenceCount: number;
}

export function summarizeCallouts(callouts: SuggestedCallout[]): CalloutSummary {
  const bySymbol = {} as Record<GdtSymbol, number>;
  let high = 0;
  for (const c of callouts) {
    bySymbol[c.symbol] = (bySymbol[c.symbol] ?? 0) + 1;
    if (c.confidence >= 0.8) high++;
  }
  return {
    totalCallouts: callouts.length,
    bySymbol,
    highConfidenceCount: high,
  };
}
