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
  const { tolMm, tolPct, detectedGenus, detectedVolumeMm3, volumeTolMm3, volumeTolPct } = opts;
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

  const ok = mismatches.length === 0 && !holeCount?.mismatch && !volume?.mismatch;
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
    return `spec ok: measured ${m.wMm.toFixed(2)} × ${m.hMm.toFixed(2)} × ${m.dMm.toFixed(2)} mm matches intent within tolerance.${holeLine}${volLine}`;
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
  lines.push('Re-emit intent with corrected params to fix.');
  return lines.join('\n');
}
