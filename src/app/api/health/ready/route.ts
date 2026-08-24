import { NextResponse } from 'next/server';
import IORedis, { type Redis } from 'ioredis';
import { getDbAdapter } from '@/lib/db-adapter';
import { loadServerAgenticCommercialTrust } from '@/lib/ai/serverAgenticCommercialTrust';
import { loadExternalCommercialVerifierRegistry } from '@/lib/ai/externalCommercialVerifierRegistry';
import { loadTrustedCommercialWorkers } from '@/lib/precision-cad-agent/commercialWorkerReceipt';

export const dynamic = 'force-dynamic';

const REDIS_TIMEOUT_MS = 1_500;
const COMMERCIAL_MIGRATIONS = [
  2026082202, 2026082203, 2026082204, 2026082205, 2026082206,
  2026082207, 2026082208, 2026082301, 2026082401, 2026082402,
] as const;
const COMMERCIAL_TABLES = [
  'nf_precision_cad_execution_journal', 'nf_precision_cad_execution_events',
  'nf_precision_cad_approval_challenges', 'nf_precision_cad_tool_claims',
  'nf_precision_cad_worker_receipts', 'nf_agentic_commercial_receipts',
  'nf_precision_cad_commercial_outbox', 'nf_precision_cad_commercial_callbacks',
  'nf_external_commercial_evidence', 'nf_external_commercial_verification_requests',
  'nf_external_commercial_verifier_claims', 'nf_external_commercial_verifier_callbacks',
  'nf_precision_cad_commercial_artifact_snapshots', 'nf_precision_cad_commercial_worker_artifacts',
  'nf_precision_cad_commercial_native_parser_receipts', 'nf_precision_cad_commercial_persistence_receipts',
  'nf_precision_cad_commercial_workspace_commits', 'nf_agentic_commercial_verified_receipts',
  'nf_agentic_commercial_verified_ledger',
  'nf_commercial_generation_runs', 'nf_commercial_generation_revisions', 'nf_commercial_generation_receipt_bindings',
  'nf_cad_canonical_brep_mappings',
  'nf_cad_canonical_v2_revisions', 'nf_cad_canonical_v2_heads',
  'nf_cad_canonical_v2_invalidations', 'nf_cad_canonical_v2_locks',
  'nf_cad_canonical_v2_audit',
  'nf_ai_design_workspace_runtimes', 'nf_ai_design_complex_workspaces',
  'nf_ai_design_artifacts',
] as const;
const COMMERCIAL_CONSTRAINTS = [
  ['nf_agentic_commercial_receipts', 'nf_agentic_commercial_receipts_execution_fk'],
  ['nf_precision_cad_commercial_worker_artifacts', 'nf_worker_artifact_private_key_ck'],
  ['nf_external_commercial_evidence', 'nf_external_evidence_private_key_ck'],
  ['nf_agentic_commercial_receipts', 'nf_agentic_receipt_private_key_ck'],
  ['nf_cad_canonical_v2_revisions', 'nf_cad_v2_revision_identity_uq'],
  ['nf_cad_canonical_v2_heads', 'nf_cad_v2_head_revision_fk'],
  ['nf_cad_canonical_v2_invalidations', 'nf_cad_v2_invalidation_revision_fk'],
  ['nf_cad_canonical_v2_audit', 'nf_cad_v2_audit_revision_fk'],
  ['nf_ai_design_workspace_runtimes', 'nf_ai_design_workspace_runtimes_pkey'],
  ['nf_ai_design_complex_workspaces', 'nf_ai_design_complex_workspaces_pkey'],
  ['nf_ai_design_artifacts', 'nf_ai_design_artifacts_pkey'],
] as const;
const COMMERCIAL_HARDENING_TRIGGERS = [
  ['nf_precision_cad_execution_journal', 'nf_precision_cad_execution_journal_identity_immutable'],
  ['nf_precision_cad_execution_events', 'nf_precision_cad_execution_events_immutable'],
  ['nf_external_commercial_evidence', 'nf_external_commercial_evidence_immutable'],
  ['nf_external_commercial_verifier_callbacks', 'nf_external_commercial_verifier_callbacks_immutable'],
  ['nf_precision_cad_commercial_callbacks', 'nf_precision_cad_commercial_callbacks_immutable'],
  ['nf_commercial_generation_receipt_bindings', 'nf_commercial_generation_receipt_binding_identity_immutable'],
  ['nf_external_commercial_verification_requests', 'nf_external_verification_request_identity_immutable'],
  ['nf_commercial_generation_runs', 'nf_commercial_generation_run_identity_immutable'],
  ['nf_cad_canonical_brep_mappings', 'nf_cad_canonical_brep_mapping_identity_immutable'],
  ['nf_cad_canonical_v2_revisions', 'nf_cad_v2_revisions_immutable'],
  ['nf_cad_canonical_v2_invalidations', 'nf_cad_v2_invalidations_immutable'],
  ['nf_cad_canonical_v2_audit', 'nf_cad_v2_audit_immutable'],
  ['nf_cad_canonical_v2_heads', 'nf_cad_v2_head_identity_immutable'],
  ['nf_cad_canonical_v2_locks', 'nf_cad_v2_lock_identity_immutable'],
  ['nf_ai_design_workspace_runtimes', 'nf_ai_design_runtime_identity_immutable'],
  ['nf_ai_design_complex_workspaces', 'nf_ai_design_complex_identity_immutable'],
  ['nf_ai_design_artifacts', 'nf_ai_design_artifact_immutable'],
] as const;

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

