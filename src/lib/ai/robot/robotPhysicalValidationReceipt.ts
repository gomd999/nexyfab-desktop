import { createHash, createPublicKey, verify } from 'node:crypto';
import { z } from 'zod';

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const filename = z.string().min(1).max(256).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const text = z.string().trim().min(1).max(2_000);
const finite = z.number().finite();
const stage = z.enum(['joint_rig', 'wrist_assembly', 'six_axis_prototype', 'endurance_teardown']);
const signerRole = z.enum(['test-operator', 'independent-reviewer']);
const artifactKind = z.enum(['as_built_bom', 'raw_data', 'calibration', 'inspection']);

const engineeringCoverageSchema = z.object({ schema: z.literal('nexyfab.robot-engineering-coverage-report.v1'), coverageHash: sha, frozenRequirementsSha256: sha, status: z.literal('passed'), coverageReady: z.literal(true), fullRequirementsCoverageComplete: z.literal(true), entries: z.array(z.object({ applicationHash: sha, status: z.literal('passed') }).passthrough()).min(1), errors: z.array(z.string()).length(0) }).passthrough();
const motionCoverageSchema = z.object({ schema: z.literal('nexyfab.robot-motion-coverage-report.v1'), coverageHash: sha, frozenRequirementsSha256: sha, status: z.literal('passed'), motionCoverageReady: z.literal(true), errors: z.array(z.string()).length(0) }).passthrough();
const cableLifeSchema = z.object({ schema: z.literal('nexyfab.robot-cable-life-sweep-report.v1'), cableInputSha256: sha, frozenRequirementsSha256: sha, motionCoverageHash: sha, status: z.literal('passed'), cableLifeReady: z.literal(true), errors: z.array(z.string()).length(0) }).passthrough();
const safetySchema = z.object({ schema: z.literal('nexyfab.robot-safety-electrical-design-report.v1'), inputSha256: sha, frozenRequirementsSha256: sha, status: z.literal('passed'), designSupportReady: z.literal(true), certificationClaimed: z.literal(false), errors: z.array(z.string()).length(0) }).passthrough();

const measurementSchema = z.object({
  subject: id,
  value: finite,
  unit: z.string().trim().min(1).max(64),
  uncertainty: finite.nonnegative(),
  acceptance: z.object({ operator: z.enum(['lte', 'gte', 'equals']), limit: finite, tolerance: finite.nonnegative() }).strict(),
  passed: z.literal(true),
  rawDataArtifactName: filename,
  rawDataArtifactSha256: sha,
}).strict();

export const robotPhysicalValidationReceiptSchema = z.object({
  schema: z.literal('nexyfab.robot-physical-validation-receipt.v1'),
  frozenRequirementsSha256: sha,
  engineeringCoverageReportSha256: sha,
  engineeringCoverageHash: sha,
  motionCoverageReportSha256: sha,
  motionCoverageHash: sha,
  cableLifeReportSha256: sha,
  cableInputSha256: sha,
  safetyElectricalReportSha256: sha,
  safetyElectricalInputSha256: sha,
  specimen: z.object({ serialNumber: id, buildRevision: z.number().int().positive(), asBuiltBomArtifactName: filename, asBuiltBomSha256: sha }).strict(),
  applicationHashes: z.array(sha).min(1).max(256),
  artifacts: z.array(z.object({ name: filename, sha256: sha, kind: artifactKind }).strict()).min(1).max(512),
  stages: z.array(z.object({
    stage,
    startedAt: z.string().datetime({ offset: true }),
    completedAt: z.string().datetime({ offset: true }),
    environment: z.object({ temperatureC: finite, relativeHumidityPct: finite.min(0).max(100), location: text }).strict(),
    calibration: z.array(z.object({ equipmentId: id, artifactName: filename, artifactSha256: sha, validThrough: z.string().datetime({ offset: true }) }).strict()).min(1).max(64),
    measurements: z.array(measurementSchema).min(1).max(128),
  }).strict()).length(4),
  generatedAt: z.string().datetime({ offset: true }),
  signatures: z.array(z.object({ signerId: id, role: signerRole, signerIdentitySha256: sha, signedAt: z.string().datetime({ offset: true }), signature: z.string().min(1) }).strict()).length(2),
}).strict();

