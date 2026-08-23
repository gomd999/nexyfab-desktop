import { createHash } from 'node:crypto';
import type { CadComputeExecutor, ResolvedComputeInput } from '../../runtime/src/computeService';
import { ifcToNexyfabAssembly } from '../../../src/lib/brep-bridge/ifcImport';
import { loadOcctNode } from '../../../src/lib/occt/nodeOcctLoader';
import { createNodeOcctBridge } from '../../../src/lib/occt/nodeOcctBridge';
import { probeStepStructure } from '../../../src/lib/brep-bridge/stepStructureProbe';
import { buildIfcPreservationArtifacts, buildStepPreservationReceipt } from './preservation';

const SHA256 = /^[a-f0-9]{64}$/;
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

export function createIfcStepExecutor(options: {
  workerIdentitySha256: string; kernelIdentitySha256: string; producerBuildId: string;
}): CadComputeExecutor {
  if (!SHA256.test(options.workerIdentitySha256) || !SHA256.test(options.kernelIdentitySha256)) throw new Error('executor_identity_invalid');
  return {
    serviceId: 'ifc-step', workerIdentitySha256: options.workerIdentitySha256,
    kernelIdentitySha256: options.kernelIdentitySha256, producerBuildId: options.producerBuildId,
    supports: message => message.kind === 'STEP_IFC_INTEROP',
    async execute(_message, inputs: ResolvedComputeInput[], signal) {
      if (inputs.length !== 1) throw new Error('ifc_step_requires_one_input');
      const input = inputs[0]!;
      const extension = input.ref.objectKey.split('.').pop()?.toLowerCase();
      if (extension === 'step' || extension === 'stp') {
        const sourceText = input.bytes.toString('utf8');
        const sourceStructure = probeStepStructure(new TextEncoder().encode(sourceText).buffer as ArrayBuffer);
        const loaded = await loadOcctNode();
        if (!loaded.ok || !loaded.oc) throw new Error(`occt_kernel_unavailable:${loaded.reason ?? 'unknown'}`);
        const bridge = createNodeOcctBridge(loaded.oc);
        const imported = await bridge.importSTEP(sourceText);
        if (!imported.ok || !imported.shape) throw new Error(`step_import_failed:${imported.error ?? 'unknown'}`);
        try {
          if (signal.aborted) throw new Error('interop_cancelled');
          const inspection = await bridge.inspectShapeDetailed?.(imported.shape);
          if (!inspection?.valid || inspection.solidCount < 1) throw new Error('step_exact_solid_invalid');
          const mode = sourceStructure.isAssembly ? 'VERIFIED_BYTE_PRESERVING_ASSEMBLY' as const : 'OCCT_REEXPORT' as const;
          const normalized = sourceStructure.isAssembly ? sourceText : await bridge.exportSTEP(imported.shape);
          const normalizedBytes = Buffer.from(normalized);
          const reimported = await bridge.importSTEP(normalized);
          if (!reimported.ok || !reimported.shape) throw new Error(`step_roundtrip_reimport_failed:${reimported.error ?? 'unknown'}`);
          try {
            const resultInspection = await bridge.inspectShapeDetailed?.(reimported.shape);
            if (!resultInspection?.valid || resultInspection.solidCount < 1) throw new Error('step_roundtrip_exact_solid_invalid');
            const shapeIdentitySha256 = hash(JSON.stringify({
              kernel: options.kernelIdentitySha256, input: input.ref.contentSha256,
              solids: inspection.solidCount, faces: inspection.faceCount, edges: inspection.edgeCount,
              volume: inspection.absoluteVolume, bbox: inspection.bbox,
            }));
            const receipt = buildStepPreservationReceipt({
              source: sourceText, result: normalized,
              sourceContentSha256: input.ref.contentSha256, resultContentSha256: hash(normalizedBytes),
              sourceInspection: inspection, resultInspection, mode,
            });
            return [
              { filename: sourceStructure.isAssembly ? 'interop-verified-assembly.step' : 'interop-normalized.step', mediaType: 'application/step', format: 'step', bytes: normalizedBytes, shapeIdentitySha256 },
              { filename: 'interop-preservation-receipt.json', mediaType: 'application/json', format: 'json', bytes: Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`) },
            ];
          } finally { bridge.release(reimported.shape); }
        } finally { bridge.release(imported.shape); }
      }
      if (extension === 'ifc') {
        const result = ifcToNexyfabAssembly(input.bytes.toString('utf8'));
        if (!result.ok || !result.assembly || !result.stats) throw new Error(`ifc_import_failed:${result.error ?? 'unknown'}`);
        const artifacts = buildIfcPreservationArtifacts({
          source: input.bytes.toString('utf8'), sourceContentSha256: input.ref.contentSha256, imported: result,
        });
        return [
          { filename: 'ifc-federation-ir.json', mediaType: 'application/json', format: 'json', bytes: artifacts.irBytes },
          { filename: 'ifc-interop-preservation-receipt.json', mediaType: 'application/json', format: 'json', bytes: Buffer.from(`${JSON.stringify(artifacts.receipt, null, 2)}\n`) },
        ];
      }
      throw new Error(`ifc_step_extension_unsupported:${extension ?? 'none'}`);
    },
  };
}