function expectedMigrationChecksum(version: typeof COMMERCIAL_MIGRATIONS[number]): string | undefined {
  return version === 2026082401
    ? process.env.CANONICAL_CAD_REVISION_MIGRATION_CHECKSUM?.trim()
    : process.env[`POSTGRES_MIGRATION_CHECKSUM_${version}`]?.trim();
}

async function checkDatabase(): Promise<ComponentCheck & { backend?: string }> {
  const started = Date.now();
  try {
    const db = getDbAdapter();
    await db.queryOne('SELECT 1');
    if (process.env.NEXYFAB_COMMERCIAL_MODE === '1') {
      if (db.backend !== 'postgres') throw new Error('postgres required');
      for (const version of COMMERCIAL_MIGRATIONS) {
        const migration = await db.queryOne<{ version: number; checksum: string }>('SELECT version, checksum FROM nf_schema_migrations WHERE version = ?', version);
        const expected = expectedMigrationChecksum(version);
        if (migration?.version !== version || !/^[a-f0-9]{64}$/.test(migration.checksum ?? '') || !expected || migration.checksum !== expected) throw new Error('migration mismatch');
      }
      const tableNames = COMMERCIAL_TABLES.map(name => `'${name}'`).join(',');
      const tables = await db.queryOne<{ count: number }>(`SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN (${tableNames})`);
      if (Number(tables?.count) !== COMMERCIAL_TABLES.length) throw new Error('commercial tables missing');
      const constraintPairs = COMMERCIAL_CONSTRAINTS.map(([table, name]) => `(r.relname = '${table}' AND c.conname = '${name}')`).join(' OR ');
      const constraints = await db.queryOne<{ count: number }>(`SELECT COUNT(*) AS count FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid WHERE r.relnamespace = 'public'::regnamespace AND (${constraintPairs})`);
      if (Number(constraints?.count) !== COMMERCIAL_CONSTRAINTS.length) throw new Error('commercial hardening constraints missing');
      const triggerPairs = COMMERCIAL_HARDENING_TRIGGERS.map(([table, name]) => `(r.relname = '${table}' AND t.tgname = '${name}')`).join(' OR ');
      const triggers = await db.queryOne<{ count: number }>(`SELECT COUNT(*) AS count FROM pg_trigger t JOIN pg_class r ON r.oid = t.tgrelid WHERE r.relnamespace = 'public'::regnamespace AND NOT t.tgisinternal AND (${triggerPairs})`);
      if (Number(triggers?.count) !== COMMERCIAL_HARDENING_TRIGGERS.length) throw new Error('commercial hardening triggers missing');
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
  const requiredValues = ['NEXYFAB_BUILD_ID', 'POSTGRES_MIGRATION_CHECKSUM_2026082202', 'POSTGRES_MIGRATION_CHECKSUM_2026082203', 'POSTGRES_MIGRATION_CHECKSUM_2026082204', 'POSTGRES_MIGRATION_CHECKSUM_2026082205', 'POSTGRES_MIGRATION_CHECKSUM_2026082206', 'POSTGRES_MIGRATION_CHECKSUM_2026082207', 'POSTGRES_MIGRATION_CHECKSUM_2026082208', 'POSTGRES_MIGRATION_CHECKSUM_2026082301', 'CANONICAL_CAD_REVISION_MIGRATION_CHECKSUM', 'POSTGRES_MIGRATION_CHECKSUM_2026082402', 'OBJECT_STORAGE_PRIVATE_BUCKET', 'NEXYFAB_AGENT_APPROVAL_SECRET', 'EXTERNAL_WORKER_ORCHESTRATOR_HEALTH_URL', 'NEXYFAB_COMMERCIAL_WORKER_KEYS_JSON', 'NEXYFAB_COMMERCIAL_WORKER_CLAIM_SECRET', 'NEXYFAB_COMMERCIAL_TRANSPORT_SECRET', 'NEXYFAB_COMMERCIAL_CALLBACK_SECRET', 'NEXYFAB_COMMERCIAL_CALLBACK_URL', 'NEXYFAB_EXTERNAL_VERIFIER_REGISTRY_JSON', 'NEXYFAB_EXTERNAL_VERIFIER_INTERNAL_SECRET'];
  const commonTrust = loadServerAgenticCommercialTrust(); const workers = loadTrustedCommercialWorkers(); const verifiers = loadExternalCommercialVerifierRegistry();
  if (process.env.NEXYFAB_PRECISION_CAD_COMMERCIAL_MODE !== '1' || requiredValues.some(key => !process.env[key]?.trim()) || !commonTrust.ok || !workers || !verifiers) return { status: 'error', required: true };
  const workerFingerprints = new Set(Object.values(workers).map(item => item.fingerprintSha256));
  if (verifiers.identities.some(item => workerFingerprints.has(item.fingerprintSha256))) return { status: 'error', required: true };
  const started = Date.now();
  try {
    const response = await fetch(process.env.EXTERNAL_WORKER_ORCHESTRATOR_HEALTH_URL!, { method: 'GET', headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(REDIS_TIMEOUT_MS) });
    if (!response.ok) throw new Error('worker unavailable');
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
