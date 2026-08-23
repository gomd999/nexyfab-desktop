import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const COMMERCIAL_LIVE_SMOKE_SCHEMA = 'nexyfab.deployment-ai-cad-smoke.v2';
export const PRODUCTION_SMOKE_TARGET = 'https://nexyfab.com';
export const LIVE_SMOKE_REQUIRED_CHECKS = Object.freeze(['live', 'ready', 'capabilities', 'scad-agent-route', 'openscad']);
export const LIVE_SMOKE_MAX_AGE_MS = 24 * 60 * 60_000;
const SHA256 = /^[a-f0-9]{64}$/i;
const GIT_SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const OBSERVATION_CONTRACTS = Object.freeze({
  live: Object.freeze({ method: 'GET', pathname: '/api/health/live', statuses: [200] }),
  ready: Object.freeze({ method: 'GET', pathname: '/api/health/ready', statuses: [200] }),
  capabilities: Object.freeze({ method: 'GET', pathname: '/api/cad/v1/capabilities', statuses: [200] }),
  'scad-agent-route': Object.freeze({ method: 'HEAD', pathname: '/api/nexyfab/scad-agent', statuses: [405] }),
  openscad: Object.freeze({ method: 'GET', pathname: '/api/health/openscad', statuses: [200] }),
  'scad-agent-sse': Object.freeze({ method: 'POST', pathname: '/api/nexyfab/scad-agent', statuses: [200] }),
});

function hashBytes(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hashJson(value) {
  return hashBytes(Buffer.from(JSON.stringify(value), 'utf8'));
}

function normalizedTarget(value) {
  try {
    const url = new URL(String(value));
    return url.origin;
  } catch {
    return null;
  }
}

function releaseBinding(value) {
  const release = value?.release ?? value ?? {};
  if (typeof release.buildId !== 'string' || !release.buildId.trim()) throw new Error('release.buildId is required');
  if (typeof release.deploymentId !== 'string' || !release.deploymentId.trim()) throw new Error('release.deploymentId is required');
  if (typeof release.gitHead !== 'string' || !GIT_SHA.test(release.gitHead.trim())) {
    throw new Error('release.gitHead must be a real 40- or 64-character git SHA');
  }
  return { buildId: release.buildId.trim(), deploymentId: release.deploymentId.trim(), gitHead: release.gitHead.trim() };
}

function fresh(value, now) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    && timestamp <= now + 5 * 60_000
    && timestamp >= now - LIVE_SMOKE_MAX_AGE_MS;
}

