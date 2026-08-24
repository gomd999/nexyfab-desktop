import 'server-only';

import { createHash } from 'node:crypto';
import type { DbAdapter } from '@/lib/db-adapter';
import { getStorage } from '@/lib/storage';
import {
  buildCurrentCanonicalMechanicalArtifactBundle,
  type CurrentCanonicalMechanicalArtifactBundle,
} from '@/app/[lang]/shape-generator/drawing/currentCanonicalMechanicalBundle';
import { canonicalCadConsumerDraftJson } from '@/lib/cad/canonicalCadV2ConsumerDraft';
import { resolveMechanicalStableReferences } from '@/lib/cad/mechanicalStableReferenceBinding';
import { PostgresAiDesignComplexWorkspaceStore } from './aiDesignComplexWorkspaceStore';
import {
  recordAiDesignPrecisionReceiptByOwnerHash,
  type AiDesignComplexWorkspaceServiceResult,
} from './aiDesignComplexWorkspaceService';
import {
  PostgresAiPrecisionBridgeJobStore,
  type AiPrecisionBridgeOutboxRecord,
  type AiPrecisionBridgeStoreResult,
} from './aiDesignPrecisionBridgeJobStore';
import {
  issueAiDesignPrecisionVerificationReceipt,
  validateAiDesignPrecisionVerificationRequest,
  type AiDesignPrecisionVerificationReceiptV1,
  type AiDesignPrecisionVerificationRequestV1,
} from './aiDesignPrecisionVerification';
import {
  aiDesignServerRuntimeArtifacts,
  type AiDesignComplexArtifactRepository,
} from './aiDesignServerRuntimeArtifacts';
import { loadServerAiDesignWorkspaceRuntimeByOwnerHash } from './aiDesignWorkspaceRuntimeStore';
import type { AiDesignWorkspaceServerCommandV3 } from './aiDesignWorkspaceCommandV3';
import { serverEvidenceSha256 } from './serverEvidence';

export const AI_PRECISION_EXACT_ARTIFACT_MANIFEST_SCHEMA =
  'nexyfab.ai-precision-exact-artifact-manifest.v1' as const;

const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const SHA256 = /^[a-f0-9]{64}$/;

export interface AiPrecisionExactObjectRecord {
  role: 'step' | 'drawing' | 'dimensions' | 'bom' | 'verification';
  objectKey: string;
  contentType: string;
  contentSha256: string;
  byteLength: number;
}

export interface AiPrecisionExactArtifactManifest {
  schema: typeof AI_PRECISION_EXACT_ARTIFACT_MANIFEST_SCHEMA;
  jobId: string;
  jobSha256: string;
  precisionRequestId: string;
  precisionRequestSha256: string;
  bindingSha256: string;
  bundleArtifactManifestSha256: string;
  source: CurrentCanonicalMechanicalArtifactBundle['source'];
  objects: readonly AiPrecisionExactObjectRecord[];
  verification: CurrentCanonicalMechanicalArtifactBundle['handoff']['exactSinglePart'] extends infer T
    ? T extends { verification: infer V } ? V : never
    : never;
  exactExecution: 'PASS';
  release: 'HOLD';
  manufacturingReleaseReady: false;
  manifestObjectKey: string;
  manifestSha256: string;
}

interface BridgeJobs {
  recoverExpiredClaims(now?: number): Promise<number>;
  claimNext(input: { owner: string; capability: string; leaseMs: number; now?: number }): Promise<AiPrecisionBridgeStoreResult>;
  markSent(jobId: string, owner: string, capability: string, now?: number): Promise<AiPrecisionBridgeStoreResult>;
  hold(jobId: string, errorCode: string, now?: number): Promise<AiPrecisionBridgeStoreResult>;
  acceptReceipt(input: {
    jobId: string; owner: string; capability: string;
    request: AiDesignPrecisionVerificationRequestV1;
    receipt: AiDesignPrecisionVerificationReceiptV1;
    signingSecret: string;
    exactArtifactSha256: string | null;
    artifactManifest: unknown;
    now?: number;
  }): Promise<AiPrecisionBridgeStoreResult>;
  readNextVerifiedUnknown?(): Promise<AiPrecisionBridgeOutboxRecord | null>;
  reconcileVerifiedUnknownReceipt?(input: {
    jobId: string;
    request: AiDesignPrecisionVerificationRequestV1;
    receipt: AiDesignPrecisionVerificationReceiptV1;
    signingSecret: string;
    exactArtifactSha256: string | null;
    artifactManifest: unknown;
    now?: number;
  }): Promise<AiPrecisionBridgeStoreResult>;
}

