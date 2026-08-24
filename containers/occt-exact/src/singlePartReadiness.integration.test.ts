import { describe, expect, it } from 'vitest';
import { evaluatePrecisionReadiness } from '../../../capabilities/precision-cad/single-part-candidate/src/health.mjs';
import { createComputeServiceHandler } from '../../runtime/src/computeService';
import { createExactOcctExecutor } from './executor';

const hash = (char: string) => char.repeat(64);
const exactToken = 'exact-compute-auth-token-00000001';
const jobToken = 'job-ingress-auth-token-000000001';

function jobOrchestratorContract(request: Request): Response {
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/healthz') {
    return Response.json({
      ok: true,
      service: 'job-orchestrator',
      buildId: 'job-build',
      environment: 'test',
      deploymentState: 'RUNNING',
    });
  }
  if (request.method === 'POST' && url.pathname === '/v1/jobs') {
    if (request.headers.get('authorization') !== `Bearer ${jobToken}`) {
      return Response.json({ ok: false, code: 'FORBIDDEN' }, { status: 403 });
    }
    return Response.json({ ok: false, code: 'JOB_CONTRACT_REJECTED' }, { status: 422 });
  }
  return Response.json({ ok: false, code: 'NOT_FOUND' }, { status: 404 });
}

describe('single-part readiness against the actual OCCT compute handler', () => {
  it('accepts the shipping occt-exact health shape and verifies both dependency tokens', async () => {
    const exactHandler = createComputeServiceHandler(createExactOcctExecutor({
      workerIdentitySha256: hash('b'),
      kernelIdentitySha256: hash('c'),
      producerBuildId: 'occt-build',
    }), { computeSharedSecret: exactToken });
    const exactCanary = await exactHandler(new Request('https://exact.test/v1/jobs', {
      method: 'POST',
      headers: { authorization: `Bearer ${exactToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        contractVersion: 'readiness-canary.invalid',
        message: {
          contractVersion: 'readiness-canary.invalid', jobId: '', tenantId: '', projectId: '',
          kind: 'READINESS_CANARY', inputArtifacts: [], requestedAt: '', requestedBy: '',
        },
        authorizationToken: '', artifactGatewayUrl: 'invalid:', inputArtifacts: [],
      }),
    }));
    expect(exactCanary.status).toBe(422);
    expect(await exactCanary.json()).toMatchObject({ code: 'COMPUTE_REQUEST_REJECTED' });

    const fetcher = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      if (url.hostname === 'exact.test') return exactHandler(request);
      if (url.hostname === 'jobs.test') return jobOrchestratorContract(request);
      return Response.json({ ok: false, code: 'UNEXPECTED_ORIGIN' }, { status: 404 });
    };

    const result = await evaluatePrecisionReadiness({
      NODE_ENV: 'test',
      NEXYFAB_BUILD_ID: 'a'.repeat(12),
      EXACT_KERNEL_URL: 'https://exact.test',
      EXACT_KERNEL_AUTH_TOKEN: exactToken,
      JOB_CONTROL_URL: 'https://jobs.test',
      JOB_CONTROL_AUTH_TOKEN: jobToken,
      EXACT_KERNEL_IDENTITY: hash('c'),
      INTERNAL_AUTH_TOKEN: 'precision-internal-auth-token-0001',
    }, fetcher);

    expect(result).toMatchObject({
      ready: true,
      blockers: [],
      dependencies: {
        exactKernel: { state: 'PASS', authentication: 'VERIFIED' },
        jobControl: { state: 'PASS', authentication: 'VERIFIED' },
      },
    });
  });
});
