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
import { runStepBurnIn, defaultBurnInCases } from './stepBurnIn';

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
});
