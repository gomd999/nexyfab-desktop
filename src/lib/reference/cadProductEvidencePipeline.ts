import path from 'node:path';

export type CadEvidenceRunStatus = 'pass' | 'not_run' | 'fail';
export interface CadProductEvidenceStage { id: 'bundle' | 'mesh' | 'native' | 'fusion'; status: CadEvidenceRunStatus; report: string; summary: Record<string, unknown>; }
export interface CadProductEvidenceSummary {
  schema: 'nexyfab.cad-product-evidence-run.v1'; generatorVersion: '1.0.0'; caseId: string; lineageId: string;
  sourceBytesCopied: false; absolutePathsStored: false; stages: CadProductEvidenceStage[]; status: CadEvidenceRunStatus;
}

const severity: Record<CadEvidenceRunStatus, number> = { pass: 0, not_run: 1, fail: 2 };
export function aggregateCadEvidenceStatus(statuses: readonly CadEvidenceRunStatus[]): CadEvidenceRunStatus {
  return statuses.reduce<CadEvidenceRunStatus>((worst, status) => severity[status] > severity[worst] ? status : worst, 'pass');
}
export function safeEvidenceCaseId(value: string): string {
  const safe = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!safe || safe === '.' || safe === '..') throw new Error('invalid_evidence_case_id');
  return safe;
}
export function resolveEvidenceOutput(root: string, caseId: string): string {
  const resolvedRoot = path.resolve(root), output = path.resolve(resolvedRoot, safeEvidenceCaseId(caseId));
  if (!output.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error('evidence_output_path_escape');
  return output;
}
export function buildCadProductEvidenceSummary(input: Omit<CadProductEvidenceSummary, 'schema' | 'generatorVersion' | 'sourceBytesCopied' | 'absolutePathsStored' | 'status'>): CadProductEvidenceSummary {
  return { schema: 'nexyfab.cad-product-evidence-run.v1', generatorVersion: '1.0.0', caseId: safeEvidenceCaseId(input.caseId), lineageId: input.lineageId, sourceBytesCopied: false, absolutePathsStored: false, stages: input.stages, status: aggregateCadEvidenceStatus(input.stages.map(stage => stage.status)) };
}
