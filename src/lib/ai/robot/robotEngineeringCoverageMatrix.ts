import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  evaluateRobotEngineeringAnalysisPacket,
  type RobotEngineeringAnalysisPacketFiles,
} from './robotEngineeringAnalysisPacket';
import {
  robotSystemRequirementsV2Schema,
  verifyRobotSystemRequirementsBytes,
} from './robotSystemRequirements';

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const filename = z.string().min(1).max(256).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);

export const robotEngineeringCoverageManifestSchema = z.object({
  schema: z.literal('nexyfab.robot-engineering-coverage-manifest.v1'),
  requirementsFileSha256: sha,
  frozenRequirementsSha256: sha,
  combinations: z.array(z.object({
    id,
    payloadCaseId: id,
    governedPathId: id,
    files: z.object({
      dynamicInput: filename,
      dynamicReport: filename,
      thermalInput: filename,
      lifeInput: filename,
      complianceInput: filename,
      precisionInput: filename,
    }).strict(),
  }).strict()).min(1).max(256),
}).strict();

export type RobotEngineeringCoverageManifest = z.infer<typeof robotEngineeringCoverageManifestSchema>;
export type RobotEngineeringCoverageEntry = {
  id: string;
  payloadCaseId: string;
  governedPathId: string;
  expectedPathArtifactSha256: string | null;
  applicationHash: string | null;
  status: 'passed' | 'failed';
  errors: string[];
};
export type RobotEngineeringCoverageReport = {
  schema: 'nexyfab.robot-engineering-coverage-report.v1';
  requirementsFileSha256: string;
  manifestSha256: string;
  frozenRequirementsSha256: string | null;
  coverageHash: string;
  status: 'passed' | 'failed';
  coverageReady: boolean;
  fullRequirementsCoverageComplete: boolean;
  counts: { expectedCombinations: number; submittedCombinations: number; passedCombinations: number; declaredArtifacts: number; suppliedArtifacts: number };
  entries: RobotEngineeringCoverageEntry[];
  errors: string[];
  externalValidationComplete: false;
  releaseReady: false;
  sideEffects: { persisted: false; cadModified: false; quoteCreated: false; rfqSent: false };
};