interface ImmutableObjectSink {
  put(key: string, bytes: Buffer, contentType: string, expectedSha256: string): Promise<void>;
  read?(key: string, expectedSha256: string): Promise<Buffer | null>;
}

export interface AiDesignPrecisionExactWorkerDependencies {
  db: DbAdapter;
  jobs?: BridgeJobs;
  artifacts?: AiDesignComplexArtifactRepository;
  objectSink?: ImmutableObjectSink;
  buildBundle?: typeof buildCurrentCanonicalMechanicalArtifactBundle;
  resolveStable?: typeof resolveMechanicalStableReferences;
  loadAuthority?: (input: {
    ownerKeySha256: string; projectId: string; sessionId: string;
  }) => Promise<{ runtimeRevision: number; complexRevision: number; precisionRequestBound: boolean }>;
  recordReceipt?: (
    ownerKeySha256: string,
    command: AiDesignWorkspaceServerCommandV3,
    receipt: AiDesignPrecisionVerificationReceiptV1,
  ) => Promise<AiDesignComplexWorkspaceServiceResult>;
  now?: () => Date;
}

export type AiDesignPrecisionExactWorkerResult =
  | { ok: true; status: 'IDLE'; recoveredUnknown: number }
  | { ok: true; status: 'COMPLETED'; recoveredUnknown: number; jobId: string; receiptId: string; exactArtifactSha256: string | null; verification: 'PASS' | 'FAIL' }
  | { ok: true; status: 'HOLD'; recoveredUnknown: number; jobId: string; code: string }
  | { ok: false; status: 'LEASE_UNCERTAIN'; recoveredUnknown: number; jobId: string; code: string };

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function sameBundleBinding(bundle: CurrentCanonicalMechanicalArtifactBundle, record: AiPrecisionBridgeOutboxRecord): boolean {
  const binding = record.job.binding;
  return bundle.source.projectId === binding.projectId
    && bundle.source.documentId === binding.documentId
    && canonicalCadConsumerDraftJson(bundle.source.revision as never)
      === canonicalCadConsumerDraftJson(binding.revision as never)
    && bundle.source.partId === binding.partId
    && bundle.source.featureTreeSha256 === binding.featureTreeSha256
    && bundle.source.rightsReceiptRevision === binding.rightsReceiptRevision
    && bundle.source.rightsReceiptSha256 === binding.rightsReceiptSha256;
}

function safeReceiptCodes(values: readonly string[]): string[] {
  const codes = values.map(value => value.replace(/[^A-Za-z0-9._:/-]/g, '_').slice(0, 199))
    .filter(value => ID.test(value));
  return [...new Set(codes.length ? codes : ['PRECISION_EXACT_EXECUTION_FAILED'])].slice(0, 64);
}

function objectRecord(
  record: AiPrecisionBridgeOutboxRecord,
  role: AiPrecisionExactObjectRecord['role'],
  extension: string,
  contentType: string,
  bytes: Buffer,
): AiPrecisionExactObjectRecord {
  const contentSha256 = sha256(bytes);
  return {
    role,
    objectKey: `private/ai-precision-exact/v1/${record.job.jobSha256.slice(0, 2)}/${record.job.jobSha256}/${role}-${contentSha256}.${extension}`,
    contentType,
    contentSha256,
    byteLength: bytes.byteLength,
  };
}

