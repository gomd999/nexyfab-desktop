/**
 * specVerification.ts — Phase X1 commercial-CAD-AI parity.
 *
 * Bridges the gap between "AI generated SCAD that compiles" and "AI
 * generated SCAD that matches the user's stated dimensions". The agent
 * historically had no way to self-check that a "50mm cube" actually
 * came out 50mm — manifold + watertight pass even when the AI silently
 * dropped a zero off a parameter.
 *
 * What this module does:
 *   1. `expectedBboxFromIntent` — derive a deterministic expected
 *      bbox in mm from the IntentInput, for the shapes whose bbox is
 *      a closed-form function of params. Shapes with feature-dependent
 *      bbox (scale, mirror, patterns) return null — the agent gets no
 *      false-positive critique.
 *   2. `compareBbox` — compare expected vs measured bbox per axis with
 *      a tolerance (default: max(0.5mm, 1%)). Returns SpecMismatch[].
 *   3. `formatSpecCritique` — human-readable summary the agent reads as
 *      a tool result and uses to self-correct (re-emit intent with the
 *      right params).
 *
 * Why bbox-only in v1: bbox is the cheapest measurement available from
 * STLLoader (computeBoundingBox is already called in renderToGeometry).
 * Hole-count / fillet-radius verification needs face inspection which
 * is a Phase X2 follow-up.
 */

import type { IntentInput, IntentFeature } from '../../openscad-render/intentToScad';
import { METRIC_FASTENERS } from '../../openscad-render/isoFasteners';

export interface ExpectedBbox {
  /** Whether the bbox is centered at origin (cube center=true semantics). */
  centered: boolean;
  wMm: number;
  hMm: number;
  dMm: number;
}

export interface MeasuredBbox {
  min: [number, number, number];
  max: [number, number, number];
}

export interface SpecMismatch {
  /** Axis label — 'width' | 'height' | 'depth'. */
  axis: 'width' | 'height' | 'depth';
  expectedMm: number;
  actualMm: number;
  deltaMm: number;
  deltaPct: number;
}

export interface SpecVerificationResult {
  ok: boolean;
  /** False when the shape's bbox can't be derived deterministically. */
  verifiable: boolean;
  /** Reason verification was skipped (when verifiable=false). */
  skipReason?: string;
  expected?: ExpectedBbox;
  measured?: { wMm: number; hMm: number; dMm: number };
  mismatches: SpecMismatch[];
  /**
   * X2 — through-hole count check. Populated when the caller passed a
   * detectedGenus (from faceInspection.countThroughHoles) AND the intent
   * declares at least one `hole` feature. Null when not checked.
   */
  holeCount?: {
    expected: number;
    /** Detected genus / through-hole count. Null when the mesh isn't
     *  a single closed manifold — in that case `mismatch` stays null too. */
    detected: number | null;
    mismatch: { delta: number } | null;
  };
  /**
   * X3 — volume check. Populated when caller provided detectedVolumeMm3
   * AND the shape's expected volume can be derived from intent. Catches
   * blind holes (don't change genus), wrong hole diameter, missing
   * solid features that don't shift bbox.
   */
  volume?: {
    expectedMm3: number;
    actualMm3: number;
    /** Breakdown of expected hole subtraction for diagnostics. */
    holeBreakdown: ExpectedVolume['holeBreakdown'];
    mismatch: VolumeMismatch | null;
  };
  /**
   * X5 — surface area check. Populated when caller provided
   * detectedSurfaceAreaMm2 AND the shape's expected area is closed-form.
   * Catches hollow-shell artefacts, missing ribs, extra fins — anything
   * that adds/removes wall area without shifting bbox or volume much.
   */
  surfaceArea?: {
    expectedMm2: number;
    actualMm2: number;
    holeBreakdown: ExpectedSurfaceArea['holeBreakdown'];
    mismatch: SurfaceAreaMismatch | null;
  };
  /**
   * X6 — hole position check. Populated when caller provided
   * detectedHoles (from faceInspection.detectZAxisHoles). Compares each
   * intent hole's (x, y) against the closest detected peak.
   */
  holePositions?: {
    matches: Array<{
      /** Which axis the intent hole was cut along. */
      axis: 'x' | 'y' | 'z';
      intent: { x: number; y: number; diameter: number };
      detected: { cx: number; cy: number; diameter: number } | null;
      distMm: number;
      withinTolerance: boolean;
    }>;
    /** Detected peaks that didn't match any intent hole (extras the AI drilled). */
    extras: Array<{ axis: 'x' | 'y' | 'z'; cx: number; cy: number; diameter: number }>;
    /** True iff every intent hole matched a detected peak within tolerance. */
    allMatched: boolean;
  };
  /**
   * X8 — fillet application check. Populated when caller passed
   * detectedDihedralStats AND the intent declares at least one `fillet`
   * feature. Reports whether the mesh has the expected smoothed-corner
   * signature (low sharpEdgeCount) for the fillet to have actually
   * taken effect.
   */
  fillet?: {
    /** Number of fillet features in the intent. */
    expectedFilletCount: number;
    /** Edges in the mesh classified as sharp (≥ sharpThresholdDeg). */
    sharpEdgeCount: number;
    /** Max dihedral observed (degrees). */
    maxDihedralDeg: number;
    /** True when sharpEdgeCount is at or below the threshold expected
     *  for a successfully-filleted part. */
    applied: boolean;
  };
  /**
   * X9 — thread spec self-check (intent-side, no mesh needed).
   * Populated when intent declares at least one `thread` feature.
   * Each thread's pitch is compared to the ISO 261 coarse-thread pitch
   * for its nominal diameter when the diameter matches an ISO size.
   */
  threads?: {
    perThread: Array<{
      diameter: number;
      requestedPitch: number;
      isoStandard: 'M3' | 'M4' | 'M5' | 'M6' | 'M8' | 'M10' | 'M12' | 'M14' | 'M16' | null;
      expectedPitch: number | null;
      /** True iff pitch matches ISO coarse to within 0.02 mm, OR the
       *  diameter is non-standard (no expectation). */
      pitchOk: boolean;
    }>;
    /** True iff every thread is either ISO-compliant or non-standard. */
    allOk: boolean;
  };
  /**
   * X10 — intent self-consistency. Pure intent-side check that runs
   * before render and catches the AI emitting nonsensical combinations:
   * duplicate hole positions, overlapping holes, a hole that obliterates
   * the parent body, thread features without a matching hole footprint.
   */
  intentIssues?: {
    duplicateHoles: Array<{
      /** Indices into intent.features (filtered to type='hole') of duplicate set. */
      indices: number[];
      axis: 'x' | 'y' | 'z';
      x: number;
      y: number;
      diameter: number;
    }>;
    overlappingHoles: Array<{
      indices: [number, number];
      axis: 'x' | 'y' | 'z';
      distMm: number;
      combinedRadiusMm: number;
    }>;
    /** Holes whose diameter ≥ parent's smallest in-plane dimension. */
    obliteratingHoles: Array<{
      index: number;
      diameter: number;
      parentLimitMm: number;
    }>;
    /** True iff every check passed (no duplicates, no overlaps, no
     *  obliterating holes). */
    ok: boolean;
  };
}

