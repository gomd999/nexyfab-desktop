import { describe, expect, it } from 'vitest';
import {
  createAiCanonicalCandidate,
  discardAiCanonicalCandidate,
  guardAiCanonicalCandidate,
  markAiCanonicalCandidateApplied,
} from './aiCanonicalCandidate';
import { buildGuidedDesignBrief, buildGuidedRequirementGate, seedGuidedBriefInputs } from './guidedDesignBrief';

const sha = (value: string) => value.repeat(64);
const lock = { id: 'human-width', target: { kind: 'parameter' as const, objectId: 'base_shape:main', field: 'width' } };

describe('AI canonical candidate', () => {
  it('creates a preview without mutating the wire payload or claiming verification', () => {
    const payload = { shapeId: 'box', params: { width: 120, depth: 80 } };
    const before = structuredClone(payload);
    const candidate = createAiCanonicalCandidate({ id: 'candidate-1', kind: 'intent', baseRevision: 'r7', summary: 'Resize box', payload, now: '2026-08-13T00:00:00.000Z' });
    expect(payload).toEqual(before);
    expect(candidate).toMatchObject({ state: 'PREVIEW', baseRevision: 'r7', issues: [] });
    expect(candidate.evidence[0]).toMatchObject({ id: 'ai-plan', status: 'PREVIEW' });
    expect(candidate.evidence.slice(-2).map(item => item.status)).toEqual(['NOT_RUN', 'NOT_RUN']);
    expect(candidate.changedTargets).toContainEqual({ kind: 'parameter', objectId: 'base_shape:main', field: 'width' });
  });

  it('blocks an AI candidate that touches a human-locked value', () => {
    const candidate = createAiCanonicalCandidate({ id: 'candidate-2', kind: 'intent', baseRevision: 'r7', summary: 'Resize', payload: { shapeId: 'box', params: { width: 120 } }, locks: [lock] });
    expect(candidate).toMatchObject({ state: 'BLOCKED', blockedLockIds: ['human-width'], issues: ['protected_user_or_authority_value'] });
  });

  it('rechecks revision and newly-added locks at the explicit Apply boundary', () => {
    const candidate = createAiCanonicalCandidate({ id: 'candidate-3', kind: 'intent', baseRevision: 'r7', summary: 'Resize', payload: { shapeId: 'box', params: { width: 120 } } });
    expect(guardAiCanonicalCandidate(candidate, 'r8')).toMatchObject({ allowed: false, issues: ['stale_workspace_revision'] });
    expect(guardAiCanonicalCandidate(candidate, 'r7', [lock])).toMatchObject({ allowed: false, blockedLockIds: ['human-width'] });
  });

  it('blocks request-only edits that target a different feature than the selected scope', () => {
    const candidate = createAiCanonicalCandidate({
      id: 'candidate-scope', kind: 'feature_batch', baseRevision: 'r7', summary: 'Edit selected feature',
      payload: { intents: [{ kind: 'update_param', featureId: 'other-feature', paramKey: 'radius', value: 4 }] },
      scope: { mode: 'request_only_edit', featureId: 'selected-feature' },
    });
    expect(candidate.state).toBe('BLOCKED');
    expect(candidate.issues).toContain('requested_scope_violation');
    expect(guardAiCanonicalCandidate(candidate, 'r7').allowed).toBe(false);
  });

  it('fails closed when request-only scope has no exact identity or only an unverifiable part identity', () => {
    const missing = createAiCanonicalCandidate({
      id: 'candidate-missing-scope', kind: 'feature_batch', baseRevision: 'r7', summary: 'Edit',
      payload: { intents: [{ kind: 'update_param', featureId: 'feature-1', paramKey: 'radius', value: 4 }] },
      scope: { mode: 'request_only_edit' },
    });
    expect(missing.issues).toContain('missing_requested_scope_identity');

    const partOnly = createAiCanonicalCandidate({
      id: 'candidate-part-scope', kind: 'feature_batch', baseRevision: 'r7', summary: 'Edit part',
      payload: { intents: [{ kind: 'update_param', featureId: 'feature-1', paramKey: 'radius', value: 4 }] },
      scope: { mode: 'request_only_edit', partInstanceId: 'part-1' },
    });
    expect(partOnly.issues).toContain('requested_part_scope_unverifiable');
  });

  it('rejects fabricated PASS evidence and unbound PASS comparison metrics', () => {
    const candidate = createAiCanonicalCandidate({
      id: 'candidate-4', kind: 'intent', baseRevision: 'r7', summary: 'Claimed pass',
      payload: {
        shapeId: 'box', params: {},
        evidence: [{ id: 'fea', label: 'FEA', status: 'PASS' }],
        comparisonMetrics: [{ id: 'mass', label: 'Mass', value: 10, unit: 'kg', status: 'PASS' }],
      },
    });
    expect(candidate.state).toBe('BLOCKED');
    expect(candidate.issues).toEqual(expect.arrayContaining(['fabricated_or_unbound_evidence', 'fabricated_or_unbound_metric']));
  });

  it('retains source and state for a bound comparison metric', () => {
    const candidate = createAiCanonicalCandidate({
      id: 'candidate-5', kind: 'intent', baseRevision: 'r7', summary: 'Measured option',
      payload: { shapeId: 'box', params: {}, comparisonMetrics: [{ id: 'mass', label: 'Mass', value: 10, unit: 'kg', status: 'PASS', sourceId: 'mass-job-1', sourceHash: sha('a') }] },
    });
    expect(candidate).toMatchObject({ state: 'PREVIEW', metrics: [{ id: 'mass', status: 'PASS', sourceId: 'mass-job-1', sourceHash: sha('a') }] });
  });

  it('marks dependent evidence stale after Apply and supports discard before Apply', () => {
    const candidate = createAiCanonicalCandidate({ id: 'candidate-6', kind: 'pattern', baseRevision: 'r7', summary: 'Pattern', payload: { id: 'ribbed' } });
    expect(discardAiCanonicalCandidate(candidate).state).toBe('DISCARDED');
    const applied = markAiCanonicalCandidateApplied(candidate, '2026-08-13T00:01:00.000Z');
    expect(applied.state).toBe('APPLIED');
    expect(applied.evidence.find(item => item.id === 'geometry-reverification')?.status).toBe('NOT_RUN');
    expect(applied.metrics[0]?.status).toBe('STALE');
  });

  it('keeps exact Apply blocked when a bound guided requirement gate is incomplete', () => {
    const brief = buildGuidedDesignBrief({
      prompt: 'Design an exact bracket',
      requestedStage: 'exact',
      selectedDomains: ['mechanical'],
      inputs: seedGuidedBriefInputs('Design an exact bracket', 'mechanical'),
    });
    const candidate = createAiCanonicalCandidate({
      id: 'candidate-requirements', kind: 'intent', baseRevision: 'r7', summary: 'Exact bracket',
      payload: { shapeId: 'box', params: {} }, requirementGate: buildGuidedRequirementGate(brief),
    });
    expect(candidate.state).toBe('BLOCKED');
    expect(candidate.issues).toContain('missing_authoritative_input:mechanical.critical_dimensions');
    expect(guardAiCanonicalCandidate(candidate, 'r7').allowed).toBe(false);
  });
});
