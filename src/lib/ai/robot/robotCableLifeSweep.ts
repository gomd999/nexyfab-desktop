import { createHash } from 'node:crypto';
import { z } from 'zod';
import { robotSystemRequirementsV2Schema, verifyRobotSystemRequirementsBytes } from './robotSystemRequirements';

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const finite = z.number().finite();
const positive = finite.positive();
const nonnegative = finite.nonnegative();
const vector = z.object({ x: finite, y: finite, z: finite }).strict();

const motionReportSchema = z.object({
  schema: z.literal('nexyfab.robot-motion-coverage-report.v1'),
  frozenRequirementsSha256: sha,
  status: z.literal('passed'),
  motionCoverageReady: z.literal(true),
  fullPayloadPathCoverageComplete: z.literal(true),
  continuousCollisionCoverageComplete: z.literal(true),
  workspaceCoverageComplete: z.literal(true),
  coverageHash: sha,
  combinations: z.array(z.object({ id, status: z.literal('passed'), frameCount: z.number().int().min(2), segmentCount: z.number().int().positive() }).passthrough()).min(1).max(256),
  errors: z.array(z.string()).length(0),
}).passthrough();

export const robotCableLifeSweepInputSchema = z.object({
  schema: z.literal('nexyfab.robot-cable-life-sweep-input.v1'),
  requirementsFileSha256: sha,
  frozenRequirementsSha256: sha,
  motionCoverageReportSha256: sha,
  requiredServiceLifeCycles: z.number().int().positive().safe(),
  cables: z.array(z.object({
    id,
    minimumAllowedBendRadiusMm: positive,
    maximumTwistDegPerM: positive,
    maximumConnectorDisplacementMm: nonnegative,
    minimumClearanceMm: nonnegative,
    minimumServiceLoopReserveMm: nonnegative,
    lifeSafetyFactor: z.number().min(1).finite(),
    bendLifeCurve: z.array(z.object({ bendRadiusMm: positive, allowableCycles: z.number().int().positive().safe() }).strict()).min(2).max(64),
    specificationArtifactSha256: sha,
    lifeCurveArtifactSha256: sha,
  }).strict()).min(1).max(128),
  combinations: z.array(z.object({
    motionCombinationId: id,
    usageFraction: positive.max(1),
    cableStates: z.array(z.object({
      cableId: id,
      routePointsMm: z.array(vector).min(3).max(512),
      accumulatedTwistDeg: finite,
      minimumExactClearanceMm: nonnegative,
      maximumConnectorDisplacementMm: nonnegative,
      stateArtifactSha256: sha,
    }).strict()).min(1).max(128),
  }).strict()).min(1).max(256),
}).strict();

export type RobotCableLifeSweepInput = z.infer<typeof robotCableLifeSweepInputSchema>;
export type RobotCableLifeReport = {
  cableId: string;
  minimumDynamicBendRadiusMm: number | null;
  maximumTwistDegPerM: number | null;
  minimumExactClearanceMm: number | null;
  minimumServiceLoopReserveMm: number | null;
  maximumConnectorDisplacementMm: number | null;
  cumulativeLifeDamage: number | null;
  lifeDamageMargin: number | null;
  status: 'passed' | 'failed';
  errors: string[];
};
export type RobotCableLifeSweepReport = {
  schema: 'nexyfab.robot-cable-life-sweep-report.v1';
  requirementsFileSha256: string;
  cableInputSha256: string;
  motionCoverageReportSha256: string;
  frozenRequirementsSha256: string | null;
  motionCoverageHash: string | null;
  status: 'passed' | 'failed';
  cableLifeReady: boolean;
  fullMotionCombinationCoverageComplete: boolean;
  cables: RobotCableLifeReport[];
  errors: string[];
  physicalFlexValidationComplete: false;
  releaseReady: false;
  sideEffects: { persisted: false; cadModified: false; quoteCreated: false; rfqSent: false };
};

type Vec3 = { x: number; y: number; z: number };

