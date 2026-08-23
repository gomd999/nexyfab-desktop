import { describe, expect, it } from 'vitest';
import { JOB_CONTRACT_VERSION, type CadJobMessage } from '../../../packages/job-contracts/src/index';
import { writeStepEntities, writeStepHeader } from '../../../src/lib/brep-bridge/stepWrite';
import { writeIfcText } from '../../../src/lib/brep-bridge/ifcExport';
import type { PolyMesh } from '../../../src/lib/brep-bridge/satExport';
import { ensureReplicad, exportOccurrenceAssemblySTEP } from '../../../scripts/drawing-to-3d/to-step.mjs';
import { sha256Bytes } from '../../runtime/src/computeService';
import { createIfcStepExecutor } from './executor';
import { validateCadInteropPreservationReceipt } from '../../../packages/cad-contracts/src/index';

const hash = (char: string) => char.repeat(64);
const step = Buffer.from(`${writeStepHeader({ filename: 'interop.step' })}${writeStepEntities({
  boxes: [{ name: 'interop', x0: 0, y0: 0, z0: 0, x1: 10, y1: 20, z1: 30 }],
})}END-ISO-10303-21;\n`);
const message: CadJobMessage = {
  contractVersion: JOB_CONTRACT_VERSION,
  jobId: 'job-interop', tenantId: 'org-1', projectId: 'project-1', kind: 'STEP_IFC_INTEROP',
  inputArtifacts: [{ artifactId: 'step-1', objectKey: 'private/input.step', contentSha256: sha256Bytes(step) }],
  requestedAt: new Date().toISOString(), requestedBy: 'user-1',
};

describe('IFC/STEP container executor', () => {
  it('normalizes STEP through the real OCCT kernel with shape identity', async () => {
    const executor = createIfcStepExecutor({
      workerIdentitySha256: hash('b'), kernelIdentitySha256: hash('c'), producerBuildId: 'build-interop',
    });
    const outputs = await executor.execute(message, [{ ref: message.inputArtifacts[0]!, bytes: step }], new AbortController().signal);
    expect(outputs).toHaveLength(2);
    expect(outputs[0]).toMatchObject({ filename: 'interop-normalized.step', format: 'step' });
    expect(outputs[0]!.bytes.toString('utf8')).toMatch(/^ISO-10303-21/);
    expect(outputs[0]!.shapeIdentitySha256).toMatch(/^[a-f0-9]{64}$/);
    const receipt = JSON.parse(outputs[1]!.bytes.toString('utf8')) as Record<string, unknown>;
    expect(validateCadInteropPreservationReceipt(receipt)).toEqual([]);
    expect(receipt.execution).toBe('PASS');
  });

  it('federates IFC into a hash-bound IR and reports every preservation axis truthfully', async () => {
    const mesh: PolyMesh = {
      verts: [[0, 0, 0], [20, 0, 0], [20, 30, 0], [0, 30, 0], [0, 0, 40], [20, 0, 40], [20, 30, 40], [0, 30, 40]],
      faces: [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]],
    };
    const exported = writeIfcText(mesh, { name: 'interop-ifc-proof' });
    if (!exported.ok) throw new Error(exported.error);
    const bytes = Buffer.from(exported.text);
    const ifcMessage: CadJobMessage = {
      ...message,
      jobId: 'job-ifc-interop',
      inputArtifacts: [{ artifactId: 'ifc-1', objectKey: 'private/input.ifc', contentSha256: sha256Bytes(bytes) }],
    };
    const executor = createIfcStepExecutor({
      workerIdentitySha256: hash('b'), kernelIdentitySha256: hash('c'), producerBuildId: 'build-interop',
    });
    const outputs = await executor.execute(ifcMessage, [{ ref: ifcMessage.inputArtifacts[0]!, bytes }], new AbortController().signal);
    expect(outputs.map(item => item.filename)).toEqual(['ifc-federation-ir.json', 'ifc-interop-preservation-receipt.json']);
    const ir = JSON.parse(outputs[0]!.bytes.toString('utf8')) as Record<string, unknown>;
    const receipt = JSON.parse(outputs[1]!.bytes.toString('utf8')) as { execution: string; resultContentSha256: string; axes: Array<{ axis: string; state: string }> };
    expect(ir).toMatchObject({ schema: 'nexyfab.ifc-federation-ir.v1', sourceContentSha256: sha256Bytes(bytes) });
    expect(receipt.resultContentSha256).toBe(sha256Bytes(outputs[0]!.bytes));
    expect(validateCadInteropPreservationReceipt(receipt)).toEqual([]);
    expect(receipt.axes.find(axis => axis.axis === 'topology')?.state).toBe('PASS');
    expect(receipt.execution).toBe('PASS');
  });

  it('preserves an arbitrary STEP assembly byte-for-byte instead of flattening its hierarchy', async () => {
    const rc = await ensureReplicad();
    const definitions = [
      { id: 'plate', name: 'PLATE', shape: rc.makeBaseBox(40, 20, 4) },
      { id: 'bolt', name: 'BOLT', shape: rc.makeCylinder(3, 12) },
    ];
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const translated = [1, 0, 0, 8, 0, 1, 0, 5, 0, 0, 1, 4, 0, 0, 0, 1];
    const exported = await exportOccurrenceAssemblySTEP(definitions, [
      { id: 'plate-1', definitionId: 'plate', matrix: identity },
      { id: 'bolt-1', definitionId: 'bolt', matrix: translated },
    ], { unit: 'MM', name: 'CONTAINER_ASSEMBLY' });
    const bytes = Buffer.from(exported.step);
    const assemblyMessage: CadJobMessage = {
      ...message,
      jobId: 'job-step-assembly-interop',
      inputArtifacts: [{ artifactId: 'step-assembly-1', objectKey: 'private/assembly.step', contentSha256: sha256Bytes(bytes) }],
    };
    const executor = createIfcStepExecutor({
      workerIdentitySha256: hash('b'), kernelIdentitySha256: hash('c'), producerBuildId: 'build-interop',
    });
    const outputs = await executor.execute(assemblyMessage, [{ ref: assemblyMessage.inputArtifacts[0]!, bytes }], new AbortController().signal);
    expect(outputs[0]).toMatchObject({ filename: 'interop-verified-assembly.step', format: 'step' });
    expect(outputs[0]!.bytes.equals(bytes)).toBe(true);
    const receipt = JSON.parse(outputs[1]!.bytes.toString('utf8')) as { execution: string; axes: Array<{ axis: string; state: string; method: string }> };
    expect(receipt.execution).toBe('PASS');
    expect(receipt.axes.find(axis => axis.axis === 'assembly')).toMatchObject({
      state: 'PASS', method: expect.stringContaining('byte-preserving assembly federation'),
    });
  }, 60_000);
});
