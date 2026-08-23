import { randomUUID } from 'node:crypto';
import type { DbAdapter } from '@/lib/db-adapter';
import {
  hashArchitectureInteriorArtifactBundle,
  validateArchitectureInteriorArtifactBundle,
  type ArchitectureInteriorArtifactBundle,
} from './architectureInteriorArtifactTransaction';

export const ARCHITECTURE_INTERIOR_ARTIFACT_BUNDLE_STORE_SCHEMA = 'nexyfab.architecture-interior-artifact-bundle-store.v1' as const;
export const ARCHITECTURE_INTERIOR_ARTIFACT_BUNDLE_MAX_BYTES = 16 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_JSON_DEPTH = 64;
const MAX_JSON_NODES = 250_000;
const FORBIDDEN_KEY = /(?:password|passphrase|secret|token|api[_-]?key|private[_-]?key|object[_-]?key|(?:^|[_-])path$|(?:^|[_-])url$)/i;
const ABSOLUTE_PATH = /^(?:[a-z]:[\\/]|[\\/]{2}|\/)/i;

export type ArchitectureInteriorArtifactBundleOwner = { tenantId: string; userId: string };
export type ArchitectureInteriorArtifactBundleReadScope = { tenantId: string };
export type ArchitectureInteriorArtifactBundleConflict = {
  ok: false;
  code: 'BUNDLE_REVISION_CONFLICT';
  currentSourceRevision: number;
  currentSourceContentHash: string;
  currentBundleHash: string;
};
export type PersistArchitectureInteriorArtifactBundleResult =
  | { ok: true; revisionId: string; bundle: ArchitectureInteriorArtifactBundle; createdAt: number }
  | { ok: false; code: 'INVALID_BUNDLE' | 'BUNDLE_ALREADY_EXISTS'; issues: string[] }
  | ArchitectureInteriorArtifactBundleConflict;
export type ReadArchitectureInteriorArtifactBundleResult =
  | { ok: true; bundle: ArchitectureInteriorArtifactBundle; revisionId: string; createdAt: number }
  | { ok: false; code: 'NOT_FOUND' | 'CORRUPT_STORED_ROW' };

type HeadRow = { source_revision: number; source_content_hash: string; bundle_hash: string };
type RevisionRow = { id: string; tenant_id: string; project_id: string; source_revision: number; source_content_hash: string; bundle_hash: string; payload_json: string; created_by: string; created_at: number };

export async function ensureArchitectureInteriorArtifactBundleTables(db: DbAdapter): Promise<void> {
  await db.executeRaw(`
    CREATE TABLE IF NOT EXISTS nf_architecture_interior_artifact_bundle_revisions (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      source_revision INTEGER NOT NULL,
      source_content_hash TEXT NOT NULL,
      bundle_hash TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      UNIQUE(tenant_id, project_id, bundle_hash)
    );
    CREATE INDEX IF NOT EXISTS idx_nf_architecture_interior_artifact_bundle_revision
      ON nf_architecture_interior_artifact_bundle_revisions(tenant_id, project_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS nf_architecture_interior_artifact_bundle_heads (
      tenant_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      source_revision INTEGER NOT NULL,
      source_content_hash TEXT NOT NULL,
      bundle_hash TEXT NOT NULL,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY(tenant_id, project_id)
    );
  `);
}

function validIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 256 && !/[\\/]/.test(value) && !ABSOLUTE_PATH.test(value);
}
function validOwner(value: ArchitectureInteriorArtifactBundleOwner | ArchitectureInteriorArtifactBundleReadScope): boolean {
  return validIdentifier(value.tenantId) && (!('userId' in value) || validIdentifier(value.userId));
}
function stableJson(value: unknown): string {
  const ancestors = new Set<object>();
  let nodes = 0;
  const walk = (current: unknown, depth: number): string => {
    if (depth > MAX_JSON_DEPTH) throw new Error('bundle_json_too_deep');
    if (++nodes > MAX_JSON_NODES) throw new Error('bundle_json_too_large');
    if (current === null) return 'null';
    if (typeof current === 'string') { if (ABSOLUTE_PATH.test(current)) throw new Error('bundle_path_forbidden'); return JSON.stringify(current); }
    if (typeof current === 'number') { if (!Number.isFinite(current)) throw new Error('bundle_non_finite_number'); return JSON.stringify(current); }
    if (typeof current === 'boolean') return current ? 'true' : 'false';
    if (Array.isArray(current)) { if (ancestors.has(current)) throw new Error('bundle_json_cycle'); ancestors.add(current); const out = `[${current.map(item => walk(item, depth + 1)).join(',')}]`; ancestors.delete(current); return out; }
    if (typeof current === 'object') {
      const record = current as Record<string, unknown>;
      if (ancestors.has(record)) throw new Error('bundle_json_cycle');
      ancestors.add(record);
      const out = `{${Object.keys(record).filter(key => record[key] !== undefined).sort().map(key => { if (FORBIDDEN_KEY.test(key)) throw new Error('bundle_sensitive_field_forbidden'); return `${JSON.stringify(key)}:${walk(record[key], depth + 1)}`; }).join(',')}}`;
      ancestors.delete(record);
      return out;
    }
    return 'null';
  };
  const json = walk(value, 0);
  if (Buffer.byteLength(json, 'utf8') > ARCHITECTURE_INTERIOR_ARTIFACT_BUNDLE_MAX_BYTES) throw new Error('bundle_json_too_large');
  return json;
}
function conflict(head: HeadRow | undefined): ArchitectureInteriorArtifactBundleConflict {
  return { ok: false, code: 'BUNDLE_REVISION_CONFLICT', currentSourceRevision: Number(head?.source_revision ?? -1), currentSourceContentHash: SHA256.test(String(head?.source_content_hash ?? '')) ? String(head?.source_content_hash) : '', currentBundleHash: SHA256.test(String(head?.bundle_hash ?? '')) ? String(head?.bundle_hash) : '' };
}
async function decodeRow(row: RevisionRow, tenantId: string, projectId: string): Promise<ReadArchitectureInteriorArtifactBundleResult> {
  try {
    if (row.tenant_id !== tenantId || row.project_id !== projectId || !validIdentifier(row.id) || !SHA256.test(row.source_content_hash) || !SHA256.test(row.bundle_hash) || !Number.isSafeInteger(Number(row.source_revision)) || Number(row.source_revision) < 0 || !Number.isSafeInteger(Number(row.created_at)) || Number(row.created_at) < 0) return { ok: false, code: 'CORRUPT_STORED_ROW' };
    const parsed = JSON.parse(row.payload_json) as unknown;
    if (stableJson(parsed) !== row.payload_json || validateArchitectureInteriorArtifactBundle(parsed).length || hashArchitectureInteriorArtifactBundle(parsed as ArchitectureInteriorArtifactBundle) !== row.bundle_hash || (parsed as ArchitectureInteriorArtifactBundle).bundleHash !== row.bundle_hash || (parsed as ArchitectureInteriorArtifactBundle).source.revision !== Number(row.source_revision) || (parsed as ArchitectureInteriorArtifactBundle).source.contentHash !== row.source_content_hash) return { ok: false, code: 'CORRUPT_STORED_ROW' };
    return { ok: true, bundle: parsed as ArchitectureInteriorArtifactBundle, revisionId: row.id, createdAt: Number(row.created_at) };
  } catch { return { ok: false, code: 'CORRUPT_STORED_ROW' }; }
}