function pathInside(parent, candidate, allowSame = false) {
  const relative = path.relative(parent, candidate);
  return (allowSame && !relative) || Boolean(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function safeArtifactPath(root, artifactPath) {
  const resolvedRoot = path.resolve(root);
  const absolute = path.resolve(resolvedRoot, artifactPath);
  const relative = path.relative(resolvedRoot, absolute);
  if (!pathInside(resolvedRoot, absolute)) throw new Error('source artifact must be inside root');
  if (fs.existsSync(absolute) && fs.lstatSync(absolute).isSymbolicLink()) throw new Error('source artifact must not be a symbolic link');
  let existingParent = path.dirname(absolute);
  while (!fs.existsSync(existingParent)) existingParent = path.dirname(existingParent);
  const realRoot = fs.realpathSync.native(resolvedRoot);
  const realParent = fs.realpathSync.native(existingParent);
  if (!pathInside(realRoot, realParent, true)) throw new Error('source artifact parent resolves outside root');
  if (fs.existsSync(absolute) && !pathInside(realRoot, fs.realpathSync.native(absolute))) throw new Error('source artifact resolves outside root');
  return { absolute, relative: relative.replaceAll('\\', '/') };
}

function sourceBinding(root, artifactPath, bytes) {
  const output = safeArtifactPath(root, artifactPath);
  return { path: output.relative, bytes: bytes.byteLength, sha256: hashBytes(bytes) };
}

function validSourceBinding(root, binding) {
  if (typeof binding?.path !== 'string' || !binding.path || path.isAbsolute(binding.path)
    || binding.path === '.' || binding.path.split(/[\\/]+/).includes('..')
    || !Number.isInteger(binding.bytes) || binding.bytes <= 0 || !SHA256.test(String(binding.sha256 ?? ''))) return false;
  const resolvedRoot = path.resolve(root);
  const absolute = path.resolve(resolvedRoot, binding.path);
  if (absolute === resolvedRoot || !absolute.startsWith(`${resolvedRoot}${path.sep}`)) return false;
  try {
    if (fs.lstatSync(absolute).isSymbolicLink()) return false;
    const realRoot = fs.realpathSync.native(resolvedRoot);
    const realFile = fs.realpathSync.native(absolute);
    if (!pathInside(realRoot, realFile)) return false;
    const bytes = fs.readFileSync(realFile);
    return fs.statSync(realFile).isFile() && bytes.byteLength === binding.bytes && hashBytes(bytes) === binding.sha256;
  } catch {
    return false;
  }
}

function observationValid(item) {
  const contract = OBSERVATION_CONTRACTS[item?.id];
  return typeof item?.id === 'string'
    && Boolean(contract)
    && item?.request?.method === contract.method
    && item?.request?.pathname === contract.pathname
    && Number.isInteger(item?.httpStatus) && item.httpStatus >= 100 && item.httpStatus <= 599
    && Number.isInteger(item?.bodyBytes) && item.bodyBytes >= 0
    && SHA256.test(String(item?.bodySha256 ?? ''))
    && typeof item?.contentType === 'string';
}

function resultContract(result, expectedId) {
  const contract = OBSERVATION_CONTRACTS[expectedId];
  return result?.id === expectedId
    && result.status === 'pass'
    && contract?.statuses.includes(result.httpStatus)
    && result.observation?.httpStatus === result.httpStatus
    && observationValid(result.observation);
}

export function buildCommercialLiveSmokeReceipt({
  results,
  target = PRODUCTION_SMOKE_TARGET,
  release,
  generatedAt,
  ready,
  credentials,
  sourceBindings = [],
  observations,
  now = Date.now(),
} = {}) {
  if (normalizedTarget(target) !== PRODUCTION_SMOKE_TARGET) throw new Error('target must be https://nexyfab.com');
  const releaseValue = releaseBinding(release);
  const generated = generatedAt ?? new Date(now).toISOString();
  if (!Number.isFinite(Date.parse(generated))) throw new Error('generatedAt must be ISO-parseable');
  if (!Array.isArray(results) || results.length < LIVE_SMOKE_REQUIRED_CHECKS.length
    || LIVE_SMOKE_REQUIRED_CHECKS.some((id, index) => !resultContract(results[index], id))) {
    throw new Error('live smoke results must contain exact passing observations for every required check');
  }
  if (results.slice(LIVE_SMOKE_REQUIRED_CHECKS.length).some(result => !resultContract(result, 'scad-agent-sse'))) {
    throw new Error('optional live smoke observations are invalid');
  }
  if (!Array.isArray(observations) || observations.length !== results.length
    || JSON.stringify(observations) !== JSON.stringify(results.map(result => result.observation))) {
    throw new Error('live smoke observations must exactly match result observations');
  }
  if (!Array.isArray(sourceBindings) || sourceBindings.length !== 1) throw new Error('exactly one source binding is required');
  if (ready?.status !== 'ok' || ready?.db?.status !== 'ok' || ready.db.required !== true || ready.db.backend !== 'postgres'
    || ready?.redis?.status !== 'ok' || ready.redis.required !== true
    || ready?.commercialBoundary?.status !== 'ok' || ready.commercialBoundary.required !== true) {
    throw new Error('ready commercial boundary snapshot is incomplete');
  }

  const receipt = {
    schema: COMMERCIAL_LIVE_SMOKE_SCHEMA,
    generatedAt: new Date(Date.parse(generated)).toISOString(),
    target: PRODUCTION_SMOKE_TARGET,
    status: 'pass',
    release: releaseValue,
    requiredChecks: [...LIVE_SMOKE_REQUIRED_CHECKS],
    results,
    observations,
    sourceBindings,
    ready: ready ?? null,
    credentials: credentials ?? { applicationAuthPresent: false, adminSecretPresent: false },
    freshness: { generatedAt: new Date(Date.parse(generated)).toISOString(), maxAgeMs: LIVE_SMOKE_MAX_AGE_MS },
  };
  return { ...receipt, sha256: hashJson(receipt) };
}

export function writeSmokeObservationArtifact({ root = process.cwd(), artifactPath, target = PRODUCTION_SMOKE_TARGET, generatedAt, observations } = {}) {
  if (!Array.isArray(observations) || observations.length !== LIVE_SMOKE_REQUIRED_CHECKS.length) throw new Error('all smoke observations are required');
  const resolvedRoot = path.resolve(root);
  const absolute = path.resolve(resolvedRoot, artifactPath);
  const document = {
    schema: 'nexyfab.deployment-ai-cad-smoke-observations.v1',
    generatedAt: new Date(Date.parse(generatedAt)).toISOString(),
    target: normalizedTarget(target),
    observations,
  };
  const bytes = Buffer.from(`${JSON.stringify(document, null, 2)}\n`, 'utf8');
  safeArtifactPath(resolvedRoot, artifactPath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  const checked = safeArtifactPath(resolvedRoot, artifactPath);
  fs.writeFileSync(checked.absolute, bytes, { flag: 'wx' });
  return { document, binding: sourceBinding(resolvedRoot, artifactPath, bytes) };
}

export function verifyCommercialLiveSmokeReceipt(receipt, expectedRelease, {
  root = process.cwd(), now = Date.now(), target = PRODUCTION_SMOKE_TARGET,
} = {}) {
  try {
    if (!receipt || typeof receipt !== 'object' || !Number.isFinite(now)) return false;
    if (receipt.schema !== COMMERCIAL_LIVE_SMOKE_SCHEMA || receipt.status !== 'pass'
      || normalizedTarget(receipt.target) !== PRODUCTION_SMOKE_TARGET || normalizedTarget(target) !== PRODUCTION_SMOKE_TARGET
      || !fresh(receipt.generatedAt, now) || receipt.freshness?.generatedAt !== receipt.generatedAt
      || receipt.freshness?.maxAgeMs !== LIVE_SMOKE_MAX_AGE_MS) return false;
    const expected = releaseBinding(expectedRelease);
    if (receipt.release?.buildId !== expected.buildId || receipt.release?.deploymentId !== expected.deploymentId || receipt.release?.gitHead !== expected.gitHead) return false;
    if (JSON.stringify(receipt.requiredChecks) !== JSON.stringify(LIVE_SMOKE_REQUIRED_CHECKS)
      || !Array.isArray(receipt.results) || receipt.results.length < LIVE_SMOKE_REQUIRED_CHECKS.length
      || LIVE_SMOKE_REQUIRED_CHECKS.some((id, index) => !resultContract(receipt.results[index], id))) return false;
    if (receipt.results.slice(LIVE_SMOKE_REQUIRED_CHECKS.length).some(result => !resultContract(result, 'scad-agent-sse'))) return false;
    if (!Array.isArray(receipt.observations) || JSON.stringify(receipt.observations) !== JSON.stringify(receipt.results.map(result => result.observation))) return false;
    if (!Array.isArray(receipt.sourceBindings) || receipt.sourceBindings.length !== 1 || receipt.sourceBindings.some(binding => !validSourceBinding(root, binding))) return false;
    const sourceAbsolute = path.resolve(root, receipt.sourceBindings[0].path);
    const sourceDocument = JSON.parse(fs.readFileSync(sourceAbsolute, 'utf8'));
    if (sourceDocument?.schema !== 'nexyfab.deployment-ai-cad-smoke-observations.v1'
      || sourceDocument.target !== PRODUCTION_SMOKE_TARGET
      || sourceDocument.generatedAt !== receipt.generatedAt
      || JSON.stringify(sourceDocument.observations) !== JSON.stringify(receipt.observations)) return false;
    return SHA256.test(String(receipt.sha256 ?? '')) && hashJson(Object.fromEntries(Object.entries(receipt).filter(([key]) => key !== 'sha256'))) === receipt.sha256;
  } catch {
    return false;
  }
}

export function observationFromResponse({ id, pathname, method = 'GET', responseBody, httpStatus, contentType = '' } = {}) {
  const bytes = Buffer.isBuffer(responseBody) ? responseBody : Buffer.from(responseBody ?? '');
  return {
    id,
    request: { method, pathname },
    httpStatus,
    contentType,
    bodyBytes: bytes.byteLength,
    bodySha256: hashBytes(bytes),
  };
}
