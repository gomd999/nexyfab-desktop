import { createHash } from 'node:crypto';
import type { CommercialOutputArtifact, CommercialWorkerReceipt } from '../../../packages/job-contracts/src/commercialPrecisionExecution';
import { canonicalCommercialExecution } from '../../../packages/job-contracts/src/commercialPrecisionExecution';
import { verifyCommercialWorkerReceipt, type CommercialReceiptBinding, type TrustedCommercialWorker } from './commercialWorkerReceipt';

export const COMMERCIAL_ARTIFACT_MAX_BYTES = 64 * 1024 * 1024;
export const COMMERCIAL_ARTIFACT_TOTAL_MAX_BYTES = 192 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;

export type ImmutableArtifactStore = {
  read(key: string): Promise<Uint8Array | null>;
  putImmutable(key: string, bytes: Uint8Array): Promise<void>;
};

export type WorkerArtifactMetadata = CommercialOutputArtifact & { sourceObjectKey?: string };
export type CommercialArtifactSnapshot = WorkerArtifactMetadata & { snapshotObjectKey: string; snapshotSha256: string; snapshotByteLength: number };
export type SnapshotResult =
  | { ok: true; receiptHash: string; snapshots: CommercialArtifactSnapshot[] }
  | { ok: false; code: 'RECEIPT_INVALID' | 'ARTIFACT_METADATA_INVALID' | 'ARTIFACT_NOT_FOUND' | 'ARTIFACT_HASH_MISMATCH' | 'SNAPSHOT_READBACK_MISMATCH' | 'SIZE_LIMIT' | 'SNAPSHOT_CONFLICT'; issues: string[]; orphanKeys: string[] };