export type RobotPhysicalValidationReceipt = z.infer<typeof robotPhysicalValidationReceiptSchema>;
export type TrustedRobotPhysicalValidationKeys = Record<string, { publicKey: string; roles: Array<z.infer<typeof signerRole>> }>;
export type RobotPhysicalValidationReport = {
  schema: 'nexyfab.robot-physical-validation-report.v1';
  receiptSha256: string;
  frozenRequirementsSha256: string | null;
  specimenSerialNumber: string | null;
  status: 'passed' | 'failed';
  physicalValidationReady: boolean;
  artifactBytesVerified: boolean;
  measurementAcceptanceVerified: boolean;
  dualSignatureVerified: boolean;
  counts: { artifacts: number; stages: number; measurements: number; applicationHashes: number; signatures: number };
  errors: string[];
  finalReleaseReviewRequired: true;
  releaseReady: false;
  sideEffects: { persisted: false; cadModified: false; quoteCreated: false; rfqSent: false };
};

const REQUIRED_MEASUREMENTS: Record<z.infer<typeof stage>, readonly string[]> = {
  joint_rig: ['rated_torque', 'peak_torque', 'brake_hold', 'backlash', 'encoder_repeatability', 'bearing_temperature', 'motor_temperature', 'reducer_temperature', 'current'],
  wrist_assembly: ['cable_twist', 'connector_load', 'near_contact_clearance', 'thermal_coupling'],
  six_axis_prototype: ['tcp_accuracy', 'tcp_repeatability', 'cycle_time', 'temperature', 'vibration', 'current_power', 'cable_motion', 'safety_fault_validation'],
  endurance_teardown: ['cycle_count', 'wear', 'fastener_loosening', 'cable_damage', 'lubrication', 'seals'],
};

export function parseTrustedRobotPhysicalValidationKeys(raw: string | undefined): TrustedRobotPhysicalValidationKeys {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).flatMap(([signerId, entry]) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
      const candidate = entry as { publicKey?: unknown; roles?: unknown };
      const roles = z.array(signerRole).min(1).safeParse(candidate.roles);
      if (!signerId.trim() || typeof candidate.publicKey !== 'string' || !roles.success || !fingerprint(candidate.publicKey)) return [];
      return [[signerId, { publicKey: createPublicKey(candidate.publicKey).export({ type: 'spki', format: 'pem' }).toString(), roles: [...new Set(roles.data)] }]];
    }));
  } catch { return {}; }
}

export const robotPhysicalValidationReceiptPayload = (value: Omit<RobotPhysicalValidationReceipt, 'signatures'>) => canonical(value);

