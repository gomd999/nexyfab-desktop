import {
  createAiDesignComplexWorkspaceAggregate,
  validateAiDesignComplexWorkspaceAggregate,
  type AiDesignComplexWorkspaceAggregateV1,
} from './aiDesignComplexWorkspaceAggregate';
import { getDbAdapter, type DbAdapter } from '@/lib/db-adapter';
import { aiDesignOwnerKeySha256, assertAiDesignPostgresAuthority } from './aiDesignPostgresAuthority';

export interface AiDesignComplexWorkspaceStore {
  loadOrCreate(input: { ownerKey: string; projectId: string; sessionId: string; runtimeRevision: number; now?: string }): Promise<AiDesignComplexWorkspaceAggregateV1>;
  save(ownerKey: string, aggregate: AiDesignComplexWorkspaceAggregateV1, expectedComplexRevision: number): Promise<AiDesignComplexWorkspaceAggregateV1>;
  reset(): void;
}

function clone<T>(value: T): T { return structuredClone(value); }
function key(ownerKey: string, projectId: string, sessionId: string): string { return `${ownerKey}\0${projectId}\0${sessionId}`; }

/** Reference-only store. Commercial mode requires integration-owned PostgreSQL CAS. */
export class InMemoryAiDesignComplexWorkspaceStore implements AiDesignComplexWorkspaceStore {
  private readonly values = new Map<string, AiDesignComplexWorkspaceAggregateV1>();

  constructor(private readonly mode: 'reference' | 'commercial' = 'reference') {}

  private ensure(): void {
    if (this.mode === 'commercial' || process.env.NEXYFAB_COMMERCIAL_MODE === '1') throw new Error('AI_DESIGN_COMPLEX_POSTGRES_AUTHORITATIVE_REQUIRED');
  }

  async loadOrCreate(input: { ownerKey: string; projectId: string; sessionId: string; runtimeRevision: number; now?: string }): Promise<AiDesignComplexWorkspaceAggregateV1> {
    this.ensure();
    const storageKey = key(input.ownerKey, input.projectId, input.sessionId);
    const existing = this.values.get(storageKey);
    if (existing) return clone(existing);
    const created = createAiDesignComplexWorkspaceAggregate(input);
    this.values.set(storageKey, created);
    return clone(created);
  }

  async save(ownerKey: string, aggregate: AiDesignComplexWorkspaceAggregateV1, expectedComplexRevision: number): Promise<AiDesignComplexWorkspaceAggregateV1> {
    this.ensure();
    const issues = validateAiDesignComplexWorkspaceAggregate(aggregate);
    if (issues.length) throw new Error(`AI_DESIGN_COMPLEX_AGGREGATE_INVALID:${issues.join(',')}`);
    if (aggregate.complexRevision !== expectedComplexRevision + 1) throw new Error('AI_DESIGN_COMPLEX_REVISION_TRANSITION_INVALID');
    const storageKey = key(ownerKey, aggregate.projectId, aggregate.sessionId);
    const current = this.values.get(storageKey);
    if (!current) throw new Error('AI_DESIGN_COMPLEX_WORKSPACE_NOT_FOUND');
    if (current.complexRevision !== expectedComplexRevision) throw new Error('AI_DESIGN_COMPLEX_REVISION_CONFLICT');
    this.values.set(storageKey, clone(aggregate));
    return clone(aggregate);
  }

  reset(): void { this.values.clear(); }
}

type ComplexRow = {
  owner_key_sha256: string;
  project_id: string;
  session_id: string;
  complex_revision: number;
  aggregate_digest: string;
  aggregate_json: string;
  created_at: number;
  updated_at: number;
};

function parseRow(row: ComplexRow | undefined, ownerKey: string): AiDesignComplexWorkspaceAggregateV1 | null {
  if (!row || row.owner_key_sha256 !== aiDesignOwnerKeySha256(ownerKey)) return null;
  let aggregate: AiDesignComplexWorkspaceAggregateV1;
  try { aggregate = JSON.parse(row.aggregate_json) as AiDesignComplexWorkspaceAggregateV1; }
  catch { throw new Error('AI_DESIGN_COMPLEX_AGGREGATE_INTEGRITY_FAILED'); }
  const issues = validateAiDesignComplexWorkspaceAggregate(aggregate);
  if (issues.length || aggregate.projectId !== row.project_id || aggregate.sessionId !== row.session_id
    || aggregate.complexRevision !== Number(row.complex_revision) || aggregate.aggregateDigest !== row.aggregate_digest) {
    throw new Error('AI_DESIGN_COMPLEX_AGGREGATE_INTEGRITY_FAILED');
  }
  return clone(aggregate);
}

/** PostgreSQL CAS implementation used only behind the commercial mode gate. */
export class PostgresAiDesignComplexWorkspaceStore implements AiDesignComplexWorkspaceStore {
  constructor(private readonly db: DbAdapter = getDbAdapter()) {}

