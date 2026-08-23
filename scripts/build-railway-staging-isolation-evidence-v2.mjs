#!/usr/bin/env node
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs, { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditRailwayEnvironmentIsolation } from './audit-railway-environment-isolation.mjs';

export const RAILWAY_STAGING_ISOLATION_EVIDENCE_V2 =
  'nexyfab.railway-staging-isolation-evidence.v2';

const SHA256 = /^[a-f0-9]{64}$/;
const GIT_SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const MAX_AGE_MS = 24 * 60 * 60_000;
const REQUIRED_ENDPOINTS = ['DATABASE_URL', 'REDIS_URL'];

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  return crypto.createHash('sha256').update(
    Buffer.isBuffer(value) ? value : canonicalJson(value),
  ).digest('hex');
}

function fresh(timestamp, now) {
  const value = Date.parse(timestamp);
  return Number.isFinite(value) && value <= now + 5 * 60_000 && value >= now - MAX_AGE_MS;
}

function present(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function endpointDescriptor(value) {
  if (!present(value)) return null;
  try {
    const url = new URL(value);
    return {
      kind: 'url',
      protocol: url.protocol.toLowerCase(),
      hostname: url.hostname.toLowerCase(),
      port: url.port || 'default',
      pathname: url.pathname || '/',
    };
  } catch {
    return { kind: 'opaque', value: String(value) };
  }
}

function endpointFingerprint(value) {
  const descriptor = endpointDescriptor(value);
  return descriptor ? sha256(descriptor) : null;
}

function fingerprint(value) {
  return present(value) ? sha256(Buffer.from(String(value), 'utf8')) : null;
}

function variableFingerprint(name, value) {
  return present(value) && REQUIRED_ENDPOINTS.includes(name)
    ? endpointFingerprint(value)
    : fingerprint(value);
}

function safeEnvironment(environment, label) {
  if (!environment || typeof environment !== 'object' || Array.isArray(environment)) {
    throw new Error(`${label}_identity_missing`);
  }
  const service = environment.service ?? environment.serviceName;
  const name = environment.environment ?? environment.environmentName;
  const id = environment.environmentId ?? environment.id;
  if (!present(service) || !present(name) || !present(id)) throw new Error(`${label}_identity_missing`);
  if (!environment.variables || typeof environment.variables !== 'object' || Array.isArray(environment.variables)) {
    throw new Error(`${label}_variables_missing`);
  }
  return {
    service: String(service),
    name: String(name),
    id: String(id),
    projectId: present(environment.projectId) ? String(environment.projectId) : null,
    deploymentId: present(environment.deploymentId) ? String(environment.deploymentId) : null,
    variables: environment.variables,
  };
}

function safeRelease(release) {
  const gitHead = release?.gitHead ?? release?.head;
  if (!present(release?.buildId) || !present(release?.productionDeploymentId)
    || !present(release?.evidenceDeploymentId) || !GIT_SHA.test(String(gitHead ?? ''))) {
    throw new Error('release_binding_invalid');
  }
  if (release.productionDeploymentId === release.evidenceDeploymentId) {
    throw new Error('release_deployment_ids_not_distinct');
  }
  return {
    buildId: String(release.buildId),
    productionDeploymentId: String(release.productionDeploymentId),
    evidenceDeploymentId: String(release.evidenceDeploymentId),
    gitHead: String(gitHead),
  };
}

function check(checks, id, pass, detail) {
  checks.push({ id, pass: pass === true, detail });
}

function variableFingerprints(production, staging) {
  const names = [...new Set([...Object.keys(production.variables), ...Object.keys(staging.variables)])].sort();
  return Object.fromEntries(names.map(name => [name, {
    production: { present: present(production.variables[name]), sha256: variableFingerprint(name, production.variables[name]) },
    staging: { present: present(staging.variables[name]), sha256: variableFingerprint(name, staging.variables[name]) },
  }]));
}

function assertFingerprintMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).every(item => {
    const sides = [item?.production, item?.staging];
    return sides.every(side => typeof side?.present === 'boolean'
      && (side.sha256 === null || SHA256.test(String(side.sha256))));
  });
}

