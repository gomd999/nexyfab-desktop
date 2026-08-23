import { createHash } from 'node:crypto';
import type { DbAdapter } from '../db-adapter';
import type { StorageAdapter } from '../storage';
const SHA256 = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX = 16 * 1024 * 1024;
export interface ExternalCommercialEvidence { evidenceId: string; tenantId: string; projectId: string; executionId: string; generationRunId: string; revision: number; modelContentHash: string; targetSha256: string; role: string; bytes: Uint8Array; sha256: string; size: number; }
export interface ExternalCommercialEvidenceStore { put(value: ExternalCommercialEvidence): Promise<{ ok: true } | { ok: false; code: string }>; get(tenantId: string, projectId: string, evidenceId: string): Promise<ExternalCommercialEvidence | undefined>; }
function valid(value: ExternalCommercialEvidence): boolean { return ID.test(value.evidenceId) && ID.test(value.tenantId) && ID.test(value.projectId) && ID.test(value.executionId) && ID.test(value.generationRunId) && Number.isSafeInteger(value.revision) && value.revision >= 0 && SHA256.test(value.modelContentHash) && SHA256.test(value.targetSha256) && ID.test(value.role) && value.bytes instanceof Uint8Array && value.bytes.length > 0 && value.bytes.length <= MAX && value.size === value.bytes.length && SHA256.test(value.sha256) && createHash('sha256').update(value.bytes).digest('hex') === value.sha256; }
function safeObjectKey(key: unknown, tenantId: string, projectId: string): key is string { return typeof key === 'string' && key.startsWith(`private/commercial-evidence/${tenantId}/${projectId}/`) && key.length <= 1024 && !key.includes('..') && !key.includes('\\') && !key.includes('\0'); }
export function createInMemoryExternalCommercialEvidenceStore(): ExternalCommercialEvidenceStore { const records = new Map<string, ExternalCommercialEvidence>(); return { async put(value) { if (!valid(value)) return { ok: false, code: 'EVIDENCE_METADATA_INVALID' }; const old = records.get(`${value.tenantId}:${value.projectId}:${value.evidenceId}`); if (old) return JSON.stringify({ ...old, bytes: undefined }) === JSON.stringify({ ...value, bytes: undefined }) ? { ok: true } : { ok: false, code: 'EVIDENCE_IMMUTABLE_CONFLICT' }; records.set(`${value.tenantId}:${value.projectId}:${value.evidenceId}`, { ...value, bytes: new Uint8Array(value.bytes) }); return { ok: true }; }, async get(tenantId, projectId, evidenceId) { const value = records.get(`${tenantId}:${projectId}:${evidenceId}`); return value ? { ...value, bytes: new Uint8Array(value.bytes) } : undefined; } }; }

/** Production adapter: bytes are private-object-store backed and metadata is immutable in Postgres. */
export function createDbExternalCommercialEvidenceStore(db: DbAdapter, storage: StorageAdapter): ExternalCommercialEvidenceStore {
  return {
    async put(value) {
      if (db.backend !== 'postgres') return { ok: false, code: 'COMMERCIAL_POSTGRES_REQUIRED' };
      if (!valid(value) || !storage.uploadPrivate) return { ok: false, code: 'EVIDENCE_METADATA_INVALID' };
      const existing = await db.queryOne<Record<string, unknown>>('SELECT * FROM nf_external_commercial_evidence WHERE tenant_id = ? AND project_id = ? AND evidence_id = ?', value.tenantId, value.projectId, value.evidenceId);
      if (existing) {
        return existing.content_sha256 === value.sha256 && Number(existing.content_size) === value.size && existing.execution_id === value.executionId && existing.generation_run_id === value.generationRunId && Number(existing.revision) === value.revision && existing.evidence_role === value.role && existing.target_sha256 === value.targetSha256 && existing.model_content_hash === value.modelContentHash && safeObjectKey(existing.object_key, value.tenantId, value.projectId) ? { ok: true } : { ok: false, code: 'EVIDENCE_IMMUTABLE_CONFLICT' };
      }
      const uploaded = await storage.uploadPrivate(Buffer.from(value.bytes), `${value.evidenceId}.bin`, `commercial-evidence/${value.tenantId}/${value.projectId}`);
      if (!safeObjectKey(uploaded.key, value.tenantId, value.projectId) || uploaded.size !== value.size) { await storage.delete(uploaded.key).catch(() => undefined); return { ok: false, code: 'EVIDENCE_PRIVATE_KEY_INVALID' }; }
      const authoritative = storage.sha256 ? await storage.sha256(uploaded.key) : undefined;
      if (!authoritative || authoritative.size !== value.size || authoritative.contentSha256 !== value.sha256) { await storage.delete(uploaded.key).catch(() => undefined); return { ok: false, code: 'EVIDENCE_PRIVATE_HASH_INVALID' }; }
      try {
        await db.execute('INSERT INTO nf_external_commercial_evidence (evidence_id, tenant_id, project_id, execution_id, generation_run_id, revision, model_content_hash, target_sha256, evidence_role, object_key, content_sha256, content_size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', value.evidenceId, value.tenantId, value.projectId, value.executionId, value.generationRunId, value.revision, value.modelContentHash, value.targetSha256, value.role, uploaded.key, value.sha256, value.size, Date.now());
      } catch { await storage.delete(uploaded.key).catch(() => undefined); return { ok: false, code: 'EVIDENCE_IMMUTABLE_CONFLICT' }; }
      return { ok: true };
    },
    async get(tenantId, projectId, evidenceId) {
      if (db.backend !== 'postgres') return undefined;
      const row = await db.queryOne<Record<string, unknown>>('SELECT * FROM nf_external_commercial_evidence WHERE tenant_id = ? AND project_id = ? AND evidence_id = ?', tenantId, projectId, evidenceId);
      if (!row || !safeObjectKey(row.object_key, tenantId, projectId) || !storage.download) return undefined;
      const raw = await storage.download(row.object_key);
      const bytes = new Uint8Array(raw);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      if (sha256 !== row.content_sha256 || bytes.length !== Number(row.content_size) || !SHA256.test(sha256)) return undefined;
      return { evidenceId: String(row.evidence_id), tenantId: String(row.tenant_id), projectId: String(row.project_id), executionId: String(row.execution_id), generationRunId: String(row.generation_run_id), revision: Number(row.revision), modelContentHash: String(row.model_content_hash), targetSha256: String(row.target_sha256), role: String(row.evidence_role), bytes, sha256, size: bytes.length };
    },
  };
}
