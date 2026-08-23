import { createHash, createPublicKey, sign, verify } from 'node:crypto';
import { z } from 'zod';
import { robotSystemRequirementsV2Schema, verifyRobotSystemRequirementsBytes } from './robotSystemRequirements';

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const finite = z.number().finite();
const positive = finite.positive();
const nonnegative = finite.nonnegative();
const ed25519Signature = z.string().regex(/^[A-Za-z0-9+/]{86}==$/);

export const robotMotionCoverageInputSchema = z.object({
  schema: z.literal('nexyfab.robot-motion-coverage-input.v1'),
  requirementsFileSha256: sha,
  frozenRequirementsSha256: sha,
  coveragePlanArtifactSha256: sha,
  exactGeometryArtifactSha256: sha,
  obstacleSetArtifactSha256: sha,
  policy: z.object({
    maximumJointStepDeg: positive,
    adaptiveMaximumJointStepDeg: positive,
    nearContactThresholdMm: positive,
    minimumAllowedClearanceMm: nonnegative,
    nearSingularityConditionNumber: positive,
  }).strict(),
  requiredWorkspaceCellIds: z.array(id).min(1).max(4_096),
  combinations: z.array(z.object({
    id,
    payloadCaseId: id,
    governedPathId: id,
    governedPathArtifactSha256: sha,
    frames: z.array(z.object({
      timeS: nonnegative,
      anglesDeg: z.array(finite).length(6),
      jacobianConditionNumber: positive,
      endpointClearanceMm: nonnegative,
      workspaceCellIds: z.array(id).min(1).max(32),
    }).strict()).min(2).max(20_000),
    segments: z.array(z.object({
      fromFrame: z.number().int().nonnegative(),
      toFrame: z.number().int().positive(),
      maximumJointDeltaDeg: nonnegative,
      continuousMinimumClearanceMm: nonnegative,
      method: z.literal('exact_brep_continuous_collision'),
      evidenceArtifactSha256: sha,
    }).strict()).min(1).max(19_999),
    /** Digest of the path/frame/segment bytes covered by the swept checks. */
    sweptEvidenceBindingSha256: sha,
  }).strict()).min(1).max(256),
}).strict();

export type RobotMotionCoverageInput = z.infer<typeof robotMotionCoverageInputSchema>;
export type RobotMotionCoverageCombination = RobotMotionCoverageInput['combinations'][number];
const sweptEvidenceArtifactSchema = z.object({
  schema: z.literal('nexyfab.robot-swept-evidence-artifact.v1'),
  frozenRequirementsSha256: sha,
  governedPathArtifactSha256: sha,
  payloadCaseId: id,
  governedPathId: id,
  combinationId: id,
  fromFrame: z.number().int().nonnegative(),
  toFrame: z.number().int().positive(),
  method: z.literal('exact_brep_continuous_collision'),
  continuousMinimumClearanceMm: nonnegative,
  workerIdentitySha256: sha,
  kernelIdentitySha256: sha,
  contentSha256: sha,
  signatures: z.array(z.object({
    issuerId: id,
    role: z.enum(['worker', 'kernel']),
    signature: ed25519Signature,
  }).strict()).length(2),
}).strict();
export type RobotSweptEvidenceArtifactV1 = z.infer<typeof sweptEvidenceArtifactSchema>;
export type RobotSweptEvidenceTrustedSigner = {
  publicKey: string;
  role: 'worker' | 'kernel';
  identitySha256: string;
};
export type RobotSweptEvidenceTrustedSignerRegistry = ReadonlyMap<string, RobotSweptEvidenceTrustedSigner>;
export type RobotMotionCoverageCombinationReport = {
  id: string;
  payloadCaseId: string;
  governedPathId: string;
  frameCount: number;
  segmentCount: number;
  adaptiveSegmentCount: number;
  minimumContinuousClearanceMm: number | null;
  maximumJacobianConditionNumber: number | null;
  visitedWorkspaceCellIds: string[];
  status: 'passed' | 'failed';
  errors: string[];
};
export type RobotMotionCoverageReport = {
  schema: 'nexyfab.robot-motion-coverage-report.v1';
  requirementsFileSha256: string;
  motionInputSha256: string;
  frozenRequirementsSha256: string | null;
  coveragePlanArtifactSha256: string | null;
  /** Content binding for every supplied swept interval and governed path. */
  sweptEvidenceBindingSha256: string | null;
  /** True only after every referenced evidence hash was rechecked against bytes. */
  sweptEvidenceArtifactsVerified: boolean;
  coverageHash: string;
  status: 'passed' | 'failed';
  motionCoverageReady: boolean;
  fullPayloadPathCoverageComplete: boolean;
  continuousCollisionCoverageComplete: boolean;
  workspaceCoverageComplete: boolean;
  counts: { expectedCombinations: number; submittedCombinations: number; passedCombinations: number; requiredWorkspaceCells: number; visitedRequiredWorkspaceCells: number };
  combinations: RobotMotionCoverageCombinationReport[];
  uncoveredWorkspaceCellIds: string[];
  errors: string[];
  physicalValidationComplete: false;
  releaseReady: false;
  sideEffects: { persisted: false; cadModified: false; quoteCreated: false; rfqSent: false };
};

