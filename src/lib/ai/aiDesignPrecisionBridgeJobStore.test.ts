// @vitest-environment node
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbAdapter } from '@/lib/db-adapter';
import { canonicalCadConsumerDraftJson } from '@/lib/cad/canonicalCadV2ConsumerDraft';
import type { MechanicalStableReferenceBinding } from '@/lib/cad/mechanicalStableReferenceBinding';
import {
  createAiPrecisionBridgeJob,
  PostgresAiPrecisionBridgeJobStore,
  type AiPrecisionBridgeJobV1,
} from './aiDesignPrecisionBridgeJobStore';
import {
  createAiDesignPrecisionVerificationRequest,
  issueAiDesignPrecisionVerificationReceipt,
} from './aiDesignPrecisionVerification';
import { serverEvidenceSha256 } from './serverEvidence';
import {
  advanceAiDesignComplexWorkspaceAggregate,
  createAiDesignComplexWorkspaceAggregate,
} from './aiDesignComplexWorkspaceAggregate';

vi.mock('server-only', () => ({}));

const migrationChecksum = '6ca9f2a5156f0aa5ebffd39799cd6f93c6b470b30ba3a7b8caa189d7bcbf2ba0';
const hex = (character: string) => character.repeat(64);
const signingSecret = 'precision-bridge-signing-secret-at-least-32-bytes';
const capability = 'worker-lease-capability-at-least-32-bytes';

type Row = Record<string, unknown>;

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalCadConsumerDraftJson(value as never), 'utf8').digest('hex');
}

function binding(): MechanicalStableReferenceBinding {
  const material = {
    schema: 'nexyfab.precision-cad.mechanical-stable-reference-binding.v1' as const,
    authority: 'SERVER_CURRENT_CANONICAL_HEAD' as const,
    projectId: 'project-1', documentId: 'document-1',
    revision: { revisionId: 'revision-7', sequence: 7, contentSha256: hex('a') },
    partId: 'part-1', featureTreeSha256: hex('b'),
    rightsReceiptRevision: 'rights-1', rightsReceiptSha256: hex('c'),
    stableFeatures: [{ featureId: 'base', featureSha256: hex('d') }],
    exactExecution: 'NOT_RUN' as const, release: 'HOLD' as const,
    manufacturingReleaseReady: false as const,
  };
  return { ...material, bindingSha256: sha256(material) };
}

const precisionRequest = () => createAiDesignPrecisionVerificationRequest({
  requestId: 'precision-request-1', projectId: 'project-1', sessionId: 'session-1',
  runtimeRevision: 4, complexRevision: 5, productStructureDigest: hex('e'),
  crossDomainContentHash: null, scopes: [{ kind: 'structure_node', id: 'part-1' }],
  requestedAt: '2026-08-24T12:00:00.000Z', expiresAt: '2026-08-24T13:00:00.000Z',
});

function job(queuedAt = '2026-08-24T12:00:00.000Z'): AiPrecisionBridgeJobV1 {
  const request = precisionRequest();
  return createAiPrecisionBridgeJob({
    ownerKeySha256: hex('1'), projectId: 'project-1', sessionId: 'session-1',
    candidateId: 'candidate-1', handoffRequestId: 'handoff-1', handoffSha256: hex('2'),
    binding: binding(), precisionRequestId: request.requestId,
    precisionRequestSha256: request.requestDigest, runtimeRevision: 4,
    complexRevision: 5, queuedAt,
  });
}

