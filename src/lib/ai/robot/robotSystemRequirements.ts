import { createHash } from 'node:crypto';
import { z } from 'zod';

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const idSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const textSchema = z.string().trim().min(1).max(2_000);
const finite = z.number().finite();
const positive = finite.positive();
const nonnegative = finite.nonnegative();
const vectorSchema = z.object({ x: finite, y: finite, z: finite }).strict();
const authoritySchema = z.object({
  sourceArtifactSha256: sha256Schema,
  approvedBy: idSchema,
  approvedAt: z.string().datetime({ offset: true }),
}).strict();
const orientationSchema = z.object({ x: finite, y: finite, z: finite, w: finite }).strict();
const transformSchema = z.object({ positionMm: vectorSchema, orientation: orientationSchema }).strict();
const inertiaSchema = z.object({
  ixx: nonnegative,
  iyy: nonnegative,
  izz: nonnegative,
  ixy: finite,
  ixz: finite,
  iyz: finite,
}).strict();

const payloadCaseSchema = z.object({
  id: idSchema,
  kind: z.enum(['zero', 'rated', 'eccentric', 'custom']),
  massKg: nonnegative,
  centerOfMassMm: vectorSchema,
  inertiaKgM2: inertiaSchema,
  externalWrench: z.object({ forceN: vectorSchema, torqueNm: vectorSchema }).strict(),
  authority: authoritySchema,
}).strict();

const jointRangeSchema = z.object({
  joint: z.number().int().min(1).max(6),
  minDeg: finite,
  maxDeg: finite,
}).strict();

const jointMotionLimitSchema = z.object({
  joint: z.number().int().min(1).max(6),
  maxVelocityDegS: positive,
  maxAccelerationDegS2: positive,
  maxJerkDegS3: positive,
  authority: authoritySchema,
}).strict();

const governedArtifactSchema = z.object({
  id: idSchema,
  description: textSchema,
  artifactSha256: sha256Schema,
}).strict();

const hazardSchema = z.object({
  id: idSchema,
  description: textSchema,
  lifecyclePhases: z.array(z.enum(['transport', 'assembly', 'commissioning', 'operation', 'cleaning', 'maintenance', 'decommissioning'])).min(1).max(7),
  sourceArtifactSha256: sha256Schema,
}).strict();

const safetyFunctionSchema = z.object({
  id: idSchema,
  hazardIds: z.array(idSchema).min(1).max(32),
  trigger: textSchema,
  safeState: textSchema,
  resetCondition: textSchema,
  requiredPerformanceTarget: textSchema,
  authority: authoritySchema,
}).strict();

const manufacturingAuthoritySchema = z.object({
  subject: z.enum(['materials', 'processes', 'tolerances', 'inspection']),
  sourceArtifactSha256: sha256Schema,
  approvedBy: idSchema,
  approvedAt: z.string().datetime({ offset: true }),
}).strict();

