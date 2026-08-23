import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const AUTHENTICATED_E2E_SCHEMA = 'nexyfab.authenticated-commercial-e2e.v2';
export const AUTHENTICATED_E2E_REQUIRED_CHECKS = [
  'login', 'session', 'project_create', 'project_read', 'cad_verify',
  'storage_state_reconnect', 'expert_workspace_visible', 'project_cleanup', 'logout',
];
export const AUTHENTICATED_E2E_MAX_AGE_MS = 24 * 60 * 60_000;

const SHA256 = /^[a-f0-9]{64}$/i;
const GIT_SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const OBSERVATION_CONTRACTS = Object.freeze({
  login: { method: 'POST', pathname: /^\/api\/auth\/login$/, statuses: [200] },
  session: { method: 'GET', pathname: /^\/api\/auth\/session$/, statuses: [200] },
  project_create: { method: 'POST', pathname: /^\/api\/nexyfab\/projects$/, statuses: [201] },
  project_read: { method: 'GET', pathname: /^\/api\/nexyfab\/projects\/[^/?]+$/, statuses: [200] },
  cad_verify: { method: 'POST', pathname: /^\/api\/cad\/v1\/project\/verify$/, statuses: [200] },
  storage_state_reconnect: { method: 'GET', pathname: /^\/api\/nexyfab\/projects\/[^/?]+$/, statuses: [200] },
  expert_workspace_visible: { method: 'GET', pathname: /^\/en\/shape-generator\/\?expert=1&mode=expert$/, statuses: [200] },
  project_cleanup: { method: 'DELETE', pathname: /^\/api\/nexyfab\/projects\/[^/?]+$/, statuses: [200, 404] },
  logout: { method: 'POST', pathname: /^\/api\/auth\/logout$/, statuses: [200] },
});

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function hashJson(value) {
  return hash(JSON.stringify(value));
}

