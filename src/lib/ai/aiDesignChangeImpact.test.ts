import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { createAiDesignCandidateArtifact } from './aiDesignCandidateArtifact';
import { planAiDesignChangeImpact } from './aiDesignChangeImpact';

const artifact = createAiDesignCandidateArtifact({ trustedServer: true, artifactId: 'artifact-1', candidateId: 'candidate-1', projectId: 'project-1', sessionId: 'session-1', baseRevision: 'r1', artifactRevision: 1, status: 'published', createdAt: '2026-08-24T00:00:00.000Z', contentDigest: 'a'.repeat(64), designDigest: 'b'.repeat(64), dependencies: { intentNodeIds: ['intent-1'], parameterIds: ['param-1'], gaugeIds: ['gauge-1'], featureIds: ['feature-1'] }, evidence: [{ evidenceId: 'geometry', kind: 'geometry', status: 'verified' }, { evidenceId: 'manufacturing', kind: 'manufacturing', status: 'unknown' }], server: { generatorId: 'generator-1', modelId: 'model-1', runtimeId: 'runtime-1', workerBuildDigest: 'c'.repeat(64), generationRunId: 'run-1' }, supersedes: null });

describe('AI Design change impact', () => {
  it('invalidates dependent evidence and orders conservative re-verification', () => {
    const plan = planAiDesignChangeImpact({ projectId: 'project-1', sessionId: 'session-1', fromRevision: 'r1', toRevision: 'r2', changedParameters: [{ parameterId: 'param-1' }] }, [artifact]);
    expect(plan.affectedArtifactIds).toEqual(['artifact-1']);
    expect(plan.invalidatedEvidence.map(item => item.previousStatus)).toEqual(['verified', 'unknown']);
    expect(plan.invalidatedEvidence.every(item => item.nextStatus === 'invalidated')).toBe(true);
    expect(plan.reverificationPlan.map(item => item.kind)).toEqual(['design_intent', 'geometry', 'topology', 'manufacturing']);
    expect(plan.reverificationPlan.every(item => item.status === 'not_run')).toBe(true);
  });
  it('does not affect another project and preserves explicit unknown dependency conservatism', () => {
    const unrelated = planAiDesignChangeImpact({ projectId: 'other', sessionId: 'session-1', fromRevision: 'r1', toRevision: 'r2', changedParameters: [{ parameterId: 'param-1' }] }, [artifact]);
    expect(unrelated.affectedArtifactIds).toEqual([]);
    const unknown = planAiDesignChangeImpact({ projectId: 'project-1', sessionId: 'session-1', fromRevision: 'r1', toRevision: 'r2', unknownDependency: true }, [artifact]);
    expect(unknown.affectedArtifactIds).toEqual(['artifact-1']);
    expect(unknown.reverificationPlan.some(item => item.kind === 'topology')).toBe(true);
  });
});
