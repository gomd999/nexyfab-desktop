import { createHash } from 'node:crypto';
import { z } from 'zod';
import { admitRobotCatalogBytes, parseRobotCatalogManifestBytes } from './robotCatalogAdmission';
import { robotSelectionRequirementsSchema, selectRobotCatalogBytes } from './robotCatalogSelection';
import { selectRobotDriveTrain, type JointSelectionRequirement } from './componentSelector';
import type { CatalogComponent } from './componentCatalog';
import { evaluateSelectedDriveHousing, type HousingFitResult, type JointHousingCapacity } from './driveIntegration';

const capacitySchema = z.object({ joint: z.number().int().min(1).max(6), internalMm: z.object({ x: z.number().positive().finite(), y: z.number().positive().finite(), z: z.number().positive().finite() }).strict(), radialClearanceMm: z.number().nonnegative().finite(), axialClearanceMm: z.number().nonnegative().finite(), source: z.string().min(1), artifactHash: z.string().regex(/^[a-f0-9]{64}$/i) }).strict();
const housingSchema = z.object({ schema: z.literal('nexyfab.robot-housing-capacities.v1'), capacities: z.array(capacitySchema).length(6) }).strict();
export type RobotHousingFitEvidenceReport = {
  schema: 'nexyfab.robot-housing-fit-evidence.v1'; housingSha256: string; requirementsSha256: string; manifestSha256: string; artifactSetSha256: string;
  selectionReady: boolean; housingStatus: 'passed' | 'failed' | 'not_run'; releaseReady: false; cadIntegrationStatus: 'not_run'; fits: HousingFitResult[]; errors: string[];
  sideEffects: { persisted: false; catalogActivated: false; cadModified: false; quoteCreated: false; rfqSent: false };
};

export function evaluateRobotHousingFitEvidence(housingBytes: Uint8Array, requirementsBytes: Uint8Array, manifestBytes: Uint8Array, uploaded: ReadonlyArray<{ name: string; bytes: Uint8Array }>): RobotHousingFitEvidenceReport {
  const housingSha256 = sha256(housingBytes); const selection = selectRobotCatalogBytes(requirementsBytes, manifestBytes, uploaded); const admission = admitRobotCatalogBytes(manifestBytes, uploaded);
  if (!selection.selectionReady) return result('not_run', housingSha256, selection.requirementsSha256, admission.manifestSha256, admission.artifactSetSha256, false, [], selection.errors);
  let housingRaw: unknown; let requirementsRaw: unknown;
  try { housingRaw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(housingBytes)); } catch { housingRaw = null; }
  try { requirementsRaw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(requirementsBytes)); } catch { requirementsRaw = null; }
  const parsedHousing = housingSchema.safeParse(housingRaw); const parsedRequirements = robotSelectionRequirementsSchema.safeParse(requirementsRaw); const parsedManifest = parseRobotCatalogManifestBytes(manifestBytes);
  const errors = parsedHousing.success ? [] : parsedHousing.error.issues.map(issue => `housing.${issue.path.join('.') || '$'}: ${issue.message}`);
  if (!parsedRequirements.success || !parsedManifest.manifest) errors.push('validated selection inputs could not be rebound');
  if (!parsedHousing.success || !parsedRequirements.success || !parsedManifest.manifest) return result('not_run', housingSha256, selection.requirementsSha256, admission.manifestSha256, admission.artifactSetSha256, true, [], errors);
  const joints = parsedHousing.data.capacities.map(item => item.joint);
  if (new Set(joints).size !== 6 || [...joints].sort((a, b) => a - b).some((joint, index) => joint !== index + 1)) errors.push('housing capacities must contain each governed joint J1..J6 exactly once');
  const verifiedHashes = new Set(admission.artifacts.filter(item => item.verified).map(item => item.actualSha256));
  for (const capacity of parsedHousing.data.capacities) if (!verifiedHashes.has(capacity.artifactHash.toLowerCase())) errors.push(`J${capacity.joint}: housing capacity artifactHash is not bound to verified uploaded bytes`);
  if (errors.length) return result('not_run', housingSha256, selection.requirementsSha256, admission.manifestSha256, admission.artifactSetSha256, true, [], errors);
  const selected = selectRobotDriveTrain(parsedRequirements.data.requirements as JointSelectionRequirement[], parsedManifest.manifest.components as CatalogComponent[]);
  if (!selected.ok || selected.selections.length !== 6) return result('not_run', housingSha256, selection.requirementsSha256, admission.manifestSha256, admission.artifactSetSha256, true, [], selected.ok ? ['selection count changed during housing evaluation'] : selected.errors);
  const fits = evaluateSelectedDriveHousing(selected.selections, parsedHousing.data.capacities as JointHousingCapacity[]);
  const status = fits.length === 6 && fits.every(item => item.status === 'passed') ? 'passed' : 'failed';
  return result(status, housingSha256, selection.requirementsSha256, admission.manifestSha256, admission.artifactSetSha256, true, fits, fits.flatMap(item => item.errors));
}

function sha256(bytes: Uint8Array) { return createHash('sha256').update(bytes).digest('hex'); }
function result(housingStatus: RobotHousingFitEvidenceReport['housingStatus'], housingSha256: string, requirementsSha256: string, manifestSha256: string, artifactSetSha256: string, selectionReady: boolean, fits: HousingFitResult[], errors: string[]): RobotHousingFitEvidenceReport {
  return { schema: 'nexyfab.robot-housing-fit-evidence.v1', housingSha256, requirementsSha256, manifestSha256, artifactSetSha256, selectionReady, housingStatus, releaseReady: false, cadIntegrationStatus: 'not_run', fits, errors, sideEffects: { persisted: false, catalogActivated: false, cadModified: false, quoteCreated: false, rfqSent: false } };
}
