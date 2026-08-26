import { NextResponse } from 'next/server';
import IORedis, { type Redis } from 'ioredis';
import { getDbAdapter } from '@/lib/db-adapter';
import { loadServerAgenticCommercialTrust } from '@/lib/ai/serverAgenticCommercialTrust';
import { loadExternalCommercialVerifierRegistry } from '@/lib/ai/externalCommercialVerifierRegistry';
import {
  COMMERCIAL_POSTGRES_CONSTRAINTS,
  COMMERCIAL_POSTGRES_HARDENING_TRIGGERS,
  COMMERCIAL_POSTGRES_MIGRATIONS,
  COMMERCIAL_POSTGRES_TABLES,
  commercialPostgresMigrationChecksumEnvKey,
  type CommercialPostgresMigration,
} from '@/lib/commercial-readiness';
import { loadTrustedCommercialWorkers } from '@/lib/precision-cad-agent/commercialWorkerReceipt';
import { assertAiDesignSourceArtifactSchema } from '@/lib/ai/aiDesignSourceArtifactStore';
import { assertAiDesignPostgresAuthority } from '@/lib/ai/aiDesignPostgresAuthority';
import { aiDesignDurablePersistenceEnabled } from '@/lib/ai/aiDesignDeploymentMode';

export const dynamic = 'force-dynamic';

const REDIS_TIMEOUT_MS = 1_500;
const COMMERCIAL_WORKER_HEALTH_SCHEMA = 'nexyfab.precision-cad-commercial-worker-health.v1';
const COMMERCIAL_EXECUTION_CONTRACT = 'nexyfab.precision-cad-commercial-execution.v3';
const COMMERCIAL_WORKER_SELF_TEST_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const SHA256 = /^[a-f0-9]{64}$/;

type ComponentStatus = 'ok' | 'error' | 'skipped';

interface ComponentCheck {
  status: ComponentStatus;
  responseMs?: number;
  required: boolean;
}

function redisRequired(): boolean {
  if (process.env.NEXYFAB_COMMERCIAL_MODE === '1') return true;
  if (process.env.NODE_ENV === 'production') return true;
  return ['production', 'prod', 'live'].includes(
    process.env.RAILWAY_ENVIRONMENT_NAME?.trim().toLowerCase() ?? '',
  );
}

function railwayProductionEnvironment(): boolean {
  return ['production', 'prod', 'live'].includes(
    process.env.RAILWAY_ENVIRONMENT_NAME?.trim().toLowerCase() ?? '',
  );
}

function explicitWebPublicNoPaymentMode(): boolean {
  return railwayProductionEnvironment()
    && process.env.NEXYFAB_RELEASE_CHANNEL === 'web-public'
    && process.env.NEXYFAB_COMMERCIAL_MODE === '0'
    && process.env.NEXYFAB_PRECISION_CAD_COMMERCIAL_MODE === '0'
    && process.env.NEXYFAB_AI_DESIGN_DURABLE_MODE === '1'
    && process.env.NEXT_PUBLIC_NEXYFAB_AI_MODEL_BETA_ACCESS === '1'
    && process.env.NEXYFAB_PAYMENTS_ENABLED === 'false';
}

function productionCommercialModeRequired(): boolean {
  return railwayProductionEnvironment() && !explicitWebPublicNoPaymentMode();
}

type AiModelAccessCheck = ComponentCheck & {
  mode?: 'plan_tiered' | 'no_payment_beta_all_models';
  providers?: readonly ['openai', 'qwen', 'deepseek'];
};

function checkAiModelAccess(): AiModelAccessCheck {
  const required = railwayProductionEnvironment()
    && process.env.NEXYFAB_RELEASE_CHANNEL === 'web-public';
  if (!required) return { status: 'skipped', required: false, mode: 'plan_tiered' };

  const qwenKey = process.env.QWEN_API_KEY?.trim() || process.env.DASHSCOPE_API_KEY?.trim();
  const qwenBaseUrl = process.env.QWEN_BASE_URL?.trim();
  let officialQwenBaseUrl = false;
  try {
    const parsed = new URL(qwenBaseUrl ?? '');
    officialQwenBaseUrl = parsed.protocol === 'https:'
      && (parsed.hostname === 'aliyuncs.com' || parsed.hostname.endsWith('.aliyuncs.com'));
  } catch { /* fail closed below */ }

  if (process.env.NEXT_PUBLIC_NEXYFAB_AI_MODEL_BETA_ACCESS !== '1'
      || !process.env.OPENAI_API_KEY?.trim()
      || !qwenKey
      || !process.env.DEEPSEEK_API_KEY?.trim()
      || !officialQwenBaseUrl) {
    return { status: 'error', required: true };
  }
  return {
    status: 'ok',
    required: true,
    mode: 'no_payment_beta_all_models',
    providers: ['openai', 'qwen', 'deepseek'],
  };
}

