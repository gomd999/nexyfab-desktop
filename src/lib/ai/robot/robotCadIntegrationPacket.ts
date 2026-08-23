import { createHash } from 'node:crypto';
import { validateAiAssemblyProgram, type AiAssemblyProgram } from '../aiAssemblyProgram';
import { selectRobotCatalogBytes, type RobotAuxiliaryCatalogSelection, type RobotAuxiliaryMount } from './robotCatalogSelection';
import type { AuxiliaryComponentKind } from './componentCatalog';
import { evaluateRobotHousingFitEvidence } from './robotHousingFitEvidence';

const SHA256 = /^[a-f0-9]{64}$/;
type UploadedArtifact = { name: string; bytes: Uint8Array };
export type RobotCadIntegrationPacket = {
  schema: 'nexyfab.robot-cad-integration-review-packet.v1'; targetHash: string;
  lineageId: string; revision: number; baseProgramHash: string; programHash: string; revisionManifestSha256: string;
  requirementsSha256: string; catalogManifestSha256: string; catalogArtifactSetSha256: string; housingSha256: string;
  readiness: 'review_pending' | 'not_ready'; expertReviewRequired: true; cadIntegrationStatus: 'not_applied'; releaseReady: false;
  replacements: Array<{ joint: number; placeholders: { motor: string; reducer: string; bearing: string }; selected: { motor: string; reducer: string; bearing: string }; fitStatus: 'passed' }>;
  auxiliaryAdditions?: Array<{ kind: AuxiliaryComponentKind; pendingComponentId: RobotAuxiliaryCatalogSelection['pendingComponentId']; selected: string; occurrenceId: string; mount: RobotAuxiliaryMount }>;
  errors: string[]; sideEffects: { persisted: false; sourceModified: false; cadModified: false; quoteCreated: false; rfqSent: false };
};
type RobotCadIntegrationTarget = Pick<RobotCadIntegrationPacket, 'lineageId' | 'revision' | 'baseProgramHash' | 'programHash' | 'revisionManifestSha256' | 'requirementsSha256' | 'catalogManifestSha256' | 'catalogArtifactSetSha256' | 'housingSha256' | 'replacements' | 'auxiliaryAdditions'>;

export function hashRobotCadIntegrationTarget(target: RobotCadIntegrationTarget) {
  const body = { lineageId: target.lineageId, revision: target.revision, baseProgramHash: target.baseProgramHash, programHash: target.programHash, revisionManifestSha256: target.revisionManifestSha256, requirementsSha256: target.requirementsSha256, catalogManifestSha256: target.catalogManifestSha256, catalogArtifactSetSha256: target.catalogArtifactSetSha256, housingSha256: target.housingSha256, replacements: target.replacements, ...(target.auxiliaryAdditions?.length ? { auxiliaryAdditions: target.auxiliaryAdditions } : {}) };
  return sha256(new TextEncoder().encode(JSON.stringify(body)));
}