export const robotSystemRequirementsV2Schema = z.object({
  schema: z.literal('nexyfab.robot-system-requirements.v2'),
  identity: z.object({
    productId: idSchema,
    lineageId: idSchema,
    revision: z.number().int().positive(),
    intendedUse: textSchema,
    frozen: z.literal(true),
  }).strict(),
  mechanics: z.object({
    axes: z.literal(6),
    reachMm: positive,
    jointRanges: z.array(jointRangeSchema).length(6),
    installationPose: z.object({
      kind: z.enum(['floor', 'wall', 'ceiling', 'inclined', 'custom']),
      baseTransform: transformSchema,
      authority: authoritySchema,
    }).strict(),
    payloadCases: z.array(payloadCaseSchema).min(3).max(32),
  }).strict(),
  performance: z.object({
    tcpAccuracyMm: positive,
    tcpRepeatabilityMm: positive,
    cycleTimeS: positive,
    dutyCycleRatio: positive.max(1),
    serviceLifeCycles: z.number().int().positive().safe(),
    authority: authoritySchema,
  }).strict(),
  motion: z.object({
    jointLimits: z.array(jointMotionLimitSchema).length(6),
    governedPaths: z.array(governedArtifactSchema).min(1).max(128),
    forbiddenZones: z.array(governedArtifactSchema).max(128),
  }).strict(),
  environment: z.object({
    minimumTemperatureC: finite,
    maximumTemperatureC: finite,
    maximumRelativeHumidityPct: positive.max(100),
    contaminationClass: textSchema,
    ipTarget: z.string().regex(/^IP[0-6][0-9]$/),
    expectedLifeCycles: z.number().int().positive().safe(),
    authority: authoritySchema,
  }).strict(),
  power: z.object({
    supply: z.object({
      kind: z.enum(['ac_single_phase', 'ac_three_phase', 'dc']),
      nominalVoltageV: positive,
      phases: z.union([z.literal(1), z.literal(3)]),
      frequencyHz: nonnegative,
    }).strict(),
    peakPowerW: positive,
    rmsPowerW: positive,
    regenerative: z.object({ enabled: z.boolean(), maximumReturnPowerW: nonnegative }).strict(),
    brake: z.object({ supplyVoltageV: positive, deenergizedHoldingRequired: z.boolean() }).strict(),
    authority: authoritySchema,
  }).strict(),
  safety: z.object({
    personsPresentInApplication: z.boolean(),
    cellBoundary: governedArtifactSchema,
    foreseeableMisuse: z.array(textSchema).min(1).max(64),
    hazards: z.array(hazardSchema).min(1).max(256),
    safetyFunctions: z.array(safetyFunctionSchema).min(1).max(128),
    authority: authoritySchema,
  }).strict(),
  manufacturing: z.object({
    authorities: z.array(manufacturingAuthoritySchema).length(4),
  }).strict(),
  authority: authoritySchema,
}).strict();

export type RobotSystemRequirementsV2 = z.infer<typeof robotSystemRequirementsV2Schema>;

export type RobotSystemRequirementsVerification = {
  schema: 'nexyfab.robot-system-requirements-verification.v1';
  requirementsSha256: string;
  frozenRequirementsSha256: string | null;
  productId: string | null;
  lineageId: string | null;
  revision: number | null;
  requirementsReady: boolean;
  status: 'passed' | 'failed';
  counts: { joints: number; payloadCases: number; governedPaths: number; hazards: number; safetyFunctions: number; manufacturingAuthorities: number };
  errors: string[];
  releaseReady: false;
  sideEffects: { persisted: false; cadModified: false; quoteCreated: false; rfqSent: false };
};

export function verifyRobotSystemRequirementsBytes(bytes: Uint8Array): RobotSystemRequirementsVerification {
  const errors: string[] = [];
  let raw: unknown = null;
  try {
    raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    errors.push('requirements must be valid UTF-8 JSON');
  }

  const parsed = robotSystemRequirementsV2Schema.safeParse(raw);
  if (!parsed.success) errors.push(...parsed.error.issues.map(issue => `requirements.${issue.path.join('.') || '$'}: ${issue.message}`));
  if (parsed.success) errors.push(...crossFieldErrors(parsed.data));

  const requirementsReady = parsed.success && errors.length === 0;
  const value = parsed.success ? parsed.data : null;
  return {
    schema: 'nexyfab.robot-system-requirements-verification.v1',
    requirementsSha256: digest(bytes),
    frozenRequirementsSha256: requirementsReady ? digest(new TextEncoder().encode(canonical(value))) : null,
    productId: value?.identity.productId ?? null,
    lineageId: value?.identity.lineageId ?? null,
    revision: value?.identity.revision ?? null,
    requirementsReady,
    status: requirementsReady ? 'passed' : 'failed',
    counts: {
      joints: value?.mechanics.jointRanges.length ?? 0,
      payloadCases: value?.mechanics.payloadCases.length ?? 0,
      governedPaths: value?.motion.governedPaths.length ?? 0,
      hazards: value?.safety.hazards.length ?? 0,
      safetyFunctions: value?.safety.safetyFunctions.length ?? 0,
      manufacturingAuthorities: value?.manufacturing.authorities.length ?? 0,
    },
    errors: [...new Set(errors)],
    releaseReady: false,
    sideEffects: { persisted: false, cadModified: false, quoteCreated: false, rfqSent: false },
  };
}

