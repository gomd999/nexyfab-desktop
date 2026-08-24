// @vitest-environment node
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { canonicalCadConsumerDraftJson } from '@/lib/cad/canonicalCadV2ConsumerDraft';
import type { MechanicalStableReferenceBinding } from '@/lib/cad/mechanicalStableReferenceBinding';

vi.mock('server-only', () => ({}));

import { createAiPrecisionBridgeJob, type AiPrecisionBridgeOutboxRecord } from './aiDesignPrecisionBridgeJobStore';
import { createAiDesignPrecisionVerificationRequest } from './aiDesignPrecisionVerification';
import { runNextAiDesignPrecisionExactJob } from './aiDesignPrecisionExactWorker';
import { serverEvidenceSha256 } from './serverEvidence';

const hash = (character: string) => character.repeat(64);
const at = new Date('2026-08-24T12:10:00.000Z');
const secret = 'ai-precision-worker-signing-secret-at-least-32-bytes';
const capability = 'ai-precision-worker-lease-capability-at-least-32-bytes';
const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

function binding(): MechanicalStableReferenceBinding {
  const material = {
    schema: 'nexyfab.precision-cad.mechanical-stable-reference-binding.v1' as const,
    authority: 'SERVER_CURRENT_CANONICAL_HEAD' as const,
    projectId: 'project-1', documentId: 'document-1',
    revision: { revisionId: 'revision-7', sequence: 7, contentSha256: hash('a') },
    partId: 'part-1', featureTreeSha256: hash('b'), rightsReceiptRevision: 'rights-1',
    rightsReceiptSha256: hash('c'), stableFeatures: [{ featureId: 'base', featureSha256: hash('d') }],
    exactExecution: 'NOT_RUN' as const, release: 'HOLD' as const,
    manufacturingReleaseReady: false as const,
  };
  return {
    ...material,
    bindingSha256: digest(canonicalCadConsumerDraftJson(material as never)),
  };
}

const request = createAiDesignPrecisionVerificationRequest({
  requestId: 'precision-request-1', projectId: 'project-1', sessionId: 'session-1',
  runtimeRevision: 5, complexRevision: 3, productStructureDigest: hash('e'),
  crossDomainContentHash: null, scopes: [{ kind: 'structure_node', id: 'part-1' }],
  requestedAt: '2026-08-24T12:00:00.000Z', expiresAt: '2026-08-24T13:00:00.000Z',
});

function outboxRecord(): AiPrecisionBridgeOutboxRecord {
  const job = createAiPrecisionBridgeJob({
    ownerKeySha256: hash('1'), projectId: 'project-1', sessionId: 'session-1',
    candidateId: 'candidate-1', handoffRequestId: 'handoff-1', handoffSha256: hash('2'),
    binding: binding(), precisionRequestId: request.requestId,
    precisionRequestSha256: request.requestDigest, runtimeRevision: 5,
    complexRevision: 3, queuedAt: '2026-08-24T12:00:00.000Z',
  });
  return {
    job, status: 'CLAIMED', attempt: 1, leaseGeneration: 1,
    leaseOwner: 'worker-1', leaseCapabilitySha256: hash('3'),
    leaseExpiresAt: at.getTime() + 60_000, availableAt: at.getTime(),
    lastError: null, createdAt: at.getTime(), updatedAt: at.getTime(),
  };
}

function exactBundle() {
  const step = 'ISO-10303-21;\nEND-ISO-10303-21;\n';
  const drawing = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1"/></svg>\n';
  const dimensions = '{"schema":"dimensions.v1","x":1,"y":1,"z":1}';
  const bom = '{"schema":"bom.v1","quantity":1}';
  const source = {
    projectId: 'project-1', documentId: 'document-1',
    revision: { revisionId: 'revision-7', sequence: 7, contentSha256: hash('a') },
    partId: 'part-1', featureTreeSha256: hash('b'),
    rightsReceiptRevision: 'rights-1', rightsReceiptSha256: hash('c'),
  };
  return {
    schema: 'nexyfab.precision-cad.current-canonical-mechanical-artifact-bundle.v1',
    status: 'EXACT_BUNDLE_PASS' as const, authority: 'SERVER_CURRENT_CANONICAL_HEAD',
    verification: 'NATIVE_OCCT_STEP_ROUNDTRIP_AND_HLR', release: 'HOLD', manufacturingRelease: 'BLOCKED',
    source,
    artifacts: {
      stepSha256: digest(step), drawingSha256: digest(drawing),
      dimensionsSha256: digest(dimensions), bomSha256: digest(bom),
      runtimeIdentitySha256: hash('4'), featureRegistrySha256: hash('5'),
    },
    artifactManifestSha256: hash('6'),
    handoff: {
      exactSinglePart: {
        step: { text: step }, drawing: { svg: drawing },
        dimensions: { receiptJson: dimensions }, bom: { receiptJson: bom },
        verification: { kernel: 'OCCT_NODE', valid: true, solidCount: 1 },
      },
    },
  };
}

