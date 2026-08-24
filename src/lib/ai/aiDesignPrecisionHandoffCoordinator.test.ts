// @vitest-environment node
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { canonicalCadConsumerDraftJson } from '@/lib/cad/canonicalCadV2ConsumerDraft';
import type { MechanicalStableReferenceBinding } from '@/lib/cad/mechanicalStableReferenceBinding';

const mocks = vi.hoisted(() => ({
  resolveStable: vi.fn(),
  loadRuntime: vi.fn(),
  executeRuntime: vi.fn(),
  executeComplex: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/cad/mechanicalStableReferenceBinding', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/cad/mechanicalStableReferenceBinding')>()),
  resolveMechanicalStableReferences: mocks.resolveStable,
}));
vi.mock('./aiDesignWorkspaceRuntimeStore', () => ({
  loadServerAiDesignWorkspaceRuntime: mocks.loadRuntime,
}));
vi.mock('./aiDesignWorkspaceActionService', () => ({
  executeAiDesignWorkspaceClientCommand: mocks.executeRuntime,
}));
vi.mock('./aiDesignComplexWorkspaceService', () => ({
  executeAiDesignComplexWorkspaceCommand: mocks.executeComplex,
}));

import { createAiDesignCandidateArtifact } from './aiDesignCandidateArtifact';
import { createAiDesignPrecisionVerificationRequest } from './aiDesignPrecisionVerification';
import { enqueueAiDesignPrecisionHandoff } from './aiDesignPrecisionHandoffCoordinator';
import { createAiPrecisionBridgeJob } from './aiDesignPrecisionBridgeJobStore';
import { aiDesignWorkspaceCommandV3Digest } from './aiDesignWorkspaceCommandV3';
import { serverEvidenceSha256 } from './serverEvidence';

const hash = (character: string) => character.repeat(64);
const now = new Date('2026-08-24T12:00:00.000Z');
const secret = 'ai-precision-coordinator-signing-secret-32-bytes';
const handoff = {
  schema: 'nexyfab.ai-design-precision-cad-handoff.v1' as const,
  kind: 'precision-cad-handoff' as const,
  requestId: 'handoff-1', projectId: 'project-1', sessionId: 'session-1',
  expectedRuntimeRevision: 4, expectedComplexRevision: 2, candidateId: 'candidate-1',
  explicitCommitRequired: true as const, exactExecution: false as const,
  verificationPass: false as const, manufacturingReleaseReady: false as const,
};

function binding(): MechanicalStableReferenceBinding {
  const material = {
    schema: 'nexyfab.precision-cad.mechanical-stable-reference-binding.v1' as const,
    authority: 'SERVER_CURRENT_CANONICAL_HEAD' as const,
    projectId: 'project-1', documentId: 'document-1',
    revision: { revisionId: 'revision-7', sequence: 7, contentSha256: hash('a') },
    partId: 'part-1', featureTreeSha256: hash('b'),
    rightsReceiptRevision: 'rights-1', rightsReceiptSha256: hash('c'),
    stableFeatures: [{ featureId: 'base', featureSha256: hash('d') }],
    exactExecution: 'NOT_RUN' as const, release: 'HOLD' as const,
    manufacturingReleaseReady: false as const,
  };
  const bindingSha256 = createHash('sha256')
    .update(canonicalCadConsumerDraftJson(material as never), 'utf8').digest('hex');
  return { ...material, bindingSha256 };
}

