import { randomUUID } from 'node:crypto';
import type { DbAdapter } from '@/lib/db-adapter';
import {
  hashArchitectureInteriorWorkspaceV2,
  validateArchitectureInteriorWorkspaceV2,
  type ArchitectureInteriorWorkspaceV2,
} from './architectureInteriorWorkspace';

/**
 * Persistence for the architecture/interior workspace is deliberately separate
 * from nf_cad_workspace_revisions.  The latter is the exact-B-rep release
 * envelope; this table stores the shared concept/exact workspace graph and its
 * two domain documents.
 */
export const ARCHITECTURE_INTERIOR_WORKSPACE_STORE_SCHEMA = 'nexyfab.architecture-interior-workspace-store.v1' as const;
export const ARCHITECTURE_INTERIOR_WORKSPACE_MAX_BYTES = 2 * 1024 * 1024;
export const ARCHITECTURE_INTERIOR_WORKSPACE_MAX_DEPTH = 64;

const SHA256 = /^[a-f0-9]{64}$/;
const FORBIDDEN_KEY = /(?:password|passphrase|secret|token|api[_-]?key|private[_-]?key|object[_-]?key|(?:^|[_-])path$|(?:^|[_-])url$)/i;
const ABSOLUTE_PATH = /^(?:[a-z]:[\\/]|[\\/]{2}|\/)/i;
const IDENTIFIER_PATH = /[\\/]|\.\.(?:[\\/]|$)/;

export type ArchitectureInteriorWorkspaceOwner = {
  tenantId: string;
  userId: string;
};

export type ArchitectureInteriorWorkspaceReadScope = {
  tenantId: string;
};

export type ArchitectureInteriorWorkspaceConflict = {
  ok: false;
  code: 'REVISION_CONFLICT';
  currentRevision: number;
  currentContentHash: string;
  conflictPaths: string[];
};

export type PersistArchitectureInteriorWorkspaceResult =
  | { ok: true; revisionId: string; workspace: ArchitectureInteriorWorkspaceV2; createdAt: number }
  | { ok: false; code: 'INVALID_WORKSPACE'; issues: string[] }
  | ArchitectureInteriorWorkspaceConflict;

export type ReadArchitectureInteriorWorkspaceResult =
  | { ok: true; workspace: ArchitectureInteriorWorkspaceV2; revisionId: string; createdAt: number }
  | { ok: false; code: 'NOT_FOUND' | 'CORRUPT_STORED_ROW' };

type HeadRow = { revision: number; content_hash: string };
type RevisionRow = {
  id: string;
  tenant_id: string;
  project_id: string;
  revision: number;
  content_hash: string;
  payload_json: string;
  created_by: string;
  created_at: number;
};