/** Features that change the bounding box in ways the v1 helper can't
 *  predict — skip verification when any of these are present. */
const BBOX_DISTORTING_FEATURES = new Set<IntentFeature['type']>([
  'scale',
  'mirror',
  'linearPattern',
  'circularPattern',
  'twist',
  'rotate',
]);

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/**
 * Derive expected bbox from intent for the supported subset. Returns
 * null when the shape isn't covered, or when features would distort
 * the bbox unpredictably.
 */
export function expectedBboxFromIntent(intent: IntentInput): ExpectedBbox | null {
  if (!intent || typeof intent !== 'object') return null;

  // Bail if any feature would shift the bbox in v1-unhandled ways.
  if (Array.isArray(intent.features)) {
    for (const f of intent.features) {
      if (f && typeof f === 'object' && BBOX_DISTORTING_FEATURES.has(f.type)) {
        return null;
      }
    }
  }

  const p = (intent.params ?? {}) as Record<string, unknown>;
  switch (intent.shapeId) {
    case 'box':
    case 'roundedBox': {
      const w = num(p.width ?? p.w, 50);
      const h = num(p.height ?? p.h, 50);
      const d = num(p.depth ?? p.d, 50);
      return { centered: true, wMm: w, hMm: h, dMm: d };
    }
    case 'cylinder': {
      const dia = num(p.diameter ?? p.outerDiameter, 30);
      const h = num(p.height ?? p.length, 50);
      return { centered: true, wMm: dia, hMm: dia, dMm: h };
    }
    case 'sphere': {
      const dia = num(p.diameter, 30);
      return { centered: true, wMm: dia, hMm: dia, dMm: dia };
    }
    case 'cone': {
      const r1 = num(p.bottomDiameter ?? p.diameter, 40) / 2;
      const r2 = num(p.topDiameter, 0) / 2;
      const dia = Math.max(r1, r2) * 2;
      const h = num(p.height, 50);
      return { centered: true, wMm: dia, hMm: dia, dMm: h };
    }
    case 'pipe': {
      const od = num(p.outerDiameter, 30);
      const h = num(p.length ?? p.height, 50);
      return { centered: true, wMm: od, hMm: od, dMm: h };
    }
    case 'disk': {
      const dia = num(p.diameter, 60);
      const t = num(p.thickness, 5);
      return { centered: true, wMm: dia, hMm: dia, dMm: t };
    }
    case 'washer': {
      const od = num(p.outerDiameter, 20);
      const t = num(p.thickness, 1.6);
      return { centered: true, wMm: od, hMm: od, dMm: t };
    }
    case 'hexNut': {
      // Across-corners is the bbox-driving diameter (2× corner radius).
      const afs = num(p.acrossFlats, 13);
      const acrossCorners = afs / Math.cos(Math.PI / 6);
      const t = num(p.thickness ?? p.nutThickness, 8);
      return { centered: true, wMm: acrossCorners, hMm: acrossCorners, dMm: t };
    }
    case 'flange': {
      const od = num(p.outerDiameter, 100);
      const t = num(p.thickness, 12);
      return { centered: true, wMm: od, hMm: od, dMm: t };
    }
    case 'iBeam': {
      const H = num(p.beamHeight ?? p.height, 100);
      const W = num(p.flangeWidth ?? p.width, 60);
      const L = num(p.length, 200);
      return { centered: true, wMm: W, hMm: H, dMm: L };
    }
    case 'lBracket': {
      const W = num(p.width, 50);
      const H = num(p.height, 50);
      const D = num(p.depth ?? p.length, 50);
      // L-bracket is built at origin (not centered).
      return { centered: false, wMm: W, hMm: H, dMm: D };
    }
    case 'wedge': {
      const w = num(p.width, 50);
      const h = num(p.height, 50);
      const d = num(p.depth, 50);
      return { centered: false, wMm: w, hMm: h, dMm: d };
    }
    case 'tBeam':
    case 'uChannel':
    case 'zPurlin': {
      // These three share the same outer envelope convention:
      // (width × height × length) extruded.
      const W = num(p.flangeWidth ?? p.width, 60);
      const H = num(p.beamHeight ?? p.height, 100);
      const L = num(p.length, 200);
      return { centered: true, wMm: W, hMm: H, dMm: L };
    }
    case 'torus': {
      const major = num(p.majorDiameter, 60);
      const tube = num(p.tubeDiameter ?? p.minorDiameter, 10);
      const outer = major + tube;
      return { centered: true, wMm: outer, hMm: outer, dMm: tube };
    }
    default:
      return null;
  }
}

/**
 * Compare expected vs measured bbox per axis. `tolMm` and `tolPct` are
 * combined as max(tolMm, tolPct% × expected) — a mismatch must exceed
 * the larger of the two to register. This keeps small absolute errors
 * (machine round-off) and small relative errors (large parts) both
 * gracefully tolerated.
 */
export function compareBbox(
  expected: ExpectedBbox,
  measured: MeasuredBbox,
  tolMm: number = 0.5,
  tolPct: number = 1,
): SpecMismatch[] {
  const mismatches: SpecMismatch[] = [];
  const wMeas = measured.max[0] - measured.min[0];
  const hMeas = measured.max[1] - measured.min[1];
  const dMeas = measured.max[2] - measured.min[2];

  const pairs: Array<{ axis: SpecMismatch['axis']; exp: number; act: number }> = [
    { axis: 'width', exp: expected.wMm, act: wMeas },
    { axis: 'height', exp: expected.hMm, act: hMeas },
    { axis: 'depth', exp: expected.dMm, act: dMeas },
  ];

  for (const { axis, exp, act } of pairs) {
    if (exp <= 0) continue;
    const tol = Math.max(tolMm, (exp * tolPct) / 100);
    const delta = Math.abs(act - exp);
    if (delta > tol) {
      mismatches.push({
        axis,
        expectedMm: exp,
        actualMm: act,
        deltaMm: act - exp,
        deltaPct: ((act - exp) / exp) * 100,
      });
    }
  }
  return mismatches;
}

/**
 * Count `type: 'hole'` features in an intent. Through-hole detection
 * via genus catches these but not blind holes (depth < parent size) —
 * X3's volume check complements by also flagging the blind-hole case.
 */
export function countIntentHoles(intent: IntentInput): number {
  if (!Array.isArray(intent.features)) return 0;
  return intent.features.filter((f): f is IntentFeature => !!f && f.type === 'hole').length;
}