export function evaluateRobotCableLifeSweepBytes(requirementsBytes: Uint8Array, motionReportBytes: Uint8Array, inputBytes: Uint8Array): RobotCableLifeSweepReport {
  const errors: string[] = [];
  const verification = verifyRobotSystemRequirementsBytes(requirementsBytes);
  if (!verification.requirementsReady) errors.push(...verification.errors.map(error => `requirements: ${error}`));
  const requirementsParsed = robotSystemRequirementsV2Schema.safeParse(decodeJson(requirementsBytes, 'requirements', errors));
  const motionParsed = motionReportSchema.safeParse(decodeJson(motionReportBytes, 'motion coverage report', errors));
  const inputParsed = robotCableLifeSweepInputSchema.safeParse(decodeJson(inputBytes, 'cable life input', errors));
  if (!requirementsParsed.success) errors.push('requirements schema is invalid');
  if (!motionParsed.success) errors.push(...motionParsed.error.issues.map(issue => `motion.${issue.path.join('.') || '$'}: ${issue.message}`));
  if (!inputParsed.success) errors.push(...inputParsed.error.issues.map(issue => `input.${issue.path.join('.') || '$'}: ${issue.message}`));
  if (!requirementsParsed.success || !motionParsed.success || !inputParsed.success || !verification.requirementsReady) return failed(requirementsBytes, motionReportBytes, inputBytes, verification.frozenRequirementsSha256, motionParsed.success ? motionParsed.data.coverageHash : null, errors);
  const input = inputParsed.data;
  const motion = motionParsed.data;
  if (digest(requirementsBytes) !== input.requirementsFileSha256) errors.push('requirements bytes do not match requirementsFileSha256');
  if (verification.frozenRequirementsSha256 !== input.frozenRequirementsSha256 || motion.frozenRequirementsSha256 !== input.frozenRequirementsSha256) errors.push('requirements, motion and cable input frozen hashes do not agree');
  if (digest(motionReportBytes) !== input.motionCoverageReportSha256) errors.push('motion coverage report bytes do not match motionCoverageReportSha256');
  if (input.requiredServiceLifeCycles !== requirementsParsed.data.performance.serviceLifeCycles) errors.push('cable service-life cycles differ from frozen requirements');
  crossFieldErrors(motion, input, errors);
  const cableReports = input.cables.map(cable => evaluateCable(cable, input));
  for (const cable of cableReports) errors.push(...cable.errors.map(error => `${cable.cableId}: ${error}`));
  const uniqueErrors = [...new Set(errors)];
  const motionIds = new Set(motion.combinations.map(item => item.id));
  const submittedIds = new Set(input.combinations.map(item => item.motionCombinationId));
  const fullMotionCombinationCoverageComplete = motionIds.size === submittedIds.size && [...motionIds].every(value => submittedIds.has(value));
  const cableLifeReady = fullMotionCombinationCoverageComplete && cableReports.length === input.cables.length && cableReports.every(item => item.status === 'passed') && uniqueErrors.length === 0;
  return {
    schema: 'nexyfab.robot-cable-life-sweep-report.v1',
    requirementsFileSha256: digest(requirementsBytes),
    cableInputSha256: digest(inputBytes),
    motionCoverageReportSha256: digest(motionReportBytes),
    frozenRequirementsSha256: verification.frozenRequirementsSha256,
    motionCoverageHash: motion.coverageHash,
    status: cableLifeReady ? 'passed' : 'failed',
    cableLifeReady,
    fullMotionCombinationCoverageComplete,
    cables: cableReports,
    errors: uniqueErrors,
    physicalFlexValidationComplete: false,
    releaseReady: false,
    sideEffects: noSideEffects(),
  };
}