/** Idempotent DDL usable by both the SQLite and PostgreSQL DbAdapter. */
export async function ensureArchitectureInteriorWorkspaceTables(db: DbAdapter): Promise<void> {
  await db.executeRaw(`
    CREATE TABLE IF NOT EXISTS nf_architecture_interior_workspace_revisions (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      UNIQUE(tenant_id, project_id, revision)
    );
    CREATE INDEX IF NOT EXISTS idx_nf_architecture_interior_workspace_revision
      ON nf_architecture_interior_workspace_revisions(tenant_id, project_id, revision DESC);
    CREATE TABLE IF NOT EXISTS nf_architecture_interior_workspace_heads (
      tenant_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY(tenant_id, project_id)
    );
  `);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

type JsonCheck = { ok: true; json: string; byteLength: number } | { ok: false; code: string };

/** Serialize once while bounding depth and rejecting credentials/storage paths. */
function boundedJson(value: unknown): JsonCheck {
  const ancestors = new Set<object>();
  let nodes = 0;
  const walk = (current: unknown, depth: number): string => {
    if (depth > ARCHITECTURE_INTERIOR_WORKSPACE_MAX_DEPTH) throw new Error('workspace_json_too_deep');
    if (++nodes > 250_000) throw new Error('workspace_json_too_large');
    if (current === null) return 'null';
    if (typeof current === 'string') {
      if (ABSOLUTE_PATH.test(current)) throw new Error('workspace_path_forbidden');
      return JSON.stringify(current);
    }
    if (typeof current === 'boolean') return current ? 'true' : 'false';
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) throw new Error('workspace_non_finite_number');
      return JSON.stringify(current);
    }
    if (Array.isArray(current)) {
      if (ancestors.has(current)) throw new Error('workspace_json_cycle');
      ancestors.add(current);
      const result = `[${current.map(item => walk(item, depth + 1)).join(',')}]`;
      ancestors.delete(current);
      return result;
    }
    if (typeof current === 'object') {
      const record = current as Record<string, unknown>;
      if (ancestors.has(record)) throw new Error('workspace_json_cycle');
      ancestors.add(record);
      const result = `{${Object.keys(record).filter(key => record[key] !== undefined).sort().map(key => {
        if (FORBIDDEN_KEY.test(key)) throw new Error('workspace_sensitive_field_forbidden');
        return `${JSON.stringify(key)}:${walk(record[key], depth + 1)}`;
      }).join(',')}}`;
      ancestors.delete(record);
      return result;
    }
    return 'null';
  };
  try {
    const json = walk(value, 0);
    const byteLength = Buffer.byteLength(json, 'utf8');
    return byteLength <= ARCHITECTURE_INTERIOR_WORKSPACE_MAX_BYTES
      ? { ok: true, json, byteLength }
      : { ok: false, code: 'workspace_json_too_large' };
  } catch (error) {
    return { ok: false, code: error instanceof Error ? error.message : 'workspace_json_invalid' };
  }
}

function validIdentifier(value: unknown): value is string {
  return typeof value === 'string'
    && value.trim().length > 0 && value.length <= 256 && !IDENTIFIER_PATH.test(value) && !ABSOLUTE_PATH.test(value);
}

function validScope(scope: ArchitectureInteriorWorkspaceOwner | ArchitectureInteriorWorkspaceReadScope): boolean {
  return validIdentifier(scope.tenantId)
    && ('userId' in scope ? validIdentifier(scope.userId) : true);
}

function diffPaths(left: unknown, right: unknown, limit = 50): string[] {
  const paths: string[] = [];
  const walk = (a: unknown, b: unknown, path: string) => {
    if (paths.length >= limit || Object.is(a, b)) return;
    if (Array.isArray(a) && Array.isArray(b)) {
      for (let index = 0; index < Math.max(a.length, b.length) && paths.length < limit; index++) walk(a[index], b[index], `${path}[${index}]`);
      return;
    }
    if (isRecord(a) && isRecord(b)) {
      for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) walk(a[key], b[key], path ? `${path}.${key}` : key);
      return;
    }
    paths.push(path || '$');
  };
  walk(left, right, '');
  return paths;
}

function conflictFromRow(row: HeadRow | undefined, revision: ArchitectureInteriorWorkspaceV2 | null): ArchitectureInteriorWorkspaceConflict {
  return {
    ok: false,
    code: 'REVISION_CONFLICT',
    currentRevision: Number(row?.revision ?? -1),
    currentContentHash: SHA256.test(String(row?.content_hash ?? '')) ? String(row?.content_hash) : '',
    conflictPaths: revision ? diffPaths(revision, revision) : [],
  };
}

