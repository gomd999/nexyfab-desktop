import { describe, expect, it } from 'vitest';
import { JOB_CONTRACT_VERSION, type CadJobMessage } from '../../../packages/job-contracts/src/index';
import { writeStepEntities, writeStepHeader } from '../../../src/lib/brep-bridge/stepWrite';
import { createExactOcctExecutor } from './executor';
import { sha256Bytes } from '../../runtime/src/computeService';

const hash = (char: string) => char.repeat(64);

function boxStep(name: string, x0: number, x1: number): Buffer {
  return Buffer.from(`${writeStepHeader({ filename: `${name}.step` })}${writeStepEntities({
    boxes: [{ name, x0, y0: 0, z0: 0, x1, y1: 10, z1: 10 }],
  })}END-ISO-10303-21;\n`);
}

function message(kind: CadJobMessage['kind'], inputs: Array<{ artifactId: string; bytes: Buffer }>): CadJobMessage {
  return {
    contractVersion: JOB_CONTRACT_VERSION,
    jobId: `job-${kind.toLowerCase()}`,
    tenantId: 'org-1', projectId: 'project-1', kind,
    inputArtifacts: inputs.map(item => ({
      artifactId: item.artifactId, objectKey: `private/${item.artifactId}.step`, contentSha256: sha256Bytes(item.bytes),
    })),
    requestedAt: new Date().toISOString(), requestedBy: 'user-1',
  };
}

describe('real OCCT exact compute executor', () => {
  it('computes exact common volume for two overlapping STEP solids', async () => {
    const a = boxStep('a', 0, 10);
    const b = boxStep('b', 5, 15);
    const job = message('EXACT_CLASH', [{ artifactId: 'a', bytes: a }, { artifactId: 'b', bytes: b }]);
    const executor = createExactOcctExecutor({
      workerIdentitySha256: hash('b'), kernelIdentitySha256: hash('c'), producerBuildId: 'occt-test',
    });
    const outputs = await executor.execute(job, job.inputArtifacts.map((ref, index) => ({
      ref, bytes: index === 0 ? a : b,
    })), new AbortController().signal);
    const report = JSON.parse(outputs[0]!.bytes.toString('utf8')) as {
      result: { exact: boolean; clash: boolean; commonVolumeMm3: number; commonSolidCount: number };
      shapeIdentitySha256: string;
    };
    expect(report.result).toMatchObject({ exact: true, clash: true, commonSolidCount: 1 });
    expect(report.result.commonVolumeMm3).toBeCloseTo(500, 5);
    expect(report.shapeIdentitySha256).toMatch(/^[a-f0-9]{64}$/);
    expect(outputs[0]!.shapeIdentitySha256).toBe(report.shapeIdentitySha256);
  });

  it('round-trips one STEP solid into a normalized exact B-rep artifact', async () => {
    const source = boxStep('source', 0, 10);
    const job = message('EXACT_BREP_BUILD', [{ artifactId: 'source', bytes: source }]);
    const executor = createExactOcctExecutor({
      workerIdentitySha256: hash('b'), kernelIdentitySha256: hash('c'), producerBuildId: 'occt-test',
    });
    const outputs = await executor.execute(job, [{ ref: job.inputArtifacts[0]!, bytes: source }], new AbortController().signal);
    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toMatchObject({ filename: 'normalized.step', mediaType: 'application/step', format: 'step' });
    expect(outputs[0]!.bytes.toString('utf8')).toMatch(/^ISO-10303-21/);
    expect(outputs[0]!.shapeIdentitySha256).toMatch(/^[a-f0-9]{64}$/);
  });
});
