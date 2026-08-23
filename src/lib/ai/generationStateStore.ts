import type { Redis } from 'ioredis';
import { createHash } from 'node:crypto';
import type { GenerationRunState } from './generationRunState';
import { evidenceHashMatches, serverEvidenceSha256 } from './serverEvidence';

type StoredGenerationRun = {
  schema: 'nexyfab.server-generation-state.v2';
  ownerKey: string;
  state: GenerationRunState;
  stateSha256: string;
  createdAt: string;
  updatedAt: string;
};

const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;
export const MAX_GENERATION_STATE_BYTES = 4 * 1024 * 1024;
const memory = new Map<string, StoredGenerationRun>();
let redisClient: Redis | null | undefined;

const storageKey = (ownerKey: string, runId: string) =>
  `nf:generation:v1:${createHash('sha256').update(`${ownerKey}\0${runId}`).digest('hex')}`;

async function redis(): Promise<Redis | null> {
  if (redisClient !== undefined) return redisClient;
  if (!process.env.REDIS_URL?.trim()) {
    redisClient = null;
    return null;
  }
  const { default: IORedis } = await import('ioredis');
  redisClient = new IORedis(process.env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 3_000,
    enableOfflineQueue: false,
  });
  return redisClient;
}

function requireDurableStore(): void {
  if (process.env.NEXYFAB_COMMERCIAL_MODE === '1') {
    // Redis is a cache and has neither the tenant/project/workspace identity
    // nor the immutable revision/receipt bindings required by migration 2207.
    // Commercial callers must use the PostgreSQL authoritative store through
    // a server-owned project binding; silently falling back here would make a
    // Redis record look like commercial release evidence.
    throw new Error('GENERATION_STATE_POSTGRES_AUTHORITATIVE_REQUIRED');
  }
}

function parseStored(raw: string | null): StoredGenerationRun | null {
  if (!raw) return null;
  if (Buffer.byteLength(raw, 'utf8') > MAX_GENERATION_STATE_BYTES * 2) throw new Error('GENERATION_STATE_TOO_LARGE');
  try {
    const value = JSON.parse(raw) as Partial<StoredGenerationRun>;
    if (value.schema !== 'nexyfab.server-generation-state.v2' || !value.ownerKey || value.state?.schema !== 'nexyfab.generation-run.v1' || !value.stateSha256) return null;
    if (!evidenceHashMatches(value.state, value.stateSha256)) throw new Error('GENERATION_STATE_INTEGRITY_FAILED');
    return value as StoredGenerationRun;
  } catch (error) {
    if (error instanceof Error && error.message === 'GENERATION_STATE_INTEGRITY_FAILED') throw error;
    return null;
  }
}

function assertStateSize(state: GenerationRunState): void {
  let serialized: string;
  try { serialized = JSON.stringify(state); }
  catch { throw new Error('GENERATION_STATE_NOT_SERIALIZABLE'); }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_GENERATION_STATE_BYTES) throw new Error('GENERATION_STATE_TOO_LARGE');
  // This also rejects NaN, Infinity, cycles, class instances, functions and other ambiguous evidence.
  serverEvidenceSha256(state);
}

export async function createServerGenerationState(ownerKey: string, state: GenerationRunState): Promise<GenerationRunState> {
  requireDurableStore();
  assertStateSize(state);
  const key = storageKey(ownerKey, state.runId);
  const now = new Date().toISOString();
  const record: StoredGenerationRun = { schema: 'nexyfab.server-generation-state.v2', ownerKey, state: structuredClone(state), stateSha256: serverEvidenceSha256(state), createdAt: now, updatedAt: now };
  const client = await redis();
  if (client) {
    const result = await client.set(key, JSON.stringify(record), 'EX', DEFAULT_TTL_SECONDS, 'NX');
    if (result !== 'OK') throw new Error('GENERATION_RUN_ALREADY_EXISTS');
  } else {
    if (memory.has(key)) throw new Error('GENERATION_RUN_ALREADY_EXISTS');
    memory.set(key, record);
  }
  return structuredClone(state);
}

export async function loadServerGenerationState(ownerKey: string, runId: string): Promise<GenerationRunState> {
  requireDurableStore();
  const key = storageKey(ownerKey, runId);
  const client = await redis();
  const record = client ? parseStored(await client.get(key)) : memory.get(key) ?? null;
  if (!record || record.ownerKey !== ownerKey) throw new Error('GENERATION_RUN_NOT_FOUND');
  return structuredClone(record.state);
}

/** Compare-and-swap prevents two browser tabs or replayed requests from
 * overwriting a newer server-owned revision. */
export async function saveServerGenerationState(
  ownerKey: string,
  state: GenerationRunState,
  expectedRevision: number,
): Promise<GenerationRunState> {
  requireDurableStore();
  assertStateSize(state);
  if (!Number.isInteger(state.revision) || state.revision <= expectedRevision) throw new Error('GENERATION_REVISION_TRANSITION_INVALID');
  const key = storageKey(ownerKey, state.runId);
  const client = await redis();
  if (client) {
    const current = parseStored(await client.get(key));
    if (!current || current.ownerKey !== ownerKey) throw new Error('GENERATION_RUN_NOT_FOUND');
    if (current.state.revision !== expectedRevision) throw new Error('GENERATION_REVISION_CONFLICT');
    const next: StoredGenerationRun = { ...current, state: structuredClone(state), stateSha256: serverEvidenceSha256(state), updatedAt: new Date().toISOString() };
    const result = await client.eval(
      `local current=redis.call('GET',KEYS[1]); if not current then return 0 end; local decoded=cjson.decode(current); if decoded.state.revision~=tonumber(ARGV[1]) then return -1 end; redis.call('SET',KEYS[1],ARGV[2],'EX',ARGV[3]); return 1`,
      1,
      key,
      String(expectedRevision),
      JSON.stringify(next),
      String(DEFAULT_TTL_SECONDS),
    );
    if (result === -1) throw new Error('GENERATION_REVISION_CONFLICT');
    if (result !== 1) throw new Error('GENERATION_RUN_NOT_FOUND');
  } else {
    const current = memory.get(key);
    if (!current || current.ownerKey !== ownerKey) throw new Error('GENERATION_RUN_NOT_FOUND');
    if (current.state.revision !== expectedRevision) throw new Error('GENERATION_REVISION_CONFLICT');
    memory.set(key, { ...current, state: structuredClone(state), stateSha256: serverEvidenceSha256(state), updatedAt: new Date().toISOString() });
  }
  return structuredClone(state);
}

export function resetGenerationStateStoreForTests(): void {
  memory.clear();
}