function pathInside(parent, candidate, allowSame = false) {
  const relative = path.relative(parent, candidate);
  return (allowSame && !relative) || Boolean(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function safeArtifactPath(root, artifactPath) {
  const resolvedRoot = path.resolve(root);
  const absolute = path.resolve(resolvedRoot, artifactPath);
  const relative = path.relative(resolvedRoot, absolute);
  if (!pathInside(resolvedRoot, absolute)) throw new Error('E2E source must be inside root');
  if (fs.existsSync(absolute) && fs.lstatSync(absolute).isSymbolicLink()) throw new Error('E2E source must not be a symbolic link');
  let existingParent = path.dirname(absolute);
  while (!fs.existsSync(existingParent)) existingParent = path.dirname(existingParent);
  const realRoot = fs.realpathSync.native(resolvedRoot);
  const realParent = fs.realpathSync.native(existingParent);
  if (!pathInside(realRoot, realParent, true)) throw new Error('E2E source parent resolves outside root');
  if (fs.existsSync(absolute) && !pathInside(realRoot, fs.realpathSync.native(absolute))) throw new Error('E2E source resolves outside root');
  return { absolute, relative: relative.replaceAll('\\', '/') };
}

function binding(root, artifactPath, bytes) {
  const output = safeArtifactPath(root, artifactPath);
  return { path: output.relative, bytes: bytes.byteLength, sha256: hash(bytes) };
}

function validBinding(root, value) {
  if (typeof value?.path !== 'string' || !value.path || path.isAbsolute(value.path)
    || value.path.split(/[\\/]+/).includes('..') || !Number.isInteger(value.bytes) || value.bytes <= 0 || !SHA256.test(String(value.sha256 ?? ''))) return false;
  const absolute = path.resolve(root, value.path);
  if (!absolute.startsWith(`${path.resolve(root)}${path.sep}`)) return false;
  try {
    if (fs.lstatSync(absolute).isSymbolicLink()) return false;
    const realRoot = fs.realpathSync.native(path.resolve(root));
    const realFile = fs.realpathSync.native(absolute);
    if (!pathInside(realRoot, realFile)) return false;
    const bytes = fs.readFileSync(realFile);
    return fs.statSync(realFile).isFile() && bytes.byteLength === value.bytes && hash(bytes) === value.sha256;
  } catch { return false; }
}

function release(value) {
  if (typeof value?.buildId !== 'string' || !value.buildId.trim()
    || typeof value?.productionDeploymentId !== 'string' || !value.productionDeploymentId.trim()
    || typeof value?.evidenceDeploymentId !== 'string' || !value.evidenceDeploymentId.trim()
    || value.evidenceDeploymentId === value.productionDeploymentId
    || typeof value?.gitHead !== 'string' || !GIT_SHA.test(value.gitHead.trim())) throw new Error('isolated E2E release binding is incomplete');
  return {
    buildId: value.buildId.trim(),
    productionDeploymentId: value.productionDeploymentId.trim(),
    evidenceDeploymentId: value.evidenceDeploymentId.trim(),
    gitHead: value.gitHead.trim(),
  };
}

function observation(value, id) {
  const contract = OBSERVATION_CONTRACTS[id];
  const expertMarkerValid = id !== 'expert_workspace_visible'
    || (value?.marker === 'shape-generator-workspace' && value?.markerSha256 === hash('shape-generator-workspace'));
  return value?.id === id && contract?.statuses.includes(value.httpStatus)
    && value?.request?.method === contract?.method && contract?.pathname.test(String(value?.request?.pathname ?? ''))
    && expertMarkerValid && Number.isInteger(value.httpStatus) && value.httpStatus >= 100 && value.httpStatus <= 599
    && Number.isInteger(value.bodyBytes) && value.bodyBytes >= 0 && SHA256.test(String(value.bodySha256 ?? ''))
    && typeof value.contentType === 'string';
}

function isolatedStagingTarget(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin !== 'https://nexyfab.com'
      && ['staging', 'stage', 'preview', 'test'].some(marker => url.hostname.toLowerCase().includes(marker));
  } catch { return false; }
}

function readyValid(ready) {
  return ready?.status === 'ok' && ready?.db?.status === 'ok' && ready.db.required === true && ready.db.backend === 'postgres'
    && ready?.redis?.status === 'ok' && ready.redis.required === true
    && ready?.commercialBoundary?.status === 'ok' && ready.commercialBoundary.required === true;
}

export function buildAuthenticatedCommercialE2EReceipt({
  generatedAt, target, release: releaseInput, observations, ready, sourceBindings, now = Date.now(),
} = {}) {
  const timestamp = Date.parse(generatedAt ?? new Date(now).toISOString());
  if (!Number.isFinite(timestamp)) throw new Error('E2E generatedAt is invalid');
  if (!isolatedStagingTarget(target)) throw new Error('E2E target must be an isolated HTTPS staging target');
  const releaseValue = release(releaseInput);
  if (!Array.isArray(observations) || observations.length !== AUTHENTICATED_E2E_REQUIRED_CHECKS.length
    || AUTHENTICATED_E2E_REQUIRED_CHECKS.some((id, index) => !observation(observations[index], id))
    || !readyValid(ready) || !Array.isArray(sourceBindings) || sourceBindings.length !== 1) {
    throw new Error('exact authenticated E2E observations are required');
  }
  const normalizedGeneratedAt = new Date(timestamp).toISOString();
  const receipt = {
    schema: AUTHENTICATED_E2E_SCHEMA,
    generatedAt: normalizedGeneratedAt,
    ok: true,
    environment: 'staging',
    target,
    release: releaseValue,
    requiredChecks: [...AUTHENTICATED_E2E_REQUIRED_CHECKS],
    checks: [...AUTHENTICATED_E2E_REQUIRED_CHECKS],
    observations,
    sourceBindings,
    ready,
    freshness: { generatedAt: normalizedGeneratedAt, maxAgeMs: AUTHENTICATED_E2E_MAX_AGE_MS },
    credentialsPersisted: false,
    transientProjectRetained: false,
  };
  return { ...receipt, sha256: hashJson(receipt) };
}

export function writeAuthenticatedE2ESource({ root = process.cwd(), artifactPath, generatedAt, target, observations } = {}) {
  const resolvedRoot = path.resolve(root);
  const output = safeArtifactPath(resolvedRoot, artifactPath);
  const document = { schema: 'nexyfab.authenticated-commercial-e2e-observations.v1', generatedAt, target, observations };
  const bytes = Buffer.from(`${JSON.stringify(document, null, 2)}\n`, 'utf8');
  fs.mkdirSync(path.dirname(output.absolute), { recursive: true });
  const checked = safeArtifactPath(resolvedRoot, artifactPath);
  fs.writeFileSync(checked.absolute, bytes);
  return { document, binding: binding(resolvedRoot, artifactPath, bytes) };
}

export function verifyAuthenticatedCommercialE2EReceipt(receipt, expectedRelease, { root = process.cwd(), now = Date.now() } = {}) {
  try {
    const timestamp = Date.parse(receipt?.generatedAt);
    if (receipt?.schema !== AUTHENTICATED_E2E_SCHEMA || receipt.ok !== true || receipt.environment !== 'staging'
      || !Number.isFinite(timestamp) || timestamp > now + 5 * 60_000 || timestamp < now - AUTHENTICATED_E2E_MAX_AGE_MS
      || receipt.freshness?.generatedAt !== receipt.generatedAt || receipt.freshness?.maxAgeMs !== AUTHENTICATED_E2E_MAX_AGE_MS
      || !isolatedStagingTarget(String(receipt?.target ?? ''))
      || receipt.credentialsPersisted !== false || receipt.transientProjectRetained !== false || !readyValid(receipt.ready)) return false;
    if (JSON.stringify(receipt.requiredChecks) !== JSON.stringify(AUTHENTICATED_E2E_REQUIRED_CHECKS)
      || JSON.stringify(receipt.checks) !== JSON.stringify(AUTHENTICATED_E2E_REQUIRED_CHECKS)
      || !Array.isArray(receipt.observations) || receipt.observations.length !== AUTHENTICATED_E2E_REQUIRED_CHECKS.length
      || AUTHENTICATED_E2E_REQUIRED_CHECKS.some((id, index) => !observation(receipt.observations[index], id))) return false;
    const actual = release(receipt.release);
    const expected = release(expectedRelease);
    if (JSON.stringify(actual) !== JSON.stringify(expected) || !Array.isArray(receipt.sourceBindings)
      || receipt.sourceBindings.length !== 1 || receipt.sourceBindings.some(item => !validBinding(root, item))) return false;
    const source = JSON.parse(fs.readFileSync(path.resolve(root, receipt.sourceBindings[0].path), 'utf8'));
    if (source?.schema !== 'nexyfab.authenticated-commercial-e2e-observations.v1' || source.generatedAt !== receipt.generatedAt
      || source.target !== receipt.target || JSON.stringify(source.observations) !== JSON.stringify(receipt.observations)) return false;
    return SHA256.test(String(receipt.sha256 ?? ''))
      && hashJson(Object.fromEntries(Object.entries(receipt).filter(([key]) => key !== 'sha256'))) === receipt.sha256;
  } catch { return false; }
}
