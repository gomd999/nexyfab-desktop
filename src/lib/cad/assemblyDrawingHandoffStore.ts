import { createHash, randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import type { DbAdapter } from '@/lib/db-adapter';
import {
  serializeAssemblyDrawingHandoff,
  validateAssemblyDrawingHandoff,
  type AssemblyDrawingHandoff,
} from '@/app/[lang]/shape-generator/assembly/drawingHandoff';

export const ASSEMBLY_DRAWING_HANDOFF_MAX_BYTES = 8 * 1024 * 1024;
export const ASSEMBLY_DRAWING_HANDOFF_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SHA256 = /^[a-f0-9]{64}$/;
const SERVER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type StoredAssemblyDrawingHandoff = {
  handoffId: string;
  projectId: string;
  tenantId: string;
  sourceRevision: number;
  sourceContentSha256: string;
  payloadSha256: string;
  byteLength: number;
  createdAt: number;
  expiresAt: number;
  handoff: AssemblyDrawingHandoff;
};

export type PersistAssemblyDrawingHandoffResult =
  | { ok: true; stored: StoredAssemblyDrawingHandoff; idempotent: boolean }
  | { ok: false; code: 'INVALID_HANDOFF'; issues: string[] }
  | { ok: false; code: 'HANDOFF_TOO_LARGE'; byteLength: number; maxBytes: number }
  | { ok: false; code: 'REVISION_CONFLICT'; currentRevision: number; currentContentSha256: string };

type HandoffRow = {
  id: string;
  project_id: string;
  tenant_id: string;
  source_revision: number;
  source_content_sha256: string;
  payload_sha256: string;
  payload_json: string;
  byte_length: number;
  created_at: number;
  expires_at: number;
};

export function isAssemblyDrawingHandoffStorageConfigured(
  env: Partial<Record<string, string | undefined>> = process.env,
): boolean {
  if (env.DATABASE_URL?.trim()) return true;
  const dbPath = env.NEXYFAB_DB_PATH?.trim();
  const dataRoot = env.DATA_ROOT?.trim();
  return Boolean((dbPath && isAbsolute(dbPath)) || (dataRoot && isAbsolute(dataRoot)));
}

export function isServerAssemblyDrawingHandoffId(value: string): boolean {
  return SERVER_ID.test(value);
}

export async function ensureAssemblyDrawingHandoffTable(db: DbAdapter): Promise<void> {
  await db.executeRaw(`
    CREATE TABLE IF NOT EXISTS nf_assembly_drawing_handoffs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      source_revision INTEGER NOT NULL,
      source_content_sha256 TEXT NOT NULL,
      payload_sha256 TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      byte_length BIGINT NOT NULL,
      created_by TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL,
      immutability_state TEXT NOT NULL,
      UNIQUE(project_id, source_revision, payload_sha256)
    );
    CREATE INDEX IF NOT EXISTS idx_nf_assembly_drawing_handoff_lookup
      ON nf_assembly_drawing_handoffs(project_id, tenant_id, id);
    CREATE INDEX IF NOT EXISTS idx_nf_assembly_drawing_handoff_expiry
      ON nf_assembly_drawing_handoffs(expires_at);
  `);
}

function sha256Utf8(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

async function decodeRow(row: HandoffRow): Promise<StoredAssemblyDrawingHandoff | null> {
  try {
    const byteLength = Buffer.byteLength(row.payload_json, 'utf8');
    if (
      !SHA256.test(row.payload_sha256)
      || !SHA256.test(row.source_content_sha256)
      || byteLength !== Number(row.byte_length)
      || sha256Utf8(row.payload_json) !== row.payload_sha256
    ) return null;
    const validated = await validateAssemblyDrawingHandoff(
      JSON.parse(row.payload_json) as AssemblyDrawingHandoff,
    );
    if (!validated.ok) return null;
    if (
      validated.handoff.source.projectId !== row.project_id
      || validated.handoff.source.workspaceRevision !== Number(row.source_revision)
      || validated.handoff.source.workspaceContentSha256 !== row.source_content_sha256
    ) return null;
    return {
      handoffId: row.id,
      projectId: row.project_id,
      tenantId: row.tenant_id,
      sourceRevision: Number(row.source_revision),
      sourceContentSha256: row.source_content_sha256,
      payloadSha256: row.payload_sha256,
      byteLength,
      createdAt: Number(row.created_at),
      expiresAt: Number(row.expires_at),
      handoff: validated.handoff,
    };
  } catch {
    return null;
  }
}

export async function persistAssemblyDrawingHandoff(
  db: DbAdapter,
  input: {
    projectId: string;
    tenantId: string;
    userId: string;
    expectedRevision: number;
    expectedContentSha256: string;
    handoff: AssemblyDrawingHandoff;
    now?: number;
  },
): Promise<PersistAssemblyDrawingHandoffResult> {
  const issues: string[] = [];
  if (!input.projectId.trim()) issues.push('project_id_required');
  if (!input.tenantId.trim()) issues.push('tenant_id_required');
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) issues.push('invalid_expected_revision');
  if (!SHA256.test(input.expectedContentSha256)) issues.push('invalid_expected_content_sha256');
  const validation = await validateAssemblyDrawingHandoff(input.handoff);
  if (!validation.ok) issues.push(validation.reason);
  if (input.handoff?.source?.projectId !== input.projectId) issues.push('route_project_mismatch');
  if (input.handoff?.source?.workspaceRevision !== input.expectedRevision) issues.push('source_revision_mismatch');
  if (input.handoff?.source?.workspaceContentSha256 !== input.expectedContentSha256) issues.push('source_content_hash_mismatch');
  if (issues.length) return { ok: false, code: 'INVALID_HANDOFF', issues: [...new Set(issues)] };

  const payloadJson = serializeAssemblyDrawingHandoff(input.handoff);
  const byteLength = Buffer.byteLength(payloadJson, 'utf8');
  if (byteLength > ASSEMBLY_DRAWING_HANDOFF_MAX_BYTES) {
    return { ok: false, code: 'HANDOFF_TOO_LARGE', byteLength, maxBytes: ASSEMBLY_DRAWING_HANDOFF_MAX_BYTES };
  }
  const payloadSha256 = sha256Utf8(payloadJson);
  const now = input.now ?? Date.now();

  return db.transaction(async tx => {
    const head = await tx.queryOne<{ revision: number; content_hash: string }>(
      'SELECT revision, content_hash FROM nf_cad_workspace_heads WHERE project_id = ?',
      input.projectId,
    );
    const currentRevision = Number(head?.revision ?? -1);
    const currentContentSha256 = head?.content_hash ?? '';
    if (currentRevision !== input.expectedRevision || currentContentSha256 !== input.expectedContentSha256) {
      return { ok: false, code: 'REVISION_CONFLICT', currentRevision, currentContentSha256 };
    }

    const existing = await tx.queryOne<HandoffRow>(
      `SELECT id, project_id, tenant_id, source_revision, source_content_sha256,
              payload_sha256, payload_json, byte_length, created_at, expires_at
       FROM nf_assembly_drawing_handoffs
       WHERE project_id = ? AND tenant_id = ? AND source_revision = ? AND payload_sha256 = ?`,
      input.projectId, input.tenantId, input.expectedRevision, payloadSha256,
    );
    if (existing && Number(existing.expires_at) > now) {
      const stored = await decodeRow(existing);
      if (!stored) throw new Error('assembly_drawing_handoff_immutable_bytes_invalid');
      return { ok: true, stored, idempotent: true };
    }
    if (existing) {
      await tx.execute(
        'DELETE FROM nf_assembly_drawing_handoffs WHERE id = ? AND expires_at <= ?',
        existing.id, now,
      );
    }

    const id = randomUUID();
    const expiresAt = now + ASSEMBLY_DRAWING_HANDOFF_TTL_MS;
    const inserted = await tx.execute(
      `INSERT OR IGNORE INTO nf_assembly_drawing_handoffs
       (id, project_id, tenant_id, source_revision, source_content_sha256, payload_sha256,
        payload_json, byte_length, created_by, created_at, expires_at, immutability_state)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, input.projectId, input.tenantId, input.expectedRevision, input.expectedContentSha256,
      payloadSha256, payloadJson, byteLength, input.userId, now, expiresAt, 'IMMUTABLE',
    );
    if (inserted.changes !== 1) {
      const raced = await tx.queryOne<HandoffRow>(
        `SELECT id, project_id, tenant_id, source_revision, source_content_sha256,
                payload_sha256, payload_json, byte_length, created_at, expires_at
         FROM nf_assembly_drawing_handoffs
         WHERE project_id = ? AND tenant_id = ? AND source_revision = ? AND payload_sha256 = ?`,
        input.projectId, input.tenantId, input.expectedRevision, payloadSha256,
      );
      const stored = raced && Number(raced.expires_at) > now ? await decodeRow(raced) : null;
      if (!stored) throw new Error('assembly_drawing_handoff_immutable_insert_conflict');
      return { ok: true, stored, idempotent: true };
    }
    return {
      ok: true,
      idempotent: false,
      stored: {
        handoffId: id,
        projectId: input.projectId,
        tenantId: input.tenantId,
        sourceRevision: input.expectedRevision,
        sourceContentSha256: input.expectedContentSha256,
        payloadSha256,
        byteLength,
        createdAt: now,
        expiresAt,
        handoff: validation.ok ? validation.handoff : input.handoff,
      },
    };
  });
}

export type ReadStoredAssemblyDrawingHandoffResult =
  | { ok: true; stored: StoredAssemblyDrawingHandoff }
  | { ok: false; code: 'NOT_FOUND' | 'EXPIRED' | 'STORED_HANDOFF_INVALID' };

export async function readStoredAssemblyDrawingHandoff(
  db: DbAdapter,
  input: { handoffId: string; projectId: string; tenantId: string; now?: number },
): Promise<ReadStoredAssemblyDrawingHandoffResult> {
  if (!isServerAssemblyDrawingHandoffId(input.handoffId)) return { ok: false, code: 'NOT_FOUND' };
  const row = await db.queryOne<HandoffRow>(
    `SELECT id, project_id, tenant_id, source_revision, source_content_sha256,
            payload_sha256, payload_json, byte_length, created_at, expires_at
     FROM nf_assembly_drawing_handoffs WHERE id = ? AND project_id = ? AND tenant_id = ?`,
    input.handoffId, input.projectId, input.tenantId,
  );
  if (!row) return { ok: false, code: 'NOT_FOUND' };
  if (Number(row.expires_at) <= (input.now ?? Date.now())) return { ok: false, code: 'EXPIRED' };
  const stored = await decodeRow(row);
  return stored ? { ok: true, stored } : { ok: false, code: 'STORED_HANDOFF_INVALID' };
}

export async function cleanupExpiredAssemblyDrawingHandoffs(
  db: DbAdapter,
  now = Date.now(),
  limit = 100,
): Promise<number> {
  const bounded = Number.isSafeInteger(limit) ? Math.min(500, Math.max(1, limit)) : 100;
  const rows = await db.queryAll<{ id: string }>(
    'SELECT id FROM nf_assembly_drawing_handoffs WHERE expires_at <= ? ORDER BY expires_at ASC LIMIT ?',
    now, bounded,
  );
  let removed = 0;
  for (const row of rows) {
    const result = await db.execute(
      'DELETE FROM nf_assembly_drawing_handoffs WHERE id = ? AND expires_at <= ?',
      row.id, now,
    );
    removed += result.changes;
  }
  return removed;
}

export async function countExpiredAssemblyDrawingHandoffs(
  db: DbAdapter,
  now = Date.now(),
): Promise<number> {
  const row = await db.queryOne<{ count: number }>(
    'SELECT COUNT(*) AS count FROM nf_assembly_drawing_handoffs WHERE expires_at <= ?',
    now,
  );
  const count = Number(row?.count ?? 0);
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}
