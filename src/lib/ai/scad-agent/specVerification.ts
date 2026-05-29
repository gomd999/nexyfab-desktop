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
 * One-shot verify: derives expected bbox from intent, compares against
 * measured. Returns a structured result the tool layer can hand back
 * to the agent.
 */
export function verifyAgainstSpec(
  intent: IntentInput,
  measured: MeasuredBbox,
  tolMm?: number,
  tolPct?: number,
): SpecVerificationResult {
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
  return {
    ok: mismatches.length === 0,
    verifiable: true,
    expected,
    measured: {
      wMm: measured.max[0] - measured.min[0],
      hMm: measured.max[1] - measured.min[1],
      dMm: measured.max[2] - measured.min[2],
    },
    mismatches,
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
    return `spec ok: measured ${m.wMm.toFixed(2)} × ${m.hMm.toFixed(2)} × ${m.dMm.toFixed(2)} mm matches intent within tolerance.`;
  }
  const lines: string[] = ['spec mismatch:'];
  for (const m of result.mismatches) {
    const sign = m.deltaMm >= 0 ? '+' : '';
    lines.push(
      `  ${m.axis}: expected ${m.expectedMm.toFixed(2)} mm, measured ${m.actualMm.toFixed(2)} mm (${sign}${m.deltaMm.toFixed(2)} mm, ${sign}${m.deltaPct.toFixed(1)}%).`,
    );
  }
  lines.push('Re-emit intent with corrected params to fix.');
  return lines.join('\n');
}
