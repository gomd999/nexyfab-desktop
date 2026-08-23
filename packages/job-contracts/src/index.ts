export const JOB_CONTRACT_VERSION = 'nexyfab.cad-job.v1' as const;
export const COMPUTE_REQUEST_VERSION = 'nexyfab.cad-compute-request.v1' as const;

export type CadJobKind =
  | 'EXACT_BREP_BUILD'
  | 'EXACT_CLASH'
  | 'OPENSCAD_RENDER'
  | 'FEA_SOLVE'
  | 'STEP_IFC_INTEROP';

export interface CadJobArtifactRef {
  artifactId: string;
  objectKey: string;
  contentSha256: string;
}

export interface CadJobMessage {
  contractVersion: typeof JOB_CONTRACT_VERSION;
  jobId: string;
  tenantId: string;
  projectId: string;
  kind: CadJobKind;
  inputArtifacts: CadJobArtifactRef[];
  requestedAt: string;
  requestedBy: string;
}

/**
 * Short-lived, Core-issued read capability for one immutable input artifact.
 * The URL is transport data and is deliberately excluded from CadJobMessage,
 * so refreshing an expired capability never changes the immutable job hash.
 */
export interface CadJobInputArtifactAccess {
  artifact: CadJobArtifactRef;
  downloadUrl: string;
  expiresAt: string;
}

export interface CadJobComputeRequest {
  contractVersion: typeof COMPUTE_REQUEST_VERSION;
  message: CadJobMessage;
  authorizationToken: string;
  artifactGatewayUrl: string;
  inputArtifacts: CadJobInputArtifactAccess[];
}

/** Metadata is declared before upload and verified by Core against R2 bytes. */
export interface CadJobOutputArtifactIntent {
  artifactId: string;
  filename: string;
  mediaType: string;
  format: string;
  byteLength: number;
  contentSha256: string;
  shapeIdentitySha256?: string;
  producerBuildId: string;
  kernelIdentity: string | 'NOT_APPLICABLE';
}

export interface CadJobOutputUploadGrant {
  artifact: CadJobArtifactRef;
  uploadMode: 'DIRECT_PUT' | 'CORE_INLINE';
  uploadUrl: string;
  expiresAt: string;
  requiredContentType: string;
}

export interface CadJobReceipt {
  contractVersion: typeof JOB_CONTRACT_VERSION;
  jobId: string;
  workerIdentitySha256: string;
  kernelIdentitySha256: string | 'NOT_APPLICABLE';
  inputArtifacts: CadJobArtifactRef[];
  outputArtifacts: CadJobArtifactRef[];
  execution: 'PASS' | 'FAIL' | 'BLOCKED';
  startedAt: string;
  completedAt: string;
  receiptSha256: string;
  failureReasons: string[];
}

export type CadJobTransportState =
  | 'QUEUE_PERSISTED'
  | 'DUPLICATE_SUPPRESSED'
  | 'WORKFLOW_STARTED'
  | 'RETRY_SCHEDULED'
  | 'DEAD_LETTERED';

/**
 * Delivery evidence is deliberately unable to claim compute or release PASS.
 * A separate, validated CadJobReceipt is required for any execution result.
 */
export interface CadJobTransportReceipt {
  contractVersion: typeof JOB_CONTRACT_VERSION;
  jobId: string;
  transportState: CadJobTransportState;
  execution: 'NOT_RUN';
  releaseVerification: 'NOT_RUN';
  observedAt: string;
  deliveryId?: string;
  issues: string[];
}

const SHA256 = /^[a-f0-9]{64}$/;

function validateArtifactRef(ref: CadJobArtifactRef, prefix: string): string[] {
  const issues: string[] = [];
  if (!ref.artifactId.trim()) issues.push(`${prefix}_artifact_id_required`);
  if (!ref.objectKey.trim() || ref.objectKey.includes('..')) issues.push(`${prefix}_object_key_invalid`);
  if (!SHA256.test(ref.contentSha256)) issues.push(`${prefix}_content_sha256_invalid`);
  return issues;
}

function validHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(url.hostname));
  } catch { return false; }
}

