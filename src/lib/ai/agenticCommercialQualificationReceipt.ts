import { createHash, createPublicKey, verify } from 'node:crypto';
import {
  EXECUTION_JOURNAL_SCHEMA,
  hashApproval,
  hashBoundReceipt,
  hashCommand,
  hashWorkspaceBinding,
  verifyExecutionJournalChain,
  type ExecutionJournalReceipt,
} from '@/lib/precision-cad-agent/executionJournal';

const SHA256 = /^[a-f0-9]{64}$/;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_ARTIFACTS = 128;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export const ALLOWED_AGENTIC_QUALIFICATION_SCHEMAS = [
  'nexyfab.architecture-interior-commercial-qualification.v1',
  'nexyfab.civil-construction-landscape-commercial-qualification.v1',
  'nexyfab.specialty-manufacturing-qualification.v1',
  'nexyfab.mep-fabrication-qualification.v1',
  'nexyfab.ecad-mcad-commercial-evidence.v1',
] as const;

export type AgenticIdentityRole = 'agent' | 'native_parser' | 'independent_verifier';
export type AgenticVerificationMode = 'fixture' | 'runtime';

export interface AgenticTrustedIdentity {
  identityId: string;
  role: AgenticIdentityRole;
  publicKeyPem: string;
  fingerprintSha256: string;
}

export interface AgenticHashedBytes {
  bytes: Uint8Array;
  sha256: string;
  size: number;
}

export interface AgenticArtifact {
  artifactId: string;
  role: string;
  targetSha256: string;
  bytes: Uint8Array;
  sha256: string;
  size: number;
  external: boolean;
}

export interface AgenticQualificationSummary {
  schema: string;
  targetSha256: string;
  status: 'QUALIFIED' | 'HOLD';
  releaseReady: boolean;
  receiptBytes: Uint8Array;
  receiptBytesSha256: string;
}

export interface AgenticCommercialQualificationReceipt {
  schema: 'nexyfab.agentic-commercial-qualification-receipt.v1';
  executionId: string;
  generationRunId: string;
  generationStateRevision: number;
  generationProgramSha256: string;
  targetSha256: string;
  externalEvidence: boolean;
  actor: { identityId: string; role: 'agent'; keyFingerprintSha256: string; signatureBase64: string };
  project: { projectId: string; workspaceId: string; revision: number; contentHash: string; modelContentHash: string };
  command: AgenticHashedBytes;
  approval: AgenticHashedBytes;
  executionJournal: AgenticHashedBytes;
  persistenceReceipt: AgenticHashedBytes;
  verificationReceipt: AgenticHashedBytes;
  artifacts: readonly AgenticArtifact[];
  artifactManifestSha256: string;
  parser: { identityId: string; role: 'native_parser'; keyFingerprintSha256: string; targetSha256: string; projectId: string; workspaceId: string; revision: number; artifactManifestSha256: string; format: string; result: 'verified'; buildSha256: string; outputBytes: Uint8Array; outputSha256: string; receiptBytes: Uint8Array; receiptSha256: string; signatureBase64: string };
  qualification: AgenticQualificationSummary;
  issuedAt: string;
  expiresAt: string;
  verifier: { identityId: string; role: 'independent_verifier'; keyFingerprintSha256: string; signatureBase64: string };
  receiptSha256: string;
}

export interface AgenticCommercialQualificationVerificationContext {
  trustedRegistry: readonly AgenticTrustedIdentity[];
  now: Date;
  mode: AgenticVerificationMode;
}

export interface AgenticCommercialQualificationVerification {
  ok: boolean;
  releaseReady: boolean;
  status: 'QUALIFIED' | 'HOLD';
  targetSha256: string;
  issues: string[];
}

function canonical(value: unknown, depth = 0): string {
  if (depth > 32) throw new Error('canonical_depth_exceeded');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error('non_finite_number'); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(item => canonical(item, depth + 1)).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key], depth + 1)}`).join(',')}}`;
  }
  throw new Error('non_canonical_value');
}

