// @vitest-environment node
/**
 * stepBurnIn — kernel-trust metric: a diverse corpus of solids must round-trip
 * through STEP with volume preserved. Runs over the real opencascade.js via
 * createNodeOcctBridge (skips without the wasm).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcctNode } from '@/lib/occt/nodeOcctLoader';
import { createNodeOcctBridge } from '@/lib/occt/nodeOcctBridge';
import { createKSeriesKernel, type SolidKernel } from './solidKernel';
import { runStepBurnIn, defaultBurnInCases, adversarialBurnInCases, pathologicalBurnInCases } from './stepBurnIn';

let okLoad = false;
let kernel: SolidKernel;

beforeAll(async () => {
  const r = await loadOcctNode();
  if (r.ok && r.oc) { kernel = createKSeriesKernel(createNodeOcctBridge(r.oc)); okLoad = true; }
  else console.warn(`[stepBurnIn] skipped — ${r.reason}`);
}, 60_000);

describe('stepBurnIn', () => {
  it('has a diverse, non-trivial corpus', () => {
    const cases = defaultBurnInCases();
    expect(cases.length).toBeGreaterThanOrEqual(15);
    // families represented
    const labels = cases.map((c) => c.label).join(' ');
    for (const family of ['box', 'cyl', 'cut box', 'fillet box', 'chamfer box']) {
      expect(labels).toContain(family);
    }
  });

  it('round-trips the whole corpus through STEP with volume preserved', async () => {
    if (!okLoad) return;
    const report = await runStepBurnIn(kernel);
     
    console.log(`[stepBurnIn] ${report.passed}/${report.total} passed (rate ${(report.passRate * 100).toFixed(0)}%)`);
    if (report.failures.length) {
       
      console.log('[stepBurnIn] failures:', JSON.stringify(report.failures, null, 2));
    }
    expect(report.total).toBeGreaterThanOrEqual(15);
    // Every generated solid must survive STEP I/O with its volume intact.
    expect(report.passRate).toBe(1);
  }, 120_000);

  it('has expanded adversarial + pathological corpora with diverse families', () => {
    const adv = adversarialBurnInCases();
    const path = pathologicalBurnInCases();
    expect(adv.length).toBeGreaterThanOrEqual(20);
    expect(path.length).toBeGreaterThanOrEqual(6);
    const advLabels = adv.map((c) => c.label).join(' ');
    // non-box profiles, partial revolves, and boolean variety must be present
    for (const family of ['L-shape', 'triangle', 'hex', 'wedge', 'annulus', 'union', 'intersect', 'triple-cut']) {
      expect(advLabels).toContain(family);
    }
  });

  it('PROBE: adversarial corpus — report kernel robustness limits (graceful, never throws)', async () => {
    if (!okLoad) return;
    const report = await runStepBurnIn(kernel, adversarialBurnInCases());
    console.log(`[stepBurnIn:adversarial] ${report.passed}/${report.total} passed (rate ${(report.passRate * 100).toFixed(0)}%)`);
    if (report.failures.length) {
      console.log('[stepBurnIn:adversarial] failures:', JSON.stringify(report.failures, null, 2));
    }
    // The harness must complete gracefully (every case is a pass or a STRUCTURED
    // failure — never an unhandled throw). The adversarial tier is valid-but-hard
    // solids (thin walls, sub-mm features, 1e6 offsets, non-convex/partial-revolve
    // profiles, union/intersect/multi-cut stacks). Gate at ≥0.8 so a kernel that
    // regresses on a couple of these goes red.
    expect(report.total).toBeGreaterThanOrEqual(20);
    expect(report.passed + report.failures.length).toBe(report.total);
    expect(report.passRate).toBeGreaterThanOrEqual(0.8);
  }, 240_000);

  it('PROBE: pathological corpus — DOCUMENTS kernel limits (graceful, no pass-rate gate)', async () => {
    if (!okLoad) return;
    const report = await runStepBurnIn(kernel, pathologicalBurnInCases());
    console.log(`[stepBurnIn:pathological] ${report.passed}/${report.total} survived (rate ${(report.passRate * 100).toFixed(0)}%)`);
    if (report.failures.length) {
      console.log('[stepBurnIn:pathological] documented limits:', JSON.stringify(report.failures, null, 2));
    }
    if (report.recoveries.length) {
      console.log('[stepBurnIn:pathological] transparent recoveries:', JSON.stringify(report.recoveries, null, 2));
    }
    // No pass-rate expectation — these may legitimately fail. The contract is only
    // that the harness handles every degenerate input GRACEFULLY (structured
    // pass/fail, never an unhandled throw). The recorded failures are the kernel's
    // documented boundary; promoting one to the adversarial tier is how we prove
    // "the kernel now handles this".
    expect(report.total).toBeGreaterThanOrEqual(6);
    expect(report.passed + report.failures.length).toBe(report.total);
    expect(report.recoveries).toContainEqual(expect.objectContaining({
      label: 'fillet r2.5 on 5mm-thin box',
      strategy: 'reduced-radius',
      requested: 2.5,
    }));
  }, 240_000);
});