function passManifest() {
  const value = job();
  const source = {
    projectId: value.binding.projectId, documentId: value.binding.documentId,
    revision: value.binding.revision, partId: value.binding.partId,
    featureTreeSha256: value.binding.featureTreeSha256,
    rightsReceiptRevision: value.binding.rightsReceiptRevision,
    rightsReceiptSha256: value.binding.rightsReceiptSha256,
  };
  const roles = ['step', 'drawing', 'dimensions', 'bom', 'verification'] as const;
  const material = {
    schema: 'nexyfab.ai-precision-exact-artifact-manifest.v1',
    jobId: value.jobId, jobSha256: value.jobSha256,
    precisionRequestId: value.precisionRequestId,
    precisionRequestSha256: value.precisionRequestSha256,
    bindingSha256: value.binding.bindingSha256,
    bundleArtifactManifestSha256: hex('8'), source,
    objects: roles.map((role, index) => {
      const contentSha256 = String(index + 1).repeat(64);
      return {
        role,
        objectKey: `private/ai-precision-exact/v1/${value.jobSha256.slice(0, 2)}/${value.jobSha256}/${role}-${contentSha256}.${role === 'step' ? 'step' : 'json'}`,
        contentType: role === 'step' ? 'application/step' : 'application/json',
        contentSha256, byteLength: index + 1,
      };
    }),
    verification: { kernel: 'OCCT_NODE', valid: true },
    exactExecution: 'PASS', release: 'HOLD', manufacturingReleaseReady: false,
  };
  const manifestSha256 = sha256(material);
  return {
    ...material,
    manifestObjectKey: `private/ai-precision-exact/v1/${value.jobSha256.slice(0, 2)}/${value.jobSha256}/manifest-${manifestSha256}.json`,
    manifestSha256,
  };
}

class BridgeDb implements DbAdapter {
  readonly backend = 'postgres' as const;
  migrationChecksum = migrationChecksum;
  readonly outbox = new Map<string, Row>();
  readonly receipts = new Map<string, Row>();
  readonly aiArtifacts = new Map<string, Row>();
  complexAggregate: Row | null = null;

  async queryOne<T>(sql: string, ...params: unknown[]): Promise<T | undefined> {
    if (sql.includes('nf_schema_migrations')) {
      return { version: 2026082403, checksum: this.migrationChecksum } as T;
    }
    if (sql.includes('LIMIT 1') && !sql.includes('WHERE status') && !sql.includes('WHERE job_id')) return undefined;
    if (sql.includes('FROM nf_ai_precision_bridge_receipts')) {
      const row = [...this.receipts.values()].find(item => item.job_id === params[0]);
      return (row ? structuredClone(row) : undefined) as T | undefined;
    }
    if (sql.includes('FROM nf_ai_design_artifacts')) {
      const row = this.aiArtifacts.get(String(params[0]));
      return (row ? structuredClone(row) : undefined) as T | undefined;
    }
    if (sql.includes('FROM nf_ai_design_complex_workspaces')) {
      return (this.complexAggregate ? structuredClone(this.complexAggregate) : undefined) as T | undefined;
    }
    if (sql.includes('WHERE job_id = ? OR')) {
      const direct = this.outbox.get(String(params[0]));
      const scoped = [...this.outbox.values()].find(row => row.owner_key_sha256 === params[1]
        && row.project_id === params[2] && row.session_id === params[3]
        && row.handoff_request_id === params[4]);
      const row = direct ?? scoped;
      return (row ? structuredClone(row) : undefined) as T | undefined;
    }
    if (sql.includes('WHERE status = ?') && sql.includes('FOR UPDATE SKIP LOCKED')) {
      const row = [...this.outbox.values()]
        .filter(row => row.status === params[0] && Number(row.available_at) <= Number(params[1]))
        .sort((left, right) => Number(left.available_at) - Number(right.available_at))[0];
      return (row ? structuredClone(row) : undefined) as T | undefined;
    }
    if (sql.includes('WHERE status = ?') && sql.includes('ORDER BY updated_at')) {
      const row = [...this.outbox.values()]
        .filter(row => row.status === params[0])
        .sort((left, right) => Number(left.updated_at) - Number(right.updated_at))[0];
      return (row ? structuredClone(row) : undefined) as T | undefined;
    }
    if (sql.includes('FROM nf_ai_precision_bridge_outbox') && sql.includes('WHERE job_id = ?')) {
      const row = this.outbox.get(String(params[0]));
      return (row ? structuredClone(row) : undefined) as T | undefined;
    }
    return undefined;
  }

  async queryAll<T>(): Promise<T[]> { return []; }

