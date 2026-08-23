import { describe, expect, it } from 'vitest';
import { validateSpatialCadIssueCandidate } from './spatialCadIssueStore';

const candidate = { candidateId: 'candidate:architecture:mep', modelA: 'architecture', modelB: 'mep', overlapMm: [10, 20, 30], severity: 'hard', modelRevision: 1, evidence: 'BOUNDS_PREVIEW', exactVerification: 'NOT_RUN' } as const;

describe('spatial CAD issue evidence contract', () => {
  it('accepts bounds preview without exact evidence', () => {
    expect(validateSpatialCadIssueCandidate(candidate)).toEqual([]);
  });

  it('refuses promotion of a candidate issue to exact verification', () => {
    expect(validateSpatialCadIssueCandidate({ ...candidate, exactVerification: 'PASS' })).toContain('exact_verification_must_be_not_run');
    expect(validateSpatialCadIssueCandidate({ ...candidate, evidence: 'EXACT_BREP' })).toContain('issue_evidence_must_be_bounds_preview');
  });
});
