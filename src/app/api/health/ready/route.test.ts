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
vi.mock('@/lib/precision-cad-agent/commercialWorkerReceipt', () => ({ loadTrustedCommercialWorkers: () => ({ worker: { fingerprintSha256: 'w'.repeat(64), nativeExecutableSha256: 'a'.repeat(64), nativeInvocationSha256: 'b'.repeat(64) } }) }));

import { GET } from './route';

const commercialWorkerHealth = (overrides: Record<string, unknown> = {}) => ({
  schema: 'nexyfab.precision-cad-commercial-worker-health.v1',
  status: 'READY',
  executionContract: 'nexyfab.precision-cad-commercial-execution.v3',
  claimConsumer: 'ACTIVE',
  inputArtifactReadback: 'PASS',
  nativeExecution: 'PASS',
  artifactUpload: 'PASS',
  signedCallback: 'PASS',
  workerIdentity: 'worker',
  nativeExecutableSha256: 'a'.repeat(64),
  nativeInvocationSha256: 'b'.repeat(64),
  selfTestReceiptSha256: 'a'.repeat(64),
  lastSelfTestAt: new Date().toISOString(),
  ...overrides,
});

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('RAILWAY_ENVIRONMENT_NAME', '');
  vi.stubEnv('NEXYFAB_COMMERCIAL_MODE', '0');
  vi.stubEnv('NEXYFAB_AI_DESIGN_DURABLE_MODE', '0');
  vi.stubEnv('NEXT_PUBLIC_NEXYFAB_AI_MODEL_BETA_ACCESS', '0');
  vi.stubEnv('NEXYFAB_PRECISION_CAD_COMMERCIAL_MODE', '');
  vi.stubEnv('NEXYFAB_PAYMENTS_ENABLED', '');
  vi.stubEnv('NEXYFAB_RELEASE_CHANNEL', '');
  vi.stubEnv('REDIS_URL', '');
  state.getDbAdapter.mockReset();
  state.getDbAdapter.mockReturnValue({ backend: 'sqlite', queryOne: vi.fn().mockResolvedValue({ '?column?': 1 }) });
  state.redisConstructor.mockReset();
  state.redisConstructor.mockImplementation(function RedisMock() { return state.redisClient; });
  state.redisClient.connect.mockReset().mockResolvedValue(undefined);
  state.redisClient.ping.mockReset().mockResolvedValue('PONG');
  state.redisClient.disconnect.mockReset();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    text: vi.fn().mockResolvedValue(JSON.stringify(commercialWorkerHealth())),
  }));
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

  it('requires Redis and a recent registered-worker end-to-end self-test in commercial mode', async () => {
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
    vi.stubEnv('POSTGRES_MIGRATION_CHECKSUM_2026082501', '1'.repeat(64));
    vi.stubEnv('POSTGRES_MIGRATION_CHECKSUM_2026082502', '2'.repeat(64));
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
    const queryOne = vi.fn(async (sql: string, version?: number) => sql.includes('nf_schema_migrations') ? { version, checksum: String(version).slice(-1).repeat(64) } : sql.includes('information_schema.tables') ? { count: 35 } : sql.includes('pg_constraint') ? { count: 17 } : sql.includes('pg_trigger') ? { count: 22 } : { '?column?': 1 });
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

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      text: vi.fn().mockResolvedValue(JSON.stringify({ ok: true })),
    } as unknown as Response);
    const genericHealth = await GET();
    expect(genericHealth.status).toBe(503);
    await expect(genericHealth.json()).resolves.toMatchObject({
      commercialBoundary: { status: 'error', required: true },
    });

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      text: vi.fn().mockResolvedValue(JSON.stringify(commercialWorkerHealth({
        lastSelfTestAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      }))),
    } as unknown as Response);
    const staleSelfTest = await GET();
    expect(staleSelfTest.status).toBe(503);
    await expect(staleSelfTest.json()).resolves.toMatchObject({
      commercialBoundary: { status: 'error', required: true },
    });

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      text: vi.fn().mockResolvedValue(JSON.stringify(commercialWorkerHealth({
        nativeExecutableSha256: 'c'.repeat(64),
      }))),
    } as unknown as Response);
    const substitutedAdapter = await GET();
    expect(substitutedAdapter.status).toBe(503);
    await expect(substitutedAdapter.json()).resolves.toMatchObject({
      commercialBoundary: { status: 'error', required: true },
    });
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

  it('accepts only the exact production web-public mode with payments and precision commerce disabled', async () => {
    vi.stubEnv('RAILWAY_ENVIRONMENT_NAME', 'production');
    vi.stubEnv('NEXYFAB_RELEASE_CHANNEL', 'web-public');
    vi.stubEnv('NEXYFAB_COMMERCIAL_MODE', '0');
    vi.stubEnv('NEXYFAB_AI_DESIGN_DURABLE_MODE', '1');
    vi.stubEnv('NEXT_PUBLIC_NEXYFAB_AI_MODEL_BETA_ACCESS', '1');
    vi.stubEnv('NEXYFAB_PRECISION_CAD_COMMERCIAL_MODE', '0');
    vi.stubEnv('NEXYFAB_PAYMENTS_ENABLED', 'false');
    vi.stubEnv('OPENAI_API_KEY', 'openai-test-key');
    vi.stubEnv('QWEN_API_KEY', 'qwen-test-key');
    vi.stubEnv('QWEN_BASE_URL', 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1');
    vi.stubEnv('DEEPSEEK_API_KEY', 'deepseek-test-key');
    vi.stubEnv('REDIS_URL', 'redis://example.test:6379');
    vi.stubEnv('POSTGRES_MIGRATION_CHECKSUM_2026082402', '2'.repeat(64));
    vi.stubEnv('POSTGRES_MIGRATION_CHECKSUM_2026082602', 'a'.repeat(64));
    const queryOne = vi.fn(async (sql: string, version?: number) => {
      if (sql.includes('nf_schema_migrations')) {
        return version === 2026082402
          ? { version, checksum: '2'.repeat(64) }
          : { version: 2026082602, checksum: 'a'.repeat(64) };
      }
      return { '?column?': 1 };
    });
    state.getDbAdapter.mockReturnValue({ backend: 'postgres', queryOne });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: 'ok',
      db: { aiDesignPersistence: 'postgres_authoritative' },
      redis: { status: 'ok', required: true },
      aiModelAccess: {
        status: 'ok',
        required: true,
        mode: 'no_payment_beta_all_models',
        providers: ['openai', 'qwen', 'deepseek'],
      },
      commercialBoundary: { status: 'skipped', required: false },
    });
    expect(fetch).not.toHaveBeenCalled();

    queryOne.mockImplementationOnce(async () => ({ '?column?': 1 })).mockImplementationOnce(async () => ({ version: 2026082602, checksum: 'b'.repeat(64) }));
    const migrationMismatch = await GET();
    expect(migrationMismatch.status).toBe(503);
    await expect(migrationMismatch.json()).resolves.toMatchObject({ db: { status: 'error', required: true } });

    const nearMisses = [
      ['NEXYFAB_RELEASE_CHANNEL', 'production'],
      ['NEXYFAB_COMMERCIAL_MODE', ''],
      ['NEXYFAB_AI_DESIGN_DURABLE_MODE', '0'],
      ['NEXT_PUBLIC_NEXYFAB_AI_MODEL_BETA_ACCESS', '0'],
      ['NEXYFAB_PRECISION_CAD_COMMERCIAL_MODE', '1'],
      ['NEXYFAB_PAYMENTS_ENABLED', 'true'],
    ] as const;
    for (const [key, value] of nearMisses) {
      vi.stubEnv(key, value);
      const rejected = await GET();
      expect(rejected.status, `${key}=${value || '(empty)'}`).toBe(503);
      await expect(rejected.json()).resolves.toMatchObject({
        commercialBoundary: { status: 'error', required: true },
      });
      vi.stubEnv('NEXYFAB_RELEASE_CHANNEL', 'web-public');
      vi.stubEnv('NEXYFAB_COMMERCIAL_MODE', '0');
      vi.stubEnv('NEXYFAB_AI_DESIGN_DURABLE_MODE', '1');
      vi.stubEnv('NEXT_PUBLIC_NEXYFAB_AI_MODEL_BETA_ACCESS', '1');
      vi.stubEnv('NEXYFAB_PRECISION_CAD_COMMERCIAL_MODE', '0');
      vi.stubEnv('NEXYFAB_PAYMENTS_ENABLED', 'false');
    }

    for (const [key, value] of [
      ['OPENAI_API_KEY', ''],
      ['QWEN_API_KEY', ''],
      ['DEEPSEEK_API_KEY', ''],
      ['QWEN_BASE_URL', 'https://example.com/v1'],
    ] as const) {
      vi.stubEnv(key, value);
      const rejected = await GET();
      expect(rejected.status, `${key}=${value || '(empty)'}`).toBe(503);
      await expect(rejected.json()).resolves.toMatchObject({
        aiModelAccess: { status: 'error', required: true },
      });
      vi.stubEnv('OPENAI_API_KEY', 'openai-test-key');
      vi.stubEnv('QWEN_API_KEY', 'qwen-test-key');
      vi.stubEnv('QWEN_BASE_URL', 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1');
      vi.stubEnv('DEEPSEEK_API_KEY', 'deepseek-test-key');
    }
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
