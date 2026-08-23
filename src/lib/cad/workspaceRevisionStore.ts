import { createHash, randomUUID } from 'node:crypto';
import type { DbAdapter } from '@/lib/db-adapter';
import type { DesignArtifactGraph } from '@/lib/ai/designArtifactGraph';
import { validateDesignArtifactGraph } from '@/lib/ai/designArtifactGraph';
import type { DesignWorkspaceRevision } from '@/lib/ai/designWorkspaceRevision';
import { validateDesignWorkspaceRevision } from '@/lib/ai/designWorkspaceRevision';
import { getDomainProfile } from '@/lib/ai/domainProfileRegistry';
import { invalidateManufacturingLineageForRevision } from '@/lib/manufacturingLineageDb';

export const CAD_WORKSPACE_ENVELOPE_SCHEMA = 'nexyfab.cad-workspace-envelope.v1' as const;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_ENVELOPE_BYTES = 2 * 1024 * 1024;
const MAX_ENVELOPE_DEPTH = 64;

export interface CadWorkspaceEnvelopeInput {
  schema: typeof CAD_WORKSPACE_ENVELOPE_SCHEMA;
  workspace: DesignWorkspaceRevision;
  requirements: { contentHash: string; payload: unknown };
  semanticDocument: { schema: string; contentHash: string; payload: unknown };
  geometry: { fidelity: 'exact_brep'; contentHash: string; shapeIdentityHash: string };
  objectRelations: { contentHash: string; payload: unknown };
  artifactGraph: DesignArtifactGraph;
  provenance: Array<{ sourceId: string; kind: 'user' | 'ai' | 'import' | 'catalog' | 'expert'; contentHash: string }>;
  kernelIdentity: {
    mode: 'wasm';
    kernelId: string;
    buildSha256: string;
    wasmSha256: string;
    stubFallback: false;
  };
}

export interface StoredCadWorkspaceEnvelope extends CadWorkspaceEnvelopeInput {
  contentHash: string;
}

export interface CadWorkspaceRevisionSummary {
  artifactId: string;
  revision: number;
  domain: DesignWorkspaceRevision['domain'];
  lineageId: string;
  envelopeContentHash: string;
  geometryContentHash: string;
  shapeIdentityHash: string;
  kernelId: string;
  createdAt: number;
}

export type PersistCadWorkspaceResult =
  | { ok: true; revisionId: string; envelope: StoredCadWorkspaceEnvelope; invalidatedLineageIds: string[] }
  | { ok: false; code: 'INVALID_ENVELOPE'; issues: string[] }
  | { ok: false; code: 'REVISION_CONFLICT'; currentRevision: number; currentContentHash: string; conflictPaths: string[] };

