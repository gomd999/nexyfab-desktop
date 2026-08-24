import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { createAiDesignWorkspaceRuntime } from './aiDesignWorkspaceRuntime';
import { createServerAiDesignWorkspaceRuntime, resetAiDesignWorkspaceRuntimeStoreForTests } from './aiDesignWorkspaceRuntimeStore';
import { InMemoryAiDesignServerRuntimeArtifacts } from './aiDesignServerRuntimeArtifacts';
import { advanceServerAiDesignGeneration, executeAiDesignWorkspaceClientCommand } from './aiDesignWorkspaceActionService';
import type { AiDesignWorkspaceClientCommandV2 } from './aiDesignWorkspaceCommandV2';

const hash = (char: string) => char.repeat(64);
const secret = 'ai-design-server-evidence-secret-at-least-32-bytes';
const now = new Date('2026-08-24T05:00:00.000Z');
const input = { projectId: 'project-1', revision: 0, sourceId: 'source-1', sourceHash: hash('a'), projectContentHash: hash('b'), kind: 'text' as const, mimeType: 'text/plain', sizeBytes: 50, authority: 'user_confirmed' as const, provenance: { rights: 'user_owned' as const, origin: 'user' }, fields: [{ key: 'purpose', value: 'bracket', category: 'requirement' as const }] };

function command(type: string, payload: Record<string, unknown>, expectedRuntimeRevision = 0): AiDesignWorkspaceClientCommandV2 {
  return { schema: 'nexyfab.ai-design-workspace-command.v2' as const, commandId: `cmd:${type}`, projectId: 'project-1', sessionId: 'session-1', expectedRuntimeRevision, issuedAt: now.toISOString(), type, payload } as unknown as AiDesignWorkspaceClientCommandV2;
}

async function initial() {
  const created = createAiDesignWorkspaceRuntime({ projectId: 'project-1', revisionToken: 'rev-0', sessionId: 'session-1', inputs: [input], now: now.toISOString() });
  if (!created.ok) throw new Error(created.issues.join(','));
  await createServerAiDesignWorkspaceRuntime('owner-1', created.state);
  return created.state;
}

afterEach(() => resetAiDesignWorkspaceRuntimeStoreForTests());