export function evaluateRobotMotionCoverageBytes(
  requirementsBytes: Uint8Array,
  inputBytes: Uint8Array,
  sweptEvidenceArtifacts: ReadonlyMap<string, Uint8Array> = new Map(),
  trustedSigners: RobotSweptEvidenceTrustedSignerRegistry = new Map(),
): RobotMotionCoverageReport {
  const errors: string[] = [];
  const verification = verifyRobotSystemRequirementsBytes(requirementsBytes);
  if (!verification.requirementsReady) errors.push(...verification.errors.map(error => `requirements: ${error}`));
  const requirementsParsed = robotSystemRequirementsV2Schema.safeParse(decodeJson(requirementsBytes, 'requirements', errors));
  const inputParsed = robotMotionCoverageInputSchema.safeParse(decodeJson(inputBytes, 'motion coverage input', errors));
  if (!requirementsParsed.success) errors.push('requirements schema is invalid');
  if (!inputParsed.success) errors.push(...inputParsed.error.issues.map(issue => `input.${issue.path.join('.') || '$'}: ${issue.message}`));
  const input = inputParsed.success ? inputParsed.data : null;
  const requirements = requirementsParsed.success ? requirementsParsed.data : null;
  const combinationReports: RobotMotionCoverageCombinationReport[] = [];
  let expectedCombinations = 0;
  let sweptEvidenceArtifactsVerified = false;
  const referencedEvidenceHashes = new Set<string>();
  const duplicateEvidenceHashes = new Set<string>();

  if (input && requirements && verification.frozenRequirementsSha256) {
    sweptEvidenceArtifactsVerified = input.combinations.length > 0;
    if (digest(requirementsBytes) !== input.requirementsFileSha256) errors.push('requirements bytes do not match requirementsFileSha256');
    if (verification.frozenRequirementsSha256 !== input.frozenRequirementsSha256) errors.push('canonical frozen requirements do not match frozenRequirementsSha256');
    if (input.policy.adaptiveMaximumJointStepDeg > input.policy.maximumJointStepDeg) errors.push('adaptive joint step must not exceed the global maximum joint step');
    if (input.policy.nearContactThresholdMm < input.policy.minimumAllowedClearanceMm) errors.push('near-contact threshold must be at least the minimum allowed clearance');
    if (new Set(input.requiredWorkspaceCellIds).size !== input.requiredWorkspaceCellIds.length) errors.push('required workspace cell ids must be unique');
    const expected = new Map<string, { pathHash: string }>();
    for (const payload of requirements.mechanics.payloadCases) for (const path of requirements.motion.governedPaths) expected.set(key(payload.id, path.id), { pathHash: path.artifactSha256 });
    expectedCombinations = expected.size;
    const submitted = input.combinations.map(item => key(item.payloadCaseId, item.governedPathId));
    if (new Set(submitted).size !== submitted.length) errors.push('motion coverage combinations must be unique');
    const combinationIds = input.combinations.map(item => item.id);
    if (new Set(combinationIds).size !== combinationIds.length) errors.push('motion coverage combination ids must be unique');
    for (const expectedKey of expected.keys()) if (!submitted.includes(expectedKey)) errors.push(`required motion combination ${expectedKey} is missing`);
    for (const submittedKey of submitted) if (!expected.has(submittedKey)) errors.push(`unknown motion combination ${submittedKey} was supplied`);

    for (const combination of input.combinations) {
      const localErrors: string[] = [];
      const expectedSweptBinding = robotSweptEvidenceBindingSha256(combination);
      if (combination.sweptEvidenceBindingSha256 !== expectedSweptBinding) {
        localErrors.push('swept evidence binding hash differs from supplied path/frame/segment bytes');
      }
      for (const segment of combination.segments) {
        if (referencedEvidenceHashes.has(segment.evidenceArtifactSha256)) {
          duplicateEvidenceHashes.add(segment.evidenceArtifactSha256);
          sweptEvidenceArtifactsVerified = false;
          localErrors.push(`swept evidence artifact reused:${segment.evidenceArtifactSha256}`);
        }
        referencedEvidenceHashes.add(segment.evidenceArtifactSha256);
        const bytes = sweptEvidenceArtifacts.get(segment.evidenceArtifactSha256);
        if (!bytes) {
          sweptEvidenceArtifactsVerified = false;
          localErrors.push(`swept evidence artifact bytes missing:${segment.evidenceArtifactSha256}`);
        } else if (digest(bytes) !== segment.evidenceArtifactSha256) {
          sweptEvidenceArtifactsVerified = false;
          localErrors.push(`swept evidence artifact bytes hash mismatch:${segment.evidenceArtifactSha256}`);
        } else {
          let parsed: RobotSweptEvidenceArtifactV1 | null = null;
          let text: string;
          try {
            text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
            const value: unknown = JSON.parse(text);
            const result = sweptEvidenceArtifactSchema.safeParse(value);
            if (!result.success) {
              sweptEvidenceArtifactsVerified = false;
              localErrors.push(`swept evidence artifact schema invalid:${segment.evidenceArtifactSha256}`);
            } else if (text !== canonical(result.data)) {
              sweptEvidenceArtifactsVerified = false;
              localErrors.push(`swept evidence artifact is not canonical:${segment.evidenceArtifactSha256}`);
            } else {
              parsed = result.data;
            }
          } catch {
            sweptEvidenceArtifactsVerified = false;
            localErrors.push(`swept evidence artifact JSON invalid:${segment.evidenceArtifactSha256}`);
          }
          if (parsed) {
            const { contentSha256, signatures: _artifactSignatures, ...unsigned } = parsed;
            if (contentSha256 !== digest(new TextEncoder().encode(canonical(unsigned)))) {
              sweptEvidenceArtifactsVerified = false;
              localErrors.push(`swept evidence artifact content binding invalid:${segment.evidenceArtifactSha256}`);
            }
            const signaturesByRole = new Map<string, number>();
            const signerKeyFingerprintByRole = new Map<'worker' | 'kernel', string>();
            for (const entry of parsed.signatures) {
              signaturesByRole.set(entry.role, (signaturesByRole.get(entry.role) ?? 0) + 1);
              const trusted = trustedSigners.get(entry.issuerId);
              const expectedIdentity = entry.role === 'worker' ? parsed.workerIdentitySha256 : parsed.kernelIdentitySha256;
              if (!trusted || trusted.role !== entry.role || trusted.identitySha256 !== expectedIdentity) {
                sweptEvidenceArtifactsVerified = false;
                localErrors.push(`swept evidence signer untrusted or identity mismatch:${entry.issuerId}`);
                continue;
              }
              try {
                const publicKey = createPublicKey(trusted.publicKey);
                if (publicKey.asymmetricKeyType !== 'ed25519') throw new Error('unexpected signer key type');
                signerKeyFingerprintByRole.set(entry.role, digest(publicKey.export({ type: 'spki', format: 'der' })));
                const { signatures: _signatures, ...signedArtifact } = parsed;
                if (!verify(null, Buffer.from(canonical(signedArtifact)), publicKey, Buffer.from(entry.signature, 'base64'))) {
                  sweptEvidenceArtifactsVerified = false;
                  localErrors.push(`swept evidence signature invalid:${entry.issuerId}`);
                }
              } catch {
                sweptEvidenceArtifactsVerified = false;
                localErrors.push(`swept evidence signature invalid:${entry.issuerId}`);
              }
            }
            if (signaturesByRole.get('worker') !== 1 || signaturesByRole.get('kernel') !== 1) {
              sweptEvidenceArtifactsVerified = false;
              localErrors.push(`swept evidence requires one worker and one kernel signature:${segment.evidenceArtifactSha256}`);
            }
            if (signerKeyFingerprintByRole.get('worker') && signerKeyFingerprintByRole.get('worker') === signerKeyFingerprintByRole.get('kernel')) {
              sweptEvidenceArtifactsVerified = false;
              localErrors.push(`swept evidence worker and kernel signers must use distinct keys:${segment.evidenceArtifactSha256}`);
            }
            if (parsed.workerIdentitySha256 === parsed.kernelIdentitySha256) {
              sweptEvidenceArtifactsVerified = false;
              localErrors.push(`swept evidence worker and kernel identities must be distinct:${segment.evidenceArtifactSha256}`);
            }
            const expectedArtifactFields: Array<[keyof RobotSweptEvidenceArtifactV1, unknown]> = [
              ['frozenRequirementsSha256', verification.frozenRequirementsSha256],
              ['governedPathArtifactSha256', combination.governedPathArtifactSha256],
              ['payloadCaseId', combination.payloadCaseId],
              ['governedPathId', combination.governedPathId],
              ['combinationId', combination.id],
              ['fromFrame', segment.fromFrame],
              ['toFrame', segment.toFrame],
              ['method', segment.method],
              ['continuousMinimumClearanceMm', segment.continuousMinimumClearanceMm],
            ];
            for (const [field, expectedValue] of expectedArtifactFields) {
              if (parsed[field] !== expectedValue) {
                sweptEvidenceArtifactsVerified = false;
                localErrors.push(`swept evidence artifact ${String(field)} mismatch:${segment.evidenceArtifactSha256}`);
              }
            }
          }
        }
      }
      const expectedValue = expected.get(key(combination.payloadCaseId, combination.governedPathId));
      if (!expectedValue) localErrors.push('payload/path combination is absent from frozen requirements');
      else if (expectedValue.pathHash !== combination.governedPathArtifactSha256) localErrors.push('governed path artifact hash differs from frozen requirements');
      for (let frameIndex = 0; frameIndex < combination.frames.length; frameIndex++) {
        const frame = combination.frames[frameIndex]!;
        if (frameIndex > 0 && !(frame.timeS > combination.frames[frameIndex - 1]!.timeS)) localErrors.push(`frame ${frameIndex}: time must increase strictly`);
        frame.anglesDeg.forEach((angle, jointIndex) => {
          const range = requirements.mechanics.jointRanges.find(item => item.joint === jointIndex + 1)!;
          if (angle < range.minDeg || angle > range.maxDeg) localErrors.push(`frame ${frameIndex}: J${jointIndex + 1} lies outside the frozen range`);
        });
        if (new Set(frame.workspaceCellIds).size !== frame.workspaceCellIds.length) localErrors.push(`frame ${frameIndex}: workspace cell ids must be unique`);
      }
      if (combination.segments.length !== combination.frames.length - 1) localErrors.push('continuous collision segment count must equal frame count minus one');
      let adaptiveSegmentCount = 0;
      for (let segmentIndex = 0; segmentIndex < combination.frames.length - 1; segmentIndex++) {
        const segment = combination.segments[segmentIndex];
        const start = combination.frames[segmentIndex]!;
        const end = combination.frames[segmentIndex + 1]!;
        if (!segment) continue;
        if (segment.fromFrame !== segmentIndex || segment.toFrame !== segmentIndex + 1) localErrors.push(`segment ${segmentIndex}: frame binding is not contiguous and ordered`);
        const actualMaximumDelta = Math.max(...start.anglesDeg.map((angle, jointIndex) => Math.abs(end.anglesDeg[jointIndex]! - angle)));
        if (Math.abs(segment.maximumJointDeltaDeg - actualMaximumDelta) > 1e-9) localErrors.push(`segment ${segmentIndex}: declared joint delta differs from frame bytes`);
        if (segment.continuousMinimumClearanceMm > Math.min(start.endpointClearanceMm, end.endpointClearanceMm) + 1e-9) localErrors.push(`segment ${segmentIndex}: continuous clearance cannot exceed both endpoint clearances`);
        if (segment.continuousMinimumClearanceMm < input.policy.minimumAllowedClearanceMm - 1e-9) localErrors.push(`segment ${segmentIndex}: continuous clearance violates the minimum`);
        const adaptive = segment.continuousMinimumClearanceMm <= input.policy.nearContactThresholdMm || Math.max(start.jacobianConditionNumber, end.jacobianConditionNumber) >= input.policy.nearSingularityConditionNumber;
        if (adaptive) adaptiveSegmentCount++;
        const allowedStep = adaptive ? input.policy.adaptiveMaximumJointStepDeg : input.policy.maximumJointStepDeg;
        if (actualMaximumDelta > allowedStep + 1e-9) localErrors.push(`segment ${segmentIndex}: joint step exceeds the ${adaptive ? 'adaptive' : 'global'} maximum`);
      }
      const visitedWorkspaceCellIds = [...new Set(combination.frames.flatMap(frame => frame.workspaceCellIds))].sort();
      combinationReports.push({
        id: combination.id,
        payloadCaseId: combination.payloadCaseId,
        governedPathId: combination.governedPathId,
        frameCount: combination.frames.length,
        segmentCount: combination.segments.length,
        adaptiveSegmentCount,
        minimumContinuousClearanceMm: combination.segments.length ? Math.min(...combination.segments.map(segment => segment.continuousMinimumClearanceMm)) : null,
        maximumJacobianConditionNumber: combination.frames.length ? Math.max(...combination.frames.map(frame => frame.jacobianConditionNumber)) : null,
        visitedWorkspaceCellIds,
        status: localErrors.length ? 'failed' : 'passed',
        errors: [...new Set(localErrors)],
      });
    }
    for (const hash of sweptEvidenceArtifacts.keys()) {
      if (!referencedEvidenceHashes.has(hash)) {
        sweptEvidenceArtifactsVerified = false;
        errors.push(`unreferenced swept evidence artifact:${hash}`);
      }
    }
    for (const hash of duplicateEvidenceHashes) errors.push(`duplicate swept evidence artifact reference:${hash}`);
  }

  for (const combination of combinationReports) errors.push(...combination.errors.map(error => `${combination.id}: ${error}`));
  const visited = new Set(combinationReports.flatMap(report => report.visitedWorkspaceCellIds));
  const uncoveredWorkspaceCellIds = input?.requiredWorkspaceCellIds.filter(cellId => !visited.has(cellId)) ?? [];
  for (const cellId of uncoveredWorkspaceCellIds) errors.push(`required workspace cell ${cellId} was not visited`);
  const uniqueErrors = [...new Set(errors)];
  const passedCombinations = combinationReports.filter(item => item.status === 'passed').length;
  const fullPayloadPathCoverageComplete = expectedCombinations > 0 && combinationReports.length === expectedCombinations && passedCombinations === expectedCombinations;
  const continuousCollisionCoverageComplete = combinationReports.length > 0 && combinationReports.every(item => item.segmentCount === item.frameCount - 1 && item.status === 'passed');
  const workspaceCoverageComplete = Boolean(input) && uncoveredWorkspaceCellIds.length === 0;
  const motionCoverageReady = fullPayloadPathCoverageComplete && continuousCollisionCoverageComplete && workspaceCoverageComplete && uniqueErrors.length === 0;
  const sweptEvidenceArtifactContent = input
    ? [...new Set(input.combinations.flatMap(combination => combination.segments.map(segment => segment.evidenceArtifactSha256)))].sort().map(hash => ({ hash, contentSha256: sweptEvidenceArtifacts.has(hash) ? digest(sweptEvidenceArtifacts.get(hash)!) : null }))
    : [];
  const sweptEvidenceBindingSha256 = input
    ? digest(new TextEncoder().encode(canonical({
      artifactsVerified: sweptEvidenceArtifactsVerified,
      artifactContent: sweptEvidenceArtifactContent,
      combinations: input.combinations.map(combination => ({
      id: combination.id,
      payloadCaseId: combination.payloadCaseId,
      governedPathId: combination.governedPathId,
      governedPathArtifactSha256: combination.governedPathArtifactSha256,
      sweptEvidenceBindingSha256: combination.sweptEvidenceBindingSha256,
      })).sort((a, b) => a.id.localeCompare(b.id)),
    })))
    : null;
  const coverageFacts = {
    inputSha256: digest(inputBytes),
    sweptEvidenceBindingSha256,
    sweptEvidenceArtifactsVerified,
    sweptEvidenceArtifactContent,
    combinations: combinationReports.map(item => ({ id: item.id, status: item.status, frames: item.frameCount, segments: item.segmentCount, minimumClearance: item.minimumContinuousClearanceMm })),
  };
  return {
    schema: 'nexyfab.robot-motion-coverage-report.v1',
    requirementsFileSha256: digest(requirementsBytes),
    motionInputSha256: digest(inputBytes),
    frozenRequirementsSha256: verification.frozenRequirementsSha256,
    coveragePlanArtifactSha256: input?.coveragePlanArtifactSha256 ?? null,
    sweptEvidenceBindingSha256,
    sweptEvidenceArtifactsVerified,
    coverageHash: digest(new TextEncoder().encode(canonical(coverageFacts))),
    status: motionCoverageReady ? 'passed' : 'failed',
    motionCoverageReady,
    fullPayloadPathCoverageComplete,
    continuousCollisionCoverageComplete,
    workspaceCoverageComplete,
    counts: { expectedCombinations, submittedCombinations: input?.combinations.length ?? 0, passedCombinations, requiredWorkspaceCells: input?.requiredWorkspaceCellIds.length ?? 0, visitedRequiredWorkspaceCells: input?.requiredWorkspaceCellIds.filter(cellId => visited.has(cellId)).length ?? 0 },
    combinations: combinationReports,
    uncoveredWorkspaceCellIds,
    errors: uniqueErrors,
    physicalValidationComplete: false,
    releaseReady: false,
    sideEffects: noSideEffects(),
  };
}

