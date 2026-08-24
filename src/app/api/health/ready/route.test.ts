import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  getDbAdapter: vi.fn(),
  redisConstructor: vi.fn(),
  redisClient: {
    connect: vi.fn(),
    ping: vi.fn(),
    disconnect: vi.fn(),
  },
}));

vi.mock('@/lib/db-adapter', () => ({ getDbAdapter: state.getDbAdapter }));
vi.mock('ioredis', () => ({ default: state.redisConstructor }));
vi.mock('@/lib/ai/serverAgenticCommercialTrust', () => ({ loadServerAgenticCommercialTrust: () => ({ ok: true, context: {}, identities: [] }) }));
vi.mock('@/lib/ai/externalCommercialVerifierRegistry', () => ({ loadExternalCommercialVerifierRegistry: () => ({ identities: [{ fingerprintSha256: 'v'.repeat(64) }] }) }));
vi.mock('@/lib/precision-cad-agent/commercialWorkerReceipt', () => ({ loadTrustedCommercialWorkers: () => ({ worker: { fingerprintSha256: 'w'.repeat(64) } }) }));

import { GET } from './route';

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('NEXYFAB_COMMERCIAL_MODE', '0');
  vi.stubEnv('REDIS_URL', '');
  state.getDbAdapter.mockReset();
  state.getDbAdapter.mockReturnValue({ backend: 'sqlite', queryOne: vi.fn().mockResolvedValue({ '?column?': 1 }) });
  state.redisConstructor.mockReset();
  state.redisConstructor.mockImplementation(function RedisMock() { return state.redisClient; });
  state.redisClient.connect.mockReset().mockResolvedValue(undefined);
  state.redisClient.ping.mockReset().mockResolvedValue('PONG');
  state.redisClient.disconnect.mockReset();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('GET /api/health/ready', () => {
  it('checks the database and explicitly skips Redis for non-commercial local runs', async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.db).toMatchObject({ backend: 'sqlite', status: 'ok', required: true });
    expect(body.redis).toEqual({ status: 'skipped', required: false });
    expect(state.redisConstructor).not.toHaveBeenCalled();
  });

  it('requires and pings Redis in commercial mode, then disconnects the probe', async () => {
    vi.stubEnv('NEXYFAB_COMMERCIAL_MODE', '1');
    vi.stubEnv('NEXYFAB_PRECISION_CAD_COMMERCIAL_MODE', '1');
    vi.stubEnv('REDIS_URL', 'redis://user:secret@example.test:6379');
    vi.stubEnv('NEXYFAB_BUILD_ID', 'build-1');
    vi.stubEnv('POSTGRES_MIGRATION_CHECKSUM_2026082202', '2'.repeat(64));
    vi.stubEnv('POSTGRES_MIGRATION_CHECKSUM_2026082203', '3'.repeat(64));
    vi.stubEnv('POSTGRES_MIGRATION_CHECKSUM_2026082204', '4'.repeat(64));
    vi.stubEnv('POSTGRES_MIGRATION_CHECKSUM_2026082205', '5'.repeat(64));
    vi.stubEnv('POSTGRES_MIGRATION_CHECKSUM_2026082206', '6'.repeat(64));
    vi.stubEnv('POSTGRES_MIGRATION_CHECKSUM_2026082207', '7'.repeat(64));
    vi.stubEnv('POSTGRES_MIGRATION_CHECKSUM_2026082208', '8'.repeat(64));
    vi.stubEnv('POSTGRES_MIGRATION_CHECKSUM_2026082301', '1'.repeat(64));
    vi.stubEnv('CANONICAL_CAD_REVISION_MIGRATION_CHECKSUM', '1'.repeat(64));
    vi.stubEnv('POSTGRES_MIGRATION_CHECKSUM_2026082402', '2'.repeat(64));
    vi.stubEnv('POSTGRES_MIGRATION_CHECKSUM_2026082403', '3'.repeat(64));
    vi.stubEnv('OBJECT_STORAGE_PRIVATE_BUCKET', 'receipts');
    vi.stubEnv('S3_BUCKET', 'receipts');
    vi.stubEnv('GENERATION_EVIDENCE_SIGNING_SECRET', 'g'.repeat(32));
    vi.stubEnv('CRON_SECRET', 'r'.repeat(32));
    vi.stubEnv('NEXYFAB_AGENT_APPROVAL_SECRET', 'a'.repeat(32));
    vi.stubEnv('EXTERNAL_WORKER_ORCHESTRATOR_HEALTH_URL', 'https://worker.example.test/ready');
    vi.stubEnv('NEXYFAB_COMMERCIAL_WORKER_KEYS_JSON', '{}');
    vi.stubEnv('NEXYFAB_COMMERCIAL_WORKER_CLAIM_SECRET', 'w'.repeat(32));
    vi.stubEnv('NEXYFAB_COMMERCIAL_TRANSPORT_SECRET', 't'.repeat(32));
    vi.stubEnv('NEXYFAB_COMMERCIAL_CALLBACK_SECRET', 'c'.repeat(32));
    vi.stubEnv('NEXYFAB_COMMERCIAL_CALLBACK_URL', 'https://core.example.test/callback');
    vi.stubEnv('NEXYFAB_EXTERNAL_VERIFIER_REGISTRY_JSON', '[]');
    vi.stubEnv('NEXYFAB_EXTERNAL_VERIFIER_INTERNAL_SECRET', 'v'.repeat(32));
    const queryOne = vi.fn(async (sql: string, version?: number) => sql.includes('nf_schema_migrations') ? { version, checksum: String(version).slice(-1).repeat(64) } : sql.includes('information_schema.tables') ? { count: 33 } : sql.includes('pg_constraint') ? { count: 15 } : sql.includes('pg_trigger') ? { count: 20 } : { '?column?': 1 });
    state.getDbAdapter.mockReturnValue({ backend: 'postgres', queryOne });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.redis).toMatchObject({ status: 'ok', required: true });
    expect(body.commercialBoundary).toMatchObject({ status: 'ok', required: true });
    expect(state.redisClient.connect).toHaveBeenCalledOnce();
    expect(state.redisClient.ping).toHaveBeenCalledOnce();
    expect(state.redisClient.disconnect).toHaveBeenCalledOnce();
    const catalogSql = queryOne.mock.calls.map(([sql]) => String(sql)).join('\n');
    expect(catalogSql).toContain("r.relname = 'nf_agentic_commercial_receipts'");
    expect(catalogSql).toContain("r.relname = 'nf_precision_cad_execution_journal'");
    expect(catalogSql).toContain("r.relname = 'nf_cad_canonical_v2_revisions'");
    expect(catalogSql).toContain("t.tgname = 'nf_cad_v2_revisions_immutable'");
    expect(catalogSql).toContain("t.tgname = 'nf_ai_design_artifact_immutable'");
  });

  it('fails closed when production has no Redis configuration', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({ status: 'error', db: { status: 'ok' }, redis: { status: 'error', required: true } });
    expect(JSON.stringify(body)).not.toContain('redis://');
    expect(JSON.stringify(body)).not.toContain('secret');
    expect(state.redisConstructor).not.toHaveBeenCalled();
  });

  it('fails closed when the Railway production environment omits commercial mode', async () => {
    vi.stubEnv('RAILWAY_ENVIRONMENT_NAME', 'production');
    vi.stubEnv('REDIS_URL', 'redis://example.test:6379');

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      status: 'error',
      redis: { status: 'ok', required: true },
      commercialBoundary: { status: 'error', required: true },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns sanitized 503 when the Redis ping fails', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('REDIS_URL', 'redis://user:secret@example.test:6379');
    state.redisClient.ping.mockRejectedValue(new Error('redis://user:secret@example.test refused connection'));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.redis).toMatchObject({ status: 'error', required: true });
    expect(JSON.stringify(body)).not.toContain('redis://');
    expect(JSON.stringify(body)).not.toContain('refused connection');
    expect(state.redisClient.disconnect).toHaveBeenCalledOnce();
  });

  it('returns sanitized 503 when the Redis client constructor rejects', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('REDIS_URL', 'not-a-valid-redis-url');
    state.redisConstructor.mockImplementation(function RedisMock() {
      throw new Error('invalid redis://user:secret URL');
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.redis).toMatchObject({ status: 'error', required: true });
    expect(JSON.stringify(body)).not.toContain('redis://');
    expect(JSON.stringify(body)).not.toContain('secret');
    expect(JSON.stringify(body)).not.toContain('invalid');
    expect(state.redisClient.disconnect).not.toHaveBeenCalled();
  });
});
