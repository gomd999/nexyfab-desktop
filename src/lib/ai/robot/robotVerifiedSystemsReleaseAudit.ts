import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { z } from 'zod';
import { auditRobotReleaseEvidenceV2, type TrustedRobotExactCadKeys } from './robotReleaseEvidenceAuditV2';
import {
  verifyRobotPhysicalValidationReceipt,
  type TrustedRobotPhysicalValidationKeys,
} from './robotPhysicalValidationReceipt';

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const engineeringSchema = z.object({ schema: z.literal('nexyfab.robot-engineering-coverage-report.v1'), frozenRequirementsSha256: sha, coverageHash: sha, status: z.literal('passed'), coverageReady: z.literal(true), fullRequirementsCoverageComplete: z.literal(true), errors: z.array(z.string()).length(0) }).passthrough();
const motionSchema = z.object({
  schema: z.literal('nexyfab.robot-motion-coverage-report.v1'),
  frozenRequirementsSha256: sha,
  coverageHash: sha,
  status: z.literal('passed'),
  motionCoverageReady: z.literal(true),
  /** A pose/frame-only receipt is not sufficient for final release evidence. */
  continuousCollisionCoverageComplete: z.literal(true),
  /** The continuous result must carry its path/frame/segment content binding. */
  sweptEvidenceBindingSha256: sha,
  sweptEvidenceArtifactsVerified: z.literal(true),
  errors: z.array(z.string()).length(0),
}).passthrough();
const cableSchema = z.object({ schema: z.literal('nexyfab.robot-cable-life-sweep-report.v1'), frozenRequirementsSha256: sha, motionCoverageHash: sha, cableInputSha256: sha, status: z.literal('passed'), cableLifeReady: z.literal(true), errors: z.array(z.string()).length(0) }).passthrough();
const safetySchema = z.object({ schema: z.literal('nexyfab.robot-safety-electrical-design-report.v1'), frozenRequirementsSha256: sha, inputSha256: sha, status: z.literal('passed'), designSupportReady: z.literal(true), certificationClaimed: z.literal(false), errors: z.array(z.string()).length(0) }).passthrough();
const bindingSchema = z.object({
  schema: z.literal('nexyfab.robot-verified-systems-release-binding.v1'),
  postIntegrationTargetHash: sha,
  postIntegrationApplicationHash: sha,
  frozenRequirementsSha256: sha,
  engineeringCoverageHash: sha,
  motionCoverageHash: sha,
  cableInputSha256: sha,
  safetyElectricalInputSha256: sha,
  physicalValidationReceiptSha256: sha,
}).strict();

export type RobotVerifiedSystemsReleaseAuditFiles = {
  postIntegration: Uint8Array;
  exactCadEvidence: Uint8Array;
  manufacturingEvidence: Uint8Array;
  engineeringCoverage: Uint8Array;
  motionCoverage: Uint8Array;
  cableLife: Uint8Array;
  safetyElectrical: Uint8Array;
  physicalReceipt: Uint8Array;
  systemBinding: Uint8Array;
};
export type RobotVerifiedSystemsReleaseAuditReport = {
  schema: 'nexyfab.robot-verified-systems-release-audit.v2';
  status: 'ready_for_final_review' | 'not_ready';
  releaseTargetHash: string | null;
  legacyCadManufacturingTargetHash: string | null;
  frozenRequirementsSha256: string | null;
  physicalValidationReceiptSha256: string;
  exactCadEvidenceValid: boolean;
  manufacturingEvidenceValid: boolean;
  engineeringCoverageValid: boolean;
  motionCoverageValid: boolean;
  cableLifeValid: boolean;
  safetyElectricalDesignValid: boolean;
  physicalValidationValid: boolean;
  errors: string[];
  blockers: string[];
  auditIssuerId: string | null;
  auditIssuerIdentitySha256: string | null;
  issuedAt: string | null;
  signature: string | null;
  releaseReady: false;
  releaseExecuted: false;
  sideEffects: { persisted: false; cadModified: false; releasePublished: false; quoteCreated: false; rfqSent: false };
};

export type RobotVerifiedSystemsAuditSigner = { auditorId: string; privateKey: string; issuedAt?: string };
export type TrustedRobotVerifiedSystemsAuditKeys = Record<string, { publicKey: string }>;

