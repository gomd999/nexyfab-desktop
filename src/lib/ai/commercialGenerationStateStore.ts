import type { DbAdapter } from '@/lib/db-adapter';
import { canonicalEvidenceJson, serverEvidenceSha256 } from './serverEvidence';
import type { GenerationRunState } from './generationRunState';
import { UNBOUND_GENERATION_PROGRAM_SHA256, validateCommercialGenerationRunBinding, type CommercialGenerationRunBinding } from './commercialGenerationRunBinding';

const SHA256 = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_CHAIN_ROWS = 4096;
const MAX_STATE_BYTES = 4 * 1024 * 1024;
const MAX_CHAIN_BYTES = 64 * 1024 * 1024;

export interface CommercialGenerationChainAudit { ok: true; headRevision: number; headStateSha256: string; workspaceRevision: number; workspaceHeadSha256: string; generationProgramSha256: string; rowCount: number; }
export type CommercialGenerationChainAuditResult = CommercialGenerationChainAudit | { ok: false; code: string };
export interface CommercialGenerationStateStore {
  create(binding: CommercialGenerationRunBinding, state: GenerationRunState): Promise<{ ok: true } | { ok: false; code: string }>;
  load(tenantId: string, projectId: string, runId: string): Promise<{ binding: CommercialGenerationRunBinding; state: GenerationRunState } | undefined>;
  save(binding: CommercialGenerationRunBinding, state: GenerationRunState, expectedRevision: number): Promise<{ ok: true } | { ok: false; code: string }>;
  audit(tenantId: string, projectId: string, runId: string): Promise<CommercialGenerationChainAuditResult>;
  bindReceipt(input: { tenantId: string; projectId: string; runId: string; receiptId: string; receiptSha256: string; generationRevision: number; workspaceRevision: number; generationProgramSha256: string; targetSha256: string; status: 'PENDING' | 'VERIFIED' | 'HOLD' }): Promise<{ ok: true } | { ok: false; code: string }>;
}

export async function assertCommercialGenerationMigration(db: DbAdapter): Promise<void> {
  if (db.backend !== 'postgres') throw new Error('commercial_generation_postgres_required:v2026082208');
  const row = await db.queryOne<{ version: number; checksum?: string }>('SELECT version, checksum FROM nf_schema_migrations WHERE version = ?', 2026082208).catch(() => undefined);
  const expected = process.env.POSTGRES_MIGRATION_CHECKSUM_2026082208?.trim();
  const commercial = process.env.NEXYFAB_COMMERCIAL_MODE === '1' || process.env.NEXYFAB_PRECISION_CAD_COMMERCIAL_MODE === '1';
  if (!row || Number(row.version) !== 2026082208 || !SHA256.test(row.checksum ?? '') || (commercial && !expected) || (expected && expected !== row.checksum)) throw new Error('commercial_generation_migration_required:v2026082208');
}
function canonicalStateJson(state: GenerationRunState): string { const json = canonicalEvidenceJson(state); if (Buffer.byteLength(json, 'utf8') > MAX_STATE_BYTES) throw new Error('commercial_generation_state_too_large'); return json; }
function stateHash(state: GenerationRunState): string { return serverEvidenceSha256(state); }
function validState(state: GenerationRunState): boolean { try { return state.schema === 'nexyfab.generation-run.v1' && Number.isSafeInteger(state.revision) && state.revision >= 0 && ID.test(state.runId) && SHA256.test(stateHash(state)) && Buffer.byteLength(canonicalStateJson(state), 'utf8') <= MAX_STATE_BYTES; } catch { return false; } }
function programOf(state: GenerationRunState): string { return state.evidenceBindings?.programSha256 ?? UNBOUND_GENERATION_PROGRAM_SHA256; }
function bindingFromRow(row: Record<string, unknown>, revision: number, stateSha256: string, generationProgramSha256: string): CommercialGenerationRunBinding { return { schema: 'nexyfab.commercial-generation-run-binding.v1', tenantId: String(row.tenant_id), projectId: String(row.project_id), workspaceId: String(row.workspace_id), workspaceRevision: Number(row.workspace_revision), runId: String(row.run_id), revision, programSha256: generationProgramSha256, workspaceHeadSha256: String(row.head_sha256), previousRevision: Number(row.previous_revision), previousHeadSha256: String(row.head_sha256), previousStateSha256: String(row.previous_sha256), stateSha256, generationProgramSha256 }; }

