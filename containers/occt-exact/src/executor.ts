import { createHash } from 'node:crypto';
import type { CadJobMessage } from '../../../packages/job-contracts/src/index';
import type { CadComputeExecutor, ComputeOutput, ResolvedComputeInput } from '../../runtime/src/computeService';
import { loadOcctNode } from '../../../src/lib/occt/nodeOcctLoader';
import { createNodeOcctBridge } from '../../../src/lib/occt/nodeOcctBridge';

const SHA256 = /^[a-f0-9]{64}$/;
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

export interface ExactOcctExecutorOptions {
  workerIdentitySha256: string;
  kernelIdentitySha256: string;
  producerBuildId: string;
}

function requireIdentity(value: string, label: string): string {
  if (!SHA256.test(value)) throw new Error(`${label}_invalid`);
  return value;
}

function stepText(input: ResolvedComputeInput): string {
  const value = input.bytes.toString('utf8');
  if (!value.startsWith('ISO-10303-21')) throw new Error(`step_input_invalid:${input.ref.artifactId}`);
  return value;
}

export function createExactOcctExecutor(options: ExactOcctExecutorOptions): CadComputeExecutor {
  return {
    serviceId: 'occt-exact',
    workerIdentitySha256: requireIdentity(options.workerIdentitySha256, 'worker_identity'),
    kernelIdentitySha256: requireIdentity(options.kernelIdentitySha256, 'kernel_identity'),
    producerBuildId: options.producerBuildId,
    supports(message) { return message.kind === 'EXACT_CLASH' || message.kind === 'EXACT_BREP_BUILD'; },
    async execute(message: CadJobMessage, inputs: ResolvedComputeInput[], signal: AbortSignal): Promise<ComputeOutput[]> {
      if (signal.aborted) throw new Error('cancelled_before_kernel_load');
      const loaded = await loadOcctNode();
      if (!loaded.ok || !loaded.oc) throw new Error(`occt_kernel_unavailable:${loaded.reason ?? 'unknown'}`);
      const bridge = createNodeOcctBridge(loaded.oc);
      const shapes = [];
      try {
        for (const input of inputs) {
          if (signal.aborted) throw new Error('cancelled_during_import');
          const imported = await bridge.importSTEP(stepText(input));
          if (!imported.ok || !imported.shape) throw new Error(`occt_step_import_failed:${input.ref.artifactId}:${imported.error ?? 'unknown'}`);
          const inspection = await bridge.inspectShapeDetailed?.(imported.shape);
          if (!inspection?.valid || inspection.solidCount < 1) throw new Error(`occt_input_not_valid_solid:${input.ref.artifactId}`);
          shapes.push({ ref: input.ref, shape: imported.shape, inspection });
        }
        if (message.kind === 'EXACT_BREP_BUILD') {
          if (shapes.length !== 1) throw new Error('exact_brep_build_requires_one_step_input');
          const source = shapes[0]!;
          const normalized = await bridge.exportSTEP(source.shape);
          const shapeIdentitySha256 = hash(JSON.stringify({
            kernel: options.kernelIdentitySha256,
            input: source.ref.contentSha256,
            solidCount: source.inspection.solidCount,
            faceCount: source.inspection.faceCount,
            edgeCount: source.inspection.edgeCount,
            volume: source.inspection.absoluteVolume,
            bbox: source.inspection.bbox,
          }));
          return [{ filename: 'normalized.step', mediaType: 'application/step', format: 'step', bytes: Buffer.from(normalized), shapeIdentitySha256 }];
        }
        if (shapes.length !== 2) throw new Error('exact_clash_requires_two_step_inputs');
        if (signal.aborted) throw new Error('cancelled_before_boolean_common');
        const common = await bridge.boolean.intersect(shapes[0]!.shape, shapes[1]!.shape, {
          baseId: shapes[0]!.ref.artifactId,
          toolId: shapes[1]!.ref.artifactId,
          opId: message.jobId,
        });
        if (!common.ok || !common.shape) throw new Error(`occt_common_failed:${common.error ?? 'unknown'}`);
        const inspection = await bridge.inspectShapeDetailed?.(common.shape);
        if (!inspection) throw new Error('occt_common_inspection_unavailable');
        const clash = inspection.valid && inspection.solidCount > 0 && inspection.absoluteVolume > 1e-9;
        const resultCore = {
          schema: 'nexyfab.exact-clash-result.v1',
          jobId: message.jobId,
          kernelIdentitySha256: options.kernelIdentitySha256,
          inputs: shapes.map(item => ({ artifactId: item.ref.artifactId, contentSha256: item.ref.contentSha256 })),
          result: {
            exact: true,
            clash,
            commonVolumeMm3: inspection.absoluteVolume,
            commonSolidCount: inspection.solidCount,
            commonFaceCount: inspection.faceCount,
            commonEdgeCount: inspection.edgeCount,
            commonBoundsMm: inspection.bbox,
          },
        };
        const shapeIdentitySha256 = hash(JSON.stringify(resultCore));
        return [{
          filename: 'exact-clash.json',
          mediaType: 'application/json',
          format: 'json',
          bytes: Buffer.from(`${JSON.stringify({ ...resultCore, shapeIdentitySha256 }, null, 2)}\n`),
          shapeIdentitySha256,
        }];
      } finally {
        for (const item of shapes) bridge.release(item.shape);
      }
    },
  };
}