// ─── Phase X10 — Intent self-consistency ──────────────────────────────────

/** Two holes are considered "duplicates" when their centers coincide
 *  within this tolerance AND the diameters are within 0.1 mm. */
const DUPLICATE_HOLE_POS_TOL_MM = 0.5;
const DUPLICATE_HOLE_DIA_TOL_MM = 0.1;

/** Helper: extract a hole's (axis, x, y, diameter) for self-consistency
 *  checks. Axis convention same as X7 — defaults 'z'. */
function holeFootprint(f: IntentFeature): { axis: 'x' | 'y' | 'z'; x: number; y: number; diameter: number } | null {
  if (f.type !== 'hole') return null;
  const params = (f as { params?: Record<string, unknown> }).params ?? {};
  const axisHint = params.axis;
  const axis: 'x' | 'y' | 'z' = (axisHint === 'x' || axisHint === 'y') ? axisHint : 'z';
  let x: number, y: number;
  if (axis === 'z') {
    x = num(params.x ?? params.posX, 0);
    y = num(params.y ?? params.posY, 0);
  } else if (axis === 'x') {
    x = num(params.y ?? params.posY, 0);
    y = num(params.z ?? params.posZ, 0);
  } else {
    x = num(params.x ?? params.posX, 0);
    y = num(params.z ?? params.posZ, 0);
  }
  const diameter = num(params.diameter ?? params.holeDiameter, 0);
  return { axis, x, y, diameter };
}

/** Parent's in-plane "min dimension" by shape — the smallest extent the
 *  hole sits inside before it punches through. Returns null for shapes
 *  whose parent footprint isn't a simple rectangle/disk. */
function parentInPlaneMinMm(intent: IntentInput): number | null {
  const p = (intent.params ?? {}) as Record<string, unknown>;
  switch (intent.shapeId) {
    case 'box':
    case 'roundedBox': {
      const w = num(p.width ?? p.w, 50);
      const h = num(p.height ?? p.h, 50);
      return Math.min(w, h);
    }
    case 'cylinder':
    case 'disk':
    case 'pipe':
    case 'washer':
    case 'flange': {
      const dia = num(p.diameter ?? p.outerDiameter, 30);
      return dia;
    }
    case 'sphere': {
      return num(p.diameter, 30);
    }
    default:
      return null;
  }
}

/**
 * Pre-render intent validation. Catches AI errors that would otherwise
 * waste render budget: duplicate hole positions, overlapping holes, and
 * holes that would obliterate the parent. All pure intent inspection —
 * no mesh required.
 */
export function detectIntentInconsistencies(intent: IntentInput): NonNullable<SpecVerificationResult['intentIssues']> {
  const duplicateHoles: NonNullable<SpecVerificationResult['intentIssues']>['duplicateHoles'] = [];
  const overlappingHoles: NonNullable<SpecVerificationResult['intentIssues']>['overlappingHoles'] = [];
  const obliteratingHoles: NonNullable<SpecVerificationResult['intentIssues']>['obliteratingHoles'] = [];

  if (!Array.isArray(intent.features)) {
    return { duplicateHoles, overlappingHoles, obliteratingHoles, ok: true };
  }
  const holes = intent.features
    .map((f, idx) => ({ f, idx, fp: f ? holeFootprint(f) : null }))
    .filter((x): x is { f: IntentFeature; idx: number; fp: NonNullable<ReturnType<typeof holeFootprint>> } => !!x.fp);

  // Duplicate detection — union-find style grouping.
  const groupedAsDuplicate = new Set<number>();
  for (let i = 0; i < holes.length; i++) {
    if (groupedAsDuplicate.has(i)) continue;
    const dups: number[] = [holes[i]!.idx];
    for (let j = i + 1; j < holes.length; j++) {
      if (groupedAsDuplicate.has(j)) continue;
      const a = holes[i]!.fp, b = holes[j]!.fp;
      if (a.axis !== b.axis) continue;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const diaDelta = Math.abs(a.diameter - b.diameter);
      if (dist <= DUPLICATE_HOLE_POS_TOL_MM && diaDelta <= DUPLICATE_HOLE_DIA_TOL_MM) {
        dups.push(holes[j]!.idx);
        groupedAsDuplicate.add(j);
      }
    }
    if (dups.length >= 2) {
      groupedAsDuplicate.add(i);
      duplicateHoles.push({
        indices: dups,
        axis: holes[i]!.fp.axis,
        x: holes[i]!.fp.x,
        y: holes[i]!.fp.y,
        diameter: holes[i]!.fp.diameter,
      });
    }
  }

  // Overlap detection (pairs not classified as duplicates) — distance
  // less than the sum of the two radii means the cylinders interpenetrate.
  for (let i = 0; i < holes.length; i++) {
    if (groupedAsDuplicate.has(i)) continue;
    for (let j = i + 1; j < holes.length; j++) {
      if (groupedAsDuplicate.has(j)) continue;
      const a = holes[i]!.fp, b = holes[j]!.fp;
      if (a.axis !== b.axis) continue;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const combinedR = (a.diameter + b.diameter) / 2;
      // dist == 0 is the duplicate case (handled above). Overlap is
      // strictly 0 < dist < combinedR.
      if (dist > DUPLICATE_HOLE_POS_TOL_MM && dist < combinedR) {
        overlappingHoles.push({
          indices: [holes[i]!.idx, holes[j]!.idx],
          axis: a.axis,
          distMm: dist,
          combinedRadiusMm: combinedR,
        });
      }
    }
  }

  // Obliterating-hole detection — hole diameter ≥ parent's in-plane min.
  const parentMin = parentInPlaneMinMm(intent);
  if (parentMin !== null) {
    for (const { fp, idx } of holes) {
      if (fp.diameter >= parentMin) {
        obliteratingHoles.push({
          index: idx,
          diameter: fp.diameter,
          parentLimitMm: parentMin,
        });
      }
    }
  }

  return {
    duplicateHoles,
    overlappingHoles,
    obliteratingHoles,
    ok: duplicateHoles.length === 0 && overlappingHoles.length === 0 && obliteratingHoles.length === 0,
  };
}

// ─── Phase X3 — Expected volume from intent ────────────────────────────────

export interface ExpectedVolume {
  /** Base (parent) volume in mm³, before hole subtraction. */
  baseVolumeMm3: number;
  /** Total volume removed by hole features (through + blind). */
  holeVolumeMm3: number;
  /** Net expected volume = base - holes. Clamped to 0 if holes exceed base. */
  expectedTotalMm3: number;
  /** Per-hole volume contributions for diagnostic output. */
  holeBreakdown: Array<{ diameter: number; depth: number; volume: number; through: boolean }>;
}

/**
 * Volume of one hole feature given the parent's z-extent. The intent
 * emitter (applyHole in intentToScad) defaults depth=1000 mm so any
 * hole whose feature.depth ≥ parent_dMm is treated as a through-hole
 * along the parent's depth axis.
 */
