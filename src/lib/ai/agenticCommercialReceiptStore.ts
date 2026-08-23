import type { DbAdapter } from '@/lib/db-adapter';
import type { StorageAdapter } from '@/lib/storage';
import { agenticCommercialCanonicalBytes, agenticCommercialSha256, type AgenticCommercialQualificationReceipt } from './agenticCommercialQualificationReceipt';
import { decodeAgenticCommercialReceiptEnvelope } from './agenticCommercialReceiptCodec';

const SHA256 = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_BYTES = 64 * 1024 * 1024;
const MIGRATION_VERSION = 2026082202;
export interface StoredAgenticCommercialReceipt { receiptId: string; tenantId: string; projectId: string; executionId: string; generationRunId: string; targetSha256: string; receiptSha256: string; receiptBytes: Uint8Array; objectKey?: string; issuedAt: string; expiresAt: string }

export async function assertAgenticCommercialReceiptMigration(db: DbAdapter): Promise<void> {
  const row = await db.queryOne<{ version: number; checksum?: string }>('SELECT version, checksum FROM nf_schema_migrations WHERE version = ?', MIGRATION_VERSION).catch(() => undefined);
  const expected = process.env.POSTGRES_MIGRATION_CHECKSUM?.trim();
  if (!row || Number(row.version) !== MIGRATION_VERSION || !SHA256.test(row.checksum ?? '') || (expected && expected !== row.checksum)) throw new Error(`agentic_commercial_receipt_migration_required:v${MIGRATION_VERSION}`);
}

function validMetadata(value: StoredAgenticCommercialReceipt): boolean {
  const issued = Date.parse(value.issuedAt), expires = Date.parse(value.expiresAt);
  return ID.test(value.receiptId) && ID.test(value.tenantId) && ID.test(value.projectId) && ID.test(value.executionId) && ID.test(value.generationRunId)
    && SHA256.test(value.targetSha256) && SHA256.test(value.receiptSha256)
    && value.receiptBytes instanceof Uint8Array && value.receiptBytes.length > 0 && value.receiptBytes.length <= MAX_BYTES
    && agenticCommercialSha256(value.receiptBytes) === value.receiptSha256
    && (() => { try { return decodeAgenticCommercialReceiptEnvelope(value.receiptBytes).kind === 'candidate'; } catch { return false; } })()
    && Number.isFinite(issued) && Number.isFinite(expires) && expires > issued;
}
function safePrivateKey(key: string): boolean { return key.startsWith('private/agentic-commercial-receipts/') && !key.includes('..') && !key.includes('\\') && key.length <= 1024; }
function sameMetadata(row: Record<string, unknown>, value: StoredAgenticCommercialReceipt): boolean {
  return String(row.tenant_id) === value.tenantId && String(row.project_id) === value.projectId && String(row.execution_id) === value.executionId
    && String(row.generation_run_id) === value.generationRunId && String(row.target_sha256) === value.targetSha256
    && String(row.receipt_sha256) === value.receiptSha256 && String(row.issued_at) === value.issuedAt && String(row.expires_at) === value.expiresAt;
}