function expectedMigrationChecksum(version: CommercialPostgresMigration): string | undefined {
  return process.env[commercialPostgresMigrationChecksumEnvKey(version)]?.trim();
}

function validCommercialWorkerHealth(
  value: unknown,
  registeredWorkers: Readonly<Record<string, { nativeExecutableSha256?: string; nativeInvocationSha256?: string }>>,
  now = Date.now(),
): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const health = value as Record<string, unknown>;
  const selfTestAt = Date.parse(String(health.lastSelfTestAt ?? ''));
  const workerIdentity = typeof health.workerIdentity === 'string' ? health.workerIdentity : '';
  const registered = registeredWorkers[workerIdentity];
  return health.schema === COMMERCIAL_WORKER_HEALTH_SCHEMA
    && health.status === 'READY'
    && health.executionContract === COMMERCIAL_EXECUTION_CONTRACT
    && health.claimConsumer === 'ACTIVE'
    && health.inputArtifactReadback === 'PASS'
    && health.nativeExecution === 'PASS'
    && health.artifactUpload === 'PASS'
    && health.signedCallback === 'PASS'
    && Boolean(registered)
    && SHA256.test(String(health.nativeExecutableSha256 ?? ''))
    && health.nativeExecutableSha256 === registered?.nativeExecutableSha256
    && SHA256.test(String(health.nativeInvocationSha256 ?? ''))
    && health.nativeInvocationSha256 === registered?.nativeInvocationSha256
    && SHA256.test(String(health.selfTestReceiptSha256 ?? ''))
    && Number.isFinite(selfTestAt)
    && selfTestAt <= now + 5 * 60 * 1000
    && now - selfTestAt <= COMMERCIAL_WORKER_SELF_TEST_MAX_AGE_MS;
}

async function checkDatabase(): Promise<ComponentCheck & {
  backend?: string;
  aiDesignPersistence?: 'postgres_authoritative' | 'reference';
}> {
  const started = Date.now();
  try {
    const db = getDbAdapter();
    await db.queryOne('SELECT 1');
    if (explicitWebPublicNoPaymentMode()) await assertAiDesignSourceArtifactSchema(db);
    if (aiDesignDurablePersistenceEnabled()) await assertAiDesignPostgresAuthority(db);
    if (process.env.NEXYFAB_COMMERCIAL_MODE === '1') {
      if (db.backend !== 'postgres') throw new Error('postgres required');
      for (const version of COMMERCIAL_POSTGRES_MIGRATIONS) {
        const migration = await db.queryOne<{ version: number; checksum: string }>('SELECT version, checksum FROM nf_schema_migrations WHERE version = ?', version);
        const expected = expectedMigrationChecksum(version);
        if (migration?.version !== version || !/^[a-f0-9]{64}$/.test(migration.checksum ?? '') || !expected || migration.checksum !== expected) throw new Error('migration mismatch');
      }
      const tableNames = COMMERCIAL_POSTGRES_TABLES.map(name => `'${name}'`).join(',');
      const tables = await db.queryOne<{ count: number }>(`SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN (${tableNames})`);
      if (Number(tables?.count) !== COMMERCIAL_POSTGRES_TABLES.length) throw new Error('commercial tables missing');
      const constraintPairs = COMMERCIAL_POSTGRES_CONSTRAINTS.map(([table, name]) => `(r.relname = '${table}' AND c.conname = '${name}')`).join(' OR ');
      const constraints = await db.queryOne<{ count: number }>(`SELECT COUNT(*) AS count FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid WHERE r.relnamespace = 'public'::regnamespace AND (${constraintPairs})`);
      if (Number(constraints?.count) !== COMMERCIAL_POSTGRES_CONSTRAINTS.length) throw new Error('commercial hardening constraints missing');
      const triggerPairs = COMMERCIAL_POSTGRES_HARDENING_TRIGGERS.map(([table, name]) => `(r.relname = '${table}' AND t.tgname = '${name}')`).join(' OR ');
      const triggers = await db.queryOne<{ count: number }>(`SELECT COUNT(*) AS count FROM pg_trigger t JOIN pg_class r ON r.oid = t.tgrelid WHERE r.relnamespace = 'public'::regnamespace AND NOT t.tgisinternal AND (${triggerPairs})`);
      if (Number(triggers?.count) !== COMMERCIAL_POSTGRES_HARDENING_TRIGGERS.length) throw new Error('commercial hardening triggers missing');
    }
    return {
      status: 'ok', required: true, responseMs: Date.now() - started, backend: db.backend,
      aiDesignPersistence: aiDesignDurablePersistenceEnabled() ? 'postgres_authoritative' : 'reference',
    };
  } catch {
    return { status: 'error', required: true, responseMs: Date.now() - started };
  }
}

