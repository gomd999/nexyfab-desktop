import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const ARCHITECTURE_INTERIOR_RECOVERY_SCHEMA = 'nexyfab.architecture-interior-recovery-e2e.v2';
export const ARCHITECTURE_INTERIOR_RECOVERY_SOURCE_SCHEMA = 'nexyfab.architecture-interior-recovery-observations.v2';
export const ARCHITECTURE_INTERIOR_RECOVERY_MAX_AGE_MS = 24 * 60 * 60_000;
export const ARCHITECTURE_INTERIOR_RECOVERY_MAX_SOURCE_BYTES = 16 * 1024 * 1024;
export const ARCHITECTURE_INTERIOR_RECOVERY_MAX_OBSERVATION_BODY_BYTES = 1024 * 1024;
export const ARCHITECTURE_INTERIOR_RECOVERY_CHECKS = Object.freeze([
  'owner_login',
  'project_create',
  'workspace_initialized',
  'apply_edit',
  'undo',
  'reconnect_before_reload',
  'reconnect_after_reload',
  'redo',
  'viewer_agent_denied',
  'viewer_history_denied',
  'project_cleanup',
  'project_cleanup_confirm',
]);

const SHA256 = /^[a-f0-9]{64}$/;
const GIT_SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const decoder = new TextDecoder('utf-8', { fatal: true });
const PROTOTYPE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

const isRecord = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const hashJson = value => hash(JSON.stringify(value));
const canonical = value => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isRecord(value)) return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
};

function boundedEvidenceValue(value) {
  const stack = [{ value, depth: 0 }];
  let nodes = 0;
  while (stack.length) {
    const current = stack.pop();
    nodes += 1;
    if (!current || nodes > 100_000 || current.depth > 32) return false;
    if (typeof current.value === 'string') {
      if (Buffer.byteLength(current.value, 'utf8') > ARCHITECTURE_INTERIOR_RECOVERY_MAX_OBSERVATION_BODY_BYTES * 2) return false;
      continue;
    }
    if (Array.isArray(current.value)) {
      if (current.value.length > 50_000) return false;
      for (const item of current.value) stack.push({ value: item, depth: current.depth + 1 });
      continue;
    }
    if (!isRecord(current.value)) continue;
    const entries = Object.entries(current.value);
    if (entries.length > 50_000 || entries.some(([key]) => PROTOTYPE_KEYS.has(key))) return false;
    for (const [, item] of entries) stack.push({ value: item, depth: current.depth + 1 });
  }
  return true;
}

function inside(parent, candidate, allowSame = false) {
  const relative = path.relative(parent, candidate);
  return (allowSame && !relative) || Boolean(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function safeArtifactPath(root, artifactPath) {
  const resolvedRoot = path.resolve(root);
  if (typeof artifactPath !== 'string' || !artifactPath.trim() || path.isAbsolute(artifactPath)
    || artifactPath.split(/[\\/]+/).includes('..')) throw new Error('recovery evidence path must be relative and inside the repository root');
  const absolute = path.resolve(resolvedRoot, artifactPath);
  if (!inside(resolvedRoot, absolute)) throw new Error('recovery evidence path escapes the repository root');
  const realRoot = fs.realpathSync.native(resolvedRoot);
  let cursor = absolute;
  while (!fs.existsSync(cursor)) cursor = path.dirname(cursor);
  const realExisting = fs.realpathSync.native(cursor);
  if (!inside(realRoot, realExisting, true)) throw new Error('recovery evidence parent resolves outside the repository root');
  let component = absolute;
  while (inside(resolvedRoot, component, true)) {
    if (fs.existsSync(component) && fs.lstatSync(component).isSymbolicLink()) throw new Error('recovery evidence path must not contain a symbolic link');
    if (component === resolvedRoot) break;
    component = path.dirname(component);
  }
  return { absolute, relative: path.relative(resolvedRoot, absolute).replaceAll('\\', '/') };
}

function validBinding(root, binding) {
  if (!isRecord(binding) || typeof binding.path !== 'string' || !Number.isInteger(binding.bytes) || binding.bytes <= 0
    || binding.bytes > ARCHITECTURE_INTERIOR_RECOVERY_MAX_SOURCE_BYTES
    || typeof binding.sha256 !== 'string' || !SHA256.test(binding.sha256)) return false;
  try {
    const artifact = safeArtifactPath(root, binding.path);
    if (!fs.existsSync(artifact.absolute)) return false;
    const stat = fs.statSync(artifact.absolute);
    if (!stat.isFile() || stat.size !== binding.bytes || stat.size > ARCHITECTURE_INTERIOR_RECOVERY_MAX_SOURCE_BYTES) return false;
    const bytes = fs.readFileSync(artifact.absolute);
    return bytes.byteLength === binding.bytes && hash(bytes) === binding.sha256;
  } catch {
    return false;
  }
}

function isolatedStagingTarget(value) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return url.protocol === 'https:' && url.origin !== 'https://nexyfab.com'
      && ['staging', 'stage', 'preview', 'test'].some(marker => hostname.includes(marker));
  } catch {
    return false;
  }
}

