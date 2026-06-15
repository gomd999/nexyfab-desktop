/**
 * gdtSuggestion.ts — Heuristic GD&T tolerance suggester.
 *
 * SolidWorks DimXpert / Fusion 360 "Auto-dim" equivalent. Given an
 * IntentInput, propose a default set of GD&T frames (position, flatness,
 * perpendicularity, cylindricity) plus a datum-seed entry the agent uses
 * to materialize the datum reference frame before attaching frames.
 *
 * v1 is pure heuristic — feature-by-feature mapping with a per-process
 * tolerance table. v2 will train on the corpus of frames the user
 * accepted/rejected to refine the defaults. Until then this helper
 * gives the agent a sane starting point so users don't see a blank
 * GD&T section on every part.
 *
 * Pure / additive: never mutates the intent; does NOT touch
 * session.gdtFrames. The agent reviews the suggestion list with the
 * user, then materializes via add_datum_target + add_gdt_frame.
 */

import type { IntentInput, IntentFeature } from '../../openscad-render/intentToScad';
import type { GdtSymbol } from './types';

/**
 * Subset of GD&T characteristic symbols v1 of the suggester emits.
 * Re-exported as `GdtSymbolType` to match the public contract documented
 * in the design spec — under the hood it's the same union as `GdtSymbol`.
 */
export type GdtSymbolType = GdtSymbol;

export interface SuggestedGdtFrame {
  /** Where in the intent this came from — for the agent to explain. */
  source: 'hole' | 'thread' | 'flatness' | 'cylinder_axis' | 'parallelism' | 'datum_seed';
  /** Free-form feature reference the agent can attach to a face label later. */
  featureRef: string;
  /** GD&T symbol type — must match GdtSymbol union. */
  symbol: GdtSymbolType;
  /** Tolerance value in mm (linear) or degrees (angular). */
  toleranceMm: number;
  /** Datum refs (A, B, C) when applicable. */
  datumRefs?: string[];
  /** One-line rationale the agent surfaces to the user. */
  reason: string;
}

export interface SuggestGdtOptions {
  /**
   * Per-process tolerance class. fdm/sla = loose, cnc_mill = tight,
   * injection_molding = looser to allow shrinkage. Defaults 'cnc_mill'.
   */
  processForDfm?: 'fdm' | 'sla' | 'cnc_mill' | 'sheet' | 'injection_molding' | 'die_cast';
  /** Tolerance grade. 'standard' default. 'precision' tightens by 0.5×. */
  grade?: 'rough' | 'standard' | 'precision';
}

/** Process-scaling table (mm linear tolerance defaults). */
const PROCESS_TOLERANCE: Record<
  NonNullable<SuggestGdtOptions['processForDfm']>,
  { holePosition: number; flatness: number; perpendicularity: number }
> = {
  cnc_mill: { holePosition: 0.1, flatness: 0.05, perpendicularity: 0.03 },
  fdm: { holePosition: 0.3, flatness: 0.2, perpendicularity: 0.15 },
  sla: { holePosition: 0.15, flatness: 0.1, perpendicularity: 0.08 },
  injection_molding: { holePosition: 0.2, flatness: 0.15, perpendicularity: 0.1 },
  die_cast: { holePosition: 0.25, flatness: 0.15, perpendicularity: 0.1 },
  sheet: { holePosition: 0.5, flatness: 0.3, perpendicularity: 0.2 },
};

const GRADE_SCALE: Record<NonNullable<SuggestGdtOptions['grade']>, number> = {
  rough: 2,
  standard: 1,
  precision: 0.5,
};

/** Shapes whose top face is a meaningful primary datum candidate. */
const TOP_FACE_DATUM_SHAPES = new Set<string>([
  'box', 'roundedBox', 'disk', 'washer', 'flange', 'lBracket',
  'iBeam', 'tBeam', 'uChannel', 'zPurlin', 'hexNut', 'wedge',
]);

/** Shapes that have a meaningful "axis" — cylindrical solids whose axis
 *  vs. end-face perpendicularity matters for bore alignment. */