function canonical(value: unknown, depth = 0, ancestors = new Set<object>()): string {
  if (depth > MAX_ENVELOPE_DEPTH) throw new Error('envelope_nesting_too_deep');
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null';
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new Error('envelope_cycle');
    const next = new Set(ancestors).add(value);
    return `[${value.map(item => canonical(item, depth + 1, next)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (ancestors.has(record)) throw new Error('envelope_cycle');
    const next = new Set(ancestors).add(record);
    return `{${Object.keys(record).filter(key => record[key] !== undefined).sort()
      .map(key => `${JSON.stringify(key)}:${canonical(record[key], depth + 1, next)}`).join(',')}}`;
  }
  return 'null';
}

export function hashCadWorkspaceEnvelope(input: CadWorkspaceEnvelopeInput): string {
  return createHash('sha256').update(canonical(input)).digest('hex');
}

export function hashCadPayload(payload: unknown): string {
  return createHash('sha256').update(canonical(payload)).digest('hex');
}

function payloadHashMatches(contentHash: string, payload: unknown): boolean {
  try { return contentHash === hashCadPayload(payload); } catch { return false; }
}

export function validateCadWorkspaceEnvelope(input: CadWorkspaceEnvelopeInput): string[] {
  const issues: string[] = [];
  if (!input || input.schema !== CAD_WORKSPACE_ENVELOPE_SCHEMA) return ['invalid_envelope_schema'];
  issues.push(...validateDesignWorkspaceRevision(input.workspace).map(issue => `workspace:${issue}`));
  issues.push(...validateDesignArtifactGraph(input.artifactGraph).map(issue => `artifact_graph:${issue}`));
  if (input.workspace.projectId !== input.artifactGraph.projectId) issues.push('project_binding_mismatch');
  if (input.workspace.revision !== input.artifactGraph.revision) issues.push('workspace_artifact_revision_mismatch');
  if (!SHA256.test(input.requirements?.contentHash ?? '')) issues.push('invalid_requirements_hash');
  else if (!payloadHashMatches(input.requirements.contentHash, input.requirements.payload)) issues.push('requirements_payload_hash_mismatch');
  if (!input.semanticDocument?.schema?.trim() || !SHA256.test(input.semanticDocument?.contentHash ?? '')) issues.push('invalid_semantic_document');
  else {
    if (!getDomainProfile(input.workspace.domain).documentSchemas.includes(input.semanticDocument.schema)) issues.push('domain_semantic_schema_mismatch');
    if (!payloadHashMatches(input.semanticDocument.contentHash, input.semanticDocument.payload)) issues.push('semantic_payload_hash_mismatch');
  }
  if (input.workspace.documentHash !== input.semanticDocument?.contentHash) issues.push('workspace_document_hash_mismatch');
  if (input.geometry?.fidelity !== 'exact_brep'
    || !SHA256.test(input.geometry?.contentHash ?? '')
    || !SHA256.test(input.geometry?.shapeIdentityHash ?? '')) issues.push('invalid_exact_geometry');
  if (!SHA256.test(input.objectRelations?.contentHash ?? '')) issues.push('invalid_relation_hash');
  else if (!payloadHashMatches(input.objectRelations.contentHash, input.objectRelations.payload)) issues.push('relations_payload_hash_mismatch');
  const model = input.artifactGraph?.artifacts?.find(artifact => artifact.kind === 'model');
  if (!model || model.contentHash !== input.geometry?.contentHash) issues.push('model_geometry_hash_mismatch');
  if (!Array.isArray(input.provenance) || input.provenance.length === 0
    || input.provenance.some(item => !item.sourceId?.trim() || !SHA256.test(item.contentHash))) issues.push('invalid_provenance');
  if (input.kernelIdentity?.mode !== 'wasm' || input.kernelIdentity?.stubFallback !== false
    || !input.kernelIdentity?.kernelId?.trim()
    || !SHA256.test(input.kernelIdentity?.buildSha256 ?? '')
    || !SHA256.test(input.kernelIdentity?.wasmSha256 ?? '')) issues.push('invalid_real_kernel_identity');
  try {
    const bytes = Buffer.byteLength(canonical(input), 'utf8');
    if (bytes > MAX_ENVELOPE_BYTES) issues.push('envelope_too_large');
  } catch (error) {
    issues.push(error instanceof Error ? error.message : 'invalid_envelope_structure');
  }
  return [...new Set(issues)];
}

export function diffCadWorkspacePaths(left: unknown, right: unknown, limit = 100): string[] {
  const paths: string[] = [];
  const walk = (a: unknown, b: unknown, path: string) => {
    if (paths.length >= limit || Object.is(a, b)) return;
    if (Array.isArray(a) && Array.isArray(b)) {
      const length = Math.max(a.length, b.length);
      for (let index = 0; index < length && paths.length < limit; index++) walk(a[index], b[index], `${path}[${index}]`);
      return;
    }
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
      for (const key of keys) walk((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], path ? `${path}.${key}` : key);
      return;
    }
    paths.push(path || '$');
  };
  walk(left, right, '');
  return paths;
}

export async function ensureCadWorkspaceRevisionTables(db: DbAdapter): Promise<void> {
  await db.executeRaw(`
    CREATE TABLE IF NOT EXISTS nf_cad_workspace_revisions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      lineage_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      parent_revision INTEGER,
      domain TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      UNIQUE(project_id, revision)
    );
    CREATE INDEX IF NOT EXISTS idx_nf_cad_revision_project ON nf_cad_workspace_revisions(project_id, revision DESC);
    CREATE TABLE IF NOT EXISTS nf_cad_workspace_heads (
      project_id TEXT PRIMARY KEY,
      revision INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      updated_at BIGINT NOT NULL
    );
  `);
}

type HeadRow = { revision: number; content_hash: string };
type PayloadRow = HeadRow & { payload_json: string };

export type AuthoritativeWorkspaceHead = { projectId: string; revision: number; contentHash: string };

/** Read-only head access for commercial persistence. It deliberately performs no DDL. */
export async function readAuthoritativeWorkspaceHead(db: DbAdapter, projectId: string): Promise<AuthoritativeWorkspaceHead | null> {
  if (!projectId.trim()) return null;
  const row = await db.queryOne<HeadRow>('SELECT revision, content_hash FROM nf_cad_workspace_heads WHERE project_id = ?', projectId);
  return row ? { projectId, revision: Number(row.revision), contentHash: String(row.content_hash) } : null;
}

/** Compare-and-swap only; callers must provide the already verified old head. */
export async function compareAndSwapAuthoritativeWorkspaceHead(db: DbAdapter, input: { projectId: string; expectedRevision: number; expectedContentHash: string; nextRevision: number; nextContentHash: string; at: number }): Promise<boolean> {
  if (!input.projectId.trim() || !Number.isSafeInteger(input.expectedRevision) || !Number.isSafeInteger(input.nextRevision) || input.nextRevision <= input.expectedRevision || !SHA256.test(input.expectedContentHash) || !SHA256.test(input.nextContentHash)) return false;
  const result = await db.execute('UPDATE nf_cad_workspace_heads SET revision = ?, content_hash = ?, updated_at = ? WHERE project_id = ? AND revision = ? AND content_hash = ?', input.nextRevision, input.nextContentHash, input.at, input.projectId, input.expectedRevision, input.expectedContentHash);
  return result.changes === 1;
}

export async function persistCadWorkspaceRevision(
  db: DbAdapter,
  userId: string,
  projectId: string,
  baseRevision: number,
  input: CadWorkspaceEnvelopeInput,
): Promise<PersistCadWorkspaceResult> {
  const issues = validateCadWorkspaceEnvelope(input);
  if (input.workspace.projectId !== projectId) issues.push('route_project_mismatch');
  if (!Number.isSafeInteger(baseRevision) || baseRevision < -1) issues.push('invalid_base_revision');
  if (input.workspace.revision !== baseRevision + 1) issues.push('non_sequential_revision');
  if (issues.length) return { ok: false, code: 'INVALID_ENVELOPE', issues: [...new Set(issues)] };

  const envelope: StoredCadWorkspaceEnvelope = { ...structuredClone(input), contentHash: hashCadWorkspaceEnvelope(input) };
  return db.transaction(async tx => {
    const head = await tx.queryOne<HeadRow>('SELECT revision, content_hash FROM nf_cad_workspace_heads WHERE project_id = ?', projectId);
    const actualRevision = head?.revision ?? -1;
    if (actualRevision !== baseRevision) {
      const current = await tx.queryOne<PayloadRow>(
        'SELECT revision, content_hash, payload_json FROM nf_cad_workspace_revisions WHERE project_id = ? ORDER BY revision DESC LIMIT 1',
        projectId,
      );
      return {
        ok: false,
        code: 'REVISION_CONFLICT',
        currentRevision: actualRevision,
        currentContentHash: head?.content_hash ?? '',
        conflictPaths: current ? diffCadWorkspacePaths(JSON.parse(current.payload_json), envelope) : [],
      };
    }

    const revisionId = randomUUID();
    const now = Date.now();
    await tx.execute(
      `INSERT INTO nf_cad_workspace_revisions
       (id, project_id, lineage_id, revision, parent_revision, domain, content_hash, payload_json, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      revisionId, projectId, input.workspace.lineageId, input.workspace.revision,
      baseRevision >= 0 ? baseRevision : null, input.workspace.domain, envelope.contentHash,
      JSON.stringify(envelope), userId, now,
    );
    if (!head) {
      await tx.execute(
        'INSERT INTO nf_cad_workspace_heads (project_id, revision, content_hash, updated_at) VALUES (?, ?, ?, ?)',
        projectId, input.workspace.revision, envelope.contentHash, now,
      );
    } else {
      const updated = await tx.execute(
        'UPDATE nf_cad_workspace_heads SET revision = ?, content_hash = ?, updated_at = ? WHERE project_id = ? AND revision = ?',
        input.workspace.revision, envelope.contentHash, now, projectId, baseRevision,
      );
      if (updated.changes !== 1) throw new Error('cad_workspace_head_compare_and_swap_failed');
    }
    const invalidatedLineageIds = await invalidateManufacturingLineageForRevision(tx, projectId, revisionId, now);
    return { ok: true, revisionId, envelope, invalidatedLineageIds };
  });
}

