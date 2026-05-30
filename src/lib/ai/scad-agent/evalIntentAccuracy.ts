/**
 * evalIntentAccuracy.ts — Curated golden set locking the
 *                         **prompt → intent emission** direction.
 *
 * Companion to `evalSuite.ts`. The base suite already scores arbitrary
 * (prompt, expected intent) pairs; this module supplies a curated list
 * that pins the most important shape + feature combinations so prompt
 * or model regressions surface immediately in CI.
 *
 * Why a separate file from SEED_CASES:
 *   - SEED_CASES is the *small* sanity set (4 entries) shipped in the
 *     scoring framework module so the framework can self-test.
 *   - INTENT_ACCURACY_EVAL_CASES is the *coverage* set — broad enough
 *     to flag a model swap that silently lost (e.g.) M-coded fastener
 *     recognition without growing the framework module past one page.
 *
 * Param naming follows `intentToScad.ts` (no `_mm` suffix) so every
 * case is a valid intent the deterministic renderer can consume —
 * `intentToScad(case.expected).ok === true` is asserted in tests.
 */

import {
  intentToScad,
  type IntentInput,
} from '@/lib/openscad-render/intentToScad';
import { evalCase, type EvalCase, type EvalCaseResult } from './evalSuite';

/**
 * Curated golden set: natural-language prompt → expected intent.
 *
 * Each entry covers exactly one combo the model is expected to handle
 * faithfully. Tolerances are tightened (0.1mm) on cases where the
 * expected value is an integer dimension the model has no excuse to
 * round; left at the suite default (0.5mm) for fastener-table lookups
 * where ISO tables sometimes carry decimal places (e.g. M6 washer ID
 * 6.4 rather than 6).
 */