async function checkCommercialBoundary(): Promise<ComponentCheck> {
  const required = process.env.NEXYFAB_COMMERCIAL_MODE === '1' || productionCommercialModeRequired();
  if (!required) return { status: 'skipped', required: false };
  // A production Railway service must never make the commercial checks
  // disappear merely because the mode flag was omitted or misspelled. The
  // only non-commercial production exception is the exact web-public mode:
  // payments and Precision CAD commerce are both explicitly disabled.
  if (process.env.NEXYFAB_COMMERCIAL_MODE !== '1') return { status: 'error', required: true };
  const requiredValues = [
    'NEXYFAB_BUILD_ID',
    ...COMMERCIAL_POSTGRES_MIGRATIONS.map(commercialPostgresMigrationChecksumEnvKey),
    'OBJECT_STORAGE_PRIVATE_BUCKET', 'S3_BUCKET', 'GENERATION_EVIDENCE_SIGNING_SECRET',
    'CRON_SECRET', 'NEXYFAB_AGENT_APPROVAL_SECRET', 'EXTERNAL_WORKER_ORCHESTRATOR_HEALTH_URL',
    'NEXYFAB_COMMERCIAL_WORKER_KEYS_JSON', 'NEXYFAB_COMMERCIAL_WORKER_CLAIM_SECRET',
    'NEXYFAB_COMMERCIAL_TRANSPORT_SECRET', 'NEXYFAB_COMMERCIAL_CALLBACK_SECRET',
    'NEXYFAB_COMMERCIAL_CALLBACK_URL', 'NEXYFAB_EXTERNAL_VERIFIER_REGISTRY_JSON',
    'NEXYFAB_EXTERNAL_VERIFIER_INTERNAL_SECRET',
  ];
  const commonTrust = loadServerAgenticCommercialTrust(); const workers = loadTrustedCommercialWorkers(); const verifiers = loadExternalCommercialVerifierRegistry();
  if (process.env.NEXYFAB_PRECISION_CAD_COMMERCIAL_MODE !== '1' || requiredValues.some(key => !process.env[key]?.trim()) || !commonTrust.ok || !workers || !verifiers) return { status: 'error', required: true };
  const workerFingerprints = new Set(Object.values(workers).map(item => item.fingerprintSha256));
  if (verifiers.identities.some(item => workerFingerprints.has(item.fingerprintSha256))) return { status: 'error', required: true };
  const started = Date.now();
  try {
    const response = await fetch(process.env.EXTERNAL_WORKER_ORCHESTRATOR_HEALTH_URL!, { method: 'GET', headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(REDIS_TIMEOUT_MS) });
    if (!response.ok) throw new Error('worker unavailable');
    const raw = await response.text();
    if (new TextEncoder().encode(raw).byteLength > 32 * 1024) throw new Error('worker health oversized');
    const health = JSON.parse(raw) as unknown;
    if (!validCommercialWorkerHealth(health, workers)) throw new Error('worker self-test unavailable');
    return { status: 'ok', required: true, responseMs: Date.now() - started };
  } catch { return { status: 'error', required: true, responseMs: Date.now() - started }; }
}

async function checkRedis(required: boolean): Promise<ComponentCheck> {
  if (!required) return { status: 'skipped', required: false };
  const url = process.env.REDIS_URL?.trim();
  if (!url) return { status: 'error', required: true };

  const started = Date.now();
  let redis: Redis | null = null;

  try {
    redis = new IORedis(url, {
      lazyConnect: true,
      connectTimeout: REDIS_TIMEOUT_MS,
      commandTimeout: REDIS_TIMEOUT_MS,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
      enableOfflineQueue: false,
    });
    await redis.connect();
    const pong = await redis.ping();
    if (pong !== 'PONG') throw new Error('unexpected redis response');
    return { status: 'ok', required: true, responseMs: Date.now() - started };
  } catch {
    return { status: 'error', required: true, responseMs: Date.now() - started };
  } finally {
    // This probe owns a short-lived client. Disconnect synchronously so a
    // failed readiness request cannot leave a reconnecting Redis socket open.
    redis?.disconnect();
  }
}

export async function GET() {
  const redisIsRequired = redisRequired();
  const [db, redis, commercialBoundary] = await Promise.all([
    checkDatabase(),
    checkRedis(redisIsRequired),
    checkCommercialBoundary(),
  ]);
  const aiModelAccess = checkAiModelAccess();
  const ready = db.status === 'ok'
    && (redis.status === 'ok' || redis.status === 'skipped')
    && (commercialBoundary.status === 'ok' || commercialBoundary.status === 'skipped')
    && (aiModelAccess.status === 'ok' || aiModelAccess.status === 'skipped');

  return NextResponse.json(
    {
      status: ready ? 'ok' : 'error',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      db,
      redis,
      aiModelAccess,
      commercialBoundary,
    },
    { status: ready ? 200 : 503 },
  );
}
