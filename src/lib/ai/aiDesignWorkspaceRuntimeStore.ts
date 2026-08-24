import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';
import { getDbAdapter, type DbAdapter } from '@/lib/db-adapter';
import { aiDesignOwnerKeySha256, assertAiDesignPostgresAuthority } from './aiDesignPostgresAuthority';
import { assertAiDesignWorkspaceRuntime, type AiDesignWorkspaceRuntimeV1 } from './aiDesignWorkspaceRuntime';
import { evidenceHashMatches, serverEvidenceSha256 } from './serverEvidence';

export const MAX_AI_DESIGN_WORKSPACE_RUNTIME_BYTES = 1024 * 1024;
const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;

interface StoredAiDesignWorkspaceRuntime {
  schema: 'nexyfab.server-ai-design-workspace-runtime.v1';
  ownerKey: string;
  projectId: string;
  sessionId: string;
  runtimeRevision: number;
  state: AiDesignWorkspaceRuntimeV1;
  stateSha256: string;
  createdAt: string;
  updatedAt: string;
}

const memory = new Map<string, StoredAiDesignWorkspaceRuntime>();
let redisClient: Redis | null | undefined;

function key(ownerKey: string, projectId: string, sessionId: string): string {
  return `nf:ai-design-workspace:v1:${createHash('sha256').update(`${ownerKey}\0${projectId}\0${sessionId}`).digest('hex')}`;
}

function clone<T>(value: T): T { return structuredClone(value); }

function assertRuntimeSize(state: AiDesignWorkspaceRuntimeV1): string {
  assertAiDesignWorkspaceRuntime(state);
  let json: string;
  try { json = JSON.stringify(state); } catch { throw new Error('AI_DESIGN_WORKSPACE_NOT_SERIALIZABLE'); }
  if (Buffer.byteLength(json, 'utf8') > MAX_AI_DESIGN_WORKSPACE_RUNTIME_BYTES) throw new Error('AI_DESIGN_WORKSPACE_TOO_LARGE');
  return serverEvidenceSha256(state);
}

async function redis(): Promise<Redis | null> {
  if (redisClient !== undefined) return redisClient;
  if (!process.env.REDIS_URL?.trim()) { redisClient = null; return null; }
  const { default: IORedis } = await import('ioredis');
  redisClient = new IORedis(process.env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 3_000,
    enableOfflineQueue: false,
  });
  return redisClient;
}

function commercialMode(): boolean { return process.env.NEXYFAB_COMMERCIAL_MODE === '1'; }

function parseStored(raw: string | null): StoredAiDesignWorkspaceRuntime | null {
  if (!raw) return null;
  if (Buffer.byteLength(raw, 'utf8') > MAX_AI_DESIGN_WORKSPACE_RUNTIME_BYTES * 2) throw new Error('AI_DESIGN_WORKSPACE_TOO_LARGE');
  try {
    const value = JSON.parse(raw) as Partial<StoredAiDesignWorkspaceRuntime>;
    if (value.schema !== 'nexyfab.server-ai-design-workspace-runtime.v1' || !value.ownerKey || !value.projectId || !value.sessionId || !value.state || !value.stateSha256) return null;
    if (!evidenceHashMatches(value.state, value.stateSha256)) throw new Error('AI_DESIGN_WORKSPACE_INTEGRITY_FAILED');
    assertRuntimeSize(value.state);
    if (value.runtimeRevision !== value.state.runtimeRevision || value.projectId !== value.state.projectId || value.sessionId !== value.state.session.sessionId) throw new Error('AI_DESIGN_WORKSPACE_BINDING_MISMATCH');
    return value as StoredAiDesignWorkspaceRuntime;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('AI_DESIGN_WORKSPACE_')) throw error;
    return null;
  }
}

function makeRecord(ownerKey: string, state: AiDesignWorkspaceRuntimeV1, createdAt: string, updatedAt: string): StoredAiDesignWorkspaceRuntime {
  return {
    schema: 'nexyfab.server-ai-design-workspace-runtime.v1',
    ownerKey,
    projectId: state.projectId,
    sessionId: state.session.sessionId,
    runtimeRevision: state.runtimeRevision,
    state: clone(state),
    stateSha256: assertRuntimeSize(state),
    createdAt,
    updatedAt,
  };
}

type RuntimeRow = {
  owner_key_sha256: string;
  project_id: string;
  session_id: string;
  runtime_revision: number;
  state_sha256: string;
  state_json: string;
  created_at: number;
  updated_at: number;
};

