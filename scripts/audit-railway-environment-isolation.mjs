#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_DISTINCT_VALUES = [
  'DATABASE_URL',
  'REDIS_URL',
  'JWT_SECRET',
];

const DISTINCT_IF_PRESENT = [
  'DODO_API_KEY',
  'DODO_WEBHOOK_SECRET',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'TOSS_SECRET_KEY',
  'TOSS_WEBHOOK_SECRET',
  'NEXT_PUBLIC_TOSS_CLIENT_KEY',
];

function arg(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.slice(2).find(value => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function present(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function comparableEndpoint(value) {
  try {
    const url = new URL(value);
    return `${url.protocol.toLowerCase()}//${url.hostname.toLowerCase()}:${url.port || 'default'}${url.pathname}`;
  } catch {
    return value;
  }
}

function addCheck(checks, id, pass, detail) {
  checks.push({ id, pass: Boolean(pass), detail });
}

function providerConfigured(variables, names) {
  return names.some(name => present(variables[name]));
}

/**
 * Audit staging isolation without returning, logging, or persisting secret values.
 */
export function auditRailwayEnvironmentIsolation(production, staging, options = {}) {
  const productionEnvironment = options.productionEnvironment ?? 'production';
  const stagingEnvironment = options.stagingEnvironment ?? 'staging';
  const checks = [];

  addCheck(
    checks,
    'environment_names_distinct',
    productionEnvironment !== stagingEnvironment,
    productionEnvironment === stagingEnvironment ? 'Production and staging names are identical.' : 'Environment names are distinct.',
  );

  for (const name of REQUIRED_DISTINCT_VALUES) {
    const productionValue = production[name];
    const stagingValue = staging[name];
    addCheck(checks, `${name.toLowerCase()}_present`, present(stagingValue), present(stagingValue) ? 'Present in staging.' : 'Missing in staging.');
    const distinct = present(productionValue)
      && present(stagingValue)
      && comparableEndpoint(productionValue) !== comparableEndpoint(stagingValue);
    addCheck(checks, `${name.toLowerCase()}_isolated`, distinct, distinct ? 'Staging value is isolated.' : 'Missing or shared with production.');
  }

  const productionSite = production.NEXT_PUBLIC_SITE_URL;
  const stagingSite = staging.NEXT_PUBLIC_SITE_URL;
  let siteIsHttps = false;
  let siteIsDistinct = false;
  if (present(stagingSite)) {
    try {
      const stageUrl = new URL(stagingSite);
      siteIsHttps = stageUrl.protocol === 'https:';
      siteIsDistinct = !present(productionSite) || stageUrl.host !== new URL(productionSite).host;
    } catch {
      // Invalid URLs fail both checks without exposing their values.
    }
  }
  addCheck(checks, 'site_url_https', siteIsHttps, siteIsHttps ? 'Staging site URL uses HTTPS.' : 'Staging site URL is missing, invalid, or not HTTPS.');
  addCheck(checks, 'site_url_isolated', siteIsDistinct, siteIsDistinct ? 'Staging hostname differs from production.' : 'Staging hostname is missing or shared with production.');

  addCheck(
    checks,
    'cad_quota_fail_closed',
    staging.NEXYFAB_CAD_INDEPENDENT_MODE === '1',
    staging.NEXYFAB_CAD_INDEPENDENT_MODE === '1' ? 'Independent CAD mode is enabled.' : 'NEXYFAB_CAD_INDEPENDENT_MODE must be 1.',
  );

  if (present(production.S3_BUCKET)) {
    const isolatedBucket = present(staging.S3_BUCKET) && production.S3_BUCKET !== staging.S3_BUCKET;
    addCheck(checks, 's3_bucket_isolated', isolatedBucket, isolatedBucket ? 'Staging bucket differs from production.' : 'Staging bucket is missing or shared with production.');
  }

  for (const name of DISTINCT_IF_PRESENT) {
    if (!present(production[name])) continue;
    const isolated = present(staging[name]) && production[name] !== staging[name];
    addCheck(checks, `${name.toLowerCase()}_isolated`, isolated, isolated ? 'Staging credential differs from production.' : 'Staging credential is missing or shared with production.');
  }

  if (providerConfigured(production, ['DODO_API_KEY', 'DODO_WEBHOOK_SECRET'])) {
    addCheck(checks, 'dodo_sandbox_mode', staging.DODO_MODE === 'test', staging.DODO_MODE === 'test' ? 'Dodo test mode is enabled.' : 'DODO_MODE must be test in staging.');
    const productionProductKeys = Object.keys(production).filter(name => name.startsWith('DODO_PRODUCT_') && present(production[name]));
    for (const name of productionProductKeys) {
      const isolated = present(staging[name]) && production[name] !== staging[name];
      addCheck(checks, `${name.toLowerCase()}_isolated`, isolated, isolated ? 'Staging product ID differs from production.' : 'Staging product ID is missing or shared with production.');
    }
  }

  if (providerConfigured(production, ['TOSS_SECRET_KEY', 'NEXT_PUBLIC_TOSS_CLIENT_KEY'])) {
    addCheck(
      checks,
      'toss_sandbox_mode',
      /^test_/i.test(staging.TOSS_SECRET_KEY ?? '') && /^test_/i.test(staging.NEXT_PUBLIC_TOSS_CLIENT_KEY ?? ''),
      /^test_/i.test(staging.TOSS_SECRET_KEY ?? '') && /^test_/i.test(staging.NEXT_PUBLIC_TOSS_CLIENT_KEY ?? '')
        ? 'Toss test credentials are configured.'
        : 'Toss staging credentials must use the test_ prefix.',
    );
  }

  if (providerConfigured(production, ['STRIPE_SECRET_KEY'])) {
    addCheck(
      checks,
      'stripe_sandbox_mode',
      /^sk_test_/i.test(staging.STRIPE_SECRET_KEY ?? ''),
      /^sk_test_/i.test(staging.STRIPE_SECRET_KEY ?? '') ? 'Stripe test credential is configured.' : 'Stripe staging secret must use the sk_test_ prefix.',
    );
  }

  const blockers = checks.filter(check => !check.pass).map(check => check.id);
  return {
    schema: 'nexyfab.railway-environment-isolation.v1',
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    productionEnvironment,
    stagingEnvironment,
    configurationFingerprint: createHash('sha256')
      .update(JSON.stringify({ productionKeys: Object.keys(production).sort(), stagingKeys: Object.keys(staging).sort() }))
      .digest('hex'),
    ok: blockers.length === 0,
    summary: { checks: checks.length, passed: checks.length - blockers.length, failed: blockers.length },
    checks,
    blockers,
    redaction: 'Variable values are compared in memory and are never included in this receipt.',
  };
}

function railwayCommand() {
  const windowsCli = process.platform === 'win32' && process.env.APPDATA
    ? path.join(process.env.APPDATA, 'npm', 'node_modules', '@railway', 'cli', 'bin', 'railway.js')
    : '';
  return windowsCli && existsSync(windowsCli)
    ? { file: process.execPath, prefix: [windowsCli] }
    : { file: 'railway', prefix: [] };
}

function variables(service, environment) {
  const railway = railwayCommand();
  const raw = execFileSync(railway.file, [
    ...railway.prefix,
    'variable', 'list', '--service', service, '--environment', environment, '--json',
  ], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(raw);
}

async function main() {
  const service = arg('service', 'nexyfab.com');
  const productionEnvironment = arg('production', 'production');
  const stagingEnvironment = arg('staging', 'staging');
  if (productionEnvironment === stagingEnvironment) throw new Error('Production and staging environments must be distinct.');
  const production = variables(service, productionEnvironment);
  const staging = variables(service, stagingEnvironment);
  const receipt = auditRailwayEnvironmentIsolation(production, staging, { productionEnvironment, stagingEnvironment });
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  if (!receipt.ok) process.exitCode = 1;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main().catch(error => {
    console.error(`[railway-environment-isolation] ${error instanceof Error ? error.message : 'audit failed'}`);
    process.exitCode = 1;
  });
}