function holeVolume(
  feature: IntentFeature,
  parentDepthMm: number,
): { diameter: number; depth: number; volume: number; through: boolean } | null {
  if (!feature || feature.type !== 'hole') return null;
  const params = (feature as { params?: Record<string, unknown> }).params ?? {};
  const dia = num(params.diameter ?? params.holeDiameter, 0);
  if (dia <= 0) return null;
  const requestedDepth = num(params.depth, 1000); // emitter default = "through"
  const through = requestedDepth >= parentDepthMm;
  const effectiveDepth = through ? parentDepthMm : requestedDepth;
  const r = dia / 2;
  return {
    diameter: dia,
    depth: effectiveDepth,
    volume: Math.PI * r * r * effectiveDepth,
    through,
  };
}

/**
 * Closed-form volume for the supported shape catalog. Returns null when
 * the shape's volume isn't a simple formula in v1, or when a distorting
 * feature (scale/mirror/pattern/twist/rotate) would invalidate the
 * estimate. Hole features are subtracted from the base volume.
 */
export function expectedVolumeFromIntent(intent: IntentInput): ExpectedVolume | null {
  if (!intent || typeof intent !== 'object') return null;

  // Same distorting-feature gate as bbox prediction.
  if (Array.isArray(intent.features)) {
    for (const f of intent.features) {
      if (f && typeof f === 'object' && BBOX_DISTORTING_FEATURES.has(f.type)) {
        return null;
      }
    }
  }

  const p = (intent.params ?? {}) as Record<string, unknown>;

  /** Local helper — base solid volume by shape, or null if unsupported. */
  function baseVolume(): { volume: number; parentDepth: number } | null {
    switch (intent.shapeId) {
      case 'box':
      case 'roundedBox': {
        const w = num(p.width ?? p.w, 50);
        const h = num(p.height ?? p.h, 50);
        const d = num(p.depth ?? p.d, 50);
        return { volume: w * h * d, parentDepth: d };
      }
      case 'cylinder': {
        const dia = num(p.diameter ?? p.outerDiameter, 30);
        const h = num(p.height ?? p.length, 50);
        return { volume: Math.PI * (dia / 2) ** 2 * h, parentDepth: h };
      }
      case 'sphere': {
        const dia = num(p.diameter, 30);
        const r = dia / 2;
        return { volume: (4 / 3) * Math.PI * r ** 3, parentDepth: dia };
      }
      case 'cone': {
        const r1 = num(p.bottomDiameter ?? p.diameter, 40) / 2;
        const r2 = num(p.topDiameter, 0) / 2;
        const h = num(p.height, 50);
        return { volume: (Math.PI * h * (r1 * r1 + r1 * r2 + r2 * r2)) / 3, parentDepth: h };
      }
      case 'pipe': {
        const od = num(p.outerDiameter, 30);
        const id = num(p.innerDiameter, 20);
        const h = num(p.length ?? p.height, 50);
        return { volume: Math.PI * ((od / 2) ** 2 - (id / 2) ** 2) * h, parentDepth: h };
      }
      case 'disk': {
        const dia = num(p.diameter, 60);
        const t = num(p.thickness, 5);
        return { volume: Math.PI * (dia / 2) ** 2 * t, parentDepth: t };
      }
      case 'washer': {
        const od = num(p.outerDiameter, 20);
        const id = num(p.innerDiameter, 8);
        const t = num(p.thickness, 1.6);
        return { volume: Math.PI * ((od / 2) ** 2 - (id / 2) ** 2) * t, parentDepth: t };
      }
      case 'hexNut': {
        // Regular hexagon area with across-flats afs: (√3 / 2) × afs².
        const afs = num(p.acrossFlats, 13);
        const t = num(p.thickness ?? p.nutThickness, 8);
        const boreR = num(p.nominalDiameter ?? p.boreDiameter, 8) / 2;
        const hexArea = (Math.sqrt(3) / 2) * afs * afs;
        const bore = Math.PI * boreR * boreR * t;
        return { volume: hexArea * t - bore, parentDepth: t };
      }
      case 'wedge': {
        // Triangular prism: 0.5 × w × h × d.
        const w = num(p.width, 50);
        const h = num(p.height, 50);
        const d = num(p.depth, 50);
        return { volume: 0.5 * w * h * d, parentDepth: d };
      }
      case 'torus': {
        const major = num(p.majorDiameter, 60) / 2;
        const tube = num(p.tubeDiameter ?? p.minorDiameter, 10) / 2;
        return { volume: 2 * Math.PI * Math.PI * major * tube * tube, parentDepth: tube * 2 };
      }
      default:
        return null;
    }
  }

  const base = baseVolume();
  if (!base) return null;

  const holeBreakdown: ExpectedVolume['holeBreakdown'] = [];
  let holeVolumeMm3 = 0;
  if (Array.isArray(intent.features)) {
    for (const f of intent.features) {
      const hv = holeVolume(f, base.parentDepth);
      if (hv) {
        holeBreakdown.push(hv);
        holeVolumeMm3 += hv.volume;
      }
    }
  }

  const expectedTotalMm3 = Math.max(0, base.volume - holeVolumeMm3);
  return {
    baseVolumeMm3: base.volume,
    holeVolumeMm3,
    expectedTotalMm3,
    holeBreakdown,
  };
}

export interface VolumeMismatch {
  expectedMm3: number;
  actualMm3: number;
  deltaMm3: number;
  deltaPct: number;
}

// ─── Phase X5 — Expected surface area ──────────────────────────────────────

export interface ExpectedSurfaceArea {
  /** Base outer surface area in mm² (the parent before holes). */
  baseAreaMm2: number;
  /**
   * Net contribution from hole features:
   *   delta = inner cylindrical wall added − two end-cap disks removed.
   * For a THROUGH hole: removes 2 end-cap disks (top + bottom face)
   *   and adds the inner cylinder wall (2πr × d).
   * For a BLIND hole: removes 1 end-cap disk and adds the inner wall
   *   plus the cylindrical floor end (1 disk).
   *
   * Net delta can be positive (blind) or negative (small through-hole
   * relative to wall), so the helper just returns the algebraic sum.
   */
  holeAreaDeltaMm2: number;
  /** Net expected area = base + hole delta, clamped to >= 0. */
  expectedTotalMm2: number;
  /** Per-hole area contributions for diagnostic output. */
  holeBreakdown: Array<{
    diameter: number;
    depth: number;
    through: boolean;
    /** Surface area change this hole contributes to the part total. */
    deltaMm2: number;
  }>;
}