function crossFieldErrors(value: RobotSystemRequirementsV2): string[] {
  const errors: string[] = [];
  validateGovernedJoints(value.mechanics.jointRanges, 'mechanics.jointRanges', errors);
  validateGovernedJoints(value.motion.jointLimits, 'motion.jointLimits', errors);

  for (const range of value.mechanics.jointRanges) {
    if (!(range.minDeg < range.maxDeg)) errors.push(`J${range.joint}: minimum joint angle must be below maximum joint angle`);
    if (range.minDeg > 0 || range.maxDeg < 0) errors.push(`J${range.joint}: zero must lie inside the governed joint range`);
  }

  uniqueIds(value.mechanics.payloadCases, 'payload case', errors);
  const kinds = new Map(value.mechanics.payloadCases.map(item => [item.kind, item]));
  for (const required of ['zero', 'rated', 'eccentric'] as const) if (!kinds.has(required)) errors.push(`payload case ${required} is required`);
  const zero = kinds.get('zero');
  if (zero && (zero.massKg !== 0 || vectorMagnitude(zero.centerOfMassMm) !== 0 || inertiaMagnitude(zero.inertiaKgM2) !== 0)) errors.push('zero payload case must have zero mass, center of mass and inertia');
  const rated = kinds.get('rated');
  if (rated && rated.massKg <= 0) errors.push('rated payload case must have positive mass');
  const eccentric = kinds.get('eccentric');
  if (eccentric && (eccentric.massKg <= 0 || vectorMagnitude(eccentric.centerOfMassMm) <= 0)) errors.push('eccentric payload case must have positive mass and non-zero center-of-mass offset');
  for (const payload of value.mechanics.payloadCases) if (payload.massKg > 0 && !isPhysicalInertia(payload.inertiaKgM2)) errors.push(`${payload.id}: inertia tensor is not physically admissible`);

  const q = value.mechanics.installationPose.baseTransform.orientation;
  if (Math.abs(Math.hypot(q.x, q.y, q.z, q.w) - 1) > 1e-6) errors.push('installation base orientation must be a normalized quaternion');
  if (value.performance.tcpRepeatabilityMm > value.performance.tcpAccuracyMm) errors.push('TCP repeatability requirement must not be looser than TCP accuracy requirement');
  if (!(value.environment.minimumTemperatureC < value.environment.maximumTemperatureC)) errors.push('minimum environment temperature must be below maximum temperature');
  if (value.environment.expectedLifeCycles !== value.performance.serviceLifeCycles) errors.push('environment expected life cycles must equal the frozen performance service life cycles');
  if (value.power.peakPowerW < value.power.rmsPowerW) errors.push('peak power must be greater than or equal to RMS power');
  if (value.power.regenerative.enabled !== (value.power.regenerative.maximumReturnPowerW > 0)) errors.push('regenerative enabled state must agree with maximum return power');
  if (value.power.supply.kind === 'ac_three_phase' && value.power.supply.phases !== 3) errors.push('three-phase AC supply must declare three phases');
  if (value.power.supply.kind !== 'ac_three_phase' && value.power.supply.phases !== 1) errors.push('single-phase AC and DC supplies must declare one phase');
  if (value.power.supply.kind === 'dc' && value.power.supply.frequencyHz !== 0) errors.push('DC supply frequency must be zero');
  if (value.power.supply.kind !== 'dc' && value.power.supply.frequencyHz <= 0) errors.push('AC supply frequency must be positive');

  uniqueIds(value.motion.governedPaths, 'governed path', errors);
  uniqueIds(value.motion.forbiddenZones, 'forbidden zone', errors);
  uniqueStrings(value.safety.foreseeableMisuse, 'foreseeable misuse', errors);
  uniqueIds(value.safety.hazards, 'hazard', errors);
  uniqueIds(value.safety.safetyFunctions, 'safety function', errors);
  const hazardIds = new Set(value.safety.hazards.map(item => item.id));
  for (const fn of value.safety.safetyFunctions) {
    const refs = new Set(fn.hazardIds);
    if (refs.size !== fn.hazardIds.length) errors.push(`${fn.id}: duplicate hazard references are not allowed`);
    for (const hazardId of refs) if (!hazardIds.has(hazardId)) errors.push(`${fn.id}: unknown hazard ${hazardId}`);
  }
  const coveredHazards = new Set(value.safety.safetyFunctions.flatMap(item => item.hazardIds));
  for (const hazardId of hazardIds) if (!coveredHazards.has(hazardId)) errors.push(`${hazardId}: every hazard must be linked to at least one safety function`);

  const subjects = value.manufacturing.authorities.map(item => item.subject);
  if (new Set(subjects).size !== 4 || ['materials', 'processes', 'tolerances', 'inspection'].some(subject => !subjects.includes(subject as typeof subjects[number]))) errors.push('manufacturing authorities must contain materials, processes, tolerances and inspection exactly once');
  return errors;
}