const AXIS_SHAPES = new Set<string>(['cylinder', 'pipe']);

/** Round a tolerance to a tidy 2-decimal mm value the agent can quote. */
function roundTol(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** Filter the intent's features to a typed list (drops null / undefined). */
function getFeatures(intent: IntentInput): IntentFeature[] {
  if (!Array.isArray(intent.features)) return [];
  return intent.features.filter((f): f is IntentFeature => !!f && typeof f === 'object');
}

/** Extract a hole footprint for labelling — (x, y, diameter). */
function holeRef(f: IntentFeature, idx: number): { x: number; y: number; diameter: number; label: string } {
  const params = (f.params ?? {}) as Record<string, unknown>;
  const x = typeof params.x === 'number' ? params.x : (typeof params.posX === 'number' ? params.posX : 0);
  const y = typeof params.y === 'number' ? params.y : (typeof params.posY === 'number' ? params.posY : 0);
  const diameter = typeof params.diameter === 'number'
    ? params.diameter
    : typeof params.holeDiameter === 'number' ? params.holeDiameter : 0;
  return { x, y, diameter, label: `hole_${idx + 1}` };
}

/** Extract a thread footprint label. */
function threadRef(f: IntentFeature, idx: number): { diameter: number; label: string } {
  const params = (f.params ?? {}) as Record<string, unknown>;
  const diameter = typeof params.diameter === 'number'
    ? params.diameter
    : typeof params.nominalDiameter === 'number' ? params.nominalDiameter : 0;
  return { diameter, label: `thread_${idx + 1}` };
}

/**
 * Propose a set of GD&T frames for the given intent. Pure — never mutates
 * its input. The agent calls this once after `add_feature_intent`, reviews
 * the suggestions with the user, then materializes them via the existing
 * `add_datum_target` + `add_gdt_frame` executors.
 */
export function suggestGdtForIntent(
  intent: IntentInput,
  opts: SuggestGdtOptions = {},
): SuggestedGdtFrame[] {
  if (!intent || typeof intent !== 'object' || typeof intent.shapeId !== 'string') {
    return [];
  }
  const process = opts.processForDfm ?? 'cnc_mill';
  const grade = opts.grade ?? 'standard';
  const baseTol = PROCESS_TOLERANCE[process];
  const scale = GRADE_SCALE[grade];

  const features = getFeatures(intent);
  const holeFeatures = features.filter(f => f.type === 'hole');
  const threadFeatures = features.filter(f => f.type === 'thread');
  const hasFunctionalFeatures = holeFeatures.length > 0 || threadFeatures.length > 0;

  const out: SuggestedGdtFrame[] = [];

  // 1. Always seed the datum reference frame first so the agent knows the
  //    proposed datum order before attaching tolerances. A = primary planar
  //    face (top), B = secondary axis (longest), C = orthogonal direction.
  out.push({
    source: 'datum_seed',
    featureRef: 'datum_frame',
    symbol: 'flatness', // nominal — datum_seed is a marker, not a real frame
    toleranceMm: 0,
    datumRefs: ['A', 'B', 'C'],
    reason: 'Datum frame seed — A: largest planar face, B: longest axis, C: orthogonal. Materialize via add_datum_target before attaching the frames below.',
  });

  // 2. Hole features → position tolerance. When ≥ 2 holes, attach datums
  //    A & B to lock the positional pattern. Single hole gets datum A only
  //    (it's still positioned relative to the primary face).
  const positionTol = roundTol(baseTol.holePosition * scale);
  if (holeFeatures.length > 0) {
    const datumRefs = holeFeatures.length >= 2 ? ['A', 'B'] : ['A'];
    holeFeatures.forEach((f, i) => {
      const h = holeRef(f, i);
      out.push({
        source: 'hole',
        featureRef: h.label,
        symbol: 'position',
        toleranceMm: positionTol,
        datumRefs,
        reason: `Hole at (${h.x.toFixed(1)}, ${h.y.toFixed(1)}) Ø${h.diameter || '?'} needs positional control relative to part datums.`,
      });
    });
  }

  // 3. Thread features → cylindricity on the bore. Tight 0.05 mm because
  //    a tapped hole needs a straight bore for the fastener to engage.
  //    Grade scaling still applies; process scaling does NOT — threads are
  //    cut, not formed by the parent process.
  const threadCylindricityTol = roundTol(0.05 * scale);
  threadFeatures.forEach((f, i) => {
    const t = threadRef(f, i);
    out.push({
      source: 'thread',
      featureRef: t.label,
      symbol: 'cylindricity',
      toleranceMm: threadCylindricityTol,
      reason: `Tapped hole interior (Ø${t.diameter || '?'}) must be straight for fastener engagement.`,
    });
  });

  // 4. Flatness on the primary top face. Skipped on non-planar primaries
  //    (sphere, torus, cone, etc.) where there's no obvious flat datum.
  //    For axis-shapes (cylinder/pipe) we use the end face — that's the
  //    "flat" half of the perpendicularity pair below.
  const flatnessTol = roundTol(baseTol.flatness * scale);
  const isTopFaceShape = TOP_FACE_DATUM_SHAPES.has(intent.shapeId);
  const isAxisShape = AXIS_SHAPES.has(intent.shapeId);
  if (isTopFaceShape) {
    out.push({
      source: 'flatness',
      featureRef: 'face_top',
      symbol: 'flatness',
      toleranceMm: flatnessTol,
      reason: 'Top face flatness establishes a primary datum (A).',
    });
  } else if (isAxisShape) {
    out.push({
      source: 'flatness',
      featureRef: 'face_end',
      symbol: 'flatness',
      toleranceMm: flatnessTol,
      reason: 'End face flatness establishes a primary datum (A) on the cylindrical body.',
    });
  }

  // 5. Cylinder / pipe → perpendicularity between axis and end face.
  const perpTol = roundTol(baseTol.perpendicularity * scale);
  if (isAxisShape) {
    out.push({
      source: 'cylinder_axis',
      featureRef: 'axis_centerline',
      symbol: 'perpendicularity',
      toleranceMm: perpTol,
      datumRefs: ['A'],
      reason: 'Cylinder end face perpendicularity to axis controls bore alignment.',
    });
  }

  // 6. Multi-hole pattern → also suggest parallelism between the holes'
  //    common axis and the primary datum, so threaded fasteners go in
  //    straight when the parent is mounted on its A datum.
  if (holeFeatures.length >= 2) {
    out.push({
      source: 'parallelism',
      featureRef: 'hole_pattern_axis',
      symbol: 'parallelism',
      toleranceMm: perpTol,
      datumRefs: ['A'],
      reason: 'Multi-hole pattern: common bore axis parallelism to datum A controls fastener line-up across the pattern.',
    });
  }

  // 7. If the shape isn't in any "obvious functional" category AND has no
  //    features, return just the datum seed so the agent doesn't push
  //    unwarranted tolerances on, say, a sphere or torus.
  if (!hasFunctionalFeatures && !isTopFaceShape && !isAxisShape) {
    // out already contains just the datum_seed entry — keep it minimal.
  }

  return out;
}

/**
 * Human-readable summary the tool wrapper hands back to the agent. One
 * line per suggestion, leading with the symbol + featureRef + tolerance
 * and trailing the rationale.
 */
export function formatSuggestions(suggestions: SuggestedGdtFrame[]): string {
  if (suggestions.length === 0) {
    return 'No GD&T suggestions for this intent (no functional features detected).';
  }
  const lines = suggestions.map((s, i) => {
    const datumPart = s.datumRefs && s.datumRefs.length > 0 ? ` | ${s.datumRefs.join(' | ')}` : '';
    const tolPart = s.source === 'datum_seed' ? '' : ` ${s.toleranceMm}mm`;
    return `  ${i + 1}. [${s.source}] ${s.symbol} on "${s.featureRef}"${tolPart}${datumPart}\n     → ${s.reason}`;
  });
  return `${suggestions.length} GD&T suggestion(s):\n${lines.join('\n')}`;
}
