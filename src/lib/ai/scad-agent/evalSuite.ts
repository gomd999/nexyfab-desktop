/**
 * evalSuite.ts — Golden test cases for the NL→intent pipeline.
 *
 * Every prompt change, every model swap, every system-prompt tweak
 * carries the risk of silent regression: a phrase the previous version
 * handled correctly now produces a slightly different intent, and
 * nobody notices until a user complains. The eval suite is the
 * regression net: a curated set of (natural language, expected
 * intent) pairs that the cron and CI run against every prompt change.
 *
 * Scoring:
 *   - **exact**: parsed intent matches the golden intent byte-for-byte
 *     (after canonicalisation — key sort, param rounding).
 *   - **structural**: shapeId + feature types + param KEYS match,
 *     param values within tolerance. Catches "model used 50.0001
 *     instead of 50" without flagging it as a regression.
 *   - **directional**: shapeId matches and at least 50% of expected
 *     features appear. The minimum bar for "the model got the user's
 *     intent right".
 *
 * Reports are emitted as a structured `EvalSuiteResult` the cron
 * surfaces to `sendOpsAlert` when scores drop below threshold.
 */

import type { IntentInput, IntentFeature } from '@/lib/openscad-render/intentToScad';

export interface EvalCase {
  /** Stable identifier for telemetry / debug. */
  id: string;
  /** Natural-language user input. */
  prompt: string;
  /** Expected intent the LLM should produce. */
  expected: IntentInput;
  /** Optional tolerance for param value comparison (default 0.5 mm). */
  paramTolerance?: number;
}

export type MatchLevel = 'exact' | 'structural' | 'directional' | 'mismatch';

export interface EvalCaseResult {
  caseId: string;
  matchLevel: MatchLevel;
  /** Per-field diagnostic messages — empty when matchLevel='exact'. */
  details: string[];
}

export interface EvalSuiteResult {
  total: number;
  exactCount: number;
  structuralCount: number;
  directionalCount: number;
  mismatchCount: number;
  /** Pass rate: (exact + structural + directional) / total. */
  passRate: number;
  results: EvalCaseResult[];
}

function paramsClose(
  a: Record<string, number>,
  b: Record<string, number>,
  tol: number,
): { close: boolean; details: string[] } {
  const details: string[] = [];
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) {
    details.push(`param count differs (${keysA.length} vs ${keysB.length})`);
  }
  for (const k of keysA) {
    if (!(k in b)) {
      details.push(`param '${k}' missing from actual`);
      continue;
    }
    const delta = Math.abs(a[k] - b[k]);
    if (delta > tol) {
      details.push(`param '${k}': expected ${a[k]}, got ${b[k]} (delta ${delta.toFixed(3)})`);
    }
  }
  return { close: details.length === 0, details };
}

function featuresMatch(
  expected: IntentFeature[],
  actual: IntentFeature[],
  tol: number,
): { exact: boolean; structuralCount: number; details: string[] } {
  const details: string[] = [];
  // Type-by-type comparison; order matters for `exact`, but for
  // structural we match by type+params regardless of order.
  if (expected.length !== actual.length) {
    details.push(`feature count: expected ${expected.length}, got ${actual.length}`);
  }
  let structuralMatches = 0;
  for (let i = 0; i < expected.length; i++) {
    const exp = expected[i];
    const act = actual[i];
    if (!act) continue;
    if (exp.type !== act.type) {
      details.push(`feature[${i}].type: expected '${exp.type}', got '${act.type}'`);
      continue;
    }
    if (exp.params || act.params) {
      const pr = paramsClose(exp.params ?? {}, act.params ?? {}, tol);
      if (!pr.close) {
        details.push(`feature[${i}].params: ${pr.details.join('; ')}`);
      }
    }
    structuralMatches++;
  }
  return {
    exact: details.length === 0,
    structuralCount: structuralMatches,
    details,
  };
}

