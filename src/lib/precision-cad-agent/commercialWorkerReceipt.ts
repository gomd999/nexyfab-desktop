import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';
import { canonicalCommercialExecution, unsignedCommercialWorkerReceipt, validateCommercialWorkerReceipt, type CommercialWorkerReceipt } from '../../../packages/job-contracts/src/commercialPrecisionExecution';

const SHA256 = /^[a-f0-9]{64}$/;
export type TrustedCommercialWorker = { workerIdentity: string; publicKeyPem: string; fingerprintSha256: string };
export type CommercialReceiptBinding = { tenantId: string; projectId: string; executionId: string; generationRunId: string; generationStateRevision: number; generationProgramSha256: string; workspaceId: string; workspaceRevision: number; workspaceContentHash: string; journalVersion: number; leaseGeneration: number; leaseCapabilityHash: string; attempt: number; jobId: string; commandHash: string; targetHash: string };
export type CommercialReceiptVerification = { ok: true; receiptHash: string } | { ok: false; issues: string[] };

function hash(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex'); }
export function commercialWorkerFingerprint(publicKeyPem: string): string | undefined { try { if (typeof publicKeyPem !== 'string' || /PRIVATE KEY/i.test(publicKeyPem)) return undefined; const key = createPublicKey(publicKeyPem); return key.asymmetricKeyType === 'ed25519' ? createHash('sha256').update(key.export({ type: 'spki', format: 'der' })).digest('hex') : undefined; } catch { return undefined; } }
export function loadTrustedCommercialWorkers(raw = process.env.NEXYFAB_COMMERCIAL_WORKER_KEYS_JSON): Readonly<Record<string, TrustedCommercialWorker>> | undefined {
  if (!raw || Buffer.byteLength(raw, 'utf8') > 64 * 1024) return undefined;
  try {
    const parsed = JSON.parse(raw) as Record<string, TrustedCommercialWorker>;
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') return undefined;
    const entries = Object.entries(parsed); if (entries.length < 1 || entries.length > 16) return undefined;
    const fingerprints = new Set<string>();
    for (const [key, worker] of entries) {
      if (!worker || typeof worker !== 'object' || Object.keys(worker).sort().join(',') !== 'fingerprintSha256,publicKeyPem,workerIdentity' || worker.workerIdentity !== key || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(key) || !SHA256.test(worker.fingerprintSha256) || commercialWorkerFingerprint(worker.publicKeyPem) !== worker.fingerprintSha256 || fingerprints.has(worker.fingerprintSha256)) return undefined;
      fingerprints.add(worker.fingerprintSha256);
    }
    return Object.freeze(parsed);
  } catch { return undefined; }
}
export function canonicalCommercialWorkerReceiptPayload(receipt: CommercialWorkerReceipt): string { return canonicalCommercialExecution({ schema: receipt.schema, purpose: 'worker-receipt', receipt: unsignedCommercialWorkerReceipt(receipt) }); }
export function commercialWorkerReceiptHash(receipt: CommercialWorkerReceipt): string { return hash(canonicalCommercialWorkerReceiptPayload(receipt)); }
export function verifyCommercialWorkerReceipt(input: { receipt: CommercialWorkerReceipt; expected: CommercialReceiptBinding; trustedWorkers: Readonly<Record<string, TrustedCommercialWorker>>; now?: number; maxAgeMs?: number }): CommercialReceiptVerification {
  const issues = validateCommercialWorkerReceipt(input.receipt);
  const receipt = input.receipt; const expected = input.expected;
  for (const key of ['tenantId', 'projectId', 'executionId', 'generationRunId', 'generationStateRevision', 'generationProgramSha256', 'workspaceId', 'workspaceRevision', 'workspaceContentHash', 'journalVersion', 'leaseGeneration', 'leaseCapabilityHash', 'attempt', 'jobId', 'commandHash', 'targetHash'] as const) if (receipt[key] !== expected[key]) issues.push(`binding_mismatch:${key}`);
  const worker = input.trustedWorkers[receipt.workerIdentity];
  if (!worker) issues.push('worker_not_trusted');
  if (!SHA256.test(receipt.workerPublicKeyFingerprint) || receipt.workerPublicKeyFingerprint !== worker?.fingerprintSha256 || (worker && commercialWorkerFingerprint(worker.publicKeyPem) !== worker.fingerprintSha256) || worker?.workerIdentity !== receipt.workerIdentity) issues.push('worker_key_fingerprint_invalid');
  try { if (!worker || !verifySignature(null, Buffer.from(canonicalCommercialWorkerReceiptPayload(receipt), 'utf8'), worker.publicKeyPem, Buffer.from(receipt.signatureBase64, 'base64'))) issues.push('worker_signature_invalid'); } catch { issues.push('worker_signature_invalid'); }
  const now = input.now ?? Date.now(); const maxAge = input.maxAgeMs ?? 90 * 24 * 60 * 60 * 1000; const completed = Date.parse(receipt.completedAt); if (!Number.isFinite(completed) || completed > now || now - completed > maxAge) issues.push('worker_receipt_stale');
  return issues.length ? { ok: false, issues: [...new Set(issues)] } : { ok: true, receiptHash: commercialWorkerReceiptHash(receipt) };
}
