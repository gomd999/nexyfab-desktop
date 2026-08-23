import { createHash } from 'node:crypto';
import { z } from 'zod';
import { admitRobotCatalogBytes, parseRobotCatalogManifestBytes } from './robotCatalogAdmission';
import { selectRobotDriveTrain, type JointSelectionRequirement } from './componentSelector';
import type { AuxiliaryCatalogComponent, AuxiliaryComponentKind, CatalogComponent } from './componentCatalog';

const requirementSchema = z.object({ joint: z.number().int().min(1).max(6), requiredOutputTorqueNm: z.number().positive().finite(), requiredOutputRpm: z.number().positive().finite(), radialLoadN: z.number().positive().finite(), minShaftDiameterMm: z.number().positive().finite(), safetyFactor: z.number().min(1).finite().optional() }).strict();
const pointSchema = z.object({ x: z.number().finite(), y: z.number().finite(), z: z.number().finite() }).strict();
const orientationSchema = z.object({ x: z.number().finite(), y: z.number().finite(), z: z.number().finite(), w: z.number().finite() }).strict();
const mountSchema = z.object({ parentPartId: z.string().min(1), parentAxisRef: z.string().min(1), parentPlaneRef: z.string().min(1), positionMm: pointSchema, orientation: orientationSchema }).strict();
const selectedBase = { componentId: z.string().min(1), mount: mountSchema };
const auxiliarySelectionsSchema = z.object({
  brake: z.object({ ...selectedBase, minimumHoldingTorqueNm: z.number().positive().finite(), minimumMaxRpm: z.number().positive().finite(), requiredVoltageV: z.number().positive().finite() }).strict(),
  encoder: z.object({ ...selectedBase, minimumResolutionBits: z.number().int().positive().max(64), maximumAccuracyArcsec: z.number().positive().finite(), minimumMaxRpm: z.number().positive().finite(), requiredSupplyVoltageV: z.number().positive().finite() }).strict(),
  harness: z.object({ ...selectedBase, minimumConductorCount: z.number().int().positive(), minimumRatedVoltageV: z.number().positive().finite(), minimumRatedCurrentA: z.number().positive().finite(), maximumMinimumBendRadiusMm: z.number().positive().finite(), minimumFlexLifeCycles: z.number().int().positive().safe() }).strict(),
  toolConnector: z.object({ ...selectedBase, minimumContactCount: z.number().int().positive(), minimumRatedVoltageV: z.number().positive().finite(), minimumRatedCurrentA: z.number().positive().finite(), minimumMatingCycles: z.number().int().positive().safe(), minimumIpRating: z.string().regex(/^IP[0-6][0-9]$/) }).strict(),
}).strict();
export const robotSelectionRequirementsSchema = z.object({ schema: z.literal('nexyfab.robot-selection-requirements.v1'), requirements: z.array(requirementSchema).length(6), auxiliarySelections: auxiliarySelectionsSchema.optional() }).strict();

export type RobotAuxiliaryMount = z.infer<typeof mountSchema>;
export type RobotAuxiliaryCatalogSelection = {
  kind: AuxiliaryComponentKind; pendingComponentId: 'brake' | 'encoder' | 'internal_harness' | 'tool_connector';
  component: { id: string; model: string; artifactHash: string }; mount: RobotAuxiliaryMount; evidence: string[];
};