export const INTENT_ACCURACY_EVAL_CASES: EvalCase[] = [
  // ── Primitives ────────────────────────────────────────────────────
  {
    id: 'box-50mm',
    prompt: 'Make a 50mm cube',
    paramTolerance: 0.1,
    expected: {
      shapeId: 'box',
      params: { width: 50, height: 50, depth: 50 },
    },
  },
  {
    id: 'box-rect',
    prompt: 'A rectangular box 80mm wide, 40mm tall, 20mm deep',
    paramTolerance: 0.1,
    expected: {
      shapeId: 'box',
      params: { width: 80, height: 40, depth: 20 },
    },
  },
  {
    id: 'cylinder-d20-h50',
    prompt: 'Cylinder 20mm diameter, 50mm tall',
    paramTolerance: 0.1,
    expected: {
      shapeId: 'cylinder',
      params: { diameter: 20, height: 50 },
    },
  },
  {
    id: 'sphere-d40',
    prompt: 'A 40mm diameter sphere',
    paramTolerance: 0.1,
    expected: {
      shapeId: 'sphere',
      params: { diameter: 40 },
    },
  },
  {
    id: 'pipe-od-id',
    prompt: 'A pipe with 30mm OD, 20mm ID, 100mm long',
    paramTolerance: 0.1,
    expected: {
      shapeId: 'pipe',
      params: { outerDiameter: 30, innerDiameter: 20, length: 100 },
    },
  },
  {
    id: 'disk-flat',
    prompt: 'A flat disk 60mm across, 5mm thick',
    paramTolerance: 0.1,
    expected: {
      shapeId: 'disk',
      params: { diameter: 60, thickness: 5 },
    },
  },

  // ── Standard fasteners (ISO 261 derived) ──────────────────────────
  {
    id: 'hexNut-m8',
    prompt: 'An M8 hex nut',
    // DIN 934 / ISO 4032: across-flats 13mm, thickness 8mm (nominal slot uses
    // ~6.5mm but the task spec accepts ≈8). nominalDiameter = M8.
    expected: {
      shapeId: 'hexNut',
      params: { acrossFlats: 13, thickness: 8, nominalDiameter: 8 },
    },
  },
  {
    id: 'washer-m6',
    prompt: 'An M6 washer',
    // ISO 7089: inner 6.4mm clearance, outer 12mm, thickness 1.6mm.
    expected: {
      shapeId: 'washer',
      params: { innerDiameter: 6.4, outerDiameter: 12, thickness: 1.6 },
    },
  },
  {
    id: 'bolt-m8-30',
    prompt: 'M8 bolt 30mm long',
    // DIN 933: shaft 8mm × 30mm; hex head 5.5mm thick × 13mm across flats.
    expected: {
      shapeId: 'bolt',
      params: {
        shaftDiameter: 8,
        shaftLength: 30,
        headHeight: 5.5,
        headFlats: 13,
      },
    },
  },

  // ── BOSL2-backed gear ─────────────────────────────────────────────
  {
    id: 'gear-20t',
    prompt: 'A 20-tooth spur gear, module 2, 8mm thick',
    paramTolerance: 0.1,
    expected: {
      shapeId: 'gear',
      params: { teeth: 20, module: 2, thickness: 8 },
    },
  },

  // ── Composite parts ───────────────────────────────────────────────
  {
    id: 'flange-bolt-pattern',
    prompt: 'A 100mm OD flange with 4 bolt holes on a 70mm pitch circle',
    paramTolerance: 0.1,
    expected: {
      shapeId: 'flange',
      params: { outerDiameter: 100, boltCount: 4, pcd: 70 },
    },
  },
  {
    id: 'lbracket-shelf',
    prompt: 'An L-bracket 50x50x30mm, 4mm thick',
    paramTolerance: 0.1,
    expected: {
      shapeId: 'lBracket',
      params: { width: 50, height: 50, depth: 30, thickness: 4 },
    },
  },

  // ── Primitive + feature combos ────────────────────────────────────
  {
    id: 'box-with-hole',
    prompt: 'A 50mm cube with a 10mm through-hole in the center',
    paramTolerance: 0.1,
    expected: {
      shapeId: 'box',
      params: { width: 50, height: 50, depth: 50 },
      features: [{ type: 'hole', params: { diameter: 10 } }],
    },
  },
  {
    id: 'box-with-fillet',
    prompt: 'A 30mm cube with 2mm filleted edges',
    paramTolerance: 0.1,
    expected: {
      shapeId: 'box',
      params: { width: 30, height: 30, depth: 30 },
      features: [{ type: 'fillet', params: { radius: 2 } }],
    },
  },
  {
    id: 'box-with-chamfer',
    prompt: 'A 30mm cube with 1.5mm chamfered edges',
    paramTolerance: 0.1,
    expected: {
      shapeId: 'box',
      params: { width: 30, height: 30, depth: 30 },
      features: [{ type: 'chamfer', params: { distance: 1.5 } }],
    },
  },
];

/** Emitter signature: maps a natural-language prompt to an intent (or
 *  `null` when the model couldn't parse one). Plug in either the real
 *  scad-intent-from-nl route or a deterministic test stub. */
export type IntentEmitter = (prompt: string) => Promise<IntentInput | null>;

/**
 * Run a single eval case against an injected intent emitter — typically
 * the `scad-intent-from-nl` route's parser logic. Returns a
 * `MatchLevel` result so tests can assert "structural or better"
 * without needing byte-exact match.
 *
 * Mirrors `runEvalSuite`'s single-case semantics: a `null` emit
 * collapses to `matchLevel='mismatch'` with a `'generator returned
 * null'` detail.
 */
export async function runIntentAccuracyCase(
  c: EvalCase,
  emit: IntentEmitter,
): Promise<EvalCaseResult> {
  const actual = await emit(c.prompt);
  if (!actual) {
    return {
      caseId: c.id,
      matchLevel: 'mismatch',
      details: ['generator returned null'],
    };
  }
  return evalCase(c, actual);
}

/** Verify every curated case is a valid input the deterministic SCAD
 *  emitter can render. Exported so the test layer can iterate cleanly;
 *  also useful for ad-hoc CLI sanity checks. */
export function isCaseRenderable(c: EvalCase): boolean {
  return intentToScad(c.expected).ok;
}