/**
 * Closed-form surface area for the supported shape catalog. Returns null
 * when the shape isn't covered or a distorting feature is present.
 *
 * Hole adjustment math:
 *   Through-hole (depth ≥ parent_z): -2 × πr² (cap removal) + 2πr × parent_z (inner wall)
 *   Blind hole  (depth < parent_z):  -1 × πr² (one cap removed) + 2πr × depth + πr² (floor inside) = 2πr × depth
 *
 * (Through case removes BOTH caps because the hole pierces the part.
 *  Blind case removes ONE cap (the entrance) and the cylinder's internal
 *  closed end contributes a flat disk that cancels nothing.)
 */
export function expectedSurfaceAreaFromIntent(intent: IntentInput): ExpectedSurfaceArea | null {
  if (!intent || typeof intent !== 'object') return null;

  // Same distorting-feature gate.
  if (Array.isArray(intent.features)) {
    for (const f of intent.features) {
      if (f && typeof f === 'object' && BBOX_DISTORTING_FEATURES.has(f.type)) {
        return null;
      }
    }
  }

  const p = (intent.params ?? {}) as Record<string, unknown>;

  function baseArea(): { area: number; parentDepth: number } | null {
    switch (intent.shapeId) {
      case 'box':
      case 'roundedBox': {
        const w = num(p.width ?? p.w, 50);
        const h = num(p.height ?? p.h, 50);
        const d = num(p.depth ?? p.d, 50);
        // 2 × (wh + hd + dw)
        return { area: 2 * (w * h + h * d + d * w), parentDepth: d };
      }
      case 'cylinder': {
        const dia = num(p.diameter ?? p.outerDiameter, 30);
        const h = num(p.height ?? p.length, 50);
        const r = dia / 2;
        // 2πr × h side + 2 × πr² caps
        return { area: 2 * Math.PI * r * h + 2 * Math.PI * r * r, parentDepth: h };
      }
      case 'sphere': {
        const dia = num(p.diameter, 30);
        const r = dia / 2;
        return { area: 4 * Math.PI * r * r, parentDepth: dia };
      }
      case 'cone': {
        const r1 = num(p.bottomDiameter ?? p.diameter, 40) / 2;
        const r2 = num(p.topDiameter, 0) / 2;
        const h = num(p.height, 50);
        const slant = Math.sqrt((r1 - r2) ** 2 + h * h);
        // Frustum lateral: π(r1+r2)·slant. Caps: π(r1²+r2²).
        const lateral = Math.PI * (r1 + r2) * slant;
        const caps = Math.PI * (r1 * r1 + r2 * r2);
        return { area: lateral + caps, parentDepth: h };
      }
      case 'pipe': {
        const od = num(p.outerDiameter, 30);
        const id = num(p.innerDiameter, 20);
        const h = num(p.length ?? p.height, 50);
        const rOut = od / 2, rIn = id / 2;
        // Outer wall + inner wall + 2 ring end-caps
        return {
          area: 2 * Math.PI * rOut * h + 2 * Math.PI * rIn * h + 2 * Math.PI * (rOut * rOut - rIn * rIn),
          parentDepth: h,
        };
      }
      case 'disk': {
        const dia = num(p.diameter, 60);
        const t = num(p.thickness, 5);
        const r = dia / 2;
        return { area: 2 * Math.PI * r * t + 2 * Math.PI * r * r, parentDepth: t };
      }
      case 'washer': {
        const od = num(p.outerDiameter, 20);
        const id = num(p.innerDiameter, 8);
        const t = num(p.thickness, 1.6);
        const rOut = od / 2, rIn = id / 2;
        return {
          area: 2 * Math.PI * rOut * t + 2 * Math.PI * rIn * t + 2 * Math.PI * (rOut * rOut - rIn * rIn),
          parentDepth: t,
        };
      }
      case 'wedge': {
        // Triangular prism with right-angle cross-section (w × h × d).
        // Surface = 2 × (0.5 × w × h) triangular caps + (w + h + hypot(w,h)) × d sides
        const w = num(p.width, 50);
        const h = num(p.height, 50);
        const d = num(p.depth, 50);
        const hyp = Math.sqrt(w * w + h * h);
        return { area: w * h + (w + h + hyp) * d, parentDepth: d };
      }
      case 'torus': {
        const major = num(p.majorDiameter, 60) / 2;
        const tube = num(p.tubeDiameter ?? p.minorDiameter, 10) / 2;
        // 4π² R r
        return { area: 4 * Math.PI * Math.PI * major * tube, parentDepth: tube * 2 };
      }
      default:
        return null;
    }
  }

  const base = baseArea();
  if (!base) return null;

  const holeBreakdown: ExpectedSurfaceArea['holeBreakdown'] = [];
  let holeAreaDeltaMm2 = 0;
  if (Array.isArray(intent.features)) {
    for (const f of intent.features) {
      if (!f || f.type !== 'hole') continue;
      const params = (f as { params?: Record<string, unknown> }).params ?? {};
      const dia = num(params.diameter ?? params.holeDiameter, 0);
      if (dia <= 0) continue;
      const requestedDepth = num(params.depth, 1000);
      const through = requestedDepth >= base.parentDepth;
      const r = dia / 2;
      let delta: number;
      if (through) {
        // -2 caps + inner cylinder wall
        delta = -2 * Math.PI * r * r + 2 * Math.PI * r * base.parentDepth;
      } else {
        // -1 cap + inner wall (the closed end inside contributes +πr², which
        // exactly cancels the cap that wasn't removed at the entrance)
        delta = 2 * Math.PI * r * requestedDepth;
      }
      holeAreaDeltaMm2 += delta;
      holeBreakdown.push({
        diameter: dia,
        depth: through ? base.parentDepth : requestedDepth,
        through,
        deltaMm2: delta,
      });
    }
  }

  const expectedTotalMm2 = Math.max(0, base.area + holeAreaDeltaMm2);
  return {
    baseAreaMm2: base.area,
    holeAreaDeltaMm2,
    expectedTotalMm2,
    holeBreakdown,
  };
}

export interface SurfaceAreaMismatch {
  expectedMm2: number;
  actualMm2: number;
  deltaMm2: number;
  deltaPct: number;
}

/**
 * Compare expected vs actual surface area. Default tolerance is wider
 * than volume (max(20 mm², 5%)) because mesh discretization affects
 * surface area more strongly — a $fn=64 cylinder under-counts area
 * by ~4% relative to analytic.
 */
export function compareSurfaceArea(
  expectedMm2: number,
  actualMm2: number,
  tolMm2: number = 20,
  tolPct: number = 5,
): SurfaceAreaMismatch | null {
  if (expectedMm2 <= 0) return null;
  const tol = Math.max(tolMm2, (expectedMm2 * tolPct) / 100);
  const delta = actualMm2 - expectedMm2;
  if (Math.abs(delta) <= tol) return null;
  return {
    expectedMm2,
    actualMm2,
    deltaMm2: delta,
    deltaPct: (delta / expectedMm2) * 100,
  };
}