function parsePostgresRuntime(row: RuntimeRow | undefined, ownerKey: string): StoredAiDesignWorkspaceRuntime | null {
  if (!row || row.owner_key_sha256 !== aiDesignOwnerKeySha256(ownerKey)) return null;
  try {
    return parseStored(JSON.stringify({
      schema: 'nexyfab.server-ai-design-workspace-runtime.v1', ownerKey,
      projectId: row.project_id, sessionId: row.session_id,
      runtimeRevision: Number(row.runtime_revision), state: JSON.parse(row.state_json),
      stateSha256: row.state_sha256,
      createdAt: new Date(Number(row.created_at)).toISOString(),
      updatedAt: new Date(Number(row.updated_at)).toISOString(),
    }));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('AI_DESIGN_WORKSPACE_')) throw error;
    throw new Error('AI_DESIGN_WORKSPACE_INTEGRITY_FAILED');
  }
}

function parsePostgresRuntimeByOwnerHash(
  row: RuntimeRow | undefined,
  ownerKeySha256: string,
): AiDesignWorkspaceRuntimeV1 | null {
  if (!row || row.owner_key_sha256 !== ownerKeySha256) return null;
  let state: AiDesignWorkspaceRuntimeV1;
  try { state = JSON.parse(row.state_json) as AiDesignWorkspaceRuntimeV1; }
  catch { throw new Error('AI_DESIGN_WORKSPACE_INTEGRITY_FAILED'); }
  const stateSha256 = assertRuntimeSize(state);
  if (stateSha256 !== row.state_sha256 || state.projectId !== row.project_id
    || state.session.sessionId !== row.session_id
    || state.runtimeRevision !== Number(row.runtime_revision)) {
    throw new Error('AI_DESIGN_WORKSPACE_INTEGRITY_FAILED');
  }
  return clone(state);
}

async function postgresDb(): Promise<DbAdapter> {
  const db = getDbAdapter();
  await assertAiDesignPostgresAuthority(db);
  return db;
}

