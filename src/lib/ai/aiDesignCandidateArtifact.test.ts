import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { createAiDesignCandidateArtifact, InMemoryAiDesignCandidateArtifactStore, validateAiDesignCandidateArtifact, validateAiDesignCandidateArtifactOwnership } from './aiDesignCandidateArtifact';

const input = (overrides: Record<string, unknown> = {}) => ({
  trustedServer: true as const, artifactId: 'artifact-1', candidateId: 'candidate-1', projectId: 'project-1', sessionId: 'session-1', baseRevision: 'r1', artifactRevision: 1, status: 'published' as const, createdAt: '2026-08-24T00:00:00.000Z', contentDigest: 'a'.repeat(64), designDigest: 'b'.repeat(64), dependencies: { intentNodeIds: ['intent-1'], parameterIds: ['param-1'], gaugeIds: ['gauge-1'], featureIds: ['feature-1'] }, evidence: [{ evidenceId: 'geometry', kind: 'geometry', status: 'unknown' as const }], server: { generatorId: 'generator-1', modelId: 'model-1', runtimeId: 'runtime-1', workerBuildDigest: 'c'.repeat(64), generationRunId: 'run-1' }, supersedes: null, ...overrides,
});

describe('AI Design candidate artifact', () => {
  it('creates an immutable, hash-bound manifest and validates it', () => {
    const artifact = createAiDesignCandidateArtifact(input());
    expect(Object.isFrozen(artifact)).toBe(true);
    expect(validateAiDesignCandidateArtifact(artifact)).toEqual([]);
    expect(() => (artifact as { status: string }).status = 'invalidated').toThrow();
  });
  it('binds ownership and refuses overwrites', () => {
    const artifact = createAiDesignCandidateArtifact(input());
    expect(validateAiDesignCandidateArtifactOwnership(artifact, { projectId: 'other', sessionId: 'session-1' })).toEqual(['artifact_project_mismatch']);
    const store = new InMemoryAiDesignCandidateArtifactStore();
    expect(store.append(artifact)).toEqual({ ok: true });
    expect(store.append(artifact)).toEqual({ ok: false, issues: ['artifact_already_appended'] });
    const replacement = createAiDesignCandidateArtifact(input({ artifactId: 'artifact-1', designDigest: 'd'.repeat(64) }));
    expect(store.append(replacement)).toEqual({ ok: false, issues: ['artifact_overwrite_forbidden'] });
  });
});