function unsignedReceipt(receipt) {
  const unsigned = { ...(receipt ?? {}) };
  delete unsigned.receiptSha256;
  delete unsigned.receiptHmacSha256;
  return unsigned;
}

function signReceipt(unsigned, secret) {
  const receiptSha256 = sha256(unsigned);
  const receiptHmacSha256 = typeof secret === 'string' && secret.length >= 32
    ? crypto.createHmac('sha256', secret).update(canonicalJson({ ...unsigned, receiptSha256 })).digest('hex')
    : null;
  return { ...unsigned, receiptSha256, receiptHmacSha256 };
}

function validReceiptSignature(receipt, secret) {
  if (typeof secret !== 'string' || secret.length < 32
    || !SHA256.test(String(receipt?.receiptSha256 ?? ''))
    || !SHA256.test(String(receipt?.receiptHmacSha256 ?? ''))) return false;
  const unsigned = unsignedReceipt(receipt);
  const receiptSha256 = sha256(unsigned);
  if (receiptSha256 !== receipt.receiptSha256) return false;
  const expected = crypto.createHmac('sha256', secret)
    .update(canonicalJson({ ...unsigned, receiptSha256 })).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(receipt.receiptHmacSha256, 'hex'));
}

export function verifyRailwayStagingIsolationEvidenceV2(receipt, {
  expectedRelease,
  now = Date.now(),
  service = null,
  productionEnvironment = 'production',
  stagingEnvironment = 'staging',
  signingSecret = process.env.GENERATION_EVIDENCE_SIGNING_SECRET ?? '',
} = {}) {
  try {
    const release = safeRelease(expectedRelease);
    if (!receipt || receipt.schema !== RAILWAY_STAGING_ISOLATION_EVIDENCE_V2
      || !fresh(receipt.generatedAt, now) || receipt.ok !== true
      || !Array.isArray(receipt.blockers) || receipt.blockers.length !== 0
      || !validReceiptSignature(receipt, signingSecret)) return false;
    const actualRelease = receipt.release;
    if (!actualRelease || canonicalJson(actualRelease) !== canonicalJson(release)) return false;
    const identity = receipt.identity;
    if (!identity || identity.service !== (service ?? identity.service)
      || identity.production?.name !== productionEnvironment
      || identity.staging?.name !== stagingEnvironment
      || identity.production?.id === identity.staging?.id
      || identity.production?.name === identity.staging?.name
      || identity.production?.deploymentId === identity.staging?.deploymentId) return false;
    if (!assertFingerprintMap(receipt.variableFingerprints)
      || receipt.configurationFingerprint !== sha256(receipt.variableFingerprints)) return false;
    if (!Array.isArray(receipt.checks) || receipt.checks.length === 0) return false;
    if (new Set(receipt.checks.map(item => item?.id)).size !== receipt.checks.length) return false;
    const checks = new Map(receipt.checks.map(item => [item?.id, item?.pass]));
    const required = [
      'service_identity_match',
      'environment_names_distinct',
      'environment_ids_distinct',
      'production_deployment_bound',
      'staging_deployment_bound',
      'database_url_present',
      'database_url_isolated',
      'redis_url_present',
      'redis_url_isolated',
      'cad_quota_fail_closed',
    ];
    return required.every(id => checks.get(id) === true)
      && [...checks.values()].every(value => value === true)
      && receipt.checks.every(item => typeof item?.id === 'string'
        && typeof item?.pass === 'boolean' && typeof item?.detail === 'string');
  } catch {
    return false;
  }
}

export const railwayStagingIsolationEvidenceV2Eligible = verifyRailwayStagingIsolationEvidenceV2;

