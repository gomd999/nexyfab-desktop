import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';
import { canonicalCommercialExecution } from '../../../packages/job-contracts/src/commercialPrecisionExecution';
import type { CommercialArtifactSnapshot } from './commercialWorkerArtifactSnapshot';

const SHA256 = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
export type NativeParserManifestEntry = { artifactId: string; role: 'model' | 'report' | 'verification'; objectKey: string; contentSha256: string; byteLength: number };
export type NativeParserReceipt = {
  schema: 'nexyfab.precision-cad-native-parser-receipt.v1';
  parserIdentity: string;
  parserPublicKeyFingerprint: string;
  parserRole: 'native_parser';
  format: string;
  kernelIdentity: string;
  modelArtifactId: string;
  workspaceEnvelopeArtifactId: string;
  modelContentSha256: string;
  targetHash: string;
  workspaceAfter: { workspaceId: string; projectId: string; revision: number; contentHash: string };
  manifest: NativeParserManifestEntry[];
  issuedAt: string;
  completedAt: string;
  signatureBase64: string;
};
export type TrustedNativeParser = { parserIdentity: string; publicKeyPem: string; fingerprintSha256: string };
export type PersistenceReceiptBinding = { tenantId: string; projectId: string; executionId: string; generationRunId: string; jobId: string; targetHash: string; workspaceId: string; workspaceRevision: number; workspaceContentHash: string };
export type NativeParserVerification = { ok: true; receiptHash: string } | { ok: false; issues: string[] };

function hash(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex'); }
function fingerprint(pem: string): string | undefined { try { const key = createPublicKey(pem); return key.asymmetricKeyType === 'ed25519' ? createHash('sha256').update(key.export({ type: 'spki', format: 'der' })).digest('hex') : undefined; } catch { return undefined; } }
export function canonicalNativeParserReceipt(receipt: NativeParserReceipt): string { const { signatureBase64: _signature, ...unsigned } = receipt; return canonicalCommercialExecution({ schema: receipt.schema, purpose: 'native-parser-receipt', receipt: unsigned }); }
export function nativeParserReceiptHash(receipt: NativeParserReceipt): string { return hash(canonicalNativeParserReceipt(receipt)); }

export function verifyNativeParserReceipt(input: { receipt: NativeParserReceipt; expected: PersistenceReceiptBinding; snapshots: readonly CommercialArtifactSnapshot[]; trustedParser: TrustedNativeParser; now?: number; maxAgeMs?: number }): NativeParserVerification {
  const r = input.receipt; const issues: string[] = [];
  if (r.schema !== 'nexyfab.precision-cad-native-parser-receipt.v1') issues.push('schema_invalid');
  if (!ID.test(r.parserIdentity) || r.parserRole !== 'native_parser') issues.push('parser_identity_invalid');
  if (!r.format || r.format.length > 64 || !r.kernelIdentity || r.kernelIdentity.length > 256) issues.push('format_kernel_required');
  if (!SHA256.test(r.parserPublicKeyFingerprint) || r.parserIdentity !== input.trustedParser.parserIdentity || r.parserPublicKeyFingerprint !== input.trustedParser.fingerprintSha256 || fingerprint(input.trustedParser.publicKeyPem) !== input.trustedParser.fingerprintSha256) issues.push('parser_key_invalid');
  if (r.targetHash !== input.expected.targetHash) issues.push('target_mismatch');
  if (r.workspaceAfter.workspaceId !== input.expected.workspaceId || r.workspaceAfter.projectId !== input.expected.projectId || r.workspaceAfter.revision !== input.expected.workspaceRevision + 1 || !SHA256.test(r.workspaceAfter.contentHash)) issues.push('workspace_after_invalid');
  const byId = new Map(input.snapshots.map(item => [item.artifactId, item])); const seen = new Set<string>();
  if (r.manifest.length !== input.snapshots.length) issues.push('manifest_set_mismatch');
  for (const entry of r.manifest) {
    if (seen.has(entry.artifactId)) issues.push('manifest_duplicate'); seen.add(entry.artifactId);
    const snap = byId.get(entry.artifactId);
    if (!snap || snap.role !== entry.role || snap.snapshotObjectKey !== entry.objectKey || snap.contentSha256 !== entry.contentSha256 || snap.byteLength !== entry.byteLength) issues.push(`manifest_mismatch:${entry.artifactId}`);
  }
  const model = byId.get(r.modelArtifactId);
  if (!model || model.role !== 'model' || model.contentSha256 !== r.modelContentSha256) issues.push('model_binding_invalid');
  const workspaceEnvelope = byId.get(r.workspaceEnvelopeArtifactId);
  if (!workspaceEnvelope || workspaceEnvelope.role !== 'report') issues.push('workspace_envelope_artifact_invalid');
  const now = input.now ?? Date.now(); const completed = Date.parse(r.completedAt); const issued = Date.parse(r.issuedAt);
  if (!Number.isFinite(issued) || !Number.isFinite(completed) || completed < issued || completed > now || now - completed > (input.maxAgeMs ?? 90 * 24 * 60 * 60 * 1000)) issues.push('parser_receipt_stale');
  try { if (!verifySignature(null, Buffer.from(canonicalNativeParserReceipt(r), 'utf8'), input.trustedParser.publicKeyPem, Buffer.from(r.signatureBase64, 'base64'))) issues.push('parser_signature_invalid'); } catch { issues.push('parser_signature_invalid'); }
  return issues.length ? { ok: false, issues: [...new Set(issues)] } : { ok: true, receiptHash: nativeParserReceiptHash(r) };
}

export function buildPersistenceReceiptHash(input: { workerReceiptHash: string; parserReceiptHash: string; manifestHash: string; workspaceAfter: NativeParserReceipt['workspaceAfter']; targetHash: string }): string {
  return hash(canonicalCommercialExecution({ schema: 'nexyfab.precision-cad-persistence-receipt.v1', ...input }));
}