  private async ready(): Promise<void> { await assertAiDesignPostgresAuthority(this.db); }

  async loadOrCreate(input: { ownerKey: string; projectId: string; sessionId: string; runtimeRevision: number; now?: string }): Promise<AiDesignComplexWorkspaceAggregateV1> {
    await this.ready();
    const ownerHash = aiDesignOwnerKeySha256(input.ownerKey);
    const existing = parseRow(await this.db.queryOne<ComplexRow>(
      `SELECT owner_key_sha256, project_id, session_id, complex_revision, aggregate_digest, aggregate_json, created_at, updated_at
       FROM nf_ai_design_complex_workspaces
       WHERE owner_key_sha256 = ? AND project_id = ? AND session_id = ?`,
      ownerHash, input.projectId, input.sessionId,
    ), input.ownerKey);
    if (existing) return existing;
    const created = createAiDesignComplexWorkspaceAggregate(input);
    const now = Date.parse(input.now ?? created.createdAt);
    await this.db.execute(
      `INSERT INTO nf_ai_design_complex_workspaces
       (owner_key_sha256, project_id, session_id, complex_revision, aggregate_digest, aggregate_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(owner_key_sha256, project_id, session_id) DO NOTHING`,
      ownerHash, input.projectId, input.sessionId, created.complexRevision,
      created.aggregateDigest, JSON.stringify(created), now, now,
    );
    const stored = parseRow(await this.db.queryOne<ComplexRow>(
      `SELECT owner_key_sha256, project_id, session_id, complex_revision, aggregate_digest, aggregate_json, created_at, updated_at
       FROM nf_ai_design_complex_workspaces
       WHERE owner_key_sha256 = ? AND project_id = ? AND session_id = ?`,
      ownerHash, input.projectId, input.sessionId,
    ), input.ownerKey);
    if (!stored) throw new Error('AI_DESIGN_COMPLEX_WORKSPACE_CREATE_FAILED');
    return stored;
  }

  async save(ownerKey: string, aggregate: AiDesignComplexWorkspaceAggregateV1, expectedComplexRevision: number): Promise<AiDesignComplexWorkspaceAggregateV1> {
    await this.ready();
    const issues = validateAiDesignComplexWorkspaceAggregate(aggregate);
    if (issues.length) throw new Error(`AI_DESIGN_COMPLEX_AGGREGATE_INVALID:${issues.join(',')}`);
    if (aggregate.complexRevision !== expectedComplexRevision + 1) throw new Error('AI_DESIGN_COMPLEX_REVISION_TRANSITION_INVALID');
    const changed = await this.db.execute(
      `UPDATE nf_ai_design_complex_workspaces
       SET complex_revision = ?, aggregate_digest = ?, aggregate_json = ?, updated_at = ?
       WHERE owner_key_sha256 = ? AND project_id = ? AND session_id = ? AND complex_revision = ?`,
      aggregate.complexRevision, aggregate.aggregateDigest, JSON.stringify(aggregate), Date.now(),
      aiDesignOwnerKeySha256(ownerKey), aggregate.projectId, aggregate.sessionId, expectedComplexRevision,
    );
    if (changed.changes !== 1) {
      const existing = await this.db.queryOne<{ complex_revision: number }>(
        `SELECT complex_revision FROM nf_ai_design_complex_workspaces
         WHERE owner_key_sha256 = ? AND project_id = ? AND session_id = ?`,
        aiDesignOwnerKeySha256(ownerKey), aggregate.projectId, aggregate.sessionId,
      );
      throw new Error(existing ? 'AI_DESIGN_COMPLEX_REVISION_CONFLICT' : 'AI_DESIGN_COMPLEX_WORKSPACE_NOT_FOUND');
    }
    return clone(aggregate);
  }

  reset(): void { /* PostgreSQL owns all state; there is no process-local cache. */ }
}

class AiDesignComplexWorkspaceStoreRouter implements AiDesignComplexWorkspaceStore {
  private readonly reference = new InMemoryAiDesignComplexWorkspaceStore();
  private commercial: PostgresAiDesignComplexWorkspaceStore | null = null;
  private selected(): AiDesignComplexWorkspaceStore {
    if (process.env.NEXYFAB_COMMERCIAL_MODE !== '1') return this.reference;
    this.commercial ??= new PostgresAiDesignComplexWorkspaceStore();
    return this.commercial;
  }
  loadOrCreate(input: Parameters<AiDesignComplexWorkspaceStore['loadOrCreate']>[0]) { return this.selected().loadOrCreate(input); }
  save(ownerKey: string, aggregate: AiDesignComplexWorkspaceAggregateV1, expectedComplexRevision: number) { return this.selected().save(ownerKey, aggregate, expectedComplexRevision); }
  reset(): void { this.reference.reset(); this.commercial = null; }
}

export const aiDesignComplexWorkspaceStore = new AiDesignComplexWorkspaceStoreRouter();