function digest(bytes: Uint8Array): string { return createHash('sha256').update(Buffer.from(bytes)).digest('hex'); }
function canonicalBytes(value: unknown): Uint8Array { return new Uint8Array(Buffer.from(canonical(value), 'utf8')); }
function validHash(value: unknown): value is string { return typeof value === 'string' && SHA256.test(value); }
function bytesOk(value: unknown): value is Uint8Array { return value instanceof Uint8Array && value.length > 0 && value.length <= MAX_BYTES; }
function sameBytes(left: Uint8Array, right: Uint8Array): boolean { return left.length === right.length && left.every((byte, index) => byte === right[index]); }

function fingerprint(publicKeyPem: string): string | undefined {
  try { const key = createPublicKey(publicKeyPem); return key.asymmetricKeyType === 'ed25519' ? digest(new Uint8Array(key.export({ type: 'spki', format: 'der' }))) : undefined; } catch { return undefined; }
}

function artifactManifest(artifacts: readonly AgenticArtifact[]): unknown[] {
  return artifacts.map(item => ({ artifactId: item.artifactId, role: item.role, targetSha256: item.targetSha256, sha256: item.sha256, size: item.size, external: item.external })).sort((left, right) => `${left.role}:${left.artifactId}`.localeCompare(`${right.role}:${right.artifactId}`));
}

function unsignedReceipt(receipt: AgenticCommercialQualificationReceipt): Record<string, unknown> {
  const { verifier, receiptSha256: _receiptSha256, ...body } = receipt;
  const { signatureBase64: _signatureBase64, ...verifierIdentity } = verifier;
  const { outputBytes: _outputBytes, receiptBytes: _parserReceiptBytes, ...parserMaterial } = body.parser;
  const { receiptBytes: _qualificationReceiptBytes, ...qualificationMaterial } = body.qualification;
  return {
    ...body,
    generationProgramSha256: body.generationProgramSha256,
    command: { sha256: body.command.sha256, size: body.command.size },
    approval: { sha256: body.approval.sha256, size: body.approval.size },
    executionJournal: { sha256: body.executionJournal.sha256, size: body.executionJournal.size },
    persistenceReceipt: { sha256: body.persistenceReceipt.sha256, size: body.persistenceReceipt.size },
    verificationReceipt: { sha256: body.verificationReceipt.sha256, size: body.verificationReceipt.size },
    artifacts: artifactManifest(body.artifacts),
    parser: parserMaterial,
    qualification: qualificationMaterial,
    verifier: verifierIdentity,
  };
}

function signaturePayload(receipt: AgenticCommercialQualificationReceipt): Uint8Array { return canonicalBytes(unsignedReceipt(receipt)); }

function parserSignaturePayload(parser: AgenticCommercialQualificationReceipt['parser']): Uint8Array {
  return canonicalBytes({ identityId: parser.identityId, role: parser.role, keyFingerprintSha256: parser.keyFingerprintSha256, targetSha256: parser.targetSha256, projectId: parser.projectId, workspaceId: parser.workspaceId, revision: parser.revision, artifactManifestSha256: parser.artifactManifestSha256, format: parser.format, result: parser.result, buildSha256: parser.buildSha256, outputSha256: parser.outputSha256, receiptSha256: parser.receiptSha256 });
}

function actorSignaturePayload(receipt: AgenticCommercialQualificationReceipt): Uint8Array {
  return canonicalBytes({ identityId: receipt.actor.identityId, role: receipt.actor.role, keyFingerprintSha256: receipt.actor.keyFingerprintSha256, executionId: receipt.executionId, generationRunId: receipt.generationRunId, generationStateRevision: receipt.generationStateRevision, generationProgramSha256: receipt.generationProgramSha256, targetSha256: receipt.targetSha256, project: receipt.project, commandSha256: receipt.command.sha256, approvalSha256: receipt.approval.sha256, executionJournalSha256: receipt.executionJournal.sha256, persistenceReceiptSha256: receipt.persistenceReceipt.sha256, verificationReceiptSha256: receipt.verificationReceipt.sha256, artifactManifestSha256: receipt.artifactManifestSha256, parserReceiptSha256: receipt.parser.receiptSha256, qualificationReceiptSha256: receipt.qualification.receiptBytesSha256 });
}