function fixture() {
  const record = outboxRecord();
  const jobs = {
    recoverExpiredClaims: vi.fn(async () => 0),
    readNextVerifiedUnknown: vi.fn(async () => null),
    reconcileVerifiedUnknownReceipt: vi.fn(async () => ({ ok: true as const, record: { ...record, status: 'COMPLETED' as const } })),
    claimNext: vi.fn(async () => ({ ok: true as const, record })),
    markSent: vi.fn(async () => ({ ok: true as const, record: { ...record, status: 'SENT' as const } })),
    hold: vi.fn(async (_jobId, code) => ({ ok: true as const, record: { ...record, status: 'HOLD' as const, lastError: code } })),
    acceptReceipt: vi.fn(async (_input: unknown) => ({ ok: true as const, record: { ...record, status: 'COMPLETED' as const } })),
  };
  const writes: Array<{ key: string; bytes: Buffer; expectedSha256: string }> = [];
  const objectSink = {
    put: vi.fn(async (key: string, bytes: Buffer, _contentType: string, expectedSha256: string) => {
      expect(digest(bytes.toString('utf8'))).toBe(expectedSha256);
      writes.push({ key, bytes, expectedSha256 });
    }),
    read: vi.fn(async (key: string, expectedSha256: string) => {
      const found = writes.find(item => item.key === key && item.expectedSha256 === expectedSha256);
      return found ? Buffer.from(found.bytes) : null;
    }),
  };
  const db = { queryAll: vi.fn(async () => []) };
  const dependencies = {
    db: db as never,
    jobs,
    artifacts: { getPrecisionRequest: vi.fn(async () => request) },
    objectSink,
    resolveStable: vi.fn(async () => ({ ok: true as const, status: 'STABLE_REFERENCES_BOUND' as const, binding: binding() })),
    loadAuthority: vi.fn(async () => ({ runtimeRevision: 5, complexRevision: 3, precisionRequestBound: true })),
    recordReceipt: vi.fn(async (_owner: unknown, _command: unknown, _receipt: unknown) => ({ ok: true as const, aggregate: {}, replayed: false, createdArtifactIds: [] })),
    buildBundle: vi.fn(async () => exactBundle() as never),
    now: () => new Date(at),
  };
  return { dependencies, jobs, objectSink, writes, record, db };
}

beforeEach(() => { vi.clearAllMocks(); });