function normalizedRelease(value) {
  if (typeof value?.buildId !== 'string' || !value.buildId.trim()
    || typeof value?.productionDeploymentId !== 'string' || !value.productionDeploymentId.trim()
    || typeof value?.evidenceDeploymentId !== 'string' || !value.evidenceDeploymentId.trim()
    || value.productionDeploymentId.trim() === value.evidenceDeploymentId.trim()
    || typeof value?.gitHead !== 'string' || !GIT_SHA.test(value.gitHead.trim())) {
    throw new Error('recovery evidence release identity is incomplete');
  }
  return {
    buildId: value.buildId.trim(),
    productionDeploymentId: value.productionDeploymentId.trim(),
    evidenceDeploymentId: value.evidenceDeploymentId.trim(),
    gitHead: value.gitHead.trim(),
  };
}

function strictBase64(value) {
  if (typeof value !== 'string'
    || value.length > Math.ceil(ARCHITECTURE_INTERIOR_RECOVERY_MAX_OBSERVATION_BODY_BYTES / 3) * 4
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return null;
  const bytes = Buffer.from(value, 'base64');
  return bytes.toString('base64') === value ? bytes : null;
}

function decodeObservation(value, expectedId) {
  if (!isRecord(value) || value.id !== expectedId || !isRecord(value.request)
    || typeof value.request.method !== 'string' || typeof value.request.pathname !== 'string'
    || !Number.isInteger(value.httpStatus) || value.httpStatus < 100 || value.httpStatus > 599
    || typeof value.contentType !== 'string' || !value.contentType.toLowerCase().startsWith('application/json')
    || !Number.isInteger(value.bodyBytes) || value.bodyBytes < 0 || value.bodyBytes > ARCHITECTURE_INTERIOR_RECOVERY_MAX_OBSERVATION_BODY_BYTES
    || typeof value.bodySha256 !== 'string' || !SHA256.test(value.bodySha256)) throw new Error(`invalid recovery observation: ${expectedId}`);
  const bytes = strictBase64(value.bodyBase64);
  if (!bytes || bytes.byteLength !== value.bodyBytes || hash(bytes) !== value.bodySha256) throw new Error(`recovery observation bytes do not match: ${expectedId}`);
  let body;
  try { body = JSON.parse(decoder.decode(bytes)); } catch { throw new Error(`recovery observation body is not JSON: ${expectedId}`); }
  if (!boundedEvidenceValue(body)) throw new Error(`recovery observation body exceeds structural limits: ${expectedId}`);
  return { value, body, bytes };
}

function summary(observation) {
  return {
    id: observation.id,
    request: { method: observation.request.method, pathname: observation.request.pathname },
    httpStatus: observation.httpStatus,
    contentType: observation.contentType,
    bodyBytes: observation.bodyBytes,
    bodySha256: observation.bodySha256,
  };
}

function collectObjectIds(document) {
  const ids = [];
  for (const value of Object.values(document)) {
    if (!Array.isArray(value)) continue;
    for (const object of value) if (isRecord(object) && typeof object.id === 'string' && object.id) ids.push(object.id);
  }
  ids.sort();
  if (new Set(ids).size !== ids.length) throw new Error('workspace object identities must be unique');
  return ids;
}

export function workspaceSnapshot(workspace, editedObjectId) {
  if (!isRecord(workspace) || !isRecord(workspace.workspace) || !isRecord(workspace.architecture) || !isRecord(workspace.interior)) throw new Error('workspace envelope missing');
  const revision = workspace.workspace.revision;
  const architectureDocument = workspace.architecture.document;
  const interiorDocument = workspace.interior.document;
  if (!Number.isSafeInteger(revision) || revision < 0 || typeof workspace.contentHash !== 'string' || !SHA256.test(workspace.contentHash)
    || typeof workspace.architecture.documentId !== 'string' || !workspace.architecture.documentId
    || typeof workspace.interior.documentId !== 'string' || !workspace.interior.documentId
    || !isRecord(architectureDocument) || !isRecord(interiorDocument)) throw new Error('workspace identity missing');
  const allObjects = [...Object.values(architectureDocument), ...Object.values(interiorDocument)].flat().filter(isRecord);
  const edited = allObjects.find(object => object.id === editedObjectId);
  if (!edited) throw new Error(`edited object ${editedObjectId} missing`);
  const objectIds = [...collectObjectIds(architectureDocument), ...collectObjectIds(interiorDocument)].sort();
  if (objectIds.length === 0 || new Set(objectIds).size !== objectIds.length) throw new Error('workspace object identities must be present and globally unique');
  return {
    revision,
    contentHash: workspace.contentHash,
    architectureDocumentId: workspace.architecture.documentId,
    interiorDocumentId: workspace.interior.documentId,
    objectIds,
    editedObjectId,
    editedObjectValue: structuredClone(edited),
  };
}

export function assertObjectIdentity(before, after) {
  if (before.architectureDocumentId !== after.architectureDocumentId || before.interiorDocumentId !== after.interiorDocumentId
    || canonical(before.objectIds) !== canonical(after.objectIds) || before.editedObjectId !== after.editedObjectId) {
    throw new Error('document or object identity changed during recovery');
  }
}

function workspaceBody(observation, id) {
  const body = observation.get(id).body;
  if (!isRecord(body) || !isRecord(body.workspace)) throw new Error(`${id} did not return a workspace`);
  return body.workspace;
}

function contract(observation, id, method, pathname, status) {
  const item = observation.get(id).value;
  if (item.request.method !== method || item.request.pathname !== pathname || item.httpStatus !== status) throw new Error(`recovery observation contract failed: ${id}`);
}

function derive(source, expectedProjectId, expectedEditedObjectId) {
  if (source?.schema !== ARCHITECTURE_INTERIOR_RECOVERY_SOURCE_SCHEMA
    || !Array.isArray(source.observations) || source.observations.length !== ARCHITECTURE_INTERIOR_RECOVERY_CHECKS.length) {
    throw new Error('exact ordered recovery observations are required');
  }
  const decoded = new Map(ARCHITECTURE_INTERIOR_RECOVERY_CHECKS.map((id, index) => [id, decodeObservation(source.observations[index], id)]));
  const created = decoded.get('project_create').body;
  const projectId = created?.project?.id;
  if (typeof projectId !== 'string' || !projectId || (expectedProjectId && projectId !== expectedProjectId)) throw new Error('recovery project identity mismatch');
  if (typeof expectedEditedObjectId !== 'string' || !expectedEditedObjectId) throw new Error('recovery edited object identity missing');
  const projectPath = `/api/nexyfab/projects/${encodeURIComponent(projectId)}`;
  const agentPath = `${projectPath}/architecture-interior-agent`;
  const historyPath = `${projectPath}/architecture-interior-history`;
  contract(decoded, 'owner_login', 'POST', '/api/auth/login', 200);
  contract(decoded, 'project_create', 'POST', '/api/nexyfab/projects', 201);
  contract(decoded, 'workspace_initialized', 'GET', agentPath, 200);
  contract(decoded, 'apply_edit', 'POST', agentPath, 200);
  contract(decoded, 'undo', 'POST', historyPath, 200);
  contract(decoded, 'reconnect_before_reload', 'GET', agentPath, 200);
  contract(decoded, 'reconnect_after_reload', 'GET', agentPath, 200);
  contract(decoded, 'redo', 'POST', historyPath, 200);
  contract(decoded, 'viewer_agent_denied', 'POST', agentPath, 403);
  contract(decoded, 'viewer_history_denied', 'POST', historyPath, 403);
  contract(decoded, 'project_cleanup', 'DELETE', projectPath, 200);
  contract(decoded, 'project_cleanup_confirm', 'GET', projectPath, 404);
  for (const id of ['viewer_agent_denied', 'viewer_history_denied']) {
    if (decoded.get(id).body?.code !== 'EDITOR_REQUIRED') throw new Error(`${id} must return EDITOR_REQUIRED`);
  }

  const workspaces = {
    initial: workspaceBody(decoded, 'workspace_initialized'),
    applied: workspaceBody(decoded, 'apply_edit'),
    undone: workspaceBody(decoded, 'undo'),
    reconnectBeforeReload: workspaceBody(decoded, 'reconnect_before_reload'),
    reconnectAfterReload: workspaceBody(decoded, 'reconnect_after_reload'),
    redone: workspaceBody(decoded, 'redo'),
  };
  const snapshots = Object.fromEntries(Object.entries(workspaces).map(([key, value]) => [key, workspaceSnapshot(value, expectedEditedObjectId)]));
  const ordered = [snapshots.initial, snapshots.applied, snapshots.undone, snapshots.redone];
  ordered.forEach((item, index) => {
    if (item.revision !== snapshots.initial.revision + index) throw new Error('recovery revisions are not an exact monotonic sequence');
    assertObjectIdentity(snapshots.initial, item);
    if (index > 0 && item.contentHash === ordered[index - 1].contentHash) throw new Error('recovery content hash did not change');
  });
  for (const reconnect of [snapshots.reconnectBeforeReload, snapshots.reconnectAfterReload]) {
    if (canonical(reconnect) !== canonical(snapshots.undone)) throw new Error('browser reconnect did not recover the exact undone snapshot');
  }
  if (canonical(workspaces.reconnectBeforeReload) !== canonical(workspaces.undone)
    || canonical(workspaces.reconnectAfterReload) !== canonical(workspaces.undone)) throw new Error('browser reconnect workspace bytes are semantically different');
  if (canonical(snapshots.initial.editedObjectValue) !== canonical(snapshots.undone.editedObjectValue)
    || canonical(snapshots.applied.editedObjectValue) !== canonical(snapshots.redone.editedObjectValue)
    || canonical(snapshots.initial.editedObjectValue) === canonical(snapshots.applied.editedObjectValue)) {
    throw new Error('apply/undo/redo edited value roundtrip is inconsistent');
  }
  return {
    projectId,
    editedObjectId: expectedEditedObjectId,
    observations: source.observations.map(summary),
    snapshots,
    viewerDenial: {
      agent: { status: 403, code: 'EDITOR_REQUIRED' },
      history: { status: 403, code: 'EDITOR_REQUIRED' },
    },
    cleanup: { deleteStatus: 200, confirmGetStatus: 404 },
  };
}

function unsignedReceipt(receipt) {
  return Object.fromEntries(Object.entries(receipt).filter(([key]) => key !== 'sha256'));
}

export function buildArchitectureInteriorRecoveryEvidence({ generatedAt, target, release, projectId, editedObjectId, observations, sourceBinding, now = Date.now() } = {}) {
  const timestamp = Date.parse(generatedAt ?? new Date(now).toISOString());
  if (!Number.isFinite(timestamp) || timestamp > now + 5 * 60_000 || timestamp < now - ARCHITECTURE_INTERIOR_RECOVERY_MAX_AGE_MS) throw new Error('recovery evidence timestamp is outside the freshness window');
  if (!isolatedStagingTarget(target)) throw new Error('recovery evidence target must be isolated HTTPS staging');
  const releaseValue = normalizedRelease(release);
  if (!isRecord(sourceBinding) || typeof sourceBinding.path !== 'string' || !sourceBinding.path
    || path.isAbsolute(sourceBinding.path) || sourceBinding.path.split(/[\\/]+/).includes('..')
    || !Number.isInteger(sourceBinding.bytes) || sourceBinding.bytes <= 0 || typeof sourceBinding.sha256 !== 'string' || !SHA256.test(sourceBinding.sha256)) {
    throw new Error('recovery source binding is invalid');
  }
  const normalizedGeneratedAt = new Date(timestamp).toISOString();
  const source = { schema: ARCHITECTURE_INTERIOR_RECOVERY_SOURCE_SCHEMA, generatedAt: normalizedGeneratedAt, target, observations };
  const derived = derive(source, projectId, editedObjectId);
  const receipt = {
    schema: ARCHITECTURE_INTERIOR_RECOVERY_SCHEMA,
    generatedAt: normalizedGeneratedAt,
    ok: true,
    environment: 'staging',
    target,
    release: releaseValue,
    freshness: { generatedAt: normalizedGeneratedAt, maxAgeMs: ARCHITECTURE_INTERIOR_RECOVERY_MAX_AGE_MS },
    requiredChecks: [...ARCHITECTURE_INTERIOR_RECOVERY_CHECKS],
    checks: [...ARCHITECTURE_INTERIOR_RECOVERY_CHECKS],
    sourceBindings: [sourceBinding],
    ...derived,
    transientProjectRetained: false,
    credentialsPersisted: false,
  };
  return { ...receipt, sha256: hashJson(receipt) };
}

export function verifyArchitectureInteriorRecoveryEvidence(receipt, expectedRelease, { root = process.cwd(), now = Date.now() } = {}) {
  try {
    if (!boundedEvidenceValue(receipt)) return false;
    const timestamp = Date.parse(receipt?.generatedAt);
    if (receipt?.schema !== ARCHITECTURE_INTERIOR_RECOVERY_SCHEMA || receipt.ok !== true || receipt.environment !== 'staging'
      || !Number.isFinite(timestamp) || timestamp > now + 5 * 60_000 || timestamp < now - ARCHITECTURE_INTERIOR_RECOVERY_MAX_AGE_MS
      || receipt.freshness?.generatedAt !== receipt.generatedAt || receipt.freshness?.maxAgeMs !== ARCHITECTURE_INTERIOR_RECOVERY_MAX_AGE_MS
      || !isolatedStagingTarget(receipt.target) || receipt.credentialsPersisted !== false || receipt.transientProjectRetained !== false
      || JSON.stringify(receipt.requiredChecks) !== JSON.stringify(ARCHITECTURE_INTERIOR_RECOVERY_CHECKS)
      || JSON.stringify(receipt.checks) !== JSON.stringify(ARCHITECTURE_INTERIOR_RECOVERY_CHECKS)
      || !Array.isArray(receipt.sourceBindings) || receipt.sourceBindings.length !== 1 || !validBinding(root, receipt.sourceBindings[0])) return false;
    const actualRelease = normalizedRelease(receipt.release);
    if (expectedRelease && canonical(actualRelease) !== canonical(normalizedRelease(expectedRelease))) return false;
    const sourceBytes = fs.readFileSync(safeArtifactPath(root, receipt.sourceBindings[0].path).absolute);
    const source = JSON.parse(decoder.decode(sourceBytes));
    if (!boundedEvidenceValue(source)) return false;
    if (source.schema !== ARCHITECTURE_INTERIOR_RECOVERY_SOURCE_SCHEMA || source.generatedAt !== receipt.generatedAt || source.target !== receipt.target) return false;
    const derived = derive(source, receipt.projectId, receipt.editedObjectId);
    for (const key of ['projectId', 'editedObjectId', 'observations', 'snapshots', 'viewerDenial', 'cleanup']) {
      if (canonical(receipt[key]) !== canonical(derived[key])) return false;
    }
    return typeof receipt.sha256 === 'string' && SHA256.test(receipt.sha256) && hashJson(unsignedReceipt(receipt)) === receipt.sha256;
  } catch {
    return false;
  }
}

export function writeArchitectureInteriorRecoveryEvidence({ root = process.cwd(), artifactPath, generatedAt, target, release, projectId, editedObjectId, observations, now = Date.now() } = {}) {
  const receiptArtifact = safeArtifactPath(root, artifactPath);
  const sourceArtifact = safeArtifactPath(root, `${receiptArtifact.relative}.observations.json`);
  const timestamp = Date.parse(generatedAt ?? new Date(now).toISOString());
  if (!Number.isFinite(timestamp)) throw new Error('recovery evidence timestamp is invalid');
  const normalizedGeneratedAt = new Date(timestamp).toISOString();
  const source = { schema: ARCHITECTURE_INTERIOR_RECOVERY_SOURCE_SCHEMA, generatedAt: normalizedGeneratedAt, target, observations };
  const sourceBytes = Buffer.from(`${JSON.stringify(source, null, 2)}\n`, 'utf8');
  if (sourceBytes.byteLength > ARCHITECTURE_INTERIOR_RECOVERY_MAX_SOURCE_BYTES) throw new Error('recovery evidence source exceeds the byte limit');
  const sourceBinding = { path: sourceArtifact.relative, bytes: sourceBytes.byteLength, sha256: hash(sourceBytes) };
  const receipt = buildArchitectureInteriorRecoveryEvidence({ generatedAt: normalizedGeneratedAt, target, release, projectId, editedObjectId, observations, sourceBinding, now });
  fs.mkdirSync(path.dirname(sourceArtifact.absolute), { recursive: true });
  fs.writeFileSync(sourceArtifact.absolute, sourceBytes);
  if (!verifyArchitectureInteriorRecoveryEvidence(receipt, release, { root, now })) throw new Error('refusing to write an unverifiable recovery PASS receipt');
  fs.mkdirSync(path.dirname(receiptArtifact.absolute), { recursive: true });
  fs.writeFileSync(receiptArtifact.absolute, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  return receipt;
}

export function clearArchitectureInteriorRecoveryEvidence({ root = process.cwd(), artifactPath } = {}) {
  const receiptArtifact = safeArtifactPath(root, artifactPath);
  const sourceArtifact = safeArtifactPath(root, `${receiptArtifact.relative}.observations.json`);
  for (const artifact of [receiptArtifact, sourceArtifact]) {
    if (fs.existsSync(artifact.absolute)) fs.unlinkSync(artifact.absolute);
  }
}
