import { describe, expect, it, vi } from 'vitest';
import type { DbAdapter } from '@/lib/db-adapter';
import type { StorageAdapter } from '@/lib/storage';
import { agenticCommercialSha256 } from './agenticCommercialQualificationReceipt';
import { encodeAgenticCommercialReceiptEnvelope } from './agenticCommercialReceiptCodec';
import { getAgenticCommercialReceipt, putAgenticCommercialReceipt } from './agenticCommercialReceiptStore';

function fixtures() {
  const rows = new Map<string, Record<string, unknown>>();
  const objects = new Map<string, Buffer>();
  const adapter: DbAdapter = {
    backend: 'postgres',
    async queryOne<T>(sql: string, ...params: unknown[]) {
      if (sql.includes('nf_schema_migrations')) return { version: 2026082202, checksum: 'f'.repeat(64) } as T;
      if (sql.includes('WHERE receipt_id = ?') && !sql.includes('tenant_id')) return rows.get(String(params[0])) as T | undefined;
      const row = rows.get(String(params[2]));
      return row && row.tenant_id === params[0] && row.project_id === params[1] ? row as T : undefined;
    },
    async queryAll() { return []; },
    async execute(_sql, ...params) { rows.set(String(params[0]), { receipt_id: params[0], tenant_id: params[1], project_id: params[2], execution_id: params[3], generation_run_id: params[4], target_sha256: params[5], receipt_sha256: params[6], object_key: params[7], byte_length: params[8], issued_at: params[9], expires_at: params[10] }); return { changes: 1 }; },
    async executeRaw() { throw new Error('request-time DDL forbidden'); },
    async transaction<T>(fn: (db: DbAdapter) => Promise<T>) { return fn(this); },
    async close() {},
  };
  const storage: StorageAdapter = {
    async upload() { throw new Error('public upload forbidden'); },
    async uploadPrivate(buffer, filename, directory) { const key = `private/${directory}/uuid-${filename}`; objects.set(key, Buffer.from(buffer)); return { key, url: 'private', size: buffer.length }; },
    async download(key) { const value = objects.get(key); if (!value) throw new Error('missing'); return Buffer.from(value); },
    async sha256(key) { const value = objects.get(key)!; return { size: value.length, contentSha256: agenticCommercialSha256(value) }; },
    async getSignedUrl() { throw new Error('not used'); },
    delete: vi.fn(async key => { objects.delete(key); }),
  };
  return { adapter, storage, rows, objects };
}

describe('agentic receipt store', () => {
  it('stores only private object metadata and scopes immutable reads to tenant/project', async () => {
    const { adapter, storage, rows } = fixtures();
    const bytes = encodeAgenticCommercialReceiptEnvelope('candidate', { schema: 'candidate-fixture', executionId: 'e1' });
    const value = { receiptId: 'r1', tenantId: 't1', projectId: 'p1', executionId: 'e1', generationRunId: 'g1', targetSha256: 'a'.repeat(64), receiptSha256: agenticCommercialSha256(bytes), receiptBytes: bytes, issuedAt: '2026-08-20T00:00:00Z', expiresAt: '2026-08-30T00:00:00Z' };
    expect(await putAgenticCommercialReceipt(adapter, storage, value)).toMatchObject({ ok: true });
    expect(rows.get('r1')).not.toHaveProperty('receipt_bytes');
    expect(await getAgenticCommercialReceipt(adapter, storage, 't1', 'p1', 'r1')).toMatchObject({ tenantId: 't1', projectId: 'p1', executionId: 'e1', generationRunId: 'g1' });
    expect(await getAgenticCommercialReceipt(adapter, storage, 't2', 'p1', 'r1')).toBeUndefined();
    const changed = encodeAgenticCommercialReceiptEnvelope('candidate', { schema: 'candidate-fixture-changed', executionId: 'e1' });
    expect(await putAgenticCommercialReceipt(adapter, storage, { ...value, receiptBytes: changed, receiptSha256: agenticCommercialSha256(changed) })).toMatchObject({ ok: false, code: 'RECEIPT_IMMUTABLE_CONFLICT' });
  });

  it('fails closed for unsafe storage keys, tampered objects, and missing migration checksum', async () => {
    const { adapter, storage, rows } = fixtures();
    const bytes = encodeAgenticCommercialReceiptEnvelope('candidate', { schema: 'candidate-fixture', executionId: 'e1' }); const value = { receiptId: 'r2', tenantId: 't1', projectId: 'p1', executionId: 'e1', generationRunId: 'g1', targetSha256: 'a'.repeat(64), receiptSha256: agenticCommercialSha256(bytes), receiptBytes: bytes, issuedAt: '2026-08-20T00:00:00Z', expiresAt: '2026-08-30T00:00:00Z' };
    storage.uploadPrivate = async buffer => ({ key: 'public/receipt.json', url: 'public', size: buffer.length });
    expect(await putAgenticCommercialReceipt(adapter, storage, value)).toMatchObject({ ok: false, code: 'PRIVATE_OBJECT_STORAGE_BINDING_INVALID' });
    rows.set('r2', { receipt_id: 'r2', tenant_id: 't1', project_id: 'p1', execution_id: 'e1', generation_run_id: 'g1', target_sha256: 'a'.repeat(64), receipt_sha256: value.receiptSha256, object_key: 'private/agentic-commercial-receipts/t1/p1/r2/x.json', byte_length: bytes.length, issued_at: value.issuedAt, expires_at: value.expiresAt });
    expect(await getAgenticCommercialReceipt(adapter, storage, 't1', 'p1', 'r2')).toBeUndefined();
    adapter.queryOne = async () => ({ version: 2026082202 } as never);
    await expect(getAgenticCommercialReceipt(adapter, storage, 't1', 'p1', 'r2')).rejects.toThrow('migration_required');
  });
});
