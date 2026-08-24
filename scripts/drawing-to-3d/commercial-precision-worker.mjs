#!/usr/bin/env node
import { createHash, createHmac, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { isAbsolute, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const EXECUTION_CONTRACT = 'nexyfab.precision-cad-commercial-execution.v3';
export const INPUT_SCHEMA = 'nexyfab.precision-cad-commercial-input.v1';
export const HEALTH_SCHEMA = 'nexyfab.precision-cad-commercial-worker-health.v1';
export const VERIFICATION_SCHEMA = 'nexyfab.precision-cad-commercial-native-verification.v1';
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const MAX_INPUT_BYTES = 512 * 1024;
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

export function canonical(value, depth = 0) {
  if (depth > 12) throw new Error('canonical_depth_exceeded');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('canonical_nonfinite');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(item => canonical(item, depth + 1)).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key], depth + 1)}`).join(',')}}`;
  throw new Error('canonical_unsupported');
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function hmac(secret, value) {
  return createHmac('sha256', secret).update(value, 'utf8').digest('base64url');
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password
      && !['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  } catch { return false; }
}

function readConfig(env = process.env) {
  const required = [
    'NEXYFAB_COMMERCIAL_CORE_URL', 'NEXYFAB_COMMERCIAL_WORKER_IDENTITY',
    'NEXYFAB_COMMERCIAL_WORKER_CLAIM_SECRET', 'NEXYFAB_COMMERCIAL_TRANSPORT_SECRET',
    'NEXYFAB_COMMERCIAL_CALLBACK_SECRET', 'NEXYFAB_COMMERCIAL_WORKER_PRIVATE_KEY_PEM',
    'NEXYFAB_COMMERCIAL_NATIVE_EXECUTABLE',
  ];
  if (required.some(key => !env[key]?.trim())) throw new Error('worker_configuration_incomplete');
  const coreUrl = env.NEXYFAB_COMMERCIAL_CORE_URL.replace(/\/$/, '');
  if (!safeUrl(coreUrl) || !SAFE_ID.test(env.NEXYFAB_COMMERCIAL_WORKER_IDENTITY)) throw new Error('worker_configuration_invalid');
  for (const key of ['NEXYFAB_COMMERCIAL_WORKER_CLAIM_SECRET', 'NEXYFAB_COMMERCIAL_TRANSPORT_SECRET', 'NEXYFAB_COMMERCIAL_CALLBACK_SECRET']) {
    if (Buffer.byteLength(env[key], 'utf8') < 32) throw new Error('worker_secret_weak');
  }
  if (!isAbsolute(env.NEXYFAB_COMMERCIAL_NATIVE_EXECUTABLE)) throw new Error('native_executable_absolute_path_required');
  let nativeArgs = [];
  if (env.NEXYFAB_COMMERCIAL_NATIVE_ARGS_JSON) {
    const parsed = JSON.parse(env.NEXYFAB_COMMERCIAL_NATIVE_ARGS_JSON);
    if (!Array.isArray(parsed) || parsed.length > 32 || parsed.some(item => typeof item !== 'string' || item.length > 512)) throw new Error('native_args_invalid');
    nativeArgs = parsed;
  }
  const privateKey = createPrivateKey(env.NEXYFAB_COMMERCIAL_WORKER_PRIVATE_KEY_PEM.replaceAll('\\n', '\n'));
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('worker_ed25519_private_key_required');
  const publicKey = createPublicKey(privateKey);
  const fingerprint = digest(publicKey.export({ type: 'spki', format: 'der' }));
  const timeoutMs = Number(env.NEXYFAB_COMMERCIAL_NATIVE_TIMEOUT_MS ?? 10 * 60_000);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 30 * 60_000) throw new Error('native_timeout_invalid');
  return Object.freeze({
    coreUrl,
    workerIdentity: env.NEXYFAB_COMMERCIAL_WORKER_IDENTITY,
    claimSecret: env.NEXYFAB_COMMERCIAL_WORKER_CLAIM_SECRET,
    transportSecret: env.NEXYFAB_COMMERCIAL_TRANSPORT_SECRET,
    callbackSecret: env.NEXYFAB_COMMERCIAL_CALLBACK_SECRET,
    nativeExecutable: env.NEXYFAB_COMMERCIAL_NATIVE_EXECUTABLE,
    nativeArgs,
    nativeTimeoutMs: timeoutMs,
    privateKey,
    publicKeyFingerprint: fingerprint,
    selfTestJobPrefix: env.NEXYFAB_COMMERCIAL_SELF_TEST_JOB_PREFIX ?? 'canary-',
    pollMs: Math.min(30_000, Math.max(500, Number(env.NEXYFAB_COMMERCIAL_WORKER_POLL_MS ?? 2_000))),
    port: Number(env.PORT ?? 8080),
  });
}

