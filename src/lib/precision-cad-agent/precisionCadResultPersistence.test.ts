import { describe, expect, it } from 'vitest';
import type { DbAdapter, SqlParam } from '@/lib/db-adapter';
import type { StorageAdapter } from '@/lib/storage';
import { persistPrecisionCadResult, summarizePrecisionCadToolResult } from './precisionCadResultPersistence';

const binding = { projectId: 'project-1', revision: 2, updatedAt: 1234567890 } as const;
const call = { callId: 'call-1', name: 'render_preview' as const, arguments: {}, scope: 'propose' as const };

function db() {
  const executed: string[] = [];
  const value: DbAdapter = {
    backend: 'sqlite',
    async queryOne<T>(sql: string): Promise<T | undefined> {
      if (sql.includes('nf_projects')) return { updated_at: binding.updatedAt } as T;
      return undefined;
    },
    async queryAll<T>(): Promise<T[]> { return []; },
    async execute(sql: string, ..._params: SqlParam[]) { executed.push(sql); return { changes: 1 }; },
    async executeRaw(_sql: string) {},
    async transaction<T>(fn: (tx: DbAdapter) => Promise<T>) { return fn(value); },
    async close() {},
  };
  return { value, executed };
}

function storage() {
  const objects = new Map<string, Buffer>();
  const value = {
    async upload() { throw new Error('not used'); },
    async uploadPrivate(bytes: Buffer, filename: string, directory: string) {
      const key = `private/${directory}/object-${objects.size}/${filename}`;
      objects.set(key, Buffer.from(bytes));
      return { key, url: '', size: bytes.length };
    },
    async getSignedUrl() { return ''; },
    async delete(key: string) { objects.delete(key); },
  } as unknown as StorageAdapter;
  return { value, objects };
}

function execution(result: unknown) {
  return { ok: true as const, tool: 'render_preview', scope: 'propose' as const, result, auditId: 'audit-1' };
}

describe('precision CAD result persistence', () => {
  it('removes inline preview payloads from the provider/browser result summary', () => {
    const summary = summarizePrecisionCadToolResult({ views: { iso: Buffer.alloc(2048, 7).toString('base64') } });
    expect(JSON.stringify(summary)).not.toContain(Buffer.alloc(2048, 7).toString('base64'));
    expect(summary).toMatchObject({ views: { iso: { type: 'base64-artifact' } } });
  });

  it('stores a bound immutable report and generated preview, without claiming exact geometry', async () => {
    const memory = db();
    const files = storage();
    const result = await persistPrecisionCadResult({
      db: memory.value, storage: files.value, userId: 'user-1', tenantId: 'personal:user-1',
      binding, runId: 'run-1', call, execution: execution({ ok: true, views: { iso: Buffer.from('png').toString('base64') } }),
    });
    expect(result).toMatchObject({ ok: true, honesty: 'preview_and_report_only', exactGeometryProduced: false });
    if (!result.ok) return;
    expect(result.artifacts.map(artifact => artifact.kind)).toEqual(['report', 'preview']);
    expect(result.artifacts.every(artifact => artifact.projectId === binding.projectId && artifact.revision === binding.revision && artifact.immutabilityState === 'IMMUTABLE')).toBe(true);
    expect(files.objects.size).toBe(2);
    expect(memory.executed.filter(sql => sql.includes('nf_precision_cad_result_artifacts'))).toHaveLength(2);
  });

  it('keeps an apparent STEP payload report-only until a trusted job receipt promotes it', async () => {
    const memory = db();
    const files = storage();
    const step = Buffer.from('ISO-10303-21;\nEND-ISO-10303-21;').toString('base64');
    const result = await persistPrecisionCadResult({
      db: memory.value, storage: files.value, userId: 'user-1', tenantId: 'personal:user-1',
      binding, runId: 'run-2', call: { callId: 'call-2', name: 'build_assembly', arguments: {}, scope: 'apply' }, execution: { ...execution({ ok: true, exactBrep: true, kernelIdentity: 'browser-claim', stepBase64: step }), scope: 'apply', tool: 'build_assembly' },
    });
    expect(result).toMatchObject({ ok: true, exactGeometryProduced: false, releaseReady: false, promotionStatus: 'report_preview_only' });
    if (result.ok) expect(result.artifacts.map(artifact => artifact.kind)).toEqual(['report']);
    expect(files.objects.size).toBe(1);
  });

  it('rejects a stale project CAS token before touching storage', async () => {
    const memory = db();
    const files = storage();
    const result = await persistPrecisionCadResult({
      db: memory.value, storage: files.value, userId: 'user-1', tenantId: 'personal:user-1',
      binding: { ...binding, updatedAt: binding.updatedAt + 1 }, runId: 'run-3', call, execution: execution({ ok: true }),
    });
    expect(result).toMatchObject({ ok: false, code: 'BINDING_STALE' });
    expect(files.objects.size).toBe(0);
  });
});
