import {
  COMPUTE_REQUEST_VERSION,
  JOB_CONTRACT_VERSION,
  validateCadJobComputeRequest,
  validateCadJobMessage,
  validateCadJobReceipt,
  type CadJobMessage,
  type CadJobReceipt,
  type CadJobTransportReceipt,
} from '../../../packages/job-contracts/src/index';

export interface QueueBinding<T = unknown> {
  send(body: T, options?: { contentType?: string; delaySeconds?: number }): Promise<unknown>;
}

export interface WorkflowBinding<T = unknown> {
  createBatch(items: Array<{ id: string; params: T }>): Promise<Array<{ id: string }>>;
  get(id: string): Promise<{ id: string; status(): Promise<unknown> }>;
}

export interface DurableObjectStubLike { fetch(request: Request): Promise<Response> }
export interface DurableObjectNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectStubLike;
}

export interface ComputeContainerNamespaceLike {
  getByName(name: string): { fetch(request: Request): Promise<Response> };
}

export interface JobOrchestratorEnv {
  CAD_JOB_QUEUE: QueueBinding<CadJobQueuePayload>;
  CAD_JOB_DLQ: QueueBinding<unknown>;
  CAD_JOB_WORKFLOW: WorkflowBinding<CadJobMessage>;
  JOB_LEDGER: DurableObjectNamespaceLike;
  JOB_INGRESS_SECRET?: string;
  CORE_API_SHARED_SECRET?: string;
  COMPUTE_SHARED_SECRET?: string;
  CORE_API_ORIGIN?: string;
  EXACT_COMPUTE_ORIGIN?: string;
  OPENSCAD_ORIGIN?: string;
  FEA_ORIGIN?: string;
  INTEROP_ORIGIN?: string;
  EXACT_COMPUTE?: ComputeContainerNamespaceLike;
  OPENSCAD_COMPUTE?: ComputeContainerNamespaceLike;
  FEA_COMPUTE?: ComputeContainerNamespaceLike;
  INTEROP_COMPUTE?: ComputeContainerNamespaceLike;
  EXACT_WORKER_IDENTITY_SHA256?: string;
  OPENSCAD_WORKER_IDENTITY_SHA256?: string;
  FEA_WORKER_IDENTITY_SHA256?: string;
  INTEROP_WORKER_IDENTITY_SHA256?: string;
  EXACT_KERNEL_IDENTITY_SHA256?: string;
  INTEROP_KERNEL_IDENTITY_SHA256?: string;
  EXACT_BUILD_ID?: string;
  OPENSCAD_BUILD_ID?: string;
  FEA_BUILD_ID?: string;
  INTEROP_BUILD_ID?: string;
  ENVIRONMENT?: string;
  BUILD_ID?: string;
}

export interface CadJobQueuePayload {
  schema: 'nexyfab.cad-job-queue.v1';
  deliveryId: string;
  messageSha256: string;
  message: CadJobMessage;
  enqueuedAt: string;
}

export interface QueueMessageLike<T> {
  id: string;
  attempts: number;
  body: T;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
}

export interface QueueBatchLike<T> { messages: readonly QueueMessageLike<T>[] }

const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const MAX_MESSAGE_BYTES = 120 * 1024;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

export async function sha256Json(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function sameSecret(expected: string | undefined, supplied: string): Promise<'OK' | 'NOT_CONFIGURED' | 'FORBIDDEN'> {
  if (!expected || expected.length < 32) return 'NOT_CONFIGURED';
  const [left, right] = await Promise.all([
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(expected)),
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(supplied)),
  ]);
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index]! ^ b[index]!;
  return difference === 0 ? 'OK' : 'FORBIDDEN';
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function transportReceipt(
  jobId: string,
  transportState: CadJobTransportReceipt['transportState'],
  extras: Pick<CadJobTransportReceipt, 'deliveryId' | 'issues'>,
): CadJobTransportReceipt {
  return {
    contractVersion: JOB_CONTRACT_VERSION,
    jobId,
    transportState,
    execution: 'NOT_RUN',
    releaseVerification: 'NOT_RUN',
    observedAt: new Date().toISOString(),
    ...(extras.deliveryId ? { deliveryId: extras.deliveryId } : {}),
    issues: extras.issues,
  };
}

