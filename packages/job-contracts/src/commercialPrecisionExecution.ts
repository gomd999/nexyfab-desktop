export const COMMERCIAL_PRECISION_EXECUTION_VERSION = 'nexyfab.precision-cad-commercial-execution.v3' as const;
export const COMMERCIAL_PRECISION_LEGACY_EXECUTION_VERSION = 'nexyfab.precision-cad-commercial-execution.v2' as const;
export const COMMERCIAL_PRECISION_INPUT_SCHEMA = 'nexyfab.precision-cad-commercial-input.v2' as const;
export const COMMERCIAL_MAX_BODY_BYTES = 512 * 1024;
export const COMMERCIAL_MAX_ARGUMENT_BYTES = 256 * 1024;
export type CommercialExecutionScope = 'apply' | 'export';
export type CommercialOutputRole = 'model' | 'report' | 'verification';
export type CommercialExecutionStatus = 'PASS' | 'FAIL' | 'HOLD' | 'VERIFIED_UNKNOWN';
export type CommercialExecutionContractVersion = typeof COMMERCIAL_PRECISION_EXECUTION_VERSION | typeof COMMERCIAL_PRECISION_LEGACY_EXECUTION_VERSION;
export type CommercialInputArtifact = {
  artifactId: string;
  objectKey: string;
  contentSha256: string;
  byteLength: number;
  mediaType: 'application/json';
};
export type CommercialExecutionJob = {
  contractVersion: CommercialExecutionContractVersion;
  jobId: string;
  tenantId: string;
  projectId: string;
  executionId: string;
  generationRunId: string;
  generationStateRevision: number;
  generationProgramSha256: string;
  workspaceId: string;
  workspaceRevision: number;
  workspaceContentHash: string;
  tool: string;
  scope: CommercialExecutionScope;
  callId: string;
  argumentsHash: string;
  commandHash: string;
  targetHash: string;
  journalVersion: number;
  attempt: number;
  leaseGeneration: number;
  inputArtifact?: CommercialInputArtifact;
};
export type CommercialExecutionJobBinding = Omit<CommercialExecutionJob, 'inputArtifact' | 'attempt' | 'leaseGeneration'>;
export type CommercialExecutionInput = {
  schema: typeof COMMERCIAL_PRECISION_INPUT_SCHEMA;
  job: CommercialExecutionJobBinding;
  arguments: Readonly<Record<string, unknown>>;
};
export type CommercialTransportEnvelope = {
  schema: CommercialExecutionContractVersion;
  job: CommercialExecutionJob;
  issuedAt: string;
  expiresAt: string;
  transportHmac: string;
  callbackUrl: string;
  inputDownloadUrl?: string;
  artifactGatewayUrl?: string;
  leaseCapability: string;
};
export type CommercialOutputArtifact = { artifactId: string; role: CommercialOutputRole; contentSha256: string; byteLength: number; objectKey: string };
export type CommercialWorkerReceipt = {
  schema: CommercialExecutionContractVersion;
  tenantId: string;
  projectId: string;
  executionId: string;
  generationRunId: string;
  generationStateRevision: number;
  generationProgramSha256: string;
  workspaceId: string;
  workspaceRevision: number;
  workspaceContentHash: string;
  journalVersion: number;
  leaseGeneration: number;
  leaseCapabilityHash: string;
  attempt: number;
  jobId: string;
  commandHash: string;
  targetHash: string;
  inputArtifactSha256: string;
  workerIdentity: string;
  workerPublicKeyFingerprint: string;
  status: CommercialExecutionStatus;
  startedAt: string;
  completedAt: string;
  outputArtifacts: CommercialOutputArtifact[];
  failureReasons: string[];
  signatureBase64: string;
};
const SHA256 = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
function id(value: unknown): value is string { return typeof value === 'string' && ID.test(value); }
function hash(value: unknown): value is string { return typeof value === 'string' && SHA256.test(value); }
function privateObjectKey(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 512 && value.startsWith('private/') && !value.startsWith('/') && !value.includes('..') && !value.includes('\\'); }
function secureUrl(value: unknown): boolean { try { const url = new URL(String(value)); return url.protocol === 'https:' && !url.username && !url.password && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1' && url.hostname !== '::1'; } catch { return false; } }
function canonical(value: unknown, depth = 0): string {
  if (depth > 12) throw new Error('canonical_depth_exceeded');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error('canonical_nonfinite'); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(item => canonical(item, depth + 1)).join(',')}]`;
  if (value && typeof value === 'object') { const record = value as Record<string, unknown>; return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key], depth + 1)}`).join(',')}}`; }
  throw new Error('canonical_unsupported');
}
export function canonicalCommercialExecution(value: unknown): string { return canonical(value); }
export async function sha256Commercial(value: unknown): Promise<string> { const bytes = new TextEncoder().encode(canonical(value)); const result = await crypto.subtle.digest('SHA-256', bytes); return [...new Uint8Array(result)].map(byte => byte.toString(16).padStart(2, '0')).join(''); }
export function unsignedCommercialWorkerReceipt(receipt: CommercialWorkerReceipt): Omit<CommercialWorkerReceipt, 'signatureBase64'> { const unsigned = { ...receipt }; Reflect.deleteProperty(unsigned, 'signatureBase64'); return unsigned; }
export function commercialExecutionJobBinding(job: CommercialExecutionJob): CommercialExecutionJobBinding { const { inputArtifact: _inputArtifact, attempt: _attempt, leaseGeneration: _leaseGeneration, ...binding } = job; return binding; }
export function validateCommercialInputArtifact(artifact: CommercialInputArtifact | undefined): string[] {
  const issues: string[] = [];
  if (!artifact || typeof artifact !== 'object') return ['input_artifact_invalid'];
  if (!id(artifact.artifactId)) issues.push('input_artifact_id_invalid');
  if (!privateObjectKey(artifact.objectKey)) issues.push('input_artifact_object_key_invalid');
  if (!hash(artifact.contentSha256)) issues.push('input_artifact_sha256_invalid');
  if (!Number.isSafeInteger(artifact.byteLength) || artifact.byteLength < 1 || artifact.byteLength > COMMERCIAL_MAX_BODY_BYTES) issues.push('input_artifact_size_invalid');
  if (artifact.mediaType !== 'application/json') issues.push('input_artifact_media_type_invalid');
  return issues;
}
export function validateCommercialExecutionJob(job: CommercialExecutionJob): string[] {
  const issues: string[] = [];
  if (job.contractVersion !== COMMERCIAL_PRECISION_EXECUTION_VERSION) issues.push('contract_version_invalid');
  for (const key of ['jobId', 'tenantId', 'projectId', 'executionId', 'generationRunId', 'workspaceId', 'tool', 'callId'] as const) if (!id(job[key])) issues.push(`${key}_invalid`);
  for (const key of ['workspaceContentHash', 'generationProgramSha256', 'argumentsHash', 'commandHash', 'targetHash'] as const) if (!hash(job[key])) issues.push(`${key}_invalid`);
  if (!Number.isSafeInteger(job.generationStateRevision) || job.generationStateRevision < 0) issues.push('generation_state_revision_invalid');
  if (!Number.isSafeInteger(job.workspaceRevision) || job.workspaceRevision < 0) issues.push('workspace_revision_invalid');
  if (!Number.isSafeInteger(job.journalVersion) || job.journalVersion < 0) issues.push('journal_version_invalid');
  if (!Number.isSafeInteger(job.attempt) || job.attempt < 1) issues.push('attempt_invalid');
  if (!Number.isSafeInteger(job.leaseGeneration) || job.leaseGeneration < 1) issues.push('lease_generation_invalid');
  if (job.scope !== 'apply' && job.scope !== 'export') issues.push('scope_invalid');
  issues.push(...validateCommercialInputArtifact(job.inputArtifact));
  return [...new Set(issues)];
}
export async function validateCommercialExecutionInput(input: CommercialExecutionInput, expected: CommercialExecutionJob): Promise<string[]> {
  const issues: string[] = [];
  if (!input || typeof input !== 'object' || input.schema !== COMMERCIAL_PRECISION_INPUT_SCHEMA) issues.push('input_schema_invalid');
  if (!input?.job || canonical(input.job) !== canonical(commercialExecutionJobBinding(expected))) issues.push('input_job_binding_mismatch');
  if (!input?.arguments || typeof input.arguments !== 'object' || Array.isArray(input.arguments)) issues.push('input_arguments_invalid');
  else {
    try {
      const encoded = canonical(input.arguments);
      if (new TextEncoder().encode(encoded).byteLength > COMMERCIAL_MAX_ARGUMENT_BYTES) issues.push('input_arguments_oversized');
      if (await sha256Commercial(input.arguments) !== expected.argumentsHash) issues.push('input_arguments_hash_mismatch');
    } catch { issues.push('input_arguments_invalid'); }
  }
  return [...new Set(issues)];
}
export function validateCommercialTransport(envelope: CommercialTransportEnvelope): string[] {
  const issues = validateCommercialExecutionJob(envelope.job);
  if (envelope.schema !== COMMERCIAL_PRECISION_EXECUTION_VERSION) issues.push('transport_schema_invalid');
  if (!envelope.transportHmac || !/^[-_A-Za-z0-9]{32,}$/.test(envelope.transportHmac)) issues.push('transport_hmac_invalid');
  if (typeof envelope.leaseCapability !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(envelope.leaseCapability)) issues.push('lease_capability_invalid');
  if (!secureUrl(envelope.callbackUrl)) issues.push('callback_url_invalid');
  if (!secureUrl(envelope.inputDownloadUrl)) issues.push('input_download_url_invalid');
  if (!secureUrl(envelope.artifactGatewayUrl)) issues.push('artifact_gateway_url_invalid');
  const issued = Date.parse(envelope.issuedAt); const expires = Date.parse(envelope.expiresAt);
  if (!Number.isFinite(issued) || !Number.isFinite(expires) || expires <= issued || expires - issued > 5 * 60 * 1000) issues.push('transport_expiry_invalid');
  return [...new Set(issues)];
}
export function validateCommercialWorkerReceipt(receipt: CommercialWorkerReceipt): string[] {
  const issues: string[] = [];
  if (receipt.schema !== COMMERCIAL_PRECISION_EXECUTION_VERSION) issues.push('receipt_schema_invalid');
  for (const key of ['tenantId', 'projectId', 'executionId', 'generationRunId', 'workspaceId', 'jobId', 'workerIdentity'] as const) if (!id(receipt[key])) issues.push(`${key}_invalid`);
  for (const key of ['workspaceContentHash', 'generationProgramSha256', 'commandHash', 'targetHash', 'inputArtifactSha256', 'workerPublicKeyFingerprint', 'leaseCapabilityHash'] as const) if (!hash(receipt[key])) issues.push(`${key}_invalid`);
  if (!Number.isSafeInteger(receipt.generationStateRevision) || receipt.generationStateRevision < 0) issues.push('generation_state_revision_invalid');
  if (!Number.isSafeInteger(receipt.workspaceRevision) || receipt.workspaceRevision < 0) issues.push('workspace_revision_invalid');
  if (!Number.isSafeInteger(receipt.journalVersion) || receipt.journalVersion < 0) issues.push('journal_version_invalid');
  if (!Number.isSafeInteger(receipt.leaseGeneration) || receipt.leaseGeneration < 1) issues.push('lease_generation_invalid');
  if (!Number.isSafeInteger(receipt.attempt) || receipt.attempt < 1) issues.push('attempt_invalid');
  if (!['PASS', 'FAIL', 'HOLD', 'VERIFIED_UNKNOWN'].includes(receipt.status)) issues.push('status_invalid');
  if (!Number.isFinite(Date.parse(receipt.startedAt)) || !Number.isFinite(Date.parse(receipt.completedAt)) || Date.parse(receipt.completedAt) < Date.parse(receipt.startedAt)) issues.push('receipt_time_invalid');
  if (!Array.isArray(receipt.outputArtifacts) || receipt.outputArtifacts.length > 3) issues.push('output_collection_invalid');
  const roles = new Set<string>(); const ids = new Set<string>();
  for (const artifact of receipt.outputArtifacts ?? []) { if (!id(artifact.artifactId) || ids.has(artifact.artifactId)) issues.push('output_id_reused'); ids.add(artifact.artifactId); if (!['model', 'report', 'verification'].includes(artifact.role) || roles.has(artifact.role)) issues.push('output_role_invalid_or_reused'); roles.add(artifact.role); if (!hash(artifact.contentSha256) || !Number.isSafeInteger(artifact.byteLength) || artifact.byteLength <= 0 || typeof artifact.objectKey !== 'string' || !artifact.objectKey || artifact.objectKey.length > 512 || artifact.objectKey.startsWith('/') || artifact.objectKey.includes('..') || artifact.objectKey.includes('\\')) issues.push('output_artifact_invalid'); }
  if (receipt.status === 'PASS' && (roles.size !== 3 || !['model', 'report', 'verification'].every(role => roles.has(role)))) issues.push('pass_requires_exact_output_roles');
  if (!Array.isArray(receipt.failureReasons) || receipt.failureReasons.length > 32 || receipt.failureReasons.some(reason => typeof reason !== 'string' || reason.length < 1 || reason.length > 512) || (receipt.status !== 'PASS' && receipt.failureReasons.length === 0) || (receipt.status === 'PASS' && receipt.failureReasons.length !== 0)) issues.push('failure_reasons_invalid');
  if (typeof receipt.signatureBase64 !== 'string' || receipt.signatureBase64.length < 80 || receipt.signatureBase64.length > 256 || !/^[A-Za-z0-9+/]+={0,2}$/.test(receipt.signatureBase64)) issues.push('signature_required');
  return [...new Set(issues)];
}
export async function hmacCommercialTransport(secret: string, envelope: Omit<CommercialTransportEnvelope, 'transportHmac'>): Promise<string> { const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(canonical(envelope))); return btoa(String.fromCharCode(...new Uint8Array(signature))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', ''); }
export async function verifyCommercialTransportHmac(secret: string, envelope: CommercialTransportEnvelope): Promise<boolean> { const { transportHmac, ...unsigned } = envelope; return transportHmac === await hmacCommercialTransport(secret, unsigned); }
