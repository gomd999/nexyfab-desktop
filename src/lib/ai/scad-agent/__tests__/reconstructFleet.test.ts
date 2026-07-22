/**
 * reconstructFleet.test.ts — deterministic tests for the RECONSTRUCTION FLEET
 * (lever F). NO live LLM / render: the AI families and the gate are mocked
 * exactly as repairLoop.test.ts does. We assert the convergence contract:
 *
 *   - grounding block is present in the assembled prompt, cited as
 *     NON-AUTHORITATIVE
 *   - the prompt carries the source IR's measured fields (size / aspect /
 *     holes) and the units-unknown honesty caveat
 *   - a first-attempt gate FAIL then a post-series-switch PASS -> passed with
 *     seriesSwitched true
 *   - all-fail -> honest non-pass with the best attempt's feedback surfaced
 *   - a single family -> logged no-op (never a fake switch)
 *   - a gate-verified pass is the ONLY thing marked passed
 */

import { describe, it, expect } from 'vitest';
import {
  reconstructWithFleet,
  buildReconstructionPrompt,
  irToReferenceQuery,
} from '../reconstructFleet';
import type { AiFamily, GateVerdict, GateEvaluator } from '../repairLoop';
import type { AiClient, ToolExecutorMap } from '../types';
import { normalizeIr, type Ir } from '../../../cad-ir/schema';
import type { CitedRefPart } from '../../reference/retrieveReferenceParts';

// A no-op AI client that records the prompts it was asked to complete and
// returns plain narration (no tool calls -> runScadAgent finishes in 1 turn).
function recordingAi(label: string, sink: string[]): AiClient {
  return {
    async complete(messages) {
      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
      sink.push(`[${label}] ${lastUser?.content ?? ''}`);
      return { text: `done by ${label}.`, promptTokens: 10, completionTokens: 5 };
    },
  };
}

const noTools: ToolExecutorMap = {};

/** A gate stub driven by a scripted list of verdicts (one per attempt). */
function scriptedGate(verdicts: (GateVerdict | null)[]): GateEvaluator {
  let i = 0;
  return () => verdicts[Math.min(i++, verdicts.length - 1)];
}

/** A minimal but realistic source IR: a plate with two holes, units unknown. */
function sampleIr(): Ir {
  return normalizeIr({
    identity: { path: 'upload.stl', name: 'upload.stl', format: 'STL', bytes: 1000 },
    parse: { status: 'ok', parser: 'test' },
    extent: {
      units: null,
      units_source: 'unknown',
      bbox_min: [0, 0, 0],
      bbox_max: [80, 40, 10],
      size: [80, 40, 10],
      aspect: 'plate',
      is_2d: false,
    },
    topology: {
      solids: 1,
      surface_types: { plane: 6, cylinder: 2 },
      analytic_ratio: 1.0,
    },
    features: {
      holes: [
        { diameter: 6, through: true },
        { diameter: 6, through: true },
      ],
      hole_diameters: [6, 6],
      primitive_fit: { kind: 'box', params: {}, residual_pct: 3.2 },
    },
    mesh: { watertight: true, components: 1 },
  });
}

describe('irToReferenceQuery', () => {
  it('maps measured IR fields into a reference query (aspect, surfaces, holes)', () => {
    const q = irToReferenceQuery(sampleIr());
    expect(q.aspect).toBe('plate');
    expect(q.surfaceTypes).toMatchObject({ plane: 6, cylinder: 2 });
    expect(q.holeSig?.count).toBe(2);
    expect(q.holeSig?.diameters).toEqual([6, 6]);
    // primitive_fit kind seeds the free-text hint.
    expect(q.text).toContain('box');
  });
});