function transportIssues(transport, config, now = Date.now()) {
  const issues = [];
  if (!transport || typeof transport !== 'object' || transport.schema !== EXECUTION_CONTRACT) issues.push('transport_schema_invalid');
  const job = transport?.job;
  if (!job || job.contractVersion !== EXECUTION_CONTRACT || !SAFE_ID.test(job.jobId ?? '') || !job.inputArtifact) issues.push('job_contract_invalid');
  if (!safeUrl(transport?.callbackUrl) || !safeUrl(transport?.inputDownloadUrl) || !safeUrl(transport?.artifactGatewayUrl)) issues.push('transport_url_invalid');
  const issued = Date.parse(transport?.issuedAt ?? '');
  const expires = Date.parse(transport?.expiresAt ?? '');
  if (!Number.isFinite(issued) || !Number.isFinite(expires) || issued > now + 5 * 60_000 || expires <= now || expires - issued > 5 * 60_000) issues.push('transport_expired');
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(transport?.leaseCapability ?? '')) issues.push('lease_capability_invalid');
  const { transportHmac, ...unsigned } = transport ?? {};
  if (typeof transportHmac !== 'string' || hmac(config.transportSecret, canonical(unsigned)) !== transportHmac) issues.push('transport_hmac_invalid');
  return [...new Set(issues)];
}

async function fetchBytes(url, init, maximumBytes) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`http_${response.status}`);
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > maximumBytes) throw new Error('response_oversized');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > maximumBytes) throw new Error('response_oversized');
  return { response, bytes };
}

async function downloadInput(transport, config) {
  const { response, bytes } = await fetchBytes(transport.inputDownloadUrl, {
    headers: {
      authorization: `Bearer ${transport.leaseCapability}`,
      'x-commercial-worker-identity': config.workerIdentity,
      'cache-control': 'no-cache',
    },
    signal: AbortSignal.timeout(30_000),
  }, MAX_INPUT_BYTES);
  const expected = transport.job.inputArtifact;
  if (bytes.length !== expected.byteLength || digest(bytes) !== expected.contentSha256
    || response.headers.get('x-content-sha256') !== expected.contentSha256) throw new Error('input_artifact_hash_mismatch');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const parsed = JSON.parse(text);
  const { inputArtifact: _inputArtifact, ...jobBinding } = transport.job;
  if (canonical(parsed) !== text || parsed.schema !== INPUT_SCHEMA
    || canonical(parsed.job) !== canonical(jobBinding)
    || digest(Buffer.from(canonical(parsed.arguments), 'utf8')) !== transport.job.argumentsHash) throw new Error('input_payload_binding_mismatch');
  return { bytes, parsed };
}

async function runNative(config, inputPath, outputDirectory) {
  const executableStat = await stat(config.nativeExecutable);
  if (!executableStat.isFile()) throw new Error('native_executable_not_file');
  const executableSha256 = digest(await readFile(config.nativeExecutable));
  const args = [...config.nativeArgs, '--input', inputPath, '--output-dir', outputDirectory];
  await new Promise((resolve, reject) => {
    const child = spawn(config.nativeExecutable, args, { cwd: outputDirectory, shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] });
    let settled = false;
    const finish = fn => { if (settled) return; settled = true; clearTimeout(timer); fn(); };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(() => reject(new Error('native_execution_timeout'))); }, config.nativeTimeoutMs);
    child.once('error', () => finish(() => reject(new Error('native_execution_failed'))));
    child.once('close', code => finish(() => code === 0 ? resolve() : reject(new Error('native_execution_failed'))));
  });
  return executableSha256;
}

async function boundedRegularFile(pathname, maximumBytes) {
  const info = await lstat(pathname, { bigint: false });
  if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > maximumBytes) throw new Error('native_output_invalid');
  const bytes = await readFile(pathname);
  if (bytes.length !== info.size) throw new Error('native_output_changed');
  return bytes;
}

