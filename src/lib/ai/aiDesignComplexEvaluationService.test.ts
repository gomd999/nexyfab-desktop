import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createAiDesignCandidateArtifact } from './aiDesignCandidateArtifact';
import { evaluateAiDesignComplexCandidateSet } from './aiDesignComplexEvaluationService';
import { InMemoryAiDesignServerRuntimeArtifacts } from './aiDesignServerRuntimeArtifacts';
import { createProductStructureGraph } from './aiDesignProductStructureGraph';

const hash = (character: string) => character.repeat(64);
const secret = 'complex-evaluation-secret-at-least-32-bytes';

function artifact(candidateId: string, featureIds: string[], parameterIds: string[]) {
  return createAiDesignCandidateArtifact({
    trustedServer: true, artifactId: `artifact-${candidateId}`, candidateId, projectId: 'project-1', sessionId: 'session-1',
    baseRevision: 'revision-1', artifactRevision: 1, status: 'published', createdAt: '2026-08-24T09:00:00.000Z',
    contentDigest: hash('a'), designDigest: hash(candidateId === 'candidate-1' ? 'b' : 'c'),
    dependencies: { intentNodeIds: ['intent-purpose'], parameterIds, gaugeIds: [], featureIds }, evidence: [],
    server: { generatorId: 'ai-design-worker-v2', modelId: 'gpt-luna', runtimeId: 'runtime-model', workerBuildDigest: hash('d'), generationRunId: 'run-1' }, supersedes: null,
  });
}

describe('AI Design complex evaluation service', () => {
  it('runs, signs, and immutably stores actual conceptual critic bundles for every candidate', async () => {
    const store = new InMemoryAiDesignServerRuntimeArtifacts();
    const structure = createProductStructureGraph({
      projectId: 'project-1', sessionId: 'session-1', revision: 'revision-1', rootNodeId: 'root',
      nodes: [{ nodeId: 'root', kind: 'assembly', label: 'Machine', parentId: null, sourceIntentNodeIds: ['intent-purpose'] }, { nodeId: 'part', kind: 'component', label: 'Frame', parentId: 'root', sourceIntentNodeIds: ['intent-purpose'] }],
      edges: [{ edgeId: 'contains-part', kind: 'contains', from: 'root', to: 'part' }], interfaces: [],
    });
    const candidates = [
      { artifact: artifact('candidate-1', ['body', 'rib'], ['thickness']), title: 'Compact frame', summary: 'Compact reinforced frame' },
      { artifact: artifact('candidate-2', ['frame', 'door'], ['clearance']), title: 'Service frame', summary: 'Accessible service frame' },
    ];
    const bundles = await evaluateAiDesignComplexCandidateSet({
      projectId: 'project-1', sessionId: 'session-1', runId: 'run-1', checkpointDigest: hash('e'),
      candidates, productStructure: structure, crossDomainGraph: null,
    }, { sink: store, signingSecret: secret, now: () => new Date('2026-08-24T09:00:00.000Z') });
    expect(bundles).toHaveLength(2);
    expect(bundles.every(item => item.conceptReviewReady && !item.engineeringVerified && item.status === 'INCOMPLETE')).toBe(true);
    expect(store.listCriticBundles({ projectId: 'project-1', sessionId: 'session-1' })).toHaveLength(2);
    await store.putCriticBundleImmutable(bundles[0]!);
    await expect(store.putCriticBundleImmutable({ ...bundles[0]!, status: 'FAIL' })).rejects.toThrow('OVERWRITE_FORBIDDEN');
  });
});