export function buildRobotCadIntegrationPacket(programBytes: Uint8Array, revisionManifestBytes: Uint8Array, housingBytes: Uint8Array, requirementsBytes: Uint8Array, catalogManifestBytes: Uint8Array, uploaded: readonly UploadedArtifact[]): RobotCadIntegrationPacket {
  const programHash = sha256(programBytes); const revisionManifestSha256 = sha256(revisionManifestBytes);
  const selection = selectRobotCatalogBytes(requirementsBytes, catalogManifestBytes, uploaded);
  const housing = evaluateRobotHousingFitEvidence(housingBytes, requirementsBytes, catalogManifestBytes, uploaded);
  const errors = [...selection.errors, ...housing.errors];
  const manifest = parseObject(revisionManifestBytes, 'revision manifest', errors); const program = parseObject(programBytes, 'editable program', errors);
  const lineageId = typeof manifest?.lineageId === 'string' ? manifest.lineageId : ''; const revision = typeof manifest?.revision === 'number' ? manifest.revision : 0; const baseProgramHash = typeof manifest?.baseProgramHash === 'string' ? manifest.baseProgramHash : '';
  if (manifest?.schema !== 'nexyfab.ai-assembly-revision-package.v1') errors.push('unsupported revision manifest schema');
  if (!/^[a-z0-9][a-z0-9._-]{2,127}$/.test(lineageId) || !Number.isInteger(revision) || revision < 2) errors.push('invalid revision lineage or number');
  if (!SHA256.test(baseProgramHash) || manifest?.programHash !== programHash || manifest?.programArtifact !== `editable-program-${programHash}.json`) errors.push('revision manifest is not bound to exact editable program bytes');
  const effects = manifest?.sideEffects as Record<string, unknown> | undefined;
  if (effects?.sourceModified !== false || effects.quoteCreated !== false || effects.rfqSent !== false) errors.push('revision manifest side effects must all be false');
  const typedProgram = program as AiAssemblyProgram | null;
  if (typedProgram) {
    try { const issues = validateAiAssemblyProgram(typedProgram); if (issues.length) errors.push(`editable program invalid: ${issues[0]!.path}: ${issues[0]!.message}`); }
    catch { errors.push('editable program structure is invalid'); }
  }
  const replacements = typedProgram ? buildReplacements(typedProgram, selection, housing, errors) : [];
  const auxiliaryAdditions = typedProgram ? buildAuxiliaryAdditions(typedProgram, selection, errors) : [];
  if (!selection.selectionReady) errors.push('six-axis catalog selection is not ready');
  if (housing.housingStatus !== 'passed') errors.push('six-axis housing fit has not passed');
  if (replacements.length !== 6) errors.push('exactly six governed replacement plans are required');
  if (selection.auxiliarySelectionStatus === 'passed' && auxiliaryAdditions.length !== 4) errors.push('exactly four auxiliary addition plans are required after auxiliary selection');
  const ready = errors.length === 0;
  const binding = { lineageId, revision, baseProgramHash, programHash, revisionManifestSha256, requirementsSha256: selection.requirementsSha256, catalogManifestSha256: selection.manifestSha256, catalogArtifactSetSha256: selection.artifactSetSha256, housingSha256: housing.housingSha256, replacements, auxiliaryAdditions };
  const emittedBinding = { ...binding, replacements: ready ? replacements : [], auxiliaryAdditions: ready ? auxiliaryAdditions : [] };
  return { schema: 'nexyfab.robot-cad-integration-review-packet.v1', targetHash: hashRobotCadIntegrationTarget(emittedBinding), ...emittedBinding, readiness: ready ? 'review_pending' : 'not_ready', expertReviewRequired: true, cadIntegrationStatus: 'not_applied', releaseReady: false, errors: [...new Set(errors)], sideEffects: { persisted: false, sourceModified: false, cadModified: false, quoteCreated: false, rfqSent: false } };
}

function buildAuxiliaryAdditions(program: AiAssemblyProgram, selection: ReturnType<typeof selectRobotCatalogBytes>, errors: string[]): NonNullable<RobotCadIntegrationPacket['auxiliaryAdditions']> {
  if (selection.auxiliarySelectionStatus === 'not_run') return [];
  if (!selection.auxiliarySelectionReady || selection.auxiliarySelections.length !== 4) return [];
  const instanceIds = new Set(program.assembly?.parts?.map(part => part.id) ?? []); const occurrenceIds = new Set<string>();
  return selection.auxiliarySelections.flatMap(item => {
    const occurrenceId = `AUX:${item.kind}:${item.component.id}`;
    if (!instanceIds.has(item.mount.parentPartId)) { errors.push(`${item.pendingComponentId}: explicit mount parent ${item.mount.parentPartId} is absent from the editable program`); return []; }
    if (instanceIds.has(occurrenceId) || occurrenceIds.has(occurrenceId)) { errors.push(`${item.pendingComponentId}: auxiliary occurrence ID is duplicated`); return []; }
    occurrenceIds.add(occurrenceId);
    return [{ kind: item.kind, pendingComponentId: item.pendingComponentId, selected: item.component.id, occurrenceId, mount: item.mount }];
  });
}

function buildReplacements(program: AiAssemblyProgram, selection: ReturnType<typeof selectRobotCatalogBytes>, housing: ReturnType<typeof evaluateRobotHousingFitEvidence>, errors: string[]) {
  const instanceIds = program.assembly?.parts?.map(part => part.id) ?? [];
  return selection.selections.flatMap(item => {
    const pick = (kind: 'motor' | 'reducer' | 'bearing') => instanceIds.filter(id => id.startsWith(`J${item.joint}:${kind}:`));
    const motor = pick('motor'), reducer = pick('reducer'), bearing = pick('bearing'); const fit = housing.fits.find(value => value.joint === item.joint);
    if (motor.length !== 1 || reducer.length !== 1 || bearing.length !== 1) { errors.push(`J${item.joint}: exactly one motor, reducer and bearing occurrence required in editable program`); return []; }
    if (fit?.status !== 'passed') return [];
    return [{ joint: item.joint, placeholders: { motor: motor[0]!, reducer: reducer[0]!, bearing: bearing[0]! }, selected: { motor: item.motor.id, reducer: item.reducer.id, bearing: item.bearing.id }, fitStatus: 'passed' as const }];
  });
}
function parseObject(bytes: Uint8Array, label: string, errors: string[]): Record<string, unknown> | null { try { const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value; } catch { errors.push(`${label} must be valid UTF-8 JSON object`); return null; } }
function sha256(bytes: Uint8Array) { return createHash('sha256').update(bytes).digest('hex'); }