function parsedRecord(name: string, bytes: Uint8Array, issues: string[]): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(bytes).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || !sameBytes(canonicalBytes(parsed), bytes)) { issues.push(`${name}_receipt_noncanonical`); return undefined; }
    return parsed as Record<string, unknown>;
  } catch { issues.push(`${name}_receipt_invalid`); return undefined; }
}

function identityFromRegistry(registry: readonly AgenticTrustedIdentity[], identityId: string, role: AgenticIdentityRole, keyFingerprintSha256: string): AgenticTrustedIdentity | undefined {
  const identity = registry.find(item => item.identityId === identityId);
  return identity && identity.role === role && identity.fingerprintSha256 === keyFingerprintSha256 && fingerprint(identity.publicKeyPem) === keyFingerprintSha256 ? identity : undefined;
}

function validateBytes(name: string, value: AgenticHashedBytes, issues: string[]): void {
  if (!value || !bytesOk(value.bytes) || value.size !== value.bytes.length || !validHash(value.sha256) || digest(value.bytes) !== value.sha256) issues.push(`${name}_bytes_hash_invalid`);
}

function emptyIssues(value: unknown): boolean { return Array.isArray(value) && value.length === 0; }
function validStage(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const stage = value as Record<string, unknown>;
  return stage.valid === true && emptyIssues(stage.issues);
}
function exactQualificationShape(schema: string, record: Record<string, unknown>, targetSha256: string, receiptSha256: string, projectRevision: number): boolean {
  if (record.schema !== schema || record.status !== 'QUALIFIED' || !emptyIssues(record.blockers)) return false;
  if (schema === 'nexyfab.architecture-interior-commercial-qualification.v1') {
    const discipline = (value: unknown): boolean => {
      if (!value || typeof value !== 'object') return false;
      const item = value as Record<string, unknown>;
      const boundary = item.runtimeEvidenceBoundary as Record<string, unknown> | undefined;
      return item.status === 'QUALIFIED' && item.releaseReady === true && validHash(item.targetSha256)
        && emptyIssues(item.blockers) && boundary?.externalEvidenceRequired === true && boundary.externalEvidencePresent === true;
    };
    // The architecture/interior aggregate has two discipline targets but no
    // aggregate target. Bind the common target to the exact canonical result.
    return record.releaseReady === true && discipline(record.building) && discipline(record.interior) && targetSha256 === receiptSha256;
  }
  if (schema === 'nexyfab.civil-construction-landscape-commercial-qualification.v1') {
    return (record.track === 'civil' || record.track === 'landscape') && record.targetHash === targetSha256 && record.revision === projectRevision && record.qualified === true
      && validStage(record.internalReadiness) && validStage(record.nativeParser) && validStage(record.evidence) && validStage(record.attestations);
  }
  if (schema === 'nexyfab.specialty-manufacturing-qualification.v1') {
    const reviewers = record.reviewers as Record<string, { valid?: unknown }> | undefined;
    const axes = record.externalAxes as Record<string, unknown> | undefined;
    return ['sheet-metal', 'welded-fabrication', 'mold-tooling'].includes(String(record.track)) && record.targetSha256 === targetSha256 && record.releaseReady === true
      && validStage(record.contract) && validStage(record.readback) && axes?.valid === true && emptyIssues(axes.missing)
      && reviewers?.independent_parser_cad_reviewer?.valid === true && reviewers?.manufacturing_reviewer?.valid === true
      && Array.isArray(record.signatures) && record.signatures.length === 2;
  }
  if (schema === 'nexyfab.mep-fabrication-qualification.v1') {
    return ['piping', 'hvac', 'cable'].includes(String(record.track)) && record.targetHash === targetSha256 && record.revision === projectRevision && record.qualified === true
      && validStage(record.internalValidation) && validStage(record.internalReadback) && validStage(record.independentAttestation) && validStage(record.evidence);
  }
  if (schema === 'nexyfab.ecad-mcad-commercial-evidence.v1') {
    return record.targetHash === targetSha256 && record.revision === projectRevision && SAFE_ID.test(String(record.buildId ?? '')) && record.qualified === true
      && validStage(record.internalValidation) && validStage(record.internalReadback) && validStage(record.artifacts)
      && validStage(record.nativeParsers) && validStage(record.reviewers) && validStage(record.evidence);
  }
  return false;
}