export type RobotCatalogSelectionReport = {
  schema: 'nexyfab.robot-catalog-selection.v1'; requirementsSha256: string; manifestSha256: string; artifactSetSha256: string;
  admissionEligible: boolean; selectionReady: boolean; selectionStatus: 'passed' | 'failed' | 'not_run'; releaseReady: false; cadIntegrationStatus: 'not_run';
  selections: Array<{ joint: number; motor: { id: string; model: string; artifactHash: string }; reducer: { id: string; model: string; artifactHash: string }; bearing: { id: string; model: string; artifactHash: string }; margins: { torque: number; speed: number; bearingLoad: number }; evidence: string[] }>;
  auxiliarySelectionReady: boolean; auxiliarySelectionStatus: 'passed' | 'failed' | 'not_run'; auxiliarySelections: RobotAuxiliaryCatalogSelection[];
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
  const auxiliaryRequested = Boolean(raw && typeof raw === 'object' && !Array.isArray(raw) && Object.prototype.hasOwnProperty.call(raw, 'auxiliarySelections'));
  if (!admission.productionEligible || !parsedRequirements.success || !parsedManifest.manifest || errors.length) return result(admission.productionEligible, false, false, auxiliaryRequested ? 'failed' : 'not_run', requirementsBytes, admission.manifestSha256, admission.artifactSetSha256, [], [], errors);
  const selected = selectRobotDriveTrain(parsedRequirements.data.requirements as JointSelectionRequirement[], parsedManifest.manifest.components as CatalogComponent[]);
  if (!selected.ok) return result(true, false, false, auxiliaryRequested ? 'failed' : 'not_run', requirementsBytes, admission.manifestSha256, admission.artifactSetSha256, [], [], selected.errors);
  if (selected.selections.length !== 6) return result(true, false, false, auxiliaryRequested ? 'failed' : 'not_run', requirementsBytes, admission.manifestSha256, admission.artifactSetSha256, [], [], ['selector did not return exactly six governed joint selections']);
  const auxiliary = parsedRequirements.data.auxiliarySelections
    ? selectAuxiliaryComponents(parsedRequirements.data.auxiliarySelections, parsedManifest.manifest.components as CatalogComponent[])
    : { selections: [] as RobotAuxiliaryCatalogSelection[], errors: [] as string[] };
  if (auxiliary.errors.length) return result(true, false, false, 'failed', requirementsBytes, admission.manifestSha256, admission.artifactSetSha256, [], [], auxiliary.errors);
  const driveSelections = selected.selections.map(selection => ({ joint: selection.joint, motor: pick(selection.motor), reducer: pick(selection.reducer), bearing: pick(selection.bearing), margins: selection.margins, evidence: selection.evidence }));
  return result(true, true, auxiliaryRequested, auxiliaryRequested ? 'passed' : 'not_run', requirementsBytes, admission.manifestSha256, admission.artifactSetSha256, driveSelections, auxiliary.selections, []);
}

function pick(component: CatalogComponent) { return { id: component.id, model: component.model, artifactHash: component.artifactHash.toLowerCase() }; }
function result(admissionEligible: boolean, selectionReady: boolean, auxiliarySelectionReady: boolean, auxiliarySelectionStatus: RobotCatalogSelectionReport['auxiliarySelectionStatus'], requirementsBytes: Uint8Array, manifestSha256: string, artifactSetSha256: string, selections: RobotCatalogSelectionReport['selections'], auxiliarySelections: RobotAuxiliaryCatalogSelection[], errors: string[]): RobotCatalogSelectionReport {
  return { schema: 'nexyfab.robot-catalog-selection.v1', requirementsSha256: createHash('sha256').update(requirementsBytes).digest('hex'), manifestSha256, artifactSetSha256, admissionEligible, selectionReady, selectionStatus: selectionReady ? 'passed' : errors.length ? 'failed' : 'not_run', releaseReady: false, cadIntegrationStatus: 'not_run', selections, auxiliarySelectionReady, auxiliarySelectionStatus, auxiliarySelections, errors, sideEffects: { persisted: false, catalogActivated: false, cadModified: false, quoteCreated: false, rfqSent: false } };
}