export function verifyRobotPhysicalValidationReceipt(
  upstream: { engineeringCoverage: Uint8Array; motionCoverage: Uint8Array; cableLife: Uint8Array; safetyElectrical: Uint8Array },
  receiptBytes: Uint8Array,
  artifacts: ReadonlyMap<string, Uint8Array>,
  trustedKeys: TrustedRobotPhysicalValidationKeys,
): RobotPhysicalValidationReport {
  const errors: string[] = [];
  const engineering = engineeringCoverageSchema.safeParse(decode(upstream.engineeringCoverage, 'engineering coverage report', errors));
  const motion = motionCoverageSchema.safeParse(decode(upstream.motionCoverage, 'motion coverage report', errors));
  const cable = cableLifeSchema.safeParse(decode(upstream.cableLife, 'cable life report', errors));
  const safety = safetySchema.safeParse(decode(upstream.safetyElectrical, 'safety and electrical report', errors));
  const receiptParsed = robotPhysicalValidationReceiptSchema.safeParse(decode(receiptBytes, 'physical validation receipt', errors));
  for (const [label, parsed] of [['engineering', engineering], ['motion', motion], ['cable', cable], ['safety', safety], ['receipt', receiptParsed]] as const) if (!parsed.success) errors.push(...parsed.error.issues.map(issue => `${label}.${issue.path.join('.') || '$'}: ${issue.message}`));
  const receipt = receiptParsed.success ? receiptParsed.data : null;
  let artifactBytesVerified = false, measurementAcceptanceVerified = false, dualSignatureVerified = false;
  if (engineering.success && motion.success && cable.success && safety.success && receipt) {
    const frozen = receipt.frozenRequirementsSha256;
    if ([engineering.data.frozenRequirementsSha256, motion.data.frozenRequirementsSha256, cable.data.frozenRequirementsSha256, safety.data.frozenRequirementsSha256].some(value => value !== frozen)) errors.push('upstream reports and receipt do not share one frozen requirement hash');
    const bindings: Array<[string, string, string]> = [
      ['engineering coverage report', digest(upstream.engineeringCoverage), receipt.engineeringCoverageReportSha256],
      ['engineering coverage hash', engineering.data.coverageHash, receipt.engineeringCoverageHash],
      ['motion coverage report', digest(upstream.motionCoverage), receipt.motionCoverageReportSha256],
      ['motion coverage hash', motion.data.coverageHash, receipt.motionCoverageHash],
      ['cable life report', digest(upstream.cableLife), receipt.cableLifeReportSha256],
      ['cable input hash', cable.data.cableInputSha256, receipt.cableInputSha256],
      ['safety report', digest(upstream.safetyElectrical), receipt.safetyElectricalReportSha256],
      ['safety input hash', safety.data.inputSha256, receipt.safetyElectricalInputSha256],
    ];
    for (const [label, actual, declared] of bindings) if (actual !== declared) errors.push(`${label} binding mismatch`);
    const expectedApplications = engineering.data.entries.map(item => item.applicationHash).sort();
    if (new Set(receipt.applicationHashes).size !== receipt.applicationHashes.length || canonical([...receipt.applicationHashes].sort()) !== canonical(expectedApplications)) errors.push('receipt application hashes must cover engineering coverage exactly once');
    validateStages(receipt, errors);
    artifactBytesVerified = validateArtifacts(receipt, artifacts, errors);
    measurementAcceptanceVerified = validateMeasurements(receipt, errors);
    dualSignatureVerified = validateSignatures(receipt, trustedKeys, errors);
  }
  const uniqueErrors = [...new Set(errors)];
  const physicalValidationReady = Boolean(receipt && engineering.success && motion.success && cable.success && safety.success && artifactBytesVerified && measurementAcceptanceVerified && dualSignatureVerified && uniqueErrors.length === 0);
  return {
    schema: 'nexyfab.robot-physical-validation-report.v1',
    receiptSha256: digest(receiptBytes),
    frozenRequirementsSha256: receipt?.frozenRequirementsSha256 ?? null,
    specimenSerialNumber: receipt?.specimen.serialNumber ?? null,
    status: physicalValidationReady ? 'passed' : 'failed',
    physicalValidationReady,
    artifactBytesVerified,
    measurementAcceptanceVerified,
    dualSignatureVerified,
    counts: { artifacts: receipt?.artifacts.length ?? 0, stages: receipt?.stages.length ?? 0, measurements: receipt?.stages.reduce((sum, item) => sum + item.measurements.length, 0) ?? 0, applicationHashes: receipt?.applicationHashes.length ?? 0, signatures: receipt?.signatures.length ?? 0 },
    errors: uniqueErrors,
    finalReleaseReviewRequired: true,
    releaseReady: false,
    sideEffects: noSideEffects(),
  };
}

function validateStages(receipt: RobotPhysicalValidationReceipt, errors: string[]) {
  exactSet(receipt.stages.map(item => item.stage), stage.options, 'physical validation stages', errors);
  const generatedAt = Date.parse(receipt.generatedAt);
  for (const item of receipt.stages) {
    const started = Date.parse(item.startedAt), completed = Date.parse(item.completedAt);
    if (!(started < completed && completed <= generatedAt)) errors.push(`${item.stage}: stage time ordering is invalid`);
    exactSet(item.measurements.map(measurement => measurement.subject), REQUIRED_MEASUREMENTS[item.stage], `${item.stage} measurements`, errors);
    for (const calibration of item.calibration) if (Date.parse(calibration.validThrough) < completed) errors.push(`${item.stage}: calibration ${calibration.equipmentId} expired before stage completion`);
  }
}

