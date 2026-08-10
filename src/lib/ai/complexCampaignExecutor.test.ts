import { describe, expect, it, vi } from 'vitest';
import { createGovernedComplexCampaignExecutor } from './complexCampaignExecutor';
import type { ComplexBenchmarkCaseV2 } from './complexProductBenchmarkV2';

const source = 'a'.repeat(64);
const caseValue: ComplexBenchmarkCaseV2 = {
  schema: 'nexyfab.complex-benchmark-case.v2', caseId: 'robot-holdout-1', family: 'robot', tier: 'T3', holdoutGroup: 'robot-hidden', sourceHash: source, split: 'holdout',
  assertions: [{ id: 'joint-axis', axis: 'joints', required: true, kpiEligible: true, provenance: 'authoritative-cad', tolerancePolicy: 'axis-0.01deg', artifactHashes: [source] }],
};

describe('governed complex campaign executor', () => {
  it('derives the benchmark result from a generated artifact and bound evaluator receipt', async () => {
    let receivedSeed = '';
    const generateComplexProduct = vi.fn(async (input: { seed: string }) => { receivedSeed = input.seed; return { artifact: { product: 'robot', joints: 6 }, requiredGatesPassed: true, destructivePartMerge: false }; });
    const executor = createGovernedComplexCampaignExecutor({ generateComplexProduct, evaluateComplexAssertion: async input => ({ status: 'pass', reason: 'axis deviation 0.002deg', evaluator: { name: 'occt-joint-check', version: '1.0.0' }, sourceArtifactSha256: source, generatedArtifactSha256: input.generatedArtifactSha256, measurement: { deviationDeg: 0.002 }, tolerancePolicy: input.assertion.tolerancePolicy }) });
    const run = await executor({ caseValue, campaign: 2, repeat: 3, attempt: 1 });
    expect(run).toMatchObject({ subject: 'ai_generation', campaign: 2, repeat: 3, verified: true, requiredGatesPassed: true, falseVerified: false, assertions: [{ status: 'pass' }] });
    expect(receivedSeed).toMatch(/^[a-f0-9]{64}$/);
    expect(run.assertions[0]!.artifactHashes[0]).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects an evaluator receipt not bound to approved source evidence', async () => {
    const executor = createGovernedComplexCampaignExecutor({ generateComplexProduct: async () => ({ artifact: {}, requiredGatesPassed: true, destructivePartMerge: false }), evaluateComplexAssertion: async input => ({ status: 'pass', reason: 'claimed pass', evaluator: { name: 'fixture', version: '1' }, sourceArtifactSha256: 'b'.repeat(64), generatedArtifactSha256: input.generatedArtifactSha256, measurement: {}, tolerancePolicy: input.assertion.tolerancePolicy }) });
    await expect(executor({ caseValue, campaign: 1, repeat: 1, attempt: 1 })).rejects.toThrow('campaign_source_evidence_unbound');
  });

  it('cannot verify a run with a failed assertion or destructive merged body', async () => {
    const executor = createGovernedComplexCampaignExecutor({ generateComplexProduct: async () => ({ artifact: {}, requiredGatesPassed: true, destructivePartMerge: true }), evaluateComplexAssertion: async input => ({ status: 'fail', reason: 'axis outside tolerance', evaluator: { name: 'fixture', version: '1' }, sourceArtifactSha256: source, generatedArtifactSha256: input.generatedArtifactSha256, measurement: { deviationDeg: 2 }, tolerancePolicy: input.assertion.tolerancePolicy }) });
    const run = await executor({ caseValue, campaign: 1, repeat: 1, attempt: 1 });
    expect(run).toMatchObject({ verified: false, destructivePartMerge: true, assertions: [{ status: 'fail' }] });
  });
});
