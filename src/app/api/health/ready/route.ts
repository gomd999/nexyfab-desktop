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

function productionCommercialModeRequired(): boolean {
  return ['production', 'prod', 'live'].includes(
    process.env.RAILWAY_ENVIRONMENT_NAME?.trim().toLowerCase() ?? '',
  );
}

function expectedMigrationChecksum(version: CommercialPostgresMigration): string | undefined {
  return process.env[commercialPostgresMigrationChecksumEnvKey(version)]?.trim();
}

function validCommercialWorkerHealth(
  value: unknown,
  registeredWorkers: ReadonlySet<string>,
  now = Date.now(),
): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const health = value as Record<string, unknown>;
  const selfTestAt = Date.parse(String(health.lastSelfTestAt ?? ''));
  return health.schema === COMMERCIAL_WORKER_HEALTH_SCHEMA
    && health.status === 'READY'
    && health.executionContract === COMMERCIAL_EXECUTION_CONTRACT
    && health.claimConsumer === 'ACTIVE'
    && health.inputArtifactReadback === 'PASS'
    && health.nativeExecution === 'PASS'
    && health.artifactUpload === 'PASS'
    && health.signedCallback === 'PASS'
    && typeof health.workerIdentity === 'string'
    && registeredWorkers.has(health.workerIdentity)
    && SHA256.test(String(health.selfTestReceiptSha256 ?? ''))
    && Number.isFinite(selfTestAt)
    && selfTestAt <= now + 5 * 60 * 1000
    && now - selfTestAt <= COMMERCIAL_WORKER_SELF_TEST_MAX_AGE_MS;
}

async function checkDatabase(): Promise<ComponentCheck & { backend?: string }> {
  const started = Date.now();
  try {
    const db = getDbAdapter();
    await db.queryOne('SELECT 1');
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
    return { status: 'ok', required: true, responseMs: Date.now() - started, backend: db.backend };
  } catch {
    return { status: 'error', required: true, responseMs: Date.now() - started };
  }
}

async function checkCommercialBoundary(): Promise<ComponentCheck> {
  const required = process.env.NEXYFAB_COMMERCIAL_MODE === '1' || productionCommercialModeRequired();
  if (!required) return { status: 'skipped', required: false };
  // A production Railway service must never make the commercial checks
  // disappear merely because the mode flag was omitted or misspelled.
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
    if (!validCommercialWorkerHealth(health, new Set(Object.keys(workers)))) throw new Error('worker self-test unavailable');
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
  const ready = db.status === 'ok' && (redis.status === 'ok' || redis.status === 'skipped') && (commercialBoundary.status === 'ok' || commercialBoundary.status === 'skipped');

  return NextResponse.json(
    {
      status: ready ? 'ok' : 'error',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      db,
      redis,
      commercialBoundary,
    },
    { status: ready ? 200 : 503 },
  );
}