/**
 * Compare expected vs actual volume. Tolerance defaults to max(50 mm³,
 * 3%) — looser than bbox because (a) facet count affects measured
 * volume (e.g. $fn=64 cylinder under-measures vs analytic), and (b)
 * minor features (fillets, chamfers) shift volume by a percent or two
 * without warranting a "mismatch" flag.
 */
export function compareVolume(
  expectedMm3: number,
  actualMm3: number,
  tolMm3: number = 50,
  tolPct: number = 3,
): VolumeMismatch | null {
  if (expectedMm3 <= 0) return null;
  const tol = Math.max(tolMm3, (expectedMm3 * tolPct) / 100);
  const delta = actualMm3 - expectedMm3;
  if (Math.abs(delta) <= tol) return null;
  return {
    expectedMm3,
    actualMm3,
    deltaMm3: delta,
    deltaPct: (delta / expectedMm3) * 100,
  };
}

/**
 * Optional inputs for verifyAgainstSpec — extends the bbox check with
 * X2 through-hole counting when the caller has run faceInspection.
 */
export interface VerifyAgainstSpecOptions {
  tolMm?: number;
  tolPct?: number;
  /** From faceInspection.countThroughHoles; null when mesh isn't a
   *  single closed manifold (callee skips the hole-count check then). */
  detectedGenus?: number | null;
  /** X3 — measured mesh volume in mm³ (from STL verification). When
   *  omitted, the volume check is skipped. */
  detectedVolumeMm3?: number;
  /** Volume-check tolerance overrides (defaults max(50 mm³, 3%)). */
  volumeTolMm3?: number;
  volumeTolPct?: number;
  /** X5 — measured mesh surface area in mm². Omit to skip the check. */
  detectedSurfaceAreaMm2?: number;
  /** Surface-area tolerance overrides (defaults max(20 mm², 5%)). */
  surfaceTolMm2?: number;
  surfaceTolPct?: number;
  /** X6/X7 — detected axis-aligned hole peaks (from detectAxisAlignedHoles
   *  or detectAllAxisAlignedHoles). When omitted OR when the intent has no
   *  hole features, the position check is skipped. Each peak carries the
   *  axis it was detected along; the match step only considers peaks whose
   *  axis matches the intent hole's declared axis (default 'z'). */
  detectedHoles?: Array<{ axis?: 'x' | 'y' | 'z'; cx: number; cy: number; diameter: number }>;
  /** Position-match tolerance in mm (default 2 mm). */
  holePosTolMm?: number;
  /** X8 — dihedral statistics (from computeDihedralStats). When omitted
   *  OR when the intent has no `fillet` feature, the fillet check is
   *  skipped. */
  detectedDihedralStats?: {
    sharpEdgeCount: number;
    maxDihedralDeg: number;
  };
  /** Sharp-edge tolerance for the fillet check (default 2 — allow 2
   *  borderline edges before declaring "fillet not applied"). */
  filletSharpEdgeTolerance?: number;
}

/**
 * One-shot verify: derives expected bbox from intent, compares against
 * measured. Returns a structured result the tool layer can hand back
 * to the agent.
 */
