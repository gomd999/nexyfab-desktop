import { describe, expect, it } from 'vitest';
import {
  buildMechanicalAiIntentCorpus,
  buildMechanicalAiIntentLocalQualification,
  evaluateMechanicalAiIntentCase,
  MECHANICAL_AI_INTENT_CATEGORIES,
} from './mechanical-ai-intent-local-qualification';

describe('mechanical AI intent local qualification', () => {
  it('freezes five categories across the fixed 30-feature contract', () => {
    const corpus = buildMechanicalAiIntentCorpus();
    expect(corpus.cases).toHaveLength(150);
    for (const category of MECHANICAL_AI_INTENT_CATEGORIES) {
      expect(corpus.cases.filter(item => item.category === category)).toHaveLength(30);
    }
    for (const feature of corpus.featureContract) {
      expect(corpus.cases.filter(item => item.feature === feature)).toHaveLength(5);
    }
    expect(new Set(corpus.cases.map(item => item.caseId))).toHaveLength(150);
  });

  it('qualifies positive intake without claiming geometry or verification execution', () => {
    const bundle = buildMechanicalAiIntentLocalQualification('2026-08-13T00:00:00.000Z');
    const positive = bundle.results.cases.filter(item => item.expectedRequirementOutcome === 'READY');
    expect(positive).toHaveLength(90);
    expect(positive.every(item => item.parse.status === 'PASS')).toBe(true);
    expect(positive.every(item => item.requirementsGate.status === 'PASS')).toBe(true);
    expect(positive.every(item => item.candidateValidation.status === 'PASS')).toBe(true);
    expect(positive.every(item => item.geometry.eligibility === 'ELIGIBLE' && item.geometry.execution === 'NOT_RUN')).toBe(true);
    expect(positive.every(item => item.verification.eligibility === 'BLOCKED' && item.verification.execution === 'NOT_RUN')).toBe(true);
  });

  it('counts an expected negative as qualified only when the gate and candidate fail closed', () => {
    const bundle = buildMechanicalAiIntentLocalQualification('2026-08-13T00:00:00.000Z');
    const negative = bundle.results.cases.filter(item => item.expectedRequirementOutcome === 'BLOCKED');
    expect(negative).toHaveLength(60);
    expect(negative.every(item => item.qualification.status === 'PASS')).toBe(true);
    expect(negative.every(item => item.requirementsGate.status === 'BLOCKED')).toBe(true);
    expect(negative.every(item => item.candidateValidation.status === 'BLOCKED')).toBe(true);
    expect(negative.every(item => item.geometry.eligibility === 'BLOCKED' && item.geometry.execution === 'NOT_RUN')).toBe(true);
    expect(negative.every(item => item.requirementsGate.nextQuestion)).toBe(true);
  });

  it('detects explicit unmanufacturable input through the real requirements gate', () => {
    const item = buildMechanicalAiIntentCorpus().cases.find(candidate => candidate.negativeReason === 'unmanufacturable')!;
    const result = evaluateMechanicalAiIntentCase(item);
    expect(result.requirementsGate.status).toBe('BLOCKED');
    expect(result.requirementsGate.issues.some(issue => issue.startsWith('conflicting_authoritative_input:'))).toBe(true);
    expect(result.candidateValidation.state).toBe('BLOCKED');
  });

  it('separates local qualification from a commercial campaign', () => {
    const { results } = buildMechanicalAiIntentLocalQualification('2026-08-13T00:00:00.000Z');
    expect(results.localQualification).toMatchObject({ status: 'PASS' });
    expect(results.commercialCampaign).toMatchObject({ status: 'NOT_RUN', releaseEligible: false });
    expect(results.summary).toMatchObject({
      total: 150,
      expectedOutcomePass: 150,
      geometryExecution: { PASS: 0, FAIL: 0, NOT_RUN: 150 },
      verificationExecution: { PASS: 0, FAIL: 0, NOT_RUN: 150 },
    });
  });
});
