export const ARTIFACT_CONTRACT_VERSION = 'nexyfab.artifact.v1' as const;

export type ArtifactImmutabilityState = 'IMMUTABLE' | 'QUARANTINED' | 'DELETED';

export interface CadArtifact {
  contractVersion: typeof ARTIFACT_CONTRACT_VERSION;
  artifactId: string;
  projectId: string;
  tenantId: string;
  objectKey: string;
  mediaType: string;
  format: string;
  byteLength: number;
  contentSha256: string;
  shapeIdentitySha256?: string;
  producerBuildId: string;
  kernelIdentity: string | 'NOT_APPLICABLE';
  createdAt: string;
  immutabilityState: ArtifactImmutabilityState;
}

const SHA256 = /^[a-f0-9]{64}$/;

export function validateCadArtifact(artifact: CadArtifact): string[] {
  const issues: string[] = [];
  if (artifact.contractVersion !== ARTIFACT_CONTRACT_VERSION) issues.push('artifact_contract_version_mismatch');
  if (!artifact.artifactId.trim()) issues.push('artifact_id_required');
  if (!artifact.projectId.trim()) issues.push('project_id_required');
  if (!artifact.tenantId.trim()) issues.push('tenant_id_required');
  if (!artifact.objectKey.trim() || artifact.objectKey.startsWith('/') || artifact.objectKey.includes('..')) issues.push('invalid_object_key');
  if (!Number.isSafeInteger(artifact.byteLength) || artifact.byteLength < 0) issues.push('invalid_byte_length');
  if (!SHA256.test(artifact.contentSha256)) issues.push('invalid_content_sha256');
  if (artifact.shapeIdentitySha256 !== undefined && !SHA256.test(artifact.shapeIdentitySha256)) issues.push('invalid_shape_identity_sha256');
  if (Number.isNaN(Date.parse(artifact.createdAt))) issues.push('invalid_created_at');
  return issues;
}