function sha(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
function safeKey(key: string): boolean { return typeof key === 'string' && key.length > 0 && key.length <= 512 && !key.startsWith('/') && !key.includes('\\') && !key.split('/').includes('..') && !key.split('/').includes('.'); }
function cloneBytes(bytes: Uint8Array): Uint8Array { return new Uint8Array(bytes); }

function exactArtifacts(receipt: CommercialWorkerReceipt, metadata: readonly WorkerArtifactMetadata[]): string[] {
  const issues: string[] = [];
  const byId = new Map(metadata.map(item => [item.artifactId, item]));
  const seen = new Set<string>();
  for (const artifact of receipt.outputArtifacts) {
    if (seen.has(artifact.artifactId)) issues.push('duplicate_artifact_id');
    seen.add(artifact.artifactId);
    const declared = byId.get(artifact.artifactId);
    if (!declared || declared.role !== artifact.role || declared.contentSha256 !== artifact.contentSha256 || declared.byteLength !== artifact.byteLength || declared.objectKey !== artifact.objectKey) issues.push(`metadata_mismatch:${artifact.artifactId}`);
  }
  if (metadata.length !== receipt.outputArtifacts.length) issues.push('artifact_set_mismatch');
  if (metadata.some(item => !safeKey(item.objectKey) || (item.sourceObjectKey !== undefined && !safeKey(item.sourceObjectKey)))) issues.push('object_key_invalid');
  if (metadata.some(item => !SHA256.test(item.contentSha256) || !Number.isSafeInteger(item.byteLength) || item.byteLength <= 0 || item.byteLength > COMMERCIAL_ARTIFACT_MAX_BYTES)) issues.push('artifact_size_invalid');
  const roles = new Set(metadata.map(item => item.role));
  if (receipt.status === 'PASS' && (metadata.length !== 3 || roles.size !== 3 || !['model', 'report', 'verification'].every(role => roles.has(role as WorkerArtifactMetadata['role'])))) issues.push('pass_requires_exact_roles');
  return [...new Set(issues)];
}

export async function snapshotCommercialWorkerArtifacts(input: {
  store: ImmutableArtifactStore;
  receipt: CommercialWorkerReceipt;
  expected: CommercialReceiptBinding;
  trustedWorkers: Readonly<Record<string, TrustedCommercialWorker>>;
  metadata: readonly WorkerArtifactMetadata[];
  receiptHash?: string;
}): Promise<SnapshotResult> {
  const verified = verifyCommercialWorkerReceipt({ receipt: input.receipt, expected: input.expected, trustedWorkers: input.trustedWorkers });
  if (!verified.ok) return { ok: false, code: 'RECEIPT_INVALID', issues: verified.issues, orphanKeys: [] };
  const issues = exactArtifacts(input.receipt, input.metadata);
  if (issues.length) return { ok: false, code: issues.includes('artifact_size_invalid') ? 'SIZE_LIMIT' : 'ARTIFACT_METADATA_INVALID', issues, orphanKeys: [] };
  const receiptHash = input.receiptHash ?? verified.receiptHash;
  let total = 0;
  const snapshots: CommercialArtifactSnapshot[] = [];
  const orphanKeys: string[] = [];
  for (const artifact of input.metadata) {
    total += artifact.byteLength;
    if (total > COMMERCIAL_ARTIFACT_TOTAL_MAX_BYTES) return { ok: false, code: 'SIZE_LIMIT', issues: ['total_artifact_size_limit'], orphanKeys };
    const source = artifact.sourceObjectKey ?? artifact.objectKey;
    const bytes = await input.store.read(source);
    if (!bytes) return { ok: false, code: 'ARTIFACT_NOT_FOUND', issues: [`artifact_not_found:${artifact.artifactId}`], orphanKeys };
    if (bytes.byteLength !== artifact.byteLength || sha(bytes) !== artifact.contentSha256) return { ok: false, code: 'ARTIFACT_HASH_MISMATCH', issues: [`artifact_bytes_mismatch:${artifact.artifactId}`], orphanKeys };
    const snapshotObjectKey = `private/commercial-snapshots/${input.receipt.tenantId}/${input.receipt.projectId}/${input.receipt.executionId}/${receiptHash}/${artifact.artifactId}`;
    try {
      const existing = await input.store.read(snapshotObjectKey);
      if (existing) {
        if (existing.byteLength !== artifact.byteLength || sha(existing) !== artifact.contentSha256) throw new Error('immutable_snapshot_conflict');
      } else {
        await input.store.putImmutable(snapshotObjectKey, cloneBytes(bytes));
        orphanKeys.push(snapshotObjectKey);
      }
      const readback = await input.store.read(snapshotObjectKey);
      if (!readback || readback.byteLength !== artifact.byteLength || sha(readback) !== artifact.contentSha256) return { ok: false, code: 'SNAPSHOT_READBACK_MISMATCH', issues: [`snapshot_readback_mismatch:${artifact.artifactId}`], orphanKeys };
      snapshots.push({ ...artifact, snapshotObjectKey, snapshotSha256: sha(readback), snapshotByteLength: readback.byteLength });
    } catch (error) {
      return { ok: false, code: 'SNAPSHOT_CONFLICT', issues: [error instanceof Error ? error.message : 'snapshot_write_failed'], orphanKeys };
    }
  }
  return { ok: true, receiptHash, snapshots };
}

export function hashSnapshotManifest(snapshots: readonly CommercialArtifactSnapshot[]): string {
  return createHash('sha256').update(canonicalCommercialExecution(snapshots.map(({ artifactId, role, snapshotObjectKey, contentSha256, byteLength, snapshotSha256, snapshotByteLength }) => ({ artifactId, role, snapshotObjectKey, contentSha256, byteLength, snapshotSha256, snapshotByteLength })))).digest('hex');
}

export class InMemoryImmutableArtifactStore implements ImmutableArtifactStore {
  private readonly values = new Map<string, Uint8Array>();
  seed(key: string, bytes: Uint8Array): void { this.values.set(key, cloneBytes(bytes)); }
  async read(key: string): Promise<Uint8Array | null> { const value = this.values.get(key); return value ? cloneBytes(value) : null; }
  async putImmutable(key: string, bytes: Uint8Array): Promise<void> { if (this.values.has(key)) throw new Error('immutable_snapshot_exists'); this.values.set(key, cloneBytes(bytes)); }
}
