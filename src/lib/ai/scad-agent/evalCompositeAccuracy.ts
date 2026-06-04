/**
 * evalCompositeAccuracy.ts — golden set for the COMPOSITE fallback path (W3 of
 * ADR-015).
 *
 * INTENT_ACCURACY_EVAL_CASES pins single-primitive prompt→intent emission. A
 * composite (add_composite_intent) is not a single primitive, so it needs its
 * own golden set: each case is a non-whitelisted shape expressed as a boolean
 * composition of whitelisted primitives, with the outer envelope the verifier
 * gates against.
 *
 * The deterministic eval (run in tests, no model call) asserts each golden case
 * is SELF-CONSISTENT end-to-end:
 *   1. compositeIntentToScad renders it,
 *   2. compositeExpectedBbox equals the declared envelope, and
 *   3. verifyCompositeAgainstSpec passes when the part is built to spec.
 * That locks the composite pipeline so a regression in any stage surfaces in CI,
 * exactly as the primitive eval does for intentToScad.
 */

import type { IntentInput } from '@/lib/openscad-render/intentToScad';
import {
  compositeIntentToScad,
  compositeExpectedBbox,
  verifyCompositeAgainstSpec,
  type CompositePart,
} from './compositeIntent';
import type { MeasuredBbox } from './specVerification';

const box = (width: number, height: number, depth: number): IntentInput => ({
  shapeId: 'box',
  params: { width, height, depth },
});
const cyl = (diameter: number, height: number): IntentInput => ({
  shapeId: 'cylinder',
  params: { diameter, height },
});

export interface CompositeEvalCase {
  id: string;
  /** Natural-language prompt the model would receive. */
  prompt: string;
  /** Golden composition (the parts a correct model would emit). */
  parts: CompositePart[];
  /** Expected outer envelope in mm — must equal compositeExpectedBbox(parts). */
  expectedBbox: { wMm: number; hMm: number; dMm: number };
  /** Tolerance for the envelope assertion (mm). */
  bboxTolerance?: number;
}

/**
 * Curated composite golden set. Each is a shape with no single whitelisted
 * primitive, expressed as a boolean composition. Envelopes are the union of the
 * placed ADD parts (subtract/intersect never grow the box).
 */
export const COMPOSITE_EVAL_CASES: CompositeEvalCase[] = [
  {
    // Two bars meeting at a corner → an L. Add-only union ⇒ exact envelope.
    id: 'l-bracket',
    prompt: 'An L-shaped bracket, 40mm long, 40mm tall, 20mm deep, 10mm thick walls',
    parts: [
      { intent: box(40, 10, 20), op: 'add', at: [0, 0, 0] },
      { intent: box(10, 40, 20), op: 'add', at: [-15, 15, 0] },
    ],
    expectedBbox: { wMm: 40, hMm: 40, dMm: 20 }, // x[-20..20], y[-5..35], z[-10..10]
  },
  {
    // A plate with a bored hole — subtract never grows the envelope.
    id: 'slotted-plate',
    prompt: 'A 60×40 plate, 5mm thick, with a 10mm hole through the middle',
    parts: [
      { intent: box(60, 40, 5), op: 'add' },
      { intent: cyl(10, 10), op: 'subtract' },
    ],
    expectedBbox: { wMm: 60, hMm: 40, dMm: 5 },
  },
  {
    // Two coaxial cylinders stacked → a stepped shaft.
    id: 'stepped-shaft',
    prompt: 'A stepped shaft: 20mm dia × 30mm, then 12mm dia × 20mm on top',
    parts: [
      { intent: cyl(20, 30), op: 'add', at: [0, 0, 0] },
      { intent: cyl(12, 20), op: 'add', at: [0, 0, 25] },
    ],
    expectedBbox: { wMm: 20, hMm: 20, dMm: 50 }, // z[-15..35]
  },
  {
    // A cross / plus made of two crossing bars.
    id: 'cross-bar',
    prompt: 'A plus-shaped bracket from two 50×10 bars crossing at the centre, 10mm deep',
    parts: [
      { intent: box(50, 10, 10), op: 'add' },
      { intent: box(10, 50, 10), op: 'add' },
    ],
    expectedBbox: { wMm: 50, hMm: 50, dMm: 10 },
  },
];

export interface CompositeEvalResult {
  id: string;
  renders: boolean;
  bboxMatches: boolean;
  verifies: boolean;
  pass: boolean;
  details: string[];
}

/** Build a centred MeasuredBbox of the given size (a part built exactly to spec). */
function measuredOf(size: { wMm: number; hMm: number; dMm: number }): MeasuredBbox {
  return {
    min: [-size.wMm / 2, -size.hMm / 2, -size.dMm / 2],
    max: [size.wMm / 2, size.hMm / 2, size.dMm / 2],
  };
}

/**
 * Deterministic self-consistency score for a golden composite case. No model
 * call — validates the pipeline (render → envelope → verify) agrees with the
 * declared envelope.
 */
export function evalCompositeCase(c: CompositeEvalCase): CompositeEvalResult {
  const details: string[] = [];
  const tol = c.bboxTolerance ?? 0.1;

  const scad = compositeIntentToScad(c.parts);
  const renders = scad.ok;
  if (!renders) details.push(`render failed: ${(scad as { reason: string }).reason}`);

  const bb = compositeExpectedBbox(c.parts);
  let bboxMatches = false;
  if (!bb) {
    details.push('compositeExpectedBbox returned null (an add part has no closed-form bbox)');
  } else {
    const dW = Math.abs(bb.wMm - c.expectedBbox.wMm);
    const dH = Math.abs(bb.hMm - c.expectedBbox.hMm);
    const dD = Math.abs(bb.dMm - c.expectedBbox.dMm);
    bboxMatches = dW <= tol && dH <= tol && dD <= tol;
    if (!bboxMatches) {
      details.push(`envelope ${bb.wMm}×${bb.hMm}×${bb.dMm} ≠ expected ${c.expectedBbox.wMm}×${c.expectedBbox.hMm}×${c.expectedBbox.dMm}`);
    }
  }

  // A part built exactly to the envelope must verify clean.
  const verifyResult = verifyCompositeAgainstSpec(c.parts, measuredOf(c.expectedBbox));
  const verifies = verifyResult.verifiable && verifyResult.ok;
  if (!verifies) details.push(`verifyCompositeAgainstSpec failed (verifiable=${verifyResult.verifiable}, mismatches=${verifyResult.mismatches.length})`);

  return { id: c.id, renders, bboxMatches, verifies, pass: renders && bboxMatches && verifies, details };
}
