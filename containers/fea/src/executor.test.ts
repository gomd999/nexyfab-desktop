import { describe, expect, it, vi } from 'vitest';
import { JOB_CONTRACT_VERSION, type CadJobMessage } from '../../../packages/job-contracts/src/index';
import { createFeaComputeExecutor } from './executor';
import type { FeaJobRequest, FeaJobResult } from '../../../packages/fea-contracts/src/index';

const hash = (char: string) => char.repeat(64);
const message: CadJobMessage = {
  contractVersion: JOB_CONTRACT_VERSION,
  jobId: 'job-fea', tenantId: 'org-1', projectId: 'project-1', kind: 'FEA_SOLVE',
  inputArtifacts: [{ artifactId: 'fea-1', objectKey: 'private/fea-request.json', contentSha256: hash('a') }],
  requestedAt: new Date().toISOString(), requestedBy: 'user-1',
};
const request: FeaJobRequest = {
  source: { kind: 'scad', source: 'cube([10,10,10]);' }, materialKey: 'steel', loadN: 1000,
  loadNote: 'test load', precise: true, limits: { maxDof: 10_000, timeoutMs: 10_000, memoryMb: 1024 },
};
const result: FeaJobResult = {
  method: 'linear-fem-tet', grade: 'screening', maxStressMPa: 10, minStressMPa: 0,
  maxDisplacementMm: 0.1, safetyFactor: 2, elementCount: 10, dofCount: 30, converged: true,
  material: { key: 'steel', label: 'Steel', yieldMPa: 250 },
  mesh: { triangles: 12, fixedTris: 2, loadTris: 2 }, refined: null, raiser: null,
  reportHtml: '<p>screening</p>', expertApproval: null, manufacturingReady: false, completedAt: Date.now(),
};

describe('FEA container executor', () => {
  it('validates the request contract and preserves non-release result truth', async () => {
    const solve = vi.fn(async () => result);
    const executor = createFeaComputeExecutor({ workerIdentitySha256: hash('b'), producerBuildId: 'build-fea', solve });
    const outputs = await executor.execute(message, [{ ref: message.inputArtifacts[0]!, bytes: Buffer.from(JSON.stringify(request)) }], new AbortController().signal);
    const artifact = JSON.parse(outputs[0]!.bytes.toString('utf8')) as { result: FeaJobResult };
    expect(solve).toHaveBeenCalledOnce();
    expect(artifact.result).toMatchObject({ grade: 'screening', expertApproval: null, manufacturingReady: false });
  });

  it('rejects malformed requests before invoking the solver', async () => {
    const solve = vi.fn(async () => result);
    const executor = createFeaComputeExecutor({ workerIdentitySha256: hash('b'), producerBuildId: 'build-fea', solve });
    await expect(executor.execute(message, [{ ref: message.inputArtifacts[0]!, bytes: Buffer.from('{}') }], new AbortController().signal))
      .rejects.toThrow('fea_request_rejected');
    expect(solve).not.toHaveBeenCalled();
  });
});
