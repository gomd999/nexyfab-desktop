#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_DISTINCT_ENDPOINTS = [
  'DATABASE_URL',
  'REDIS_URL',
];

const REQUIRED_DISTINCT_VALUES = [
  'JWT_SECRET',
  'ADMIN_SECRET',
  'AUTH_SYNC_SECRET',
  'CRON_SECRET',
  'DEV_SEED_KEY',
  'NEXT_SERVER_ACTIONS_ENCRYPTION_KEY',
  'SELFTEST_TOKEN',
  'ADMIN_PASSWORD_HASH',
];

const DISTINCT_IF_PRESENT = [
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'GOOGLE_CLIENT_SECRET',
  'SMTP_PASS',
];

const PAYMENT_PROVIDERS = [
  {
    id: 'dodo',
    credentials: ['DODO_API_KEY', 'DODO_WEBHOOK_SECRET'],
    sandbox(variables) { return variables.DODO_MODE === 'test'; },
    sandboxDetail: 'DODO_MODE must be test when Dodo is enabled in staging.',
  },
  {
    id: 'toss',
    credentials: ['TOSS_SECRET_KEY', 'TOSS_WEBHOOK_SECRET', 'NEXT_PUBLIC_TOSS_CLIENT_KEY'],
    sandbox(variables) {
      return /^test_/i.test(variables.TOSS_SECRET_KEY ?? '')
        && /^test_/i.test(variables.NEXT_PUBLIC_TOSS_CLIENT_KEY ?? '');
    },
    sandboxDetail: 'Toss staging credentials must use the test_ prefix.',
  },
  {
    id: 'stripe',
    credentials: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
    sandbox(variables) { return /^sk_test_/i.test(variables.STRIPE_SECRET_KEY ?? ''); },
    sandboxDetail: 'Stripe staging secret must use the sk_test_ prefix.',
  },
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

function endpointHostname(value) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function addCheck(checks, id, pass, detail) {
  checks.push({ id, pass: Boolean(pass), detail });
}

function providerConfigured(variables, names) {
  return names.some(name => present(variables[name]));
}

function railwayInternalEndpointIsEnvironmentScoped(productionValue, stagingValue, production, staging, productionEnvironment, stagingEnvironment) {
  if (comparableEndpoint(productionValue) !== comparableEndpoint(stagingValue)) return false;
  if (!endpointHostname(stagingValue).endsWith('.railway.internal')) return false;
  if (productionEnvironment === stagingEnvironment) return false;
  return present(production.RAILWAY_ENVIRONMENT_ID)
    && present(staging.RAILWAY_ENVIRONMENT_ID)
    && production.RAILWAY_ENVIRONMENT_ID !== staging.RAILWAY_ENVIRONMENT_ID;
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

  for (const name of REQUIRED_DISTINCT_ENDPOINTS) {
    const productionValue = production[name];
    const stagingValue = staging[name];
    addCheck(checks, `${name.toLowerCase()}_present`, present(stagingValue), present(stagingValue) ? 'Present in staging.' : 'Missing in staging.');
    const endpointDistinct = present(productionValue)
      && present(stagingValue)
      && comparableEndpoint(productionValue) !== comparableEndpoint(stagingValue);
    const environmentScoped = present(productionValue)
      && present(stagingValue)
      && railwayInternalEndpointIsEnvironmentScoped(
        productionValue,
        stagingValue,
        production,
        staging,
        productionEnvironment,
        stagingEnvironment,
      );
    const isolated = endpointDistinct || environmentScoped;
    addCheck(
      checks,
      `${name.toLowerCase()}_isolated`,
      isolated,
      environmentScoped
        ? 'Railway internal endpoint is isolated by distinct environment IDs.'
        : isolated
          ? 'Staging endpoint differs from production.'
          : 'Missing or shared with production.',
    );
  }

  for (const name of REQUIRED_DISTINCT_VALUES) {
    const productionValue = production[name];
    const stagingValue = staging[name];
    const required = present(productionValue);
    const isolated = present(stagingValue) && (!required || productionValue !== stagingValue);
    addCheck(checks, `${name.toLowerCase()}_present`, present(stagingValue), present(stagingValue) ? 'Present in staging.' : 'Missing in staging.');
    addCheck(checks, `${name.toLowerCase()}_isolated`, isolated, isolated ? 'Staging secret differs from production.' : 'Missing or shared with production.');
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
    const disabled = !present(staging[name]);
    const isolated = disabled || production[name] !== staging[name];
    addCheck(
      checks,
      `${name.toLowerCase()}_isolated_or_disabled`,
      isolated,
      disabled ? 'Integration credential is disabled in staging.' : isolated ? 'Staging credential differs from production.' : 'Shared with production.',
    );
  }

  for (const provider of PAYMENT_PROVIDERS) {
    if (!providerConfigured(production, provider.credentials) && !providerConfigured(staging, provider.credentials)) continue;
    const stagingEnabled = providerConfigured(staging, provider.credentials);
    if (!stagingEnabled) {
      addCheck(checks, `${provider.id}_staging_disabled`, true, `${provider.id} payment is fail-closed in staging.`);
      continue;
    }
    const complete = provider.credentials.every(name => present(staging[name]));
    addCheck(checks, `${provider.id}_credentials_complete`, complete, complete ? 'Staging payment credentials are complete.' : 'Staging payment credentials are incomplete.');
    for (const name of provider.credentials) {
      const isolated = present(staging[name]) && (!present(production[name]) || production[name] !== staging[name]);
      addCheck(checks, `${name.toLowerCase()}_isolated`, isolated, isolated ? 'Staging credential differs from production.' : 'Missing or shared with production.');
    }
    addCheck(checks, `${provider.id}_sandbox_mode`, provider.sandbox(staging), provider.sandbox(staging) ? `${provider.id} sandbox mode is enabled.` : provider.sandboxDetail);
  }

  const dodoEnabled = providerConfigured(staging, ['DODO_API_KEY', 'DODO_WEBHOOK_SECRET']);
  const productionProductKeys = Object.keys(production).filter(name => name.startsWith('DODO_PRODUCT_') && present(production[name]));
  for (const name of productionProductKeys) {
    const disabled = !dodoEnabled && !present(staging[name]);
    const isolated = disabled || (present(staging[name]) && production[name] !== staging[name]);
    addCheck(checks, `${name.toLowerCase()}_isolated_or_disabled`, isolated, disabled ? 'Dodo product is disabled in staging.' : isolated ? 'Staging product ID differs from production.' : 'Missing or shared with production.');
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
  const outputFile = arg('out', '');
  if (productionEnvironment === stagingEnvironment) throw new Error('Production and staging environments must be distinct.');
  const production = variables(service, productionEnvironment);
  const staging = variables(service, stagingEnvironment);
  const receipt = auditRailwayEnvironmentIsolation(production, staging, { productionEnvironment, stagingEnvironment });
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  if (outputFile) {
    const resolvedOutput = path.resolve(outputFile);
    mkdirSync(path.dirname(resolvedOutput), { recursive: true });
    writeFileSync(resolvedOutput, serialized, 'utf8');
  }
  process.stdout.write(serialized);
  if (!receipt.ok) process.exitCode = 1;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main().catch(error => {
    console.error(`[railway-environment-isolation] ${error instanceof Error ? error.message : 'audit failed'}`);
    process.exitCode = 1;
  });
}