export function validateQueuePayload(payload: CadJobQueuePayload): string[] {
  if (!payload || typeof payload !== 'object') return ['queue_payload_invalid'];
  const issues = validateCadJobMessage(payload.message);
  if (payload.schema !== 'nexyfab.cad-job-queue.v1') issues.push('queue_schema_invalid');
  if (!SAFE_ID.test(payload.deliveryId ?? '')) issues.push('delivery_id_invalid');
  if (!SHA256.test(payload.messageSha256 ?? '')) issues.push('message_sha256_invalid');
  if (!Number.isFinite(Date.parse(payload.enqueuedAt ?? ''))) issues.push('enqueued_at_invalid');
  return [...new Set(issues)];
}

async function ledgerRequest(
  env: JobOrchestratorEnv,
  jobId: string,
  pathname: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const stub = env.JOB_LEDGER.get(env.JOB_LEDGER.idFromName(jobId));
  return stub.fetch(new Request(`https://job-ledger${pathname}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
}

export async function handleJobOrchestratorFetch(request: Request, env: JobOrchestratorEnv): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/healthz') {
    return json(200, {
      ok: true,
      service: 'job-orchestrator',
      buildId: env.BUILD_ID ?? 'NOT_CONFIGURED',
      environment: env.ENVIRONMENT ?? 'unknown',
      deploymentState: env.BUILD_ID === 'NOT_DEPLOYED' ? 'NOT_DEPLOYED' : 'RUNNING',
    });
  }
  const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const authorization = await sameSecret(env.JOB_INGRESS_SECRET, supplied);
  if (authorization === 'NOT_CONFIGURED') return json(503, { ok: false, code: 'INGRESS_NOT_CONFIGURED' });
  if (authorization !== 'OK') return json(403, { ok: false, code: 'FORBIDDEN' });

  if (request.method === 'POST' && url.pathname === '/v1/jobs') {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_MESSAGE_BYTES) return json(413, { ok: false, code: 'MESSAGE_TOO_LARGE' });
    let message: CadJobMessage;
    try { message = JSON.parse(text) as CadJobMessage; }
    catch { return json(400, { ok: false, code: 'INVALID_JSON' }); }
    const issues = validateCadJobMessage(message);
    if (!SAFE_ID.test(message.jobId ?? '')) issues.push('workflow_job_id_invalid');
    if (issues.length) return json(422, { ok: false, code: 'JOB_CONTRACT_REJECTED', issues: [...new Set(issues)] });
    const messageSha256 = await sha256Json(message);
    const deliveryId = crypto.randomUUID();
    const registration = await ledgerRequest(env, message.jobId, '/register', {
      jobId: message.jobId, messageSha256, deliveryId, now: Date.now(),
    });
    const registrationBody = await registration.json().catch(() => ({})) as { needsEnqueue?: boolean; code?: string };
    if (!registration.ok) return json(registration.status, { ok: false, code: registrationBody.code ?? 'LEDGER_REJECTED' });
    if (registrationBody.needsEnqueue === false) {
      return json(200, { ok: true, receipt: transportReceipt(message.jobId, 'DUPLICATE_SUPPRESSED', { deliveryId, issues: [] }) });
    }
    const payload: CadJobQueuePayload = {
      schema: 'nexyfab.cad-job-queue.v1', deliveryId, messageSha256, message, enqueuedAt: new Date().toISOString(),
    };
    try {
      await env.CAD_JOB_QUEUE.send(payload, { contentType: 'json' });
    } catch {
      await ledgerRequest(env, message.jobId, '/release', { jobId: message.jobId, messageSha256, deliveryId }).catch(() => null);
      return json(503, { ok: false, code: 'QUEUE_UNAVAILABLE' });
    }
    let ledgerConfirmed = false;
    for (let attempt = 0; attempt < 3 && !ledgerConfirmed; attempt += 1) {
      try {
        const confirmation = await ledgerRequest(env, message.jobId, '/mark-enqueued', {
          jobId: message.jobId, messageSha256, deliveryId,
        });
        ledgerConfirmed = confirmation.ok;
      } catch {
        ledgerConfirmed = false;
      }
    }
    // The queue write is already durable. Never release its reservation after
    // that point or a client retry could enqueue the same payload a second time.
    // The queue consumer will advance the ledger to WORKFLOW_STARTED.
    return json(202, {
      ok: true,
      receipt: transportReceipt(message.jobId, 'QUEUE_PERSISTED', {
        deliveryId,
        issues: ledgerConfirmed ? [] : ['ledger_confirmation_pending'],
      }),
    });
  }

  const statusMatch = /^\/v1\/jobs\/([A-Za-z0-9][A-Za-z0-9._:-]{0,99})\/status$/.exec(url.pathname);
  if (request.method === 'GET' && statusMatch) {
    try {
      const instance = await env.CAD_JOB_WORKFLOW.get(statusMatch[1]!);
      return json(200, {
        ok: true,
        jobId: statusMatch[1],
        workflow: await instance.status(),
        transportExecutionClaim: 'NOT_RUN',
        note: 'Workflow state is transport/orchestration evidence; only a Core API-accepted CadJobReceipt can establish execution.',
      });
    } catch {
      return json(404, { ok: false, code: 'WORKFLOW_NOT_FOUND' });
    }
  }
  return json(404, { ok: false, code: 'NOT_FOUND' });
}

export async function handleCadJobQueue(batch: QueueBatchLike<CadJobQueuePayload>, env: JobOrchestratorEnv): Promise<void> {
  for (const queueMessage of batch.messages) {
    const issues = validateQueuePayload(queueMessage.body);
    const actualHash = issues.length ? '' : await sha256Json(queueMessage.body.message);
    if (actualHash !== queueMessage.body?.messageSha256) issues.push('message_sha256_mismatch');
    if (issues.length) {
      await env.CAD_JOB_DLQ.send({
        schema: 'nexyfab.cad-job-dead-letter.v1',
        queueMessageId: queueMessage.id,
        attempts: queueMessage.attempts,
        issues: [...new Set(issues)],
        payload: queueMessage.body,
        deadLetteredAt: new Date().toISOString(),
        execution: 'NOT_RUN',
        releaseVerification: 'NOT_RUN',
      }, { contentType: 'json' });
      queueMessage.ack();
      continue;
    }
    try {
      // createBatch is used even for one item because Cloudflare documents it
      // as idempotent for a caller-provided instance ID.
      await env.CAD_JOB_WORKFLOW.createBatch([{ id: queueMessage.body.message.jobId, params: queueMessage.body.message }]);
      let ledgerConfirmed = false;
      for (let attempt = 0; attempt < 3 && !ledgerConfirmed; attempt += 1) {
        try {
          const confirmation = await ledgerRequest(env, queueMessage.body.message.jobId, '/mark-workflow', {
            jobId: queueMessage.body.message.jobId,
            messageSha256: queueMessage.body.messageSha256,
            deliveryId: queueMessage.body.deliveryId,
          });
          ledgerConfirmed = confirmation.ok;
        } catch {
          ledgerConfirmed = false;
        }
      }
      // Workflow creation is already durable and idempotent by job ID. Ack the
      // queue message even when the auxiliary ledger is temporarily unavailable
      // so retries cannot amplify one job into repeated queue traffic.
      queueMessage.ack();
    } catch {
      queueMessage.retry({ delaySeconds: Math.min(900, 30 * (2 ** Math.max(0, queueMessage.attempts - 1))) });
    }
  }
}

export interface WorkflowStepLike {
  do<T>(name: string, config: Record<string, unknown>, callback: () => Promise<T>): Promise<T>;
}

function computeOrigin(message: CadJobMessage, env: JobOrchestratorEnv): string | undefined {
  if (message.kind === 'EXACT_CLASH' || message.kind === 'EXACT_BREP_BUILD') return env.EXACT_COMPUTE_ORIGIN;
  if (message.kind === 'OPENSCAD_RENDER') return env.OPENSCAD_ORIGIN;
  if (message.kind === 'FEA_SOLVE') return env.FEA_ORIGIN;
  return env.INTEROP_ORIGIN;
}

function computeContainer(message: CadJobMessage, env: JobOrchestratorEnv): ComputeContainerNamespaceLike | undefined {
  if (message.kind === 'EXACT_CLASH' || message.kind === 'EXACT_BREP_BUILD') return env.EXACT_COMPUTE;
  if (message.kind === 'OPENSCAD_RENDER') return env.OPENSCAD_COMPUTE;
  if (message.kind === 'FEA_SOLVE') return env.FEA_COMPUTE;
  return env.INTEROP_COMPUTE;
}

function computeShard(jobId: string): string {
  let hash = 2166136261;
  for (const char of jobId) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `compute-${(hash >>> 0) % 8}`;
}

async function postJson(url: string, secret: string, body: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(`upstream_${response.status}`);
  return result;
}

async function postContainer(
  namespace: ComputeContainerNamespaceLike,
  jobId: string,
  secret: string,
  body: unknown,
): Promise<Record<string, unknown>> {
  const response = await namespace.getByName(computeShard(jobId)).fetch(new Request('https://compute.internal/v1/jobs', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
    body: JSON.stringify(body),
  }));
  const parsed = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(`compute_http_${response.status}:${String(parsed.code ?? 'unknown')}`);
  return parsed;
}

export async function runCadJobWorkflow(
  message: CadJobMessage,
  env: JobOrchestratorEnv,
  step: WorkflowStepLike,
): Promise<Record<string, unknown>> {
  const issues = validateCadJobMessage(message);
  if (issues.length) return { jobId: message.jobId, execution: 'BLOCKED', releaseVerification: 'NOT_RUN', issues };
  const coreOrigin = env.CORE_API_ORIGIN?.replace(/\/$/, '');
  const targetOrigin = computeOrigin(message, env)?.replace(/\/$/, '');
  const targetContainer = computeContainer(message, env);
  if (!coreOrigin || (!targetOrigin && !targetContainer) || !env.CORE_API_SHARED_SECRET || !env.COMPUTE_SHARED_SECRET) {
    return { jobId: message.jobId, execution: 'NOT_RUN', releaseVerification: 'NOT_RUN', issues: ['workflow_origin_or_secret_not_configured'] };
  }
  const authorization = await step.do('authorize-job', {
    retries: { limit: 5, delay: '10 seconds', backoff: 'exponential' }, timeout: '1 minute',
  }, () => postJson(`${coreOrigin}/api/internal/cad-job-orchestrator`, env.CORE_API_SHARED_SECRET!, {
    action: 'authorize', message,
  }));
  if (authorization.authorized !== true) {
    return { jobId: message.jobId, execution: 'BLOCKED', releaseVerification: 'NOT_RUN', issues: ['core_authorization_rejected'] };
  }
  const compute = await step.do('execute-cad-job', {
    retries: { limit: 3, delay: '30 seconds', backoff: 'exponential' }, timeout: '30 minutes',
  }, () => {
    const request = {
      contractVersion: COMPUTE_REQUEST_VERSION,
      message,
      authorizationToken: String(authorization.authorizationToken ?? ''),
      artifactGatewayUrl: String(authorization.artifactGatewayUrl ?? ''),
      inputArtifacts: Array.isArray(authorization.inputArtifacts) ? authorization.inputArtifacts : [],
    };
    const computeIssues = validateCadJobComputeRequest(request);
    if (computeIssues.length) throw new Error(`core_artifact_access_rejected:${computeIssues.join(',')}`);
    return targetContainer
      ? postContainer(targetContainer, message.jobId, env.COMPUTE_SHARED_SECRET!, request)
      : postJson(`${targetOrigin}/v1/jobs`, env.COMPUTE_SHARED_SECRET!, request);
  });
  const receipt = compute.receipt as CadJobReceipt | undefined;
  const receiptIssues = receipt ? validateCadJobReceipt(receipt) : ['compute_receipt_required'];
  if (!receipt || receipt.jobId !== message.jobId || receiptIssues.length) {
    throw new Error(`compute_receipt_rejected:${receiptIssues.join(',')}`);
  }
  const committed = await step.do('commit-receipt', {
    retries: { limit: 10, delay: '10 seconds', backoff: 'exponential' }, timeout: '2 minutes',
  }, () => postJson(`${coreOrigin}/api/internal/cad-job-orchestrator`, env.CORE_API_SHARED_SECRET!, {
    action: 'complete', message, receipt, authorizationToken: authorization.authorizationToken,
  }));
  if (committed.accepted !== true) throw new Error('core_receipt_commit_rejected');
  return {
    jobId: message.jobId,
    execution: receipt.execution,
    releaseVerification: 'NOT_RUN',
    receiptSha256: receipt.receiptSha256,
    coreReceiptAccepted: true,
  };
}
