import { createHash } from 'node:crypto';
import { parseRobotCatalogManifestBytes } from './robotCatalogAdmission';
import { buildRobotCadIntegrationPacket, type RobotCadIntegrationPacket } from './robotCadIntegrationPacket';
import { verifyRobotCadIntegrationReview, type RobotCadIntegrationReview, type RobotCadIntegrationReviewResult } from './robotCadIntegrationReview';
import { packageAiAssemblyRevision, type AiAssemblyRevisionPackage } from '../aiAssemblyRevision';
import { validateAiAssemblyProgram, type AiAssemblyProgram } from '../aiAssemblyProgram';
import type { CatalogComponent } from './componentCatalog';
import type { TrustedReviewerKeys } from '@/lib/reference/nativeCadExpertReview';
import type { FeatureTree } from '@/lib/cad/featureTree';

type Artifact = { name: string; bytes: Uint8Array };
export type RobotCadIntegrationApplication = {
  schema: 'nexyfab.robot-cad-integration-application.v1'; ok: boolean; targetHash: string; sourceRevision: number; outputRevision: number | null;
  applicationHash: string | null; catalogManifestSha256: string; catalogUnresolvedCount: number | null;
  appliedOccurrenceCounts: { drive: number; auxiliary: number; total: number };
  review: RobotCadIntegrationReviewResult; programBytes: Uint8Array | null; manifestBytes: Uint8Array | null; manifest: AiAssemblyRevisionPackage | null;
  replacedOccurrences: Array<{ joint: number; kind: 'motor' | 'reducer' | 'bearing'; from: string; to: string; componentId: string }>;
  addedOccurrences: Array<{ kind: 'brake' | 'encoder' | 'harness' | 'tool_connector'; occurrenceId: string; componentId: string; parentPartId: string }>;
  cadRevisionCreated: boolean; cadAppliedToWorkspace: false; releaseReady: false; reverificationRequired: true; errors: string[];
  sideEffects: { persisted: false; sourceModified: false; workspaceModified: false; quoteCreated: false; rfqSent: false };
};