export function validateCadJobComputeRequest(request: CadJobComputeRequest): string[] {
  const issues = validateCadJobMessage(request.message);
  if (request.contractVersion !== COMPUTE_REQUEST_VERSION) issues.push('compute_contract_version_mismatch');
  if (!request.authorizationToken.trim()) issues.push('authorization_token_required');
  if (!validHttpUrl(request.artifactGatewayUrl)) issues.push('artifact_gateway_url_invalid');
  if (request.inputArtifacts.length !== request.message.inputArtifacts.length) issues.push('input_access_count_mismatch');
  const expected = new Map(request.message.inputArtifacts.map(ref => [ref.artifactId, ref]));
  const seen = new Set<string>();
  for (const [index, access] of request.inputArtifacts.entries()) {
    const prefix = `input_access_${index}`;
    issues.push(...validateArtifactRef(access.artifact, prefix));
    const ref = expected.get(access.artifact.artifactId);
    if (!ref || ref.objectKey !== access.artifact.objectKey || ref.contentSha256 !== access.artifact.contentSha256) {
      issues.push(`${prefix}_identity_mismatch`);
    }
    if (seen.has(access.artifact.artifactId)) issues.push(`${prefix}_duplicate`);
    seen.add(access.artifact.artifactId);
    if (!validHttpUrl(access.downloadUrl)) issues.push(`${prefix}_download_url_invalid`);
    if (!Number.isFinite(Date.parse(access.expiresAt))) issues.push(`${prefix}_expiry_invalid`);
  }
  return [...new Set(issues)];
}

export function validateCadJobOutputArtifactIntent(intent: CadJobOutputArtifactIntent): string[] {
  const issues: string[] = [];
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(intent.artifactId)) issues.push('output_artifact_id_invalid');
  if (!intent.filename.trim() || intent.filename.length > 255 || /[\\/\0]/.test(intent.filename) || intent.filename.includes('..')) issues.push('output_filename_invalid');
  if (!intent.mediaType.trim() || !intent.format.trim()) issues.push('output_media_or_format_required');
  if (!Number.isSafeInteger(intent.byteLength) || intent.byteLength <= 0 || intent.byteLength > 500 * 1024 * 1024) issues.push('output_byte_length_invalid');
  if (!SHA256.test(intent.contentSha256)) issues.push('output_content_sha256_invalid');
  if (intent.shapeIdentitySha256 !== undefined && !SHA256.test(intent.shapeIdentitySha256)) issues.push('output_shape_identity_invalid');
  if (!intent.producerBuildId.trim()) issues.push('output_producer_build_required');
  if (intent.kernelIdentity !== 'NOT_APPLICABLE' && !SHA256.test(intent.kernelIdentity)) issues.push('output_kernel_identity_invalid');
  return issues;
}

export function validateCadJobMessage(message: CadJobMessage): string[] {
  const issues: string[] = [];
  if (message.contractVersion !== JOB_CONTRACT_VERSION) issues.push('job_contract_version_mismatch');
  if (!message.jobId.trim()) issues.push('job_id_required');
  if (!message.tenantId.trim()) issues.push('tenant_id_required');
  if (!message.projectId.trim()) issues.push('project_id_required');
  if (!Number.isFinite(Date.parse(message.requestedAt))) issues.push('requested_at_invalid');
  if (!message.requestedBy.trim()) issues.push('requested_by_required');
  if (message.inputArtifacts.length === 0) issues.push('input_artifacts_required');
  message.inputArtifacts.forEach((ref, index) => issues.push(...validateArtifactRef(ref, `input_${index}`)));
  return issues;
}

export function validateCadJobTransportReceipt(receipt: CadJobTransportReceipt): string[] {
  const issues: string[] = [];
  if (receipt.contractVersion !== JOB_CONTRACT_VERSION) issues.push('job_contract_version_mismatch');
  if (!receipt.jobId.trim()) issues.push('job_id_required');
  if (receipt.execution !== 'NOT_RUN') issues.push('transport_cannot_claim_execution');
  if (receipt.releaseVerification !== 'NOT_RUN') issues.push('transport_cannot_claim_release_verification');
  if (!Number.isFinite(Date.parse(receipt.observedAt))) issues.push('observed_at_invalid');
  return issues;
}

export function validateCadJobReceipt(receipt: CadJobReceipt): string[] {
  const issues: string[] = [];
  if (receipt.contractVersion !== JOB_CONTRACT_VERSION) issues.push('job_contract_version_mismatch');
  if (!receipt.jobId.trim()) issues.push('job_id_required');
  if (!SHA256.test(receipt.workerIdentitySha256)) issues.push('worker_identity_invalid');
  if (receipt.kernelIdentitySha256 !== 'NOT_APPLICABLE' && !SHA256.test(receipt.kernelIdentitySha256)) issues.push('kernel_identity_invalid');
  if (!SHA256.test(receipt.receiptSha256)) issues.push('receipt_sha256_invalid');
  receipt.inputArtifacts.forEach((ref, index) => issues.push(...validateArtifactRef(ref, `input_${index}`)));
  receipt.outputArtifacts.forEach((ref, index) => issues.push(...validateArtifactRef(ref, `output_${index}`)));
  if (receipt.execution === 'PASS' && receipt.outputArtifacts.length === 0) issues.push('pass_requires_output_artifact');
  if (receipt.execution !== 'PASS' && receipt.failureReasons.length === 0) issues.push('non_pass_requires_failure_reason');
  if (Date.parse(receipt.completedAt) < Date.parse(receipt.startedAt)) issues.push('invalid_receipt_time_order');
  return issues;
}
