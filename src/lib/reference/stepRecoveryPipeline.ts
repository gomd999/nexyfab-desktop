import type { OcctOperationResult, OcctShape } from '@/lib/occt/types';
import { classifyCadImportFailure, type CadFailureDisposition } from './cadFailureTaxonomy';
import { normalizeStepHeaderAuthorisation, type StepHeaderRepair } from './stepHeaderNormalizer';

export interface StepRecoveryAttempt {
  stage: 'original' | 'header-normalize';
  status: 'pass' | 'fail' | 'not_applicable';
  failure?: CadFailureDisposition;
}

export interface StepRecoveryResult {
  imported: OcctOperationResult;
  shape?: OcctShape;
  repair?: StepHeaderRepair;
  attempts: StepRecoveryAttempt[];
}

/** Bounded fail-closed recovery. It never edits the source and never invents geometry. */
export async function importStepWithRecovery(
  source: string,
  importStep: (candidate: string) => Promise<OcctOperationResult>,
  release: (shape: OcctShape) => void,
): Promise<StepRecoveryResult> {
  let imported = await importStep(source);
  let shape = imported.shape;
  const attempts: StepRecoveryAttempt[] = [{
    stage: 'original', status: imported.ok && shape ? 'pass' : 'fail',
    ...(!imported.ok || !shape ? { failure: classifyCadImportFailure(imported.error) } : {}),
  }];
  if (imported.ok && shape) return { imported, shape, attempts };
  if (shape) { release(shape); shape = undefined; }

  const normalized = normalizeStepHeaderAuthorisation(source);
  if (!normalized.ok) {
    attempts.push({ stage: 'header-normalize', status: 'not_applicable' });
    return { imported, attempts };
  }
  imported = await importStep(normalized.source);
  shape = imported.shape;
  attempts.push({
    stage: 'header-normalize', status: imported.ok && shape ? 'pass' : 'fail',
    ...(!imported.ok || !shape ? { failure: classifyCadImportFailure(imported.error) } : {}),
  });
  if (!imported.ok || !shape) {
    if (shape) release(shape);
    return { imported, repair: normalized.repair, attempts };
  }
  return { imported, shape, repair: normalized.repair, attempts };
}
