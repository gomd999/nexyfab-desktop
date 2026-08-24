import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { createDesignIntentCheckpoint } from './designIntentCheckpoint';
import { createAiDesignServerGenerationWorker, type AiDesignGeneratedStageArtifactV1 } from './aiDesignServerGenerationWorker';

const hash = (char: string) => char.repeat(64);
const checkpoint = createDesignIntentCheckpoint({
  checkpointId: 'checkpoint-1', projectId: 'project-1', revision: 0, projectContentHash: hash('a'),
  sources: [{ id: 'source-1', kind: 'text', projectId: 'project-1', revision: 0, sourceHash: hash('b'), authority: 'user_confirmed', provenance: { rights: 'user_owned', aiUseAllowed: true, derivativeUseAllowed: true }, fields: [{ key: 'purpose', value: 'bracket', category: 'requirement' }] }],
});
const workerInput = { runId: 'run-1', projectId: 'project-1', baseRevision: 0, checkpointId: 'checkpoint-1', checkpointDigest: hash('a'), stage: 'planning' as const, selectedModelId: 'gpt-luna', attempt: 1, signal: new AbortController().signal };

describe('AI Design server generation worker', () => {
  it('resolves the public model, validates output, and stores the immutable artifact before PASS', async () => {
    const artifacts: AiDesignGeneratedStageArtifactV1[] = [];
    const complete = vi.fn(async () => ({ text: JSON.stringify({ summary: 'Plan an editable bracket concept.', decisions: [{ id: 'd1', statement: 'Use an editable thickness parameter.', basis: 'user_confirmed', intentKeys: ['purpose'] }], unresolvedQuestions: [], candidateBlueprints: [] }), provider: 'openai' as const, model: 'private-runtime-model', latencyMs: 12 }));
    const worker = createAiDesignServerGenerationWorker({ plan: 'free', userId: 'user-1', loadCheckpoint: async () => checkpoint, artifactSink: { putImmutable: async artifact => { artifacts.push(artifact); } }, complete, resolveModel: async () => ({ ok: true, catalog: {} as never, provider: 'openai', model: 'private-runtime-model', cacheProfile: 'provider-default' }), now: () => '2026-08-24T04:00:00.000Z' });
    const result = await worker(workerInput);
    expect(result).toMatchObject({ source: 'ai-design-worker-v2', codes: ['structured_output_valid', 'concept_only', 'artifact_stored'] });
    expect(artifacts[0]).toMatchObject({ outputDigest: result.outputDigest, selectedPublicModelId: 'gpt-luna', execution: { provider: 'openai', runtimeModel: 'private-runtime-model' }, output: { maturity: 'concept', policy: { exactGeometryAuthority: false, manufacturingReleaseReady: false } } });
  });

  it('fails closed for checkpoint drift, provider fallback, or malformed model claims', async () => {
    const base = { plan: 'free', userId: 'user-1', artifactSink: { putImmutable: vi.fn(async () => undefined) }, resolveModel: async () => ({ ok: true as const, catalog: {} as never, provider: 'openai' as const, model: 'private-runtime-model', cacheProfile: 'provider-default' as const }) };
    const complete = async () => ({ text: JSON.stringify({ summary: 'Exact geometry verified', decisions: [], unresolvedQuestions: [], candidateBlueprints: [] }), provider: 'openai' as const, model: 'private-runtime-model', latencyMs: 1 });
    await expect(createAiDesignServerGenerationWorker({ ...base, loadCheckpoint: async () => ({ ...checkpoint, projectContentHash: hash('c') }), complete })(workerInput)).rejects.toThrow('checkpoint_binding_failed');
    await expect(createAiDesignServerGenerationWorker({ ...base, loadCheckpoint: async () => checkpoint, complete })(workerInput)).rejects.toThrow('output_invalid');
    await expect(createAiDesignServerGenerationWorker({ ...base, loadCheckpoint: async () => checkpoint, complete: async () => ({ ...(await complete()), text: JSON.stringify({ summary: 'Safe plan', decisions: [], unresolvedQuestions: [], candidateBlueprints: [] }), provider: 'qwen' as const }) })(workerInput)).rejects.toThrow('execution_binding_failed');
  });
});