/**
 * Binds the exact governed path identity and every frame/segment field to the
 * supplied swept-evidence artifact references. This is a content binding,
 * not an independent B-rep attestation; external geometry evidence remains a
 * separate release boundary.
 */
export function robotSweptEvidenceBindingSha256(
  combination: Pick<RobotMotionCoverageCombination, 'governedPathArtifactSha256' | 'frames' | 'segments'>,
): string {
  const payload = {
    governedPathArtifactSha256: combination.governedPathArtifactSha256,
    frames: combination.frames,
    segments: combination.segments,
  };
  return digest(new TextEncoder().encode(canonical(payload)));
}

/** Build canonical, self-bound JSON bytes for one exact swept interval. */
export function createRobotSweptEvidenceArtifactBytes(
  input: Omit<RobotSweptEvidenceArtifactV1, 'contentSha256' | 'signatures'>,
  signers: ReadonlyArray<{ issuerId: string; role: 'worker' | 'kernel'; privateKey: string }>,
): Uint8Array {
  const contentSha256 = digest(new TextEncoder().encode(canonical(input)));
  const unsigned = { ...input, contentSha256 };
  const signatures = signers
    .map(signer => ({
      issuerId: signer.issuerId,
      role: signer.role,
      signature: sign(null, Buffer.from(canonical(unsigned)), signer.privateKey).toString('base64'),
    }))
    .sort((a, b) => a.role.localeCompare(b.role) || a.issuerId.localeCompare(b.issuerId));
  return new TextEncoder().encode(canonical({ ...unsigned, signatures }));
}

