import { describe, expect, it } from 'vitest';
import {
  applyPartialDesignCandidate,
  applyWholeDesignCandidate,
  createDesignCandidateComparison,
  type DesignCandidate,
} from '../designCandidateComparison';

const candidate = (id: string, status: 'verified' | 'unknown' | 'failed' = 'verified', baseRevision = 'rev-1'): DesignCandidate => ({
  candidateId: id,
  revision: `${id}:r1`,
  baseRevision,
  title: id,
  summary: `${id} summary`,
  metrics: [{ metricId: 'mass', label: 'Mass', value: 10, unit: 'g', status }],
  evidence: [{ evidenceId: 'geometry', label: 'Geometry', status }],
  featureIds: ['body', 'hole'],
});

describe('design candidate comparison view model', () => {
  it('recommends only a fully evidenced candidate and preserves explicit reasons', () => {
    const model = createDesignCandidateComparison('rev-1', [candidate('a', 'unknown'), candidate('b')]);
    expect(model.recommendation).toEqual({ candidateId: 'b', eligible: true, verificationRequired: false, reasons: ['all_available_evidence_verified'] });
    expect(model.candidates).toHaveLength(2);
  });

  it('never fabricates PASS when all candidates are unverified or failed', () => {
    const model = createDesignCandidateComparison('rev-1', [candidate('a', 'unknown'), candidate('b', 'failed')]);
    expect(model.recommendation.candidateId).toBeNull();
    expect(model.recommendation.verificationRequired).toBe(true);
    expect(model.recommendation.reasons).toContain('no_candidate_has_complete_verified_evidence');
    expect(applyWholeDesignCandidate(model, 'a')).toEqual({ ok: false, issues: ['verification_incomplete'] });
  });

  it('can expose an explicit conceptual recommendation without claiming verification', () => {
    const model = createDesignCandidateComparison('rev-1', [candidate('concept', 'unknown')], { conceptualRecommendationCandidateId: 'concept' });
    expect(model.recommendation).toMatchObject({ candidateId: 'concept', eligible: false, verificationRequired: true });
    expect(model.recommendation.reasons).toContain('conceptual_recommendation_only');
  });

  it('applies whole or selected feature sets with stable revision-bound action IDs', () => {
    const model = createDesignCandidateComparison('rev-1', [candidate('a')]);
    expect(applyWholeDesignCandidate(model, 'a')).toMatchObject({ ok: true, mode: 'whole', featureIds: ['body', 'hole'], actionId: 'apply:a:a:r1:whole:body,hole' });
    expect(applyPartialDesignCandidate(model, 'a', ['hole'])).toMatchObject({ ok: true, mode: 'partial', featureIds: ['hole'] });
    expect(applyPartialDesignCandidate(model, 'a', ['missing'])).toEqual({ ok: false, issues: ['feature_outside_candidate', 'missing'] });
  });

  it('fails closed on stale or mixed candidate revisions', () => {
    const model = createDesignCandidateComparison('rev-1', [candidate('a', 'verified', 'rev-2')]);
    expect(model.recommendation.candidateId).toBeNull();
    expect(applyWholeDesignCandidate(model, 'a', 'rev-2')).toEqual({ ok: false, issues: ['stale_workspace_revision'] });
  });

  it('rejects an empty partial scope and an out-of-scope feature', () => {
    const model = createDesignCandidateComparison('rev-1', [candidate('a')]);
    expect(applyPartialDesignCandidate(model, 'a', [])).toEqual({ ok: false, issues: ['feature_selection_required'] });
    expect(applyPartialDesignCandidate(model, 'a', ['body', 'missing'])).toEqual({ ok: false, issues: ['feature_outside_candidate', 'missing'] });
  });
});