describe('AI Design workspace action service', () => {
  it('issues server evidence and never accepts client-authored understanding PASS', async () => {
    await initial();
    const sink = new InMemoryAiDesignServerRuntimeArtifacts();
    const result = await executeAiDesignWorkspaceClientCommand('owner-1', 'free', command('REQUEST_UNDERSTANDING_CONFIRMATION', { acknowledged: true }), { receiptSink: sink, signingSecret: secret, now: () => now });
    expect(result).toMatchObject({ ok: true, state: { runtimeRevision: 1, workflow: { status: 'READY_TO_GENERATE', evidence: { status: 'PASS' } } }, receipts: [{ producer: 'ai-design-server-runtime-v2' }] });
    if (result.ok) expect(sink.getReceipt(result.receipts[0]!.receiptId)).not.toBeNull();
  });

  it('keeps unresolved conflicts in the runtime and moves them to NEEDS_INPUT', async () => {
    const conflicting = { ...input, sourceId: 'source-2', sourceHash: hash('c'), fields: [{ key: 'purpose', value: 'fixture', category: 'requirement' as const }] };
    const created = createAiDesignWorkspaceRuntime({ projectId: 'project-1', revisionToken: 'rev-0', sessionId: 'session-conflict', inputs: [input, conflicting], now: now.toISOString() });
    if (!created.ok) throw new Error(created.issues.join(','));
    expect(created.state.checkpoint).toMatchObject({ readiness: { ready: false }, conflicts: [{ key: 'purpose' }] });
    await createServerAiDesignWorkspaceRuntime('owner-conflict', created.state);
    const sink = new InMemoryAiDesignServerRuntimeArtifacts();
    const conflictCommand = { ...command('REQUEST_UNDERSTANDING_CONFIRMATION', { acknowledged: true }), sessionId: 'session-conflict' };
    const result = await executeAiDesignWorkspaceClientCommand('owner-conflict', 'free', conflictCommand, { receiptSink: sink, signingSecret: secret, now: () => now });
    expect(result).toMatchObject({ ok: true, state: { workflow: { status: 'NEEDS_INPUT' } }, receipts: [{ codes: ['checkpoint_needs_input'] }] });
  });

  it('binds model entitlement to auth plan and CAS-rejects stale commands', async () => {
    await initial(); const sink = new InMemoryAiDesignServerRuntimeArtifacts();
    const confirmed = await executeAiDesignWorkspaceClientCommand('owner-1', 'free', command('REQUEST_UNDERSTANDING_CONFIRMATION', { acknowledged: true }), { receiptSink: sink, signingSecret: secret, now: () => now });
    if (!confirmed.ok) throw new Error(confirmed.code);
    const started = await executeAiDesignWorkspaceClientCommand('owner-1', 'free', command('START_GENERATION_REQUEST', { runId: 'run-1', modelSelection: { mode: 'auto', modelId: 'gpt-terra' } }, 1), { receiptSink: sink, signingSecret: secret, now: () => now });
    expect(started).toMatchObject({ ok: true, generationRequested: true, state: { generation: { modelReceipt: { plan: 'free', selectedModelId: 'gpt-luna' } } } });
    expect(await executeAiDesignWorkspaceClientCommand('owner-1', 'free', command('CANCEL', {}, 1), { receiptSink: sink, signingSecret: secret, now: () => now })).toMatchObject({ ok: false, code: 'AI_DESIGN_WORKSPACE_REVISION_CONFLICT' });
  });

  it('advances only from a worker result and binds the stage digest to a signed receipt', async () => {
    await initial(); const sink = new InMemoryAiDesignServerRuntimeArtifacts();
    const confirmed = await executeAiDesignWorkspaceClientCommand('owner-1', 'free', command('REQUEST_UNDERSTANDING_CONFIRMATION', { acknowledged: true }), { receiptSink: sink, signingSecret: secret, now: () => now });
    if (!confirmed.ok) throw new Error(confirmed.code);
    const started = await executeAiDesignWorkspaceClientCommand('owner-1', 'free', command('START_GENERATION_REQUEST', { runId: 'run-1', modelSelection: { mode: 'auto' } }, 1), { receiptSink: sink, signingSecret: secret, now: () => now });
    if (!started.ok) throw new Error(started.code);
    const worker = vi.fn(async () => ({ outputDigest: hash('c'), source: 'untrusted-worker-label', codes: ['schema_valid'] }));
    const advanced = await advanceServerAiDesignGeneration('owner-1', 'project-1', 'session-1', { worker, receiptSink: sink, signingSecret: secret, now: () => now });
    expect(advanced).toMatchObject({ ok: true, state: { generation: { currentStage: 'planning', stages: { understanding: { status: 'PASS', outputDigest: hash('c') } } } }, receipts: [{ stage: 'understanding', outcome: 'PASS' }] });
    if (advanced.ok) expect(advanced.state.generation?.stages.understanding.source).toBe(advanced.receipts[0]!.receiptId);
  });

  it('publishes immutable concept candidates after final validation without inventing exact verification', async () => {
    await initial(); const sink = new InMemoryAiDesignServerRuntimeArtifacts();
    let result = await executeAiDesignWorkspaceClientCommand('owner-1', 'free', command('REQUEST_UNDERSTANDING_CONFIRMATION', { acknowledged: true }), { receiptSink: sink, signingSecret: secret, now: () => now });
    if (!result.ok) throw new Error(result.code);
    result = await executeAiDesignWorkspaceClientCommand('owner-1', 'free', command('START_GENERATION_REQUEST', { runId: 'run-1', modelSelection: { mode: 'auto' } }, 1), { receiptSink: sink, signingSecret: secret, now: () => now });
    if (!result.ok) throw new Error(result.code);
    const stageDigests = { understanding: hash('c'), planning: hash('d'), candidate_generation: hash('e'), candidate_validation: hash('f') } as const;
    const worker = vi.fn(async (workerInput: Parameters<import('./aiDesignGenerationOrchestrator').AiDesignGenerationWorker>[0]) => {
      const outputDigest = stageDigests[workerInput.stage];
      await sink.putImmutable({
        schema: 'nexyfab.ai-design-generated-stage-artifact.v1', artifactId: `stage-${workerInput.stage}`,
        projectId: workerInput.projectId, runId: workerInput.runId, checkpointId: workerInput.checkpointId,
        stage: workerInput.stage, attempt: workerInput.attempt, inputDigest: workerInput.checkpointDigest, outputDigest,
        selectedPublicModelId: workerInput.selectedModelId, execution: { provider: 'openai', runtimeModel: 'private-model', latencyMs: 1 },
        output: {
          schema: 'nexyfab.ai-design-generated-stage-output.v1', runId: workerInput.runId, projectId: workerInput.projectId,
          checkpointId: workerInput.checkpointId, checkpointDigest: workerInput.checkpointDigest, stage: workerInput.stage,
          attempt: workerInput.attempt, maturity: 'concept', summary: 'Editable concept stage',
          decisions: [{ id: 'decision-1', statement: 'Keep the purpose as a bracket.', basis: 'user_confirmed', intentKeys: ['purpose'] }],
          unresolvedQuestions: [],
          candidateBlueprints: workerInput.stage === 'candidate_validation' ? [
            { id: 'candidate-1', title: 'Compact bracket concept', summary: 'Editable compact concept', parameterKeys: ['thickness'], featureKeys: ['body', 'rib'] },
            { id: 'candidate-2', title: 'Serviceable bracket concept', summary: 'Editable tool-access concept', parameterKeys: ['clearance'], featureKeys: ['body', 'access-cut'] },
          ] : [],
          policy: { exactGeometryAuthority: false, manufacturingReleaseReady: false, copyrightSafeConceptOnly: true },
        },
        createdAt: now.toISOString(),
      });
      return { outputDigest, source: 'ai-design-worker-v2', codes: ['concept_only'] };
    });
    const evaluatePublishedConcepts = vi.fn(async ({ candidates }: { candidates: readonly { candidateId: string }[] }) => candidates.map(candidate => ({ candidateId: candidate.candidateId, conceptReviewReady: true, status: 'INCOMPLETE' as const })));
    let advanced;
    for (let index = 0; index < 4; index += 1) {
      advanced = await advanceServerAiDesignGeneration('owner-1', 'project-1', 'session-1', {
        worker, receiptSink: sink, signingSecret: secret, now: () => now,
        loadStageArtifactByOutputDigest: digest => sink.getStageArtifactByOutputDigest(digest),
        putCandidateArtifactImmutable: artifact => sink.putCandidateArtifactImmutable(artifact),
        evaluatePublishedConcepts,
      });
      if (!advanced.ok) throw new Error(`${advanced.code}:${advanced.issues?.join(',') ?? ''}`);
    }
    expect(advanced).toMatchObject({ ok: true, generationRequested: false, state: { workflow: { status: 'CANDIDATE_REVIEW' } }, receipts: [{ stage: 'candidate_validation' }, { stage: 'candidate_publication' }] });
    if (!advanced?.ok) throw new Error('candidate_publication_failed');
    const candidates = advanced.state.candidates?.candidates;
    expect(candidates).toHaveLength(2);
    expect(candidates?.every(candidate => candidate.evidence.every(item => item.status === 'unknown') && candidate.metrics.length === 0)).toBe(true);
    expect(sink.listCandidateArtifacts({ projectId: 'project-1', sessionId: 'session-1' })).toHaveLength(2);
    expect(evaluatePublishedConcepts).toHaveBeenCalledTimes(1);
  });
});