/** Parse only a server-configured public-key registry; malformed config fails closed. */
export function parseRobotSweptEvidenceTrustedSigners(
  raw = process.env.NEXYFAB_ROBOT_SWEPT_EVIDENCE_SIGNERS,
): RobotSweptEvidenceTrustedSignerRegistry {
  if (!raw) return new Map();
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return new Map();
    const output = new Map<string, RobotSweptEvidenceTrustedSigner>();
    for (const [issuerId, item] of Object.entries(value)) {
      if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(issuerId) || !item || typeof item !== 'object' || Array.isArray(item)) return new Map();
      const candidate = item as Record<string, unknown>;
      if (Object.keys(candidate).some(keyName => !['publicKey', 'role', 'identitySha256'].includes(keyName))
        || typeof candidate.publicKey !== 'string' || candidate.publicKey.length > 16_384
        || (candidate.role !== 'worker' && candidate.role !== 'kernel')
        || typeof candidate.identitySha256 !== 'string' || !/^[a-f0-9]{64}$/.test(candidate.identitySha256)) return new Map();
      const publicKey = createPublicKey(candidate.publicKey);
      if (publicKey.asymmetricKeyType !== 'ed25519') return new Map();
      output.set(issuerId, { publicKey: candidate.publicKey, role: candidate.role, identitySha256: candidate.identitySha256 });
    }
    return output;
  } catch {
    return new Map();
  }
}

function key(payloadCaseId: string, pathId: string) { return `${payloadCaseId}::${pathId}`; }
function decodeJson(bytes: Uint8Array, label: string, errors: string[]): unknown { try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { errors.push(`${label} must be valid UTF-8 JSON`); return null; } }
function digest(bytes: Uint8Array) { return createHash('sha256').update(bytes).digest('hex'); }
function canonical(value: unknown): string { if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`; if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([keyName, item]) => `${JSON.stringify(keyName)}:${canonical(item)}`).join(',')}}`; return JSON.stringify(value); }
function noSideEffects() { return { persisted: false as const, cadModified: false as const, quoteCreated: false as const, rfqSent: false as const }; }