async function nativeOutputs(config, transport, input, directory, startedAt) {
  const inputPath = join(directory, 'input.json');
  const outputDirectory = join(directory, 'outputs');
  await Promise.all([
    mkdir(outputDirectory, { recursive: false }),
    writeFile(inputPath, input.bytes, { flag: 'wx' }),
  ]);
  const nativeExecutableSha256 = await runNative(config, inputPath, outputDirectory);
  const model = await boundedRegularFile(join(outputDirectory, 'model.step'), MAX_OUTPUT_BYTES);
  const report = await boundedRegularFile(join(outputDirectory, 'report.json'), MAX_OUTPUT_BYTES);
  const modelText = model.subarray(0, Math.min(model.length, 1024 * 1024)).toString('utf8');
  if (!modelText.includes('ISO-10303-21;') || !model.toString('utf8', Math.max(0, model.length - 1024)).includes('END-ISO-10303-21;')) throw new Error('native_step_invalid');
  const reportText = new TextDecoder('utf-8', { fatal: true }).decode(report);
  const reportValue = JSON.parse(reportText);
  if (!reportValue || typeof reportValue !== 'object' || reportValue.status !== 'PASS') throw new Error('native_report_hold');
  const verification = Buffer.from(canonical({
    schema: VERIFICATION_SCHEMA,
    jobId: transport.job.jobId,
    executionId: transport.job.executionId,
    inputArtifactSha256: transport.job.inputArtifact.contentSha256,
    nativeExecutableSha256,
    nativeProcessExitCode: 0,
    startedAt,
    completedAt: new Date().toISOString(),
    outputs: { modelSha256: digest(model), reportSha256: digest(report) },
    checks: { inputArtifactReadback: 'PASS', nativeExecution: 'PASS', stepEnvelope: 'PASS', reportStatus: 'PASS' },
  }), 'utf8');
  return [
    { role: 'model', mediaType: 'application/step', bytes: model },
    { role: 'report', mediaType: 'application/json', bytes: report },
    { role: 'verification', mediaType: 'application/json', bytes: verification },
  ];
}

