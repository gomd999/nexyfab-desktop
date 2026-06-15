/**
 * evalIntentAccuracy.test.ts — Locks the curated NL→intent golden set.
 *
 * The point of these tests is **curation correctness**, not AI quality.
 * We assert:
 *   - the required IDs are present (any drop = explicit deletion not silent loss),
 *   - every expected.shapeId is one the deterministic SCAD path supports,
 *   - every expected payload is renderable end-to-end via `intentToScad`
 *     (so the golden is itself valid input to the system),
 *   - feature types are in the SUPPORTED_FEATURES set,
 *   - and the `runIntentAccuracyCase` wrapper classifies stub responses
 *     the same way `evalCase` does.
 *
 * No real AI is invoked; the only "model" used is a hand-coded stub
 * that returns a chosen intent so we can pin the wrapper's behaviour.
 */

import { describe, it, expect } from 'vitest';
import {
  INTENT_ACCURACY_EVAL_CASES,
  runIntentAccuracyCase,
  isCaseRenderable,
  type IntentEmitter,
} from '../evalIntentAccuracy';
import { intentToScad, type IntentInput } from '@/lib/openscad-render/intentToScad';

// Mirrors the SUPPORTED_SHAPES / SUPPORTED_FEATURES sets in intentToScad.ts.
// Kept local rather than re-exported to avoid changing the renderer's public
// surface area just for tests; if those sets change, this list updates too.
const SUPPORTED_SHAPES = new Set<string>([
  'box', 'cylinder', 'sphere', 'cone', 'torus', 'wedge', 'pipe', 'disk',
  'hexNut', 'washer', 'iBeam', 'lBracket', 'flange', 'bolt',
  'gear', 'threadedRod', 'roundedBox', 'screw', 'springCoil',
  'sweep', 'loft', 'fanBlade',
  'heatsink', 'manifold', 'turbine',
  'enclosure', 'tBeam', 'uChannel', 'zPurlin',
  'rackUnit', 'shelfBracket', 'hingedBracket', 'motorMount',
  'nameplate', 'phoneStand', 'coaster', 'wallHook', 'drawerKnob', 'planterPot',
]);

const SUPPORTED_FEATURES = new Set<string>([
  'hole', 'fillet', 'chamfer', 'mirror', 'linearPattern', 'circularPattern',
  'scale', 'shell', 'thread', 'draft', 'twist', 'rotate',
]);

const REQUIRED_IDS = [
  'box-50mm',
  'box-rect',
  'cylinder-d20-h50',
  'sphere-d40',
  'pipe-od-id',
  'disk-flat',
  'hexNut-m8',
  'washer-m6',
  'bolt-m8-30',
  'gear-20t',
  'flange-bolt-pattern',
  'lbracket-shelf',
  'box-with-hole',
  'box-with-fillet',
  'box-with-chamfer',
] as const;

describe('INTENT_ACCURACY_EVAL_CASES · curation', () => {
  it('ships every required case id', () => {
    const ids = INTENT_ACCURACY_EVAL_CASES.map(c => c.id);
    for (const required of REQUIRED_IDS) {
      expect(ids).toContain(required);
    }
  });

  it('has unique case ids (no copy-paste duplicates)', () => {
    const ids = INTENT_ACCURACY_EVAL_CASES.map(c => c.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('every case has a non-empty English prompt', () => {
    for (const c of INTENT_ACCURACY_EVAL_CASES) {
      expect(c.prompt.length).toBeGreaterThan(0);
      // Sanity: at least one ASCII letter (catches accidental KR-only prompts
      // here — the curated set is intentionally English to lock the model's
      // baseline behaviour before we layer in localised variants).
      expect(/[A-Za-z]/.test(c.prompt)).toBe(true);
    }
  });

  it('every expected.shapeId is in SUPPORTED_SHAPES', () => {
    for (const c of INTENT_ACCURACY_EVAL_CASES) {
      expect(SUPPORTED_SHAPES.has(c.expected.shapeId)).toBe(true);
    }
  });

  it('every expected.features[].type is in SUPPORTED_FEATURES', () => {
    for (const c of INTENT_ACCURACY_EVAL_CASES) {
      for (const f of c.expected.features ?? []) {
        expect(SUPPORTED_FEATURES.has(f.type)).toBe(true);
      }
    }
  });

  it('every expected intent renders cleanly via intentToScad', () => {
    for (const c of INTENT_ACCURACY_EVAL_CASES) {
      const r = intentToScad(c.expected);
      if (!r.ok) {
        // Surface the offending case + reason in the failure message.
        throw new Error(`case '${c.id}' failed render: ${r.reason}`);
      }
      expect(r.ok).toBe(true);
      // The emitted SCAD should mention the canonical primitive/feature
      // for each shape; we don't pin the exact opcode but it must be
      // non-empty source.
      expect(r.scad.length).toBeGreaterThan(0);
    }
  });

  it('isCaseRenderable agrees with the direct intentToScad check', () => {
    for (const c of INTENT_ACCURACY_EVAL_CASES) {
      expect(isCaseRenderable(c)).toBe(true);
    }
  });
});

// ── runIntentAccuracyCase wrapper behaviour ──────────────────────────
describe('runIntentAccuracyCase · scoring wrapper', () => {
  const sample = INTENT_ACCURACY_EVAL_CASES.find(c => c.id === 'box-50mm')!;

  it('returns exact when the emitter echoes the expected intent', async () => {
    const emit: IntentEmitter = async () => sample.expected;
    const r = await runIntentAccuracyCase(sample, emit);
    expect(r.caseId).toBe('box-50mm');
    expect(r.matchLevel).toBe('exact');
    expect(r.details).toEqual([]);
  });

  it('returns mismatch when the emitter picks the wrong shapeId', async () => {
    const wrong: IntentInput = {
      shapeId: 'sphere',
      params: { diameter: 50 },
    };
    const emit: IntentEmitter = async () => wrong;
    const r = await runIntentAccuracyCase(sample, emit);
    expect(r.matchLevel).toBe('mismatch');
    expect(r.details[0]).toMatch(/shapeId/);
  });

  it('returns exact when params drift within tolerance (0.3mm of 0.5mm default)', async () => {
    // Use a default-tolerance case so a 0.3mm drift is within bounds.
    // The 'hexNut-m8' case has no custom tolerance → default 0.5mm applies.
    const hexNut = INTENT_ACCURACY_EVAL_CASES.find(c => c.id === 'hexNut-m8')!;
    const drifted: IntentInput = {
      shapeId: 'hexNut',
      params: {
        acrossFlats: 13.3,        // +0.3 from 13
        thickness: 6.8,           // +0.3 from corrected 6.5
        nominalDiameter: 8.0,
      },
    };
    const emit: IntentEmitter = async () => drifted;
    const r = await runIntentAccuracyCase(hexNut, emit);
    // 0.3 < 0.5 default tolerance → no details accumulate → exact.
    expect(r.matchLevel).toBe('exact');
  });

  it('returns mismatch when the emitter resolves to null', async () => {
    const emit: IntentEmitter = async () => null;
    const r = await runIntentAccuracyCase(sample, emit);
    expect(r.matchLevel).toBe('mismatch');
    expect(r.details[0]).toMatch(/null/);
  });
});