export async function putAgenticCommercialReceipt(db: DbAdapter, storage: StorageAdapter, value: StoredAgenticCommercialReceipt): Promise<{ ok: true; objectKey: string } | { ok: false; code: string }> {
  if (!validMetadata(value) || typeof storage.uploadPrivate !== 'function' || typeof storage.download !== 'function') return { ok: false, code: 'RECEIPT_METADATA_OR_PRIVATE_STORAGE_INVALID' };
  await assertAgenticCommercialReceiptMigration(db);
  const existing = await db.queryOne<Record<string, unknown>>('SELECT * FROM nf_agentic_commercial_receipts WHERE receipt_id = ?', value.receiptId);
  if (existing) return sameMetadata(existing, value) && safePrivateKey(String(existing.object_key)) ? { ok: true, objectKey: String(existing.object_key) } : { ok: false, code: 'RECEIPT_IMMUTABLE_CONFLICT' };
  const uploaded = await storage.uploadPrivate(Buffer.from(value.receiptBytes), `${value.receiptSha256}.json`, `agentic-commercial-receipts/${value.tenantId}/${value.projectId}/${value.receiptId}`);
  if (!safePrivateKey(uploaded.key) || uploaded.size !== value.receiptBytes.length) { await storage.delete(uploaded.key).catch(() => {}); return { ok: false, code: 'PRIVATE_OBJECT_STORAGE_BINDING_INVALID' }; }
  const readback = await storage.download(uploaded.key).catch(() => undefined);
  if (!readback || readback.length !== value.receiptBytes.length || agenticCommercialSha256(readback) !== value.receiptSha256) { await storage.delete(uploaded.key).catch(() => {}); return { ok: false, code: 'PRIVATE_OBJECT_STORAGE_HASH_INVALID' }; }
  if (storage.sha256) { const authoritative = await storage.sha256(uploaded.key).catch(() => undefined); if (!authoritative || authoritative.size !== value.receiptBytes.length || authoritative.contentSha256 !== value.receiptSha256) { await storage.delete(uploaded.key).catch(() => {}); return { ok: false, code: 'PRIVATE_OBJECT_STORAGE_HASH_INVALID' }; } }
  try {
    await db.execute('INSERT INTO nf_agentic_commercial_receipts (receipt_id, tenant_id, project_id, execution_id, generation_run_id, target_sha256, receipt_sha256, object_key, byte_length, issued_at, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', value.receiptId, value.tenantId, value.projectId, value.executionId, value.generationRunId, value.targetSha256, value.receiptSha256, uploaded.key, value.receiptBytes.length, value.issuedAt, value.expiresAt, Date.now());
    return { ok: true, objectKey: uploaded.key };
  } catch {
    await storage.delete(uploaded.key).catch(() => {});
    const raced = await db.queryOne<Record<string, unknown>>('SELECT * FROM nf_agentic_commercial_receipts WHERE receipt_id = ?', value.receiptId);
    return raced && sameMetadata(raced, value) && safePrivateKey(String(raced.object_key)) ? { ok: true, objectKey: String(raced.object_key) } : { ok: false, code: 'RECEIPT_IMMUTABLE_CONFLICT' };
  }
}

export async function getAgenticCommercialReceipt(db: DbAdapter, storage: StorageAdapter, tenantId: string, projectId: string, receiptId: string): Promise<StoredAgenticCommercialReceipt | undefined> {
  if (!ID.test(tenantId) || !ID.test(projectId) || !ID.test(receiptId) || typeof storage.download !== 'function') return undefined;
  await assertAgenticCommercialReceiptMigration(db);
  const row = await db.queryOne<Record<string, unknown>>('SELECT receipt_id, tenant_id, project_id, execution_id, generation_run_id, target_sha256, receipt_sha256, object_key, byte_length, issued_at, expires_at FROM nf_agentic_commercial_receipts WHERE tenant_id = ? AND project_id = ? AND receipt_id = ?', tenantId, projectId, receiptId);
  if (!row || !safePrivateKey(String(row.object_key)) || !Number.isSafeInteger(Number(row.byte_length)) || Number(row.byte_length) <= 0 || Number(row.byte_length) > MAX_BYTES) return undefined;
  const downloaded = await storage.download(String(row.object_key)).catch(() => undefined);
  if (!downloaded || downloaded.length !== Number(row.byte_length) || agenticCommercialSha256(downloaded) !== row.receipt_sha256) return undefined;
  return { receiptId: String(row.receipt_id), tenantId: String(row.tenant_id), projectId: String(row.project_id), executionId: String(row.execution_id), generationRunId: String(row.generation_run_id), targetSha256: String(row.target_sha256), receiptSha256: String(row.receipt_sha256), receiptBytes: new Uint8Array(downloaded), objectKey: String(row.object_key), issuedAt: String(row.issued_at), expiresAt: String(row.expires_at) };
}
export function receiptBytesFromValue(receipt: AgenticCommercialQualificationReceipt): Uint8Array { return agenticCommercialCanonicalBytes(receipt); }