describe('AI Design Precision exact worker', () => {
  it('revalidates authority, stores an immutable exact bundle, and closes the AI receipt loop', async () => {
    const { dependencies, jobs, writes } = fixture();
    const result = await runNextAiDesignPrecisionExactJob({
      workerId: 'worker-1', leaseCapability: capability, leaseMs: 60_000,
      signingSecret: secret, signingKeyId: 'precision-key-1',
    }, dependencies as never);

    expect(result).toMatchObject({ ok: true, status: 'COMPLETED', verification: 'PASS' });
    expect(writes).toHaveLength(6);
    expect(writes.every(item => item.key.startsWith('private/ai-precision-exact/v1/'))).toBe(true);
    expect(dependencies.recordReceipt).toHaveBeenCalledWith(hash('1'), expect.objectContaining({
      type: 'RECORD_PRECISION_RECEIPT', expectedRuntimeRevision: 5, expectedComplexRevision: 3,
    }), expect.objectContaining({ status: 'PASS', manufacturingReleaseReady: false }));
    const accepted = jobs.acceptReceipt.mock.calls[0]![0] as {
      exactArtifactSha256: string;
      receipt: { scopeResults: Array<{ exactArtifactDigest: string | null }> };
      artifactManifest: unknown;
    };
    expect(accepted.receipt.scopeResults[0].exactArtifactDigest).toBe(accepted.exactArtifactSha256);
    expect(accepted.artifactManifest).toMatchObject({ exactExecution: 'PASS', release: 'HOLD', manufacturingReleaseReady: false });
  });

  it('holds a stale request before dispatching any exact execution', async () => {
    const { dependencies, jobs, objectSink } = fixture();
    dependencies.loadAuthority.mockResolvedValue({ runtimeRevision: 6, complexRevision: 3, precisionRequestBound: true });
    const result = await runNextAiDesignPrecisionExactJob({
      workerId: 'worker-1', leaseCapability: capability, leaseMs: 60_000,
      signingSecret: secret, signingKeyId: 'precision-key-1',
    }, dependencies as never);

    expect(result).toMatchObject({ ok: true, status: 'HOLD', code: 'AI_PRECISION_REQUEST_STALE' });
    expect(jobs.markSent).not.toHaveBeenCalled();
    expect(objectSink.put).not.toHaveBeenCalled();
  });

  it('records a signed FAIL receipt when bounded exact generation returns a known HOLD', async () => {
    const { dependencies, jobs, objectSink } = fixture();
    dependencies.buildBundle.mockResolvedValue({
      schema: 'nexyfab.precision-cad.current-canonical-mechanical-artifact-bundle.v1',
      status: 'HOLD', authority: 'SERVER_CURRENT_CANONICAL_HEAD', release: 'HOLD',
      manufacturingRelease: 'BLOCKED', blockers: ['OCCT execution unavailable'],
    } as never);
    const result = await runNextAiDesignPrecisionExactJob({
      workerId: 'worker-1', leaseCapability: capability, leaseMs: 60_000,
      signingSecret: secret, signingKeyId: 'precision-key-1',
    }, dependencies as never);

    expect(result).toMatchObject({ ok: true, status: 'COMPLETED', verification: 'FAIL', exactArtifactSha256: null });
    expect(objectSink.put).not.toHaveBeenCalled();
    expect(jobs.acceptReceipt.mock.calls[0]![0]).toMatchObject({
      exactArtifactSha256: null,
      receipt: { status: 'FAIL', scopeResults: [{ status: 'FAIL', exactArtifactDigest: null }] },
    });
  });

  it('reconciles a persisted PASS receipt after lease uncertainty without executing CAD twice', async () => {
    const { dependencies, jobs, writes, record, db } = fixture();
    jobs.acceptReceipt.mockResolvedValueOnce({ ok: false, code: 'LEASE_EXPIRED' } as never);
    const first = await runNextAiDesignPrecisionExactJob({
      workerId: 'worker-1', leaseCapability: capability, leaseMs: 60_000,
      signingSecret: secret, signingKeyId: 'precision-key-1',
    }, dependencies as never);
    expect(first).toMatchObject({ ok: false, status: 'LEASE_UNCERTAIN' });
    const receipt = dependencies.recordReceipt.mock.calls[0]![2];
    const valueJson = JSON.stringify(receipt);
    db.queryAll.mockResolvedValue([{
      value_json: valueJson, content_sha256: serverEvidenceSha256(receipt),
      byte_length: Buffer.byteLength(valueJson, 'utf8'),
    }] as never);
    jobs.readNextVerifiedUnknown.mockResolvedValue({ ...record, status: 'VERIFIED_UNKNOWN' } as never);
    jobs.recoverExpiredClaims.mockResolvedValue(1);

    const second = await runNextAiDesignPrecisionExactJob({
      workerId: 'worker-1', leaseCapability: capability, leaseMs: 60_000,
      signingSecret: secret, signingKeyId: 'precision-key-1',
    }, dependencies as never);
    expect(second).toMatchObject({ ok: true, status: 'COMPLETED', recoveredUnknown: 1, verification: 'PASS' });
    expect(jobs.claimNext).toHaveBeenCalledTimes(1);
    expect(dependencies.buildBundle).toHaveBeenCalledTimes(1);
    expect(jobs.reconcileVerifiedUnknownReceipt).toHaveBeenCalledWith(expect.objectContaining({
      exactArtifactSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      artifactManifest: expect.objectContaining({ manifestObjectKey: expect.stringContaining('/manifest-') }),
    }));
    expect(writes).toHaveLength(6);
  });
});
