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
  review: RobotCadIntegrationReviewResult; programBytes: Uint8Array | null; manifestBytes: Uint8Array | null; manifest: AiAssemblyRevisionPackage | null;
  replacedOccurrences: Array<{ joint: number; kind: 'motor' | 'reducer' | 'bearing'; from: string; to: string; componentId: string }>;
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
  const replaceId = (id: string) => idMap.get(id) ?? id; const replaceText = (value: string) => { let result = value; for (const [from, to] of idMap) result = result.replaceAll(from, to); return result; };
  const revised: AiAssemblyProgram = {
    ...program,
    assembly: { ...program.assembly, parts: program.assembly.parts.map(part => { const mapped = idMap.get(part.id); if (!mapped) return { ...part }; const record = replacements.find(item => item.from === part.id)!; const component = components.get(record.componentId)!; return { ...part, id: mapped, name: component.model, partTemplateId: `catalog:${component.id}` }; }), mates: program.assembly.mates.map(mate => ({ ...mate, id: replaceText(mate.id), a: { ...mate.a, partId: replaceId(mate.a.partId) }, b: { ...mate.b, partId: replaceId(mate.b.partId) } })) },
    parts: program.parts.map(part => { const mapped = idMap.get(part.instanceId); if (!mapped) return { ...part }; const record = replacements.find(item => item.from === part.instanceId)!; const component = components.get(record.componentId)!; const definitionId = `catalog:${component.id}`; return { ...part, instanceId: mapped, definitionId, featureTree: envelopeTree(definitionId, component.envelopeMm), metadata: { ...part.metadata, partNumber: component.model, revision: component.revision, material: 'catalog-component', process: 'purchased', source: 'catalog' as const } }; }),
    structure: program.structure?.map(group => ({ ...group, instanceIds: group.instanceIds.map(replaceId) })),
    unresolved: program.unresolved.filter(item => !/^(motor_j[1-6]|reducer_j[1-6]|bearing_set_j[1-6]):/.test(item)),
  };
  const issues = validateAiAssemblyProgram(revised); if (issues.length) return failed(input.packet, review, [`integrated CAD invalid: ${issues[0]!.path}: ${issues[0]!.message}`]);
  const ids = revised.assembly.parts.map(part => part.id); if (new Set(ids).size !== ids.length || replacements.some(item => !ids.includes(item.to) || ids.includes(item.from))) return failed(input.packet, review, ['integrated occurrence IDs are incomplete or duplicated']);
  try { const packaged = await packageAiAssemblyRevision(revised, { lineageId: input.packet.lineageId, revision: input.packet.revision + 1, baseProgramHash: input.packet.programHash }); return { schema: 'nexyfab.robot-cad-integration-application.v1', ok: true, targetHash: input.packet.targetHash, sourceRevision: input.packet.revision, outputRevision: packaged.manifest.revision, review, ...packaged, replacedOccurrences: replacements, cadRevisionCreated: true, cadAppliedToWorkspace: false, releaseReady: false, reverificationRequired: true, errors: [], sideEffects: noEffects() }; }
  catch (cause) { return failed(input.packet, review, [cause instanceof Error ? cause.message : String(cause)]); }
}
function failed(packet: RobotCadIntegrationPacket, review: RobotCadIntegrationReviewResult, errors: string[]): RobotCadIntegrationApplication { return { schema: 'nexyfab.robot-cad-integration-application.v1', ok: false, targetHash: packet.targetHash, sourceRevision: packet.revision, outputRevision: null, review, programBytes: null, manifestBytes: null, manifest: null, replacedOccurrences: [], cadRevisionCreated: false, cadAppliedToWorkspace: false, releaseReady: false, reverificationRequired: true, errors: [...new Set(errors)], sideEffects: noEffects() }; }
function noEffects() { return { persisted: false as const, sourceModified: false as const, workspaceModified: false as const, quoteCreated: false as const, rfqSent: false as const }; }
function envelopeTree(id: string, size: { x: number; y: number; z: number }): FeatureTree { return { nodes: [{ id: `${id}:catalog-envelope`, name: `${id} catalog envelope`, dependencies: [], payload: { kind: 'extrude', loop: [{ x: -size.x / 2, y: -size.y / 2 }, { x: size.x / 2, y: -size.y / 2 }, { x: size.x / 2, y: size.y / 2 }, { x: -size.x / 2, y: size.y / 2 }], depth: size.z, direction: 'one_sided', mode: 'add' } }] }; }
