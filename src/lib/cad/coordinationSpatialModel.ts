import type { SpatialCadParameters } from './spatialCadCommand';

export const COORDINATION_DOCUMENT_SCHEMA = 'nexyfab.coordination.v1' as const;

export interface CoordinationModelReference {
  id: string;
  discipline: 'architecture' | 'structure' | 'mep' | 'civil' | 'landscape' | 'interior';
  revision: string;
  coordinateSystem: string;
  offsetMm: [number, number, number];
  boundsMm: { min: [number, number, number]; max: [number, number, number] };
  geometryEvidence: 'concept_bounds' | 'exact_brep';
  exactGeometry?: { artifactId: string; contentHash: string; shapeIdentityHash: string };
}

export interface CoordinationDocument {
  schema: typeof COORDINATION_DOCUMENT_SCHEMA;
  revision: number;
  activeCoordinateSystem: string;
  toleranceMm: number;
  models: CoordinationModelReference[];
}

export interface CoordinationClashCandidate {
  id: string;
  modelA: string;
  modelB: string;
  overlapMm: [number, number, number];
  severity: 'hard' | 'clearance';
  verification: 'PREVIEW';
}

export interface CoordinationCheckResult {
  state: 'PREVIEW' | 'BLOCKED';
  candidates: CoordinationClashCandidate[];
  issues: string[];
  exactClashVerification: 'NOT_RUN';
  releaseVerification: 'NOT_RUN';
}

export interface ExactClashJobRequest {
  schema: 'nexyfab.exact-clash-job-request.v1';
  coordinateSystem: string;
  toleranceMm: number;
  documentRevision: number;
  models: Array<{ id: string; artifactId: string; contentHash: string; shapeIdentityHash: string; offsetMm: [number, number, number] }>;
}

export type ExactClashJobPreparation =
  | { state: 'READY'; request: ExactClashJobRequest; issues: [] }
  | { state: 'BLOCKED'; request: null; issues: string[] };

const finite = (value: number) => Number.isFinite(value);

export function validateCoordinationDocument(document: CoordinationDocument): string[] {
  const issues: string[] = [];
  if (document.schema !== COORDINATION_DOCUMENT_SCHEMA) issues.push('invalid_coordination_schema');
  if (!Number.isSafeInteger(document.revision) || document.revision < 0) issues.push('invalid_coordination_revision');
  if (!document.activeCoordinateSystem.trim() || document.activeCoordinateSystem === 'CRS_NOT_CONNECTED') issues.push('coordinate_system_not_connected');
  if (!finite(document.toleranceMm) || document.toleranceMm < 0 || document.toleranceMm > 100_000) issues.push('invalid_coordination_tolerance');
  if (document.models.length < 2 || document.models.length > 100) issues.push('coordination_requires_2_to_100_models');
  const ids = new Set<string>();
  for (const model of document.models) {
    if (!model.id.trim() || ids.has(model.id)) issues.push(`duplicate_or_empty_model:${model.id || '(empty)'}`);
    ids.add(model.id);
    if (model.coordinateSystem !== document.activeCoordinateSystem) issues.push(`coordinate_mismatch:${model.id}`);
    if (![...model.offsetMm, ...model.boundsMm.min, ...model.boundsMm.max].every(finite)) issues.push(`invalid_model_bounds:${model.id}`);
    if (model.boundsMm.min.some((value, axis) => value >= model.boundsMm.max[axis]!)) issues.push(`empty_model_bounds:${model.id}`);
  }
  return [...new Set(issues)];
}

export function checkCoordinationCandidates(document: CoordinationDocument): CoordinationCheckResult {
  const issues = validateCoordinationDocument(document);
  if (issues.length) return { state: 'BLOCKED', candidates: [], issues, exactClashVerification: 'NOT_RUN', releaseVerification: 'NOT_RUN' };
  const candidates: CoordinationClashCandidate[] = [];
  for (let left = 0; left < document.models.length; left += 1) {
    const a = document.models[left]!;
    for (let right = left + 1; right < document.models.length; right += 1) {
      const b = document.models[right]!;
      const overlap = ([0, 1, 2] as const).map(axis => (
        Math.min(a.boundsMm.max[axis] + a.offsetMm[axis], b.boundsMm.max[axis] + b.offsetMm[axis])
        - Math.max(a.boundsMm.min[axis] + a.offsetMm[axis], b.boundsMm.min[axis] + b.offsetMm[axis])
      )) as [number, number, number];
      if (overlap.every(value => value > -document.toleranceMm)) {
        candidates.push({
          id: `candidate:${a.id}:${b.id}`,
          modelA: a.id,
          modelB: b.id,
          overlapMm: overlap.map(value => Math.max(0, Math.round(value))) as [number, number, number],
          severity: overlap.every(value => value > 0) ? 'hard' : 'clearance',
          verification: 'PREVIEW',
        });
      }
    }
  }
  return { state: 'PREVIEW', candidates, issues: [], exactClashVerification: 'NOT_RUN', releaseVerification: 'NOT_RUN' };
}

export function coordinationParameters(document: CoordinationDocument): SpatialCadParameters {
  return {
    activeCoordinateSystem: document.activeCoordinateSystem,
    toleranceMm: document.toleranceMm,
    modelOffsets: Object.fromEntries(document.models.map(model => [model.id, model.offsetMm])),
    modelExactGeometry: Object.fromEntries(document.models.map(model => [model.id, model.exactGeometry ? {
      artifactId: model.exactGeometry.artifactId,
      contentHash: model.exactGeometry.contentHash,
      shapeIdentityHash: model.exactGeometry.shapeIdentityHash,
      revision: model.revision,
    } : null])),
  };
}

const SHA256 = /^[a-f0-9]{64}$/;

export function prepareExactClashJob(document: CoordinationDocument): ExactClashJobPreparation {
  const issues = validateCoordinationDocument(document);
  for (const model of document.models) {
    if (model.geometryEvidence !== 'exact_brep') issues.push(`exact_brep_required:${model.id}`);
    if (!model.exactGeometry?.artifactId.trim()) issues.push(`exact_artifact_required:${model.id}`);
    if (!SHA256.test(model.exactGeometry?.contentHash ?? '')) issues.push(`exact_content_hash_required:${model.id}`);
    if (!SHA256.test(model.exactGeometry?.shapeIdentityHash ?? '')) issues.push(`exact_shape_identity_required:${model.id}`);
  }
  if (issues.length) return { state: 'BLOCKED', request: null, issues: [...new Set(issues)] };
  return {
    state: 'READY',
    request: {
      schema: 'nexyfab.exact-clash-job-request.v1',
      coordinateSystem: document.activeCoordinateSystem,
      toleranceMm: document.toleranceMm,
      documentRevision: document.revision,
      models: document.models.map(model => ({ id: model.id, artifactId: model.exactGeometry!.artifactId, contentHash: model.exactGeometry!.contentHash, shapeIdentityHash: model.exactGeometry!.shapeIdentityHash, offsetMm: [...model.offsetMm] })),
    },
    issues: [],
  };
}