export async function createApprovedRobotCadIntegrationRevision(input: { programBytes: Uint8Array; revisionManifestBytes: Uint8Array; packet: RobotCadIntegrationPacket; review: RobotCadIntegrationReview; housingBytes: Uint8Array; requirementsBytes: Uint8Array; catalogManifestBytes: Uint8Array; artifacts: readonly Artifact[]; trustedKeys: TrustedReviewerKeys }): Promise<RobotCadIntegrationApplication> {
  const rebuilt = buildRobotCadIntegrationPacket(input.programBytes, input.revisionManifestBytes, input.housingBytes, input.requirementsBytes, input.catalogManifestBytes, input.artifacts);
  const errors: string[] = [];
  if (rebuilt.readiness !== 'review_pending' || rebuilt.targetHash !== input.packet.targetHash || JSON.stringify(rebuilt) !== JSON.stringify(input.packet)) errors.push('integration packet does not match freshly revalidated source evidence');
  const review = verifyRobotCadIntegrationReview(input.packet, input.review, input.trustedKeys);
  if (!review.approved) errors.push(...review.errors, 'integration expert review is not approved');
  const parsedCatalog = parseRobotCatalogManifestBytes(input.catalogManifestBytes); if (!parsedCatalog.manifest) errors.push(...parsedCatalog.errors);
  let program: AiAssemblyProgram | null = null;
  try { program = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(input.programBytes)) as AiAssemblyProgram; } catch { errors.push('editable program must be valid UTF-8 JSON'); }
  if (errors.length || !program || !parsedCatalog.manifest) return failed(input.packet, review, errors);
  const components = new Map(parsedCatalog.manifest.components.map(component => [component.id, component as CatalogComponent])); const replacements: RobotCadIntegrationApplication['replacedOccurrences'] = []; const idMap = new Map<string, string>();
  for (const plan of input.packet.replacements) for (const kind of ['motor', 'reducer', 'bearing'] as const) { const from = plan.placeholders[kind], componentId = plan.selected[kind], component = components.get(componentId); if (!component || component.kind !== kind) errors.push(`J${plan.joint}: selected ${kind} ${componentId} missing or wrong kind`); else { const to = `J${plan.joint}:${kind}:${component.id}`; if (idMap.has(from) || [...idMap.values()].includes(to)) errors.push(`J${plan.joint}: occurrence replacement is not unique`); else { idMap.set(from, to); replacements.push({ joint: plan.joint, kind, from, to, componentId }); } } }
  if (replacements.length !== 18 || errors.length) return failed(input.packet, review, errors.length ? errors : ['exactly 18 drive occurrences must be replaced']);
  const auxiliaryPlans = input.packet.auxiliaryAdditions ?? []; const addedOccurrences: RobotCadIntegrationApplication['addedOccurrences'] = [];
  if (auxiliaryPlans.length !== 4) errors.push('full robot CAD integration requires exactly four approved auxiliary additions');
  const sourceIds = new Set(program.assembly.parts.map(part => part.id)); const auxiliaryIds = new Set<string>();
  for (const plan of auxiliaryPlans) {
    const component = components.get(plan.selected); const parentPartId = idMap.get(plan.mount.parentPartId) ?? plan.mount.parentPartId;
    if (!component || component.kind !== plan.kind) errors.push(`${plan.pendingComponentId}: selected auxiliary ${plan.selected} missing or wrong kind`);
    else if (!sourceIds.has(plan.mount.parentPartId)) errors.push(`${plan.pendingComponentId}: explicit mount parent ${plan.mount.parentPartId} is absent`);
    else if (sourceIds.has(plan.occurrenceId) || auxiliaryIds.has(plan.occurrenceId)) errors.push(`${plan.pendingComponentId}: auxiliary occurrence ID is not unique`);
    else { auxiliaryIds.add(plan.occurrenceId); addedOccurrences.push({ kind: plan.kind, occurrenceId: plan.occurrenceId, componentId: component.id, parentPartId }); }
  }
  if (errors.length || addedOccurrences.length !== auxiliaryPlans.length) return failed(input.packet, review, errors.length ? errors : ['approved auxiliary occurrences are incomplete']);
  const replaceId = (id: string) => idMap.get(id) ?? id; const replaceText = (value: string) => { let result = value; for (const [from, to] of idMap) result = result.replaceAll(from, to); return result; };
  const auxiliaryAssemblyParts = auxiliaryPlans.map(plan => { const component = components.get(plan.selected)!; return { id: plan.occurrenceId, name: component.model, partTemplateId: `catalog:${component.id}`, position: { ...plan.mount.positionMm }, orientation: { ...plan.mount.orientation }, fixed: false }; });
  const auxiliaryParts = auxiliaryPlans.map(plan => { const component = components.get(plan.selected)!; const definitionId = `catalog:${component.id}`; return { instanceId: plan.occurrenceId, definitionId, featureTree: envelopeTree(definitionId, component.envelopeMm), metadata: { partNumber: component.model, revision: component.revision, material: 'catalog-component', process: 'purchased', quantity: 1, source: 'catalog' as const } }; });
  const auxiliaryMates = auxiliaryPlans.flatMap(plan => { const component = components.get(plan.selected)!; const parentPartId = replaceId(plan.mount.parentPartId); return [
    { id: `${plan.occurrenceId}:axis`, kind: 'concentric' as const, a: { partId: parentPartId, refId: plan.mount.parentAxisRef, refKind: 'axis' as const }, b: { partId: plan.occurrenceId, refId: component.interface.axisRef, refKind: 'axis' as const } },
    { id: `${plan.occurrenceId}:mount`, kind: 'coincident' as const, a: { partId: parentPartId, refId: plan.mount.parentPlaneRef, refKind: 'plane' as const }, b: { partId: plan.occurrenceId, refId: component.interface.mountingPlaneRef, refKind: 'plane' as const } },
  ]; });
  const resolvedAuxiliary = new Set<string>(auxiliaryPlans.map(plan => plan.pendingComponentId));
  const revised: AiAssemblyProgram = {
    ...program,
    assembly: { ...program.assembly, parts: [...program.assembly.parts.map(part => { const mapped = idMap.get(part.id); if (!mapped) return { ...part }; const record = replacements.find(item => item.from === part.id)!; const component = components.get(record.componentId)!; return { ...part, id: mapped, name: component.model, partTemplateId: `catalog:${component.id}` }; }), ...auxiliaryAssemblyParts], mates: [...program.assembly.mates.map(mate => ({ ...mate, id: replaceText(mate.id), a: { ...mate.a, partId: replaceId(mate.a.partId) }, b: { ...mate.b, partId: replaceId(mate.b.partId) } })), ...auxiliaryMates] },
    parts: [...program.parts.map(part => { const mapped = idMap.get(part.instanceId); if (!mapped) return { ...part }; const record = replacements.find(item => item.from === part.instanceId)!; const component = components.get(record.componentId)!; const definitionId = `catalog:${component.id}`; return { ...part, instanceId: mapped, definitionId, featureTree: envelopeTree(definitionId, component.envelopeMm), metadata: { ...part.metadata, partNumber: component.model, revision: component.revision, material: 'catalog-component', process: 'purchased', source: 'catalog' as const } }; }), ...auxiliaryParts],
    structure: [...(program.structure?.map(group => ({ ...group, instanceIds: group.instanceIds.map(replaceId) })) ?? []), ...(auxiliaryPlans.length ? [{ id: 'robot-auxiliary', name: 'Robot auxiliary catalog components', instanceIds: auxiliaryPlans.map(plan => plan.occurrenceId), rigid: true }] : [])],
    unresolved: program.unresolved.filter(item => !/^(motor_j[1-6]|reducer_j[1-6]|bearing_set_j[1-6]):/.test(item) && !resolvedAuxiliary.has(item.split(':', 1)[0]!)),
  };
  const issues = validateAiAssemblyProgram(revised); if (issues.length) return failed(input.packet, review, [`integrated CAD invalid: ${issues[0]!.path}: ${issues[0]!.message}`]);
  const ids = revised.assembly.parts.map(part => part.id); if (new Set(ids).size !== ids.length || replacements.some(item => !ids.includes(item.to) || ids.includes(item.from)) || addedOccurrences.some(item => !ids.includes(item.occurrenceId))) return failed(input.packet, review, ['integrated occurrence IDs are incomplete or duplicated']);
  if (revised.unresolved.length !== 0) return failed(input.packet, review, [`integrated r+1 retains ${revised.unresolved.length} unresolved catalog components`]);
  try {
    const packaged = await packageAiAssemblyRevision(revised, { lineageId: input.packet.lineageId, revision: input.packet.revision + 1, baseProgramHash: input.packet.programHash });
    const binding = { targetHash: input.packet.targetHash, lineageId: input.packet.lineageId, sourceRevision: input.packet.revision, outputRevision: packaged.manifest.revision, programHash: packaged.manifest.programHash, catalogManifestSha256: input.packet.catalogManifestSha256, catalogUnresolvedCount: revised.unresolved.length, replacedOccurrences: replacements, addedOccurrences };
    return { schema: 'nexyfab.robot-cad-integration-application.v1', ok: true, targetHash: input.packet.targetHash, sourceRevision: input.packet.revision, outputRevision: packaged.manifest.revision, applicationHash: hashRobotCadIntegrationApplication(binding), catalogManifestSha256: input.packet.catalogManifestSha256, catalogUnresolvedCount: revised.unresolved.length, appliedOccurrenceCounts: { drive: replacements.length, auxiliary: addedOccurrences.length, total: replacements.length + addedOccurrences.length }, review, ...packaged, replacedOccurrences: replacements, addedOccurrences, cadRevisionCreated: true, cadAppliedToWorkspace: false, releaseReady: false, reverificationRequired: true, errors: [], sideEffects: noEffects() };
  }
  catch (cause) { return failed(input.packet, review, [cause instanceof Error ? cause.message : String(cause)]); }
}
export function hashRobotCadIntegrationApplication(value: { targetHash: string; lineageId: string; sourceRevision: number; outputRevision: number; programHash: string; catalogManifestSha256: string; catalogUnresolvedCount: number; replacedOccurrences: RobotCadIntegrationApplication['replacedOccurrences']; addedOccurrences: RobotCadIntegrationApplication['addedOccurrences'] }) { return createHash('sha256').update(JSON.stringify({ targetHash: value.targetHash, lineageId: value.lineageId, sourceRevision: value.sourceRevision, outputRevision: value.outputRevision, programHash: value.programHash, catalogManifestSha256: value.catalogManifestSha256, catalogUnresolvedCount: value.catalogUnresolvedCount, replacedOccurrences: value.replacedOccurrences, addedOccurrences: value.addedOccurrences })).digest('hex'); }
function failed(packet: RobotCadIntegrationPacket, review: RobotCadIntegrationReviewResult, errors: string[]): RobotCadIntegrationApplication { return { schema: 'nexyfab.robot-cad-integration-application.v1', ok: false, targetHash: packet.targetHash, sourceRevision: packet.revision, outputRevision: null, applicationHash: null, catalogManifestSha256: packet.catalogManifestSha256, catalogUnresolvedCount: null, appliedOccurrenceCounts: { drive: 0, auxiliary: 0, total: 0 }, review, programBytes: null, manifestBytes: null, manifest: null, replacedOccurrences: [], addedOccurrences: [], cadRevisionCreated: false, cadAppliedToWorkspace: false, releaseReady: false, reverificationRequired: true, errors: [...new Set(errors)], sideEffects: noEffects() }; }
function noEffects() { return { persisted: false as const, sourceModified: false as const, workspaceModified: false as const, quoteCreated: false as const, rfqSent: false as const }; }
function envelopeTree(id: string, size: { x: number; y: number; z: number }): FeatureTree { return { nodes: [{ id: `${id}:catalog-envelope`, name: `${id} catalog envelope`, dependencies: [], payload: { kind: 'extrude', loop: [{ x: -size.x / 2, y: -size.y / 2 }, { x: size.x / 2, y: -size.y / 2 }, { x: size.x / 2, y: size.y / 2 }, { x: -size.x / 2, y: size.y / 2 }], depth: size.z, direction: 'one_sided', mode: 'add' } }] }; }
