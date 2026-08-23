import { createHash } from 'node:crypto';
import { verifyRobotEvidenceBundle } from './robotEvidenceBundle';
import { verifyRobotCadIntegrationReview, type RobotCadIntegrationReview } from './robotCadIntegrationReview';
import { hashRobotCadIntegrationTarget, type RobotCadIntegrationPacket } from './robotCadIntegrationPacket';
import { hashRobotCadIntegrationApplication, type RobotCadIntegrationApplication } from './robotCadIntegrationApply';
import { selectRobotCatalogBytes } from './robotCatalogSelection';
import { evaluateRobotHousingFitEvidence } from './robotHousingFitEvidence';
import { validateAiAssemblyProgram, type AiAssemblyProgram } from '../aiAssemblyProgram';
import type { AiAssemblyRevisionPackage } from '../aiAssemblyRevision';
import type { TrustedReviewerKeys } from '@/lib/reference/nativeCadExpertReview';

type Artifact = { name: string; bytes: Uint8Array };
type Receipt = Omit<RobotCadIntegrationApplication, 'programBytes' | 'manifestBytes'>;
const SHA256 = /^[a-f0-9]{64}$/;
const REQUIRED_RELEASE_BLOCKERS = ['nexyfab_exact_cad_evidence_required', 'manufacturing_validation_required', 'final_expert_release_review_required'] as const;

export type RobotPostIntegrationEvidence = {
  schema: 'nexyfab.robot-post-integration-evidence.v1';
  postIntegrationStatus: 'passed' | 'failed' | 'not_run'; integrationAuthorized: boolean; selectedOccurrencesVerified: boolean;
  precisionStatus: 'passed' | 'failed' | 'not_run'; lineageId: string | null; revision: number | null;
  programHash: string; preciseReportHash: string; applicationReceiptHash: string; applicationHash: string;
  targetHash: string; catalogManifestSha256: string; housingSha256: string;
  counts: { selectedOccurrences: number; auxiliaryOccurrences: number; appliedOccurrences: number; catalogUnresolved: number; motionFrames: number; checkedMotionFrames: number; collisionFrames: number; coordinatedMotionFrames: number; checkedCoordinatedMotionFrames: number; coordinatedCollisionFrames: number; preciseInterferences: number };
  releaseReady: false; blockers: string[]; errors: string[];
  sideEffects: { persisted: false; sourceModified: false; workspaceModified: false; quoteCreated: false; rfqSent: false };
};

export function validateRobotPostIntegrationEvidenceClaim(report: RobotPostIntegrationEvidence): string[] {
  const errors: string[] = [];
  if (report.schema !== 'nexyfab.robot-post-integration-evidence.v1') errors.push('post-integration schema mismatch');
  if (report.releaseReady !== false || Object.values(report.sideEffects).some(Boolean)) errors.push('post-integration response claims forbidden release or side effects');
  for (const [field, value] of [['programHash', report.programHash], ['preciseReportHash', report.preciseReportHash], ['applicationReceiptHash', report.applicationReceiptHash], ['applicationHash', report.applicationHash], ['targetHash', report.targetHash], ['catalogManifestSha256', report.catalogManifestSha256], ['housingSha256', report.housingSha256]] as const) if (!SHA256.test(value)) errors.push(`${field} is not a lowercase SHA-256`);
  if (report.postIntegrationStatus === 'passed') {
    if (!report.integrationAuthorized) errors.push('passed post-integration report is not authorized');
    if (!report.selectedOccurrencesVerified) errors.push('passed post-integration report has unverified occurrences');
    if (report.precisionStatus !== 'passed') errors.push('passed post-integration report has non-passing precision');
    if (report.errors.length !== 0) errors.push('passed post-integration report contains errors');
    const expectedCounts: Partial<RobotPostIntegrationEvidence['counts']> = { selectedOccurrences: 18, auxiliaryOccurrences: 4, appliedOccurrences: 22, catalogUnresolved: 0, motionFrames: 156, checkedMotionFrames: 156, collisionFrames: 0, coordinatedMotionFrames: 49, checkedCoordinatedMotionFrames: 49, coordinatedCollisionFrames: 0, preciseInterferences: 0 };
    for (const [field, expected] of Object.entries(expectedCounts)) if (report.counts[field as keyof typeof report.counts] !== expected) errors.push(`passed post-integration report has contradictory ${field}`);
    for (const blocker of REQUIRED_RELEASE_BLOCKERS) if (!report.blockers.includes(blocker)) errors.push(`passed post-integration report omits ${blocker}`);
  }
  return [...new Set(errors)];
}

