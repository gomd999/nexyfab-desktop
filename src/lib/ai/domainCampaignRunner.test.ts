import { describe, expect, it } from 'vitest';
import { DOMAIN_ACCURACY_PROFILES } from './domainAccuracyProgram';
import { createDomainCampaignState, runDomainCampaign, type DomainCampaignExecutor } from './domainCampaignRunner';
import type { DomainAccuracyCase, DomainAccuracyRun } from './domainAccuracyEvidence';

const hash = (value: number) => value.toString(16).padStart(64, '0');
const cases = (): DomainAccuracyCase[] => Array.from({ length: 20 }, (_, index) => ({
  caseId: `civil-${index + 1}`, domain: 'civil', sourceHash: hash(index + 1), split: 'holdout',
  approvalReviewerIds: ['reviewer-a', 'reviewer-b'],
  groundTruthAssertions: DOMAIN_ACCURACY_PROFILES.civil.requiredAxes.map((axis, axisIndex) => ({
    axis, tolerancePolicy: 'reviewed', provenance: 'expert', artifactHashes: [hash(1000 + index * 20 + axisIndex)],
  })),
}));
const result = (item: DomainAccuracyCase, campaign: number, repeat: number): DomainAccuracyRun => ({
  caseId: item.caseId, domain: 'civil', sourceHash: item.sourceHash, campaign, repeat, usedForTuning: false,
  requiredGatesPassed: true, falseVerified: false, falseClear: false, destructivePartMerge: false,
  assertions: DOMAIN_ACCURACY_PROFILES.civil.requiredAxes.map(axis => ({ axis, status: 'pass', reason: 'domain validator measured against approved truth' })),
});

describe('domain campaign runner', () => {
  it('creates exactly 20×3×5 deterministic slots', () => {
    expect(createDomainCampaignState('civil', cases()).slots).toHaveLength(300);
  });
  it('requires approved case integrity and minimum population before execution', () => {
    expect(() => createDomainCampaignState('civil', cases().slice(0, 19))).toThrow('domain_campaign_cases_below_minimum');
    const invalid = cases(); invalid[0] = { ...invalid[0]!, approvalReviewerIds: ['same'] };
    expect(() => createDomainCampaignState('civil', invalid)).toThrow('domain_campaign_case_integrity');
  });
  it('retries, checkpoints and resumes completed slots without rerunning', async () => {
    let calls = 0;
    const executor: DomainCampaignExecutor = async ({ caseValue, campaign, repeat, attempt }) => {
      calls++;
      if (caseValue.caseId === 'civil-1' && attempt === 1) throw new Error('transient');
      return result(caseValue, campaign, repeat);
    };
    const first = await runDomainCampaign('civil', cases(), executor, undefined, { campaigns: 1, repeats: 1, maximumAttemptsPerSlot: 2 });
    expect(first.results).toHaveLength(20);
    expect(first.slots[0]).toMatchObject({ status: 'completed', attempts: 2 });
    const before = calls;
    const resumed = await runDomainCampaign('civil', cases(), executor, first, { maximumAttemptsPerSlot: 2 });
    expect(calls).toBe(before);
    expect(resumed.results).toHaveLength(20);
  });
  it('rejects a changed suite and detects stored result tampering', async () => {
    const input = cases();
    const state = createDomainCampaignState('civil', input, { campaigns: 1, repeats: 1 });
    const changed = cases(); changed[0] = { ...changed[0]!, sourceHash: hash(9999) };
    await expect(runDomainCampaign('civil', changed, async ({ caseValue, campaign, repeat }) => result(caseValue, campaign, repeat), state)).rejects.toThrow('domain_campaign_resume_suite_mismatch');
    const completed = await runDomainCampaign('civil', input, async ({ caseValue, campaign, repeat }) => result(caseValue, campaign, repeat), undefined, { campaigns: 1, repeats: 1 });
    completed.results[0] = { ...completed.results[0]!, requiredGatesPassed: false };
    await expect(runDomainCampaign('civil', input, async ({ caseValue, campaign, repeat }) => result(caseValue, campaign, repeat), completed)).rejects.toThrow('domain_campaign_result_hash_mismatch');
  });
});
