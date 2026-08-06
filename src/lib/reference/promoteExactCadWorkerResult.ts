import { createHash } from 'node:crypto';
import type { ComplexNativeExtractionResult } from './complexNativeExtraction';
import { validateExactCadWorkerResult, type ExactCadWorkerRequest, type ExactCadWorkerResult } from './exactCadWorkerContract';

export function promoteExactCadWorkerResult(request: ExactCadWorkerRequest, result: ExactCadWorkerResult): ComplexNativeExtractionResult | null {
  const validation = validateExactCadWorkerResult(request, result);
  if (!validation.releaseReady || !validation.nativeSemanticsReady) return null;
  const raw = JSON.stringify(result);
  return {
    schema: 'nexyfab.complex-native-extraction-result.v1', caseId: result.caseId, sourceHash: result.sourceHash,
    artifactHash: createHash('sha256').update(raw).digest('hex'), sourceMember: result.sourceMember,
    extractor: result.worker, units: result.units,
    definitions: result.definitions.map(item => ({ id: item.id, name: item.id, kind: item.kind, ...(item.kind === 'part' && item.geometry?.evidence === 'native-brep' ? { bodyCount: item.bodyCount, bodyCountSource: 'native_shape_solids' as const } : {}) })),
    occurrences: result.occurrences.map(item => ({ id: item.id, definitionId: item.definitionId, parentOccurrenceId: item.parentOccurrenceId, localToParent: item.localToParent, suppressed: false })),
    joints: [], jointSemanticsComplete: false,
  };
}