describe('buildReconstructionPrompt', () => {
  it('embeds source IR measurements and the units-unknown honesty caveat', () => {
    const prompt = buildReconstructionPrompt(sampleIr(), []);
    expect(prompt).toContain('SOURCE MEASUREMENTS');
    expect(prompt).toContain('80.00 x 40.00 x 10.00'); // size
    expect(prompt).toContain('aspect class: plate');
    expect(prompt).toContain('holes: 2 detected');
    expect(prompt).toContain('units: UNKNOWN'); // honesty caveat
    expect(prompt).toContain('VERIFIED against the source');
  });

  it('cites the grounding block as NON-AUTHORITATIVE when references exist', () => {
    const refs: CitedRefPart[] = [
      { name: 'rectangular mounting plate', size: [80, 40, 10], grade: 'A', why: 'aspect=plate, 2 holes' },
    ];
    const prompt = buildReconstructionPrompt(sampleIr(), refs);
    expect(prompt).toContain('rectangular mounting plate');
    // Explicitly framed as examples, never authoritative values.
    expect(prompt).toContain('NOT authoritative');
    expect(prompt).toContain('never copy these numbers');
  });

  it('threads the heuristic seed hint (shapeId + params + confidence) into the prompt', () => {
    const prompt = buildReconstructionPrompt(sampleIr(), [], {
      shapeId: 'cylinder',
      params: { r: 10, h: 30 },
      confidence: 82,
      summary: 'best fit: vertical cylinder',
    });
    // The classifier's identified primitive is surfaced as a strong seed ...
    expect(prompt).toContain('CLASSIFIER SEED');
    expect(prompt).toContain('identified this part as: cylinder');
    expect(prompt).toContain('r=10');
    expect(prompt).toContain('h=30');
    expect(prompt).toContain('classifier confidence 82%');
    expect(prompt).toContain('best fit: vertical cylinder');
    // ... but framed as a hint the gate still judges, never an auto-pass.
    expect(prompt).toContain('do not blindly trust');
    expect(prompt).toContain('so a wrong seed will FAIL');
    // The seed precedes the source measurements it must be checked against.
    expect(prompt.indexOf('CLASSIFIER SEED')).toBeLessThan(prompt.indexOf('SOURCE MEASUREMENTS'));
  });

  it('no-hint path is unchanged (no classifier-seed block)', () => {
    const prompt = buildReconstructionPrompt(sampleIr(), []);
    expect(prompt).not.toContain('CLASSIFIER SEED');
    // The rest of the prompt is still fully assembled.
    expect(prompt).toContain('SOURCE MEASUREMENTS');
    expect(prompt).toContain('units: UNKNOWN');
  });
});