export function verifyAgainstSpec(
  intent: IntentInput,
  measured: MeasuredBbox,
  opts: VerifyAgainstSpecOptions = {},
): SpecVerificationResult {
  const { tolMm, tolPct, detectedGenus, detectedVolumeMm3, volumeTolMm3, volumeTolPct, detectedSurfaceAreaMm2, surfaceTolMm2, surfaceTolPct, detectedHoles, holePosTolMm, detectedDihedralStats, filletSharpEdgeTolerance } = opts;
  const expected = expectedBboxFromIntent(intent);
  if (!expected) {
    return {
      ok: true,
      verifiable: false,
      skipReason: `bbox prediction not implemented for shapeId="${intent.shapeId}" or distorting feature present`,
      mismatches: [],
    };
  }
  const mismatches = compareBbox(expected, measured, tolMm, tolPct);

  // X2 — hole count check (only when caller provided detection AND
  // intent declares at least one hole feature).
  let holeCount: SpecVerificationResult['holeCount'];
  const expectedHoles = countIntentHoles(intent);
  if (expectedHoles > 0 && detectedGenus !== undefined) {
    if (detectedGenus === null) {
      // Mesh wasn't a single closed manifold — don't flag a mismatch
      // we can't substantiate.
      holeCount = { expected: expectedHoles, detected: null, mismatch: null };
    } else {
      const delta = detectedGenus - expectedHoles;
      holeCount = {
        expected: expectedHoles,
        detected: detectedGenus,
        mismatch: delta === 0 ? null : { delta },
      };
    }
  }

  // X3 — volume check (only when caller provided measured volume AND
  // shape has a closed-form expected volume).
  let volume: SpecVerificationResult['volume'];
  if (typeof detectedVolumeMm3 === 'number' && detectedVolumeMm3 > 0) {
    const exp = expectedVolumeFromIntent(intent);
    if (exp) {
      const mismatch = compareVolume(exp.expectedTotalMm3, detectedVolumeMm3, volumeTolMm3, volumeTolPct);
      volume = {
        expectedMm3: exp.expectedTotalMm3,
        actualMm3: detectedVolumeMm3,
        holeBreakdown: exp.holeBreakdown,
        mismatch,
      };
    }
  }

  // X5 — surface area check (only when caller provided measured area AND
  // shape has a closed-form expected area).
  let surfaceArea: SpecVerificationResult['surfaceArea'];
  if (typeof detectedSurfaceAreaMm2 === 'number' && detectedSurfaceAreaMm2 > 0) {
    const exp = expectedSurfaceAreaFromIntent(intent);
    if (exp) {
      const mismatch = compareSurfaceArea(exp.expectedTotalMm2, detectedSurfaceAreaMm2, surfaceTolMm2, surfaceTolPct);
      surfaceArea = {
        expectedMm2: exp.expectedTotalMm2,
        actualMm2: detectedSurfaceAreaMm2,
        holeBreakdown: exp.holeBreakdown,
        mismatch,
      };
    }
  }

  // X6 / X7 — hole position check (intent holes vs detected axis-aligned peaks).
  // For each intent hole, we look up its declared axis (defaults to 'z' for
  // backwards compatibility with the v1 applyHole emitter) and only
  // consider detected peaks along that axis. Peaks without an `axis`
  // field are treated as Z-axis (back-compat with X6 test fixtures).
  let holePositions: SpecVerificationResult['holePositions'];
  if (Array.isArray(detectedHoles) && Array.isArray(intent.features)) {
    const intentHoles = intent.features.filter((f): f is IntentFeature => !!f && f.type === 'hole');
    if (intentHoles.length > 0) {
      const tol = holePosTolMm ?? 2;
      const usedDetectedIdx = new Set<number>();
      const matches: NonNullable<SpecVerificationResult['holePositions']>['matches'] = [];
      for (const h of intentHoles) {
        const params = (h as { params?: Record<string, unknown> }).params ?? {};
        const axisHint = params.axis;
        const intentAxis: 'x' | 'y' | 'z' = (axisHint === 'x' || axisHint === 'y') ? axisHint : 'z';
        // Intent's "in-plane" coords depend on the axis. Conventions:
        //   z-axis hole: in-plane = (x, y)
        //   x-axis hole: in-plane = (y, z)
        //   y-axis hole: in-plane = (x, z)
        let ix: number, iy: number;
        if (intentAxis === 'z') {
          ix = num(params.x ?? params.posX, 0);
          iy = num(params.y ?? params.posY, 0);
        } else if (intentAxis === 'x') {
          ix = num(params.y ?? params.posY, 0);
          iy = num(params.z ?? params.posZ, 0);
        } else {
          ix = num(params.x ?? params.posX, 0);
          iy = num(params.z ?? params.posZ, 0);
        }
        const idia = num(params.diameter ?? params.holeDiameter, 0);
        // Find closest still-unused detected peak along the same axis.
        let bestIdx = -1;
        let bestDist = Infinity;
        for (let di = 0; di < detectedHoles.length; di++) {
          if (usedDetectedIdx.has(di)) continue;
          const d = detectedHoles[di]!;
          const dAxis = d.axis ?? 'z';
          if (dAxis !== intentAxis) continue;
          const dist = Math.hypot(d.cx - ix, d.cy - iy);
          if (dist < bestDist) { bestDist = dist; bestIdx = di; }
        }
        if (bestIdx >= 0 && bestDist <= tol) {
          usedDetectedIdx.add(bestIdx);
          const d = detectedHoles[bestIdx]!;
          matches.push({
            axis: intentAxis,
            intent: { x: ix, y: iy, diameter: idia },
            detected: { cx: d.cx, cy: d.cy, diameter: d.diameter },
            distMm: bestDist,
            withinTolerance: true,
          });
        } else {
          matches.push({
            axis: intentAxis,
            intent: { x: ix, y: iy, diameter: idia },
            detected: bestIdx >= 0 ? {
              cx: detectedHoles[bestIdx]!.cx,
              cy: detectedHoles[bestIdx]!.cy,
              diameter: detectedHoles[bestIdx]!.diameter,
            } : null,
            distMm: bestDist === Infinity ? Number.POSITIVE_INFINITY : bestDist,
            withinTolerance: false,
          });
        }
      }
      const extras = detectedHoles
        .filter((_, i) => !usedDetectedIdx.has(i))
        .map(d => ({ axis: (d.axis ?? 'z') as 'x' | 'y' | 'z', cx: d.cx, cy: d.cy, diameter: d.diameter }));
      holePositions = {
        matches,
        extras,
        allMatched: matches.every(m => m.withinTolerance) && extras.length === 0,
      };
    }
  }

  // X9 — thread spec self-check. Pure intent-side; no mesh data needed.
  let threads: SpecVerificationResult['threads'];
  if (Array.isArray(intent.features)) {
    const threadFeatures = intent.features.filter(
      (f): f is IntentFeature => !!f && f.type === 'thread',
    );
    if (threadFeatures.length > 0) {
      const perThread: NonNullable<SpecVerificationResult['threads']>['perThread'] = [];
      for (const t of threadFeatures) {
        const params = (t as { params?: Record<string, unknown> }).params ?? {};
        const dia = num(params.diameter ?? params.nominalDiameter, 8);
        // applyThread default: pitch = dia >= 6 ? 1.0 : 0.5
        const requestedPitch = num(params.pitch, dia >= 6 ? 1.0 : 0.5);
        // Match diameter to ISO catalog (within 0.05 mm).
        let isoStandard: typeof perThread[number]['isoStandard'] = null;
        let expectedPitch: number | null = null;
        for (const [key, spec] of Object.entries(METRIC_FASTENERS)) {
          if (Math.abs(spec.d - dia) <= 0.05) {
            isoStandard = key as typeof perThread[number]['isoStandard'];
            expectedPitch = spec.pitch;
            break;
          }
        }
        const pitchOk = expectedPitch === null
          ? true // non-standard → don't enforce
          : Math.abs(requestedPitch - expectedPitch) <= 0.02;
        perThread.push({
          diameter: dia,
          requestedPitch,
          isoStandard,
          expectedPitch,
          pitchOk,
        });
      }
      threads = {
        perThread,
        allOk: perThread.every(t => t.pitchOk),
      };
    }
  }

  // X8 — fillet application check.
  let fillet: SpecVerificationResult['fillet'];
  if (detectedDihedralStats && Array.isArray(intent.features)) {
    const expectedFilletCount = intent.features.filter(
      (f): f is IntentFeature => !!f && f.type === 'fillet',
    ).length;
    if (expectedFilletCount > 0) {
      const tol = filletSharpEdgeTolerance ?? 2;
      fillet = {
        expectedFilletCount,
        sharpEdgeCount: detectedDihedralStats.sharpEdgeCount,
        maxDihedralDeg: detectedDihedralStats.maxDihedralDeg,
        applied: detectedDihedralStats.sharpEdgeCount <= tol,
      };
    }
  }

  // X10 — intent self-consistency. Always runs (pure intent inspection,
  // no detection prerequisite). When the intent has no hole features
  // the issue lists come back empty and ok=true.
  const intentIssues = detectIntentInconsistencies(intent);

  const ok = mismatches.length === 0
    && !holeCount?.mismatch
    && !volume?.mismatch
    && !surfaceArea?.mismatch
    && (holePositions ? holePositions.allMatched : true)
    && (fillet ? fillet.applied : true)
    && (threads ? threads.allOk : true)
    && intentIssues.ok;
  return {
    ok,
    verifiable: true,
    expected,
    measured: {
      wMm: measured.max[0] - measured.min[0],
      hMm: measured.max[1] - measured.min[1],
      dMm: measured.max[2] - measured.min[2],
    },
    mismatches,
    ...(holeCount ? { holeCount } : {}),
    ...(volume ? { volume } : {}),
    ...(surfaceArea ? { surfaceArea } : {}),
    ...(holePositions ? { holePositions } : {}),
    ...(fillet ? { fillet } : {}),
    ...(threads ? { threads } : {}),
    ...(intentIssues.ok ? {} : { intentIssues }),
  };
}

/**
 * Human-readable critique for tool output. Agent reads this and
 * decides whether to call add_feature_intent again with corrected
 * params.
 */
