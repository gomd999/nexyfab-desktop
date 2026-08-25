import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  executeMechanicalAiIntentRuntimeHarness,
  parseAuthoritativeDimensions,
  selectRepresentativeMechanicalIntents,
} from './mechanical-ai-intent-runtime-harness';
import { TEXT_BINDING_CANONICALIZATION } from './canonical-text-binding.mjs';

const root = process.cwd();
const scratch = `.mechanical-intent-runtime-test-${process.pid}-${Date.now()}`;

afterAll(() => {
  fs.rmSync(path.resolve(root, scratch), { recursive: true, force: true });
});

describe('mechanical AI intent revision-bound runtime harness', () => {
  it('selects one positive intent for each of the first ten exact runtime features', () => {
    const selected = selectRepresentativeMechanicalIntents();
    expect(selected).toHaveLength(10);
    expect(new Set(selected.map(item => item.feature)).size).toBe(10);
    expect(new Set(selected.map(item => item.category))).toEqual(new Set(['ko_practical', 'en_practical', 'mixed_units']));
  });

  it('normalizes consistent mixed units and rejects contradictory groups', () => {
    expect(parseAuthoritativeDimensions('100 mm × 60 mm × 6.35 mm (3.937 in × 2.362 in × 0.25 in)')).toMatchObject({
      dimensionsMm: { width: 100, length: 60, thickness: 6.35 },
      sourceUnits: ['mm', 'in'],
    });
    expect(parseAuthoritativeDimensions('100 mm × 60 mm × 8 mm (3 in × 2 in × 0.25 in)')).toBeNull();
  });

  it('executes ten revision-bound candidates through all seven exact axes with byte-bound dimension assertions', async () => {
    const result = await executeMechanicalAiIntentRuntimeHarness(root, {
      outputRoot: `${scratch}/evidence`,
      now: new Date('2026-08-13T06:00:00.000Z'),
    });
    expect(result.results.summary).toEqual({
      requiredCases: 10,
      pass: 10,
      fail: 0,
      blocked: 0,
      requiredAxes: 70,
      axisPass: 70,
      axisFail: 0,
      axisNotRun: 0,
    });
    expect(result.results.localIntegration.status).toBe('PASS');
    expect(result.results.commercialCampaign).toMatchObject({ status: 'NOT_RUN', releaseEligible: false });
    expect(result.receipt.textCanonicalization).toBe(TEXT_BINDING_CANONICALIZATION);
    expect(result.receipt.sourceBindings.every(binding => binding.canonicalization === TEXT_BINDING_CANONICALIZATION)).toBe(true);
    for (const item of result.results.cases) {
      expect(item.status).toBe('PASS');
      expect(item.artifactBindings).toHaveLength(4);
      expect(item.artifactBindings.every(binding => binding.bytes > 0 && /^[a-f0-9]{64}$/.test(binding.sha256))).toBe(true);
    }
  }, 180_000);
});