describe('reconstructWithFleet (orchestration)', () => {
  it('gate fail then post-series-switch pass -> passed with seriesSwitched true', async () => {
    const prompts: string[] = [];
    const logs: string[] = [];
    const families: AiFamily[] = [
      { family: 'alpha', client: recordingAi('alpha', prompts) },
      { family: 'beta', client: recordingAi('beta', prompts) },
    ];
    const res = await reconstructWithFleet({
      sourceIr: sampleIr(),
      tools: noTools,
      aiFamilies: families,
      references: false, // isolate orchestration from the ref index
      maxAttempts: 3,
      switchAfter: 1,
      log: (m) => logs.push(m),
      gate: scriptedGate([
        { passed: false, feedback: 'X extent 8.00 (expected 80.00) — axis flip suspected' },
        { passed: true, feedback: 'PASS' },
      ]),
    });

    expect(res.passed).toBe(true);
    expect(res.seriesSwitched).toBe(true);
    expect(res.singleFamily).toBe(false);
    expect(res.familiesUsed).toEqual(['alpha', 'beta']);
    expect(res.attemptsUsed).toBe(2);
    // Second attempt ran on the switched family and carried the gate feedback.
    expect(prompts[1]).toContain('[beta]');
    expect(prompts[1]).toContain('axis flip suspected');
    expect(res.note).toContain('VERIFIED');
  });

  it('all attempts fail -> honest non-pass with best-attempt feedback', async () => {
    const prompts: string[] = [];
    const families: AiFamily[] = [{ family: 'alpha', client: recordingAi('alpha', prompts) }];
    const res = await reconstructWithFleet({
      sourceIr: sampleIr(),
      tools: noTools,
      aiFamilies: families,
      references: false,
      maxAttempts: 3,
      gate: scriptedGate([
        { passed: false, feedback: 'weak', score: 0.2 },
        { passed: false, feedback: 'best-fail', score: 0.8 },
        { passed: false, feedback: 'regressed', score: 0.1 },
      ]),
    });

    expect(res.passed).toBe(false);
    expect(res.attemptsUsed).toBe(3);
    // Best (highest-score) failing attempt wins the honest report.
    expect(res.verdict?.feedback).toBe('best-fail');
    expect(res.note).toContain('did NOT verify');
    expect(res.note).toContain('best-fail');
  });

  it('single family logs a no-op instead of a fake switch', async () => {
    const logs: string[] = [];
    const families: AiFamily[] = [{ family: 'alpha', client: recordingAi('alpha', []) }];
    const res = await reconstructWithFleet({
      sourceIr: sampleIr(),
      tools: noTools,
      aiFamilies: families,
      references: false,
      maxAttempts: 2,
      switchAfter: 1,
      log: (m) => logs.push(m),
      gate: scriptedGate([
        { passed: false, feedback: 'fail 1' },
        { passed: false, feedback: 'fail 2' },
      ]),
    });

    expect(res.singleFamily).toBe(true);
    expect(res.seriesSwitched).toBe(false);
    expect(res.familiesUsed).toEqual(['alpha']);
    expect(logs.some((l) => l.includes('single-family, no switch'))).toBe(true);
    expect(res.passed).toBe(false);
  });

  it('gate pass on attempt 1 stops immediately and reports references used', async () => {
    const families: AiFamily[] = [{ family: 'alpha', client: recordingAi('alpha', []) }];
    const res = await reconstructWithFleet({
      sourceIr: sampleIr(),
      tools: noTools,
      aiFamilies: families,
      // references default (true) — retrieval is deterministic; assert it is an array.
      gate: scriptedGate([{ passed: true, feedback: 'PASS' }]),
    });

    expect(res.passed).toBe(true);
    expect(res.attemptsUsed).toBe(1);
    expect(Array.isArray(res.references)).toBe(true);
  });

  it('surfaces diagnostic fields and retries unverified by default', async () => {
    const prompts: string[] = [];
    const families: AiFamily[] = [
      { family: 'alpha', client: recordingAi('alpha', prompts) },
      { family: 'beta', client: recordingAi('beta', prompts) },
    ];
    // A gate that can never measure (null) mimics the production symptom:
    // the mock proposer builds nothing, so nothing is verifiable.
    const res = await reconstructWithFleet({
      sourceIr: sampleIr(),
      tools: noTools,
      aiFamilies: families,
      references: false,
      maxAttempts: 3,
      switchAfter: 1,
      gate: scriptedGate([null, null, null]),
    });

    // Diagnostic fields name the exact break point instead of a bare non-pass.
    expect(res.gateStatus).toBe('unverified-null');
    expect(res.hasGeometry).toBe(false);
    expect(res.renderOk).toBe(false);
    expect(res.gateFeedback).toBeNull();
    expect(typeof res.scadPreview).toBe('string');
    // Default retry-on-unverified: the fleet no longer gives up after 1 attempt.
    expect(res.attemptsUsed).toBe(3);
    expect(res.seriesSwitched).toBe(true);
    expect(res.passed).toBe(false); // honest — never a fabricated pass
  });

  it('retryOnUnverified:false restores the plain stop-on-unverified behavior', async () => {
    const families: AiFamily[] = [{ family: 'alpha', client: recordingAi('alpha', []) }];
    const res = await reconstructWithFleet({
      sourceIr: sampleIr(),
      tools: noTools,
      aiFamilies: families,
      references: false,
      maxAttempts: 3,
      retryOnUnverified: false,
      gate: scriptedGate([null, null, null]),
    });
    expect(res.attemptsUsed).toBe(1);
    expect(res.gateStatus).toBe('unverified-null');
  });

  it('injects the heuristicHint into the proposer prompt (route -> fleet -> prompt)', async () => {
    const prompts: string[] = [];
    const families: AiFamily[] = [{ family: 'alpha', client: recordingAi('alpha', prompts) }];
    const res = await reconstructWithFleet({
      sourceIr: sampleIr(),
      tools: noTools,
      aiFamilies: families,
      references: false,
      heuristicHint: { shapeId: 'cylinder', params: { r: 10, h: 30 }, confidence: 82 },
      gate: scriptedGate([{ passed: true, feedback: 'PASS' }]),
    });
    // The proposer's user prompt carried the classifier seed for the right shape.
    expect(prompts[0]).toContain('CLASSIFIER SEED');
    expect(prompts[0]).toContain('identified this part as: cylinder');
    expect(prompts[0]).toContain('r=10');
    // The gate is still authoritative: pass here comes from the (scripted) gate.
    expect(res.passed).toBe(true);
  });

  it('omitting the hint leaves the proposer prompt free of a seed block', async () => {
    const prompts: string[] = [];
    const families: AiFamily[] = [{ family: 'alpha', client: recordingAi('alpha', prompts) }];
    await reconstructWithFleet({
      sourceIr: sampleIr(),
      tools: noTools,
      aiFamilies: families,
      references: false,
      gate: scriptedGate([{ passed: false, feedback: 'fail' }]),
    });
    expect(prompts[0]).not.toContain('CLASSIFIER SEED');
  });

  it('throws when no families are supplied', async () => {
    await expect(
      reconstructWithFleet({
        sourceIr: sampleIr(),
        tools: noTools,
        aiFamilies: [],
        gate: scriptedGate([{ passed: true, feedback: 'PASS' }]),
      }),
    ).rejects.toThrow(/at least one AI family/);
  });
});