  async execute(sql: string, ...params: unknown[]): Promise<{ changes: number }> {
    if (sql.includes('INSERT INTO nf_ai_precision_bridge_outbox')) {
      const id = String(params[0]);
      if (this.outbox.has(id)) throw new Error('unique');
      this.outbox.set(id, {
        job_id: params[0], owner_key_sha256: params[1], project_id: params[2], session_id: params[3],
        candidate_id: params[4], handoff_request_id: params[5], handoff_sha256: params[6],
        binding_sha256: params[7], binding_json: params[8], precision_request_id: params[9],
        precision_request_sha256: params[10], runtime_revision: params[11], complex_revision: params[12],
        job_sha256: params[13], job_json: params[14], status: params[15], attempt: params[16],
        lease_generation: params[17], lease_owner: null, lease_capability_sha256: null,
        lease_expires_at: null, available_at: params[18], last_error: null,
        created_at: params[19], updated_at: params[20],
      });
      return { changes: 1 };
    }
    if (sql.includes('attempt = attempt + 1')) {
      const row = this.outbox.get(String(params[5]));
      if (!row || row.status !== params[6] || Number(row.available_at) > Number(params[7])) return { changes: 0 };
      Object.assign(row, {
        status: params[0], attempt: Number(row.attempt) + 1,
        lease_generation: Number(row.lease_generation) + 1, lease_owner: params[1],
        lease_capability_sha256: params[2], lease_expires_at: params[3], updated_at: params[4],
      });
      return { changes: 1 };
    }
    if (sql.includes('SET status = ?, updated_at = ?') && sql.includes("lease_expires_at > ?")) {
      const row = this.outbox.get(String(params[2]));
      if (!row || row.status !== params[3] || row.lease_owner !== params[4]
        || row.lease_capability_sha256 !== params[5] || Number(row.lease_expires_at) <= Number(params[6])) return { changes: 0 };
      Object.assign(row, { status: params[0], updated_at: params[1] });
      return { changes: 1 };
    }
    if (sql.includes('INSERT INTO nf_ai_precision_bridge_receipts')) {
      if ([...this.receipts.values()].some(row => row.job_id === params[1])) return { changes: 0 };
      this.receipts.set(String(params[0]), {
        receipt_id: params[0], job_id: params[1], project_id: params[2], session_id: params[3],
        precision_request_id: params[4], precision_request_sha256: params[5],
        exact_artifact_sha256: params[6], receipt_sha256: params[7], receipt_json: params[8],
        artifact_manifest_json: params[9], accepted_at: params[10],
      });
      return { changes: 1 };
    }
    if (sql.includes("WHERE job_id = ? AND status IN (?, ?)") && sql.includes("lease_capability_sha256 = ?")) {
      const row = this.outbox.get(String(params[2]));
      if (!row || ![params[3], params[4]].includes(row.status) || row.lease_owner !== params[5]
        || row.lease_capability_sha256 !== params[6] || Number(row.lease_expires_at) <= Number(params[7])) return { changes: 0 };
      Object.assign(row, {
        status: params[0], lease_owner: null, lease_capability_sha256: null,
        lease_expires_at: null, updated_at: params[1],
      });
      return { changes: 1 };
    }
    if (sql.includes("WHERE job_id = ? AND status = ?") && sql.includes('last_error = NULL')) {
      const row = this.outbox.get(String(params[2]));
      if (!row || row.status !== params[3]) return { changes: 0 };
      Object.assign(row, { status: params[0], last_error: null, updated_at: params[1] });
      return { changes: 1 };
    }
    if (sql.includes("WHERE status IN (?, ?) AND lease_expires_at <= ?")) {
      let changes = 0;
      for (const row of this.outbox.values()) if ([params[3], params[4]].includes(row.status)
        && Number(row.lease_expires_at) <= Number(params[5])) {
        Object.assign(row, {
          status: params[0], last_error: params[1], lease_owner: null,
          lease_capability_sha256: null, lease_expires_at: null, updated_at: params[2],
        });
        changes += 1;
      }
      return { changes };
    }
    if (sql.includes("WHERE job_id = ? AND status NOT IN (?, ?)")) {
      const row = this.outbox.get(String(params[3]));
      if (!row || [params[4], params[5]].includes(row.status)) return { changes: 0 };
      Object.assign(row, {
        status: params[0], last_error: params[1], lease_owner: null,
        lease_capability_sha256: null, lease_expires_at: null, updated_at: params[2],
      });
      return { changes: 1 };
    }
    return { changes: 0 };
  }

  async executeRaw(): Promise<void> {}
  async transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> { return fn(this); }
  async close(): Promise<void> {}
}

