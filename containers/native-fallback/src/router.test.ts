import { describe, expect, it, vi } from 'vitest';
import {
  COMPUTE_REQUEST_VERSION,
  JOB_CONTRACT_VERSION,
  type CadJobComputeRequest,
  type CadJobReceipt,
} from '../../../packages/job-contracts/src/index';
import { createNativeFallbackRouter } from './router';

const hash = (char: string) => char.repeat(64);
const secret = 's'.repeat(32);
const artifact = { artifactId: 'input-1', objectKey: 'private/input.step', contentSha256: hash('a') };
const body: CadJobComputeRequest = {
  contractVersion: COMPUTE_REQUEST_VERSION,
  message: {
    contractVersion: JOB_CONTRACT_VERSION,
    jobId: 'job-1', tenantId: 'org-1', projectId: 'project-1', kind: 'EXACT_CLASH',
    inputArtifacts: [artifact], requestedAt: new Date().toISOString(), requestedBy: 'user-1',
  },
  authorizationToken: 'job-token', artifactGatewayUrl: 'https://core.test/api/internal/cad-job-artifacts',
  inputArtifacts: [{ artifact, downloadUrl: 'https://r2.test/input', expiresAt: new Date(Date.now() + 60_000).toISOString() }],
};
const receipt: CadJobReceipt = {
  contractVersion: JOB_CONTRACT_VERSION, jobId: 'job-1', workerIdentitySha256: hash('b'), kernelIdentitySha256: hash('c'),
  inputArtifacts: [artifact], outputArtifacts: [{ artifactId: 'out-1', objectKey: 'private/output.json', contentSha256: hash('d') }],
  execution: 'PASS', startedAt: new Date().toISOString(), completedAt: new Date().toISOString(),
  receiptSha256: hash('e'), failureReasons: [],
};

const request = () => new Request('https://fallback.test/v1/jobs', {
  method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
});

describe('Railway native fallback router', () => {
  it('routes the unchanged compute contract and validates the upstream receipt', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true, receipt })));
    const handle = createNativeFallbackRouter({
      computeSharedSecret: secret, upstreamSharedSecret: 'u'.repeat(32), exactOrigin: 'https://exact.railway.test/', fetchImpl: fetchImpl as typeof fetch,
    });
    const response = await handle(request());
    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledWith('https://exact.railway.test/v1/jobs', expect.objectContaining({ method: 'POST', body: JSON.stringify(body) }));
  });

  it('keeps execution NOT_RUN when a fallback target is absent', async () => {
    const response = await createNativeFallbackRouter({ computeSharedSecret: secret, upstreamSharedSecret: 'u'.repeat(32) })(request());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: 'FALLBACK_TARGET_NOT_CONFIGURED', execution: 'NOT_RUN' });
  });

  it('rejects an upstream response that lacks a valid receipt', async () => {
    const handle = createNativeFallbackRouter({
      computeSharedSecret: secret, upstreamSharedSecret: 'u'.repeat(32), exactOrigin: 'https://exact.test',
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ ok: true }))) as typeof fetch,
    });
    const response = await handle(request());
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ code: 'FALLBACK_RECEIPT_REJECTED' });
  });
});