export function formatSpecCritique(result: SpecVerificationResult): string {
  if (!result.verifiable) {
    return result.skipReason ?? 'spec verification skipped';
  }
  if (result.ok) {
    const m = result.measured!;
    const holeLine = result.holeCount && result.holeCount.detected !== null
      ? ` Through-holes: ${result.holeCount.detected} (matches intent).`
      : '';
    const volLine = result.volume
      ? ` Volume: ${result.volume.actualMm3.toFixed(0)} mm³ (expected ${result.volume.expectedMm3.toFixed(0)}, within tolerance).`
      : '';
    const areaLine = result.surfaceArea
      ? ` Surface area: ${result.surfaceArea.actualMm2.toFixed(0)} mm² (expected ${result.surfaceArea.expectedMm2.toFixed(0)}, within tolerance).`
      : '';
    const posLine = result.holePositions
      ? ` Hole positions: ${result.holePositions.matches.length} hole(s) verified at the intended (x, y).`
      : '';
    const filletLine = result.fillet
      ? ` Fillet: applied (sharp edges ${result.fillet.sharpEdgeCount}, max dihedral ${result.fillet.maxDihedralDeg.toFixed(1)}°).`
      : '';
    const threadLine = result.threads
      ? ` Threads: ${result.threads.perThread.length} thread(s) verified against ISO 261.`
      : '';
    return `spec ok: measured ${m.wMm.toFixed(2)} × ${m.hMm.toFixed(2)} × ${m.dMm.toFixed(2)} mm matches intent within tolerance.${holeLine}${volLine}${areaLine}${posLine}${filletLine}${threadLine}`;
  }
  const lines: string[] = ['spec mismatch:'];
  for (const m of result.mismatches) {
    const sign = m.deltaMm >= 0 ? '+' : '';
    lines.push(
      `  ${m.axis}: expected ${m.expectedMm.toFixed(2)} mm, measured ${m.actualMm.toFixed(2)} mm (${sign}${m.deltaMm.toFixed(2)} mm, ${sign}${m.deltaPct.toFixed(1)}%).`,
    );
  }
  if (result.holeCount?.mismatch) {
    const { expected, detected } = result.holeCount;
    const sign = result.holeCount.mismatch.delta >= 0 ? '+' : '';
    lines.push(
      `  through-holes: expected ${expected}, detected ${detected} (${sign}${result.holeCount.mismatch.delta}).`,
    );
  }
  if (result.volume?.mismatch) {
    const { expectedMm3, actualMm3, deltaMm3, deltaPct } = result.volume.mismatch;
    const sign = deltaMm3 >= 0 ? '+' : '';
    lines.push(
      `  volume: expected ${expectedMm3.toFixed(0)} mm³, measured ${actualMm3.toFixed(0)} mm³ (${sign}${deltaMm3.toFixed(0)} mm³, ${sign}${deltaPct.toFixed(1)}%).`,
    );
    // Diagnostic: which holes the intent claims to have subtracted.
    if (result.volume.holeBreakdown.length > 0) {
      const summary = result.volume.holeBreakdown
        .map(h => `Ø${h.diameter}×${h.depth.toFixed(1)}${h.through ? '(through)' : '(blind)'}=${h.volume.toFixed(0)}mm³`)
        .join(', ');
      lines.push(`    intent hole subtraction: ${summary}`);
    }
  }
  if (result.surfaceArea?.mismatch) {
    const { expectedMm2, actualMm2, deltaMm2, deltaPct } = result.surfaceArea.mismatch;
    const sign = deltaMm2 >= 0 ? '+' : '';
    lines.push(
      `  surface area: expected ${expectedMm2.toFixed(0)} mm², measured ${actualMm2.toFixed(0)} mm² (${sign}${deltaMm2.toFixed(0)} mm², ${sign}${deltaPct.toFixed(1)}%).`,
    );
    if (deltaMm2 > 0) {
      lines.push('    (more wall area than expected — possible hollow shell, extra ribs/fins, or duplicated geometry.)');
    } else {
      lines.push('    (less wall area than expected — possible missing wall, missing rib, or merged feature.)');
    }
  }
  if (result.holePositions && !result.holePositions.allMatched) {
    for (const m of result.holePositions.matches) {
      if (m.withinTolerance) continue;
      if (m.detected) {
        lines.push(
          `  hole position: intent (${m.intent.x.toFixed(1)}, ${m.intent.y.toFixed(1)}) Ø${m.intent.diameter} — closest detected at (${m.detected.cx.toFixed(1)}, ${m.detected.cy.toFixed(1)}) Ø${m.detected.diameter.toFixed(1)}, off by ${m.distMm.toFixed(2)} mm.`,
        );
      } else {
        lines.push(
          `  hole position: intent (${m.intent.x.toFixed(1)}, ${m.intent.y.toFixed(1)}) Ø${m.intent.diameter} — no matching cylindrical feature detected in the mesh.`,
        );
      }
    }
    for (const e of result.holePositions.extras) {
      lines.push(
        `  unexpected hole: detected at (${e.cx.toFixed(1)}, ${e.cy.toFixed(1)}) Ø${e.diameter.toFixed(1)} — intent does not declare this.`,
      );
    }
  }
  if (result.fillet && !result.fillet.applied) {
    lines.push(
      `  fillet: intent declares ${result.fillet.expectedFilletCount} fillet feature(s) but the mesh still has ${result.fillet.sharpEdgeCount} sharp edges (max dihedral ${result.fillet.maxDihedralDeg.toFixed(1)}°). The fillet operation likely didn't take effect (radius too small, or feature was overwritten by a later op).`,
    );
  }
  if (result.threads && !result.threads.allOk) {
    for (const t of result.threads.perThread) {
      if (t.pitchOk) continue;
      lines.push(
        `  thread: Ø${t.diameter}mm thread uses pitch ${t.requestedPitch}mm, but ISO 261 coarse pitch for ${t.isoStandard} is ${t.expectedPitch}mm. Either fix the pitch or change diameter.`,
      );
    }
  }
  if (result.intentIssues) {
    for (const dup of result.intentIssues.duplicateHoles) {
      lines.push(
        `  duplicate hole intent: features[${dup.indices.join(',')}] all declare Ø${dup.diameter} at axis-${dup.axis} (${dup.x.toFixed(1)}, ${dup.y.toFixed(1)}). Keep one.`,
      );
    }
    for (const ov of result.intentIssues.overlappingHoles) {
      lines.push(
        `  overlapping holes: features[${ov.indices[0]}, ${ov.indices[1]}] interpenetrate (axis-${ov.axis} centers ${ov.distMm.toFixed(2)} mm apart, combined radius ${ov.combinedRadiusMm.toFixed(2)} mm). Move or merge.`,
      );
    }
    for (const ob of result.intentIssues.obliteratingHoles) {
      lines.push(
        `  obliterating hole: features[${ob.index}] diameter ${ob.diameter} mm ≥ parent's min in-plane dimension ${ob.parentLimitMm} mm. The hole consumes the parent body.`,
      );
    }
  }
  lines.push('Re-emit intent with corrected params to fix.');
  return lines.join('\n');
}