export async function createServerAiDesignWorkspaceRuntime(ownerKey: string, state: AiDesignWorkspaceRuntimeV1): Promise<AiDesignWorkspaceRuntimeV1> {
  const now = new Date().toISOString();
  if (commercialMode()) {
    const db = await postgresDb();
    const stateSha256 = assertRuntimeSize(state);
    try {
      await db.execute(
        `INSERT INTO nf_ai_design_workspace_runtimes
         (owner_key_sha256, project_id, session_id, runtime_revision, state_sha256, state_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        aiDesignOwnerKeySha256(ownerKey), state.projectId, state.session.sessionId,
        state.runtimeRevision, stateSha256, JSON.stringify(state), Date.parse(now), Date.parse(now),
      );
    } catch {
      const existing = await db.queryOne<{ runtime_revision: number }>(
        `SELECT runtime_revision FROM nf_ai_design_workspace_runtimes
         WHERE owner_key_sha256 = ? AND project_id = ? AND session_id = ?`,
        aiDesignOwnerKeySha256(ownerKey), state.projectId, state.session.sessionId,
      );
      throw new Error(existing ? 'AI_DESIGN_WORKSPACE_ALREADY_EXISTS' : 'AI_DESIGN_WORKSPACE_CREATE_FAILED');
    }
    return clone(state);
  }
  const storageKey = key(ownerKey, state.projectId, state.session.sessionId);
  const record = makeRecord(ownerKey, state, now, now);
  const client = await redis();
  if (client) {
    const result = await client.set(storageKey, JSON.stringify(record), 'EX', DEFAULT_TTL_SECONDS, 'NX');
    if (result !== 'OK') throw new Error('AI_DESIGN_WORKSPACE_ALREADY_EXISTS');
  } else {
    if (memory.has(storageKey)) throw new Error('AI_DESIGN_WORKSPACE_ALREADY_EXISTS');
    memory.set(storageKey, record);
  }
  return clone(state);
}

export async function loadServerAiDesignWorkspaceRuntime(ownerKey: string, projectId: string, sessionId: string): Promise<AiDesignWorkspaceRuntimeV1> {
  if (commercialMode()) {
    const db = await postgresDb();
    const row = await db.queryOne<RuntimeRow>(
      `SELECT owner_key_sha256, project_id, session_id, runtime_revision, state_sha256, state_json, created_at, updated_at
       FROM nf_ai_design_workspace_runtimes
       WHERE owner_key_sha256 = ? AND project_id = ? AND session_id = ?`,
      aiDesignOwnerKeySha256(ownerKey), projectId, sessionId,
    );
    const stored = parsePostgresRuntime(row, ownerKey);
    if (!stored || stored.projectId !== projectId || stored.sessionId !== sessionId) throw new Error('AI_DESIGN_WORKSPACE_NOT_FOUND');
    return clone(stored.state);
  }
  const storageKey = key(ownerKey, projectId, sessionId);
  const client = await redis();
  const stored = client ? parseStored(await client.get(storageKey)) : memory.get(storageKey) ?? null;
  if (!stored || stored.ownerKey !== ownerKey || stored.projectId !== projectId || stored.sessionId !== sessionId) throw new Error('AI_DESIGN_WORKSPACE_NOT_FOUND');
  if (!evidenceHashMatches(stored.state, stored.stateSha256)) throw new Error('AI_DESIGN_WORKSPACE_INTEGRITY_FAILED');
  assertRuntimeSize(stored.state);
  return clone(stored.state);
}

/** Commercial worker read path that keeps the raw tenant owner key out of durable jobs. */
export async function loadServerAiDesignWorkspaceRuntimeByOwnerHash(
  db: DbAdapter,
  ownerKeySha256: string,
  projectId: string,
  sessionId: string,
): Promise<AiDesignWorkspaceRuntimeV1> {
  if (!/^[a-f0-9]{64}$/.test(ownerKeySha256)) throw new Error('AI_DESIGN_OWNER_HASH_INVALID');
  await assertAiDesignPostgresAuthority(db);
  const row = await db.queryOne<RuntimeRow>(
    `SELECT owner_key_sha256, project_id, session_id, runtime_revision, state_sha256, state_json, created_at, updated_at
     FROM nf_ai_design_workspace_runtimes
     WHERE owner_key_sha256 = ? AND project_id = ? AND session_id = ?`,
    ownerKeySha256, projectId, sessionId,
  );
  const state = parsePostgresRuntimeByOwnerHash(row, ownerKeySha256);
  if (!state) throw new Error('AI_DESIGN_WORKSPACE_NOT_FOUND');
  return state;
}

export async function saveServerAiDesignWorkspaceRuntime(
  ownerKey: string,
  state: AiDesignWorkspaceRuntimeV1,
  expectedRevision: number,
): Promise<AiDesignWorkspaceRuntimeV1> {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || state.runtimeRevision <= expectedRevision) throw new Error('AI_DESIGN_WORKSPACE_REVISION_TRANSITION_INVALID');
  if (commercialMode()) {
    const db = await postgresDb();
    const changed = await db.execute(
      `UPDATE nf_ai_design_workspace_runtimes
       SET runtime_revision = ?, state_sha256 = ?, state_json = ?, updated_at = ?
       WHERE owner_key_sha256 = ? AND project_id = ? AND session_id = ? AND runtime_revision = ?`,
      state.runtimeRevision, assertRuntimeSize(state), JSON.stringify(state), Date.now(),
      aiDesignOwnerKeySha256(ownerKey), state.projectId, state.session.sessionId, expectedRevision,
    );
    if (changed.changes !== 1) {
      const existing = await db.queryOne<{ runtime_revision: number }>(
        `SELECT runtime_revision FROM nf_ai_design_workspace_runtimes
         WHERE owner_key_sha256 = ? AND project_id = ? AND session_id = ?`,
        aiDesignOwnerKeySha256(ownerKey), state.projectId, state.session.sessionId,
      );
      throw new Error(existing ? 'AI_DESIGN_WORKSPACE_REVISION_CONFLICT' : 'AI_DESIGN_WORKSPACE_NOT_FOUND');
    }
    return clone(state);
  }
  const storageKey = key(ownerKey, state.projectId, state.session.sessionId);
  const client = await redis();
  if (client) {
    const current = parseStored(await client.get(storageKey));
    if (!current || current.ownerKey !== ownerKey) throw new Error('AI_DESIGN_WORKSPACE_NOT_FOUND');
    if (current.runtimeRevision !== expectedRevision) throw new Error('AI_DESIGN_WORKSPACE_REVISION_CONFLICT');
    const next = makeRecord(ownerKey, state, current.createdAt, new Date().toISOString());
    const result = await client.eval(
      `local current=redis.call('GET',KEYS[1]); if not current then return 0 end; local decoded=cjson.decode(current); if decoded.runtimeRevision~=tonumber(ARGV[1]) then return -1 end; redis.call('SET',KEYS[1],ARGV[2],'EX',ARGV[3]); return 1`,
      1,
      storageKey,
      String(expectedRevision),
      JSON.stringify(next),
      String(DEFAULT_TTL_SECONDS),
    );
    if (result === -1) throw new Error('AI_DESIGN_WORKSPACE_REVISION_CONFLICT');
    if (result !== 1) throw new Error('AI_DESIGN_WORKSPACE_NOT_FOUND');
  } else {
    const current = memory.get(storageKey);
    if (!current || current.ownerKey !== ownerKey) throw new Error('AI_DESIGN_WORKSPACE_NOT_FOUND');
    if (current.runtimeRevision !== expectedRevision) throw new Error('AI_DESIGN_WORKSPACE_REVISION_CONFLICT');
    memory.set(storageKey, makeRecord(ownerKey, state, current.createdAt, new Date().toISOString()));
  }
  return clone(state);
}

export function resetAiDesignWorkspaceRuntimeStoreForTests(): void {
  memory.clear();
  redisClient = undefined;
}
