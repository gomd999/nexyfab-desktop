import { describe, expect, it } from 'vitest';
import type { DbAdapter } from '@/lib/db-adapter';
import { bindGenerationProgram, createGenerationRun } from './generationRunState';
import { canonicalEvidenceJson, serverEvidenceSha256 } from './serverEvidence';
import { createDbCommercialGenerationStateStore } from './commercialGenerationStateStore';

function adapter(rows: Array<Record<string, unknown>>, run: Record<string, unknown>): DbAdapter {
  return {
    backend: 'postgres',
    async queryOne<T>(sql: string) { if (sql.includes('nf_schema_migrations')) return { version: 2026082208, checksum: 'a'.repeat(64) } as T; if (sql.includes('COUNT(*) AS row_count')) { const sizes = rows.map(row => Buffer.byteLength(String(row.state_json), 'utf8')); return { row_count: rows.length, total_bytes: sizes.reduce((sum, value) => sum + value, 0), max_bytes: Math.max(...sizes, 0) } as T; } if (sql.includes('nf_commercial_generation_runs')) return run as T; return undefined; },
    async queryAll<T>() { return rows as T[]; },
    async execute() { return { changes: 1 }; }, async executeRaw() {}, async transaction(fn) { return fn(this); }, async close() {},
  };
}

const workspace = 'b'.repeat(64);
describe('commercial generation chain audit', () => {
  it('rehashes canonical state bytes and follows genesis/previous links', async () => {
    const genesis = createGenerationRun('audit-run');
    const program = 'a'.repeat(64);
    const next = bindGenerationProgram(genesis, program);
    const rows = [
      { revision: 0, previous_revision: -1, previous_sha256: '0'.repeat(64), state_sha256: serverEvidenceSha256(genesis), state_json: canonicalEvidenceJson(genesis), generation_program_sha256: '0'.repeat(64) },
      { revision: 1, previous_revision: 0, previous_sha256: serverEvidenceSha256(genesis), state_sha256: serverEvidenceSha256(next), state_json: canonicalEvidenceJson(next), generation_program_sha256: program },
    ];
    const result = await createDbCommercialGenerationStateStore(adapter(rows, { workspace_revision: 3, head_revision: 1, head_sha256: workspace, state_sha256: serverEvidenceSha256(next) })).audit('tenant-1', 'project-1', 'audit-run');
    expect(result).toMatchObject({ ok: true, headRevision: 1, generationProgramSha256: program });
  });

  it('holds forged predecessor, noncanonical bytes, and head mismatches', async () => {
    const genesis = createGenerationRun('audit-forged');
    const rows = [{ revision: 0, previous_revision: -1, previous_sha256: 'e'.repeat(64), state_sha256: serverEvidenceSha256(genesis), state_json: JSON.stringify(genesis), generation_program_sha256: '0'.repeat(64) }];
    const result = await createDbCommercialGenerationStateStore(adapter(rows, { workspace_revision: 0, head_revision: 0, head_sha256: workspace, state_sha256: serverEvidenceSha256(genesis) })).audit('tenant-1', 'project-1', 'audit-forged');
    expect(result).toMatchObject({ ok: false, code: 'COMMERCIAL_GENERATION_AUDIT_PREVIOUS_LINK_INVALID' });
  });
});
