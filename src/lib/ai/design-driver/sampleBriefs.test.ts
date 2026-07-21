/**
 * sampleBriefs.test.ts — Wave A · GA3.
 *
 * The sample briefs are onboarding material, so the contract they must honour
 * is the DRIVER contract, verified for real (실행하지 않은 판정은 판정이 아니다):
 *   - every sample is a structurally valid DesignBrief;
 *   - fixture-tier briefs carry params.fixture === fixtureKey AND drive
 *     end-to-end through runDesignDriver with the deterministic fixturePlanner,
 *     producing ok:true with a package and all gates green;
 *   - free-text-tier briefs are REFUSED by the deterministic planner (they need
 *     the LLM planner — WA-D), which is the honest, un-fabricated behaviour.
 */

import { describe, it, expect } from 'vitest';
import { SAMPLE_BRIEFS, FIXTURE_SAMPLE_BRIEFS, getSampleBrief } from './sampleBriefs';
import { fixturePlanner } from './fixturePlanner';
import { runDesignDriver } from './designDriver';

describe('sampleBriefs — structure', () => {
  it('every sample brief is a valid DesignBrief (non-empty id + text) with a unique id', () => {
    const ids = new Set<string>();
    for (const s of SAMPLE_BRIEFS) {
      expect(s.brief.id, `${s.id} brief.id`).toBeTruthy();
      expect(s.brief.text.trim().length, `${s.id} brief.text`).toBeGreaterThan(0);
      expect(s.expectedCoverage.trim().length, `${s.id} coverage`).toBeGreaterThan(0);
      expect(ids.has(s.id), `duplicate id ${s.id}`).toBe(false);
      ids.add(s.id);
    }
    expect(SAMPLE_BRIEFS.length).toBeGreaterThanOrEqual(5);
  });

  it('fixture tier ⇒ fixtureKey set and mirrored into params.fixture; free-text tier ⇒ neither', () => {
    for (const s of SAMPLE_BRIEFS) {
      if (s.tier === 'fixture') {
        expect(s.fixtureKey, `${s.id}`).toBeTruthy();
        expect(s.brief.params?.fixture).toBe(s.fixtureKey);
      } else {
        expect(s.fixtureKey).toBeUndefined();
        expect(s.brief.params?.fixture).toBeUndefined();
      }
    }
  });

  it('FIXTURE_SAMPLE_BRIEFS is exactly the fixture-tier subset; getSampleBrief resolves by id', () => {
    expect(FIXTURE_SAMPLE_BRIEFS.every((s) => s.tier === 'fixture')).toBe(true);
    expect(FIXTURE_SAMPLE_BRIEFS.length).toBe(SAMPLE_BRIEFS.filter((s) => s.tier === 'fixture').length);
    expect(FIXTURE_SAMPLE_BRIEFS.length).toBeGreaterThanOrEqual(3);
    expect(getSampleBrief('sb-l-bracket')?.tier).toBe('fixture');
    expect(getSampleBrief('does-not-exist')).toBeUndefined();
  });
});

describe('sampleBriefs — driver contract', () => {
  it('every fixture-tier brief drives end-to-end to a verified package (all gates green)', async () => {
    for (const s of FIXTURE_SAMPLE_BRIEFS) {
      const result = await runDesignDriver(s.brief, { planner: fixturePlanner });
      expect(result.ok, `${s.id} refused: ${result.ok ? '' : result.refusal.reason}`).toBe(true);
      if (result.ok) {
        expect(result.package.parts.length).toBeGreaterThan(0);
        expect(result.gates.length).toBeGreaterThan(0);
        expect(result.gates.every((g) => g.pass)).toBe(true);
        expect(result.package.report.allPassed).toBe(true);
      }
    }
  });

  it('free-text-tier briefs are explicitly refused by the deterministic planner (LLM required)', async () => {
    const freeText = SAMPLE_BRIEFS.filter((s) => s.tier === 'free-text');
    expect(freeText.length).toBeGreaterThan(0);
    for (const s of freeText) {
      const result = await runDesignDriver(s.brief, { planner: fixturePlanner });
      expect(result.ok, `${s.id} unexpectedly passed`).toBe(false);
      if (!result.ok) {
        expect(result.refusal.stage).toBe('plan');
        expect(result.refusal.reason).toContain('unknown brief');
      }
    }
  });
});