function validateArtifacts(receipt: RobotPhysicalValidationReceipt, artifacts: ReadonlyMap<string, Uint8Array>, errors: string[]) {
  const names = receipt.artifacts.map(item => item.name);
  if (new Set(names).size !== names.length) errors.push('receipt artifact names must be unique');
  for (const declared of receipt.artifacts) {
    const bytes = artifacts.get(declared.name);
    if (!bytes) errors.push(`artifact ${declared.name} is missing`);
    else if (digest(bytes) !== declared.sha256) errors.push(`artifact ${declared.name} bytes do not match SHA-256`);
  }
  for (const name of artifacts.keys()) if (!names.includes(name)) errors.push(`undeclared artifact ${name} was supplied`);
  const bom = receipt.artifacts.find(item => item.name === receipt.specimen.asBuiltBomArtifactName && item.kind === 'as_built_bom');
  if (!bom || bom.sha256 !== receipt.specimen.asBuiltBomSha256) errors.push('as-built BOM binding is invalid');
  for (const item of receipt.stages) {
    for (const calibration of item.calibration) {
      const declared = receipt.artifacts.find(artifact => artifact.name === calibration.artifactName && artifact.kind === 'calibration');
      if (!declared || declared.sha256 !== calibration.artifactSha256) errors.push(`${item.stage}: calibration artifact binding is invalid`);
    }
    for (const measurement of item.measurements) {
      const declared = receipt.artifacts.find(artifact => artifact.name === measurement.rawDataArtifactName && artifact.kind === 'raw_data');
      if (!declared || declared.sha256 !== measurement.rawDataArtifactSha256) errors.push(`${item.stage}/${measurement.subject}: raw-data artifact binding is invalid`);
    }
  }
  return errors.length === 0;
}

function validateMeasurements(receipt: RobotPhysicalValidationReceipt, errors: string[]) {
  for (const item of receipt.stages) for (const measurement of item.measurements) {
    const { operator, limit, tolerance } = measurement.acceptance;
    const passed = operator === 'lte' ? measurement.value + measurement.uncertainty <= limit + tolerance : operator === 'gte' ? measurement.value - measurement.uncertainty >= limit - tolerance : Math.abs(measurement.value - limit) + measurement.uncertainty <= tolerance;
    if (!passed) errors.push(`${item.stage}/${measurement.subject}: recomputed acceptance failed`);
  }
  return !errors.some(error => error.includes('recomputed acceptance failed'));
}

function validateSignatures(receipt: RobotPhysicalValidationReceipt, trusted: TrustedRobotPhysicalValidationKeys, errors: string[]) {
  exactSet(receipt.signatures.map(item => item.role), signerRole.options, 'physical validation signatures', errors);
  if (new Set(receipt.signatures.map(item => item.signerId)).size !== receipt.signatures.length) errors.push('operator and independent reviewer must be different people');
  if (new Set(receipt.signatures.map(item => item.signerIdentitySha256)).size !== receipt.signatures.length) errors.push('operator and independent reviewer must use different keys');
  const { signatures: _signatures, ...unsigned } = receipt;
  const payload = robotPhysicalValidationReceiptPayload(unsigned);
  for (const signature of receipt.signatures) {
    const registration = trusted[signature.signerId];
    if (!registration || !registration.roles.includes(signature.role) || fingerprint(registration.publicKey) !== signature.signerIdentitySha256) errors.push(`${signature.role}: signer is not trusted for the role`);
    else if (!verifySignature(payload, signature.signature, registration.publicKey)) errors.push(`${signature.role}: signature is invalid`);
    if (Date.parse(signature.signedAt) < Date.parse(receipt.generatedAt)) errors.push(`${signature.role}: signature predates receipt generation`);
  }
  return !errors.some(error => error.includes('signer') || error.includes('signature'));
}

function exactSet(actual: readonly string[], expected: readonly string[], label: string, errors: string[]) { if (new Set(actual).size !== actual.length || canonical([...actual].sort()) !== canonical([...expected].sort())) errors.push(`${label} must cover the governed set exactly once`); }
function decode(bytes: Uint8Array, label: string, errors: string[]) { try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { errors.push(`${label} must be valid UTF-8 JSON`); return null; } }
function digest(bytes: Uint8Array) { return createHash('sha256').update(bytes).digest('hex'); }
function canonical(value: unknown): string { if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`; if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`; return JSON.stringify(value); }
function fingerprint(key: string) { try { return createHash('sha256').update(createPublicKey(key).export({ type: 'spki', format: 'der' })).digest('hex'); } catch { return null; } }
function verifySignature(payload: string, signature: string, key: string) { try { return verify(null, Buffer.from(payload), key, Buffer.from(signature, 'base64')); } catch { return false; } }
function noSideEffects() { return { persisted: false as const, cadModified: false as const, quoteCreated: false as const, rfqSent: false as const }; }