function productionObjectSink(): ImmutableObjectSink {
  const storage = getStorage();
  if (!storage.uploadRawImmutable || !storage.sha256 || !storage.download) throw new Error('AI_PRECISION_IMMUTABLE_OBJECT_STORAGE_REQUIRED');
  return {
    async put(key, bytes, contentType, expectedSha256) {
      if (!key.startsWith('private/ai-precision-exact/') || !SHA256.test(expectedSha256)
        || sha256(bytes) !== expectedSha256) throw new Error('AI_PRECISION_OBJECT_INPUT_INVALID');
      await storage.uploadRawImmutable!(bytes, key, contentType);
      const stored = await storage.sha256!(key);
      if (stored.size !== bytes.byteLength || stored.contentSha256 !== expectedSha256) {
        throw new Error('AI_PRECISION_IMMUTABLE_OBJECT_VERIFY_FAILED');
      }
    },
    async read(key, expectedSha256) {
      if (!key.startsWith('private/ai-precision-exact/') || !SHA256.test(expectedSha256)) {
        throw new Error('AI_PRECISION_OBJECT_INPUT_INVALID');
      }
      try {
        const authoritative = await storage.sha256!(key);
        if (authoritative.contentSha256 !== expectedSha256) throw new Error('AI_PRECISION_IMMUTABLE_OBJECT_VERIFY_FAILED');
        const bytes = await storage.download!(key);
        if (bytes.byteLength !== authoritative.size || sha256(bytes) !== expectedSha256) {
          throw new Error('AI_PRECISION_IMMUTABLE_OBJECT_VERIFY_FAILED');
        }
        return bytes;
      } catch (error) {
        if (error instanceof Error && error.message === 'AI_PRECISION_IMMUTABLE_OBJECT_VERIFY_FAILED') throw error;
        return null;
      }
    },
  };
}

async function loadPersistedReceiptForUnknown(
  db: DbAdapter,
  record: AiPrecisionBridgeOutboxRecord,
): Promise<AiDesignPrecisionVerificationReceiptV1 | null> {
  const rows = await db.queryAll<{ value_json: string; content_sha256: string; byte_length: number }>(
    `SELECT value_json, content_sha256, byte_length FROM nf_ai_design_artifacts
     WHERE project_id = ? AND session_id = ? AND artifact_kind = ?
       AND value_json::jsonb ->> 'requestId' = ?
     ORDER BY created_at, artifact_id LIMIT 2`,
    record.job.projectId, record.job.sessionId, 'precision_receipt', record.job.precisionRequestId,
  );
  if (rows.length === 0) return null;
  if (rows.length !== 1) throw new Error('AI_PRECISION_RECONCILE_RECEIPT_AMBIGUOUS');
  const row = rows[0]!;
  if (Buffer.byteLength(row.value_json, 'utf8') !== Number(row.byte_length)) {
    throw new Error('AI_PRECISION_RECONCILE_RECEIPT_INTEGRITY_FAILED');
  }
  let receipt: AiDesignPrecisionVerificationReceiptV1;
  try { receipt = JSON.parse(row.value_json) as AiDesignPrecisionVerificationReceiptV1; }
  catch { throw new Error('AI_PRECISION_RECONCILE_RECEIPT_INTEGRITY_FAILED'); }
  if (serverEvidenceSha256(receipt) !== row.content_sha256) {
    throw new Error('AI_PRECISION_RECONCILE_RECEIPT_INTEGRITY_FAILED');
  }
  return receipt;
}

