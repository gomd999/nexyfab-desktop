import type { CadNativeAssemblyEvidence } from './cadNativeAssemblyEvidence';
import { validateNativeWorkerExecutionResult, type NativeWorkerExecutionJob, type NativeWorkerExecutionResult } from './nativeWorkerExecution';

const safeRelativePath = (value: string) => {
  const normalized = value.replaceAll('\\', '/');
  return normalized.length > 0
    && !normalized.startsWith('/')
    && !/^[a-z]:/i.test(normalized)
    && !normalized.split('/').includes('..')
    ? normalized
    : null;
};

export function promoteNativeWorkerResultToAssemblyEvidence(
  job: NativeWorkerExecutionJob,
  result: NativeWorkerExecutionResult,
  lineageId: string,
): { status: 'pass' | 'fail'; evidence: CadNativeAssemblyEvidence | null; errors: string[] } {
  const validation = validateNativeWorkerExecutionResult(job, result);
  if (!validation.releaseReady) return { status: 'fail', evidence: null, errors: validation.errors };
  if (!lineageId.trim()) return { status: 'fail', evidence: null, errors: ['native_worker_lineage_missing'] };
  const relativePath = safeRelativePath(job.source.kind === 'zip-member' ? job.source.member ?? '' : job.source.locator);
  if (!relativePath) return { status: 'fail', evidence: null, errors: ['native_worker_source_path_unsafe'] };
  const evidence: CadNativeAssemblyEvidence = {
    schema: 'nexyfab.native-assembly-evidence.v1.1',
    lineageId,
    extractor: { ...result.worker, cadVersion: null },
    coordinateSystem: result.coordinateSystem,
    units: result.units,
    sources: [{ relativePath, sha256: job.source.sha256 }],
    definitions: result.definitions.map((item) => ({ id: item.id, name: item.id, sourceMember: null, kind: item.kind })),
    occurrences: result.occurrences.map((item) => ({
      id: item.id,
      definitionId: item.definitionId,
      parentOccurrenceId: item.parentOccurrenceId,
      transform: item.localToParent,
      suppressed: item.state.suppressed,
      state: item.state,
    })),
    joints: result.joints.map((item) => ({
      id: item.id,
      type: item.kind,
      parentOccurrenceId: item.occurrenceA,
      childOccurrenceId: item.occurrenceB,
      axis: item.axis,
      originMm: item.originMm,
      lowerLimit: item.lowerLimit,
      upperLimit: item.upperLimit,
      frame: item.frame,
    })),
  };
  return { status: 'pass', evidence, errors: [] };
}