/**
 * Verifies the common receipt at the server boundary. The registry, clock and
 * mode are verifier-owned inputs; none may be taken from the receipt itself.
 */
export function verifyAgenticCommercialQualificationReceipt(
  receipt: AgenticCommercialQualificationReceipt | undefined,
  context: AgenticCommercialQualificationVerificationContext,
): AgenticCommercialQualificationVerification {
  const targetSha256 = typeof receipt?.targetSha256 === 'string' ? receipt.targetSha256 : '';
  const issues: string[] = [];
  try {
    if (!receipt || receipt.schema !== 'nexyfab.agentic-commercial-qualification-receipt.v1') issues.push('receipt_schema_invalid');
    if (!Number.isSafeInteger(receipt?.generationStateRevision) || (receipt?.generationStateRevision ?? -1) < 0) issues.push('generation_state_revision_invalid');
    if (!validHash(receipt?.generationProgramSha256)) issues.push('generation_program_hash_invalid');
    if (!validHash(receipt?.targetSha256)) issues.push('target_hash_invalid');
    if (!(context?.now instanceof Date) || !Number.isFinite(context.now.getTime())) issues.push('verifier_clock_invalid');
    if (context?.mode !== 'fixture' && context?.mode !== 'runtime') issues.push('verifier_mode_invalid');
    if (!Array.isArray(context?.trustedRegistry) || context.trustedRegistry.length !== 3) issues.push('trust_registry_invalid');
    const registry = context.trustedRegistry ?? [];
    const ids = new Set<string>(), keys = new Set<string>();
    for (const item of registry) {
      if (!SAFE_ID.test(item?.identityId ?? '') || !['agent', 'native_parser', 'independent_verifier'].includes(item.role) || !validHash(item.fingerprintSha256) || fingerprint(item.publicKeyPem) !== item.fingerprintSha256 || ids.has(item.identityId) || keys.has(item.fingerprintSha256)) issues.push('trust_registry_identity_or_key_invalid');
      ids.add(item.identityId); keys.add(item.fingerprintSha256);
    }
    if (!receipt) throw new Error('receipt_missing');
    const actorIdentity = identityFromRegistry(registry, receipt.actor?.identityId, 'agent', receipt.actor?.keyFingerprintSha256);
    if (!receipt.actor || receipt.actor.role !== 'agent' || !actorIdentity || !verify(null, actorSignaturePayload(receipt), createPublicKey(actorIdentity.publicKeyPem), Buffer.from(receipt.actor.signatureBase64 ?? '', 'base64'))) issues.push('actor_trust_or_signature_invalid');
    const parserIdentity = identityFromRegistry(registry, receipt.parser?.identityId, 'native_parser', receipt.parser?.keyFingerprintSha256);
    const verifierIdentity = identityFromRegistry(registry, receipt.verifier?.identityId, 'independent_verifier', receipt.verifier?.keyFingerprintSha256);
    if (!parserIdentity) issues.push('parser_trust_invalid');
    if (!verifierIdentity) issues.push('verifier_trust_invalid');
    if (receipt.actor.identityId === receipt.parser?.identityId || receipt.actor.identityId === receipt.verifier?.identityId || receipt.parser?.identityId === receipt.verifier?.identityId || receipt.actor.keyFingerprintSha256 === receipt.parser?.keyFingerprintSha256 || receipt.actor.keyFingerprintSha256 === receipt.verifier?.keyFingerprintSha256 || receipt.parser?.keyFingerprintSha256 === receipt.verifier?.keyFingerprintSha256) issues.push('identity_or_key_reuse');
    const project = receipt.project;
    if (!SAFE_ID.test(receipt.executionId ?? '') || !SAFE_ID.test(receipt.generationRunId ?? '') || !SAFE_ID.test(project?.projectId ?? '') || !SAFE_ID.test(project?.workspaceId ?? '') || !Number.isSafeInteger(project.revision) || project.revision < 0 || !validHash(project.contentHash) || !validHash(project.modelContentHash)) issues.push('project_workspace_binding_invalid');
    const artifacts = receipt.artifacts;
    if (!Array.isArray(artifacts) || artifacts.length === 0 || artifacts.length > MAX_ARTIFACTS) issues.push('artifact_set_cap_or_missing');
    const artifactIds = new Set<string>(), artifactRoles = new Set<string>(), artifactHashes = new Set<string>();
    for (const artifact of artifacts ?? []) {
      if (!SAFE_ID.test(artifact?.artifactId ?? '') || !SAFE_ID.test(artifact?.role ?? '') || artifactIds.has(artifact.artifactId) || artifactRoles.has(artifact.role)) issues.push('artifact_identity_or_role_reuse');
      artifactIds.add(artifact.artifactId); artifactRoles.add(artifact.role);
      if (artifact.targetSha256 !== receipt.targetSha256) issues.push('artifact_target_mismatch');
      if (!bytesOk(artifact.bytes) || artifact.size !== artifact.bytes.length || !validHash(artifact.sha256) || digest(artifact.bytes) !== artifact.sha256 || artifactHashes.has(artifact.sha256)) issues.push('artifact_bytes_hash_or_reuse_invalid');
      artifactHashes.add(artifact.sha256);
      if (context.mode === 'runtime' && artifact.external !== true) issues.push('runtime_external_artifact_required');
    }
    const totalBytes = (artifacts ?? []).reduce((total, artifact) => total + (artifact?.bytes instanceof Uint8Array ? artifact.bytes.length : 0), 0)
      + [receipt.command?.bytes, receipt.approval?.bytes, receipt.executionJournal?.bytes, receipt.persistenceReceipt?.bytes, receipt.verificationReceipt?.bytes, receipt.parser?.outputBytes, receipt.parser?.receiptBytes, receipt.qualification?.receiptBytes]
        .reduce((total, value) => total + (value instanceof Uint8Array ? value.length : 0), 0);
    if (totalBytes > MAX_TOTAL_BYTES) issues.push('receipt_total_bytes_exceeded');
    if (!validHash(receipt.artifactManifestSha256) || digest(canonicalBytes(artifactManifest(artifacts ?? []))) !== receipt.artifactManifestSha256) issues.push('artifact_manifest_hash_invalid');
    validateBytes('command', receipt.command, issues); validateBytes('approval', receipt.approval, issues); validateBytes('execution_journal', receipt.executionJournal, issues); validateBytes('persistence_receipt', receipt.persistenceReceipt, issues); validateBytes('verification_receipt', receipt.verificationReceipt, issues);
    const commandRecord = bytesOk(receipt.command?.bytes) ? parsedRecord('command', receipt.command.bytes, issues) : undefined;
    const approvalRecord = bytesOk(receipt.approval?.bytes) ? parsedRecord('approval', receipt.approval.bytes, issues) : undefined;
    const journalRecord = bytesOk(receipt.executionJournal?.bytes) ? parsedRecord('execution_journal', receipt.executionJournal.bytes, issues) : undefined;
    const persistenceRecord = bytesOk(receipt.persistenceReceipt?.bytes) ? parsedRecord('persistence', receipt.persistenceReceipt.bytes, issues) : undefined;
    const verificationRecord = bytesOk(receipt.verificationReceipt?.bytes) ? parsedRecord('verification', receipt.verificationReceipt.bytes, issues) : undefined;
    const journal = journalRecord as unknown as ExecutionJournalReceipt | undefined;
    const journalAfter = journal?.workspace?.after;
    const commandArguments = journal?.command?.arguments as Record<string, unknown> | undefined;
    const journalArtifactMaterial = journal?.artifacts?.map(item => ({ artifactId: item.artifactId, role: item.kind, sha256: item.sha256 })).sort((a, b) => `${a.role}:${a.artifactId}`.localeCompare(`${b.role}:${b.artifactId}`));
    const receiptArtifactMaterial = (artifacts ?? []).map(item => ({ artifactId: item.artifactId, role: item.role, sha256: item.sha256 })).sort((a, b) => `${a.role}:${a.artifactId}`.localeCompare(`${b.role}:${b.artifactId}`));
    if (!journal || journal.schema !== EXECUTION_JOURNAL_SCHEMA || journal.lifecycle !== 'COMMITTED' || !verifyExecutionJournalChain(journal)
      || !journalAfter || journalAfter.projectId !== receipt.project.projectId || journalAfter.workspaceId !== receipt.project.workspaceId || journalAfter.revision !== receipt.project.revision || journalAfter.contentHash !== receipt.project.contentHash
      || journal.commandHash !== hashCommand(journal.command) || journal.workspaceBindingHash !== hashWorkspaceBinding(journal.workspaceBinding)
      || !journal.approval || journal.approvalHash !== hashApproval(journal.approval) || journal.approval.approved !== true || journal.approval.userInitiated !== true
      || !validHash(journal.persistenceReceiptHash) || !validHash(journal.verificationReceiptHash)
      || !persistenceRecord || journal.persistenceReceiptHash !== hashBoundReceipt(persistenceRecord)
      || !verificationRecord || journal.verificationReceiptHash !== hashBoundReceipt(verificationRecord)
      || journal.events[0]?.type !== 'PLANNED' || journal.events[1]?.type !== 'APPROVED'
      || !journal.events.some(event => event.type === 'LEASE_ACQUIRED' || event.type === 'LEASE_TAKEN_OVER')
      || journal.events.at(-1)?.type !== 'COMMITTED'
      || journal.executionId !== receipt.executionId || commandArguments?.targetSha256 !== receipt.targetSha256 || commandArguments?.modelContentHash !== receipt.project.modelContentHash || commandArguments?.artifactManifestSha256 !== receipt.artifactManifestSha256 || commandArguments?.generationRunId !== receipt.generationRunId || commandArguments?.generationStateRevision !== receipt.generationStateRevision || commandArguments?.generationProgramSha256 !== receipt.generationProgramSha256
      || canonical(journalArtifactMaterial) !== canonical(receiptArtifactMaterial)) issues.push('execution_journal_binding_invalid');
    if (!commandRecord || !journal || canonical(commandRecord) !== canonical(journal.command) || receipt.command.sha256 !== digest(canonicalBytes(journal.command))) issues.push('command_receipt_binding_invalid');
    if (!approvalRecord || !journal?.approval || canonical(approvalRecord) !== canonical(journal.approval) || receipt.approval.sha256 !== digest(canonicalBytes(journal.approval))) issues.push('approval_receipt_binding_invalid');
    if (!receipt.parser || receipt.parser.role !== 'native_parser' || receipt.parser.targetSha256 !== receipt.targetSha256 || receipt.parser.projectId !== receipt.project.projectId || receipt.parser.workspaceId !== receipt.project.workspaceId || receipt.parser.revision !== receipt.project.revision || receipt.parser.artifactManifestSha256 !== receipt.artifactManifestSha256 || !SAFE_ID.test(receipt.parser.format ?? '') || receipt.parser.result !== 'verified' || !validHash(receipt.parser.buildSha256) || !bytesOk(receipt.parser.outputBytes) || !validHash(receipt.parser.outputSha256) || digest(receipt.parser.outputBytes) !== receipt.parser.outputSha256 || !bytesOk(receipt.parser.receiptBytes) || !validHash(receipt.parser.receiptSha256) || digest(receipt.parser.receiptBytes) !== receipt.parser.receiptSha256 || !verify(null, parserSignaturePayload(receipt.parser), parserIdentity ? createPublicKey(parserIdentity.publicKeyPem) : '', Buffer.from(receipt.parser.signatureBase64 ?? '', 'base64'))) issues.push('parser_build_output_or_signature_invalid');
    else {
      const parserRecord = parsedRecord('parser', receipt.parser.receiptBytes, issues);
      if (!parserRecord || parserRecord.schema !== 'nexyfab.native-parser-receipt.v1' || parserRecord.targetSha256 !== receipt.targetSha256 || parserRecord.identityId !== receipt.parser.identityId || parserRecord.projectId !== receipt.project.projectId || parserRecord.workspaceId !== receipt.project.workspaceId || parserRecord.revision !== receipt.project.revision || parserRecord.artifactManifestSha256 !== receipt.artifactManifestSha256 || parserRecord.format !== receipt.parser.format || parserRecord.result !== 'verified' || parserRecord.buildSha256 !== receipt.parser.buildSha256 || parserRecord.outputSha256 !== receipt.parser.outputSha256) issues.push('parser_receipt_binding_invalid');
    }
    const qualification = receipt.qualification;
    if (!qualification || !ALLOWED_AGENTIC_QUALIFICATION_SCHEMAS.includes(qualification.schema as typeof ALLOWED_AGENTIC_QUALIFICATION_SCHEMAS[number]) || qualification.targetSha256 !== receipt.targetSha256 || qualification.status !== 'QUALIFIED' || qualification.releaseReady !== true || !bytesOk(qualification.receiptBytes) || !validHash(qualification.receiptBytesSha256) || digest(qualification.receiptBytes) !== qualification.receiptBytesSha256) issues.push('domain_qualification_not_qualified_or_unbound');
    else {
      try {
        const parsed: unknown = JSON.parse(Buffer.from(qualification.receiptBytes).toString('utf8'));
        const record = parsed as Record<string, unknown>;
        if (!sameBytes(canonicalBytes(parsed), qualification.receiptBytes)
          || !exactQualificationShape(qualification.schema, record, qualification.targetSha256, qualification.receiptBytesSha256, receipt.project.revision)) issues.push('domain_qualification_receipt_bytes_noncanonical');
      } catch { issues.push('domain_qualification_receipt_bytes_invalid'); }
    }
    const issued = Date.parse(receipt.issuedAt), expires = Date.parse(receipt.expiresAt), now = context.now.getTime();
    if (!Number.isFinite(issued) || !Number.isFinite(expires) || expires <= issued || expires - issued > MAX_TTL_MS || issued > now || expires < now) issues.push('receipt_issue_or_expiry_invalid');
    if (context.mode === 'runtime' && receipt.externalEvidence !== true) issues.push('runtime_external_evidence_required');
    if (receipt.verifier?.role !== 'independent_verifier' || !receipt.verifier.signatureBase64 || !verify(null, Buffer.from(signaturePayload(receipt)), verifierIdentity ? createPublicKey(verifierIdentity.publicKeyPem) : '', Buffer.from(receipt.verifier?.signatureBase64 ?? '', 'base64'))) issues.push('receipt_signature_invalid');
    if (!validHash(receipt.receiptSha256) || digest(signaturePayload(receipt)) !== receipt.receiptSha256) issues.push('receipt_canonical_hash_invalid');
  } catch (error) { issues.push(error instanceof Error ? `malformed_receipt:${error.message}` : 'malformed_receipt'); }
  const unique = [...new Set(issues)];
  return { ok: unique.length === 0, releaseReady: unique.length === 0, status: unique.length === 0 ? 'QUALIFIED' : 'HOLD', targetSha256, issues: unique };
}

export function agenticCommercialCanonicalBytes(value: unknown): Uint8Array { return canonicalBytes(value); }
export function agenticCommercialSha256(bytes: Uint8Array): string { return digest(bytes); }
export function agenticCommercialSignaturePayload(receipt: AgenticCommercialQualificationReceipt): Uint8Array { return signaturePayload(receipt); }
export function agenticCommercialActorSignaturePayload(receipt: AgenticCommercialQualificationReceipt): Uint8Array { return actorSignaturePayload(receipt); }
export function agenticCommercialParserSignaturePayload(parser: AgenticCommercialQualificationReceipt['parser']): Uint8Array { return parserSignaturePayload(parser); }
export function agenticCommercialArtifactManifestSha256(artifacts: readonly AgenticArtifact[]): string { return digest(canonicalBytes(artifactManifest(artifacts))); }