async function reconcileUnknown(
  jobs: BridgeJobs,
  artifacts: AiDesignComplexArtifactRepository,
  objectSink: ImmutableObjectSink,
  db: DbAdapter,
  signingSecret: string,
  now: Date,
): Promise<AiDesignPrecisionExactWorkerResult | null> {
  if (!jobs.readNextVerifiedUnknown || !jobs.reconcileVerifiedUnknownReceipt) return null;
  const record = await jobs.readNextVerifiedUnknown();
  if (!record) return null;
  const request = await artifacts.getPrecisionRequest(record.job.precisionRequestId);
  if (!request || request.requestDigest !== record.job.precisionRequestSha256) {
    throw new Error('AI_PRECISION_RECONCILE_REQUEST_INVALID');
  }
  const receipt = await loadPersistedReceiptForUnknown(db, record);
  if (!receipt) return null;
  let exactArtifactSha256: string | null = null;
  let artifactManifest: unknown;
  if (receipt.status === 'PASS') {
    const digests = [...new Set(receipt.scopeResults.map(item => item.exactArtifactDigest))];
    if (digests.length !== 1 || !digests[0] || !SHA256.test(digests[0])) {
      throw new Error('AI_PRECISION_RECONCILE_EXACT_DIGEST_INVALID');
    }
    exactArtifactSha256 = digests[0];
    const manifestObjectKey = `private/ai-precision-exact/v1/${record.job.jobSha256.slice(0, 2)}/${record.job.jobSha256}/manifest-${exactArtifactSha256}.json`;
    if (!objectSink.read) throw new Error('AI_PRECISION_RECONCILE_OBJECT_READ_REQUIRED');
    const bytes = await objectSink.read(manifestObjectKey, exactArtifactSha256);
    if (!bytes) throw new Error('AI_PRECISION_RECONCILE_MANIFEST_NOT_FOUND');
    let material: Record<string, unknown>;
    try { material = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>; }
    catch { throw new Error('AI_PRECISION_RECONCILE_MANIFEST_INVALID'); }
    artifactManifest = { ...material, manifestObjectKey, manifestSha256: exactArtifactSha256 };
  } else {
    const blockers = safeReceiptCodes(receipt.scopeResults.flatMap(item => item.codes));
    artifactManifest = {
      schema: 'nexyfab.ai-precision-exact-failure-manifest.v1',
      jobId: record.job.jobId, jobSha256: record.job.jobSha256,
      precisionRequestId: request.requestId, precisionRequestSha256: request.requestDigest,
      bindingSha256: record.job.binding.bindingSha256,
      receiptSha256: receipt.receiptDigest, blockers,
      exactExecution: 'FAIL', release: 'HOLD', manufacturingReleaseReady: false,
    };
  }
  const reconciled = await jobs.reconcileVerifiedUnknownReceipt({
    jobId: record.job.jobId, request, receipt, signingSecret,
    exactArtifactSha256, artifactManifest, now: now.getTime(),
  });
  if (!reconciled.ok) throw new Error(`AI_PRECISION_RECONCILE_${reconciled.code}`);
  return {
    ok: true, status: 'COMPLETED', recoveredUnknown: 0,
    jobId: record.job.jobId, receiptId: receipt.receiptId,
    exactArtifactSha256, verification: receipt.status,
  };
}