async function gatewayJson(transport, config, body) {
  const response = await fetch(transport.artifactGatewayUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${transport.leaseCapability}`, 'x-commercial-worker-identity': config.workerIdentity },
    body: canonical(body),
    signal: AbortSignal.timeout(30_000),
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok || value.ok !== true) throw new Error(`artifact_gateway_${response.status}`);
  return value;
}

async function uploadOutputs(transport, config, outputs) {
  const artifacts = [];
  for (const output of outputs) {
    const contentSha256 = digest(output.bytes);
    const intent = { artifactId: `${output.role}-${contentSha256.slice(0, 48)}`, role: output.role, contentSha256, byteLength: output.bytes.length, mediaType: output.mediaType };
    const grant = await gatewayJson(transport, config, { action: 'output-intent', jobId: transport.job.jobId, intent });
    if (!grant.committed) {
      if (grant.grant?.uploadMode !== 'CORE_PUT' || !safeUrl(grant.grant?.uploadUrl)) throw new Error('output_upload_grant_invalid');
      const upload = await fetch(grant.grant.uploadUrl, {
        method: 'PUT',
        headers: { 'content-type': output.mediaType, authorization: `Bearer ${transport.leaseCapability}`, 'x-commercial-worker-identity': config.workerIdentity },
        body: output.bytes,
        signal: AbortSignal.timeout(120_000),
      });
      if (!upload.ok) throw new Error(`output_upload_${upload.status}`);
    }
    const committed = await gatewayJson(transport, config, { action: 'commit-output', jobId: transport.job.jobId, intent });
    const artifact = committed.artifact;
    if (!artifact || artifact.artifactId !== intent.artifactId || artifact.role !== intent.role
      || artifact.contentSha256 !== intent.contentSha256 || Number(artifact.byteLength) !== intent.byteLength
      || typeof artifact.objectKey !== 'string') throw new Error('output_commit_binding_invalid');
    artifacts.push(artifact);
  }
  return artifacts;
}

function signedReceipt(config, transport, values) {
  const receipt = {
    schema: EXECUTION_CONTRACT,
    tenantId: transport.job.tenantId,
    projectId: transport.job.projectId,
    executionId: transport.job.executionId,
    generationRunId: transport.job.generationRunId,
    generationStateRevision: transport.job.generationStateRevision,
    generationProgramSha256: transport.job.generationProgramSha256,
    workspaceId: transport.job.workspaceId,
    workspaceRevision: transport.job.workspaceRevision,
    workspaceContentHash: transport.job.workspaceContentHash,
    journalVersion: transport.job.journalVersion,
    leaseGeneration: transport.job.leaseGeneration,
    leaseCapabilityHash: digest(Buffer.from(transport.leaseCapability, 'utf8')),
    attempt: transport.job.attempt,
    jobId: transport.job.jobId,
    commandHash: transport.job.commandHash,
    targetHash: transport.job.targetHash,
    inputArtifactSha256: transport.job.inputArtifact.contentSha256,
    workerIdentity: config.workerIdentity,
    workerPublicKeyFingerprint: config.publicKeyFingerprint,
    status: values.status,
    startedAt: values.startedAt,
    completedAt: values.completedAt,
    outputArtifacts: values.outputArtifacts,
    failureReasons: values.failureReasons,
    signatureBase64: '',
  };
  const unsigned = { ...receipt };
  delete unsigned.signatureBase64;
  const payload = canonical({ schema: receipt.schema, purpose: 'worker-receipt', receipt: unsigned });
  receipt.signatureBase64 = sign(null, Buffer.from(payload, 'utf8'), config.privateKey).toString('base64');
  return receipt;
}

async function postReceipt(config, transport, receipt) {
  const body = canonical(receipt);
  const response = await fetch(transport.callbackUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-commercial-callback-hmac': hmac(config.callbackSecret, body) },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok || value.ok !== true) throw new Error(`callback_${response.status}`);
  return { receipt, receiptSha256: digest(Buffer.from(body, 'utf8')) };
}

export async function executeTransport(config, transport) {
  const issues = transportIssues(transport, config);
  if (issues.length) throw new Error(`transport_rejected:${issues.join(',')}`);
  const startedAt = new Date().toISOString();
  let directory;
  try {
    const input = await downloadInput(transport, config);
    directory = await mkdtemp(join(tmpdir(), 'nexyfab-commercial-worker-'));
    const outputs = await nativeOutputs(config, transport, input, directory, startedAt);
    const outputArtifacts = await uploadOutputs(transport, config, outputs);
    const receipt = signedReceipt(config, transport, { status: 'PASS', startedAt, completedAt: new Date().toISOString(), outputArtifacts, failureReasons: [] });
    return await postReceipt(config, transport, receipt);
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 256) : 'worker_execution_failed';
    const receipt = signedReceipt(config, transport, { status: 'HOLD', startedAt, completedAt: new Date().toISOString(), outputArtifacts: [], failureReasons: [reason] });
    await postReceipt(config, transport, receipt).catch(() => undefined);
    throw error;
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function claimOnce(config) {
  const response = await fetch(`${config.coreUrl}/api/internal/precision-cad-commercial/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.claimSecret}` },
    body: canonical({ owner: config.workerIdentity }),
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 404) return null;
  const value = await response.json().catch(() => ({}));
  if (!response.ok || value.ok !== true || !value.transport) throw new Error(`claim_${response.status}`);
  return value.transport;
}

function healthBody(config, state) {
  if (!state.selfTest) return {
    schema: HEALTH_SCHEMA,
    status: 'NOT_READY',
    executionContract: EXECUTION_CONTRACT,
    claimConsumer: state.claimConsumer,
    inputArtifactReadback: 'NOT_RUN',
    nativeExecution: 'NOT_RUN',
    artifactUpload: 'NOT_RUN',
    signedCallback: 'NOT_RUN',
    workerIdentity: config.workerIdentity,
    selfTestReceiptSha256: null,
    lastSelfTestAt: null,
  };
  return {
    schema: HEALTH_SCHEMA,
    status: 'READY',
    executionContract: EXECUTION_CONTRACT,
    claimConsumer: state.claimConsumer,
    inputArtifactReadback: 'PASS',
    nativeExecution: 'PASS',
    artifactUpload: 'PASS',
    signedCallback: 'PASS',
    workerIdentity: config.workerIdentity,
    selfTestReceiptSha256: state.selfTest.receiptSha256,
    lastSelfTestAt: state.selfTest.completedAt,
  };
}

export async function runService(env = process.env) {
  const config = readConfig(env);
  const state = { claimConsumer: 'ACTIVE', selfTest: null, stopping: false };
  const server = createServer((req, res) => {
    if (req.method !== 'GET' || (req.url !== '/' && req.url !== '/health')) { res.writeHead(404).end(); return; }
    const body = Buffer.from(JSON.stringify(healthBody(config, state)), 'utf8');
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': String(body.length), 'cache-control': 'no-store' });
    res.end(body);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.port, '0.0.0.0', resolve); });
  const stop = () => { state.stopping = true; server.close(); };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  while (!state.stopping) {
    try {
      const transport = await claimOnce(config);
      if (transport) {
        const result = await executeTransport(config, transport);
        if (transport.job.jobId.startsWith(config.selfTestJobPrefix)) state.selfTest = { receiptSha256: result.receiptSha256, completedAt: result.receipt.completedAt };
      }
    } catch { /* fail closed; the signed HOLD callback carries job-specific detail */ }
    if (!state.stopping) await new Promise(resolve => setTimeout(resolve, config.pollMs));
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  runService().catch(() => { process.exitCode = 1; });
}