async function auditGenerationChain(db: DbAdapter, tenantId: string, projectId: string, runId: string, lockHead = false): Promise<CommercialGenerationChainAuditResult> {
  if (!ID.test(tenantId) || !ID.test(projectId) || !ID.test(runId)) return { ok: false, code: 'COMMERCIAL_GENERATION_AUDIT_INVALID_ID' };
  const run = await db.queryOne<Record<string, unknown>>(`SELECT tenant_id, project_id, run_id, workspace_revision, head_revision, head_sha256, state_sha256 FROM nf_commercial_generation_runs WHERE tenant_id = ? AND project_id = ? AND run_id = ?${lockHead ? ' FOR UPDATE' : ''}`, tenantId, projectId, runId);
  const headRevision = Number(run?.head_revision);
  if (!run || !Number.isSafeInteger(headRevision) || headRevision < 0 || !SHA256.test(String(run.head_sha256)) || !SHA256.test(String(run.state_sha256))) return { ok: false, code: 'COMMERCIAL_GENERATION_AUDIT_HEAD_INVALID' };
  const stats = await db.queryOne<{ row_count: number | string; total_bytes: number | string; max_bytes: number | string }>('SELECT COUNT(*) AS row_count, COALESCE(SUM(octet_length(state_json)), 0) AS total_bytes, COALESCE(MAX(octet_length(state_json)), 0) AS max_bytes FROM nf_commercial_generation_revisions WHERE tenant_id = ? AND project_id = ? AND run_id = ?', tenantId, projectId, runId);
  const rowCount = Number(stats?.row_count), totalBytes = Number(stats?.total_bytes), maxBytes = Number(stats?.max_bytes);
  if (!stats || !Number.isSafeInteger(rowCount) || rowCount < 1 || rowCount > MAX_CHAIN_ROWS || !Number.isSafeInteger(totalBytes) || totalBytes < 1 || totalBytes > MAX_CHAIN_BYTES || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_STATE_BYTES) return { ok: false, code: 'COMMERCIAL_GENERATION_AUDIT_CHAIN_SIZE_INVALID' };
  const rows = await db.queryAll<Record<string, unknown>>(`SELECT revision, previous_revision, previous_sha256, state_sha256, state_json, generation_program_sha256 FROM nf_commercial_generation_revisions WHERE tenant_id = ? AND project_id = ? AND run_id = ? ORDER BY revision ASC LIMIT ${MAX_CHAIN_ROWS + 1}`, tenantId, projectId, runId);
  if (rows.length !== rowCount || rows.length > MAX_CHAIN_ROWS) return { ok: false, code: 'COMMERCIAL_GENERATION_AUDIT_CHAIN_LENGTH_INVALID' };
  let program = UNBOUND_GENERATION_PROGRAM_SHA256;
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]!; const revision = Number(row.revision); const previousRevision = Number(row.previous_revision); const previousSha = String(row.previous_sha256); const storedStateSha = String(row.state_sha256); const storedProgram = String(row.generation_program_sha256); const json = row.state_json; const prior = rows[index - 1];
    const validLink = index === 0
      ? revision === 0 && previousRevision === -1 && previousSha === UNBOUND_GENERATION_PROGRAM_SHA256
      : Number.isSafeInteger(revision) && revision > Number(prior!.revision) && previousRevision === Number(prior!.revision) && previousSha === String(prior!.state_sha256);
    if (!validLink || !SHA256.test(storedStateSha) || !SHA256.test(storedProgram) || (index === 0 && storedProgram !== UNBOUND_GENERATION_PROGRAM_SHA256) || (index > 0 && storedProgram !== program && program !== UNBOUND_GENERATION_PROGRAM_SHA256)) return { ok: false, code: 'COMMERCIAL_GENERATION_AUDIT_PREVIOUS_LINK_INVALID' };
    if (typeof json !== 'string' || Buffer.byteLength(json, 'utf8') > MAX_STATE_BYTES) return { ok: false, code: 'COMMERCIAL_GENERATION_AUDIT_STATE_BYTES_INVALID' };
    try { const state = JSON.parse(json) as GenerationRunState; if (canonicalStateJson(state) !== json || state.revision !== revision || stateHash(state) !== storedStateSha || programOf(state) !== storedProgram) return { ok: false, code: 'COMMERCIAL_GENERATION_AUDIT_STATE_HASH_INVALID' }; } catch { return { ok: false, code: 'COMMERCIAL_GENERATION_AUDIT_STATE_JSON_INVALID' }; }
    if (storedProgram !== UNBOUND_GENERATION_PROGRAM_SHA256) program = storedProgram;
  }
  const last = rows[rows.length - 1]!; if (headRevision !== Number(last.revision) || String(run.state_sha256) !== String(last.state_sha256)) return { ok: false, code: 'COMMERCIAL_GENERATION_AUDIT_HEAD_MISMATCH' };
  return { ok: true, headRevision, headStateSha256: String(last.state_sha256), workspaceRevision: Number(run.workspace_revision), workspaceHeadSha256: String(run.head_sha256), generationProgramSha256: program, rowCount: rows.length };
}

