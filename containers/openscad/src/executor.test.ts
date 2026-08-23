import { describe, expect, it, vi } from 'vitest';
import { JOB_CONTRACT_VERSION, type CadJobMessage } from '../../../packages/job-contracts/src/index';
import { createOpenScadExecutor, validateContainerScadSource } from './executor';

const hash = (char: string) => char.repeat(64);
const message: CadJobMessage = {
  contractVersion: JOB_CONTRACT_VERSION,
  jobId: 'job-scad', tenantId: 'org-1', projectId: 'project-1', kind: 'OPENSCAD_RENDER',
  inputArtifacts: [{ artifactId: 'scad-1', objectKey: 'private/model.scad', contentSha256: hash('a') }],
  requestedAt: new Date().toISOString(), requestedBy: 'user-1',
};

describe('OpenSCAD container executor', () => {
  it('allows deterministic primitives and trusted BOSL2 modules only', () => {
    expect(validateContainerScadSource('include <BOSL2/std.scad>\ncube([10,10,10]);')).toEqual([]);
    expect(validateContainerScadSource('import("../../secret.stl");')).toContain('external_file_access_blocked');
    expect(validateContainerScadSource('include <../../secret.scad>')).toContain('untrusted_include');
  });

  it('routes validated source to the isolated renderer and returns STL bytes', async () => {
    const stl = Buffer.alloc(84);
    const run = vi.fn(async () => stl);
    const executor = createOpenScadExecutor({ workerIdentitySha256: hash('b'), producerBuildId: 'build-scad', run });
    const outputs = await executor.execute(message, [{ ref: message.inputArtifacts[0]!, bytes: Buffer.from('cube([10,10,10]);') }], new AbortController().signal);
    expect(run).toHaveBeenCalledOnce();
    expect(outputs).toEqual([{ filename: 'model.stl', mediaType: 'model/stl', format: 'stl', bytes: stl }]);
  });
});