type AuxiliaryRequirements = z.infer<typeof auxiliarySelectionsSchema>;
function selectAuxiliaryComponents(requirements: AuxiliaryRequirements, catalog: readonly CatalogComponent[]): { selections: RobotAuxiliaryCatalogSelection[]; errors: string[] } {
  const byId = new Map(catalog.map(component => [component.id, component])); const errors: string[] = []; const selections: RobotAuxiliaryCatalogSelection[] = [];
  const select = <K extends AuxiliaryComponentKind>(kind: K, pendingComponentId: RobotAuxiliaryCatalogSelection['pendingComponentId'], request: { componentId: string; mount: RobotAuxiliaryMount }, validate: (component: Extract<AuxiliaryCatalogComponent, { kind: K }>) => string[]) => {
    const component = byId.get(request.componentId);
    if (!component || component.kind !== kind) { errors.push(`${pendingComponentId}: explicitly selected ${kind} component ${request.componentId} is missing or wrong kind`); return; }
    const norm = Math.hypot(request.mount.orientation.x, request.mount.orientation.y, request.mount.orientation.z, request.mount.orientation.w);
    if (Math.abs(norm - 1) > 1e-6) errors.push(`${pendingComponentId}: mount orientation must be a normalized quaternion`);
    const ratingErrors = validate(component as Extract<AuxiliaryCatalogComponent, { kind: K }>); errors.push(...ratingErrors.map(error => `${pendingComponentId}: ${error}`));
    if (Math.abs(norm - 1) <= 1e-6 && ratingErrors.length === 0) selections.push({ kind, pendingComponentId, component: pick(component), mount: request.mount, evidence: [`explicit component ${component.id}`, `catalog revision ${component.revision}`, `artifact ${component.artifactHash.toLowerCase()}`] });
  };
  select('brake', 'brake', requirements.brake, component => [
    ...(component.holdingTorqueNm >= requirements.brake.minimumHoldingTorqueNm ? [] : ['holding torque is below the explicit minimum']),
    ...(component.maxRpm >= requirements.brake.minimumMaxRpm ? [] : ['maximum speed is below the explicit minimum']),
    ...(component.ratedVoltageV === requirements.brake.requiredVoltageV ? [] : ['rated voltage does not match the required brake voltage']),
  ]);
  select('encoder', 'encoder', requirements.encoder, component => [
    ...(component.resolutionBits >= requirements.encoder.minimumResolutionBits ? [] : ['resolution is below the explicit minimum']),
    ...(component.accuracyArcsec <= requirements.encoder.maximumAccuracyArcsec ? [] : ['accuracy error exceeds the explicit maximum']),
    ...(component.maxRpm >= requirements.encoder.minimumMaxRpm ? [] : ['maximum speed is below the explicit minimum']),
    ...(component.supplyVoltageV === requirements.encoder.requiredSupplyVoltageV ? [] : ['supply voltage does not match the required encoder voltage']),
  ]);
  select('harness', 'internal_harness', requirements.harness, component => [
    ...(component.conductorCount >= requirements.harness.minimumConductorCount ? [] : ['conductor count is below the explicit minimum']),
    ...(component.ratedVoltageV >= requirements.harness.minimumRatedVoltageV ? [] : ['rated voltage is below the explicit minimum']),
    ...(component.ratedCurrentA >= requirements.harness.minimumRatedCurrentA ? [] : ['rated current is below the explicit minimum']),
    ...(component.minimumBendRadiusMm <= requirements.harness.maximumMinimumBendRadiusMm ? [] : ['minimum bend radius exceeds the available explicit maximum']),
    ...(component.flexLifeCycles >= requirements.harness.minimumFlexLifeCycles ? [] : ['flex life is below the explicit minimum']),
  ]);
  select('tool_connector', 'tool_connector', requirements.toolConnector, component => [
    ...(component.contactCount >= requirements.toolConnector.minimumContactCount ? [] : ['contact count is below the explicit minimum']),
    ...(component.ratedVoltageV >= requirements.toolConnector.minimumRatedVoltageV ? [] : ['rated voltage is below the explicit minimum']),
    ...(component.ratedCurrentA >= requirements.toolConnector.minimumRatedCurrentA ? [] : ['rated current is below the explicit minimum']),
    ...(component.matingCycles >= requirements.toolConnector.minimumMatingCycles ? [] : ['mating life is below the explicit minimum']),
    ...(ipRank(component.ipRating) >= ipRank(requirements.toolConnector.minimumIpRating) ? [] : ['IP rating is below the explicit minimum']),
  ]);
  if (selections.length !== 4 && errors.length === 0) errors.push('exactly four explicit auxiliary selections are required');
  return { selections: errors.length ? [] : selections, errors };
}
function ipRank(value: string): number { const match = /^IP([0-6])(\d)$/.exec(value); return match ? Number(match[1]) * 10 + Number(match[2]) : -1; }