export async function verifyRobotPostIntegrationEvidence(input: { programBytes: Uint8Array; revisionManifestBytes: Uint8Array; preciseReportBytes: Uint8Array; applicationReceiptBytes: Uint8Array; packet: RobotCadIntegrationPacket; review: RobotCadIntegrationReview; housingBytes: Uint8Array; requirementsBytes: Uint8Array; catalogManifestBytes: Uint8Array; artifacts: readonly Artifact[]; trustedKeys: TrustedReviewerKeys }): Promise<RobotPostIntegrationEvidence> {
  const errors: string[] = [];
  const programHash = sha(input.programBytes); const preciseReportHash = sha(input.preciseReportBytes); const applicationReceiptHash = sha(input.applicationReceiptBytes);
  const selection = selectRobotCatalogBytes(input.requirementsBytes, input.catalogManifestBytes, input.artifacts);
  const housing = evaluateRobotHousingFitEvidence(input.housingBytes, input.requirementsBytes, input.catalogManifestBytes, input.artifacts);
  const authorization = verifyRobotCadIntegrationReview(input.packet, input.review, input.trustedKeys);
  if (!authorization.approved) errors.push(...authorization.errors, 'integration authorization is invalid');
  if (hashRobotCadIntegrationTarget(input.packet) !== input.packet.targetHash) errors.push('integration packet target hash mismatch');

  let manifest: AiAssemblyRevisionPackage | null = null; let program: AiAssemblyProgram | null = null; let receipt: Receipt | null = null;
  try { manifest = parse(input.revisionManifestBytes) as unknown as AiAssemblyRevisionPackage; } catch { errors.push('r+1 revision manifest must be valid UTF-8 JSON object'); }
  try { program = parse(input.programBytes) as unknown as AiAssemblyProgram; } catch { errors.push('r+1 program must be valid UTF-8 JSON object'); }
  try { receipt = parse(input.applicationReceiptBytes) as unknown as Receipt; } catch { errors.push('integration application receipt must be valid UTF-8 JSON object'); }
  if (!manifest || manifest.schema !== 'nexyfab.ai-assembly-revision-package.v1' || manifest.lineageId !== input.packet.lineageId || manifest.revision !== input.packet.revision + 1 || manifest.baseProgramHash !== input.packet.programHash || manifest.programHash !== programHash || manifest.programArtifact !== `editable-program-${programHash}.json` || manifest.sideEffects?.sourceModified !== false || manifest.sideEffects.quoteCreated !== false || manifest.sideEffects.rfqSent !== false) errors.push('r+1 revision manifest is not correctly bound to approved source');
  if (program) { try { const issues = validateAiAssemblyProgram(program); if (issues.length) errors.push(`r+1 program invalid: ${issues[0]!.path}: ${issues[0]!.message}`); } catch { errors.push('r+1 program structure is invalid'); } }

  const expectedDrive = input.packet.replacements.flatMap(item => (['motor', 'reducer', 'bearing'] as const).map(kind => ({ joint: item.joint, kind, from: item.placeholders[kind], to: `J${item.joint}:${kind}:${item.selected[kind]}`, componentId: item.selected[kind] })));
  const replacementMap = new Map(expectedDrive.map(item => [item.from, item.to]));
  const expectedAuxiliary = (input.packet.auxiliaryAdditions ?? []).map(item => ({ kind: item.kind, occurrenceId: item.occurrenceId, componentId: item.selected, parentPartId: replacementMap.get(item.mount.parentPartId) ?? item.mount.parentPartId }));
  const receiptDrive = Array.isArray(receipt?.replacedOccurrences) ? receipt.replacedOccurrences : [];
  const receiptAuxiliary = Array.isArray(receipt?.addedOccurrences) ? receipt.addedOccurrences : [];
  const receiptManifest = receipt?.manifest;
  const receiptBindingValid = !!receipt && receipt.schema === 'nexyfab.robot-cad-integration-application.v1' && receipt.ok === true && receipt.review?.approved === true && receipt.errors?.length === 0 && receipt.targetHash === input.packet.targetHash && receipt.sourceRevision === input.packet.revision && receipt.outputRevision === input.packet.revision + 1 && receipt.cadRevisionCreated === true && receipt.cadAppliedToWorkspace === false && receipt.releaseReady === false && receipt.reverificationRequired === true && receiptManifest?.schema === 'nexyfab.ai-assembly-revision-package.v1' && receiptManifest.lineageId === input.packet.lineageId && receiptManifest.baseProgramHash === input.packet.programHash && receiptManifest.programHash === programHash && receiptManifest.programArtifact === `editable-program-${programHash}.json` && receiptManifest.revision === input.packet.revision + 1 && receiptManifest.sideEffects?.sourceModified === false && receiptManifest.sideEffects.quoteCreated === false && receiptManifest.sideEffects.rfqSent === false && receipt.catalogManifestSha256 === input.packet.catalogManifestSha256 && receipt.catalogManifestSha256 === selection.manifestSha256 && receipt.catalogUnresolvedCount === 0 && receipt.appliedOccurrenceCounts?.drive === 18 && receipt.appliedOccurrenceCounts.auxiliary === 4 && receipt.appliedOccurrenceCounts.total === 22 && JSON.stringify(receiptDrive) === JSON.stringify(expectedDrive) && JSON.stringify(receiptAuxiliary) === JSON.stringify(expectedAuxiliary);
  if (!receiptBindingValid) errors.push('integration application receipt is invalid or mismatched');
  const computedApplicationHash = receipt && manifest && Number.isInteger(receipt.outputRevision) ? hashRobotCadIntegrationApplication({ targetHash: receipt.targetHash, lineageId: manifest.lineageId, sourceRevision: receipt.sourceRevision, outputRevision: receipt.outputRevision!, programHash, catalogManifestSha256: receipt.catalogManifestSha256, catalogUnresolvedCount: receipt.catalogUnresolvedCount!, replacedOccurrences: receiptDrive, addedOccurrences: receiptAuxiliary }) : '';
  if (!receipt || !SHA256.test(receipt.applicationHash ?? '') || receipt.applicationHash !== computedApplicationHash) errors.push('integration application hash mismatch');

  const assemblyIds = new Set(program?.assembly.parts.map(part => part.id) ?? []); const partIds = new Set(program?.parts.map(part => part.instanceId) ?? []);
  const exactDriveIds = expectedDrive.map(item => item.to); const exactAuxiliaryIds = expectedAuxiliary.map(item => item.occurrenceId); const expectedIds = [...exactDriveIds, ...exactAuxiliaryIds];
  const catalogOccurrences = program?.parts.filter(part => part.definitionId?.startsWith('catalog:') === true).map(part => part.instanceId) ?? [];
  const selectedOccurrencesVerified = expectedDrive.length === 18 && expectedAuxiliary.length === 4 && new Set(expectedAuxiliary.map(item => item.kind)).size === 4 && expectedIds.every(id => assemblyIds.has(id) && partIds.has(id)) && expectedDrive.every(item => !assemblyIds.has(item.from) && !partIds.has(item.from)) && catalogOccurrences.length === 22 && new Set(catalogOccurrences).size === 22 && catalogOccurrences.every(id => expectedIds.includes(id));
  if (!selectedOccurrencesVerified) errors.push('r+1 does not contain the exact 18 drive and 4 auxiliary approved occurrences');
  const catalogUnresolved = program?.unresolved.length ?? -1;
  if (catalogUnresolved !== 0 || receipt?.catalogUnresolvedCount !== catalogUnresolved) errors.push('r+1 catalog unresolved count is not exactly zero and receipt-bound');

  if (!selection.selectionReady || selection.auxiliarySelectionReady !== true || selection.auxiliarySelectionStatus !== 'passed' || selection.auxiliarySelections.length !== 4) errors.push(...selection.errors, 'catalog selection revalidation failed');
  if (housing.housingStatus !== 'passed') errors.push(...housing.errors, 'housing fit revalidation failed');
  let precise: Awaited<ReturnType<typeof verifyRobotEvidenceBundle>> | null = null;
  try { precise = await verifyRobotEvidenceBundle(input.preciseReportBytes, input.programBytes); } catch (cause) { errors.push(cause instanceof Error ? cause.message : String(cause)); }
  if (precise && (precise.reportHash !== preciseReportHash || precise.lineageId !== input.packet.lineageId || precise.revision !== input.packet.revision + 1 || precise.programHash !== programHash)) errors.push('precise report hash/lineage/revision/program binding mismatch');
  const precisionStatus = !precise ? 'not_run' : precise.motionConverged === true && precise.motionFrames === 156 && precise.checkedMotionFrames === 156 && precise.collisionFrames === 0 && precise.coordinatedMotionConverged === true && precise.coordinatedMotionFrames === 49 && precise.checkedCoordinatedMotionFrames === 49 && precise.coordinatedCollisionFrames === 0 && precise.flaggedInterferences === 0 ? 'passed' : 'failed';
  if (precisionStatus === 'failed') errors.push('post-integration precise isolated-axis/coordinated motion and interference verification did not pass');

  const catalogReady = selection.selectionReady && selection.auxiliarySelectionReady === true && selection.auxiliarySelectionStatus === 'passed';
  const evidenceReady = authorization.approved && receiptBindingValid && receipt?.applicationHash === computedApplicationHash && selectedOccurrencesVerified && catalogUnresolved === 0 && catalogReady && housing.housingStatus === 'passed' && precisionStatus === 'passed' && errors.length === 0;
  const status = !precise || !authorization.approved || !catalogReady || housing.housingStatus === 'not_run' ? 'not_run' : evidenceReady ? 'passed' : 'failed';
  const blockers = [...(precisionStatus !== 'passed' ? ['post_integration_precision_not_passed'] : []), ...(!selectedOccurrencesVerified ? ['selected_occurrences_not_verified'] : []), ...(catalogUnresolved !== 0 ? ['catalog_unresolved_not_zero'] : []), ...(!receiptBindingValid ? ['application_receipt_not_bound'] : []), ...(!catalogReady ? ['catalog_revalidation_not_passed'] : []), ...(housing.housingStatus !== 'passed' ? ['housing_revalidation_not_passed'] : []), ...REQUIRED_RELEASE_BLOCKERS];
  const report: RobotPostIntegrationEvidence = { schema: 'nexyfab.robot-post-integration-evidence.v1', postIntegrationStatus: status, integrationAuthorized: authorization.approved, selectedOccurrencesVerified, precisionStatus, lineageId: precise?.lineageId ?? manifest?.lineageId ?? null, revision: precise?.revision ?? manifest?.revision ?? null, programHash, preciseReportHash, applicationReceiptHash, applicationHash: SHA256.test(receipt?.applicationHash ?? '') ? receipt!.applicationHash! : '0'.repeat(64), targetHash: input.packet.targetHash, catalogManifestSha256: selection.manifestSha256, housingSha256: housing.housingSha256, counts: { selectedOccurrences: exactDriveIds.filter(id => assemblyIds.has(id) && partIds.has(id)).length, auxiliaryOccurrences: exactAuxiliaryIds.filter(id => assemblyIds.has(id) && partIds.has(id)).length, appliedOccurrences: expectedIds.filter(id => assemblyIds.has(id) && partIds.has(id)).length, catalogUnresolved: Math.max(0, catalogUnresolved), motionFrames: precise?.motionFrames ?? 0, checkedMotionFrames: precise?.checkedMotionFrames ?? 0, collisionFrames: precise?.collisionFrames ?? 0, coordinatedMotionFrames: precise?.coordinatedMotionFrames ?? 0, checkedCoordinatedMotionFrames: precise?.checkedCoordinatedMotionFrames ?? 0, coordinatedCollisionFrames: precise?.coordinatedCollisionFrames ?? 0, preciseInterferences: precise?.flaggedInterferences ?? 0 }, releaseReady: false, blockers: [...new Set(blockers)], errors: [...new Set(errors)], sideEffects: { persisted: false, sourceModified: false, workspaceModified: false, quoteCreated: false, rfqSent: false } };
  if (report.postIntegrationStatus === 'passed') report.errors.push(...validateRobotPostIntegrationEvidenceClaim(report));
  if (report.errors.length) report.postIntegrationStatus = 'failed';
  return report;
}

function parse(bytes: Uint8Array) { const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value as Record<string, unknown>; }
function sha(bytes: Uint8Array) { return createHash('sha256').update(bytes).digest('hex'); }
