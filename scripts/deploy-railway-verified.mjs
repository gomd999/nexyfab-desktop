#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifyDeploymentSource } from './verify-deployment-source.mjs';
import { readRegistry } from './workspaces/workspace-registry.mjs';

function arg(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.slice(2).find(value => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

const service = arg('service', 'nexyfab.com');
const environment = arg('environment', 'production');
const site = arg('site', 'https://nexyfab.com');
let expectedBuildId = arg('expected-build-id', process.env.NEXYFAB_EXPECTED_BUILD_ID || '');
const timeoutMs = Number(arg('timeout-ms', '1200000'));
const sourcePath = arg('source', '.');
const canonicalDeploymentRef = arg('canonical-ref', readRegistry().integrationBranch);
const pathAsRoot = process.argv.includes('--path-as-root');
const verifyOnly = process.argv.includes('--verify-only');
const stagingHold = process.argv.includes('--staging-hold');
const webPublic = process.argv.includes('--web-public');
const expectedDeploymentId = arg(
  'expected-deployment-id',
  process.env.NEXYFAB_EXPECTED_DEPLOYMENT_ID || '',
).trim();
const windowsRailwayCli = process.platform === 'win32' && process.env.APPDATA
  ? path.join(process.env.APPDATA, 'npm', 'node_modules', '@railway', 'cli', 'bin', 'railway.js')
  : '';
const railwayCommand = windowsRailwayCli && existsSync(windowsRailwayCli) ? process.execPath : 'railway';
const railwayPrefixArgs = windowsRailwayCli && existsSync(windowsRailwayCli) ? [windowsRailwayCli] : [];
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const aiDesignAuthorityMigrationBytes = readFileSync(path.join(scriptDirectory, '..', 'src', 'lib', 'db-postgres-migration-2026082402.sql'), 'utf8')
  .replace(/\r\n?/g, '\n');
export const WEB_PUBLIC_AI_DESIGN_AUTHORITY_MIGRATION_CHECKSUM = createHash('sha256')
  .update(aiDesignAuthorityMigrationBytes)
  .digest('hex');
const aiDesignSourceMigrationBytes = readFileSync(path.join(scriptDirectory, '..', 'src', 'lib', 'db-postgres-migration-2026082602.sql'), 'utf8')
  .replace(/\r\n?/g, '\n');
export const WEB_PUBLIC_AI_DESIGN_SOURCE_MIGRATION_CHECKSUM = createHash('sha256')
  .update(aiDesignSourceMigrationBytes)
  .digest('hex');

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), env: process.env, shell: false, ...options });
    let stdout = '', stderr = '';
    child.stdout?.on('data', chunk => { stdout += chunk; if (options.stream) process.stdout.write(chunk); });
    child.stderr?.on('data', chunk => { stderr += chunk; if (options.stream) process.stderr.write(chunk); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${command} ${args.join(' ')} exited ${code}\n${stderr || stdout}`)));
  });
}

function runRailway(args, options = {}) {
  return run(railwayCommand, [...railwayPrefixArgs, ...args], options);
}

export function npmInvocation({
  platform = process.platform,
  execPath = process.execPath,
  npmExecPath = process.env.npm_execpath,
  fileExists = existsSync,
} = {}) {
  if (npmExecPath) return { command: execPath, prefixArgs: [npmExecPath] };
  const bundledNpmCli = path.join(path.dirname(execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (platform === 'win32' && fileExists(bundledNpmCli)) {
    // Windows cannot spawn npm.cmd with shell:false (EINVAL). Invoke the npm
    // JavaScript CLI through the same Node executable instead.
    return { command: execPath, prefixArgs: [bundledNpmCli] };
  }
  return { command: 'npm', prefixArgs: [] };
}

export function deploymentMessage({
  stagingHold,
  webPublic = false,
  expectedBuildId,
  attemptId,
  now = new Date().toISOString(),
}) {
  const deploymentKind = stagingHold
    ? 'verified staging HOLD deploy'
    : webPublic
      ? 'verified web-public no-payment deploy'
      : 'verified deploy';
  if (typeof attemptId !== 'string' || !attemptId.trim()) {
    throw new Error('deployment attempt ID is required');
  }
  return `${deploymentKind} build=${expectedBuildId} source=clean-git-v1 attempt=${attemptId.trim()} at=${now}`;
}

function runNpmScript(script, env = process.env) {
  const invocation = npmInvocation();
  return run(invocation.command, [...invocation.prefixArgs, 'run', script], { stream: true, env });
}

export const TARGET_RUNTIME_KEYS = [
  'NEXYFAB_COMMERCIAL_MODE', 'NEXYFAB_AI_DESIGN_DURABLE_MODE', 'NEXT_PUBLIC_NEXYFAB_AI_MODEL_BETA_ACCESS',
  'NEXYFAB_PAYMENTS_ENABLED', 'NEXYFAB_RELEASE_CHANNEL', 'NEXYFAB_BUILD_ID', 'RELEASE_GIT_HEAD',
  'AI_PROVIDER_PRIMARY', 'AI_PROVIDER_FALLBACKS', 'OPENAI_API_KEY', 'QWEN_API_KEY', 'DASHSCOPE_API_KEY', 'QWEN_BASE_URL',
  'DEEPSEEK_API_KEY', 'DEEPSEEK_BASE_URL',
  'NEXYFAB_PRECISION_CAD_COMMERCIAL_MODE', 'NEXYFAB_AGENT_APPROVAL_SECRET',
  'NEXYFAB_AGENTIC_TRUST_REGISTRY_JSON', 'EXTERNAL_WORKER_ORCHESTRATOR_URL',
  'EXTERNAL_WORKER_ORCHESTRATOR_HEALTH_URL', 'POSTGRES_MIGRATION_VERSION',
  'POSTGRES_MIGRATION_CHECKSUM_2026082202', 'POSTGRES_MIGRATION_CHECKSUM_2026082203',
  'POSTGRES_MIGRATION_CHECKSUM_2026082204', 'POSTGRES_MIGRATION_CHECKSUM_2026082205',
  'POSTGRES_MIGRATION_CHECKSUM_2026082206', 'POSTGRES_MIGRATION_CHECKSUM_2026082207', 'POSTGRES_MIGRATION_CHECKSUM_2026082208',
  'POSTGRES_MIGRATION_CHECKSUM_2026082301', 'CANONICAL_CAD_REVISION_MIGRATION_CHECKSUM',
  'POSTGRES_MIGRATION_CHECKSUM_2026082402', 'POSTGRES_MIGRATION_CHECKSUM_2026082403',
  'POSTGRES_MIGRATION_CHECKSUM_2026082501',
  'POSTGRES_MIGRATION_CHECKSUM_2026082502',
  'POSTGRES_MIGRATION_CHECKSUM_2026082602',
  'NEXYFAB_COMMERCIAL_WORKER_KEYS_JSON', 'NEXYFAB_COMMERCIAL_WORKER_CLAIM_SECRET',
  'NEXYFAB_COMMERCIAL_TRANSPORT_SECRET', 'NEXYFAB_COMMERCIAL_CALLBACK_SECRET',
  'NEXYFAB_COMMERCIAL_CALLBACK_URL', 'NEXYFAB_EXTERNAL_VERIFIER_REGISTRY_JSON',
  'NEXYFAB_EXTERNAL_VERIFIER_INTERNAL_SECRET', 'OBJECT_STORAGE_PRIVATE_BUCKET',
  'DATABASE_URL', 'REDIS_URL', 'OPENSCAD_EXTERNAL_WORKER', 'CAD_RUNTIME_EXTERNAL_WORKER',
  'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'NEXYFAB_CAD_INDEPENDENT_MODE',
  'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'CRON_SECRET',
  'GENERATION_EVIDENCE_SIGNING_SECRET', 'SCAD_AGENT_SESSION_SECRET',
  'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'NEXYFAB_ADMIN_EMAIL', 'ADMIN_BOOTSTRAP_EMAILS', 'SENTRY_DSN',
  'NEXT_PUBLIC_AUTH_URL', 'NEXT_PUBLIC_NEXYSYS_URL', 'RECAPTCHA_SECRET_KEY',
  'NEXT_PUBLIC_RECAPTCHA_SITE_KEY', 'RECAPTCHA_ALLOWED_HOSTNAMES', 'SECURITY_GATE_MODE', 'JWT_SECRET',
  'NEXT_SERVER_ACTIONS_ENCRYPTION_KEY', 'TOSS_SECRET_KEY', 'TOSS_WEBHOOK_SECRET',
  'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'AIRWALLEX_CLIENT_ID', 'AIRWALLEX_API_KEY',
  'AIRWALLEX_WEBHOOK_SECRET', 'DODO_API_KEY', 'DODO_WEBHOOK_SECRET',
  'ONCALL_OWNER', 'SUPPORT_OWNER', 'ROLLBACK_OWNER', 'LAST_RESTORE_DRILL_AT',
  'LAST_PAYMENT_REHEARSAL_AT', 'LEGAL_POLICY_APPROVED_AT',
  'NEXYFAB_DOMAIN_REVIEWER_KEYS', 'NEXYFAB_CAD_REVIEWER_KEYS',
  'DOMAIN_ACCURACY_EVIDENCE_DIR', 'CAD_INDEPENDENT_RELEASE_AUDIT_V2',
  'I18N_AUTOMATED_TEST_EVIDENCE', 'I18N_FULL_PRODUCT_REVIEW_RECEIPT',
  'I18N_FULL_PRODUCT_EVIDENCE_ROOT', 'I18N_RELEASE_RECEIPT_OUTPUT',
  'ROUTE_SECURITY_MATRIX', 'CAD_API_CONTROL_EVIDENCE', 'SECRET_SCAN_EVIDENCE',
  'DEPENDENCY_AUDIT_EVIDENCE', 'COMPLEX_HOLDOUT_CASES', 'COMPLEX_GROUND_TRUTH_VALIDATION',
  'COMPLEX_PRODUCT_SCOPE_ASSESSMENT', 'MECHANICAL_PRODUCT_SCOPE_ASSESSMENT',
  'COMMERCIAL_VALIDATION_CORPUS', 'SEVEN_DAY_OPERATIONS_RECEIPT', 'RELEASE_BASELINE',
  'CLOSED_BETA_COMPARISON', 'PRODUCTION_PROTECTED_STATE_RECEIPT', 'SYNTHETIC_CAMPAIGN_RECEIPT',
  'COMMERCIAL_LIVE_SMOKE', 'OPENSCAD_HTTP_SMOKE', 'AUTHENTICATED_E2E_RECEIPT',
  'RAILWAY_RESOURCE_BASELINE', 'PRODUCTION_MIGRATION_RECEIPT', 'BACKUP_RESTORE_RECEIPT',
  'ENVIRONMENT_ISOLATION_RECEIPT', 'EXPERT_REVIEW_RECEIPT', 'COMMERCIALIZATION_GATE_OUTPUT',
];

function normalizeRailwayVariables(value) {
  const source = value?.variables && typeof value.variables === 'object' ? value.variables : value;
  if (Array.isArray(source)) {
    return Object.fromEntries(source.flatMap(item => {
      const key = item?.name ?? item?.key;
      return typeof key === 'string' ? [[key, String(item?.value ?? '')]] : [];
    }));
  }
  if (!source || typeof source !== 'object') return {};
  return Object.fromEntries(Object.entries(source).map(([key, item]) => [
    key,
    String(item && typeof item === 'object' && 'value' in item ? item.value ?? '' : item ?? ''),
  ]));
}

async function targetVariables() {
  const result = await runRailway(['variables', '--service', service, '--environment', environment, '--json']);
  return normalizeRailwayVariables(JSON.parse(result.stdout));
}

export function targetGateEnvironment(target, baseEnvironment = process.env) {
  const env = { ...baseEnvironment };
  for (const key of TARGET_RUNTIME_KEYS) {
    if (Object.hasOwn(target, key)) env[key] = target[key];
    else delete env[key];
  }
  return env;
}

export function stagingHoldIssues({ environment, site, target, expectedBuildId, autoDeployEnabled }) {
  const issues = [];
  if (environment !== 'staging') issues.push('staging_hold_environment_must_be_staging');
  if (autoDeployEnabled !== false) issues.push('staging_hold_auto_deploy_must_be_disabled');
  if (target.NEXYFAB_COMMERCIAL_MODE !== '0') issues.push('staging_hold_commercial_mode_must_be_0');
  if (target.NEXYFAB_PRECISION_CAD_COMMERCIAL_MODE === '1') issues.push('staging_hold_precision_commercial_mode_must_not_be_1');
  if (target.NEXYFAB_RELEASE_CHANNEL !== 'staging-hold') issues.push('staging_hold_release_channel_required');
  if (!expectedBuildId || target.NEXYFAB_BUILD_ID !== expectedBuildId) issues.push('staging_hold_build_id_mismatch');
  if (!expectedBuildId || target.RELEASE_GIT_HEAD !== expectedBuildId) issues.push('staging_hold_release_git_head_mismatch');
  try {
    const hostname = new URL(site).hostname.toLowerCase();
    if (!hostname.includes('staging') || hostname === 'nexyfab.com' || hostname === 'www.nexyfab.com') {
      issues.push('staging_hold_site_must_be_isolated_staging_host');
    }
  } catch {
    issues.push('staging_hold_site_invalid');
  }
  return issues;
}

const WEB_PUBLIC_REQUIRED_KEYS = [
  'DATABASE_URL', 'REDIS_URL',
  'OPENAI_API_KEY', 'QWEN_API_KEY', 'QWEN_BASE_URL', 'DEEPSEEK_API_KEY',
  'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'OBJECT_STORAGE_PRIVATE_BUCKET',
  'CRON_SECRET', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SENTRY_DSN',
  'NEXT_PUBLIC_AUTH_URL', 'RECAPTCHA_SECRET_KEY', 'NEXT_PUBLIC_RECAPTCHA_SITE_KEY',
  'RECAPTCHA_ALLOWED_HOSTNAMES', 'JWT_SECRET', 'NEXT_SERVER_ACTIONS_ENCRYPTION_KEY',
  'POSTGRES_MIGRATION_CHECKSUM_2026082402',
  'POSTGRES_MIGRATION_CHECKSUM_2026082602',
];

export function webPublicIssues({ environment, service, site, target, expectedBuildId, autoDeployEnabled }) {
  const issues = [];
  if (environment !== 'production') issues.push('web_public_environment_must_be_production');
  if (service !== 'nexyfab.com') issues.push('web_public_service_must_be_nexyfab_com');
  if (autoDeployEnabled !== false) issues.push('web_public_auto_deploy_must_be_disabled');
  if (target.NEXYFAB_COMMERCIAL_MODE !== '0') issues.push('web_public_commercial_mode_must_be_0');
  if (target.NEXYFAB_PRECISION_CAD_COMMERCIAL_MODE !== '0') issues.push('web_public_precision_commercial_mode_must_be_0');
  if (target.NEXYFAB_AI_DESIGN_DURABLE_MODE !== '1') issues.push('web_public_ai_design_durable_mode_required');
  if (target.NEXT_PUBLIC_NEXYFAB_AI_MODEL_BETA_ACCESS !== '1') issues.push('web_public_ai_model_beta_access_required');
  if (target.NEXYFAB_PAYMENTS_ENABLED !== 'false') issues.push('web_public_payments_must_be_false');
  if (target.NEXYFAB_RELEASE_CHANNEL !== 'web-public') issues.push('web_public_release_channel_required');
  if (!expectedBuildId || target.NEXYFAB_BUILD_ID !== expectedBuildId) issues.push('web_public_build_id_mismatch');
  if (!expectedBuildId || target.RELEASE_GIT_HEAD !== expectedBuildId) issues.push('web_public_release_git_head_mismatch');
  if (target.OPENSCAD_EXTERNAL_WORKER !== '1') issues.push('web_public_openscad_external_worker_required');
  if (target.NEXYFAB_CAD_INDEPENDENT_MODE !== '1') issues.push('web_public_cad_independent_mode_required');
  if (!['enforce', 'strict'].includes(target.SECURITY_GATE_MODE?.trim().toLowerCase() ?? '')) {
    issues.push('web_public_security_gate_must_be_enforced');
  }
  if (target.AI_PROVIDER_PRIMARY?.trim().toLowerCase() !== 'openai') {
    issues.push('web_public_ai_primary_must_be_openai');
  }
  if (!(target.AI_PROVIDER_FALLBACKS ?? '').split(',').map(value => value.trim().toLowerCase()).includes('qwen')) {
    issues.push('web_public_ai_fallbacks_must_include_qwen');
  }
  if (!(target.AI_PROVIDER_FALLBACKS ?? '').split(',').map(value => value.trim().toLowerCase()).includes('deepseek')) {
    issues.push('web_public_ai_fallbacks_must_include_deepseek');
  }
  for (const key of WEB_PUBLIC_REQUIRED_KEYS) {
    if (!target[key]?.trim()) issues.push(`web_public_required_variable_missing:${key}`);
  }
  if (target.QWEN_BASE_URL?.trim()) {
    try {
      const qwenBase = new URL(target.QWEN_BASE_URL.trim());
      if (qwenBase.protocol !== 'https:'
          || !(qwenBase.hostname === 'aliyuncs.com' || qwenBase.hostname.endsWith('.aliyuncs.com'))) {
        issues.push('web_public_qwen_base_url_must_be_official_https');
      }
    } catch {
      issues.push('web_public_qwen_base_url_must_be_official_https');
    }
  }
  if (target.POSTGRES_MIGRATION_CHECKSUM_2026082402?.trim()
      && target.POSTGRES_MIGRATION_CHECKSUM_2026082402.trim() !== WEB_PUBLIC_AI_DESIGN_AUTHORITY_MIGRATION_CHECKSUM) {
    issues.push('web_public_ai_design_authority_migration_checksum_mismatch');
  }
  if (target.POSTGRES_MIGRATION_CHECKSUM_2026082602?.trim()
      && target.POSTGRES_MIGRATION_CHECKSUM_2026082602.trim() !== WEB_PUBLIC_AI_DESIGN_SOURCE_MIGRATION_CHECKSUM) {
    issues.push('web_public_ai_design_source_migration_checksum_mismatch');
  }
  if (target.S3_BUCKET?.trim() && target.OBJECT_STORAGE_PRIVATE_BUCKET?.trim()
      && target.S3_BUCKET.trim() !== target.OBJECT_STORAGE_PRIVATE_BUCKET.trim()) {
    issues.push('web_public_private_bucket_must_match_verified_s3_bucket');
  }
  try {
    const hostname = new URL(site).hostname.toLowerCase();
    if (!['nexyfab.com', 'www.nexyfab.com'].includes(hostname)) {
      issues.push('web_public_site_must_be_canonical_production_host');
    }
  } catch {
    issues.push('web_public_site_invalid');
  }
  try {
    const authHostname = new URL(target.NEXT_PUBLIC_AUTH_URL).hostname.toLowerCase();
    if (!['nexyfab.com', 'www.nexyfab.com'].includes(authHostname)) {
      issues.push('web_public_auth_url_must_be_canonical_production_host');
    }
  } catch {
    issues.push('web_public_auth_url_invalid');
  }
  const allowedRecaptchaHosts = new Set(
    String(target.RECAPTCHA_ALLOWED_HOSTNAMES ?? '')
      .split(',')
      .map(value => value.trim().toLowerCase())
      .filter(Boolean),
  );
  if (!allowedRecaptchaHosts.has('nexyfab.com') || !allowedRecaptchaHosts.has('www.nexyfab.com')) {
    issues.push('web_public_recaptcha_hosts_must_cover_canonical_hosts');
  }
  return issues;
}

export function railwayTargetIds(value, targetEnvironment, targetService) {
  const environmentNode = value?.environments?.edges
    ?.map(edge => edge?.node)
    .find(node => node?.name === targetEnvironment);
  const serviceNode = environmentNode?.serviceInstances?.edges
    ?.map(edge => edge?.node)
    .find(node => node?.serviceName === targetService);
  const projectId = typeof value?.id === 'string' ? value.id : '';
  const environmentId = typeof environmentNode?.id === 'string' ? environmentNode.id : '';
  const serviceId = typeof serviceNode?.serviceId === 'string' ? serviceNode.serviceId : '';
  return projectId && environmentId && serviceId ? { projectId, environmentId, serviceId } : null;
}

async function targetAutoDeployEnabled() {
  const status = await runRailway(['status', '--json']);
  const ids = railwayTargetIds(JSON.parse(status.stdout), environment, service);
  if (!ids) throw new Error(`unable to resolve Railway IDs for ${environment}/${service}`);
  const query = 'query AutoDeploy($environmentId:String!,$projectId:String!,$serviceId:String!){serviceInstanceAutoDeployStatus(environmentId:$environmentId,projectId:$projectId,serviceId:$serviceId){enabled}}';
  const result = await runRailway([
    'api', query,
    '--raw-var', `environmentId=${ids.environmentId}`,
    '--raw-var', `projectId=${ids.projectId}`,
    '--raw-var', `serviceId=${ids.serviceId}`,
    '--compact',
  ]);
  const enabled = JSON.parse(result.stdout)?.data?.serviceInstanceAutoDeployStatus?.enabled;
  if (typeof enabled !== 'boolean') throw new Error(`unable to read auto-deploy state for ${environment}/${service}`);
  return enabled;
}

function deploymentRows(value) {
  if (Array.isArray(value)) return value;
  for (const key of ['deployments', 'items', 'data']) if (Array.isArray(value?.[key])) return value[key];
  return [];
}

function deploymentId(row) {
  return row?.id || row?.deploymentId || row?.deployment?.id;
}

function deploymentStatus(row) {
  return String(row?.status || row?.latestStatus || row?.deployment?.status || '').toUpperCase();
}

export function deploymentCliMessage(row) {
  const message = row?.meta?.cliMessage ?? row?.deployment?.meta?.cliMessage;
  return typeof message === 'string' ? message : '';
}

/**
 * Bind polling to the deployment created by this exact upload attempt. A set
 * difference alone is unsafe because another operator or automation can create
 * a deployment between the before/after list calls.
 */
export function selectDeploymentTarget(rows, {
  verifyOnly,
  expectedDeploymentId,
  attemptMessage,
  beforeIds = new Set(),
}) {
  if (verifyOnly) {
    return rows.find(row => deploymentId(row) === expectedDeploymentId) ?? null;
  }
  const matches = rows.filter(row => {
    const id = deploymentId(row);
    return id && !beforeIds.has(id) && deploymentCliMessage(row) === attemptMessage;
  });
  if (matches.length > 1) {
    throw new Error(`multiple Railway deployments matched exact upload attempt: ${matches.map(deploymentId).join(', ')}`);
  }
  return matches[0] ?? null;
}

async function list() {
  const result = await runRailway(['deployment', 'list', '--service', service, '--environment', environment, '--limit', '20', '--json']);
  return deploymentRows(JSON.parse(result.stdout));
}

async function healthCheck() {
  if (!site || site === 'none') return;
  const url = `${site.replace(/\/$/, '')}/api/health/ready`;
  const response = await fetch(url, { headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`health check ${url} returned ${response.status}`);
  const body = await response.json();
  if (body?.ok === false || body?.status === 'error') throw new Error(`health check reports failure: ${JSON.stringify(body)}`);
  const liveResponse = await fetch(`${site.replace(/\/$/, '')}/api/health/live`, { headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(20_000) });
  if (!liveResponse.ok) throw new Error(`live health check returned ${liveResponse.status}`);
  const liveBody = await liveResponse.json();
  const liveBuildId = String(liveBody?.buildId || liveBody?.build || liveBody?.release || '');
  if (expectedBuildId && liveBuildId !== expectedBuildId) {
    throw new Error(`live build ID mismatch: expected=${expectedBuildId} actual=${liveBuildId || '(missing)'}`);
  }
  console.log(JSON.stringify({ event: 'health-verified', url, liveBuildId: liveBuildId || null }));
}

async function verifyPaymentsDisabled() {
  if (!site || site === 'none') throw new Error('web-public verification requires a production site URL');
  const url = `${site.replace(/\/$/, '')}/api/billing/beta-status`;
  const response = await fetch(url, { headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`payment status check ${url} returned ${response.status}`);
  const body = await response.json();
  if (body?.paymentsEnabled !== false || body?.paymentStatus !== 'disabled') {
    throw new Error(`payment collection is not confirmed disabled: ${JSON.stringify(body)}`);
  }
  console.log(JSON.stringify({ event: 'payments-disabled-verified', url }));
}

async function main() {
  if (stagingHold && webPublic) {
    throw new Error('--staging-hold and --web-public are mutually exclusive');
  }
  if (verifyOnly && !expectedDeploymentId) {
    throw new Error('--verify-only requires --expected-deployment-id (or NEXYFAB_EXPECTED_DEPLOYMENT_ID)');
  }
  if (!verifyOnly && expectedDeploymentId) {
    throw new Error('--expected-deployment-id is valid only with --verify-only');
  }

  const target = await targetVariables();
  const gateEnvironment = targetGateEnvironment(target);
  const targetBuildId = String(target.NEXYFAB_BUILD_ID ?? '').trim();
  if (expectedBuildId && targetBuildId && expectedBuildId !== targetBuildId) {
    throw new Error(`expected build ID does not match target ${environment}/${service} NEXYFAB_BUILD_ID`);
  }
  expectedBuildId ||= targetBuildId;
  if (!expectedBuildId) {
    throw new Error(`target ${environment}/${service} must define NEXYFAB_BUILD_ID (or pass --expected-build-id) for verified deployment`);
  }

  if (!verifyOnly) {
    const sourcePreflight = await verifyDeploymentSource({
      sourceRoot: path.resolve(process.cwd(), sourcePath || '.'),
      expectedBuildId,
      requiredRef: canonicalDeploymentRef,
    });
    console.log(JSON.stringify({ event: 'deployment-source-verified', ...sourcePreflight }));
  }

  const before = await list();
  const beforeIds = new Set(before.map(deploymentId).filter(Boolean));
  if (verifyOnly && !selectDeploymentTarget(before, {
    verifyOnly,
    expectedDeploymentId,
    attemptMessage: '',
    beforeIds,
  })) {
    throw new Error(`expected deployment ${expectedDeploymentId} is not present in the latest Railway deployment list`);
  }

  // Verify-only is a release verification mode, not a gate bypass. Evaluate the
  // exact target environment before trusting either an existing or new deploy.
  // The staging-HOLD path exists only to validate current source in the isolated
  // staging environment while external commercial evidence is still absent. It
  // cannot target production or turn either commercial execution flag on.
  if (stagingHold) {
    const autoDeployEnabled = await targetAutoDeployEnabled();
    const issues = stagingHoldIssues({ environment, site, target, expectedBuildId, autoDeployEnabled });
    if (issues.length) throw new Error(`staging HOLD target rejected: ${issues.join(', ')}`);
    await runNpmScript('workspace:audit', gateEnvironment);
    await runNpmScript('platform:architecture:check', gateEnvironment);
    await runNpmScript('ci:replicate-build', gateEnvironment);
  } else if (webPublic) {
    const autoDeployEnabled = await targetAutoDeployEnabled();
    const issues = webPublicIssues({ environment, service, site, target, expectedBuildId, autoDeployEnabled });
    if (issues.length) throw new Error(`web-public target rejected: ${issues.join(', ')}`);
    await runNpmScript('workspace:audit', gateEnvironment);
    await runNpmScript('platform:architecture:check', gateEnvironment);
    await runNpmScript('ci:replicate-build', gateEnvironment);
  } else {
    await runNpmScript('commercial:release-gate', gateEnvironment);
  }

  const attemptId = verifyOnly ? null : randomUUID();
  const attemptMessage = verifyOnly ? null : deploymentMessage({
    stagingHold,
    webPublic,
    expectedBuildId,
    attemptId,
  });
  if (!verifyOnly) {
    const upArgs = ['up'];
    if (sourcePath && sourcePath !== '.') upArgs.push(sourcePath);
    if (pathAsRoot) upArgs.push('--path-as-root');
    upArgs.push('--detach', '--json', '--service', service, '--environment', environment, '--message', attemptMessage);
    await runRailway(upArgs, { stream: true });
    console.log(JSON.stringify({ event: 'deployment-submitted', service, environment, attemptId, message: attemptMessage }));
  }

  const deadline = Date.now() + timeoutMs;
  let targetId = verifyOnly ? expectedDeploymentId : null;
  let verified = false;
  while (Date.now() < deadline) {
    const rows = await list();
    if (!targetId) {
      targetId = deploymentId(selectDeploymentTarget(rows, {
        verifyOnly,
        expectedDeploymentId,
        attemptMessage,
        beforeIds,
      }));
    }
    const target = rows.find(row => deploymentId(row) === targetId);
    const status = deploymentStatus(target);
    console.log(JSON.stringify({ event: 'deployment-status', service, deploymentId: targetId, status: status || 'PENDING' }));
    if (['FAILED', 'CRASHED', 'REMOVED'].includes(status)) {
      if (targetId) await runRailway(['logs', targetId, '--service', service, '--environment', environment, '--lines', '200']).then(result => process.stderr.write(result.stdout)).catch(() => undefined);
      throw new Error(`deployment ${targetId ?? '(unknown)'} ended in ${status}`);
    }
    if (['SUCCESS', 'ACTIVE'].includes(status)) {
      await healthCheck();
      if (webPublic) await verifyPaymentsDisabled();
      console.log(JSON.stringify({
        event: 'deployment-verified',
        service,
        deploymentId: targetId,
        status,
        releaseStatus: stagingHold ? 'HOLD' : webPublic ? 'WEB_PUBLIC_NO_PAYMENT' : 'PASS',
        attemptId,
        message: deploymentCliMessage(target) || null,
      }));
      verified = true;
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 10_000));
  }
  if (!verified) {
    throw new Error(`deployment verification timed out after ${timeoutMs}ms (deployment=${targetId ?? 'unknown'})`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(error => {
    console.error(`[verified-deploy] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
