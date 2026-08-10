import type { Redis } from 'ioredis';
import { createHash } from 'node:crypto';
import type { GenerationRunState } from './generationRunState';

type StoredGenerationRun = {
  schema: 'nexyfab.server-generation-state.v1';
  ownerKey: string;
  state: GenerationRunState;
  createdAt: string;
  updatedAt: string;
};

const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;
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
  if (process.env.NEXYFAB_COMMERCIAL_MODE === '1' && !process.env.REDIS_URL?.trim()) {
    throw new Error('GENERATION_STATE_REDIS_REQUIRED');
  }
}

function parseStored(raw: string | null): StoredGenerationRun | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredGenerationRun>;
    if (value.schema !== 'nexyfab.server-generation-state.v1' || !value.ownerKey || value.state?.schema !== 'nexyfab.generation-run.v1') return null;
    return value as StoredGenerationRun;
  } catch {
    return null;
  }
}

export async function createServerGenerationState(ownerKey: string, state: GenerationRunState): Promise<GenerationRunState> {
  requireDurableStore();
  const key = storageKey(ownerKey, state.runId);
  const now = new Date().toISOString();
  const record: StoredGenerationRun = { schema: 'nexyfab.server-generation-state.v1', ownerKey, state: structuredClone(state), createdAt: now, updatedAt: now };
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
  if (!Number.isInteger(state.revision) || state.revision <= expectedRevision) throw new Error('GENERATION_REVISION_TRANSITION_INVALID');
  const key = storageKey(ownerKey, state.runId);
  const client = await redis();
  if (client) {
    const current = parseStored(await client.get(key));
    if (!current || current.ownerKey !== ownerKey) throw new Error('GENERATION_RUN_NOT_FOUND');
    if (current.state.revision !== expectedRevision) throw new Error('GENERATION_REVISION_CONFLICT');
    const next: StoredGenerationRun = { ...current, state: structuredClone(state), updatedAt: new Date().toISOString() };
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
    memory.set(key, { ...current, state: structuredClone(state), updatedAt: new Date().toISOString() });
  }
  return structuredClone(state);
}

export function resetGenerationStateStoreForTests(): void {
  memory.clear();
}
