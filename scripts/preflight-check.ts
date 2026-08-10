#!/usr/bin/env tsx
/**
 * Pre-launch preflight — verifies that the deployed env + DB are in the
 * state expected by recent code changes.
 *
 * Usage (local dev): `npx tsx scripts/preflight-check.ts`
 * Usage (Railway):   add `node-tsx scripts/preflight-check.ts` to release cmd
 *                    or run via `railway run npx tsx scripts/preflight-check.ts`
 *
 * Exits non-zero if anything critical is missing — wire into CI to block
 * deploys that would fail at runtime.
 */
import path from 'path';
import fs from 'fs';
import { commercialReadinessIssues } from '../src/lib/commercial-readiness';

const ROOT = path.join(__dirname, '..');

// Load local env files for developer runs only. `railway run` injects the
// selected remote environment; supplementing missing production keys from a
// workstation .env would make the preflight report a false pass.
function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  for (const raw of fs.readFileSync(filePath, 'utf-8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
const railwayEnvironmentInjected = Boolean(
  process.env.RAILWAY_ENVIRONMENT_ID
  || process.env.RAILWAY_ENVIRONMENT_NAME
  || process.env.RAILWAY_SERVICE_ID,
);
if (!railwayEnvironmentInjected) {
  loadEnvFile(path.resolve(ROOT, '../..', '.env'));
  loadEnvFile(path.join(ROOT, '.env.local'));
}

const REQUIRED_ENV: Array<{ key: string; reason: string; critical: boolean }> = [
  { key: 'DATABASE_URL',         reason: 'Postgres connection',         critical: true },
  { key: 'CRON_SECRET',          reason: 'Cron auth (8 jobs)',          critical: true },
  { key: 'NEXYFAB_ADMIN_EMAIL',  reason: 'Operator notifications',      critical: true },
  { key: 'NEXT_PUBLIC_AUTH_URL', reason: 'Auth server endpoint',        critical: true },
  { key: 'SMTP_HOST',            reason: 'Email send',                  critical: true },
  { key: 'SMTP_USER',            reason: 'Email auth',                  critical: true },
  { key: 'SMTP_PASS',            reason: 'Email auth',                  critical: true },
  { key: 'REDIS_URL',            reason: 'Distributed rate limiting',   critical: true },
  { key: 'RECAPTCHA_SECRET_KEY', reason: 'Public form bot protection',  critical: true },
  { key: 'NEXT_PUBLIC_RECAPTCHA_SITE_KEY', reason: 'Browser bot challenge', critical: true },
  { key: 'RECAPTCHA_ALLOWED_HOSTNAMES', reason: 'Challenge hostname binding', critical: true },
  { key: 'SECURITY_GATE_MODE',   reason: 'Explicit security rollout mode', critical: true },
  { key: 'JWT_SECRET',           reason: 'Legacy HS256 fallback',       critical: false },
  { key: 'SCAD_AGENT_SESSION_SECRET', reason: 'User-bound AI CAD session signatures', critical: true },
  { key: 'NEXT_PUBLIC_NEXYSYS_URL', reason: 'Cross-product links',      critical: false },
];

// PostgreSQL is managed by one idempotent schema file rather than SQLite's
// numbered migration array. Check capabilities that the running release
// actually needs; requiring synthetic version rows rejects healthy databases.
const REQUIRED_TABLES = [
  'nf_partner_invites',
  'nf_partner_agreement_consents',
  'nf_escrow_transactions',
  'nf_payment_attempts',
  'nf_manufacturing_lineage',
];

const REQUIRED_COLUMNS: Array<[string, string]> = [
  ['nf_users', 'pro_grace_until'],
  ['nf_orders', 'quote_id'],
  ['nf_orders', 'payment_status'],
  ['nf_orders', 'toss_order_id'],
  ['nf_orders', 'lineage_id'],
  ['nf_orders', 'artifact_sha256'],
  ['nf_rfqs', 'lineage_id'],
  ['nf_quotes', 'lineage_id'],
];

interface Result { ok: boolean; failures: string[]; warnings: string[] }

async function checkEnv(): Promise<Result> {
  const failures: string[] = [];
  const warnings: string[] = [];
  const missingRequiredKeys = new Set<string>();
  for (const { key, reason, critical } of REQUIRED_ENV) {
    const v = process.env[key];
    if (!v || v.trim() === '') {
      missingRequiredKeys.add(key);
      const msg = `${key} (${reason})`;
      if (critical) failures.push(msg); else warnings.push(msg);
    }
  }
  // Spot-check obvious dev values that leaked to prod.
  if (process.env.NEXT_PUBLIC_AUTH_URL?.includes('localhost')) {
    failures.push('NEXT_PUBLIC_AUTH_URL points to localhost — production deploy will break');
  }
  if (process.env.TOSS_SECRET_KEY?.startsWith('test_')) {
    warnings.push('TOSS_SECRET_KEY is a TEST key — fine for staging, swap to live before launch');
  }

  // Keep the deploy preflight aligned with the fail-closed commercial gate.
  // The web service delegates native CAD work to isolated Railway workers; it
  // must not require or launch Docker/OpenSCAD inside the public web container.
  for (const issue of commercialReadinessIssues(process.env)) {
    const referencedKey = issue.message.match(/^([A-Z0-9_]+)/)?.[1];
    if (referencedKey && missingRequiredKeys.has(referencedKey)) continue;
    failures.push(`Commercial readiness ${issue.code}: ${issue.message}`);
  }
  return { ok: failures.length === 0, failures, warnings };
}

async function checkMigrations(): Promise<Result> {
  const failures: string[] = [];
  const warnings: string[] = [];
  if (!process.env.DATABASE_URL) {
    return { ok: false, failures: ['DATABASE_URL missing — cannot verify migrations'], warnings: [] };
  }
  try {
    const { Client } = await import('pg');
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      for (const table of REQUIRED_TABLES) {
        const result = await client.query<{ exists: boolean }>(
          `SELECT to_regclass($1) IS NOT NULL AS exists`,
          [`public.${table}`],
        );
        if (!result.rows[0]?.exists) failures.push(`${table} table missing`);
      }
      for (const [table, col] of REQUIRED_COLUMNS) {
        const r = await client.query<{ exists: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM information_schema.columns
             WHERE table_name = $1 AND column_name = $2
           ) as exists`,
          [table, col],
        );
        if (!r.rows[0].exists) failures.push(`${table}.${col} column missing`);
      }
    } finally {
      await client.end();
    }
  } catch (e) {
    failures.push(`DB connect failed: ${(e as Error).message}`);
  }
  return { ok: failures.length === 0, failures, warnings };
}

async function checkRedis(): Promise<Result> {
  if (!process.env.REDIS_URL) {
    return { ok: false, failures: ['REDIS_URL missing — distributed rate limiting unavailable'], warnings: [] };
  }
  let connectionError: Error | null = null;
  try {
    const { default: Redis } = await import('ioredis');
    const redis = new Redis(process.env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 3_000,
    });
    redis.on('error', error => {
      connectionError = error;
    });
    try {
      await redis.connect();
      const pong = await redis.ping();
      if (pong !== 'PONG') throw new Error('unexpected PING response');
    } finally {
      redis.disconnect();
    }
    return { ok: true, failures: [], warnings: [] };
  } catch (error) {
    const cause = connectionError ?? (error instanceof Error ? error : new Error(String(error)));
    return { ok: false, failures: [`Redis connection failed: ${cause.message}`], warnings: [] };
  }
}

async function main() {
  console.log('[preflight] env check…');
  const env = await checkEnv();
  console.log('[preflight] migration check…');
  const mig = await checkMigrations();
  console.log('[preflight] Redis check…');
  const redis = await checkRedis();

  const allFailures = [
    ...env.failures.map(f => `ENV: ${f}`),
    ...mig.failures.map(f => `DB: ${f}`),
    ...redis.failures.map(f => `REDIS: ${f}`),
  ];
  const allWarnings = [
    ...env.warnings.map(w => `ENV: ${w}`),
    ...mig.warnings.map(w => `DB: ${w}`),
    ...redis.warnings.map(w => `REDIS: ${w}`),
  ];

  if (allFailures.length === 0) {
    console.log('\n✓ All preflight checks passed.');
  } else {
    console.error(`\n✗ ${allFailures.length} blocker(s):`);
    for (const f of allFailures) console.error(`  - ${f}`);
  }
  if (allWarnings.length > 0) {
    console.warn(`\n⚠ ${allWarnings.length} warning(s):`);
    for (const w of allWarnings) console.warn(`  - ${w}`);
  }
  process.exit(allFailures.length === 0 ? 0 : 1);
}

void main();