/** Stores derived bundles separately from the semantic workspace revision table. */
export async function persistArchitectureInteriorArtifactBundle(
  db: DbAdapter,
  owner: ArchitectureInteriorArtifactBundleOwner,
  projectId: string,
  expectedHeadBundleHash: string | null,
  bundle: ArchitectureInteriorArtifactBundle,
  options: { now?: number } = {},
): Promise<PersistArchitectureInteriorArtifactBundleResult> {
  if (!validOwner(owner) || !validIdentifier(projectId) || (expectedHeadBundleHash !== null && !SHA256.test(expectedHeadBundleHash))) return { ok: false, code: 'INVALID_BUNDLE', issues: ['bundle_scope_invalid'] };
  let payloadJson: string;
  try { payloadJson = stableJson(bundle); } catch (error) { return { ok: false, code: 'INVALID_BUNDLE', issues: [error instanceof Error ? error.message : 'bundle_json_invalid'] }; }
  const issues = validateArchitectureInteriorArtifactBundle(bundle);
  if (bundle.source.projectId !== projectId) issues.push('bundle_project_mismatch');
  if (hashArchitectureInteriorArtifactBundle(bundle) !== bundle.bundleHash) issues.push('bundle_hash_mismatch');
  if (issues.length) return { ok: false, code: 'INVALID_BUNDLE', issues: [...new Set(issues)] };
  const now = options.now ?? Date.now();
  return db.transaction(async tx => {
    const head = await tx.queryOne<HeadRow>('SELECT source_revision, source_content_hash, bundle_hash FROM nf_architecture_interior_artifact_bundle_heads WHERE tenant_id = ? AND project_id = ?', owner.tenantId, projectId);
    if (head && expectedHeadBundleHash !== head.bundle_hash) return conflict(head);
    if (!head && expectedHeadBundleHash !== null) return conflict(head);
    if (head?.bundle_hash === bundle.bundleHash) return { ok: false, code: 'BUNDLE_ALREADY_EXISTS', issues: ['bundle_already_persisted'] };
    if (head) {
      const updated = await tx.execute('UPDATE nf_architecture_interior_artifact_bundle_heads SET source_revision = ?, source_content_hash = ?, bundle_hash = ?, updated_at = ? WHERE tenant_id = ? AND project_id = ? AND bundle_hash = ?', bundle.source.revision, bundle.source.contentHash, bundle.bundleHash, now, owner.tenantId, projectId, expectedHeadBundleHash);
      if (updated.changes !== 1) return conflict(await tx.queryOne<HeadRow>('SELECT source_revision, source_content_hash, bundle_hash FROM nf_architecture_interior_artifact_bundle_heads WHERE tenant_id = ? AND project_id = ?', owner.tenantId, projectId));
    } else {
      const inserted = await tx.execute('INSERT INTO nf_architecture_interior_artifact_bundle_heads (tenant_id, project_id, source_revision, source_content_hash, bundle_hash, updated_at) SELECT ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM nf_architecture_interior_artifact_bundle_heads WHERE tenant_id = ? AND project_id = ?)', owner.tenantId, projectId, bundle.source.revision, bundle.source.contentHash, bundle.bundleHash, now, owner.tenantId, projectId);
      if (inserted.changes !== 1) return conflict(await tx.queryOne<HeadRow>('SELECT source_revision, source_content_hash, bundle_hash FROM nf_architecture_interior_artifact_bundle_heads WHERE tenant_id = ? AND project_id = ?', owner.tenantId, projectId));
    }
    const revisionId = randomUUID();
    // The head CAS is deliberately completed first. Any revision-row failure
    // throws and rolls the head mutation back, leaving no orphan bundle.
    await tx.execute('INSERT INTO nf_architecture_interior_artifact_bundle_revisions (id, tenant_id, project_id, source_revision, source_content_hash, bundle_hash, payload_json, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', revisionId, owner.tenantId, projectId, bundle.source.revision, bundle.source.contentHash, bundle.bundleHash, payloadJson, owner.userId, now);
    return { ok: true, revisionId, bundle: structuredClone(bundle), createdAt: now };
  });
}

export async function readLatestArchitectureInteriorArtifactBundle(db: DbAdapter, scope: ArchitectureInteriorArtifactBundleReadScope, projectId: string): Promise<ReadArchitectureInteriorArtifactBundleResult> {
  if (!validOwner(scope) || !validIdentifier(projectId)) return { ok: false, code: 'NOT_FOUND' };
  const head = await db.queryOne<HeadRow>('SELECT source_revision, source_content_hash, bundle_hash FROM nf_architecture_interior_artifact_bundle_heads WHERE tenant_id = ? AND project_id = ?', scope.tenantId, projectId);
  if (!head) return { ok: false, code: 'NOT_FOUND' };
  if (!Number.isSafeInteger(Number(head.source_revision)) || Number(head.source_revision) < 0 || !SHA256.test(head.source_content_hash) || !SHA256.test(head.bundle_hash)) return { ok: false, code: 'CORRUPT_STORED_ROW' };
  const row = await db.queryOne<RevisionRow>('SELECT id, tenant_id, project_id, source_revision, source_content_hash, bundle_hash, payload_json, created_by, created_at FROM nf_architecture_interior_artifact_bundle_revisions WHERE tenant_id = ? AND project_id = ? AND bundle_hash = ?', scope.tenantId, projectId, head.bundle_hash);
  if (!row) return { ok: false, code: 'CORRUPT_STORED_ROW' };
  const decoded = await decodeRow(row, scope.tenantId, projectId);
  if (!decoded.ok) return decoded;
  if (Number(row.source_revision) !== Number(head.source_revision) || row.source_content_hash !== head.source_content_hash || decoded.bundle.source.revision !== Number(head.source_revision) || decoded.bundle.source.contentHash !== head.source_content_hash || decoded.bundle.bundleHash !== head.bundle_hash) return { ok: false, code: 'CORRUPT_STORED_ROW' };
  return decoded;
}