async function putExactArtifacts(
  sink: ImmutableObjectSink,
  record: AiPrecisionBridgeOutboxRecord,
  request: AiDesignPrecisionVerificationRequestV1,
  bundle: CurrentCanonicalMechanicalArtifactBundle,
): Promise<AiPrecisionExactArtifactManifest> {
  const exact = bundle.handoff.exactSinglePart;
  if (!exact) throw new Error('AI_PRECISION_EXACT_HANDOFF_MISSING');
  const payloads = [
    { role: 'step' as const, extension: 'step', contentType: 'application/step', bytes: Buffer.from(exact.step.text, 'utf8'), expected: bundle.artifacts.stepSha256 },
    { role: 'drawing' as const, extension: 'svg', contentType: 'image/svg+xml', bytes: Buffer.from(exact.drawing.svg, 'utf8'), expected: bundle.artifacts.drawingSha256 },
    { role: 'dimensions' as const, extension: 'json', contentType: 'application/json', bytes: Buffer.from(exact.dimensions.receiptJson, 'utf8'), expected: bundle.artifacts.dimensionsSha256 },
    { role: 'bom' as const, extension: 'json', contentType: 'application/json', bytes: Buffer.from(exact.bom.receiptJson, 'utf8'), expected: bundle.artifacts.bomSha256 },
    {
      role: 'verification' as const, extension: 'json', contentType: 'application/json',
      bytes: Buffer.from(canonicalCadConsumerDraftJson(exact.verification as never), 'utf8'),
      expected: null,
    },
  ];
  if (payloads.some(payload => payload.expected !== null && sha256(payload.bytes) !== payload.expected)) {
    throw new Error('AI_PRECISION_BUNDLE_OBJECT_DIGEST_MISMATCH');
  }
  const objects = payloads.map(payload => ({ payload, record: objectRecord(
    record, payload.role, payload.extension, payload.contentType, payload.bytes,
  ) }));
  await Promise.all(objects.map(({ payload, record: object }) => sink.put(
    object.objectKey, payload.bytes, object.contentType, object.contentSha256,
  )));
  const material = {
    schema: AI_PRECISION_EXACT_ARTIFACT_MANIFEST_SCHEMA,
    jobId: record.job.jobId,
    jobSha256: record.job.jobSha256,
    precisionRequestId: request.requestId,
    precisionRequestSha256: request.requestDigest,
    bindingSha256: record.job.binding.bindingSha256,
    bundleArtifactManifestSha256: bundle.artifactManifestSha256,
    source: structuredClone(bundle.source),
    objects: objects.map(item => item.record).sort((left, right) => left.role.localeCompare(right.role)),
    verification: structuredClone(exact.verification),
    exactExecution: 'PASS' as const,
    release: 'HOLD' as const,
    manufacturingReleaseReady: false as const,
  };
  const manifestBytes = Buffer.from(canonicalCadConsumerDraftJson(material as never), 'utf8');
  const manifestSha256 = sha256(manifestBytes);
  const manifestObjectKey = `private/ai-precision-exact/v1/${record.job.jobSha256.slice(0, 2)}/${record.job.jobSha256}/manifest-${manifestSha256}.json`;
  await sink.put(manifestObjectKey, manifestBytes, 'application/json', manifestSha256);
  return { ...material, manifestObjectKey, manifestSha256 };
}

async function hold(
  jobs: BridgeJobs,
  record: AiPrecisionBridgeOutboxRecord,
  code: string,
  recoveredUnknown: number,
  now: number,
): Promise<AiDesignPrecisionExactWorkerResult> {
  const result = await jobs.hold(record.job.jobId, code, now);
  return result.ok
    ? { ok: true, status: 'HOLD', recoveredUnknown, jobId: record.job.jobId, code }
    : { ok: false, status: 'LEASE_UNCERTAIN', recoveredUnknown, jobId: record.job.jobId, code: `AI_PRECISION_HOLD_${result.code}` };
}