function crossFieldErrors(motion: z.infer<typeof motionReportSchema>, input: RobotCableLifeSweepInput, errors: string[]) {
  const cableIds = input.cables.map(item => item.id);
  if (new Set(cableIds).size !== cableIds.length) errors.push('cable ids must be unique');
  const combinationIds = input.combinations.map(item => item.motionCombinationId);
  if (new Set(combinationIds).size !== combinationIds.length) errors.push('cable motion combination ids must be unique');
  const motionIds = motion.combinations.map(item => item.id);
  for (const motionId of motionIds) if (!combinationIds.includes(motionId)) errors.push(`motion combination ${motionId} is missing from cable life sweep`);
  for (const combinationId of combinationIds) if (!motionIds.includes(combinationId)) errors.push(`unknown motion combination ${combinationId} was supplied to cable life sweep`);
  const usageSum = input.combinations.reduce((sum, item) => sum + item.usageFraction, 0);
  if (Math.abs(usageSum - 1) > 1e-9) errors.push('motion combination usage fractions must sum to one');
  for (const cable of input.cables) {
    for (let index = 0; index < cable.bendLifeCurve.length; index++) {
      const point = cable.bendLifeCurve[index]!;
      if (index > 0) {
        const previous = cable.bendLifeCurve[index - 1]!;
        if (!(point.bendRadiusMm > previous.bendRadiusMm)) errors.push(`${cable.id}: bend life curve radii must increase strictly`);
        if (point.allowableCycles < previous.allowableCycles) errors.push(`${cable.id}: bend life curve cycles must be non-decreasing`);
      }
    }
    if (cable.bendLifeCurve[0]!.bendRadiusMm > cable.minimumAllowedBendRadiusMm) errors.push(`${cable.id}: life curve does not cover the minimum allowed bend radius`);
  }
  for (const combination of input.combinations) {
    const stateIds = combination.cableStates.map(item => item.cableId);
    if (new Set(stateIds).size !== stateIds.length) errors.push(`${combination.motionCombinationId}: cable states must be unique`);
    for (const cableId of cableIds) if (!stateIds.includes(cableId)) errors.push(`${combination.motionCombinationId}: cable ${cableId} state is missing`);
    for (const cableId of stateIds) if (!cableIds.includes(cableId)) errors.push(`${combination.motionCombinationId}: unknown cable ${cableId} state was supplied`);
  }
}

function evaluateCable(cable: RobotCableLifeSweepInput['cables'][number], input: RobotCableLifeSweepInput): RobotCableLifeReport {
  const errors: string[] = [];
  let minimumBend = Infinity; let maximumTwist = 0; let minimumClearance = Infinity; let minimumLoop = Infinity; let maximumConnector = 0; let cumulativeDamage = 0;
  for (const combination of input.combinations) {
    const state = combination.cableStates.find(item => item.cableId === cable.id);
    if (!state) continue;
    const routeLengthMm = polylineLength(state.routePointsMm);
    const directLengthMm = distance(state.routePointsMm[0]!, state.routePointsMm.at(-1)!);
    const serviceLoopReserveMm = routeLengthMm - directLengthMm;
    const bendRadiusMm = minimumPolylineBendRadius(state.routePointsMm);
    const twistDegPerM = Math.abs(state.accumulatedTwistDeg) / (routeLengthMm / 1_000);
    minimumBend = Math.min(minimumBend, bendRadiusMm);
    maximumTwist = Math.max(maximumTwist, twistDegPerM);
    minimumClearance = Math.min(minimumClearance, state.minimumExactClearanceMm);
    minimumLoop = Math.min(minimumLoop, serviceLoopReserveMm);
    maximumConnector = Math.max(maximumConnector, state.maximumConnectorDisplacementMm);
    const lifeCycles = interpolateLife(cable.bendLifeCurve, bendRadiusMm);
    if (lifeCycles === null) errors.push(`${combination.motionCombinationId}: bend radius is below the governed life curve`);
    else cumulativeDamage += input.requiredServiceLifeCycles * combination.usageFraction * cable.lifeSafetyFactor / lifeCycles;
    if (bendRadiusMm < cable.minimumAllowedBendRadiusMm - 1e-9) errors.push(`${combination.motionCombinationId}: bend radius violates the cable minimum`);
    if (twistDegPerM > cable.maximumTwistDegPerM + 1e-9) errors.push(`${combination.motionCombinationId}: twist per metre exceeds the cable limit`);
    if (state.minimumExactClearanceMm < cable.minimumClearanceMm - 1e-9) errors.push(`${combination.motionCombinationId}: exact clearance violates the cable minimum`);
    if (serviceLoopReserveMm < cable.minimumServiceLoopReserveMm - 1e-9) errors.push(`${combination.motionCombinationId}: service-loop reserve is insufficient`);
    if (state.maximumConnectorDisplacementMm > cable.maximumConnectorDisplacementMm + 1e-9) errors.push(`${combination.motionCombinationId}: connector displacement exceeds its limit`);
  }
  if (cumulativeDamage > 1 + 1e-9) errors.push(`cumulative flex-life damage ${cumulativeDamage.toFixed(6)} exceeds one`);
  return {
    cableId: cable.id,
    minimumDynamicBendRadiusMm: Number.isFinite(minimumBend) ? minimumBend : null,
    maximumTwistDegPerM: Number.isFinite(maximumTwist) ? maximumTwist : null,
    minimumExactClearanceMm: Number.isFinite(minimumClearance) ? minimumClearance : null,
    minimumServiceLoopReserveMm: Number.isFinite(minimumLoop) ? minimumLoop : null,
    maximumConnectorDisplacementMm: Number.isFinite(maximumConnector) ? maximumConnector : null,
    cumulativeLifeDamage: Number.isFinite(cumulativeDamage) ? cumulativeDamage : null,
    lifeDamageMargin: Number.isFinite(cumulativeDamage) ? 1 - cumulativeDamage : null,
    status: errors.length ? 'failed' : 'passed',
    errors: [...new Set(errors)],
  };
}