export async function readCadWorkspaceRevision(
  db: DbAdapter,
  projectId: string,
  revision?: number,
): Promise<StoredCadWorkspaceEnvelope | null> {
  const row = revision === undefined
    ? await db.queryOne<{ payload_json: string }>('SELECT payload_json FROM nf_cad_workspace_revisions WHERE project_id = ? ORDER BY revision DESC LIMIT 1', projectId)
    : await db.queryOne<{ payload_json: string }>('SELECT payload_json FROM nf_cad_workspace_revisions WHERE project_id = ? AND revision = ?', projectId, revision);
  return row ? JSON.parse(row.payload_json) as StoredCadWorkspaceEnvelope : null;
}

export async function listCadWorkspaceRevisions(
  db: DbAdapter,
  projectId: string,
  limit = 50,
): Promise<CadWorkspaceRevisionSummary[]> {
  const boundedLimit = Number.isSafeInteger(limit) ? Math.min(100, Math.max(1, limit)) : 50;
  const rows = await db.queryAll<{ id: string; revision: number; domain: DesignWorkspaceRevision['domain']; content_hash: string; payload_json: string; created_at: number }>(
    `SELECT id, revision, domain, content_hash, payload_json, created_at
     FROM nf_cad_workspace_revisions WHERE project_id = ? ORDER BY revision DESC LIMIT ?`,
    projectId, boundedLimit,
  );
  return rows.flatMap(row => {
    try {
      const stored = JSON.parse(row.payload_json) as StoredCadWorkspaceEnvelope;
      const { contentHash, ...input } = stored;
      if (contentHash !== row.content_hash || contentHash !== hashCadWorkspaceEnvelope(input as CadWorkspaceEnvelopeInput)) return [];
      if (validateCadWorkspaceEnvelope(input as CadWorkspaceEnvelopeInput).length) return [];
      if (stored.workspace.projectId !== projectId || stored.workspace.revision !== Number(row.revision) || stored.workspace.domain !== row.domain) return [];
      return [{
        artifactId: row.id,
        revision: Number(row.revision),
        domain: row.domain,
        lineageId: stored.workspace.lineageId,
        envelopeContentHash: contentHash,
        geometryContentHash: stored.geometry.contentHash,
        shapeIdentityHash: stored.geometry.shapeIdentityHash,
        kernelId: stored.kernelIdentity.kernelId,
        createdAt: Number(row.created_at),
      }];
    } catch { return []; }
  });
}
