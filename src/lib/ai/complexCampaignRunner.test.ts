import { describe, expect, it } from 'vitest';
import { COMPLEX_PRODUCT_FAMILIES } from './complexProductBenchmark';
import { createComplexCampaignState, runComplexCampaign, type ComplexCampaignExecutor } from './complexCampaignRunner';
import type { ComplexBenchmarkCaseV2, ComplexBenchmarkRunV2 } from './complexProductBenchmarkV2';
const h = (value: string) => value.repeat(64).slice(0, 64);
const cases = (): ComplexBenchmarkCaseV2[] => COMPLEX_PRODUCT_FAMILIES.map((family, index) => ({ schema: 'nexyfab.complex-benchmark-case.v2', caseId: `${family}-1`, family, tier: 'T1', holdoutGroup: `${family}-g`, sourceHash: h(String(index + 1)), split: 'holdout', assertions: [{ id: 'a', axis: 'dimensions', required: true, kpiEligible: true, provenance: 'standard', tolerancePolicy: 'exact', artifactHashes: [h('a')] }] }));
const result = (caseId: string, campaign: number, repeat: number): ComplexBenchmarkRunV2 => ({ schema: 'nexyfab.complex-benchmark-run.v2', subject: 'ai_generation', caseId, campaign, repeat, usedForTuning: false, requiredGatesPassed: true, verified: true, falseVerified: false, falseClear: false, destructivePartMerge: false, assertions: [{ assertionId: 'a', status: 'pass', reason: 'measured', artifactHashes: [h('b')] }] });
describe('complex campaign runner', () => {
  it('requires the governed family case minimum', () => expect(() => createComplexCampaignState(cases())).toThrow('campaign_family_cases_below_minimum:robot:1/20'));
  it('refuses expensive campaign execution before assertion approval', () => { const value = cases(); value[0]!.assertions[0]!.kpiEligible = false; value[0]!.assertions[0]!.provenance = 'legacy-unreviewed'; expect(() => createComplexCampaignState(value, { minimumCasesPerFamily: 1 })).toThrow('campaign_unapproved_assertions:robot-1'); });
  it('builds every campaign/repeat slot deterministically', () => expect(createComplexCampaignState(cases(), { minimumCasesPerFamily: 1, campaigns: 3, repeats: 5 }).slots).toHaveLength(120));
  it('runs a product-family promotion without making auxiliary services a blocker', () => {
    const focused = cases().filter(item => item.family === 'machine_skid');
    const state = createComplexCampaignState(focused, { minimumCasesPerFamily: 1, campaigns: 1, repeats: 1, requiredFamilies: ['machine_skid'] });
    expect(state).toMatchObject({ requiredFamilies: ['machine_skid'], slots: [{ caseId: 'machine_skid-1' }] });
  });
  it('checkpoints failures, retries, and resumes completed slots without rerunning them', async () => {
    let calls = 0; const executor: ComplexCampaignExecutor = async ({ caseValue, campaign, repeat, attempt }) => { calls++; if (caseValue.caseId === 'robot-1' && campaign === 1 && repeat === 1 && attempt === 1) throw new Error('transient'); return result(caseValue.caseId, campaign, repeat); };
    const first = await runComplexCampaign(cases(), executor, undefined, { minimumCasesPerFamily: 1, campaigns: 1, repeats: 1, maximumAttemptsPerSlot: 2 });
    expect(first.results).toHaveLength(8); expect(first.slots.find(item => item.caseId === 'robot-1')).toMatchObject({ status: 'completed', attempts: 2 });
    const before = calls; const resumed = await runComplexCampaign(cases(), executor, first, { minimumCasesPerFamily: 1, maximumAttemptsPerSlot: 2 }); expect(calls).toBe(before); expect(resumed.results).toHaveLength(8);
  });
  it('refuses a changed holdout suite on resume', async () => { const state = createComplexCampaignState(cases(), { minimumCasesPerFamily: 1, campaigns: 1, repeats: 1 }); const changed = cases(); changed[0]!.sourceHash = h('f'); await expect(runComplexCampaign(changed, async () => result('x', 1, 1), state, { minimumCasesPerFamily: 1 })).rejects.toThrow('campaign_resume_suite_mismatch'); });
  it('refuses a changed required-family scope on resume', async () => { const focused = cases().filter(item => item.family === 'gearbox'); const state = createComplexCampaignState(focused, { minimumCasesPerFamily: 1, campaigns: 1, repeats: 1, requiredFamilies: ['gearbox'] }); await expect(runComplexCampaign(focused, async () => result('x', 1, 1), state, { requiredFamilies: ['machine_skid'] })).rejects.toThrow('campaign_resume_suite_mismatch'); });
  it('fails closed with a controlled error for legacy states missing the bound scope', async () => { const state = createComplexCampaignState(cases(), { minimumCasesPerFamily: 1, campaigns: 1, repeats: 1 }); const legacy = { ...state } as Partial<typeof state>; delete legacy.requiredFamilies; delete legacy.minimumCasesPerFamily; await expect(runComplexCampaign(cases(), async () => result('x', 1, 1), legacy as typeof state)).rejects.toThrow('campaign_resume_suite_mismatch'); });
});
