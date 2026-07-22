/**
 * repairLoop.test.ts — deterministic orchestration tests for the
 * self-correcting REPAIR loop (lever A) + vision critic (lever E).
 *
 * NO live LLM / vision calls: the AI client, the gate, and the vision critic
 * are all mocked. We assert the orchestration contract:
 *   - a failing gate triggers a repair whose prompt carries the feedback verbatim
 *   - N same-family failures trigger a series-switch (2+ families)
 *   - a single family logs a no-op instead of a fake switch
 *   - a passing gate stops the loop immediately
 *   - exhausted retries return the BEST attempt with an honest non-pass verdict
 *   - the vision critic can request a repair on a geometric pass, but never
 *     flips the authoritative pass into a fail
 */

import { describe, it, expect } from 'vitest';
import {
  runRepairLoop,
  type AiFamily,
  type GateVerdict,
  type GateEvaluator,
  type VisionCritic,
} from '../repairLoop';
import type { AiClient, ToolExecutorMap, AgentSession } from '../types';

// A no-op AI client that records the prompts it was asked to complete, and
// returns plain narration (no tool calls → runScadAgent finishes in 1 turn).
function recordingAi(label: string, sink: string[]): AiClient {
  return {
    async complete(messages) {
      // Last user message is the turn's prompt (system is index 0).
      const lastUser = [...messages].reverse().find(m => m.role === 'user');
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

describe('runRepairLoop (orchestration)', () => {
  it('passing gate on attempt 1 stops the loop', async () => {
    const prompts: string[] = [];
    const families: AiFamily[] = [{ family: 'alpha', client: recordingAi('alpha', prompts) }];
    const res = await runRepairLoop({
      userPrompt: 'make a 50mm cube',
      aiFamilies: families,
      tools: noTools,
      gate: scriptedGate([{ passed: true, feedback: 'PASS' }]),
    });

    expect(res.passed).toBe(true);
    expect(res.attemptsUsed).toBe(1);
    expect(res.seriesSwitched).toBe(false);
    expect(prompts.length).toBe(1);
    expect(prompts[0]).toContain('make a 50mm cube');
  });

  it('failing gate triggers a repair carrying the feedback verbatim', async () => {
    const prompts: string[] = [];
    const families: AiFamily[] = [{ family: 'alpha', client: recordingAi('alpha', prompts) }];
    const feedback = 'X length 5.00 (expected 50.00) — 90% too small. Correct by 45 units.';
    const res = await runRepairLoop({
      userPrompt: 'make a 50mm cube',
      aiFamilies: families,
      tools: noTools,
      maxAttempts: 2,
      gate: scriptedGate([
        { passed: false, feedback },
        { passed: true, feedback: 'PASS' },
      ]),
    });

    expect(res.attemptsUsed).toBe(2);
    expect(res.passed).toBe(true);
    // The second prompt must include the gate feedback verbatim.
    expect(prompts.length).toBe(2);
    expect(prompts[1]).toContain(feedback);
    expect(prompts[1]).toContain('did NOT pass verification');
  });

  it('N failures trigger a series-switch to a different family', async () => {
    const prompts: string[] = [];
    const logs: string[] = [];
    const families: AiFamily[] = [
      { family: 'alpha', client: recordingAi('alpha', prompts) },
      { family: 'beta', client: recordingAi('beta', prompts) },
    ];
    const res = await runRepairLoop({
      userPrompt: 'make a bracket',
      aiFamilies: families,
      tools: noTools,
      maxAttempts: 3,
      switchAfter: 1,
      log: (m) => logs.push(m),
      gate: scriptedGate([
        { passed: false, feedback: 'fail 1' },
        { passed: false, feedback: 'fail 2' },
        { passed: false, feedback: 'fail 3' },
      ]),
    });

    expect(res.seriesSwitched).toBe(true);
    expect(res.singleFamily).toBe(false);
    // alpha ran attempt 1, then switched to beta for attempts 2 and 3.
    expect(prompts[0]).toContain('[alpha]');
    expect(prompts[1]).toContain('[beta]');
    expect(res.familiesUsed).toEqual(['alpha', 'beta']);
    expect(logs.some(l => l.includes('series-switch'))).toBe(true);
    // Exhausted, never passed → honest non-pass verdict returned.
    expect(res.passed).toBe(false);
    expect(res.finalVerdict?.passed).toBe(false);
  });

  it('single family logs a no-op instead of a fake switch', async () => {
    const prompts: string[] = [];
    const logs: string[] = [];
    const families: AiFamily[] = [{ family: 'alpha', client: recordingAi('alpha', prompts) }];
    const res = await runRepairLoop({
      userPrompt: 'make a gear',
      aiFamilies: families,
      tools: noTools,
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
    expect(logs.some(l => l.includes('single-family, no switch'))).toBe(true);
    expect(res.passed).toBe(false);
  });

  it('exhausted retries return the BEST attempt with an honest verdict', async () => {
    const prompts: string[] = [];
    const families: AiFamily[] = [{ family: 'alpha', client: recordingAi('alpha', prompts) }];
    // Attempt 2 is the strongest failing attempt (higher score) — it must win.
    const res = await runRepairLoop({
      userPrompt: 'make a flange',
      aiFamilies: families,
      tools: noTools,
      maxAttempts: 3,
      gate: scriptedGate([
        { passed: false, feedback: 'weak', score: 0.2 },
        { passed: false, feedback: 'best-fail', score: 0.8 },
        { passed: false, feedback: 'regressed', score: 0.1 },
      ]),
    });

    expect(res.attemptsUsed).toBe(3);
    expect(res.passed).toBe(false);
    expect(res.finalVerdict?.feedback).toBe('best-fail');
  });

  it('unverified gate (null) with no vision stops without claiming a pass', async () => {
    const prompts: string[] = [];
    const families: AiFamily[] = [{ family: 'alpha', client: recordingAi('alpha', prompts) }];
    const res = await runRepairLoop({
      userPrompt: 'make something unverifiable',
      aiFamilies: families,
      tools: noTools,
      maxAttempts: 3,
      gate: scriptedGate([null]),
    });

    expect(res.attemptsUsed).toBe(1); // no actionable signal → stop
    expect(res.passed).toBe(false);
    expect(res.finalVerdict).toBeNull();
  });

  it('retryOnUnverified: a null verdict now retries and series-switches (not a silent stop)', async () => {
    const prompts: string[] = [];
    const logs: string[] = [];
    const families: AiFamily[] = [
      { family: 'alpha', client: recordingAi('alpha', prompts) },
      { family: 'beta', client: recordingAi('beta', prompts) },
    ];
    const res = await runRepairLoop({
      userPrompt: 'reconstruct a box',
      aiFamilies: families,
      tools: noTools,
      maxAttempts: 3,
      switchAfter: 1,
      retryOnUnverified: true,
      log: (m) => logs.push(m),
      gate: scriptedGate([null, null, null]),
    });

    // Unverified is now actionable: the loop keeps trying instead of stopping at 1.
    expect(res.attemptsUsed).toBe(3);
    expect(res.seriesSwitched).toBe(true);
    expect(res.familiesUsed).toEqual(['alpha', 'beta']);
    expect(res.passed).toBe(false);
    expect(res.finalVerdict).toBeNull(); // still honest: never a fabricated pass
    // The retry prompt explains the concrete cause + fix.
    expect(prompts[1]).toContain('NO measurable geometry');
  });

  it('retryOnUnverified stays OFF by default: null verdict still stops at 1', async () => {
    const families: AiFamily[] = [
      { family: 'alpha', client: recordingAi('alpha', []) },
      { family: 'beta', client: recordingAi('beta', []) },
    ];
    const res = await runRepairLoop({
      userPrompt: 'x',
      aiFamilies: families,
      tools: noTools,
      maxAttempts: 3,
      gate: scriptedGate([null, null, null]),
    });
    expect(res.attemptsUsed).toBe(1);
    expect(res.seriesSwitched).toBe(false);
  });

  it('vision critic requests a repair on a geometric pass but never flips it to fail', async () => {
    const prompts: string[] = [];
    const families: AiFamily[] = [{ family: 'alpha', client: recordingAi('alpha', prompts) }];
    // Geometry passes both attempts; vision flags attempt 1, accepts attempt 2.
    let visionCall = 0;
    const visionCritic: VisionCritic = async () => {
      visionCall += 1;
      return visionCall === 1
        ? { match: false, note: 'looks like a plain disk, not a gear' }
        : { match: true, note: 'now reads as a gear' };
    };
    const res = await runRepairLoop({
      userPrompt: 'make a gear',
      aiFamilies: families,
      tools: noTools,
      maxAttempts: 3,
      gate: scriptedGate([
        { passed: true, feedback: 'PASS' },
        { passed: true, feedback: 'PASS' },
      ]),
      visionCritic,
    });

    // A repair happened (2 attempts) driven purely by the semantic critic,
    // and the second prompt carried the vision note.
    expect(res.attemptsUsed).toBe(2);
    expect(prompts[1]).toContain('looks like a plain disk');
    // Authoritative verdict is still the geometric pass — vision never fails it.
    expect(res.passed).toBe(true);
    expect(res.visionFlagged).toBe(false); // best attempt (2) is not flagged
  });

  it('vision-flagged geometric pass, if never resolved, still returns pass (authoritative gate)', async () => {
    const families: AiFamily[] = [{ family: 'alpha', client: recordingAi('alpha', []) }];
    const visionCritic: VisionCritic = async () => ({ match: false, note: 'still wrong kind' });
    const res = await runRepairLoop({
      userPrompt: 'make a gear',
      aiFamilies: families,
      tools: noTools,
      maxAttempts: 2,
      gate: scriptedGate([
        { passed: true, feedback: 'PASS' },
        { passed: true, feedback: 'PASS' },
      ]),
      visionCritic,
    });

    expect(res.attemptsUsed).toBe(2);
    // Geometric gate passed every attempt → authoritative pass, even though
    // vision remained unhappy. Vision cannot manufacture a fail.
    expect(res.passed).toBe(true);
  });

  it('runs at least once and never throws on empty tools', async () => {
    const families: AiFamily[] = [{ family: 'alpha', client: recordingAi('alpha', []) }];
    const res = await runRepairLoop({
      userPrompt: 'anything',
      aiFamilies: families,
      tools: noTools,
      gate: scriptedGate([{ passed: true, feedback: 'PASS' }]),
    });
    const s: AgentSession = res.session;
    expect(s).toBeTruthy();
    expect(res.events.length).toBeGreaterThan(0);
  });

  it('throws when no families are supplied', async () => {
    await expect(
      runRepairLoop({
        userPrompt: 'x',
        aiFamilies: [],
        tools: noTools,
        gate: scriptedGate([{ passed: true, feedback: 'PASS' }]),
      }),
    ).rejects.toThrow(/at least one AI family/);
  });
});