export function auditRobotVerifiedSystemsRelease(
  files: RobotVerifiedSystemsReleaseAuditFiles,
  artifacts: ReadonlyMap<string, Uint8Array>,
  trusted: { exactCad: TrustedRobotExactCadKeys; manufacturing: TrustedRobotExactCadKeys; physical: TrustedRobotPhysicalValidationKeys },
  signer?: RobotVerifiedSystemsAuditSigner,
): RobotVerifiedSystemsReleaseAuditReport {
  const errors: string[] = [];
  const legacy = auditRobotReleaseEvidenceV2(files.postIntegration, files.exactCadEvidence, files.manufacturingEvidence, trusted.exactCad, trusted.manufacturing);
  if (legacy.status !== 'ready_for_final_review') errors.push(...legacy.errors.map(error => `CAD/manufacturing: ${error}`));
  const engineering = engineeringSchema.safeParse(decode(files.engineeringCoverage, 'engineering coverage', errors));
  const motion = motionSchema.safeParse(decode(files.motionCoverage, 'motion coverage', errors));
  const cable = cableSchema.safeParse(decode(files.cableLife, 'cable life', errors));
  const safety = safetySchema.safeParse(decode(files.safetyElectrical, 'safety/electrical design', errors));
  const binding = bindingSchema.safeParse(decode(files.systemBinding, 'verified-systems binding', errors));
  for (const [label, parsed] of [['engineering', engineering], ['motion', motion], ['cable', cable], ['safety', safety], ['binding', binding]] as const) if (!parsed.success) errors.push(...parsed.error.issues.map(issue => `${label}.${issue.path.join('.') || '$'}: ${issue.message}`));
  const physical = verifyRobotPhysicalValidationReceipt({ engineeringCoverage: files.engineeringCoverage, motionCoverage: files.motionCoverage, cableLife: files.cableLife, safetyElectrical: files.safetyElectrical }, files.physicalReceipt, artifacts, trusted.physical);
  if (!physical.physicalValidationReady) errors.push(...physical.errors.map(error => `physical: ${error}`));
  if (engineering.success && motion.success && cable.success && safety.success && binding.success) {
    const frozen = engineering.data.frozenRequirementsSha256;
    if ([motion.data.frozenRequirementsSha256, cable.data.frozenRequirementsSha256, safety.data.frozenRequirementsSha256, binding.data.frozenRequirementsSha256, physical.frozenRequirementsSha256].some(value => value !== frozen)) errors.push('verified-systems evidence does not share one frozen requirements hash');
    if (cable.data.motionCoverageHash !== motion.data.coverageHash) errors.push('cable life is not bound to the supplied motion coverage');
    const post = decode(files.postIntegration, 'post integration', errors) as { targetHash?: unknown; applicationHash?: unknown } | null;
    const expected: Array<[string, unknown, string]> = [
      ['postIntegrationTargetHash', post?.targetHash, binding.data.postIntegrationTargetHash],
      ['postIntegrationApplicationHash', post?.applicationHash, binding.data.postIntegrationApplicationHash],
      ['engineeringCoverageHash', engineering.data.coverageHash, binding.data.engineeringCoverageHash],
      ['motionCoverageHash', motion.data.coverageHash, binding.data.motionCoverageHash],
      ['cableInputSha256', cable.data.cableInputSha256, binding.data.cableInputSha256],
      ['safetyElectricalInputSha256', safety.data.inputSha256, binding.data.safetyElectricalInputSha256],
      ['physicalValidationReceiptSha256', physical.receiptSha256, binding.data.physicalValidationReceiptSha256],
    ];
    for (const [field, actual, declared] of expected) if (actual !== declared) errors.push(`verified-systems binding ${field} mismatch`);
  }
  let auditIssuerId: string | null = null;
  let auditIssuerIdentitySha256: string | null = null;
  let issuedAt: string | null = null;
  let signingKey: ReturnType<typeof createPrivateKey> | null = null;
  if (!signer) errors.push('verified audit signer is not configured');
  else {
    auditIssuerId = /^[A-Za-z0-9._:-]{1,128}$/.test(signer.auditorId) ? signer.auditorId : null;
    issuedAt = signer.issuedAt ?? new Date().toISOString();
    if (!auditIssuerId) errors.push('verified audit signer id is invalid');
    if (!ISO_TIME.test(issuedAt) || !Number.isFinite(Date.parse(issuedAt))) errors.push('verified audit issuedAt is invalid');
    try {
      signingKey = createPrivateKey(signer.privateKey);
      auditIssuerIdentitySha256 = createHash('sha256').update(createPublicKey(signingKey).export({ type: 'spki', format: 'der' })).digest('hex');
    } catch { errors.push('verified audit private key is invalid'); }
  }
  const uniqueErrors = [...new Set(errors)];
  const ready = legacy.status === 'ready_for_final_review' && engineering.success && motion.success && cable.success && safety.success && binding.success && physical.physicalValidationReady && uniqueErrors.length === 0 && signingKey !== null;
  const evidenceHashes = { legacyTarget: legacy.releaseTargetHash, postIntegration: digest(files.postIntegration), engineeringCoverage: digest(files.engineeringCoverage), motionCoverage: digest(files.motionCoverage), cableLife: digest(files.cableLife), safetyElectrical: digest(files.safetyElectrical), physicalReceipt: digest(files.physicalReceipt), systemBinding: digest(files.systemBinding) };
  const unsigned: Omit<RobotVerifiedSystemsReleaseAuditReport, 'signature'> = {
    schema: 'nexyfab.robot-verified-systems-release-audit.v2',
    status: ready ? 'ready_for_final_review' : 'not_ready',
    releaseTargetHash: ready ? digest(new TextEncoder().encode(canonical(evidenceHashes))) : null,
    legacyCadManufacturingTargetHash: legacy.releaseTargetHash,
    frozenRequirementsSha256: engineering.success ? engineering.data.frozenRequirementsSha256 : null,
    physicalValidationReceiptSha256: digest(files.physicalReceipt),
    exactCadEvidenceValid: legacy.exactCadEvidenceValid,
    manufacturingEvidenceValid: legacy.manufacturingEvidenceValid,
    engineeringCoverageValid: engineering.success,
    motionCoverageValid: motion.success,
    cableLifeValid: cable.success,
    safetyElectricalDesignValid: safety.success,
    physicalValidationValid: physical.physicalValidationReady,
    errors: uniqueErrors,
    blockers: ready ? ['final_release_dual_signoff_required'] : [...(!legacy.exactCadEvidenceValid ? ['nexyfab_exact_cad_evidence_required'] : []), ...(!legacy.manufacturingEvidenceValid ? ['manufacturing_validation_required'] : []), ...(!engineering.success ? ['engineering_coverage_required'] : []), ...(!motion.success ? ['motion_coverage_required'] : []), ...(!cable.success ? ['cable_life_required'] : []), ...(!safety.success ? ['safety_electrical_design_required'] : []), ...(!physical.physicalValidationReady ? ['physical_validation_required'] : []), ...(!signingKey ? ['verified_audit_attestation_required'] : []), 'final_release_dual_signoff_required'],
    auditIssuerId,
    auditIssuerIdentitySha256,
    issuedAt,
    releaseReady: false,
    releaseExecuted: false,
    sideEffects: { persisted: false, cadModified: false, releasePublished: false, quoteCreated: false, rfqSent: false },
  };
  return { ...unsigned, signature: ready && signingKey ? sign(null, Buffer.from(robotVerifiedSystemsAuditPayload(unsigned)), signingKey).toString('base64') : null };
}

