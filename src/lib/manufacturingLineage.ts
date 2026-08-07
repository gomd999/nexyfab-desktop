export const COMMERCIAL_LINEAGE_STAGES = [
  'rfq',
  'quote',
  'order',
  'production_job',
  'inspection',
  'shipment',
  'invoice',
] as const;

export type CommercialLineageStage = typeof COMMERCIAL_LINEAGE_STAGES[number];
export type ArtifactReleaseStatus = 'draft' | 'verified' | 'authorized' | 'revoked';

export interface ManufacturingArtifactRef {
  artifactId: string;
  sha256: string;
  releaseStatus: ArtifactReleaseStatus;
  authorizedAt?: string;
  authorizedBy?: string;
}

export interface CommercialLineageRef {
  id: string;
  artifactId: string;
  attachedAt: string;
}

export interface ManufacturingLineage {
  schema: 'nexyfab.manufacturing-lineage.v1';
  lineageId: string;
  userId: string;
  projectId: string;
  documentVersionId: string;
  generationRunId: string;
  verificationRunId: string;
  artifact: ManufacturingArtifactRef;
  commercial: Partial<Record<CommercialLineageStage, CommercialLineageRef>>;
  invalidationReasons: string[];
}

export interface LineageValidation {
  valid: boolean;
  releaseReady: boolean;
  errors: string[];
}

const SHA256 = /^[a-f0-9]{64}$/;
const nonEmpty = (value: string) => value.trim().length > 0;

export function createManufacturingLineage(input: Omit<ManufacturingLineage, 'schema' | 'commercial' | 'invalidationReasons'>): ManufacturingLineage {
  const lineage: ManufacturingLineage = {
    schema: 'nexyfab.manufacturing-lineage.v1',
    ...input,
    commercial: {},
    invalidationReasons: [],
  };
  const result = validateManufacturingLineage(lineage);
  if (result.errors.length) throw new Error(result.errors.join('; '));
  return lineage;
}

export function validateManufacturingLineage(lineage: ManufacturingLineage): LineageValidation {
  const errors: string[] = [];
  const ids = [lineage.lineageId, lineage.userId, lineage.projectId, lineage.documentVersionId, lineage.generationRunId, lineage.verificationRunId, lineage.artifact.artifactId];
  if (ids.some(value => !nonEmpty(value))) errors.push('LINEAGE_ID_REQUIRED');
  if (!SHA256.test(lineage.artifact.sha256)) errors.push('ARTIFACT_SHA256_INVALID');
  if (lineage.artifact.releaseStatus === 'authorized' && (!lineage.artifact.authorizedAt || !lineage.artifact.authorizedBy)) {
    errors.push('ARTIFACT_AUTHORIZATION_EVIDENCE_REQUIRED');
  }

  let priorAttached = true;
  for (const stage of COMMERCIAL_LINEAGE_STAGES) {
    const ref = lineage.commercial[stage];
    if (!ref) {
      priorAttached = false;
      continue;
    }
    if (!priorAttached) errors.push(`COMMERCIAL_STAGE_OUT_OF_ORDER:${stage}`);
    if (!nonEmpty(ref.id) || !nonEmpty(ref.attachedAt)) errors.push(`COMMERCIAL_REF_INVALID:${stage}`);
    if (ref.artifactId !== lineage.artifact.artifactId) errors.push(`ARTIFACT_MISMATCH:${stage}`);
  }

  const hasCommercialRefs = Object.keys(lineage.commercial).length > 0;
  if (hasCommercialRefs && lineage.artifact.releaseStatus !== 'authorized') errors.push('COMMERCIAL_RELEASE_REQUIRES_AUTHORIZED_ARTIFACT');
  if (hasCommercialRefs && lineage.invalidationReasons.length) errors.push('INVALIDATED_LINEAGE_HAS_COMMERCIAL_REFS');

  return {
    valid: errors.length === 0,
    releaseReady: errors.length === 0 && lineage.artifact.releaseStatus === 'authorized',
    errors,
  };
}

export function attachCommercialLineageRef(
  lineage: ManufacturingLineage,
  stage: CommercialLineageStage,
  id: string,
  attachedAt = new Date().toISOString(),
): ManufacturingLineage {
  const current = validateManufacturingLineage(lineage);
  if (!current.releaseReady) throw new Error(`LINEAGE_NOT_RELEASE_READY:${current.errors.join(',')}`);
  const stageIndex = COMMERCIAL_LINEAGE_STAGES.indexOf(stage);
  const priorStage = stageIndex > 0 ? COMMERCIAL_LINEAGE_STAGES[stageIndex - 1] : undefined;
  if (priorStage && !lineage.commercial[priorStage]) throw new Error(`COMMERCIAL_STAGE_PREREQUISITE_MISSING:${priorStage}`);
  if (!nonEmpty(id)) throw new Error('COMMERCIAL_REF_ID_REQUIRED');

  const next = structuredClone(lineage);
  next.commercial[stage] = { id, artifactId: lineage.artifact.artifactId, attachedAt };
  const result = validateManufacturingLineage(next);
  if (!result.valid) throw new Error(result.errors.join('; '));
  return next;
}

/** A geometry or document-version change invalidates every price/production promise. */
export function invalidateManufacturingLineage(
  lineage: ManufacturingLineage,
  reason: string,
  replacement: Pick<ManufacturingArtifactRef, 'artifactId' | 'sha256'>,
): ManufacturingLineage {
  if (!nonEmpty(reason)) throw new Error('INVALIDATION_REASON_REQUIRED');
  if (!nonEmpty(replacement.artifactId) || !SHA256.test(replacement.sha256)) throw new Error('REPLACEMENT_ARTIFACT_INVALID');
  return {
    ...structuredClone(lineage),
    artifact: { ...replacement, releaseStatus: 'revoked' },
    commercial: {},
    invalidationReasons: [...lineage.invalidationReasons, reason],
  };
}