async function readRevisionRow(row: RevisionRow, expectedTenantId: string, expectedProjectId: string, expectedRevision?: number): Promise<ReadArchitectureInteriorWorkspaceResult> {
  try {
    if (typeof row.id !== 'string' || row.id.trim().length === 0 || row.id.length > 128
      || !Number.isSafeInteger(Number(row.created_at)) || Number(row.created_at) < 0
      || row.tenant_id !== expectedTenantId || row.project_id !== expectedProjectId
      || (expectedRevision !== undefined && Number(row.revision) !== expectedRevision)) return { ok: false, code: 'CORRUPT_STORED_ROW' };
    if (!SHA256.test(row.content_hash) || Buffer.byteLength(row.payload_json, 'utf8') > ARCHITECTURE_INTERIOR_WORKSPACE_MAX_BYTES) return { ok: false, code: 'CORRUPT_STORED_ROW' };
    const parsed = JSON.parse(row.payload_json) as unknown;
    const bounded = boundedJson(parsed);
    if (!bounded.ok || bounded.json !== row.payload_json) return { ok: false, code: 'CORRUPT_STORED_ROW' };
    const workspace = parsed as ArchitectureInteriorWorkspaceV2;
    if (workspace.projectId !== expectedProjectId || workspace.workspace.revision !== Number(row.revision) || workspace.contentHash !== row.content_hash) return { ok: false, code: 'CORRUPT_STORED_ROW' };
    if (hashArchitectureInteriorWorkspaceV2(workspace) !== row.content_hash || validateArchitectureInteriorWorkspaceV2(workspace).length > 0) return { ok: false, code: 'CORRUPT_STORED_ROW' };
    return { ok: true, workspace, revisionId: row.id, createdAt: Number(row.created_at) };
  } catch {
    return { ok: false, code: 'CORRUPT_STORED_ROW' };
  }
}