/**
 * Build v2 evidence from already-fetched Railway fixture data. Values are
 * compared in memory and emitted only as canonical fingerprints; this
 * function does not call Railway or persist credentials.
 */
export function buildRailwayStagingIsolationEvidenceV2({
  production,
  staging,
  release,
  generatedAt = new Date().toISOString(),
  now = Date.now(),
  productionEnvironment = 'production',
  stagingEnvironment = 'staging',
  signingSecret = process.env.GENERATION_EVIDENCE_SIGNING_SECRET ?? '',
} = {}) {
  const prod = safeEnvironment(production, 'production');
  const stage = safeEnvironment(staging, 'staging');
  const releaseBinding = safeRelease(release);
  if (!fresh(generatedAt, now)) throw new Error('generated_at_not_fresh');
  const checks = [];
  const sameService = prod.service === stage.service;
  check(checks, 'service_identity_match', sameService, sameService ? 'Service identity matches.' : 'Production and staging service identities differ.');
  check(checks, 'environment_ids_distinct', prod.id !== stage.id,
    prod.id !== stage.id ? 'Environment IDs are distinct.' : 'Environment IDs are identical.');
  check(checks, 'production_deployment_bound', prod.deploymentId === releaseBinding.productionDeploymentId,
    prod.deploymentId === releaseBinding.productionDeploymentId ? 'Production deployment is release-bound.' : 'Production deployment is not release-bound.');
  check(checks, 'staging_deployment_bound', stage.deploymentId === releaseBinding.evidenceDeploymentId,
    stage.deploymentId === releaseBinding.evidenceDeploymentId ? 'Staging evidence deployment is release-bound.' : 'Staging deployment is not release-bound.');

  const fullAudit = auditRailwayEnvironmentIsolation(
    { ...prod.variables, RAILWAY_ENVIRONMENT_ID: prod.id },
    { ...stage.variables, RAILWAY_ENVIRONMENT_ID: stage.id },
    { productionEnvironment, stagingEnvironment, generatedAt },
  );
  for (const item of fullAudit.checks) {
    if (!checks.some(existing => existing.id === item.id)) check(checks, item.id, item.pass, item.detail);
  }

  const variableMap = variableFingerprints(prod, stage);
  const blockers = checks.filter(item => !item.pass).map(item => item.id);
  if (typeof signingSecret !== 'string' || signingSecret.length < 32) blockers.push('signing_secret_missing');
  const unsigned = {
    schema: RAILWAY_STAGING_ISOLATION_EVIDENCE_V2,
    generatedAt,
    ok: blockers.length === 0,
    identity: {
      service: prod.service,
      production: { id: prod.id, name: prod.name, deploymentId: prod.deploymentId },
      staging: { id: stage.id, name: stage.name, deploymentId: stage.deploymentId },
    },
    release: releaseBinding,
    variableFingerprints: variableMap,
    configurationFingerprint: sha256(variableMap),
    checks,
    blockers,
    redaction: 'Variable and URL values are compared in memory and emitted only as SHA-256 fingerprints.',
  };
  return signReceipt(unsigned, signingSecret);
}

export const buildRailwayStagingIsolationReceiptV2 = buildRailwayStagingIsolationEvidenceV2;

function railwayCommand() {
  const windowsCli = process.platform === 'win32' && process.env.APPDATA
    ? path.join(process.env.APPDATA, 'npm', 'node_modules', '@railway', 'cli', 'bin', 'railway.js')
    : '';
  return windowsCli && existsSync(windowsCli)
    ? { file: process.execPath, prefix: [windowsCli] }
    : { file: 'railway', prefix: [] };
}

function railwayVariables(service, environment) {
  const railway = railwayCommand();
  const raw = execFileSync(railway.file, [
    ...railway.prefix, 'variable', 'list', '--service', service, '--environment', environment, '--json',
  ], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(raw);
}

function gitHead(root) {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim(); } catch { return null; }
}

