import { describe, expect, it, vi } from 'vitest';
import { JOB_CONTRACT_VERSION, type CadJobMessage } from './contracts';
import { dispatchCadJob } from './jobOrchestratorClient';

const message: CadJobMessage = {
  contractVersion: JOB_CONTRACT_VERSION,
  jobId: 'job-1', tenantId: 'org-1', projectId: 'project-1', kind: 'EXACT_BREP_BUILD',
  inputArtifacts: [{ artifactId: 'artifact-1', objectKey: 'private/input.step', contentSha256: 'a'.repeat(64) }],
  requestedAt: '2026-08-13T00:00:00.000Z', requestedBy: 'user-1',
};
const secret = 's'.repeat(32);

describe('Core API to Cloudflare job orchestrator client', () => {
  it('returns explicit NOT_CONFIGURED instead of pretending that a job was queued', async () => {
    await expect(dispatchCadJob(message, { origin: '', secret: '' })).resolves.toEqual({
      ok: false, code: 'ORCHESTRATOR_NOT_CONFIGURED', issues: ['orchestrator_origin_or_secret_missing'],
    });
  });

  it('accepts only a fail-closed transport receipt with NOT_RUN execution', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      receipt: {
        contractVersion: JOB_CONTRACT_VERSION, jobId: 'job-1', transportState: 'QUEUE_PERSISTED',
        execution: 'NOT_RUN', releaseVerification: 'NOT_RUN', observedAt: new Date().toISOString(), issues: [],
      },
    }), { status: 202 }));
    await expect(dispatchCadJob(message, { origin: 'https://jobs.internal', secret, fetchImpl })).resolves.toMatchObject({
      ok: true, receipt: { execution: 'NOT_RUN', releaseVerification: 'NOT_RUN' },
    });
  });

  it('rejects a transport response that illegally claims compute PASS', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      receipt: {
        contractVersion: JOB_CONTRACT_VERSION, jobId: 'job-1', transportState: 'QUEUE_PERSISTED',
        execution: 'PASS', releaseVerification: 'NOT_RUN', observedAt: new Date().toISOString(), issues: [],
      },
    }), { status: 202 }));
    await expect(dispatchCadJob(message, { origin: 'https://jobs.internal', secret, fetchImpl })).resolves.toMatchObject({
      ok: false, code: 'TRANSPORT_RECEIPT_REJECTED', issues: expect.arrayContaining(['transport_cannot_claim_execution']),
    });
  });
});