beforeEach(() => {
  vi.stubEnv('POSTGRES_MIGRATION_CHECKSUM_2026082403', migrationChecksum);
});

afterEach(() => { vi.unstubAllEnvs(); });

describe('AI-to-Precision durable bridge outbox', () => {
  it('requires the immutable 2403 migration checksum', async () => {
    const db = new BridgeDb();
    db.migrationChecksum = hex('f');
    await expect(new PostgresAiPrecisionBridgeJobStore(db).enqueue(job(), 1))
      .rejects.toThrow('AI_PRECISION_BRIDGE_MIGRATION_REQUIRED');
  });

  it('enqueues idempotently and rejects changed payload under one handoff identity', async () => {
    const store = new PostgresAiPrecisionBridgeJobStore(new BridgeDb());
    const first = job();
    await expect(store.enqueue(first, 1)).resolves.toMatchObject({ ok: true, record: { status: 'PENDING' } });
    await expect(store.enqueue(first, 2)).resolves.toMatchObject({ ok: true, replayed: true });
    await expect(store.enqueue(job('2026-08-24T12:00:01.000Z'), 3))
      .resolves.toEqual({ ok: false, code: 'CONFLICT' });
  });

  it('leases with a capability and quarantines expired unknown execution', async () => {
    const store = new PostgresAiPrecisionBridgeJobStore(new BridgeDb());
    await store.enqueue(job(), 1_000);
    const claimed = await store.claimNext({ owner: 'worker-1', capability, leaseMs: 2_000, now: 1_000 });
    expect(claimed).toMatchObject({ ok: true, record: { status: 'CLAIMED', attempt: 1, leaseGeneration: 1 } });
    await expect(store.markSent(job().jobId, 'worker-1', 'wrong-capability', 1_500))
      .resolves.toEqual({ ok: false, code: 'CAPABILITY_INVALID' });
    await expect(store.markSent(job().jobId, 'worker-1', capability, 1_500))
      .resolves.toMatchObject({ ok: true, record: { status: 'SENT' } });
    await expect(store.recoverExpiredClaims(3_001)).resolves.toBe(1);
    await expect(store.read(job().jobId)).resolves.toMatchObject({ status: 'VERIFIED_UNKNOWN' });
    await expect(store.claimNext({ owner: 'worker-2', capability, leaseMs: 2_000, now: 4_000 }))
      .resolves.toEqual({ ok: false, code: 'NOT_FOUND' });
  });

  it('accepts only a current signed request-bound receipt and replays it immutably', async () => {
    const db = new BridgeDb();
    const store = new PostgresAiPrecisionBridgeJobStore(db);
    const request = precisionRequest();
    const artifactManifest = passManifest();
    const exactArtifactSha256 = artifactManifest.manifestSha256;
    const receipt = issueAiDesignPrecisionVerificationReceipt({
      receiptId: 'precision-receipt-1', request, status: 'PASS', keyId: 'precision-key-1',
      issuedAt: '2026-08-24T12:01:00.000Z', expiresAt: '2026-08-24T12:30:00.000Z',
      scopeResults: [{ ...request.scopes[0]!, status: 'PASS', exactArtifactDigest: exactArtifactSha256, codes: [] }],
    }, signingSecret);
    await store.enqueue(job(), Date.parse('2026-08-24T12:00:00.000Z'));
    await store.claimNext({
      owner: 'worker-1', capability, leaseMs: 15 * 60_000,
      now: Date.parse('2026-08-24T12:00:00.000Z'),
    });
    await expect(store.acceptReceipt({
      jobId: job().jobId, owner: 'worker-1', capability, request, receipt,
      signingSecret, exactArtifactSha256,
      artifactManifest: { ...artifactManifest, bundleArtifactManifestSha256: hex('f') },
      now: Date.parse('2026-08-24T12:01:30.000Z'),
    })).resolves.toEqual({ ok: false, code: 'RECEIPT_CONFLICT' });
    const accepted = await store.acceptReceipt({
      jobId: job().jobId, owner: 'worker-1', capability, request, receipt,
      signingSecret, exactArtifactSha256, artifactManifest,
      now: Date.parse('2026-08-24T12:02:00.000Z'),
    });
    expect(accepted).toMatchObject({ ok: true, record: { status: 'COMPLETED' } });
    await expect(store.acceptReceipt({
      jobId: job().jobId, owner: 'worker-1', capability, request, receipt,
      signingSecret, exactArtifactSha256, artifactManifest,
      now: Date.parse('2026-08-24T12:03:00.000Z'),
    })).resolves.toMatchObject({ ok: true, replayed: true });
    await expect(store.acceptReceipt({
      jobId: job().jobId, owner: 'worker-1', capability, request,
      receipt: { ...receipt, signature: hex('f') }, signingSecret,
      exactArtifactSha256, artifactManifest,
      now: Date.parse('2026-08-24T12:04:00.000Z'),
    })).resolves.toEqual({ ok: false, code: 'RECEIPT_CONFLICT' });
    expect(db.receipts.size).toBe(1);
  });

  it('reconciles VERIFIED_UNKNOWN only from an already persisted immutable AI receipt', async () => {
    const db = new BridgeDb();
    const store = new PostgresAiPrecisionBridgeJobStore(db);
    const request = precisionRequest();
    const artifactManifest = passManifest();
    const exactArtifactSha256 = artifactManifest.manifestSha256;
    const receipt = issueAiDesignPrecisionVerificationReceipt({
      receiptId: 'precision-receipt-reconcile-1', request, status: 'PASS', keyId: 'precision-key-1',
      issuedAt: '2026-08-24T12:01:00.000Z', expiresAt: '2026-08-24T12:30:00.000Z',
      scopeResults: [{ ...request.scopes[0]!, status: 'PASS', exactArtifactDigest: exactArtifactSha256, codes: ['EXACT_BUNDLE_PASS'] }],
    }, signingSecret);
    await store.enqueue(job(), Date.parse('2026-08-24T12:00:00.000Z'));
    await store.claimNext({
      owner: 'worker-1', capability, leaseMs: 2_000,
      now: Date.parse('2026-08-24T12:00:00.000Z'),
    });
    await store.markSent(
      job().jobId, 'worker-1', capability, Date.parse('2026-08-24T12:00:01.000Z'),
    );
    await store.recoverExpiredClaims(Date.parse('2026-08-24T12:00:03.000Z'));
    await expect(store.readNextVerifiedUnknown()).resolves.toMatchObject({ job: { jobId: job().jobId } });
    await expect(store.reconcileVerifiedUnknownReceipt({
      jobId: job().jobId, request, receipt, signingSecret,
      exactArtifactSha256, artifactManifest,
      now: Date.parse('2026-08-24T12:03:00.000Z'),
    })).resolves.toEqual({ ok: false, code: 'RECEIPT_CONFLICT' });

    const valueJson = JSON.stringify(receipt);
    db.aiArtifacts.set(receipt.receiptId, {
      content_sha256: serverEvidenceSha256(receipt), value_json: valueJson,
      byte_length: Buffer.byteLength(valueJson, 'utf8'),
    });
    const aggregate = createAiDesignComplexWorkspaceAggregate({
      projectId: 'project-1', sessionId: 'session-1', runtimeRevision: 4,
      now: '2026-08-24T12:00:00.000Z',
    });
    const recordedAggregate = advanceAiDesignComplexWorkspaceAggregate(aggregate, {
      commandId: 'record-reconcile-1', commandDigest: hex('7'), expectedComplexRevision: 0,
      runtimeRevision: 4, now: '2026-08-24T12:02:00.000Z',
      patch: {
        precisionReceipts: [{ artifactId: receipt.receiptId, artifactDigest: receipt.receiptDigest, contentDigest: receipt.requestDigest }],
        exactCadStatus: 'PASS',
      },
    });
    db.complexAggregate = { aggregate_json: JSON.stringify(recordedAggregate) };
    await expect(store.reconcileVerifiedUnknownReceipt({
      jobId: job().jobId, request, receipt, signingSecret,
      exactArtifactSha256, artifactManifest,
      now: Date.parse('2026-08-24T12:03:01.000Z'),
    })).resolves.toMatchObject({ ok: true, record: { status: 'COMPLETED' } });
    expect(db.receipts.size).toBe(1);
  });
});
