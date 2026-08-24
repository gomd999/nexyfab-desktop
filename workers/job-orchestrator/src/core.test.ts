import { afterEach, describe, expect, it, vi } from 'vitest';
import { JOB_CONTRACT_VERSION, type CadJobMessage, type CadJobReceipt } from '../../../packages/job-contracts/src/index';
import { CadJobLedger } from './ledger';
import {
  handleCadJobQueue,
  handleJobOrchestratorFetch,
  runCadJobWorkflow,
  sha256Json,
  type CadJobQueuePayload,
  type JobOrchestratorEnv,
  type QueueMessageLike,
} from './core';

const hash = (char: string) => char.repeat(64);
const secret = 's'.repeat(32);
const message: CadJobMessage = {
  contractVersion: JOB_CONTRACT_VERSION,
  jobId: 'job-1',
  tenantId: 'org-1',
  projectId: 'project-1',
  kind: 'EXACT_CLASH',
  inputArtifacts: [{ artifactId: 'artifact-1', objectKey: 'private/artifacts/a.step', contentSha256: hash('a') }],
  requestedAt: '2026-08-13T00:00:00.000Z',
  requestedBy: 'user-1',
};

function env() {
  const durableObjects = new Map<string, CadJobLedger>();
  const queueSend = vi.fn(async (body: unknown, options?: { contentType?: string; delaySeconds?: number }) => { void body; void options; });
  const dlqSend = vi.fn(async (body: unknown, options?: { contentType?: string; delaySeconds?: number }) => { void body; void options; });
  const createBatch = vi.fn(async (items: Array<{ id: string }>) => items);
  const environment: JobOrchestratorEnv = {
    CAD_JOB_QUEUE: { send: queueSend },
    CAD_JOB_DLQ: { send: dlqSend },
    CAD_JOB_WORKFLOW: { createBatch, get: vi.fn() },
    JOB_LEDGER: {
      idFromName: name => name,
      get: id => ({
        fetch: request => {
          const key = String(id);
          let ledger = durableObjects.get(key);
          if (!ledger) {
            const values = new Map<string, unknown>();
            ledger = new CadJobLedger({ storage: {
              async get<T>(storageKey: string) { return values.get(storageKey) as T | undefined; },
              async put<T>(storageKey: string, value: T) { values.set(storageKey, structuredClone(value)); },
            } });
            durableObjects.set(key, ledger);
          }
          return ledger.fetch(request);
        },
      }),
    },
    JOB_INGRESS_SECRET: secret,
    ENVIRONMENT: 'test', BUILD_ID: 'build-test',
  };
  return { environment, queueSend, dlqSend, createBatch };
}

