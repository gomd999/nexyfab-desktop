import { describe, expect, it, vi } from 'vitest';
import {
  COMPUTE_REQUEST_VERSION,
  JOB_CONTRACT_VERSION,
  type CadJobComputeRequest,
} from '../../../packages/job-contracts/src/index';
import {
  createComputeServiceHandler,
  executeCadComputeRequest,
  sha256Bytes,
  type CadComputeExecutor,
} from './computeService';

const hash = (char: string) => char.repeat(64);
const input = Buffer.from('immutable-step-input');
const inputHash = sha256Bytes(input);
const output = Buffer.from('verified-output');
const outputHash = sha256Bytes(output);

function computeRequest(contentSha256 = inputHash): CadJobComputeRequest {
  const artifact = { artifactId: 'input-1', objectKey: 'private/input.step', contentSha256 };
  return {
    contractVersion: COMPUTE_REQUEST_VERSION,
    message: {
      contractVersion: JOB_CONTRACT_VERSION,
      jobId: 'job-1', tenantId: 'org-1', projectId: 'project-1', kind: 'EXACT_BREP_BUILD',
      inputArtifacts: [artifact], requestedAt: new Date().toISOString(), requestedBy: 'user-1',
    },
    authorizationToken: 'job-capability',
    artifactGatewayUrl: 'https://core.test/api/internal/cad-job-artifacts',
    inputArtifacts: [{ artifact, downloadUrl: 'https://r2.test/input.step?signature=opaque', expiresAt: new Date(Date.now() + 60_000).toISOString() }],
  };
}

function executor(overrides: Partial<CadComputeExecutor> = {}): CadComputeExecutor {
  return {
    serviceId: 'test-exact', workerIdentitySha256: hash('b'), kernelIdentitySha256: hash('c'), producerBuildId: 'build-test',
    supports: () => true,
    execute: vi.fn(async () => [{ filename: 'out.step', mediaType: 'application/step', format: 'step', bytes: output, shapeIdentitySha256: hash('d') }]),
    ...overrides,
  };
}

function successfulFetch() {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const target = String(url);
    if (target.startsWith('https://r2.test/input.step')) return new Response(input);
    if (target === 'https://r2.test/output' && init?.method === 'PUT') return new Response(null, { status: 200 });
    if (target === 'https://core.test/api/internal/cad-job-artifacts') {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (body.action === 'output-intent') return new Response(JSON.stringify({
        ok: true,
        grant: {
          artifact: { artifactId: 'out-1', objectKey: 'private/output.step', contentSha256: outputHash },
          uploadMode: 'DIRECT_PUT', uploadUrl: 'https://r2.test/output',
          expiresAt: new Date(Date.now() + 60_000).toISOString(), requiredContentType: 'application/step',
        },
      }));
      if (body.action === 'commit-output') return new Response(JSON.stringify({
        ok: true, committed: true,
        artifact: { artifactId: 'out-1', objectKey: 'private/output.step', contentSha256: outputHash },
      }));
    }
    return new Response(null, { status: 404 });
  });
}

describe('container compute service', () => {
  it('resolves hash-bound input, uploads output, and emits a valid PASS receipt', async () => {
    const fetchImpl = successfulFetch();
    const result = await executeCadComputeRequest(computeRequest(), executor(), {
      computeSharedSecret: 's'.repeat(32), fetchImpl: fetchImpl as typeof fetch,
    });
    expect(result).toMatchObject({ execution: 'PASS', workerIdentitySha256: hash('b'), kernelIdentitySha256: hash('c') });
    expect(result.outputArtifacts).toEqual([{ artifactId: 'out-1', objectKey: 'private/output.step', contentSha256: outputHash }]);
    expect(result.receiptSha256).toMatch(/^[a-f0-9]{64}$/);
    const inputCall = fetchImpl.mock.calls.find(call => String(call[0]).startsWith('https://r2.test/input.step'));
    expect(inputCall?.[1]?.headers).toBeUndefined();
  });

  it('fails closed before execution when downloaded bytes do not match the immutable reference', async () => {
    const run = executor();
    await expect(executeCadComputeRequest(computeRequest(hash('a')), run, {
      computeSharedSecret: 's'.repeat(32), fetchImpl: successfulFetch() as typeof fetch,
    })).rejects.toThrow('input_content_hash_mismatch');
    expect(run.execute).not.toHaveBeenCalled();
  });

  it('records timeout as FAIL and never promotes it to PASS', async () => {
    const run = executor({
      execute: vi.fn(async (_message, _inputs, signal): Promise<never> => new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      })),
    });
    const result = await executeCadComputeRequest(computeRequest(), run, {
      computeSharedSecret: 's'.repeat(32), fetchImpl: successfulFetch() as typeof fetch, timeoutMs: 1_000,
    });
    expect(result.execution).toBe('FAIL');
    expect(result.outputArtifacts).toEqual([]);
    expect(result.failureReasons[0]).toContain('execution_aborted:execution_timeout');
  });

  it('propagates an explicit request cancellation and never publishes output', async () => {
    const run = executor({
      execute: vi.fn(async (_message, _inputs, signal): Promise<never> => new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
      })),
    });
    const caller = new AbortController();
    const pending = executeCadComputeRequest(computeRequest(), run, {
      computeSharedSecret: 's'.repeat(32), fetchImpl: successfulFetch() as typeof fetch,
    }, caller.signal);
    await vi.waitFor(() => expect(run.execute).toHaveBeenCalledOnce());
    caller.abort('user_cancelled');
    const result = await pending;
    expect(result.execution).toBe('FAIL');
    expect(result.outputArtifacts).toEqual([]);
    expect(result.failureReasons[0]).toContain('execution_aborted:user_cancelled');
  });

  it('recovers idempotently when Core reports an already committed output', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).startsWith('https://r2.test/input.step')) return new Response(input);
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (body.action === 'output-intent') return new Response(JSON.stringify({
        ok: true, committed: true,
        artifact: { artifactId: 'out-1', objectKey: 'private/output.step', contentSha256: outputHash },
      }));
      return new Response(null, { status: 500 });
    });
    const result = await executeCadComputeRequest(computeRequest(), executor(), {
      computeSharedSecret: 's'.repeat(32), fetchImpl: fetchImpl as typeof fetch,
    });
    expect(result.execution).toBe('PASS');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('protects the HTTP execution endpoint with the compute secret', async () => {
    const handle = createComputeServiceHandler(executor(), {
      computeSharedSecret: 's'.repeat(32), fetchImpl: successfulFetch() as typeof fetch,
    });
    const response = await handle(new Request('https://compute.test/v1/jobs', {
      method: 'POST',
      headers: { authorization: 'Bearer wrong', 'content-type': 'application/json' },
      body: JSON.stringify(computeRequest()),
    }));
    expect(response.status).toBe(403);
  });
});