function fixture(sourceDigest?: string) {
  const candidate = createAiDesignCandidateArtifact({
    trustedServer: true, artifactId: 'candidate-artifact-1', candidateId: 'candidate-1',
    projectId: 'project-1', sessionId: 'session-1', baseRevision: 'revision-7',
    artifactRevision: 1, status: 'published', createdAt: now.toISOString(),
    contentDigest: hash('e'), designDigest: hash('f'),
    dependencies: { intentNodeIds: ['intent-1'], parameterIds: [], gaugeIds: [], featureIds: ['base'] },
    evidence: [], server: { generatorId: 'generator-1', modelId: 'model-1', runtimeId: 'runtime-1', workerBuildDigest: hash('9'), generationRunId: 'run-1' },
    supersedes: null,
  });
  const structure = {
    artifactId: 'structure-artifact-1', artifactDigest: hash('8'),
    graph: { nodes: [{ nodeId: 'part-1', kind: 'component', sourceDigest: sourceDigest ?? candidate.manifestDigest }] },
  };
  const aggregate = {
    complexRevision: 2, appliedCommands: [],
    productStructure: { artifactId: structure.artifactId, artifactDigest: structure.artifactDigest },
  };
  let precisionRequest: ReturnType<typeof createAiDesignPrecisionVerificationRequest> | null = null;
  const artifacts = {
    listCandidateArtifacts: vi.fn(async () => [candidate]),
    getProductStructureSidecar: vi.fn(async () => structure),
    getPrecisionRequest: vi.fn(async () => precisionRequest),
    putImmutable: vi.fn(async () => undefined),
  };
  const store = { loadOrCreate: vi.fn(async () => aggregate) };
  const jobs = {
    readByHandoff: vi.fn(async () => null),
    enqueue: vi.fn(async job => ({
      ok: true as const, replayed: false,
      record: { job, status: 'PENDING' as const, attempt: 0, leaseGeneration: 0 },
    })),
  };
  mocks.executeComplex.mockImplementation(async (_ownerKey, command) => {
    const updated = { ...aggregate, complexRevision: 3, appliedCommands: [{ commandId: command.commandId }] };
    const requestId = `precision-request:${aiDesignWorkspaceCommandV3Digest(command).slice(0, 48)}`;
    precisionRequest = createAiDesignPrecisionVerificationRequest({
      requestId, projectId: 'project-1', sessionId: 'session-1', runtimeRevision: 5,
      complexRevision: 3, productStructureDigest: structure.artifactDigest,
      crossDomainContentHash: null, scopes: [{ kind: 'structure_node', id: 'part-1' }],
      requestedAt: now.toISOString(), expiresAt: '2026-08-24T13:00:00.000Z',
    });
    return { ok: true, replayed: false, aggregate: updated };
  });
  return { artifacts, store, jobs, candidate };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadRuntime.mockResolvedValue({
    projectId: 'project-1', session: { sessionId: 'session-1', eventIds: [] },
    selectedCandidateId: 'candidate-1', revisionToken: 'revision-7',
    candidates: { baseRevision: 'revision-7' }, runtimeRevision: 4,
    checkpoint: { projectContentHash: hash('a') },
  });
  mocks.resolveStable.mockResolvedValue({ ok: true, status: 'STABLE_REFERENCES_BOUND', binding: binding() });
  mocks.executeRuntime.mockResolvedValue({ ok: true, replayed: false, state: { runtimeRevision: 5 } });
});

describe('AI Design Precision handoff coordinator', () => {
  it('binds the candidate to the current CAD head and enqueues one durable exact job', async () => {
    const { artifacts, store, jobs } = fixture();
    const result = await enqueueAiDesignPrecisionHandoff({
      ownerKey: 'user-1:project-1', authenticatedPlan: 'pro', handoff, signingSecret: secret,
    }, { db: {} as never, artifacts: artifacts as never, store: store as never, jobs: jobs as never, now: () => now });

    expect(result).toMatchObject({ ok: true, replayed: false, runtimeRevision: 5, complexRevision: 3 });
    expect(mocks.resolveStable).toHaveBeenCalledWith({}, {
      projectId: 'project-1', baseRevisionId: 'revision-7',
      baseContentSha256: hash('a'), stableFeatureIds: ['base'],
    });
    expect(jobs.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      schema: 'nexyfab.ai-precision-exact-bridge-job.v1', projectId: 'project-1',
      precisionRequestSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      binding: expect.objectContaining({ authority: 'SERVER_CURRENT_CANONICAL_HEAD' }),
    }), now.getTime());
  });

  it('holds before runtime mutation when no component is digest-bound to the candidate', async () => {
    const { artifacts, store, jobs } = fixture(hash('0'));
    const result = await enqueueAiDesignPrecisionHandoff({
      ownerKey: 'user-1:project-1', authenticatedPlan: 'pro', handoff, signingSecret: secret,
    }, { db: {} as never, artifacts: artifacts as never, store: store as never, jobs: jobs as never, now: () => now });

    expect(result).toEqual({ ok: false, code: 'AI_PRECISION_STRUCTURE_REBIND_REQUIRED' });
    expect(mocks.executeRuntime).not.toHaveBeenCalled();
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it('returns an identical durable job for an exact handoff replay without mutating workspaces', async () => {
    const { artifacts, store, jobs } = fixture();
    const existingJob = createAiPrecisionBridgeJob({
      ownerKeySha256: hash('1'), projectId: 'project-1', sessionId: 'session-1',
      candidateId: 'candidate-1', handoffRequestId: 'handoff-1',
      handoffSha256: serverEvidenceSha256(handoff), binding: binding(),
      precisionRequestId: 'precision-request-1', precisionRequestSha256: hash('2'),
      runtimeRevision: 5, complexRevision: 3, queuedAt: now.toISOString(),
    });
    jobs.readByHandoff.mockResolvedValue({
      job: existingJob, status: 'PENDING', attempt: 0, leaseGeneration: 0,
    } as never);
    const result = await enqueueAiDesignPrecisionHandoff({
      ownerKey: 'user-1:project-1', authenticatedPlan: 'pro', handoff, signingSecret: secret,
    }, { db: {} as never, artifacts: artifacts as never, store: store as never, jobs: jobs as never, now: () => now });

    expect(result).toMatchObject({ ok: true, replayed: true, record: { job: existingJob } });
    expect(mocks.loadRuntime).not.toHaveBeenCalled();
    expect(mocks.executeRuntime).not.toHaveBeenCalled();
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });
});