export function robotVerifiedSystemsAuditPayload(report: Omit<RobotVerifiedSystemsReleaseAuditReport, 'signature'>): string {
  return canonical(report);
}

export function verifyRobotVerifiedSystemsAuditAttestation(
  report: RobotVerifiedSystemsReleaseAuditReport,
  trusted: TrustedRobotVerifiedSystemsAuditKeys,
  now = Date.now(),
): string[] {
  const errors: string[] = [];
  if (report.schema !== 'nexyfab.robot-verified-systems-release-audit.v2') errors.push('verified_audit_schema_invalid');
  if (!report.auditIssuerId || !report.auditIssuerIdentitySha256 || !report.issuedAt || !report.signature) errors.push('verified_audit_attestation_missing');
  if (report.issuedAt && (!ISO_TIME.test(report.issuedAt) || !Number.isFinite(Date.parse(report.issuedAt)) || Date.parse(report.issuedAt) > now + 300_000)) errors.push('verified_audit_time_invalid');
  const registration = report.auditIssuerId ? trusted[report.auditIssuerId] : undefined;
  if (!registration) errors.push('verified_audit_issuer_untrusted');
  try {
    if (registration && report.auditIssuerIdentitySha256 !== createHash('sha256').update(createPublicKey(registration.publicKey).export({ type: 'spki', format: 'der' })).digest('hex')) errors.push('verified_audit_issuer_identity_mismatch');
    const { signature, ...unsigned } = report;
    if (!registration || !signature || !verify(null, Buffer.from(robotVerifiedSystemsAuditPayload(unsigned)), registration.publicKey, Buffer.from(signature, 'base64'))) errors.push('verified_audit_signature_invalid');
  } catch { errors.push('verified_audit_signature_invalid'); }
  return [...new Set(errors)];
}

export function parseTrustedRobotVerifiedSystemsAuditKeys(raw = process.env.NEXYFAB_ROBOT_VERIFIED_AUDITOR_KEYS): TrustedRobotVerifiedSystemsAuditKeys {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(value).flatMap(([id, item]) => item && typeof item === 'object' && typeof (item as { publicKey?: unknown }).publicKey === 'string' ? [[id, { publicKey: (item as { publicKey: string }).publicKey }]] : []));
  } catch { return {}; }
}

export function parseRobotVerifiedSystemsAuditSigner(raw = process.env.NEXYFAB_ROBOT_VERIFIED_AUDIT_SIGNER): RobotVerifiedSystemsAuditSigner | undefined {
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    return typeof value.auditorId === 'string' && typeof value.privateKey === 'string' ? { auditorId: value.auditorId, privateKey: value.privateKey } : undefined;
  } catch { return undefined; }
}

function decode(bytes: Uint8Array, label: string, errors: string[]) { try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { errors.push(`${label} must be valid UTF-8 JSON`); return null; } }
function digest(bytes: Uint8Array) { return createHash('sha256').update(bytes).digest('hex'); }
function canonical(value: unknown): string { if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`; if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`; return JSON.stringify(value); }
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