function minimumPolylineBendRadius(points: readonly Vec3[]) {
  let minimum = Infinity;
  for (let index = 1; index < points.length - 1; index++) {
    const a = distance(points[index - 1]!, points[index]!);
    const b = distance(points[index]!, points[index + 1]!);
    const c = distance(points[index - 1]!, points[index + 1]!);
    const twiceArea = norm(cross(subtract(points[index]!, points[index - 1]!), subtract(points[index + 1]!, points[index - 1]!)));
    if (a <= 1e-12 || b <= 1e-12 || c <= 1e-12) return 0;
    if (twiceArea > 1e-12) minimum = Math.min(minimum, a * b * c / (2 * twiceArea));
  }
  return minimum;
}

function interpolateLife(curve: RobotCableLifeSweepInput['cables'][number]['bendLifeCurve'], radiusMm: number): number | null {
  if (radiusMm < curve[0]!.bendRadiusMm) return null;
  if (radiusMm >= curve.at(-1)!.bendRadiusMm) return curve.at(-1)!.allowableCycles;
  for (let index = 1; index < curve.length; index++) {
    const upper = curve[index]!, lower = curve[index - 1]!;
    if (radiusMm <= upper.bendRadiusMm) {
      const ratio = (radiusMm - lower.bendRadiusMm) / (upper.bendRadiusMm - lower.bendRadiusMm);
      return Math.exp(Math.log(lower.allowableCycles) + ratio * (Math.log(upper.allowableCycles) - Math.log(lower.allowableCycles)));
    }
  }
  return null;
}

function failed(requirementsBytes: Uint8Array, motionBytes: Uint8Array, inputBytes: Uint8Array, frozenHash: string | null, motionHash: string | null, errors: string[]): RobotCableLifeSweepReport {
  return { schema: 'nexyfab.robot-cable-life-sweep-report.v1', requirementsFileSha256: digest(requirementsBytes), cableInputSha256: digest(inputBytes), motionCoverageReportSha256: digest(motionBytes), frozenRequirementsSha256: frozenHash, motionCoverageHash: motionHash, status: 'failed', cableLifeReady: false, fullMotionCombinationCoverageComplete: false, cables: [], errors: [...new Set(errors)], physicalFlexValidationComplete: false, releaseReady: false, sideEffects: noSideEffects() };
}

function polylineLength(points: readonly Vec3[]) { let total = 0; for (let index = 1; index < points.length; index++) total += distance(points[index - 1]!, points[index]!); return total; }
function distance(a: Vec3, b: Vec3) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
function subtract(a: Vec3, b: Vec3): Vec3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function cross(a: Vec3, b: Vec3): Vec3 { return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }; }
function norm(value: Vec3) { return Math.hypot(value.x, value.y, value.z); }
function decodeJson(bytes: Uint8Array, label: string, errors: string[]): unknown { try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { errors.push(`${label} must be valid UTF-8 JSON`); return null; } }
function digest(bytes: Uint8Array) { return createHash('sha256').update(bytes).digest('hex'); }
function noSideEffects() { return { persisted: false as const, cadModified: false as const, quoteCreated: false as const, rfqSent: false as const }; }