/** Run a single eval case and classify the match level. */
export function evalCase(c: EvalCase, actual: IntentInput): EvalCaseResult {
  const tol = c.paramTolerance ?? 0.5;
  const details: string[] = [];

  // Shape ID must match for anything above 'mismatch'.
  if (actual.shapeId !== c.expected.shapeId) {
    return {
      caseId: c.id,
      matchLevel: 'mismatch',
      details: [`shapeId: expected '${c.expected.shapeId}', got '${actual.shapeId}'`],
    };
  }

  const paramResult = paramsClose(c.expected.params, actual.params, tol);
  if (!paramResult.close) {
    details.push(...paramResult.details.map(d => `params: ${d}`));
  }

  const expFeatures = c.expected.features ?? [];
  const actFeatures = actual.features ?? [];
  const featResult = featuresMatch(expFeatures, actFeatures, tol);
  details.push(...featResult.details);

  // Classification:
  //  exact      = no diagnostic details at all.
  //  structural = shapeId matches AND params close AND feature types
  //               match (values may differ but keys are right).
  //  directional = shapeId matches AND ≥ 50% of features by type.
  //  mismatch   = shapeId matches but neither of the above (we
  //               already returned 'mismatch' for wrong shapeId).
  if (details.length === 0) return { caseId: c.id, matchLevel: 'exact', details: [] };

  // Did params close pass entirely?
  if (paramResult.close && featResult.exact) {
    return { caseId: c.id, matchLevel: 'structural', details };
  }
  // Did params close but features differ on values only?
  const paramsOk = paramResult.close;
  const halfFeatures = expFeatures.length === 0 ||
    featResult.structuralCount >= Math.ceil(expFeatures.length / 2);
  if (paramsOk && halfFeatures) {
    return { caseId: c.id, matchLevel: 'directional', details };
  }
  if (halfFeatures) {
    return { caseId: c.id, matchLevel: 'directional', details };
  }
  return { caseId: c.id, matchLevel: 'mismatch', details };
}

export type GenerateFn = (prompt: string) => Promise<IntentInput | null> | IntentInput | null;

/**
 * Run every case through the supplied generator and aggregate results.
 * `generate` is the function under test — typically the LLM-backed
 * agent path; in unit tests it's mocked to return canned intents so
 * the suite shape can be validated.
 */
export async function runEvalSuite(
  cases: EvalCase[],
  generate: GenerateFn,
): Promise<EvalSuiteResult> {
  const results: EvalCaseResult[] = [];
  for (const c of cases) {
    const actual = await generate(c.prompt);
    if (!actual) {
      results.push({
        caseId: c.id,
        matchLevel: 'mismatch',
        details: ['generator returned null'],
      });
      continue;
    }
    results.push(evalCase(c, actual));
  }
  const counts = {
    exact: 0, structural: 0, directional: 0, mismatch: 0,
  };
  for (const r of results) counts[r.matchLevel]++;
  return {
    total: results.length,
    exactCount: counts.exact,
    structuralCount: counts.structural,
    directionalCount: counts.directional,
    mismatchCount: counts.mismatch,
    passRate: results.length === 0
      ? 1
      : (counts.exact + counts.structural + counts.directional) / results.length,
    results,
  };
}

/** Curated seed cases — covers the four main shape-class branches.
 *  Expand with real customer prompts captured from the agent log. */
export const SEED_CASES: EvalCase[] = [
  {
    id: 'seed.box-with-hole',
    prompt: 'A 50 by 30 by 20 millimetre block with an 8mm hole through the centre',
    expected: {
      shapeId: 'box',
      params: { width_mm: 50, height_mm: 30, depth_mm: 20 },
      features: [{ type: 'hole', params: { diameter_mm: 8 } }],
    },
  },
  {
    id: 'seed.cylinder-rod',
    prompt: '20mm diameter aluminum rod, 100mm long',
    expected: {
      shapeId: 'cylinder',
      params: { diameter_mm: 20, height_mm: 100 },
    },
  },
  {
    id: 'seed.sphere',
    prompt: 'A 30mm diameter ball',
    expected: {
      shapeId: 'sphere',
      params: { diameter_mm: 30 },
    },
  },
  {
    id: 'seed.box-rounded',
    prompt: 'A 40×40×40mm cube with 5mm rounded corners',
    expected: {
      shapeId: 'box',
      params: { width_mm: 40, height_mm: 40, depth_mm: 40 },
      features: [{ type: 'fillet', params: { radius_mm: 5 } }],
    },
  },
];