/** Claims and completes at most one durable AI→Precision exact execution. */
export async function runNextAiDesignPrecisionExactJob(input: {
  workerId: string;
  leaseCapability: string;
  leaseMs: number;
  signingSecret: string;
  signingKeyId: string;
}, dependencies: AiDesignPrecisionExactWorkerDependencies): Promise<AiDesignPrecisionExactWorkerResult> {
  if (!ID.test(input.workerId) || !ID.test(input.signingKeyId)
    || Buffer.byteLength(input.leaseCapability, 'utf8') < 32
    || Buffer.byteLength(input.signingSecret, 'utf8') < 32
    || !Number.isSafeInteger(input.leaseMs) || input.leaseMs < 1_000 || input.leaseMs > 15 * 60_000) {
    throw new Error('AI_PRECISION_WORKER_CONFIGURATION_INVALID');
  }
  const clock = dependencies.now ?? (() => new Date());
  const jobs = dependencies.jobs ?? new PostgresAiPrecisionBridgeJobStore(dependencies.db);
  const artifacts = dependencies.artifacts ?? aiDesignServerRuntimeArtifacts;
  const recoveredUnknown = await jobs.recoverExpiredClaims(clock().getTime());
  const objectSink = dependencies.objectSink ?? productionObjectSink();
  const reconciled = await reconcileUnknown(
    jobs, artifacts, objectSink, dependencies.db, input.signingSecret, clock(),
  );
  if (reconciled) return { ...reconciled, recoveredUnknown };
  const claimed = await jobs.claimNext({
    owner: input.workerId, capability: input.leaseCapability,
    leaseMs: input.leaseMs, now: clock().getTime(),
  });
  if (!claimed.ok) {
    if (claimed.code === 'NOT_FOUND') return { ok: true, status: 'IDLE', recoveredUnknown };
    throw new Error(`AI_PRECISION_BRIDGE_CLAIM_${claimed.code}`);
  }
  const record = claimed.record;
  const request = await artifacts.getPrecisionRequest(record.job.precisionRequestId);
  if (!request || validateAiDesignPrecisionVerificationRequest(request).length
    || request.requestDigest !== record.job.precisionRequestSha256
    || request.projectId !== record.job.projectId || request.sessionId !== record.job.sessionId
    || request.runtimeRevision !== record.job.runtimeRevision || request.complexRevision !== record.job.complexRevision) {
    return hold(jobs, record, 'AI_PRECISION_REQUEST_AUTHORITY_INVALID', recoveredUnknown, clock().getTime());
  }
  if (clock().getTime() >= Date.parse(request.expiresAt)) {
    return hold(jobs, record, 'AI_PRECISION_REQUEST_EXPIRED', recoveredUnknown, clock().getTime());
  }

  const complexStore = new PostgresAiDesignComplexWorkspaceStore(dependencies.db);
  const authority = dependencies.loadAuthority
    ? await dependencies.loadAuthority({
        ownerKeySha256: record.job.ownerKeySha256,
        projectId: record.job.projectId,
        sessionId: record.job.sessionId,
      })
    : await (async () => {
        const runtime = await loadServerAiDesignWorkspaceRuntimeByOwnerHash(
          dependencies.db, record.job.ownerKeySha256, record.job.projectId, record.job.sessionId,
        );
        const aggregate = await complexStore.loadByOwnerHash({
          ownerKeySha256: record.job.ownerKeySha256,
          projectId: record.job.projectId,
          sessionId: record.job.sessionId,
        });
        return {
          runtimeRevision: runtime.runtimeRevision,
          complexRevision: aggregate.complexRevision,
          precisionRequestBound: aggregate.precisionRequests.some(item => item.artifactId === request.requestId
            && item.artifactDigest === request.requestDigest),
        };
      })();
  if (authority.runtimeRevision !== record.job.runtimeRevision
    || authority.complexRevision !== record.job.complexRevision || !authority.precisionRequestBound) {
    return hold(jobs, record, 'AI_PRECISION_REQUEST_STALE', recoveredUnknown, clock().getTime());
  }

  const stable = await (dependencies.resolveStable ?? resolveMechanicalStableReferences)(dependencies.db, {
    projectId: record.job.projectId,
    baseRevisionId: record.job.binding.revision.revisionId,
    baseContentSha256: record.job.binding.revision.contentSha256,
    stableFeatureIds: record.job.binding.stableFeatures.map(item => item.featureId),
  });
  if (!stable.ok || stable.binding.bindingSha256 !== record.job.binding.bindingSha256) {
    const code = stable.ok ? 'AI_PRECISION_STABLE_BINDING_CHANGED' : `AI_PRECISION_${stable.code}`;
    return hold(jobs, record, code, recoveredUnknown, clock().getTime());
  }

  const sent = await jobs.markSent(
    record.job.jobId, input.workerId, input.leaseCapability, clock().getTime(),
  );
  if (!sent.ok) return {
    ok: false, status: 'LEASE_UNCERTAIN', recoveredUnknown,
    jobId: record.job.jobId, code: `AI_PRECISION_MARK_SENT_${sent.code}`,
  };

  try {
    const bundle = await (dependencies.buildBundle ?? buildCurrentCanonicalMechanicalArtifactBundle)({
      db: dependencies.db, projectId: record.job.projectId,
      documentId: record.job.binding.documentId, now: clock(),
    });
    let receipt: AiDesignPrecisionVerificationReceiptV1;
    let artifactManifest: unknown;
    let exactArtifactSha256: string | null;
    if (bundle.status === 'HOLD') {
      const codes = safeReceiptCodes(bundle.blockers);
      receipt = issueAiDesignPrecisionVerificationReceipt({
        receiptId: `precision-receipt:${serverEvidenceSha256({ jobId: record.job.jobId, codes }).slice(0, 48)}`,
        request, status: 'FAIL',
        scopeResults: request.scopes.map(scope => ({ ...scope, status: 'FAIL', exactArtifactDigest: null, codes })),
        keyId: input.signingKeyId, issuedAt: clock().toISOString(),
      }, input.signingSecret);
      artifactManifest = {
        schema: 'nexyfab.ai-precision-exact-failure-manifest.v1',
        jobId: record.job.jobId, jobSha256: record.job.jobSha256,
        precisionRequestId: request.requestId, precisionRequestSha256: request.requestDigest,
        bindingSha256: record.job.binding.bindingSha256,
        receiptSha256: receipt.receiptDigest, blockers: codes,
        exactExecution: 'FAIL', release: 'HOLD', manufacturingReleaseReady: false,
      };
      exactArtifactSha256 = null;
    } else {
      if (!sameBundleBinding(bundle, record)) {
        return hold(jobs, record, 'AI_PRECISION_EXACT_BUNDLE_BINDING_CHANGED', recoveredUnknown, clock().getTime());
      }
      const manifest = await putExactArtifacts(
        objectSink, record, request, bundle,
      );
      exactArtifactSha256 = manifest.manifestSha256;
      artifactManifest = manifest;
      receipt = issueAiDesignPrecisionVerificationReceipt({
        receiptId: `precision-receipt:${serverEvidenceSha256({ jobId: record.job.jobId, exactArtifactSha256 }).slice(0, 48)}`,
        request, status: 'PASS',
        scopeResults: request.scopes.map(scope => ({
          ...scope, status: 'PASS', exactArtifactDigest: exactArtifactSha256, codes: ['EXACT_BUNDLE_PASS'],
        })),
        keyId: input.signingKeyId, issuedAt: clock().toISOString(),
      }, input.signingSecret);
    }

    const command: AiDesignWorkspaceServerCommandV3 = {
      schema: 'nexyfab.ai-design-workspace-server-command.v3', source: 'server',
      commandId: `record-precision:${receipt.receiptDigest.slice(0, 48)}`,
      projectId: record.job.projectId, sessionId: record.job.sessionId,
      expectedRuntimeRevision: record.job.runtimeRevision,
      expectedComplexRevision: record.job.complexRevision,
      issuedAt: clock().toISOString(), type: 'RECORD_PRECISION_RECEIPT',
      payload: { receiptId: receipt.receiptId, receiptDigest: receipt.receiptDigest },
    };
    const recorded = dependencies.recordReceipt
      ? await dependencies.recordReceipt(record.job.ownerKeySha256, command, receipt)
      : await recordAiDesignPrecisionReceiptByOwnerHash(
          record.job.ownerKeySha256, command, receipt,
          { db: dependencies.db, store: complexStore, artifacts, signingSecret: input.signingSecret, now: clock },
        );
    if (!recorded.ok) return {
      ok: false, status: 'LEASE_UNCERTAIN', recoveredUnknown,
      jobId: record.job.jobId, code: recorded.code,
    };
    const accepted = await jobs.acceptReceipt({
      jobId: record.job.jobId, owner: input.workerId, capability: input.leaseCapability,
      request, receipt, signingSecret: input.signingSecret, exactArtifactSha256,
      artifactManifest, now: clock().getTime(),
    });
    if (!accepted.ok) return {
      ok: false, status: 'LEASE_UNCERTAIN', recoveredUnknown,
      jobId: record.job.jobId, code: `AI_PRECISION_ACCEPT_RECEIPT_${accepted.code}`,
    };
    return {
      ok: true, status: 'COMPLETED', recoveredUnknown, jobId: record.job.jobId,
      receiptId: receipt.receiptId, exactArtifactSha256, verification: receipt.status,
    };
  } catch (error) {
    return {
      ok: false, status: 'LEASE_UNCERTAIN', recoveredUnknown,
      jobId: record.job.jobId,
      code: error instanceof Error ? error.message : 'AI_PRECISION_EXACT_WORKER_FAILED',
    };
  }
}