function ingest(body: unknown, authorization = secret) {
  return new Request('https://jobs.test/v1/jobs', {
    method: 'POST',
    headers: { authorization: `Bearer ${authorization}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('Cloudflare Queue and Workflow CAD orchestrator', () => {
  it('persists a valid queue message while keeping execution and release NOT_RUN', async () => {
    const { environment, queueSend } = env();
    const response = await handleJobOrchestratorFetch(ingest(message), environment);
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      receipt: { transportState: 'QUEUE_PERSISTED', execution: 'NOT_RUN', releaseVerification: 'NOT_RUN' },
    });
    expect(queueSend).toHaveBeenCalledTimes(1);
    expect(queueSend.mock.calls[0]?.[0]).toMatchObject({ schema: 'nexyfab.cad-job-queue.v1', message });
  });

  it('deduplicates the same job and rejects the same id with a changed artifact hash', async () => {
    const { environment, queueSend } = env();
    expect((await handleJobOrchestratorFetch(ingest(message), environment)).status).toBe(202);
    const duplicate = await handleJobOrchestratorFetch(ingest(message), environment);
    expect(duplicate.status).toBe(200);
    await expect(duplicate.json()).resolves.toMatchObject({ receipt: { transportState: 'DUPLICATE_SUPPRESSED', execution: 'NOT_RUN' } });
    const conflict = await handleJobOrchestratorFetch(ingest({
      ...message, inputArtifacts: [{ ...message.inputArtifacts[0]!, contentSha256: hash('b') }],
    }), environment);
    expect(conflict.status).toBe(409);
    expect(queueSend).toHaveBeenCalledTimes(1);
  });

  it('does not release an enqueue reservation after the durable queue write succeeds', async () => {
    const { environment, queueSend } = env();
    const originalGet = environment.JOB_LEDGER.get.bind(environment.JOB_LEDGER);
    const paths: string[] = [];
    environment.JOB_LEDGER.get = id => {
      const original = originalGet(id);
      return {
        async fetch(request: Request) {
          const pathname = new URL(request.url).pathname;
          paths.push(pathname);
          if (pathname === '/mark-enqueued') return new Response('{}', { status: 503 });
          return original.fetch(request);
        },
      };
    };

    const response = await handleJobOrchestratorFetch(ingest(message), environment);
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      receipt: { transportState: 'QUEUE_PERSISTED', issues: ['ledger_confirmation_pending'] },
    });
    expect(queueSend).toHaveBeenCalledOnce();
    expect(paths.filter(pathname => pathname === '/mark-enqueued')).toHaveLength(3);
    expect(paths).not.toContain('/release');
  });

  it('fails closed for missing ingress configuration and invalid contracts', async () => {
    const { environment } = env();
    expect((await handleJobOrchestratorFetch(ingest(message, 'wrong'), environment)).status).toBe(403);
    expect((await handleJobOrchestratorFetch(ingest({ ...message, inputArtifacts: [] }), environment)).status).toBe(422);
    environment.JOB_INGRESS_SECRET = '';
    expect((await handleJobOrchestratorFetch(ingest(message), environment)).status).toBe(503);
  });

  it('starts one idempotent Workflow and dead-letters a tampered queue payload without execution claims', async () => {
    const { environment, createBatch, dlqSend } = env();
    const payload = {
      schema: 'nexyfab.cad-job-queue.v1' as const,
      deliveryId: 'delivery-1',
      messageSha256: await sha256Json(message),
      message,
      enqueuedAt: new Date().toISOString(),
    };
    const ack = vi.fn();
    const retry = vi.fn();
    await handleCadJobQueue({ messages: [{ id: 'q-1', attempts: 1, body: payload, ack, retry }] }, environment);
    expect(createBatch).toHaveBeenCalledWith([{ id: 'job-1', params: message }]);
    expect(ack).toHaveBeenCalled();
    expect(retry).not.toHaveBeenCalled();

    const invalidAck = vi.fn();
    await handleCadJobQueue({ messages: [{
      id: 'q-2', attempts: 1, body: { ...payload, messageSha256: hash('f') }, ack: invalidAck, retry: vi.fn(),
    }] }, environment);
    expect(dlqSend).toHaveBeenCalledWith(expect.objectContaining({
      execution: 'NOT_RUN', releaseVerification: 'NOT_RUN', issues: expect.arrayContaining(['message_sha256_mismatch']),
    }), { contentType: 'json' });
    expect(invalidAck).toHaveBeenCalled();
  });

  it('retries transient Workflow binding failure with bounded exponential delay', async () => {
    const { environment } = env();
    environment.CAD_JOB_WORKFLOW.createBatch = vi.fn(async () => { throw new Error('temporary'); });
    const queueMessage = {
      id: 'q-1', attempts: 3,
      body: { schema: 'nexyfab.cad-job-queue.v1' as const, deliveryId: 'delivery-1', messageSha256: await sha256Json(message), message, enqueuedAt: new Date().toISOString() },
      ack: vi.fn(), retry: vi.fn(),
    } satisfies QueueMessageLike<CadJobQueuePayload>;
    await handleCadJobQueue({ messages: [queueMessage] }, environment);
    expect(queueMessage.retry).toHaveBeenCalledWith({ delaySeconds: 120 });
    expect(queueMessage.ack).not.toHaveBeenCalled();
  });

  it('claims PASS only after a valid compute receipt is accepted by Core API', async () => {
    const { environment } = env();
    Object.assign(environment, {
      CORE_API_ORIGIN: 'https://core.internal', EXACT_COMPUTE_ORIGIN: 'https://compute.internal',
      CORE_API_SHARED_SECRET: secret, COMPUTE_SHARED_SECRET: 'c'.repeat(32),
    });
    const receipt: CadJobReceipt = {
      contractVersion: JOB_CONTRACT_VERSION,
      jobId: message.jobId,
      workerIdentitySha256: hash('b'), kernelIdentitySha256: hash('c'),
      inputArtifacts: message.inputArtifacts,
      outputArtifacts: [{ artifactId: 'output-1', objectKey: 'private/outputs/out.step', contentSha256: hash('d') }],
      execution: 'PASS', startedAt: '2026-08-13T00:01:00.000Z', completedAt: '2026-08-13T00:02:00.000Z',
      receiptSha256: hash('e'), failureReasons: [],
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        authorized: true,
        authorizationToken: 'token',
        artifactGatewayUrl: 'https://core.internal/api/internal/cad-job-artifacts',
        inputArtifacts: [{ artifact: message.inputArtifacts[0], downloadUrl: 'https://r2.test/input', expiresAt: '2026-08-13T01:00:00.000Z' }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ receipt }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ accepted: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const step = {
      async do<T>(_name: string, _config: Record<string, unknown>, callback: () => Promise<T>): Promise<T> {
        return callback();
      },
    };
    await expect(runCadJobWorkflow(message, environment, step)).resolves.toMatchObject({
      jobId: 'job-1', execution: 'PASS', releaseVerification: 'NOT_RUN', coreReceiptAccepted: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({
      contractVersion: 'nexyfab.cad-compute-request.v1',
      message,
      authorizationToken: 'token',
      artifactGatewayUrl: 'https://core.internal/api/internal/cad-job-artifacts',
    });
  });

  it('uses the Cloudflare Container binding before an external Railway origin', async () => {
    const { environment } = env();
    const receipt: CadJobReceipt = {
      contractVersion: JOB_CONTRACT_VERSION,
      jobId: message.jobId,
      workerIdentitySha256: hash('b'), kernelIdentitySha256: hash('c'),
      inputArtifacts: message.inputArtifacts,
      outputArtifacts: [{ artifactId: 'output-1', objectKey: 'private/outputs/out.step', contentSha256: hash('d') }],
      execution: 'PASS', startedAt: '2026-08-13T00:01:00.000Z', completedAt: '2026-08-13T00:02:00.000Z',
      receiptSha256: hash('e'), failureReasons: [],
    };
    const containerFetch = vi.fn(async () => new Response(JSON.stringify({ receipt })));
    Object.assign(environment, {
      CORE_API_ORIGIN: 'https://core.internal',
      CORE_API_SHARED_SECRET: secret,
      COMPUTE_SHARED_SECRET: 'c'.repeat(32),
      EXACT_COMPUTE: { getByName: vi.fn(() => ({ fetch: containerFetch })) },
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        authorized: true,
        authorizationToken: 'token',
        artifactGatewayUrl: 'https://core.internal/api/internal/cad-job-artifacts',
        inputArtifacts: [{ artifact: message.inputArtifacts[0], downloadUrl: 'https://r2.test/input', expiresAt: '2026-08-13T01:00:00.000Z' }],
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ accepted: true })));
    vi.stubGlobal('fetch', fetchMock);
    const step = { async do<T>(_name: string, _config: Record<string, unknown>, callback: () => Promise<T>) { return callback(); } };
    await expect(runCadJobWorkflow(message, environment, step)).resolves.toMatchObject({ execution: 'PASS', coreReceiptAccepted: true });
    expect(containerFetch).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