export function createDbCommercialGenerationStateStore(db: DbAdapter): CommercialGenerationStateStore {
  return {
    async create(binding, state) {
      const computed = validState(state) ? stateHash(state) : '';
      if (validateCommercialGenerationRunBinding(binding).length || !computed || binding.runId !== state.runId || binding.revision !== state.revision || binding.stateSha256 !== computed || binding.previousRevision !== -1 || binding.previousStateSha256 !== UNBOUND_GENERATION_PROGRAM_SHA256 || programOf(state) !== binding.generationProgramSha256) return { ok: false, code: 'COMMERCIAL_GENERATION_BINDING_INVALID' };
      await assertCommercialGenerationMigration(db);
      try { const json = canonicalStateJson(state); await db.transaction(async tx => { await tx.execute('INSERT INTO nf_commercial_generation_runs (tenant_id, project_id, run_id, workspace_id, workspace_revision, head_revision, head_sha256, state_sha256, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', binding.tenantId, binding.projectId, binding.runId, binding.workspaceId, binding.workspaceRevision, state.revision, binding.workspaceHeadSha256, computed, 'ACTIVE', Date.now(), Date.now()); await tx.execute('INSERT INTO nf_commercial_generation_revisions (tenant_id, project_id, run_id, revision, previous_revision, previous_sha256, state_sha256, state_json, generation_program_sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', binding.tenantId, binding.projectId, binding.runId, state.revision, -1, UNBOUND_GENERATION_PROGRAM_SHA256, computed, json, binding.generationProgramSha256, Date.now()); }); return { ok: true }; } catch { return { ok: false, code: 'COMMERCIAL_GENERATION_RUN_CONFLICT' }; }
    },
    async audit(tenantId, projectId, runId) {
      await assertCommercialGenerationMigration(db);
      return auditGenerationChain(db, tenantId, projectId, runId);
    },
    async load(tenantId, projectId, runId) {
      const audit = await this.audit(tenantId, projectId, runId); if (!audit.ok) return undefined;
      const row = await db.queryOne<Record<string, unknown>>('SELECT r.*, v.state_json, v.state_sha256, v.generation_program_sha256, v.previous_revision, v.previous_sha256 FROM nf_commercial_generation_runs r JOIN nf_commercial_generation_revisions v ON v.tenant_id = r.tenant_id AND v.project_id = r.project_id AND v.run_id = r.run_id AND v.revision = r.head_revision WHERE r.tenant_id = ? AND r.project_id = ? AND r.run_id = ?', tenantId, projectId, runId); if (!row || typeof row.state_json !== 'string') return undefined;
      try { const state = JSON.parse(row.state_json) as GenerationRunState; if (canonicalStateJson(state) !== row.state_json || stateHash(state) !== row.state_sha256 || state.revision !== audit.headRevision) return undefined; return { binding: bindingFromRow(row, state.revision, String(row.state_sha256), String(row.generation_program_sha256)), state }; } catch { return undefined; }
    },
    async save(binding, state, expectedRevision) {
      const computed = validState(state) ? stateHash(state) : '';
      if (validateCommercialGenerationRunBinding(binding).length || !computed || binding.stateSha256 !== computed || state.revision <= expectedRevision || binding.previousRevision !== expectedRevision || binding.previousStateSha256 === UNBOUND_GENERATION_PROGRAM_SHA256 || state.runId !== binding.runId || binding.revision !== state.revision || programOf(state) !== binding.generationProgramSha256) return { ok: false, code: 'COMMERCIAL_GENERATION_REVISION_INVALID' };
      await assertCommercialGenerationMigration(db);
      try { const json = canonicalStateJson(state); const result = await db.transaction(async tx => { const current = await tx.queryOne<Record<string, unknown>>('SELECT r.workspace_revision, r.head_revision, r.head_sha256, r.state_sha256, v.generation_program_sha256 FROM nf_commercial_generation_runs r JOIN nf_commercial_generation_revisions v ON v.tenant_id = r.tenant_id AND v.project_id = r.project_id AND v.run_id = r.run_id AND v.revision = r.head_revision WHERE r.tenant_id = ? AND r.project_id = ? AND r.run_id = ?', binding.tenantId, binding.projectId, binding.runId); const previousProgram = String(current?.generation_program_sha256 ?? ''); if (!current || Number(current.workspace_revision) !== binding.workspaceRevision || Number(current.head_revision) !== expectedRevision || String(current.head_sha256) !== binding.previousHeadSha256 || String(current.state_sha256) !== binding.previousStateSha256 || (previousProgram !== UNBOUND_GENERATION_PROGRAM_SHA256 && previousProgram !== binding.generationProgramSha256)) return false; const updated = await tx.execute('UPDATE nf_commercial_generation_runs SET head_revision = ?, head_sha256 = ?, state_sha256 = ?, updated_at = ? WHERE tenant_id = ? AND project_id = ? AND run_id = ? AND workspace_revision = ? AND head_revision = ? AND head_sha256 = ? AND state_sha256 = ?', state.revision, binding.workspaceHeadSha256, computed, Date.now(), binding.tenantId, binding.projectId, binding.runId, binding.workspaceRevision, expectedRevision, binding.previousHeadSha256, binding.previousStateSha256); if (updated.changes !== 1) return false; const inserted = await tx.execute('INSERT INTO nf_commercial_generation_revisions (tenant_id, project_id, run_id, revision, previous_revision, previous_sha256, state_sha256, state_json, generation_program_sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', binding.tenantId, binding.projectId, binding.runId, state.revision, expectedRevision, binding.previousStateSha256, computed, json, binding.generationProgramSha256, Date.now()); return inserted.changes === 1; }); return result ? { ok: true } : { ok: false, code: 'COMMERCIAL_GENERATION_REVISION_CONFLICT' }; } catch { return { ok: false, code: 'COMMERCIAL_GENERATION_REVISION_CONFLICT' }; }
    },
    async bindReceipt(input) {
      if (!ID.test(input.receiptId) || !SHA256.test(input.receiptSha256) || !SHA256.test(input.generationProgramSha256) || input.generationProgramSha256 === UNBOUND_GENERATION_PROGRAM_SHA256 || !SHA256.test(input.targetSha256) || !Number.isSafeInteger(input.generationRevision) || input.generationRevision < 0 || !Number.isSafeInteger(input.workspaceRevision) || input.workspaceRevision < 0) return { ok: false, code: 'RECEIPT_BINDING_INVALID' };
      await assertCommercialGenerationMigration(db);
      try { const bound = await db.transaction(async tx => { const audit = await auditGenerationChain(tx, input.tenantId, input.projectId, input.runId, true); if (!audit.ok || audit.headRevision !== input.generationRevision || audit.workspaceRevision !== input.workspaceRevision || audit.generationProgramSha256 !== input.generationProgramSha256) return false; const existing = await tx.queryOne<Record<string, unknown>>('SELECT receipt_sha256, generation_revision, workspace_revision, generation_program_sha256, target_sha256, status FROM nf_commercial_generation_receipt_bindings WHERE tenant_id = ? AND project_id = ? AND run_id = ? AND receipt_id = ?', input.tenantId, input.projectId, input.runId, input.receiptId); if (existing) return existing.receipt_sha256 === input.receiptSha256 && Number(existing.generation_revision) === input.generationRevision && Number(existing.workspace_revision) === input.workspaceRevision && existing.generation_program_sha256 === input.generationProgramSha256 && existing.target_sha256 === input.targetSha256 && existing.status === input.status; const inserted = await tx.execute('INSERT INTO nf_commercial_generation_receipt_bindings (tenant_id, project_id, run_id, receipt_id, receipt_sha256, generation_revision, workspace_revision, generation_program_sha256, target_sha256, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', input.tenantId, input.projectId, input.runId, input.receiptId, input.receiptSha256, input.generationRevision, input.workspaceRevision, input.generationProgramSha256, input.targetSha256, input.status, Date.now()); return inserted.changes === 1; }); return bound ? { ok: true } : { ok: false, code: 'RECEIPT_BINDING_CONFLICT' }; } catch { return { ok: false, code: 'RECEIPT_BINDING_CONFLICT' }; }
    },
  };
}
