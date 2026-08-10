import { createHash } from 'node:crypto';
import type { ComplexBenchmarkAssertionV2, ComplexBenchmarkCaseV2, ComplexBenchmarkRunV2 } from './complexProductBenchmarkV2';
import type { ComplexCampaignExecutor } from './complexCampaignRunner';

export interface ComplexProductGenerationResult {
  artifact: unknown;
  requiredGatesPassed: boolean;
  destructivePartMerge: boolean;
}

export interface ComplexAssertionEvaluation {
  status: 'pass' | 'fail' | 'not_run';
  reason: string;
  evaluator: { name: string; version: string };
  sourceArtifactSha256: string;
  generatedArtifactSha256: string;
  measurement: unknown;
  tolerancePolicy: string;
}

export interface GovernedComplexCampaignAdapter {
  generateComplexProduct(input: { caseValue: ComplexBenchmarkCaseV2; campaign: number; repeat: number; attempt: number; seed: string }): Promise<ComplexProductGenerationResult>;
  evaluateComplexAssertion(input: { caseValue: ComplexBenchmarkCaseV2; assertion: ComplexBenchmarkAssertionV2; generatedArtifact: unknown; generatedArtifactSha256: string }): Promise<ComplexAssertionEvaluation>;
}

const SHA256 = /^[a-f0-9]{64}$/i;

/** Builds benchmark runs from generated artifacts and independent evaluator
 * receipts. Adapters cannot submit a pre-filled all-pass benchmark result. */
export function createGovernedComplexCampaignExecutor(adapter: GovernedComplexCampaignAdapter): ComplexCampaignExecutor {
  return async input => {
    const seed = sha256({ caseId: input.caseValue.caseId, campaign: input.campaign, repeat: input.repeat });
    const generated = await adapter.generateComplexProduct({ ...input, seed });
    if (!generated || typeof generated !== 'object') throw new Error('campaign_generation_result_invalid');
    const generatedArtifactSha256 = sha256(generated.artifact);
    const assertions = [] as ComplexBenchmarkRunV2['assertions'];
    for (const assertion of input.caseValue.assertions) {
      const evaluation = await adapter.evaluateComplexAssertion({ caseValue: input.caseValue, assertion, generatedArtifact: generated.artifact, generatedArtifactSha256 });
      validateEvaluation(assertion, generatedArtifactSha256, evaluation);
      assertions.push({ assertionId: assertion.id, status: evaluation.status, reason: evaluation.reason, artifactHashes: [sha256(evaluation)] });
    }
    const byId = new Map(assertions.map(assertion => [assertion.assertionId, assertion]));
    const required = input.caseValue.assertions.filter(assertion => assertion.required && assertion.kpiEligible);
    const allRequiredPassed = required.length > 0 && required.every(assertion => byId.get(assertion.id)?.status === 'pass');
    const verified = generated.requiredGatesPassed === true && !generated.destructivePartMerge && allRequiredPassed;
    const collisionRequired = required.filter(assertion => assertion.axis === 'collision_clearance');
    return {
      schema: 'nexyfab.complex-benchmark-run.v2', subject: 'ai_generation', caseId: input.caseValue.caseId,
      campaign: input.campaign, repeat: input.repeat, usedForTuning: false,
      requiredGatesPassed: generated.requiredGatesPassed === true,
      verified, falseVerified: false,
      falseClear: verified && collisionRequired.some(assertion => byId.get(assertion.id)?.status !== 'pass'),
      destructivePartMerge: generated.destructivePartMerge === true,
      assertions,
    };
  };
}

function validateEvaluation(assertion: ComplexBenchmarkAssertionV2, generatedHash: string, value: ComplexAssertionEvaluation): void {
  if (!value || !['pass', 'fail', 'not_run'].includes(value.status)) throw new Error(`campaign_evaluation_status_invalid:${assertion.id}`);
  if (!value.reason?.trim()) throw new Error(`campaign_evaluation_reason_missing:${assertion.id}`);
  if (!value.evaluator?.name?.trim() || !value.evaluator?.version?.trim()) throw new Error(`campaign_evaluator_identity_missing:${assertion.id}`);
  if (!SHA256.test(value.sourceArtifactSha256) || !assertion.artifactHashes.includes(value.sourceArtifactSha256)) throw new Error(`campaign_source_evidence_unbound:${assertion.id}`);
  if (value.generatedArtifactSha256 !== generatedHash) throw new Error(`campaign_generated_artifact_hash_mismatch:${assertion.id}`);
  if (value.tolerancePolicy !== assertion.tolerancePolicy) throw new Error(`campaign_tolerance_policy_mismatch:${assertion.id}`);
  if (value.status !== 'not_run' && (value.measurement === null || value.measurement === undefined)) throw new Error(`campaign_measurement_missing:${assertion.id}`);
}

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, child]) => child !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonicalize(child)]));
}
