import { createHash } from 'node:crypto';
import { z } from 'zod';
import { admitRobotCatalogBytes, parseRobotCatalogManifestBytes } from './robotCatalogAdmission';
import { selectRobotDriveTrain, type JointSelectionRequirement } from './componentSelector';
import type { CatalogComponent } from './componentCatalog';

const requirementSchema = z.object({ joint: z.number().int().min(1).max(6), requiredOutputTorqueNm: z.number().positive().finite(), requiredOutputRpm: z.number().positive().finite(), radialLoadN: z.number().positive().finite(), minShaftDiameterMm: z.number().positive().finite(), safetyFactor: z.number().min(1).finite().optional() }).strict();
export const robotSelectionRequirementsSchema = z.object({ schema: z.literal('nexyfab.robot-selection-requirements.v1'), requirements: z.array(requirementSchema).length(6) }).strict();

export type RobotCatalogSelectionReport = {
  schema: 'nexyfab.robot-catalog-selection.v1'; requirementsSha256: string; manifestSha256: string; artifactSetSha256: string;
  admissionEligible: boolean; selectionReady: boolean; selectionStatus: 'passed' | 'failed' | 'not_run'; releaseReady: false; cadIntegrationStatus: 'not_run';
  selections: Array<{ joint: number; motor: { id: string; model: string; artifactHash: string }; reducer: { id: string; model: string; artifactHash: string }; bearing: { id: string; model: string; artifactHash: string }; margins: { torque: number; speed: number; bearingLoad: number }; evidence: string[] }>;
  errors: string[]; sideEffects: { persisted: false; catalogActivated: false; cadModified: false; quoteCreated: false; rfqSent: false };
};

export function selectRobotCatalogBytes(requirementsBytes: Uint8Array, manifestBytes: Uint8Array, uploaded: ReadonlyArray<{ name: string; bytes: Uint8Array }>): RobotCatalogSelectionReport {
  const admission = admitRobotCatalogBytes(manifestBytes, uploaded); const errors = [...admission.errors];
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(requirementsBytes)); }
  catch { raw = null; errors.push('requirements must be valid UTF-8 JSON'); }
  const parsedRequirements = robotSelectionRequirementsSchema.safeParse(raw);
  if (!parsedRequirements.success) errors.push(...parsedRequirements.error.issues.map(issue => `requirements.${issue.path.join('.') || '$'}: ${issue.message}`));
  if (parsedRequirements.success) {
    const joints = parsedRequirements.data.requirements.map(item => item.joint);
    if (new Set(joints).size !== 6 || [...joints].sort((a, b) => a - b).some((joint, index) => joint !== index + 1)) errors.push('requirements must contain each governed joint J1..J6 exactly once');
  }
  const parsedManifest = parseRobotCatalogManifestBytes(manifestBytes);
  if (!parsedManifest.manifest && !errors.some(error => error.startsWith('manifest'))) errors.push(...parsedManifest.errors);
  if (!admission.productionEligible || !parsedRequirements.success || !parsedManifest.manifest || errors.length) return result(admission.productionEligible, false, requirementsBytes, admission.manifestSha256, admission.artifactSetSha256, [], errors);
  const selected = selectRobotDriveTrain(parsedRequirements.data.requirements as JointSelectionRequirement[], parsedManifest.manifest.components as CatalogComponent[]);
  if (!selected.ok) return result(true, false, requirementsBytes, admission.manifestSha256, admission.artifactSetSha256, [], selected.errors);
  if (selected.selections.length !== 6) return result(true, false, requirementsBytes, admission.manifestSha256, admission.artifactSetSha256, [], ['selector did not return exactly six governed joint selections']);
  return result(true, true, requirementsBytes, admission.manifestSha256, admission.artifactSetSha256, selected.selections.map(selection => ({ joint: selection.joint, motor: pick(selection.motor), reducer: pick(selection.reducer), bearing: pick(selection.bearing), margins: selection.margins, evidence: selection.evidence })), []);
}

function pick(component: CatalogComponent) { return { id: component.id, model: component.model, artifactHash: component.artifactHash.toLowerCase() }; }
function result(admissionEligible: boolean, selectionReady: boolean, requirementsBytes: Uint8Array, manifestSha256: string, artifactSetSha256: string, selections: RobotCatalogSelectionReport['selections'], errors: string[]): RobotCatalogSelectionReport {
  return { schema: 'nexyfab.robot-catalog-selection.v1', requirementsSha256: createHash('sha256').update(requirementsBytes).digest('hex'), manifestSha256, artifactSetSha256, admissionEligible, selectionReady, selectionStatus: selectionReady ? 'passed' : errors.length ? 'failed' : 'not_run', releaseReady: false, cadIntegrationStatus: 'not_run', selections, errors, sideEffects: { persisted: false, catalogActivated: false, cadModified: false, quoteCreated: false, rfqSent: false } };
}