function validateGovernedJoints(items: readonly { joint: number }[], label: string, errors: string[]) {
  const joints = items.map(item => item.joint).sort((a, b) => a - b);
  if (new Set(joints).size !== 6 || joints.some((joint, index) => joint !== index + 1)) errors.push(`${label} must contain each governed joint J1..J6 exactly once`);
}

function uniqueIds(items: readonly { id: string }[], label: string, errors: string[]) {
  if (new Set(items.map(item => item.id)).size !== items.length) errors.push(`${label} ids must be unique`);
}

function uniqueStrings(items: readonly string[], label: string, errors: string[]) {
  const normalized = items.map(item => item.trim().toLocaleLowerCase('en-US'));
  if (new Set(normalized).size !== items.length) errors.push(`${label} entries must be unique`);
}

function vectorMagnitude(value: { x: number; y: number; z: number }) { return Math.hypot(value.x, value.y, value.z); }
function inertiaMagnitude(value: z.infer<typeof inertiaSchema>) { return Math.max(...Object.values(value).map(Math.abs)); }
function isPhysicalInertia(value: z.infer<typeof inertiaSchema>): boolean {
  const scale = Math.max(1, value.ixx, value.iyy, value.izz);
  const tolerance = scale * scale * scale * 1e-10;
  const minorXY = value.ixx * value.iyy - value.ixy * value.ixy;
  const minorXZ = value.ixx * value.izz - value.ixz * value.ixz;
  const minorYZ = value.iyy * value.izz - value.iyz * value.iyz;
  const determinant = value.ixx * value.iyy * value.izz + 2 * value.ixy * value.ixz * value.iyz
    - value.ixx * value.iyz * value.iyz - value.iyy * value.ixz * value.ixz - value.izz * value.ixy * value.ixy;
  return value.ixx > 0 && value.iyy > 0 && value.izz > 0
    && minorXY >= -tolerance && minorXZ >= -tolerance && minorYZ >= -tolerance && determinant >= -tolerance
    && value.ixx <= value.iyy + value.izz + tolerance
    && value.iyy <= value.ixx + value.izz + tolerance
    && value.izz <= value.ixx + value.iyy + tolerance;
}

function digest(bytes: Uint8Array) { return createHash('sha256').update(bytes).digest('hex'); }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
