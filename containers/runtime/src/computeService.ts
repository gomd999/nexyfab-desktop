import { createHash, timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import {
  JOB_CONTRACT_VERSION,
  validateCadJobComputeRequest,
  validateCadJobReceipt,
  type CadJobArtifactRef,
  type CadJobComputeRequest,
  type CadJobMessage,
  type CadJobOutputArtifactIntent,
  type CadJobOutputUploadGrant,
  type CadJobReceipt,
} from '../../../packages/job-contracts/src/index';

export interface ResolvedComputeInput {
  ref: CadJobArtifactRef;
  bytes: Buffer;
}

export interface ComputeOutput {
  filename: string;
  mediaType: string;
  format: string;
  bytes: Buffer;
  shapeIdentitySha256?: string;
}

export interface CadComputeExecutor {
  readonly serviceId: string;
  readonly workerIdentitySha256: string;
  readonly kernelIdentitySha256: string | 'NOT_APPLICABLE';
  readonly producerBuildId: string;
  supports(message: CadJobMessage): boolean;
  execute(message: CadJobMessage, inputs: ResolvedComputeInput[], signal: AbortSignal): Promise<ComputeOutput[]>;
}

export interface ComputeServiceOptions {
  computeSharedSecret: string;
  timeoutMs?: number;
  maxInputBytes?: number;
  inlineOutputMaxBytes?: number;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

const SHA256 = /^[a-f0-9]{64}$/;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).filter(key => record[key] !== undefined).sort()
    .map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

export function sha256Bytes(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function sameSecret(expected: string, supplied: string): boolean {
  if (expected.length < 32) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

async function jsonPost(fetchImpl: typeof fetch, url: string, body: unknown): Promise<Record<string, unknown>> {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(`artifact_gateway_${response.status}:${String(payload.code ?? 'request_failed')}`);
  return payload;
}

async function resolveInputs(
  request: CadJobComputeRequest,
  fetchImpl: typeof fetch,
  maxInputBytes: number,
  signal: AbortSignal,
): Promise<ResolvedComputeInput[]> {
  const gateway = new URL(request.artifactGatewayUrl);
  const output: ResolvedComputeInput[] = [];
  let total = 0;
  for (const access of request.inputArtifacts) {
    if (Date.parse(access.expiresAt) <= Date.now()) throw new Error(`input_access_expired:${access.artifact.artifactId}`);
    const url = new URL(access.downloadUrl);
    const isGateway = url.origin === gateway.origin && url.pathname === gateway.pathname;
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: isGateway ? { authorization: `Bearer ${request.authorizationToken}` } : undefined,
      signal,
    });
    if (!response.ok) throw new Error(`input_download_${response.status}:${access.artifact.artifactId}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    total += bytes.length;
    if (!bytes.length || total > maxInputBytes) throw new Error('input_bytes_limit_exceeded');
    if (sha256Bytes(bytes) !== access.artifact.contentSha256) {
      throw new Error(`input_content_hash_mismatch:${access.artifact.artifactId}`);
    }
    output.push({ ref: access.artifact, bytes });
  }
  return output;
}

function artifactId(message: CadJobMessage, index: number, contentSha256: string): string {
  return `out-${sha256Bytes(`${message.jobId}\0${index}\0${contentSha256}`).slice(0, 40)}`;
}

async function publishOutput(
  request: CadJobComputeRequest,
  executor: CadComputeExecutor,
  output: ComputeOutput,
  index: number,
  fetchImpl: typeof fetch,
  inlineOutputMaxBytes: number,
): Promise<CadJobArtifactRef> {
  const contentSha256 = sha256Bytes(output.bytes);
  const intent: CadJobOutputArtifactIntent = {
    artifactId: artifactId(request.message, index, contentSha256),
    filename: output.filename,
    mediaType: output.mediaType,
    format: output.format,
    byteLength: output.bytes.length,
    contentSha256,
    ...(output.shapeIdentitySha256 ? { shapeIdentitySha256: output.shapeIdentitySha256 } : {}),
    producerBuildId: executor.producerBuildId,
    kernelIdentity: executor.kernelIdentitySha256,
  };
  const base = {
    message: request.message,
    authorizationToken: request.authorizationToken,
    intent,
  };
  const intentResult = await jsonPost(fetchImpl, request.artifactGatewayUrl, { action: 'output-intent', ...base });
  if (intentResult.committed === true && intentResult.artifact) return intentResult.artifact as CadJobArtifactRef;
  const grant = intentResult.grant as CadJobOutputUploadGrant | undefined;
  if (!grant || grant.artifact.contentSha256 !== contentSha256 || Date.parse(grant.expiresAt) <= Date.now()) {
    throw new Error('artifact_gateway_grant_invalid');
  }
  if (grant.uploadMode === 'DIRECT_PUT') {
    const uploadBody = output.bytes.buffer.slice(
      output.bytes.byteOffset,
      output.bytes.byteOffset + output.bytes.byteLength,
    ) as ArrayBuffer;
    const response = await fetchImpl(grant.uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': grant.requiredContentType },
      body: uploadBody,
    });
    if (!response.ok) throw new Error(`artifact_direct_upload_${response.status}`);
  } else {
    if (output.bytes.length > inlineOutputMaxBytes) throw new Error('artifact_inline_output_limit_exceeded');
    await jsonPost(fetchImpl, grant.uploadUrl, { action: 'output-upload', ...base, dataBase64: output.bytes.toString('base64') });
  }
  const committed = await jsonPost(fetchImpl, request.artifactGatewayUrl, { action: 'commit-output', ...base });
  if (committed.committed !== true || !committed.artifact) throw new Error('artifact_gateway_commit_rejected');
  return committed.artifact as CadJobArtifactRef;
}

function receipt(
  request: CadJobComputeRequest,
  executor: CadComputeExecutor,
  startedAt: string,
  completedAt: string,
  execution: CadJobReceipt['execution'],
  outputArtifacts: CadJobArtifactRef[],
  failureReasons: string[],
): CadJobReceipt {
  const core = {
    contractVersion: JOB_CONTRACT_VERSION,
    jobId: request.message.jobId,
    workerIdentitySha256: executor.workerIdentitySha256,
    kernelIdentitySha256: executor.kernelIdentitySha256,
    inputArtifacts: request.message.inputArtifacts,
    outputArtifacts,
    execution,
    startedAt,
    completedAt,
    failureReasons,
  };
  return { ...core, receiptSha256: sha256Bytes(canonicalJson(core)) };
}

export async function executeCadComputeRequest(
  request: CadJobComputeRequest,
  executor: CadComputeExecutor,
  options: ComputeServiceOptions,
  externalSignal?: AbortSignal,
): Promise<CadJobReceipt> {
  const issues = validateCadJobComputeRequest(request);
  if (issues.length) throw new Error(`compute_request_rejected:${issues.join(',')}`);
  if (!SHA256.test(executor.workerIdentitySha256)
      || (executor.kernelIdentitySha256 !== 'NOT_APPLICABLE' && !SHA256.test(executor.kernelIdentitySha256))) {
    throw new Error('executor_identity_invalid');
  }
  if (!executor.supports(request.message)) throw new Error(`job_kind_unsupported:${request.message.kind}`);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = Math.min(30 * 60_000, Math.max(1_000, options.timeoutMs ?? 10 * 60_000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('execution_timeout'), timeoutMs);
  const abortFromCaller = () => controller.abort(externalSignal?.reason ?? 'request_cancelled');
  if (externalSignal?.aborted) abortFromCaller();
  else externalSignal?.addEventListener('abort', abortFromCaller, { once: true });
  const startedAt = (options.now ?? (() => new Date()))().toISOString();
  try {
    const inputs = await resolveInputs(request, fetchImpl, options.maxInputBytes ?? 512 * 1024 * 1024, controller.signal);
    let outputs: ComputeOutput[];
    try {
      outputs = await executor.execute(request.message, inputs, controller.signal);
    } catch (error) {
      const reason = controller.signal.aborted
        ? `execution_aborted:${String(controller.signal.reason ?? 'unknown')}`
        : `executor_failed:${error instanceof Error ? error.message : String(error)}`;
      return receipt(request, executor, startedAt, (options.now ?? (() => new Date()))().toISOString(), 'FAIL', [], [reason.slice(0, 1000)]);
    }
    if (!outputs.length) {
      return receipt(request, executor, startedAt, (options.now ?? (() => new Date()))().toISOString(), 'FAIL', [], ['executor_produced_no_output']);
    }
    const outputArtifacts: CadJobArtifactRef[] = [];
    for (const [index, output] of outputs.entries()) {
      if (!output.bytes.length) throw new Error(`empty_output:${index}`);
      if (output.shapeIdentitySha256 && !SHA256.test(output.shapeIdentitySha256)) throw new Error(`shape_identity_invalid:${index}`);
      outputArtifacts.push(await publishOutput(
        request, executor, output, index, fetchImpl, options.inlineOutputMaxBytes ?? 16 * 1024 * 1024,
      ));
    }
    const result = receipt(request, executor, startedAt, (options.now ?? (() => new Date()))().toISOString(), 'PASS', outputArtifacts, []);
    const receiptIssues = validateCadJobReceipt(result);
    if (receiptIssues.length) throw new Error(`generated_receipt_invalid:${receiptIssues.join(',')}`);
    return result;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', abortFromCaller);
  }
}

export function createComputeServiceHandler(executor: CadComputeExecutor, options: ComputeServiceOptions) {
  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/healthz') {
      return json(200, {
        ok: true,
        service: executor.serviceId,
        producerBuildId: executor.producerBuildId,
        workerIdentitySha256: executor.workerIdentitySha256,
        kernelIdentitySha256: executor.kernelIdentitySha256,
        execution: 'NOT_RUN',
      });
    }
    const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
    if (!sameSecret(options.computeSharedSecret, supplied)) return json(403, { ok: false, code: 'FORBIDDEN' });
    if (request.method !== 'POST' || url.pathname !== '/v1/jobs') return json(404, { ok: false, code: 'NOT_FOUND' });
    let body: CadJobComputeRequest;
    try { body = await request.json() as CadJobComputeRequest; }
    catch { return json(400, { ok: false, code: 'INVALID_JSON' }); }
    const issues = validateCadJobComputeRequest(body);
    if (issues.length) return json(422, { ok: false, code: 'COMPUTE_REQUEST_REJECTED', issues });
    try {
      const result = await executeCadComputeRequest(body, executor, options, request.signal);
      return json(200, { ok: true, receipt: result });
    } catch (error) {
      return json(503, { ok: false, code: 'COMPUTE_RETRYABLE_FAILURE', error: error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000) });
    }
  };
}

export function startNodeComputeServer(handle: (request: Request) => Promise<Response>, port = Number(process.env.PORT ?? 8080)) {
  const server = http.createServer(async (request, response) => {
    const controller = new AbortController();
    const abortRequest = () => controller.abort('client_disconnected');
    request.once('aborted', abortRequest);
    response.once('close', () => {
      if (!response.writableEnded) abortRequest();
    });
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const url = `http://localhost:${port}${request.url ?? '/'}`;
      const body = ['GET', 'HEAD'].includes(request.method ?? 'GET') ? undefined : Buffer.concat(chunks);
      const result = await handle(new Request(url, {
        method: request.method,
        headers: request.headers as HeadersInit,
        body,
        signal: controller.signal,
      }));
      response.writeHead(result.status, Object.fromEntries(result.headers.entries()));
      response.end(Buffer.from(await result.arrayBuffer()));
    } catch (error) {
      response.writeHead(500, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ ok: false, code: 'SERVER_FAILURE', error: error instanceof Error ? error.message : String(error) }));
    }
  });
  server.listen(port, '0.0.0.0');
  return server;
}