export function captureRailwayStagingIsolationEvidenceV2({
  service = 'nexyfab.com',
  productionEnvironment = 'production',
  stagingEnvironment = 'staging',
  buildId,
  gitCommit,
  generatedAt = new Date().toISOString(),
  now = Date.now(),
  signingSecret = process.env.GENERATION_EVIDENCE_SIGNING_SECRET ?? '',
  root = process.cwd(),
  loadVariables = railwayVariables,
} = {}) {
  if (productionEnvironment === stagingEnvironment) throw new Error('environment_names_not_distinct');
  const productionVariables = loadVariables(service, productionEnvironment);
  const stagingVariables = loadVariables(service, stagingEnvironment);
  const production = {
    service, environment: productionEnvironment,
    environmentId: productionVariables.RAILWAY_ENVIRONMENT_ID,
    projectId: productionVariables.RAILWAY_PROJECT_ID,
    deploymentId: productionVariables.RAILWAY_DEPLOYMENT_ID,
    variables: productionVariables,
  };
  const staging = {
    service, environment: stagingEnvironment,
    environmentId: stagingVariables.RAILWAY_ENVIRONMENT_ID,
    projectId: stagingVariables.RAILWAY_PROJECT_ID,
    deploymentId: stagingVariables.RAILWAY_DEPLOYMENT_ID,
    variables: stagingVariables,
  };
  return buildRailwayStagingIsolationEvidenceV2({
    production,
    staging,
    release: {
      buildId: buildId ?? process.env.RELEASE_BUILD_ID ?? process.env.NEXYFAB_BUILD_ID,
      productionDeploymentId: production.deploymentId,
      evidenceDeploymentId: staging.deploymentId,
      gitHead: gitCommit ?? process.env.RELEASE_GIT_HEAD ?? process.env.RAILWAY_GIT_COMMIT_SHA ?? gitHead(root),
    },
    generatedAt,
    now,
    productionEnvironment,
    stagingEnvironment,
    signingSecret,
  });
}

function option(args, name, fallback = null) {
  const prefix = `--${name}=`;
  const inline = args.find(value => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] ?? fallback : fallback;
}

export function main(args = process.argv.slice(2)) {
  const root = path.resolve(option(args, 'root', process.cwd()));
  const productionPath = option(args, 'production');
  const stagingPath = option(args, 'staging');
  const releasePath = option(args, 'release');
  const output = option(args, 'out', 'docs/evidence/release/railway-staging-isolation-receipt.json');
  const read = file => JSON.parse(fs.readFileSync(path.resolve(root, file), 'utf8'));
  const fixtureMode = productionPath || stagingPath || releasePath;
  if (fixtureMode && !(productionPath && stagingPath && releasePath)) throw new Error('fixture_paths_incomplete');
  const receipt = fixtureMode
    ? buildRailwayStagingIsolationEvidenceV2({
      production: read(productionPath), staging: read(stagingPath), release: read(releasePath),
      generatedAt: option(args, 'generated-at', new Date().toISOString()),
    })
    : captureRailwayStagingIsolationEvidenceV2({
      root,
      service: option(args, 'service', 'nexyfab.com'),
      productionEnvironment: option(args, 'production-environment', 'production'),
      stagingEnvironment: option(args, 'staging-environment', 'staging'),
      buildId: option(args, 'build-id', process.env.RELEASE_BUILD_ID ?? process.env.NEXYFAB_BUILD_ID),
      gitCommit: option(args, 'git-head', process.env.RELEASE_GIT_HEAD ?? process.env.RAILWAY_GIT_COMMIT_SHA),
      generatedAt: option(args, 'generated-at', new Date().toISOString()),
    });
  fs.writeFileSync(path.resolve(root, output), `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ ok: receipt.ok, output: path.resolve(root, output) })}\n`);
  return receipt.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); } catch (error) {
    process.stderr.write(`[railway-isolation-v2] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
