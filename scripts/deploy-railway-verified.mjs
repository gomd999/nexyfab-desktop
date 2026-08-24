#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

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
const pathAsRoot = process.argv.includes('--path-as-root');
const verifyOnly = process.argv.includes('--verify-only');
const stagingHold = process.argv.includes('--staging-hold');
const windowsRailwayCli = process.platform === 'win32' && process.env.APPDATA
  ? path.join(process.env.APPDATA, 'npm', 'node_modules', '@railway', 'cli', 'bin', 'railway.js')
  : '';
const railwayCommand = windowsRailwayCli && existsSync(windowsRailwayCli) ? process.execPath : 'railway';
const railwayPrefixArgs = windowsRailwayCli && existsSync(windowsRailwayCli) ? [windowsRailwayCli] : [];

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

function runNpmScript(script, env = process.env) {
  const invocation = npmInvocation();
  return run(invocation.command, [...invocation.prefixArgs, 'run', script], { stream: true, env });
}

export const TARGET_RUNTIME_KEYS = [
  'NEXYFAB_COMMERCIAL_MODE', 'NEXYFAB_RELEASE_CHANNEL', 'NEXYFAB_BUILD_ID', 'RELEASE_GIT_HEAD',
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

async function main() {
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

  const before = await list();
  const beforeIds = new Set(before.map(deploymentId).filter(Boolean));

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
  } else {
    await runNpmScript('commercial:release-gate', gateEnvironment);
  }

  if (!verifyOnly) {
    const upArgs = ['up'];
    if (sourcePath && sourcePath !== '.') upArgs.push(sourcePath);
    if (pathAsRoot) upArgs.push('--path-as-root');
    const deploymentKind = stagingHold ? 'verified staging HOLD deploy' : 'verified deploy';
    upArgs.push('--detach', '--json', '--service', service, '--environment', environment, '--message', `${deploymentKind} ${new Date().toISOString()}`);
    await runRailway(upArgs, { stream: true });
  }

  const deadline = Date.now() + timeoutMs;
  let targetId = verifyOnly ? deploymentId(before[0]) : null;
  let verified = false;
  while (Date.now() < deadline) {
    const rows = await list();
    if (!targetId) targetId = deploymentId(rows.find(row => !beforeIds.has(deploymentId(row))));
    const target = rows.find(row => deploymentId(row) === targetId);
    const status = deploymentStatus(target);
    console.log(JSON.stringify({ event: 'deployment-status', service, deploymentId: targetId, status: status || 'PENDING' }));
    if (['FAILED', 'CRASHED', 'REMOVED'].includes(status)) {
      if (targetId) await runRailway(['logs', targetId, '--service', service, '--environment', environment, '--lines', '200']).then(result => process.stderr.write(result.stdout)).catch(() => undefined);
      throw new Error(`deployment ${targetId ?? '(unknown)'} ended in ${status}`);
    }
    if (['SUCCESS', 'ACTIVE'].includes(status)) {
      await healthCheck();
      console.log(JSON.stringify({ event: 'deployment-verified', service, deploymentId: targetId, status, releaseStatus: stagingHold ? 'HOLD' : 'PASS' }));
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