export function evaluateRobotEngineeringCoverageMatrix(
  requirementsBytes: Uint8Array,
  manifestBytes: Uint8Array,
  artifacts: ReadonlyMap<string, Uint8Array>,
): RobotEngineeringCoverageReport {
  const errors: string[] = [];
  const verification = verifyRobotSystemRequirementsBytes(requirementsBytes);
  if (!verification.requirementsReady) errors.push(...verification.errors.map(error => `requirements: ${error}`));
  const requirementsParsed = robotSystemRequirementsV2Schema.safeParse(decodeJson(requirementsBytes, 'requirements', errors));
  const manifestParsed = robotEngineeringCoverageManifestSchema.safeParse(decodeJson(manifestBytes, 'coverage manifest', errors));
  if (!requirementsParsed.success) errors.push('requirements schema is invalid');
  if (!manifestParsed.success) errors.push(...manifestParsed.error.issues.map(issue => `manifest.${issue.path.join('.') || '$'}: ${issue.message}`));

  const manifest = manifestParsed.success ? manifestParsed.data : null;
  const requirements = requirementsParsed.success ? requirementsParsed.data : null;
  const entries: RobotEngineeringCoverageEntry[] = [];
  let expectedCombinations = 0;
  let declaredArtifacts = 0;

  if (manifest && requirements && verification.frozenRequirementsSha256) {
    if (digest(requirementsBytes) !== manifest.requirementsFileSha256) errors.push('requirements bytes do not match manifest requirementsFileSha256');
    if (verification.frozenRequirementsSha256 !== manifest.frozenRequirementsSha256) errors.push('canonical frozen requirements do not match the coverage manifest');
    const expected = new Map<string, { payloadCaseId: string; pathId: string; pathHash: string }>();
    for (const payload of requirements.mechanics.payloadCases) for (const path of requirements.motion.governedPaths) expected.set(combinationKey(payload.id, path.id), { payloadCaseId: payload.id, pathId: path.id, pathHash: path.artifactSha256 });
    expectedCombinations = expected.size;
    const submittedKeys = manifest.combinations.map(item => combinationKey(item.payloadCaseId, item.governedPathId));
    if (new Set(submittedKeys).size !== submittedKeys.length) errors.push('coverage manifest contains a duplicate payload/path combination');
    const ids = manifest.combinations.map(item => item.id);
    if (new Set(ids).size !== ids.length) errors.push('coverage manifest combination ids must be unique');
    for (const key of expected.keys()) if (!submittedKeys.includes(key)) errors.push(`required combination ${key} is missing`);
    for (const key of submittedKeys) if (!expected.has(key)) errors.push(`undeclared frozen-requirement combination ${key} was supplied`);

    const declaredNames = manifest.combinations.flatMap(item => Object.values(item.files));
    declaredArtifacts = declaredNames.length;
    if (new Set(declaredNames).size !== declaredNames.length) errors.push('every coverage artifact filename must be unique');
    for (const name of declaredNames) if (!artifacts.has(name)) errors.push(`declared coverage artifact ${name} is missing`);
    for (const name of artifacts.keys()) if (!declaredNames.includes(name)) errors.push(`undeclared coverage artifact ${name} was supplied`);

    for (const combination of manifest.combinations) {
      const expectedValue = expected.get(combinationKey(combination.payloadCaseId, combination.governedPathId));
      const missing = Object.values(combination.files).filter(name => !artifacts.has(name));
      if (!expectedValue || missing.length) {
        entries.push({ id: combination.id, payloadCaseId: combination.payloadCaseId, governedPathId: combination.governedPathId, expectedPathArtifactSha256: expectedValue?.pathHash ?? null, applicationHash: null, status: 'failed', errors: missing.map(name => `missing ${name}`) });
        continue;
      }
      const packetFiles: RobotEngineeringAnalysisPacketFiles = {
        requirements: requirementsBytes,
        dynamicInput: artifacts.get(combination.files.dynamicInput)!,
        dynamicReport: artifacts.get(combination.files.dynamicReport)!,
        thermalInput: artifacts.get(combination.files.thermalInput)!,
        lifeInput: artifacts.get(combination.files.lifeInput)!,
        complianceInput: artifacts.get(combination.files.complianceInput)!,
        precisionInput: artifacts.get(combination.files.precisionInput)!,
      };
      const packet = evaluateRobotEngineeringAnalysisPacket(packetFiles);
      const entryErrors = [...packet.errors];
      if (packet.payloadCaseId !== combination.payloadCaseId) entryErrors.push('analysis packet payload does not match the coverage combination');
      if (packet.governedPathArtifactSha256 !== expectedValue.pathHash) entryErrors.push('analysis packet path does not match the frozen governed path');
      if (!packet.engineeringAnalysisReady) entryErrors.push('engineering analysis packet is not ready');
      entries.push({ id: combination.id, payloadCaseId: combination.payloadCaseId, governedPathId: combination.governedPathId, expectedPathArtifactSha256: expectedValue.pathHash, applicationHash: packet.applicationHash, status: entryErrors.length ? 'failed' : 'passed', errors: [...new Set(entryErrors)] });
    }
    const applicationHashes = entries.map(item => item.applicationHash).filter((value): value is string => Boolean(value));
    if (new Set(applicationHashes).size !== applicationHashes.length) errors.push('coverage entries must have unique application hashes');
  }

  for (const entry of entries) errors.push(...entry.errors.map(error => `${entry.id}: ${error}`));
  const uniqueErrors = [...new Set(errors)];
  const passedCombinations = entries.filter(entry => entry.status === 'passed').length;
  const fullRequirementsCoverageComplete = expectedCombinations > 0 && entries.length === expectedCombinations && passedCombinations === expectedCombinations && uniqueErrors.length === 0;
  const hashes = { requirementsFileSha256: digest(requirementsBytes), manifestSha256: digest(manifestBytes), applicationHashes: entries.map(item => item.applicationHash) };
  return {
    schema: 'nexyfab.robot-engineering-coverage-report.v1',
    requirementsFileSha256: hashes.requirementsFileSha256,
    manifestSha256: hashes.manifestSha256,
    frozenRequirementsSha256: verification.frozenRequirementsSha256,
    coverageHash: digest(new TextEncoder().encode(canonical(hashes))),
    status: fullRequirementsCoverageComplete ? 'passed' : 'failed',
    coverageReady: fullRequirementsCoverageComplete,
    fullRequirementsCoverageComplete,
    counts: { expectedCombinations, submittedCombinations: manifest?.combinations.length ?? 0, passedCombinations, declaredArtifacts, suppliedArtifacts: artifacts.size },
    entries,
    errors: uniqueErrors,
    externalValidationComplete: false,
    releaseReady: false,
    sideEffects: noSideEffects(),
  };
}

function combinationKey(payloadCaseId: string, pathId: string) { return `${payloadCaseId}::${pathId}`; }
function decodeJson(bytes: Uint8Array, label: string, errors: string[]): unknown { try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { errors.push(`${label} must be valid UTF-8 JSON`); return null; } }
function digest(bytes: Uint8Array) { return createHash('sha256').update(bytes).digest('hex'); }
function canonical(value: unknown): string { if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`; if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`; return JSON.stringify(value); }
function noSideEffects() { return { persisted: false as const, cadModified: false as const, quoteCreated: false as const, rfqSent: false as const }; }