export async function persistArchitectureInteriorWorkspace(
  db: DbAdapter,
  owner: ArchitectureInteriorWorkspaceOwner,
  projectId: string,
  baseRevision: number,
  workspace: ArchitectureInteriorWorkspaceV2,
  options: { baseContentHash?: string; now?: number; transactionalAdapter?: DbAdapter } = {},
): Promise<PersistArchitectureInteriorWorkspaceResult> {
  const issues: string[] = [];
  if (!validScope(owner)) issues.push('owner_scope_invalid');
  if (!validIdentifier(projectId)) issues.push('project_id_invalid');
  if (!Number.isSafeInteger(baseRevision) || baseRevision < -1) issues.push('invalid_base_revision');
  if (workspace?.projectId !== projectId) issues.push('route_project_mismatch');
  if (workspace?.workspace?.revision !== baseRevision + 1) issues.push('non_sequential_revision');
  if (options.baseContentHash !== undefined && !SHA256.test(options.baseContentHash)) issues.push('invalid_base_content_hash');
  const jsonCheck = boundedJson(workspace);
  if (!jsonCheck.ok) return { ok: false, code: 'INVALID_WORKSPACE', issues: [jsonCheck.code] };
  try {
    issues.push(...validateArchitectureInteriorWorkspaceV2(workspace).map(issue => `workspace:${issue}`));
  } catch {
    issues.push('workspace:workspace_validation_failed');
  }
  if (issues.length) return { ok: false, code: 'INVALID_WORKSPACE', issues: [...new Set(issues)] };
  let contentHash: string;
  try {
    contentHash = hashArchitectureInteriorWorkspaceV2(workspace);
  } catch {
    return { ok: false, code: 'INVALID_WORKSPACE', issues: ['workspace:workspace_hash_invalid'] };
  }
  if (contentHash !== workspace.contentHash || workspace.workspace.contentHash !== contentHash) return { ok: false, code: 'INVALID_WORKSPACE', issues: ['workspace:workspace_content_hash_mismatch'] };
  const payloadJson = jsonCheck.json;
  const now = options.now ?? Date.now();
  const persistOnAdapter = async (tx: DbAdapter): Promise<PersistArchitectureInteriorWorkspaceResult> => {
    const head = await tx.queryOne<HeadRow>(
      'SELECT revision, content_hash FROM nf_architecture_interior_workspace_heads WHERE tenant_id = ? AND project_id = ?',
      owner.tenantId, projectId,
    );
    const actualRevision = Number(head?.revision ?? -1);
    if (actualRevision !== baseRevision || (options.baseContentHash !== undefined && head?.content_hash !== options.baseContentHash)) {
      let previous: ArchitectureInteriorWorkspaceV2 | null = null;
      if (head) {
        const row = await tx.queryOne<RevisionRow>(
          `SELECT id, tenant_id, project_id, revision, content_hash, payload_json, created_by, created_at
           FROM nf_architecture_interior_workspace_revisions WHERE tenant_id = ? AND project_id = ? AND revision = ?`,
          owner.tenantId, projectId, actualRevision,
        );
        if (row) {
          const decoded = await readRevisionRow(row, owner.tenantId, projectId, actualRevision);
          if (decoded.ok) previous = decoded.workspace;
        }
      }
      const conflict = conflictFromRow(head, previous);
      conflict.conflictPaths = previous ? diffPaths(previous, workspace) : [];
      return conflict;
    }

    // Conditional insert/update makes the head mutation the CAS operation. Any
    // subsequent insert failure rolls back the transaction, preserving history.
    if (!head) {
      const inserted = await tx.execute(
        `INSERT INTO nf_architecture_interior_workspace_heads
         (tenant_id, project_id, revision, content_hash, updated_at)
         SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS
         (SELECT 1 FROM nf_architecture_interior_workspace_heads WHERE tenant_id = ? AND project_id = ?)`,
        owner.tenantId, projectId, workspace.workspace.revision, contentHash, now, owner.tenantId, projectId,
      );
      if (inserted.changes !== 1) {
        const raced = await tx.queryOne<HeadRow>(
          'SELECT revision, content_hash FROM nf_architecture_interior_workspace_heads WHERE tenant_id = ? AND project_id = ?',
          owner.tenantId, projectId,
        );
        return conflictFromRow(raced, null);
      }
    } else {
      const updated = await tx.execute(
        `UPDATE nf_architecture_interior_workspace_heads SET revision = ?, content_hash = ?, updated_at = ?
         WHERE tenant_id = ? AND project_id = ? AND revision = ? AND content_hash = ?`,
        workspace.workspace.revision, contentHash, now, owner.tenantId, projectId, baseRevision, head.content_hash,
      );
      if (updated.changes !== 1) return conflictFromRow(await tx.queryOne<HeadRow>('SELECT revision, content_hash FROM nf_architecture_interior_workspace_heads WHERE tenant_id = ? AND project_id = ?', owner.tenantId, projectId), null);
    }
    const revisionId = randomUUID();
    await tx.execute(
      `INSERT INTO nf_architecture_interior_workspace_revisions
       (id, tenant_id, project_id, revision, content_hash, payload_json, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      revisionId, owner.tenantId, projectId, workspace.workspace.revision, contentHash, payloadJson, owner.userId, now,
    );
    return { ok: true, revisionId, workspace: structuredClone(workspace), createdAt: now };
  };
  return options.transactionalAdapter ? persistOnAdapter(options.transactionalAdapter) : db.transaction(persistOnAdapter);
}

export async function readArchitectureInteriorWorkspace(
  db: DbAdapter,
  scope: ArchitectureInteriorWorkspaceReadScope,
  projectId: string,
  revision?: number,
): Promise<ReadArchitectureInteriorWorkspaceResult> {
  if (!validScope(scope) || !validIdentifier(projectId) || (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 0))) return { ok: false, code: 'NOT_FOUND' };
  let row: RevisionRow | undefined;
  if (revision === undefined) {
    const head = await db.queryOne<HeadRow>('SELECT revision, content_hash FROM nf_architecture_interior_workspace_heads WHERE tenant_id = ? AND project_id = ?', scope.tenantId, projectId);
    if (!head) return { ok: false, code: 'NOT_FOUND' };
    row = await db.queryOne<RevisionRow>(
      `SELECT id, tenant_id, project_id, revision, content_hash, payload_json, created_by, created_at
       FROM nf_architecture_interior_workspace_revisions WHERE tenant_id = ? AND project_id = ? AND revision = ?`,
      scope.tenantId, projectId, Number(head.revision),
    );
    if (!row || row.content_hash !== head.content_hash) return { ok: false, code: 'CORRUPT_STORED_ROW' };
  } else {
    row = await db.queryOne<RevisionRow>(
      `SELECT id, tenant_id, project_id, revision, content_hash, payload_json, created_by, created_at
       FROM nf_architecture_interior_workspace_revisions WHERE tenant_id = ? AND project_id = ? AND revision = ?`,
      scope.tenantId, projectId, revision,
    );
  }
  return row ? readRevisionRow(row, scope.tenantId, projectId, revision) : { ok: false, code: 'NOT_FOUND' };
}
