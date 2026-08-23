'use client';

import { useState } from 'react';
import type { IsoLang } from '@/lib/i18n/normalize';
import type { AiAssemblyProgram } from '@/lib/ai/aiAssemblyProgram';
import { ROBOT_6AXIS_DEMONSTRATOR_SPEC } from '@/lib/ai/robot/robotDemonstrator';
import { verifyRobotEvidenceBundle, type RobotEvidenceSummary } from '@/lib/ai/robot/robotEvidenceBundle';
import { compareRobotEvidenceRevisions, type RobotRemediationTransition } from '@/lib/ai/robot/robotRemediationTransition';
import { ASSEMBLY_FOCUS_PARTS_EVENT, ASSEMBLY_FOCUS_RESULT_EVENT, type AssemblyFocusResultDetail } from '@/lib/assembly/assemblyFocusEvent';
import { AI_ASSEMBLY_REVISION_REQUEST_EVENT, AI_ASSEMBLY_REVISION_RESULT_EVENT, type AiAssemblyRevisionResult } from '@/lib/ai/aiAssemblyRevisionEvent';
import { downloadBlob } from '@/lib/platform';
import type { RobotCatalogAdmissionReport } from '@/lib/ai/robot/robotCatalogAdmission';
import type { RobotCatalogSelectionReport } from '@/lib/ai/robot/robotCatalogSelection';
import type { RobotHousingFitEvidenceReport } from '@/lib/ai/robot/robotHousingFitEvidence';
import type { RobotCadIntegrationPacket } from '@/lib/ai/robot/robotCadIntegrationPacket';
import type { RobotCadIntegrationReviewResult } from '@/lib/ai/robot/robotCadIntegrationReview';
import type { RobotPostIntegrationEvidence } from '@/lib/ai/robot/robotPostIntegrationEvidence';
import type { RobotReleaseEvidenceAuditV2 } from '@/lib/ai/robot/robotReleaseEvidenceAuditV2';
import type { RobotFinalReleaseDecision } from '@/lib/ai/robot/robotFinalReleaseReview';
import type { RobotReleaseWorkPacketV2 } from '@/lib/ai/robot/robotReleaseWorkPacketV2';
import type { AdaptiveComplexProductExecutionPlan } from '@/lib/ai/adaptiveComplexProductExecution';
import type { GenerationRunState } from '@/lib/ai/generationRunState';
import RobotEngineeringAnalysisPanel from './RobotEngineeringAnalysisPanel';
import RobotVerifiedSystemsPanel from './RobotVerifiedSystemsPanel';

type GateState = 'passed' | 'failed' | 'not_run' | 'blocked';
type RobotGenerateResponse = {
  ok: boolean;
  program?: AiAssemblyProgram;
  selectionRequirements?: { ok: boolean; requirements?: unknown[]; errors?: string[] };
  catalogEvidence?: { status: string; previewOnly: boolean; productionEligible: boolean };
  housingFit?: { status: 'passed' | 'failed' | 'not_run'; reason?: string };
  engineering?: { designOk: boolean; selfCollision: { count: number }; errors: string[] };
  releaseReady?: boolean;
  releaseBlockers?: string[];
  productObjective?: 'complete_manufacturing_product';
  generationState?: GenerationRunState;
  executionPlan?: AdaptiveComplexProductExecutionPlan;
  message?: string;
};

export interface RobotPrecisionHandoffPanelProps {
  lang: 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';
  onHandoff: (program: AiAssemblyProgram) => void;
  generate?: () => Promise<RobotGenerateResponse>;
  verifyEvidence?: typeof verifyRobotEvidenceBundle;
  reverifyRevision?: (program: File, manifest: File) => Promise<unknown>;
  admitCatalog?: (manifest: File, artifacts: File[]) => Promise<RobotCatalogAdmissionReport>;
  selectCatalog?: (requirements: File, manifest: File, artifacts: File[]) => Promise<RobotCatalogSelectionReport>;
  evaluateHousing?: (housing: File, requirements: File, manifest: File, artifacts: File[]) => Promise<RobotHousingFitEvidenceReport>;
  prepareIntegration?: (program: File, revision: File, housing: File, requirements: File, manifest: File, artifacts: File[]) => Promise<RobotCadIntegrationPacket>;
  validateIntegrationReview?: (packet: File, review: File) => Promise<RobotCadIntegrationReviewResult>;
  applyIntegration?: (program: File, revision: File, packet: File, review: File, housing: File, requirements: File, manifest: File, artifacts: File[]) => Promise<{ bundle: Blob; filename: string; targetHash: string; programHash: string; revision: number; applicationHash: string; applicationReceiptHash: string; driveOccurrences: 18; auxiliaryOccurrences: 4; catalogUnresolved: 0; cadAppliedToWorkspace: false; releaseReady: false }>;
  postVerifyIntegration?: (program: File, revision: File, preciseReport: File, receipt: File, packet: File, review: File, housing: File, requirements: File, manifest: File, artifacts: File[]) => Promise<RobotPostIntegrationEvidence>;
  auditReleaseEvidence?: (post: File, exactCad: File | null, manufacturing: File | null) => Promise<RobotReleaseEvidenceAuditV2>;
  validateFinalReleaseReview?: (audit: File, review: File) => Promise<RobotFinalReleaseDecision>;
  buildReleaseWorkPacket?: (post: File) => Promise<RobotReleaseWorkPacketV2>;
}

function localized(lang: IsoLang, values: Record<IsoLang, string>): string {
  return values[lang];
}

const defaultGenerate = async (): Promise<RobotGenerateResponse> => {
  const response = await fetch('/api/cad/v1/robot/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'NexyFab 6-axis engineering template', spec: ROBOT_6AXIS_DEMONSTRATOR_SPEC }),
  });
  const body = await response.json() as RobotGenerateResponse;
  if (!response.ok || !body.ok) throw new Error(body.message ?? `Robot generation failed (${response.status})`);
  return body;
};

const defaultReverifyRevision = async (program: File, manifest: File): Promise<unknown> => {
  const form = new FormData(); form.set('program', program); form.set('manifest', manifest);
  const response = await fetch('/api/cad/v1/robot/reverify', { method: 'POST', body: form });
  const body = await response.json() as { ok?: boolean; message?: string };
  if (!response.ok || body.ok !== true) throw new Error(body.message ?? `Robot reverification failed (${response.status})`);
  return body;
};
const defaultAdmitCatalog = async (manifest: File, artifacts: File[]): Promise<RobotCatalogAdmissionReport> => {
  const form = new FormData(); form.set('manifest', manifest); for (const artifact of artifacts) form.append('artifact', artifact);
  const response = await fetch('/api/cad/v1/robot/catalog/admit', { method: 'POST', body: form });
  const body = await response.json() as { report?: RobotCatalogAdmissionReport; message?: string };
  if (!body.report) throw new Error(body.message ?? `Catalog admission failed (${response.status})`);
  return body.report;
};
const defaultSelectCatalog = async (requirements: File, manifest: File, artifacts: File[]): Promise<RobotCatalogSelectionReport> => {
  const form = new FormData(); form.set('requirements', requirements); form.set('manifest', manifest); for (const artifact of artifacts) form.append('artifact', artifact);
  const response = await fetch('/api/cad/v1/robot/catalog/select', { method: 'POST', body: form }); const body = await response.json() as { report?: RobotCatalogSelectionReport; message?: string };
  if (!body.report) throw new Error(body.message ?? `Catalog selection failed (${response.status})`); return body.report;
};
const defaultEvaluateHousing = async (housing: File, requirements: File, manifest: File, artifacts: File[]): Promise<RobotHousingFitEvidenceReport> => {
  const form = new FormData(); form.set('housing', housing); form.set('requirements', requirements); form.set('manifest', manifest); for (const artifact of artifacts) form.append('artifact', artifact);
  const response = await fetch('/api/cad/v1/robot/catalog/housing-fit', { method: 'POST', body: form }); const body = await response.json() as { report?: RobotHousingFitEvidenceReport; message?: string };
  if (!body.report) throw new Error(body.message ?? `Housing fit evaluation failed (${response.status})`); return body.report;
};
const defaultPrepareIntegration = async (program: File, revision: File, housing: File, requirements: File, manifest: File, artifacts: File[]): Promise<RobotCadIntegrationPacket> => {
  const form = new FormData(); form.set('program', program); form.set('revision', revision); form.set('housing', housing); form.set('requirements', requirements); form.set('manifest', manifest); for (const artifact of artifacts) form.append('artifact', artifact);
  const response = await fetch('/api/cad/v1/robot/integration/prepare', { method: 'POST', body: form }); const body = await response.json() as { packet?: RobotCadIntegrationPacket; message?: string };
  if (!body.packet) throw new Error(body.message ?? `CAD integration preparation failed (${response.status})`); return body.packet;
};
const defaultValidateIntegrationReview = async (packet: File, review: File): Promise<RobotCadIntegrationReviewResult> => {
  const form = new FormData(); form.set('packet', packet); form.set('review', review); const response = await fetch('/api/cad/v1/robot/integration/review', { method: 'POST', body: form }); const body = await response.json() as { result?: RobotCadIntegrationReviewResult; message?: string };
  if (!body.result) throw new Error(body.message ?? `CAD integration review failed (${response.status})`); return body.result;
};
const defaultApplyIntegration: NonNullable<RobotPrecisionHandoffPanelProps['applyIntegration']> = async (program, revision, packet, review, housing, requirements, manifest, artifacts) => {
  const form = new FormData(); form.set('program', program); form.set('revision', revision); form.set('packet', packet); form.set('review', review); form.set('housing', housing); form.set('requirements', requirements); form.set('manifest', manifest); for (const artifact of artifacts) form.append('artifact', artifact); const response = await fetch('/api/cad/v1/robot/integration/apply', { method: 'POST', body: form });
  if (!response.ok) { const body = await response.json().catch(() => ({})) as { message?: string; errors?: string[] }; throw new Error(body.message ?? body.errors?.join(' · ') ?? `CAD integration revision failed (${response.status})`); }
  const targetHash = response.headers.get('x-nexyfab-target-hash') ?? '', programHash = response.headers.get('x-nexyfab-program-hash') ?? '', revisionNumber = Number(response.headers.get('x-nexyfab-revision')), applicationHash = response.headers.get('x-nexyfab-application-hash') ?? '', applicationReceiptHash = response.headers.get('x-nexyfab-application-receipt-hash') ?? '', driveOccurrences = Number(response.headers.get('x-nexyfab-drive-occurrences')), auxiliaryOccurrences = Number(response.headers.get('x-nexyfab-auxiliary-occurrences')), catalogUnresolved = Number(response.headers.get('x-nexyfab-catalog-unresolved')); if (!/^[a-f0-9]{64}$/.test(targetHash) || !/^[a-f0-9]{64}$/.test(programHash) || !/^[a-f0-9]{64}$/.test(applicationHash) || !/^[a-f0-9]{64}$/.test(applicationReceiptHash) || !Number.isInteger(revisionNumber) || driveOccurrences !== 18 || auxiliaryOccurrences !== 4 || catalogUnresolved !== 0 || response.headers.get('x-nexyfab-cad-applied-workspace') !== 'false' || response.headers.get('x-nexyfab-release-ready') !== 'false') throw new Error('unsafe CAD integration bundle response'); const disposition = response.headers.get('content-disposition') ?? ''; const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? `robot-cad-r${revisionNumber}-${programHash}.zip`; return { bundle: await response.blob(), filename, targetHash, programHash, revision: revisionNumber, applicationHash, applicationReceiptHash, driveOccurrences: 18, auxiliaryOccurrences: 4, catalogUnresolved: 0, cadAppliedToWorkspace: false, releaseReady: false };
};
const defaultPostVerifyIntegration: NonNullable<RobotPrecisionHandoffPanelProps['postVerifyIntegration']> = async (program, revision, preciseReport, receipt, packet, review, housing, requirements, manifest, artifacts) => { const form = new FormData(); form.set('program', program); form.set('revision', revision); form.set('preciseReport', preciseReport); form.set('receipt', receipt); form.set('packet', packet); form.set('review', review); form.set('housing', housing); form.set('requirements', requirements); form.set('manifest', manifest); for (const artifact of artifacts) form.append('artifact', artifact); const response = await fetch('/api/cad/v1/robot/integration/post-verify', { method: 'POST', body: form }); const body = await response.json() as { report?: RobotPostIntegrationEvidence; message?: string }; if (!body.report) throw new Error(body.message ?? `Post-integration verification failed (${response.status})`); return body.report; };
const defaultAuditReleaseEvidence: NonNullable<RobotPrecisionHandoffPanelProps['auditReleaseEvidence']> = async (post, exactCad, manufacturing) => { const form = new FormData(); form.set('postIntegration', post); if (exactCad) form.set('exactCadEvidence', exactCad); if (manufacturing) form.set('manufacturingEvidence', manufacturing); const response = await fetch('/api/cad/v1/robot/release/audit', { method: 'POST', body: form }); const body = await response.json() as { report?: RobotReleaseEvidenceAuditV2; message?: string }; if (!body.report) throw new Error(body.message ?? `Release evidence audit failed (${response.status})`); return body.report; };
const defaultValidateFinalReleaseReview: NonNullable<RobotPrecisionHandoffPanelProps['validateFinalReleaseReview']> = async (audit, review) => { const form = new FormData(); form.set('audit', audit); form.set('review', review); const response = await fetch('/api/cad/v1/robot/release/final-review', { method: 'POST', body: form }); const body = await response.json() as { decision?: RobotFinalReleaseDecision; message?: string }; if (!body.decision) throw new Error(body.message ?? `Final release review failed (${response.status})`); return body.decision; };
const defaultBuildReleaseWorkPacket: NonNullable<RobotPrecisionHandoffPanelProps['buildReleaseWorkPacket']> = async post => { const form = new FormData(); form.set('postIntegration', post); const response = await fetch('/api/cad/v1/robot/release/work-packet', { method: 'POST', body: form }); const body = await response.json() as { packet?: RobotReleaseWorkPacketV2; message?: string }; if (!body.packet) throw new Error(body.message ?? `Release work packet failed (${response.status})`); return body.packet; };

function Gate({ label, state, detail, testId }: { label: string; state: GateState; detail: string; testId: string }) {
  const color = state === 'passed' ? '#166534' : state === 'failed' ? '#b91c1c' : '#92400e';
  return <div data-testid={testId} style={{ padding: '5px 7px', border: '1px solid var(--nx-border)', borderRadius: 5 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontWeight: 650 }}>
      <span>{label}</span><span style={{ color }}>{state}</span>
    </div>
    <div style={{ marginTop: 2, color: 'var(--nx-text-3)', fontSize: 10.5 }}>{detail}</div>
  </div>;
}

const DRIVE_OCCURRENCES = 18;
const AUXILIARY_OCCURRENCES = 4;
const AUXILIARY_KINDS = ['brake', 'encoder', 'harness', 'tool_connector'] as const;
const SHA256 = /^[a-f0-9]{64}$/;
function passedPostContradictions(report: RobotPostIntegrationEvidence) {
  if (report.postIntegrationStatus !== 'passed') return [];
  const issues: string[] = [];
  if (!report.integrationAuthorized || !report.selectedOccurrencesVerified || report.precisionStatus !== 'passed' || report.errors.length) issues.push('authorization, occurrence, precision, or error state contradicts passed');
  const expected = { selectedOccurrences: 18, auxiliaryOccurrences: 4, appliedOccurrences: 22, catalogUnresolved: 0, motionFrames: 156, checkedMotionFrames: 156, collisionFrames: 0, coordinatedMotionFrames: 49, checkedCoordinatedMotionFrames: 49, coordinatedCollisionFrames: 0, preciseInterferences: 0 };
  for (const [field, value] of Object.entries(expected)) if (report.counts[field as keyof typeof report.counts] !== value) issues.push(`${field} contradicts passed`);
  for (const value of [report.programHash, report.preciseReportHash, report.applicationReceiptHash, report.applicationHash, report.targetHash, report.catalogManifestSha256, report.housingSha256]) if (!SHA256.test(value)) issues.push('hash state contradicts passed');
  return [...new Set(issues)];
}
function driveSelectionCount(report: RobotCatalogSelectionReport | null) {
  if (!report?.selectionReady || report.selectionStatus !== 'passed' || report.selections.length !== 6) return 0;
  const joints = report.selections.map(item => item.joint); return new Set(joints).size === 6 && [...joints].sort((a, b) => a - b).every((joint, index) => joint === index + 1) ? DRIVE_OCCURRENCES : 0;
}
function auxiliarySelectionCount(report: RobotCatalogSelectionReport | null) {
  if (!report?.auxiliarySelectionReady || report.auxiliarySelectionStatus !== 'passed' || report.auxiliarySelections.length !== 4) return 0;
  const kinds = new Set(report.auxiliarySelections.map(item => item.kind)); return AUXILIARY_KINDS.every(kind => kinds.has(kind)) ? AUXILIARY_OCCURRENCES : 0;
}
function driveIntegrationCount(packet: RobotCadIntegrationPacket | null) {
  if (packet?.readiness !== 'review_pending' || packet.replacements.length !== 6) return 0;
  const joints = packet.replacements.map(item => item.joint);
  return new Set(joints).size === 6 && [...joints].sort((a, b) => a - b).every((joint, index) => joint === index + 1) ? DRIVE_OCCURRENCES : 0;
}
function auxiliaryIntegrationCount(packet: RobotCadIntegrationPacket | null) {
  const additions = packet?.readiness === 'review_pending' ? packet.auxiliaryAdditions ?? [] : [];
  return additions.length === 4 && AUXILIARY_KINDS.every(kind => additions.some(item => item.kind === kind)) ? AUXILIARY_OCCURRENCES : 0;
}

export default function RobotPrecisionHandoffPanel({ lang, onHandoff, generate = defaultGenerate, verifyEvidence = verifyRobotEvidenceBundle, reverifyRevision = defaultReverifyRevision, admitCatalog = defaultAdmitCatalog, selectCatalog = defaultSelectCatalog, evaluateHousing = defaultEvaluateHousing, prepareIntegration = defaultPrepareIntegration, validateIntegrationReview = defaultValidateIntegrationReview, applyIntegration = defaultApplyIntegration, postVerifyIntegration = defaultPostVerifyIntegration, auditReleaseEvidence = defaultAuditReleaseEvidence, validateFinalReleaseReview = defaultValidateFinalReleaseReview, buildReleaseWorkPacket = defaultBuildReleaseWorkPacket }: RobotPrecisionHandoffPanelProps) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RobotGenerateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reportFile, setReportFile] = useState<File | null>(null);
  const [programFile, setProgramFile] = useState<File | null>(null);
  const [evidence, setEvidence] = useState<RobotEvidenceSummary | null>(null);
  const [baselineEvidence, setBaselineEvidence] = useState<RobotEvidenceSummary | null>(null);
  const [transitions, setTransitions] = useState<RobotRemediationTransition[] | null>(null);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [focusResult, setFocusResult] = useState<AssemblyFocusResultDetail | null>(null);
  const [revisionExportBusy, setRevisionExportBusy] = useState(false);
  const [revisionExportMessage, setRevisionExportMessage] = useState<string | null>(null);
  const [revisionProgramFile, setRevisionProgramFile] = useState<File | null>(null);
  const [revisionManifestFile, setRevisionManifestFile] = useState<File | null>(null);
  const [revisionVerifyBusy, setRevisionVerifyBusy] = useState(false);
  const [catalogManifestFile, setCatalogManifestFile] = useState<File | null>(null);
  const [catalogArtifactFiles, setCatalogArtifactFiles] = useState<File[]>([]);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [catalogReport, setCatalogReport] = useState<RobotCatalogAdmissionReport | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogRequirementsFile, setCatalogRequirementsFile] = useState<File | null>(null);
  const [selectionBusy, setSelectionBusy] = useState(false);
  const [selectionReport, setSelectionReport] = useState<RobotCatalogSelectionReport | null>(null);
  const [housingFile, setHousingFile] = useState<File | null>(null);
  const [housingBusy, setHousingBusy] = useState(false);
  const [housingReport, setHousingReport] = useState<RobotHousingFitEvidenceReport | null>(null);
  const [integrationBusy, setIntegrationBusy] = useState(false);
  const [integrationPacket, setIntegrationPacket] = useState<RobotCadIntegrationPacket | null>(null);
  const [integrationPacketFile, setIntegrationPacketFile] = useState<File | null>(null);
  const [integrationReviewFile, setIntegrationReviewFile] = useState<File | null>(null);
  const [integrationReviewBusy, setIntegrationReviewBusy] = useState(false);
  const [integrationReviewResult, setIntegrationReviewResult] = useState<RobotCadIntegrationReviewResult | null>(null);
  const [integrationApplyBusy, setIntegrationApplyBusy] = useState(false);
  const [integrationApplyMessage, setIntegrationApplyMessage] = useState<string | null>(null);
  const [integrationAppliedCounts, setIntegrationAppliedCounts] = useState<{ targetHash: string; programHash: string; revision: number; applicationHash: string; applicationReceiptHash: string; drive: number; auxiliary: number; catalogUnresolved: number } | null>(null);
  const [integrationReceiptFile, setIntegrationReceiptFile] = useState<File | null>(null);
  const [postIntegrationBusy, setPostIntegrationBusy] = useState(false);
  const [postIntegrationReport, setPostIntegrationReport] = useState<RobotPostIntegrationEvidence | null>(null);
  const [postIntegrationEvidenceFile, setPostIntegrationEvidenceFile] = useState<File | null>(null); const [exactCadEvidenceFile, setExactCadEvidenceFile] = useState<File | null>(null); const [manufacturingEvidenceFile, setManufacturingEvidenceFile] = useState<File | null>(null); const [releaseAuditBusy, setReleaseAuditBusy] = useState(false); const [releaseAuditReport, setReleaseAuditReport] = useState<RobotReleaseEvidenceAuditV2 | null>(null); const [finalAuditFile, setFinalAuditFile] = useState<File | null>(null); const [finalReviewFile, setFinalReviewFile] = useState<File | null>(null); const [finalReviewBusy, setFinalReviewBusy] = useState(false); const [finalDecision, setFinalDecision] = useState<RobotFinalReleaseDecision | null>(null);
  const [releaseWorkBusy, setReleaseWorkBusy] = useState(false); const [releaseWorkPacket, setReleaseWorkPacket] = useState<RobotReleaseWorkPacketV2 | null>(null);
  const clearReleaseState = () => { setPostIntegrationEvidenceFile(null); setExactCadEvidenceFile(null); setManufacturingEvidenceFile(null); setReleaseAuditReport(null); setFinalAuditFile(null); setFinalReviewFile(null); setFinalDecision(null); setReleaseWorkPacket(null); };
  const clearPostState = () => { setPostIntegrationReport(null); clearReleaseState(); };
  const clearApplicationState = () => { setIntegrationAppliedCounts(null); setIntegrationApplyMessage(null); setIntegrationReceiptFile(null); clearPostState(); };
  const clearReviewState = () => { setIntegrationReviewResult(null); clearApplicationState(); };
  const clearIntegrationState = () => { setIntegrationPacket(null); clearReviewState(); };
  const run = async () => {
    setBusy(true); setError(null); setResult(null);
    try {
      const generated = await generate();
      setResult(generated);
      if (typeof window !== 'undefined' && generated.generationState) window.sessionStorage.setItem('nexyfab:ai-generation-state:v1', JSON.stringify(generated.generationState));
      if (typeof window !== 'undefined' && generated.executionPlan) {
        window.sessionStorage.setItem('nexyfab:ai-complex-execution-plan:v1', JSON.stringify(generated.executionPlan));
        window.dispatchEvent(new CustomEvent('nexyfab:complex-execution-plan', { detail: generated.executionPlan }));
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const requirementsPassed = result?.selectionRequirements?.ok === true;
  const catalogPassed = result?.catalogEvidence?.productionEligible === true;
  const collisionCount = result?.engineering?.selfCollision.count;
  const loadEvidence = async () => {
    if (!reportFile || !programFile) return;
    if (!baselineEvidence) setEvidence(null);
    setEvidenceError(null);
    try {
      const verified = await verifyEvidence(new Uint8Array(await reportFile.arrayBuffer()), new Uint8Array(await programFile.arrayBuffer()));
      if (!baselineEvidence) { setBaselineEvidence(verified); setEvidence(verified); setTransitions(null); }
      else { const compared = compareRobotEvidenceRevisions(baselineEvidence, verified); setEvidence(verified); setTransitions(compared); }
    }
    catch (cause) { setEvidenceError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const focusQueueItem = (queueItemId: string, partIds: string[]) => {
    setFocusResult(null);
    const timeout = window.setTimeout(() => {
      window.removeEventListener(ASSEMBLY_FOCUS_RESULT_EVENT, onResult);
      setFocusResult({ queueItemId, selectedPartIds: [], missingPartIds: partIds });
    }, 2000);
    const onResult = (event: Event) => {
      const detail = (event as CustomEvent<AssemblyFocusResultDetail>).detail;
      if (detail?.queueItemId !== queueItemId) return;
      window.clearTimeout(timeout);
      setFocusResult(detail);
      window.removeEventListener(ASSEMBLY_FOCUS_RESULT_EVENT, onResult);
    };
    window.addEventListener(ASSEMBLY_FOCUS_RESULT_EVENT, onResult);
    window.dispatchEvent(new CustomEvent(ASSEMBLY_FOCUS_PARTS_EVENT, { detail: { partIds, source: 'robot-evidence', queueItemId } }));
  };
  const exportEditedRevision = () => {
    if (!baselineEvidence || revisionExportBusy) return;
    setRevisionExportBusy(true); setRevisionExportMessage(null);
    const requestId = crypto.randomUUID();
    const timeout = window.setTimeout(() => finish(null), 5000);
    const onResult = (event: Event) => {
      const detail = (event as CustomEvent<AiAssemblyRevisionResult>).detail;
      if (detail?.requestId !== requestId) return;
      window.clearTimeout(timeout); window.removeEventListener(AI_ASSEMBLY_REVISION_RESULT_EVENT, onResult);
      if (!detail.ok) { setRevisionExportBusy(false); setRevisionExportMessage(detail.error); return; }
      void Promise.all([
        downloadBlob(detail.manifest.programArtifact, new Blob([new Uint8Array(detail.programBytes)], { type: 'application/json' })),
        downloadBlob(`revision-${detail.manifest.lineageId}-r${detail.manifest.revision}-${detail.manifest.programHash}.json`, new Blob([new Uint8Array(detail.manifestBytes)], { type: 'application/json' })),
      ]).then(() => { setRevisionExportBusy(false); setRevisionExportMessage(`r${detail.manifest.revision} · ${detail.manifest.programHash.slice(0, 12)}…`); }).catch(cause => { setRevisionExportBusy(false); setRevisionExportMessage(cause instanceof Error ? cause.message : String(cause)); });
    };
    const finish = (message: string | null) => { window.removeEventListener(AI_ASSEMBLY_REVISION_RESULT_EVENT, onResult); setRevisionExportBusy(false); setRevisionExportMessage(message ?? (localized(lang, { ko: 'CAD 리비전 응답 시간 초과', en: 'CAD revision response timed out', ja: 'CAD revision response timed out', zh: 'CAD revision response timed out', es: 'CAD revision response timed out', ar: 'CAD revision response timed out' }))); };
    window.addEventListener(AI_ASSEMBLY_REVISION_RESULT_EVENT, onResult);
    window.dispatchEvent(new CustomEvent(AI_ASSEMBLY_REVISION_REQUEST_EVENT, { detail: { requestId, lineageId: baselineEvidence.lineageId, revision: baselineEvidence.revision + 1, baseProgramHash: baselineEvidence.programHash } }));
  };
  const runRevisionReverification = async () => {
    if (!revisionProgramFile || !revisionManifestFile || revisionVerifyBusy) return;
    setRevisionVerifyBusy(true); setEvidenceError(null);
    try {
      const payload = await reverifyRevision(revisionProgramFile, revisionManifestFile) as { ok?: unknown; releaseReady?: unknown; quoteOrRfqSideEffects?: unknown; report?: unknown };
      if (payload.ok !== true || payload.releaseReady !== false || payload.quoteOrRfqSideEffects !== false || !payload.report) throw new Error('unsafe or malformed reverification response');
      const reportBytes = new TextEncoder().encode(`${JSON.stringify(payload.report, null, 2)}\n`);
      const programBytes = new Uint8Array(await revisionProgramFile.arrayBuffer());
      const verified = await verifyEvidence(reportBytes, programBytes);
      if (baselineEvidence) setTransitions(compareRobotEvidenceRevisions(baselineEvidence, verified));
      else { setBaselineEvidence(verified); setTransitions(null); }
      setEvidence(verified);
      await downloadBlob(`report-${verified.lineageId}-r${verified.revision}-${verified.programHash}.json`, new Blob([reportBytes], { type: 'application/json' }));
    } catch (cause) { setEvidenceError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setRevisionVerifyBusy(false); }
  };
  const runCatalogAdmission = async () => {
    if (!catalogManifestFile || !catalogArtifactFiles.length || catalogBusy) return;
    setCatalogBusy(true); setCatalogError(null); setCatalogReport(null);
    try {
      const report = await admitCatalog(catalogManifestFile, catalogArtifactFiles);
      if (report.selectionReady !== false || report.selectionStatus !== 'not_run' || report.sideEffects.persisted !== false || report.sideEffects.catalogActivated !== false || report.sideEffects.quoteCreated !== false || report.sideEffects.rfqSent !== false) throw new Error('unsafe catalog admission response');
      setCatalogReport(report);
    } catch (cause) { setCatalogError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setCatalogBusy(false); }
  };
  const downloadCatalogReport = async () => {
    if (!catalogReport) return;
    const bytes = new TextEncoder().encode(`${JSON.stringify(catalogReport, null, 2)}\n`);
    await downloadBlob(`catalog-admission-${catalogReport.manifestSha256}.json`, new Blob([bytes], { type: 'application/json' }));
  };
  const runCatalogSelection = async () => {
    if (!catalogRequirementsFile || !catalogManifestFile || !catalogArtifactFiles.length || selectionBusy) return;
    setSelectionBusy(true); setCatalogError(null); setSelectionReport(null);
    try {
      const report = await selectCatalog(catalogRequirementsFile, catalogManifestFile, catalogArtifactFiles);
      const driveStateValid = report.selectionStatus === 'passed'
        ? report.selectionReady === true && driveSelectionCount(report) === DRIVE_OCCURRENCES
        : report.selectionReady === false && Array.isArray(report.selections) && report.selections.length === 0;
      const auxiliaryStateValid = report.auxiliarySelectionStatus === 'passed'
        ? report.auxiliarySelectionReady === true && auxiliarySelectionCount(report) === AUXILIARY_OCCURRENCES
        : (report.auxiliarySelectionStatus === 'failed' || report.auxiliarySelectionStatus === 'not_run')
          && report.auxiliarySelectionReady === false && Array.isArray(report.auxiliarySelections) && report.auxiliarySelections.length === 0;
      if (!driveStateValid || !auxiliaryStateValid || report.releaseReady !== false || report.cadIntegrationStatus !== 'not_run' || report.sideEffects.persisted !== false || report.sideEffects.catalogActivated !== false || report.sideEffects.cadModified !== false || report.sideEffects.quoteCreated !== false || report.sideEffects.rfqSent !== false) throw new Error('unsafe or incomplete catalog selection response');
      setSelectionReport(report);
    } catch (cause) { setCatalogError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSelectionBusy(false); }
  };
  const downloadSelectionReport = async () => {
    if (!selectionReport) return; const bytes = new TextEncoder().encode(`${JSON.stringify(selectionReport, null, 2)}\n`);
    await downloadBlob(`catalog-selection-${selectionReport.requirementsSha256}-${selectionReport.manifestSha256}.json`, new Blob([bytes], { type: 'application/json' }));
  };
  const runHousingFit = async () => {
    if (!housingFile || !catalogRequirementsFile || !catalogManifestFile || !catalogArtifactFiles.length || housingBusy) return;
    setHousingBusy(true); setCatalogError(null); setHousingReport(null);
    try {
      const report = await evaluateHousing(housingFile, catalogRequirementsFile, catalogManifestFile, catalogArtifactFiles);
      if (report.releaseReady !== false || report.cadIntegrationStatus !== 'not_run' || report.sideEffects.persisted !== false || report.sideEffects.catalogActivated !== false || report.sideEffects.cadModified !== false || report.sideEffects.quoteCreated !== false || report.sideEffects.rfqSent !== false) throw new Error('unsafe housing fit response');
      setHousingReport(report);
    } catch (cause) { setCatalogError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setHousingBusy(false); }
  };
  const downloadHousingReport = async () => {
    if (!housingReport) return; const bytes = new TextEncoder().encode(`${JSON.stringify(housingReport, null, 2)}\n`);
    await downloadBlob(`housing-fit-${housingReport.housingSha256}-${housingReport.requirementsSha256}-${housingReport.manifestSha256}.json`, new Blob([bytes], { type: 'application/json' }));
  };
  const runIntegrationPreparation = async () => {
    if (!revisionProgramFile || !revisionManifestFile || !housingFile || !catalogRequirementsFile || !catalogManifestFile || !catalogArtifactFiles.length || integrationBusy) return;
    setIntegrationBusy(true); setCatalogError(null); clearIntegrationState();
    try {
      const packet = await prepareIntegration(revisionProgramFile, revisionManifestFile, housingFile, catalogRequirementsFile, catalogManifestFile, catalogArtifactFiles);
      const auxiliaryAdditions = packet.auxiliaryAdditions ?? [];
      const validDrivePlan = packet.replacements.length === 0 || driveIntegrationCount(packet) === DRIVE_OCCURRENCES;
      const validAuxiliaryPlan = auxiliaryAdditions.length === 0 || auxiliaryIntegrationCount(packet) === AUXILIARY_OCCURRENCES;
      if (!validDrivePlan || !validAuxiliaryPlan || (packet.readiness === 'review_pending' && driveIntegrationCount(packet) !== DRIVE_OCCURRENCES) || packet.expertReviewRequired !== true || packet.cadIntegrationStatus !== 'not_applied' || packet.releaseReady !== false || packet.sideEffects.persisted !== false || packet.sideEffects.sourceModified !== false || packet.sideEffects.cadModified !== false || packet.sideEffects.quoteCreated !== false || packet.sideEffects.rfqSent !== false) throw new Error('unsafe or incomplete CAD integration packet');
      setIntegrationPacket(packet);
    } catch (cause) { setCatalogError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setIntegrationBusy(false); }
  };
  const downloadIntegrationPacket = async () => {
    if (!integrationPacket) return; const bytes = new TextEncoder().encode(`${JSON.stringify(integrationPacket, null, 2)}\n`);
    await downloadBlob(`robot-cad-integration-review-${integrationPacket.targetHash}.json`, new Blob([bytes], { type: 'application/json' }));
  };
  const runIntegrationReview = async () => {
    if (!integrationPacketFile || !integrationReviewFile || integrationReviewBusy) return; setIntegrationReviewBusy(true); setCatalogError(null); clearReviewState();
    try { const result = await validateIntegrationReview(integrationPacketFile, integrationReviewFile); if (result.cadApplied !== false || result.releaseReady !== false || result.nextStep !== 'create_new_cad_revision_then_reverify' || result.sideEffects.persisted !== false || result.sideEffects.cadModified !== false || result.sideEffects.quoteCreated !== false || result.sideEffects.rfqSent !== false) throw new Error('unsafe CAD integration review result'); setIntegrationReviewResult(result); }
    catch (cause) { setCatalogError(cause instanceof Error ? cause.message : String(cause)); } finally { setIntegrationReviewBusy(false); }
  };
  const downloadIntegrationReviewResult = async () => { if (!integrationReviewResult) return; const bytes = new TextEncoder().encode(`${JSON.stringify(integrationReviewResult, null, 2)}\n`); await downloadBlob(`robot-cad-integration-review-validation-${integrationReviewResult.targetHash}.json`, new Blob([bytes], { type: 'application/json' })); };
  const runIntegrationApplication = async () => {
    if (!integrationReviewResult?.approved || !integrationPacket || driveIntegrationCount(integrationPacket) !== DRIVE_OCCURRENCES || auxiliaryIntegrationCount(integrationPacket) !== AUXILIARY_OCCURRENCES || !revisionProgramFile || !revisionManifestFile || !integrationPacketFile || !integrationReviewFile || !housingFile || !catalogRequirementsFile || !catalogManifestFile || !catalogArtifactFiles.length || integrationApplyBusy) return; setIntegrationApplyBusy(true); setCatalogError(null); clearApplicationState();
    try { const result = await applyIntegration(revisionProgramFile, revisionManifestFile, integrationPacketFile, integrationReviewFile, housingFile, catalogRequirementsFile, catalogManifestFile, catalogArtifactFiles); if (result.cadAppliedToWorkspace !== false || result.releaseReady !== false || result.targetHash !== integrationReviewResult.targetHash || result.targetHash !== integrationPacket.targetHash || result.revision !== integrationPacket.revision + 1 || !SHA256.test(result.programHash) || !SHA256.test(result.applicationHash) || !SHA256.test(result.applicationReceiptHash) || result.driveOccurrences !== DRIVE_OCCURRENCES || result.auxiliaryOccurrences !== AUXILIARY_OCCURRENCES || result.catalogUnresolved !== 0) throw new Error('unsafe or mismatched CAD integration bundle'); await downloadBlob(result.filename, result.bundle); setIntegrationAppliedCounts({ targetHash: result.targetHash, programHash: result.programHash, revision: result.revision, applicationHash: result.applicationHash, applicationReceiptHash: result.applicationReceiptHash, drive: result.driveOccurrences, auxiliary: result.auxiliaryOccurrences, catalogUnresolved: result.catalogUnresolved }); setIntegrationApplyMessage(`r${result.revision} · ${result.programHash.slice(0, 12)}… · precise reverification required`); }
    catch (cause) { setCatalogError(cause instanceof Error ? cause.message : String(cause)); } finally { setIntegrationApplyBusy(false); }
  };
  const runPostIntegrationVerification = async () => { if (!revisionProgramFile || !revisionManifestFile || !reportFile || !integrationReceiptFile || !integrationPacketFile || !integrationReviewFile || !housingFile || !catalogRequirementsFile || !catalogManifestFile || !catalogArtifactFiles.length || postIntegrationBusy) return; setPostIntegrationBusy(true); setCatalogError(null); clearPostState(); try { const report = await postVerifyIntegration(revisionProgramFile, revisionManifestFile, reportFile, integrationReceiptFile, integrationPacketFile, integrationReviewFile, housingFile, catalogRequirementsFile, catalogManifestFile, catalogArtifactFiles); const contradictions = passedPostContradictions(report); if (report.releaseReady !== false || report.sideEffects.persisted !== false || report.sideEffects.sourceModified !== false || report.sideEffects.workspaceModified !== false || report.sideEffects.quoteCreated !== false || report.sideEffects.rfqSent !== false || contradictions.length || (integrationAppliedCounts && (report.targetHash !== integrationAppliedCounts.targetHash || report.programHash !== integrationAppliedCounts.programHash || report.revision !== integrationAppliedCounts.revision || report.applicationHash !== integrationAppliedCounts.applicationHash || report.applicationReceiptHash !== integrationAppliedCounts.applicationReceiptHash || report.counts.selectedOccurrences !== integrationAppliedCounts.drive || report.counts.auxiliaryOccurrences !== integrationAppliedCounts.auxiliary || report.counts.catalogUnresolved !== integrationAppliedCounts.catalogUnresolved)) || (integrationReviewResult && report.targetHash !== integrationReviewResult.targetHash)) throw new Error(`unsafe or contradictory post-integration evidence response${contradictions.length ? `: ${contradictions.join('; ')}` : ''}`); setPostIntegrationReport(report); } catch (cause) { setCatalogError(cause instanceof Error ? cause.message : String(cause)); } finally { setPostIntegrationBusy(false); } };
  const downloadPostIntegrationReport = async () => { if (!postIntegrationReport) return; const bytes = new TextEncoder().encode(`${JSON.stringify(postIntegrationReport, null, 2)}\n`); await downloadBlob(`robot-post-integration-${postIntegrationReport.targetHash}-${postIntegrationReport.programHash}.json`, new Blob([bytes], { type: 'application/json' })); };
  const runReleaseAudit = async () => { if (!postIntegrationEvidenceFile || releaseAuditBusy) return; setReleaseAuditBusy(true); setCatalogError(null); setReleaseAuditReport(null); try { const report = await auditReleaseEvidence(postIntegrationEvidenceFile, exactCadEvidenceFile, manufacturingEvidenceFile); if (report.externalCadRequired !== false || report.releaseReady !== false || report.sideEffects.persisted !== false || report.sideEffects.cadModified !== false || report.sideEffects.quoteCreated !== false || report.sideEffects.rfqSent !== false) throw new Error('unsafe release evidence audit'); setReleaseAuditReport(report); } catch (cause) { setCatalogError(cause instanceof Error ? cause.message : String(cause)); } finally { setReleaseAuditBusy(false); } };
  const downloadReleaseAudit = async () => { if (!releaseAuditReport) return; const bytes = new TextEncoder().encode(`${JSON.stringify(releaseAuditReport, null, 2)}\n`); await downloadBlob(`robot-release-audit-${releaseAuditReport.releaseTargetHash ?? releaseAuditReport.postIntegrationSha256}.json`, new Blob([bytes], { type: 'application/json' })); };
  const runFinalReleaseReview = async () => { if (!finalAuditFile || !finalReviewFile || finalReviewBusy) return; setFinalReviewBusy(true); setCatalogError(null); setFinalDecision(null); try { const decision = await validateFinalReleaseReview(finalAuditFile, finalReviewFile); if (decision.releaseExecuted !== false || decision.sideEffects.persisted !== false || decision.sideEffects.cadModified !== false || decision.sideEffects.releasePublished !== false || decision.sideEffects.quoteCreated !== false || decision.sideEffects.rfqSent !== false) throw new Error('unsafe final release decision'); setFinalDecision(decision); } catch (cause) { setCatalogError(cause instanceof Error ? cause.message : String(cause)); } finally { setFinalReviewBusy(false); } };
  const downloadFinalDecision = async () => { if (!finalDecision) return; const bytes = new TextEncoder().encode(`${JSON.stringify(finalDecision, null, 2)}\n`); await downloadBlob(`robot-final-release-decision-${finalDecision.targetHash ?? finalDecision.auditReportSha256}.json`, new Blob([bytes], { type: 'application/json' })); };
  const runReleaseWorkPacket = async () => { if (!postIntegrationEvidenceFile || releaseWorkBusy) return; setReleaseWorkBusy(true); setCatalogError(null); setReleaseWorkPacket(null); try { const packet = await buildReleaseWorkPacket(postIntegrationEvidenceFile); if (packet.schema !== 'nexyfab.robot-release-evidence-work-packet.v3' || packet.errors.length !== 0 || packet.externalCadRequired !== false || packet.sourceBytesEmbedded !== false || packet.privateKeysEmbedded !== false || packet.releaseReady !== false || !/^[a-f0-9]{64}$/.test(packet.integrationTargetHash) || !/^[a-f0-9]{64}$/.test(packet.applicationHash) || !/^[a-f0-9]{64}$/.test(packet.applicationReceiptHash) || !/^[a-f0-9]{64}$/.test(packet.preciseReportHash) || !packet.lineageId || !Number.isInteger(packet.revision) || packet.revision < 1 || packet.exactCadTask.outputSchema !== 'nexyfab.robot-exact-cad-evidence.v3' || packet.exactCadTask.requiredCounts.jointCount !== 6 || packet.exactCadTask.requiredCounts.partCount !== 29 || packet.manufacturingTask.outputSchema !== 'nexyfab.robot-manufacturing-validation.v3' || packet.manufacturingTask.selectedComponentCount !== 22 || packet.manufacturingTask.driveComponentCount !== 18 || packet.manufacturingTask.auxiliaryComponentCount !== 4 || packet.finalReviewTask.releaseExecutionIncluded !== false) throw new Error('unsafe or incomplete release work packet'); setReleaseWorkPacket(packet); } catch (cause) { setCatalogError(cause instanceof Error ? cause.message : String(cause)); } finally { setReleaseWorkBusy(false); } };
  const downloadReleaseWorkPacket = async () => { if (!releaseWorkPacket) return; const bytes = new TextEncoder().encode(`${JSON.stringify(releaseWorkPacket, null, 2)}\n`); await downloadBlob(`robot-release-work-${releaseWorkPacket.packetHash}.json`, new Blob([bytes], { type: 'application/json' })); };

  const driveSelected = driveSelectionCount(selectionReport);
  const auxiliarySelected = auxiliarySelectionCount(selectionReport);
  const drivePlanned = driveIntegrationCount(integrationPacket);
  const auxiliaryPlanned = auxiliaryIntegrationCount(integrationPacket);
  const driveApplied = integrationAppliedCounts?.drive ?? 0;
  const auxiliaryApplied = integrationAppliedCounts?.auxiliary ?? 0;
  const admissionState = !catalogReport ? 'not_run' : catalogReport.productionEligible ? 'passed' : 'failed';
  const driveIntegrationState = driveApplied === DRIVE_OCCURRENCES ? 'applied' : integrationPacket?.readiness ?? 'not_run';
  const auxiliaryIntegrationState = auxiliaryApplied === AUXILIARY_OCCURRENCES ? 'applied' : auxiliaryPlanned === AUXILIARY_OCCURRENCES ? 'review_pending' : integrationPacket ? 'blocked' : 'not_run';

  return <section data-testid="robot-precision-handoff" style={{ padding: 9, border: '1px solid var(--nx-border)', borderRadius: 7, background: 'var(--nx-panel-2)' }}>
    <div style={{ fontWeight: 750 }}>{localized(lang, { ko: 'AI 6축 로봇 제품 구현 → 필요 시 정밀 CAD', en: 'AI 6-axis product build → precision CAD when required', ja: 'AI 6-axis product build → precision CAD when required', zh: 'AI 6-axis product build → precision CAD when required', es: 'AI 6-axis product build → precision CAD when required', ar: 'AI 6-axis product build → precision CAD when required' })}</div>
    <div style={{ margin: '3px 0 8px', fontSize: 10.5, color: 'var(--nx-text-3)' }}>
      {localized(lang, { ko: 'AI가 부품·조립·동작·제조 증거까지 완성 파이프라인을 진행합니다. 정확 형상이나 공차 증거가 필요한 범위만 정밀 CAD로 전환하며, 생산 승인은 별도입니다.', en: 'AI advances parts, assembly, motion and manufacturing evidence toward a complete product. Only governed exact-geometry or tolerance gaps enter precision CAD; production approval remains separate.', ja: 'AI advances parts, assembly, motion and manufacturing evidence toward a complete product. Only governed exact-geometry or tolerance gaps enter precision CAD; production approval remains separate.', zh: 'AI advances parts, assembly, motion and manufacturing evidence toward a complete product. Only governed exact-geometry or tolerance gaps enter precision CAD; production approval remains separate.', es: 'AI advances parts, assembly, motion and manufacturing evidence toward a complete product. Only governed exact-geometry or tolerance gaps enter precision CAD; production approval remains separate.', ar: 'AI advances parts, assembly, motion and manufacturing evidence toward a complete product. Only governed exact-geometry or tolerance gaps enter precision CAD; production approval remains separate.' })}
    </div>
    <button type="button" data-testid="robot-generate" onClick={run} disabled={busy} style={{ width: '100%', padding: 7, borderRadius: 5, border: 0, background: '#2563eb', color: '#fff', fontWeight: 700 }}>
      {busy ? (localized(lang, { ko: '제품 구현·검증 중…', en: 'Building and verifying product…', ja: 'Building and verifying product…', zh: 'Building and verifying product…', es: 'Building and verifying product…', ar: 'Building and verifying product…' })) : (localized(lang, { ko: 'AI로 복잡 제품 구현 시작', en: 'Build complex product with AI', ja: 'Build complex product with AI', zh: 'Build complex product with AI', es: 'Build complex product with AI', ar: 'Build complex product with AI' }))}
    </button>
    {error && <div role="alert" style={{ marginTop: 6, color: '#b91c1c' }}>{error}</div>}
    {result && <div style={{ display: 'grid', gap: 5, marginTop: 8 }}>
      <Gate testId="robot-gate-geometry" label={localized(lang, { ko: '편집 가능 형상', en: 'Editable geometry', ja: 'Editable geometry', zh: 'Editable geometry', es: 'Editable geometry', ar: 'Editable geometry' })} state={result.program ? 'passed' : 'failed'} detail={result.program ? `${result.program.parts.length} parts / ${result.program.assembly.mates.length} mates` : (localized(lang, { ko: '프로그램 없음', en: 'No program', ja: 'No program', zh: 'No program', es: 'No program', ar: 'No program' }))} />
      <Gate testId="robot-gate-requirements" label={localized(lang, { ko: '선정 요구조건', en: 'Selection requirements', ja: 'Selection requirements', zh: 'Selection requirements', es: 'Selection requirements', ar: 'Selection requirements' })} state={requirementsPassed ? 'passed' : 'failed'} detail={requirementsPassed ? (localized(lang, { ko: '6축 하중·속도·축경 요구조건 준비', en: 'Six-joint load, speed and shaft requirements ready', ja: 'Six-joint load, speed and shaft requirements ready', zh: 'Six-joint load, speed and shaft requirements ready', es: 'Six-joint load, speed and shaft requirements ready', ar: 'Six-joint load, speed and shaft requirements ready' })) : (result.selectionRequirements?.errors?.join(' · ') ?? 'not available')} />
      <Gate testId="robot-gate-catalog" label={localized(lang, { ko: '부품 카탈로그 증거', en: 'Component catalog evidence', ja: 'Component catalog evidence', zh: 'Component catalog evidence', es: 'Component catalog evidence', ar: 'Component catalog evidence' })} state={catalogPassed ? 'passed' : 'blocked'} detail={catalogPassed ? 'production eligible' : `${result.catalogEvidence?.status ?? 'not_supplied'} · preview-only · offline manifest required`} />
      <Gate testId="robot-gate-housing" label={localized(lang, { ko: '하우징 적합성', en: 'Housing fit', ja: 'Housing fit', zh: 'Housing fit', es: 'Housing fit', ar: 'Housing fit' })} state={result.housingFit?.status ?? 'not_run'} detail={result.housingFit?.reason ?? (localized(lang, { ko: '추적 가능한 실제 부품 선정 후 실행', en: 'Runs after traceable real-component selection', ja: 'Runs after traceable real-component selection', zh: 'Runs after traceable real-component selection', es: 'Runs after traceable real-component selection', ar: 'Runs after traceable real-component selection' }))} />
      <Gate testId="robot-gate-interference" label={localized(lang, { ko: '정밀 간섭·동작', en: 'Precise interference and motion', ja: 'Precise interference and motion', zh: 'Precise interference and motion', es: 'Precise interference and motion', ar: 'Precise interference and motion' })} state={collisionCount === 0 ? 'not_run' : collisionCount ? 'failed' : 'not_run'} detail={collisionCount ? `${collisionCount} sampled self-collision(s); precise B-rep motion verification required` : 'precise B-rep motion verification required'} />
      <Gate testId="robot-gate-release" label={localized(lang, { ko: '생산 릴리스', en: 'Production release', ja: 'Production release', zh: 'Production release', es: 'Production release', ar: 'Production release' })} state={result.releaseReady ? 'passed' : 'blocked'} detail={(result.releaseBlockers ?? []).join(' · ') || (localized(lang, { ko: '릴리스 증거 미완료', en: 'Release evidence incomplete', ja: 'Release evidence incomplete', zh: 'Release evidence incomplete', es: 'Release evidence incomplete', ar: 'Release evidence incomplete' }))} />
      <button type="button" data-testid="robot-handoff" disabled={!result.program} onClick={() => result.program && onHandoff(result.program)} style={{ width: '100%', padding: 7, borderRadius: 5, border: '1px solid var(--nx-border)', fontWeight: 700 }}>
        {localized(lang, { ko: '정밀 CAD에서 편집 계속', en: 'Continue editing in precision CAD', ja: 'Continue editing in precision CAD', zh: 'Continue editing in precision CAD', es: 'Continue editing in precision CAD', ar: 'Continue editing in precision CAD' })}
      </button>
      <div style={{ fontSize: 10, color: '#92400e' }}>{localized(lang, { ko: '이 인계는 편집 시작이며 승인·서명·견적 요청을 수행하지 않습니다.', en: 'This handoff starts editing; it does not approve, sign, or request a quote.', ja: 'This handoff starts editing; it does not approve, sign, or request a quote.', zh: 'This handoff starts editing; it does not approve, sign, or request a quote.', es: 'This handoff starts editing; it does not approve, sign, or request a quote.', ar: 'This handoff starts editing; it does not approve, sign, or request a quote.' })}</div>
    </div>}
    <RobotEngineeringAnalysisPanel lang={lang} />
    <RobotVerifiedSystemsPanel lang={lang} />
    <details style={{ marginTop: 8 }}>
      <summary style={{ cursor: 'pointer', fontWeight: 700 }}>{localized(lang, { ko: '생산 부품 카탈로그 증거 검사', en: 'Validate production component catalog evidence', ja: 'Validate production component catalog evidence', zh: 'Validate production component catalog evidence', es: 'Validate production component catalog evidence', ar: 'Validate production component catalog evidence' })}</summary>
      <div style={{ marginTop: 6, display: 'grid', gap: 5 }}>
        <div data-testid="robot-catalog-22-status" style={{ display: 'grid', gap: 3, padding: 7, border: '1px solid var(--nx-border)', borderRadius: 5 }}>
          <b>{localized(lang, { ko: '22개 카탈로그 occurrence 추적', en: '22 catalog occurrence tracking', ja: '22 catalog occurrence tracking', zh: '22 catalog occurrence tracking', es: '22 catalog occurrence tracking', ar: '22 catalog occurrence tracking' })}</b>
          <div>{localized(lang, { ko: '공유 카탈로그 승인', en: 'Shared catalog admission', ja: 'Shared catalog admission', zh: 'Shared catalog admission', es: 'Shared catalog admission', ar: 'Shared catalog admission' })}: {admissionState}</div>
          <div data-testid="robot-drive-catalog-status">
            {localized(lang, { ko: '구동계 선택', en: 'Drive selection', ja: 'Drive selection', zh: 'Drive selection', es: 'Drive selection', ar: 'Drive selection' })}: {driveSelected}/{DRIVE_OCCURRENCES} · {selectionReport?.selectionStatus ?? 'not_run'}<br />
            {localized(lang, { ko: '구동계 CAD 통합', en: 'Drive CAD integration', ja: 'Drive CAD integration', zh: 'Drive CAD integration', es: 'Drive CAD integration', ar: 'Drive CAD integration' })}: {driveApplied}/{DRIVE_OCCURRENCES} applied · {drivePlanned}/{DRIVE_OCCURRENCES} planned · {driveIntegrationState}
          </div>
          <div data-testid="robot-auxiliary-catalog-status">
            {localized(lang, { ko: '보조부품 선택', en: 'Auxiliary selection', ja: 'Auxiliary selection', zh: 'Auxiliary selection', es: 'Auxiliary selection', ar: 'Auxiliary selection' })}: {auxiliarySelected}/{AUXILIARY_OCCURRENCES} · {selectionReport?.auxiliarySelectionStatus ?? 'not_run'}<br />
            {localized(lang, { ko: '보조부품 CAD 통합', en: 'Auxiliary CAD integration', ja: 'Auxiliary CAD integration', zh: 'Auxiliary CAD integration', es: 'Auxiliary CAD integration', ar: 'Auxiliary CAD integration' })}: {auxiliaryApplied}/{AUXILIARY_OCCURRENCES} applied · {auxiliaryPlanned}/{AUXILIARY_OCCURRENCES} planned · {auxiliaryIntegrationState}
          </div>
          <div style={{ color: driveApplied + auxiliaryApplied === DRIVE_OCCURRENCES + AUXILIARY_OCCURRENCES ? '#92400e' : '#b91c1c' }}>
            {localized(lang, { ko: '전체 적용', en: 'Overall applied', ja: 'Overall applied', zh: 'Overall applied', es: 'Overall applied', ar: 'Overall applied' })}: {driveApplied + auxiliaryApplied}/{DRIVE_OCCURRENCES + AUXILIARY_OCCURRENCES} · {driveApplied + auxiliaryApplied === DRIVE_OCCURRENCES + AUXILIARY_OCCURRENCES ? (localized(lang, { ko: '생성된 r+1 카탈로그 unresolved 0, 릴리스는 차단됨', en: 'generated r+1 catalog unresolved 0, release blocked', ja: 'generated r+1 catalog unresolved 0, release blocked', zh: 'generated r+1 catalog unresolved 0, release blocked', es: 'generated r+1 catalog unresolved 0, release blocked', ar: 'generated r+1 catalog unresolved 0, release blocked' })) : 'blocked'}
          </div>
          <div data-testid="robot-catalog-release-boundary" style={{ color: '#92400e' }}>
            {localized(lang, { ko: '22/22 적용 후 카탈로그 unresolved가 0이어도 정밀 CAD 검증 · 제조 검증 · 최종 전문가 승인이 끝날 때까지 릴리스는 차단됩니다.', en: 'Even with 22/22 applied and catalog unresolved at 0, release remains blocked pending exact-CAD validation · manufacturing validation · final expert approval.', ja: 'Even with 22/22 applied and catalog unresolved at 0, release remains blocked pending exact-CAD validation · manufacturing validation · final expert approval.', zh: 'Even with 22/22 applied and catalog unresolved at 0, release remains blocked pending exact-CAD validation · manufacturing validation · final expert approval.', es: 'Even with 22/22 applied and catalog unresolved at 0, release remains blocked pending exact-CAD validation · manufacturing validation · final expert approval.', ar: 'Even with 22/22 applied and catalog unresolved at 0, release remains blocked pending exact-CAD validation · manufacturing validation · final expert approval.' })}
          </div>
        </div>
        <label>{localized(lang, { ko: 'catalog manifest JSON', en: 'Catalog manifest JSON', ja: 'Catalog manifest JSON', zh: 'Catalog manifest JSON', es: 'Catalog manifest JSON', ar: 'Catalog manifest JSON' })}<input data-testid="robot-catalog-manifest" type="file" accept="application/json,.json" onChange={event => { setCatalogManifestFile(event.target.files?.[0] ?? null); setCatalogReport(null); setSelectionReport(null); setHousingReport(null); clearIntegrationState(); }} /></label>
        <label>{localized(lang, { ko: 'manifest에 선언된 실제 artifact 파일', en: 'Exact artifact files declared by manifest', ja: 'Exact artifact files declared by manifest', zh: 'Exact artifact files declared by manifest', es: 'Exact artifact files declared by manifest', ar: 'Exact artifact files declared by manifest' })}<input data-testid="robot-catalog-artifacts" type="file" multiple onChange={event => { setCatalogArtifactFiles(Array.from(event.target.files ?? [])); setCatalogReport(null); setSelectionReport(null); setHousingReport(null); clearIntegrationState(); }} /></label>
        <button type="button" data-testid="robot-catalog-admit" disabled={!catalogManifestFile || !catalogArtifactFiles.length || catalogBusy} onClick={runCatalogAdmission}>{catalogBusy ? (localized(lang, { ko: '바이트·SHA-256 검사 중…', en: 'Checking bytes and SHA-256…', ja: 'Checking bytes and SHA-256…', zh: 'Checking bytes and SHA-256…', es: 'Checking bytes and SHA-256…', ar: 'Checking bytes and SHA-256…' })) : (localized(lang, { ko: '저장 없이 생산 적격성 검사', en: 'Check production eligibility without storage', ja: 'Check production eligibility without storage', zh: 'Check production eligibility without storage', es: 'Check production eligibility without storage', ar: 'Check production eligibility without storage' }))}</button>
        {catalogError && <div data-testid="robot-catalog-error" role="alert" style={{ color: '#b91c1c' }}>{catalogError}</div>}
        {catalogReport && <div data-testid="robot-catalog-report" style={{ padding: 6, border: '1px solid var(--nx-border)', borderRadius: 5, color: catalogReport.productionEligible ? '#166534' : '#b91c1c' }}>
          <b>{catalogReport.productionEligible ? (localized(lang, { ko: '바이트 검증 통과', en: 'Byte validation passed', ja: 'Byte validation passed', zh: 'Byte validation passed', es: 'Byte validation passed', ar: 'Byte validation passed' })) : (localized(lang, { ko: '생산 카탈로그 부적격', en: 'Production catalog rejected', ja: 'Production catalog rejected', zh: 'Production catalog rejected', es: 'Production catalog rejected', ar: 'Production catalog rejected' }))}</b> · {catalogReport.componentCount} components · {catalogReport.artifactCount} artifacts · {catalogReport.totalArtifactBytes} bytes
          {catalogReport.artifacts.map(item => <div key={item.name}>{item.verified ? '✓' : '✗'} {item.name} · {item.actualSha256 ? `${item.actualSha256.slice(0, 12)}…` : 'missing'}</div>)}
          {catalogReport.errors.map((message, index) => <div key={`${index}-${message}`}>{message}</div>)}
          <div>manifest {catalogReport.manifestSha256.slice(0, 12)}… · artifact set {catalogReport.artifactSetSha256.slice(0, 12)}…</div>
          <div style={{ color: '#92400e' }}>{localized(lang, { ko: '승인된 카탈로그 레코드이며 로봇에 설치된 22개 occurrence를 뜻하지 않습니다. 실제 부품 선정은 아직 실행되지 않았습니다.', en: 'These are admitted catalog records, not 22 installed robot occurrences. Actual component selection has not run.', ja: 'These are admitted catalog records, not 22 installed robot occurrences. Actual component selection has not run.', zh: 'These are admitted catalog records, not 22 installed robot occurrences. Actual component selection has not run.', es: 'These are admitted catalog records, not 22 installed robot occurrences. Actual component selection has not run.', ar: 'These are admitted catalog records, not 22 installed robot occurrences. Actual component selection has not run.' })}</div>
          <button type="button" data-testid="robot-catalog-report-download" onClick={downloadCatalogReport}>{localized(lang, { ko: '해시 결합 검증 보고서 다운로드', en: 'Download hash-bound validation report', ja: 'Download hash-bound validation report', zh: 'Download hash-bound validation report', es: 'Download hash-bound validation report', ar: 'Download hash-bound validation report' })}</button>
          <div style={{ color: '#92400e' }}>{localized(lang, { ko: '검사 결과는 카탈로그를 활성화하거나 견적·RFQ를 만들지 않습니다.', en: 'Validation does not activate the catalog or create a quote/RFQ.', ja: 'Validation does not activate the catalog or create a quote/RFQ.', zh: 'Validation does not activate the catalog or create a quote/RFQ.', es: 'Validation does not activate the catalog or create a quote/RFQ.', ar: 'Validation does not activate the catalog or create a quote/RFQ.' })}</div>
        </div>}
        <label>{localized(lang, { ko: 'J1~J6 선정 요구조건 JSON', en: 'J1–J6 selection requirements JSON', ja: 'J1–J6 selection requirements JSON', zh: 'J1–J6 selection requirements JSON', es: 'J1–J6 selection requirements JSON', ar: 'J1–J6 selection requirements JSON' })}<input data-testid="robot-catalog-requirements" type="file" accept="application/json,.json" onChange={event => { setCatalogRequirementsFile(event.target.files?.[0] ?? null); setSelectionReport(null); setHousingReport(null); clearIntegrationState(); }} /></label>
        <button type="button" data-testid="robot-catalog-select" disabled={!catalogRequirementsFile || !catalogManifestFile || !catalogArtifactFiles.length || selectionBusy} onClick={runCatalogSelection}>{selectionBusy ? (localized(lang, { ko: '6축 선정·마진 계산 중…', en: 'Selecting and calculating margins…', ja: 'Selecting and calculating margins…', zh: 'Selecting and calculating margins…', es: 'Selecting and calculating margins…', ar: 'Selecting and calculating margins…' })) : (localized(lang, { ko: '6축 부품 선정 시뮬레이션', en: 'Simulate six-axis component selection', ja: 'Simulate six-axis component selection', zh: 'Simulate six-axis component selection', es: 'Simulate six-axis component selection', ar: 'Simulate six-axis component selection' }))}</button>
        {selectionReport && <div data-testid="robot-catalog-selection-report" style={{ padding: 6, border: '1px solid var(--nx-border)', borderRadius: 5, color: driveSelected + auxiliarySelected === DRIVE_OCCURRENCES + AUXILIARY_OCCURRENCES ? '#166534' : '#b91c1c' }}>
          <b>{driveSelected === DRIVE_OCCURRENCES ? (localized(lang, { ko: '6축 구동계 선정 통과', en: 'Six-axis drive selection passed', ja: 'Six-axis drive selection passed', zh: 'Six-axis drive selection passed', es: 'Six-axis drive selection passed', ar: 'Six-axis drive selection passed' })) : (localized(lang, { ko: '구동계 선정 실패', en: 'Drive selection failed', ja: 'Drive selection failed', zh: 'Drive selection failed', es: 'Drive selection failed', ar: 'Drive selection failed' }))}</b> · {driveSelected}/{DRIVE_OCCURRENCES}
          <div>{localized(lang, { ko: '보조부품 선택', en: 'Auxiliary selection', ja: 'Auxiliary selection', zh: 'Auxiliary selection', es: 'Auxiliary selection', ar: 'Auxiliary selection' })}: {auxiliarySelected}/{AUXILIARY_OCCURRENCES} · {selectionReport.auxiliarySelectionStatus}</div>
          <div>{localized(lang, { ko: '전체 선택', en: 'Overall selection', ja: 'Overall selection', zh: 'Overall selection', es: 'Overall selection', ar: 'Overall selection' })}: {driveSelected + auxiliarySelected}/{DRIVE_OCCURRENCES + AUXILIARY_OCCURRENCES} · {driveSelected + auxiliarySelected === DRIVE_OCCURRENCES + AUXILIARY_OCCURRENCES ? 'passed' : 'blocked'} · CAD integration {selectionReport.cadIntegrationStatus} · release {String(selectionReport.releaseReady)}</div>
          {selectionReport.selections.map(item => <div key={item.joint}>J{item.joint}: {item.motor.model} + {item.reducer.model} + {item.bearing.model} · torque {item.margins.torque.toFixed(2)}× · speed {item.margins.speed.toFixed(2)}× · bearing {item.margins.bearingLoad.toFixed(2)}×</div>)}
          {selectionReport.auxiliarySelections.map(item => <div key={item.kind}>{item.kind}: {item.component.model} · {item.component.id}</div>)}
          {selectionReport.errors.map((message, index) => <div key={`${index}-${message}`}>{message}</div>)}
          <button type="button" data-testid="robot-catalog-selection-download" onClick={downloadSelectionReport}>{localized(lang, { ko: '선정 증거 보고서 다운로드', en: 'Download selection evidence report', ja: 'Download selection evidence report', zh: 'Download selection evidence report', es: 'Download selection evidence report', ar: 'Download selection evidence report' })}</button>
          <div style={{ color: '#92400e' }}>{localized(lang, { ko: '선정 통과는 CAD 반영·하우징 적합성·릴리스를 수행하지 않습니다.', en: 'Selection does not apply CAD changes, prove housing fit, or release production.', ja: 'Selection does not apply CAD changes, prove housing fit, or release production.', zh: 'Selection does not apply CAD changes, prove housing fit, or release production.', es: 'Selection does not apply CAD changes, prove housing fit, or release production.', ar: 'Selection does not apply CAD changes, prove housing fit, or release production.' })}</div>
        </div>}
        <label>{localized(lang, { ko: 'J1~J6 하우징 내부 치수·여유·증거 JSON', en: 'J1–J6 housing dimensions, clearances and evidence JSON', ja: 'J1–J6 housing dimensions, clearances and evidence JSON', zh: 'J1–J6 housing dimensions, clearances and evidence JSON', es: 'J1–J6 housing dimensions, clearances and evidence JSON', ar: 'J1–J6 housing dimensions, clearances and evidence JSON' })}<input data-testid="robot-housing-capacities" type="file" accept="application/json,.json" onChange={event => { setHousingFile(event.target.files?.[0] ?? null); setHousingReport(null); clearIntegrationState(); }} /></label>
        <button type="button" data-testid="robot-housing-fit" disabled={!housingFile || !catalogRequirementsFile || !catalogManifestFile || !catalogArtifactFiles.length || housingBusy} onClick={runHousingFit}>{housingBusy ? (localized(lang, { ko: '6축 하우징 여유 검증 중…', en: 'Checking six-axis housing clearances…', ja: 'Checking six-axis housing clearances…', zh: 'Checking six-axis housing clearances…', es: 'Checking six-axis housing clearances…', ar: 'Checking six-axis housing clearances…' })) : (localized(lang, { ko: '저장·CAD 수정 없이 하우징 적합성 검사', en: 'Check housing fit without storage or CAD changes', ja: 'Check housing fit without storage or CAD changes', zh: 'Check housing fit without storage or CAD changes', es: 'Check housing fit without storage or CAD changes', ar: 'Check housing fit without storage or CAD changes' }))}</button>
        {housingReport && <div data-testid="robot-housing-fit-report" style={{ padding: 6, border: '1px solid var(--nx-border)', borderRadius: 5, color: housingReport.housingStatus === 'passed' ? '#166534' : '#b91c1c' }}>
          <b>{localized(lang, { ko: '하우징 적합성', en: 'Housing fit', ja: 'Housing fit', zh: 'Housing fit', es: 'Housing fit', ar: 'Housing fit' })}: {housingReport.housingStatus}</b> · CAD integration {housingReport.cadIntegrationStatus} · release {String(housingReport.releaseReady)}
          {housingReport.fits.map(item => <div key={item.joint}>J{item.joint}: {item.status} · required {item.requiredInternalMm ? `${item.requiredInternalMm.x}×${item.requiredInternalMm.y}×${item.requiredInternalMm.z} mm` : 'n/a'} · available {item.availableInternalMm ? `${item.availableInternalMm.x}×${item.availableInternalMm.y}×${item.availableInternalMm.z} mm` : 'n/a'}</div>)}
          {housingReport.errors.map((message, index) => <div key={`${index}-${message}`}>{message}</div>)}
          <button type="button" data-testid="robot-housing-fit-download" onClick={downloadHousingReport}>{localized(lang, { ko: '해시 결합 하우징 보고서 다운로드', en: 'Download hash-bound housing report', ja: 'Download hash-bound housing report', zh: 'Download hash-bound housing report', es: 'Download hash-bound housing report', ar: 'Download hash-bound housing report' })}</button>
          <div style={{ color: '#92400e' }}>{localized(lang, { ko: '통과해도 CAD 형상을 수정하거나 생산 릴리스를 승인하지 않습니다.', en: 'Passing does not modify CAD geometry or approve production release.', ja: 'Passing does not modify CAD geometry or approve production release.', zh: 'Passing does not modify CAD geometry or approve production release.', es: 'Passing does not modify CAD geometry or approve production release.', ar: 'Passing does not modify CAD geometry or approve production release.' })}</div>
        </div>}
        <button type="button" data-testid="robot-integration-prepare" disabled={!revisionProgramFile || !revisionManifestFile || !housingFile || !catalogRequirementsFile || !catalogManifestFile || !catalogArtifactFiles.length || integrationBusy} onClick={runIntegrationPreparation}>{integrationBusy ? (localized(lang, { ko: '통합 target hash 구성 중…', en: 'Building integration target hash…', ja: 'Building integration target hash…', zh: 'Building integration target hash…', es: 'Building integration target hash…', ar: 'Building integration target hash…' })) : (localized(lang, { ko: '전문가 CAD 통합 검토 패키지 준비', en: 'Prepare expert CAD integration review packet', ja: 'Prepare expert CAD integration review packet', zh: 'Prepare expert CAD integration review packet', es: 'Prepare expert CAD integration review packet', ar: 'Prepare expert CAD integration review packet' }))}</button>
        {integrationPacket && <div data-testid="robot-integration-packet" style={{ padding: 6, border: '1px solid var(--nx-border)', borderRadius: 5, color: integrationPacket.readiness === 'review_pending' ? '#92400e' : '#b91c1c' }}>
          <b>{integrationPacket.readiness}</b> · target {integrationPacket.targetHash.slice(0, 12)}… · CAD {integrationPacket.cadIntegrationStatus} · release {String(integrationPacket.releaseReady)}
          <div>{localized(lang, { ko: '구동계 통합 계획', en: 'Drive integration plan', ja: 'Drive integration plan', zh: 'Drive integration plan', es: 'Drive integration plan', ar: 'Drive integration plan' })}: {drivePlanned}/{DRIVE_OCCURRENCES}</div>
          <div>{localized(lang, { ko: '보조부품 통합 계획', en: 'Auxiliary integration plan', ja: 'Auxiliary integration plan', zh: 'Auxiliary integration plan', es: 'Auxiliary integration plan', ar: 'Auxiliary integration plan' })}: {auxiliaryPlanned}/{AUXILIARY_OCCURRENCES}</div>
          <div>{localized(lang, { ko: '전체 통합 계획', en: 'Overall integration plan', ja: 'Overall integration plan', zh: 'Overall integration plan', es: 'Overall integration plan', ar: 'Overall integration plan' })}: {drivePlanned + auxiliaryPlanned}/{DRIVE_OCCURRENCES + AUXILIARY_OCCURRENCES} · {drivePlanned + auxiliaryPlanned === DRIVE_OCCURRENCES + AUXILIARY_OCCURRENCES ? 'review_pending' : 'blocked'}</div>
          {integrationPacket.replacements.map(item => <div key={item.joint}>J{item.joint}: {item.placeholders.motor} / {item.placeholders.reducer} / {item.placeholders.bearing} → {item.selected.motor} / {item.selected.reducer} / {item.selected.bearing}</div>)}
          {(integrationPacket.auxiliaryAdditions ?? []).map(item => <div key={item.kind}>{item.kind}: {item.pendingComponentId} → {item.selected} · {item.occurrenceId}</div>)}
          {integrationPacket.errors.map((message, index) => <div key={`${index}-${message}`}>{message}</div>)}
          <button type="button" data-testid="robot-integration-download" onClick={downloadIntegrationPacket}>{localized(lang, { ko: '불변 전문가 검토 패키지 다운로드', en: 'Download immutable expert review packet', ja: 'Download immutable expert review packet', zh: 'Download immutable expert review packet', es: 'Download immutable expert review packet', ar: 'Download immutable expert review packet' })}</button>
          <div>{localized(lang, { ko: '전문가 검토가 필수이며, 이 패키지는 CAD를 적용하거나 생산을 승인하지 않습니다.', en: 'Expert review is required; this packet neither applies CAD nor approves production.', ja: 'Expert review is required; this packet neither applies CAD nor approves production.', zh: 'Expert review is required; this packet neither applies CAD nor approves production.', es: 'Expert review is required; this packet neither applies CAD nor approves production.', ar: 'Expert review is required; this packet neither applies CAD nor approves production.' })}</div>
        </div>}
        <label>{localized(lang, { ko: '다운로드한 통합 검토 패키지 JSON', en: 'Downloaded integration review packet JSON', ja: 'Downloaded integration review packet JSON', zh: 'Downloaded integration review packet JSON', es: 'Downloaded integration review packet JSON', ar: 'Downloaded integration review packet JSON' })}<input data-testid="robot-integration-packet-file" type="file" accept="application/json,.json" onChange={event => { setIntegrationPacketFile(event.target.files?.[0] ?? null); clearReviewState(); }} /></label>
        <label>{localized(lang, { ko: '오프라인 Ed25519 이중 서명 검토 JSON', en: 'Offline Ed25519 dual-signoff review JSON', ja: 'Offline Ed25519 dual-signoff review JSON', zh: 'Offline Ed25519 dual-signoff review JSON', es: 'Offline Ed25519 dual-signoff review JSON', ar: 'Offline Ed25519 dual-signoff review JSON' })}<input data-testid="robot-integration-review-file" type="file" accept="application/json,.json" onChange={event => { setIntegrationReviewFile(event.target.files?.[0] ?? null); clearReviewState(); }} /></label>
        <button type="button" data-testid="robot-integration-review" disabled={!integrationPacketFile || !integrationReviewFile || integrationReviewBusy} onClick={runIntegrationReview}>{integrationReviewBusy ? (localized(lang, { ko: '서명 검증 중…', en: 'Verifying signatures…', ja: 'Verifying signatures…', zh: 'Verifying signatures…', es: 'Verifying signatures…', ar: 'Verifying signatures…' })) : (localized(lang, { ko: '서버 신뢰 키로 이중 서명 검증', en: 'Verify dual signatures against server trust registry', ja: 'Verify dual signatures against server trust registry', zh: 'Verify dual signatures against server trust registry', es: 'Verify dual signatures against server trust registry', ar: 'Verify dual signatures against server trust registry' }))}</button>
        {integrationReviewResult && <div data-testid="robot-integration-review-result" style={{ padding: 6, border: '1px solid var(--nx-border)', borderRadius: 5, color: integrationReviewResult.approved ? '#166534' : '#b91c1c' }}>
          <b>{integrationReviewResult.approved ? (localized(lang, { ko: '통합 작업 승인됨', en: 'Integration work authorized', ja: 'Integration work authorized', zh: 'Integration work authorized', es: 'Integration work authorized', ar: 'Integration work authorized' })) : (localized(lang, { ko: '검토 승인 안 됨', en: 'Review not approved', ja: 'Review not approved', zh: 'Review not approved', es: 'Review not approved', ar: 'Review not approved' }))}</b> · CAD applied {String(integrationReviewResult.cadApplied)} · release {String(integrationReviewResult.releaseReady)}
          {integrationReviewResult.errors.map((message, index) => <div key={`${index}-${message}`}>{message}</div>)}
          <div>{localized(lang, { ko: '다음 단계: 새 CAD 리비전 생성 후 전체 정밀 재검증', en: 'Next: create a new CAD revision, then run full precise reverification.', ja: 'Next: create a new CAD revision, then run full precise reverification.', zh: 'Next: create a new CAD revision, then run full precise reverification.', es: 'Next: create a new CAD revision, then run full precise reverification.', ar: 'Next: create a new CAD revision, then run full precise reverification.' })}</div>
          <button type="button" data-testid="robot-integration-review-download" onClick={downloadIntegrationReviewResult}>{localized(lang, { ko: '서명 검증 결과 다운로드', en: 'Download signature validation result', ja: 'Download signature validation result', zh: 'Download signature validation result', es: 'Download signature validation result', ar: 'Download signature validation result' })}</button>
        </div>}
        <button type="button" data-testid="robot-integration-apply-revision" disabled={!integrationReviewResult?.approved || drivePlanned !== DRIVE_OCCURRENCES || auxiliaryPlanned !== AUXILIARY_OCCURRENCES || !revisionProgramFile || !revisionManifestFile || !integrationPacketFile || !integrationReviewFile || !housingFile || !catalogRequirementsFile || !catalogManifestFile || !catalogArtifactFiles.length || integrationApplyBusy} onClick={runIntegrationApplication}>{integrationApplyBusy ? (localized(lang, { ko: '새 CAD 리비전 구성 중…', en: 'Building new CAD revision…', ja: 'Building new CAD revision…', zh: 'Building new CAD revision…', es: 'Building new CAD revision…', ar: 'Building new CAD revision…' })) : (localized(lang, { ko: '승인 target으로 새 CAD 리비전 ZIP 생성', en: 'Build new CAD revision ZIP from approved target', ja: 'Build new CAD revision ZIP from approved target', zh: 'Build new CAD revision ZIP from approved target', es: 'Build new CAD revision ZIP from approved target', ar: 'Build new CAD revision ZIP from approved target' }))}</button>
        {integrationApplyMessage && <div data-testid="robot-integration-apply-message">
          {integrationApplyMessage} · {localized(lang, { ko: '적용 증명', en: 'applied evidence', ja: 'applied evidence', zh: 'applied evidence', es: 'applied evidence', ar: 'applied evidence' })} {driveApplied + auxiliaryApplied}/{DRIVE_OCCURRENCES + AUXILIARY_OCCURRENCES}
          {driveApplied + auxiliaryApplied === DRIVE_OCCURRENCES + AUXILIARY_OCCURRENCES && <div>{localized(lang, { ko: '생성된 r+1 카탈로그 unresolved 0 · 정밀 재검증 전에는 릴리스 증거가 아닙니다.', en: 'Generated r+1 catalog unresolved 0 · this is not release evidence before precise reverification.', ja: 'Generated r+1 catalog unresolved 0 · this is not release evidence before precise reverification.', zh: 'Generated r+1 catalog unresolved 0 · this is not release evidence before precise reverification.', es: 'Generated r+1 catalog unresolved 0 · this is not release evidence before precise reverification.', ar: 'Generated r+1 catalog unresolved 0 · this is not release evidence before precise reverification.' })}</div>}
          <div style={{ color: '#92400e' }}>{localized(lang, { ko: '카탈로그 unresolved가 0이어도 정밀 CAD 검증·제조 검증·최종 전문가 승인은 계속 필요합니다.', en: 'Catalog unresolved may be 0, but exact-CAD validation, manufacturing validation and final expert approval are still required.', ja: 'Catalog unresolved may be 0, but exact-CAD validation, manufacturing validation and final expert approval are still required.', zh: 'Catalog unresolved may be 0, but exact-CAD validation, manufacturing validation and final expert approval are still required.', es: 'Catalog unresolved may be 0, but exact-CAD validation, manufacturing validation and final expert approval are still required.', ar: 'Catalog unresolved may be 0, but exact-CAD validation, manufacturing validation and final expert approval are still required.' })}</div>
        </div>}
        <label>{localized(lang, { ko: 'ZIP의 integration application 영수증 JSON', en: 'Integration application receipt JSON from ZIP', ja: 'Integration application receipt JSON from ZIP', zh: 'Integration application receipt JSON from ZIP', es: 'Integration application receipt JSON from ZIP', ar: 'Integration application receipt JSON from ZIP' })}<input data-testid="robot-integration-receipt" type="file" accept="application/json,.json" onChange={event => { setIntegrationReceiptFile(event.target.files?.[0] ?? null); clearPostState(); }} /></label>
        <button type="button" data-testid="robot-post-integration-verify" disabled={!revisionProgramFile || !revisionManifestFile || !reportFile || !integrationReceiptFile || !integrationPacketFile || !integrationReviewFile || !housingFile || !catalogRequirementsFile || !catalogManifestFile || !catalogArtifactFiles.length || postIntegrationBusy} onClick={runPostIntegrationVerification}>{postIntegrationBusy ? (localized(lang, { ko: '사후 통합 증거 교차검증 중…', en: 'Cross-checking post-integration evidence…', ja: 'Cross-checking post-integration evidence…', zh: 'Cross-checking post-integration evidence…', es: 'Cross-checking post-integration evidence…', ar: 'Cross-checking post-integration evidence…' })) : (localized(lang, { ko: 'r+1 정밀·카탈로그·하우징 사후 통합 검증', en: 'Post-verify r+1 precision, catalog and housing evidence', ja: 'Post-verify r+1 precision, catalog and housing evidence', zh: 'Post-verify r+1 precision, catalog and housing evidence', es: 'Post-verify r+1 precision, catalog and housing evidence', ar: 'Post-verify r+1 precision, catalog and housing evidence' }))}</button>
        {postIntegrationReport && <div data-testid="robot-post-integration-report" style={{ padding: 6, border: '1px solid var(--nx-border)', borderRadius: 5, color: postIntegrationReport.postIntegrationStatus === 'passed' ? '#166534' : '#b91c1c' }}>
          <b>{localized(lang, { ko: '사후 통합', en: 'Post-integration', ja: 'Post-integration', zh: 'Post-integration', es: 'Post-integration', ar: 'Post-integration' })}: {postIntegrationReport.postIntegrationStatus}</b> · precision {postIntegrationReport.precisionStatus} · release {String(postIntegrationReport.releaseReady)}
          <div>{localized(lang, { ko: '구동계', en: 'Drive', ja: 'Drive', zh: 'Drive', es: 'Drive', ar: 'Drive' })}: {postIntegrationReport.counts.selectedOccurrences}/{DRIVE_OCCURRENCES} occurrences · motion {postIntegrationReport.counts.checkedMotionFrames}/{postIntegrationReport.counts.motionFrames} · collisions {postIntegrationReport.counts.collisionFrames} · interferences {postIntegrationReport.counts.preciseInterferences}</div>
          <div>{localized(lang, { ko: '보조부품', en: 'Auxiliary', ja: 'Auxiliary', zh: 'Auxiliary', es: 'Auxiliary', ar: 'Auxiliary' })}: {postIntegrationReport.counts.auxiliaryOccurrences}/{AUXILIARY_OCCURRENCES} occurrences · total {postIntegrationReport.counts.appliedOccurrences}/22 · unresolved {postIntegrationReport.counts.catalogUnresolved}</div>
          {postIntegrationReport.errors.map((message, index) => <div key={`${index}-${message}`}>{message}</div>)}
          <div>{localized(lang, { ko: '남은 릴리스 차단', en: 'Remaining release blockers', ja: 'Remaining release blockers', zh: 'Remaining release blockers', es: 'Remaining release blockers', ar: 'Remaining release blockers' })}: {postIntegrationReport.blockers.join(' · ')}</div>
          <div style={{ color: '#92400e' }}>{localized(lang, { ko: '카탈로그 22/22와 unresolved 0만으로는 릴리스할 수 없습니다. 정밀 CAD 검증 · 제조 검증 · 최종 전문가 승인이 필요합니다.', en: 'Catalog 22/22 and unresolved 0 are not sufficient for release. Exact-CAD validation · manufacturing validation · final expert approval remain required.', ja: 'Catalog 22/22 and unresolved 0 are not sufficient for release. Exact-CAD validation · manufacturing validation · final expert approval remain required.', zh: 'Catalog 22/22 and unresolved 0 are not sufficient for release. Exact-CAD validation · manufacturing validation · final expert approval remain required.', es: 'Catalog 22/22 and unresolved 0 are not sufficient for release. Exact-CAD validation · manufacturing validation · final expert approval remain required.', ar: 'Catalog 22/22 and unresolved 0 are not sufficient for release. Exact-CAD validation · manufacturing validation · final expert approval remain required.' })}</div>
          <button type="button" data-testid="robot-post-integration-download" onClick={downloadPostIntegrationReport}>{localized(lang, { ko: '사후 통합 증거 보고서 다운로드', en: 'Download post-integration evidence report', ja: 'Download post-integration evidence report', zh: 'Download post-integration evidence report', es: 'Download post-integration evidence report', ar: 'Download post-integration evidence report' })}</button>
        </div>}
        <label>{localized(lang, { ko: '다운로드한 사후 통합 증거 JSON', en: 'Downloaded post-integration evidence JSON', ja: 'Downloaded post-integration evidence JSON', zh: 'Downloaded post-integration evidence JSON', es: 'Downloaded post-integration evidence JSON', ar: 'Downloaded post-integration evidence JSON' })}<input data-testid="robot-release-post-evidence" type="file" accept="application/json,.json" onChange={event => { clearReleaseState(); setPostIntegrationEvidenceFile(event.target.files?.[0] ?? null); }} /></label>
        <button type="button" data-testid="robot-release-work-packet" disabled={!postIntegrationEvidenceFile || releaseWorkBusy} onClick={runReleaseWorkPacket}>{releaseWorkBusy ? (localized(lang, { ko: '내부 작업 패킷 구성 중…', en: 'Building internal work packet…', ja: 'Building internal work packet…', zh: 'Building internal work packet…', es: 'Building internal work packet…', ar: 'Building internal work packet…' })) : (localized(lang, { ko: 'NexyFab 정밀 CAD·제조 작업 패킷 만들기', en: 'Build NexyFab exact-CAD and manufacturing work packet', ja: 'Build NexyFab exact-CAD and manufacturing work packet', zh: 'Build NexyFab exact-CAD and manufacturing work packet', es: 'Build NexyFab exact-CAD and manufacturing work packet', ar: 'Build NexyFab exact-CAD and manufacturing work packet' }))}</button>
        {releaseWorkPacket && <div data-testid="robot-release-work-report"><b>{localized(lang, { ko: '자체 정밀 CAD 증거 프리플라이트', en: 'NexyFab exact-CAD evidence preflight', ja: 'NexyFab exact-CAD evidence preflight', zh: 'NexyFab exact-CAD evidence preflight', es: 'NexyFab exact-CAD evidence preflight', ar: 'NexyFab exact-CAD evidence preflight' })}</b> · exact CAD keys {releaseWorkPacket.registryPreflight.exactCadSignerKeys} · manufacturing keys {releaseWorkPacket.registryPreflight.manufacturingReviewerKeys} · final pair {String(releaseWorkPacket.registryPreflight.finalReview.distinctPairAvailable)}<div>exact CAD 29 parts · manufacturing 18 drive + 4 auxiliary = 22 · program {releaseWorkPacket.programHash.slice(0, 12)}…</div><div>external CAD false · source bytes false · private keys false · release false</div><button type="button" data-testid="robot-release-work-download" onClick={downloadReleaseWorkPacket}>{localized(lang, { ko: '해시 결합 작업 패킷 다운로드', en: 'Download hash-bound work packet', ja: 'Download hash-bound work packet', zh: 'Download hash-bound work packet', es: 'Download hash-bound work packet', ar: 'Download hash-bound work packet' })}</button></div>}
        <label>{localized(lang, { ko: '서명된 NexyFab 정밀 CAD 증거 JSON (없어도 부족분 감사 가능)', en: 'Signed NexyFab exact-CAD evidence JSON (optional for gap audit)', ja: 'Signed NexyFab exact-CAD evidence JSON (optional for gap audit)', zh: 'Signed NexyFab exact-CAD evidence JSON (optional for gap audit)', es: 'Signed NexyFab exact-CAD evidence JSON (optional for gap audit)', ar: 'Signed NexyFab exact-CAD evidence JSON (optional for gap audit)' })}<input data-testid="robot-release-exact-cad-evidence" type="file" accept="application/json,.json" onChange={event => setExactCadEvidenceFile(event.target.files?.[0] ?? null)} /></label>
        <label>{localized(lang, { ko: '서명된 제조 검증 JSON (없어도 부족분 감사 가능)', en: 'Signed manufacturing validation JSON (optional for gap audit)', ja: 'Signed manufacturing validation JSON (optional for gap audit)', zh: 'Signed manufacturing validation JSON (optional for gap audit)', es: 'Signed manufacturing validation JSON (optional for gap audit)', ar: 'Signed manufacturing validation JSON (optional for gap audit)' })}<input data-testid="robot-release-manufacturing-evidence" type="file" accept="application/json,.json" onChange={event => setManufacturingEvidenceFile(event.target.files?.[0] ?? null)} /></label>
        <button type="button" data-testid="robot-release-audit" disabled={!postIntegrationEvidenceFile || releaseAuditBusy} onClick={runReleaseAudit}>{releaseAuditBusy ? (localized(lang, { ko: '자체 증거 감사 중…', en: 'Auditing NexyFab evidence…', ja: 'Auditing NexyFab evidence…', zh: 'Auditing NexyFab evidence…', es: 'Auditing NexyFab evidence…', ar: 'Auditing NexyFab evidence…' })) : (localized(lang, { ko: '정밀 CAD·제조 릴리스 증거 감사', en: 'Audit exact-CAD and manufacturing release evidence', ja: 'Audit exact-CAD and manufacturing release evidence', zh: 'Audit exact-CAD and manufacturing release evidence', es: 'Audit exact-CAD and manufacturing release evidence', ar: 'Audit exact-CAD and manufacturing release evidence' }))}</button>
        {releaseAuditReport && <div data-testid="robot-release-audit-report"><b>{releaseAuditReport.status}</b> · exact CAD {String(releaseAuditReport.exactCadEvidenceValid)} · manufacturing {String(releaseAuditReport.manufacturingEvidenceValid)} · external CAD false · release false<div>{releaseAuditReport.blockers.join(' · ')}</div>{releaseAuditReport.errors.map((message, index) => <div key={`${index}-${message}`}>{message}</div>)}<button type="button" data-testid="robot-release-audit-download" onClick={downloadReleaseAudit}>{localized(lang, { ko: '릴리스 감사 보고서 다운로드', en: 'Download release audit report', ja: 'Download release audit report', zh: 'Download release audit report', es: 'Download release audit report', ar: 'Download release audit report' })}</button></div>}
        <div style={{ color: '#92400e' }}>{localized(lang, { ko: '위 정밀 CAD·제조 감사는 부족분 확인용 레거시 감사이며 최종 승인 입력이 아닙니다. 최종 검토에는 Verified Systems 단계에서 생성한 서버 서명 v2 감사를 사용하십시오.', en: 'The exact-CAD/manufacturing audit above is a legacy gap audit, not a final approval input. Final review requires the server-attested v2 audit produced by the Verified Systems stage.', ja: 'The exact-CAD/manufacturing audit above is a legacy gap audit, not a final approval input. Final review requires the server-attested v2 audit produced by the Verified Systems stage.', zh: 'The exact-CAD/manufacturing audit above is a legacy gap audit, not a final approval input. Final review requires the server-attested v2 audit produced by the Verified Systems stage.', es: 'The exact-CAD/manufacturing audit above is a legacy gap audit, not a final approval input. Final review requires the server-attested v2 audit produced by the Verified Systems stage.', ar: 'The exact-CAD/manufacturing audit above is a legacy gap audit, not a final approval input. Final review requires the server-attested v2 audit produced by the Verified Systems stage.' })}</div>
        <label>{localized(lang, { ko: '서버 서명 ready_for_final_review v2 감사 JSON', en: 'Server-attested ready_for_final_review v2 audit JSON', ja: 'Server-attested ready_for_final_review v2 audit JSON', zh: 'Server-attested ready_for_final_review v2 audit JSON', es: 'Server-attested ready_for_final_review v2 audit JSON', ar: 'Server-attested ready_for_final_review v2 audit JSON' })}<input data-testid="robot-final-audit-file" type="file" accept="application/json,.json" onChange={event => setFinalAuditFile(event.target.files?.[0] ?? null)} /></label>
        <label>{localized(lang, { ko: '최종 오프라인 이중 서명 JSON', en: 'Final offline dual-signoff JSON', ja: 'Final offline dual-signoff JSON', zh: 'Final offline dual-signoff JSON', es: 'Final offline dual-signoff JSON', ar: 'Final offline dual-signoff JSON' })}<input data-testid="robot-final-review-file" type="file" accept="application/json,.json" onChange={event => setFinalReviewFile(event.target.files?.[0] ?? null)} /></label>
        <button type="button" data-testid="robot-final-review" disabled={!finalAuditFile || !finalReviewFile || finalReviewBusy} onClick={runFinalReleaseReview}>{finalReviewBusy ? (localized(lang, { ko: '최종 서명 검증 중…', en: 'Verifying final signatures…', ja: 'Verifying final signatures…', zh: 'Verifying final signatures…', es: 'Verifying final signatures…', ar: 'Verifying final signatures…' })) : (localized(lang, { ko: '최종 릴리스 자격 검증', en: 'Verify final release eligibility', ja: 'Verify final release eligibility', zh: 'Verify final release eligibility', es: 'Verify final release eligibility', ar: 'Verify final release eligibility' }))}</button>
        {finalDecision && <div data-testid="robot-final-decision"><b>{finalDecision.approved ? (localized(lang, { ko: '릴리스 자격 승인', en: 'Release eligible', ja: 'Release eligible', zh: 'Release eligible', es: 'Release eligible', ar: 'Release eligible' })) : (localized(lang, { ko: '릴리스 자격 없음', en: 'Not release eligible', ja: 'Not release eligible', zh: 'Not release eligible', es: 'Not release eligible', ar: 'Not release eligible' }))}</b> · ready {String(finalDecision.releaseReady)} · executed {String(finalDecision.releaseExecuted)}<div>{finalDecision.errors.join(' · ')}</div><button type="button" data-testid="robot-final-decision-download" onClick={downloadFinalDecision}>{localized(lang, { ko: '최종 결정 다운로드', en: 'Download final decision', ja: 'Download final decision', zh: 'Download final decision', es: 'Download final decision', ar: 'Download final decision' })}</button><div>{localized(lang, { ko: '이 화면은 실제 릴리스 게시를 실행하지 않습니다.', en: 'This screen does not execute or publish a release.', ja: 'This screen does not execute or publish a release.', zh: 'This screen does not execute or publish a release.', es: 'This screen does not execute or publish a release.', ar: 'This screen does not execute or publish a release.' })}</div></div>}
      </div>
    </details>
    <details style={{ marginTop: 8 }}>
      <summary style={{ cursor: 'pointer', fontWeight: 700 }}>{localized(lang, { ko: '검증 증거 묶음 대조', en: 'Cross-check evidence bundle', ja: 'Cross-check evidence bundle', zh: 'Cross-check evidence bundle', es: 'Cross-check evidence bundle', ar: 'Cross-check evidence bundle' })}</summary>
      <div style={{ marginTop: 6, display: 'grid', gap: 5 }}>
        <label style={{ fontSize: 10.5 }}>{localized(lang, { ko: 'report.json', en: 'report.json', ja: 'report.json', zh: 'report.json', es: 'report.json', ar: 'report.json' })}<input data-testid="robot-evidence-report" type="file" accept="application/json,.json" onChange={event => { setReportFile(event.target.files?.[0] ?? null); clearPostState(); }} /></label>
        <label style={{ fontSize: 10.5 }}>{localized(lang, { ko: '편집 프로그램 JSON', en: 'Editable program JSON', ja: 'Editable program JSON', zh: 'Editable program JSON', es: 'Editable program JSON', ar: 'Editable program JSON' })}<input data-testid="robot-evidence-program" type="file" accept="application/json,.json" onChange={event => setProgramFile(event.target.files?.[0] ?? null)} /></label>
        <button type="button" data-testid="robot-evidence-verify" disabled={!reportFile || !programFile} onClick={loadEvidence}>{baselineEvidence ? (localized(lang, { ko: '새 수정본 재검증·비교', en: 'Reverify and compare revision', ja: 'Reverify and compare revision', zh: 'Reverify and compare revision', es: 'Reverify and compare revision', ar: 'Reverify and compare revision' })) : (localized(lang, { ko: 'SHA-256 연결 및 기준선 설정', en: 'Verify SHA-256 binding and set baseline', ja: 'Verify SHA-256 binding and set baseline', zh: 'Verify SHA-256 binding and set baseline', es: 'Verify SHA-256 binding and set baseline', ar: 'Verify SHA-256 binding and set baseline' }))}</button>
        <div style={{ display: 'grid', gap: 4, padding: 6, border: '1px solid var(--nx-border)', borderRadius: 5 }}>
          <b>{localized(lang, { ko: '수정 리비전 서버 재검증', en: 'Server-reverify edited revision', ja: 'Server-reverify edited revision', zh: 'Server-reverify edited revision', es: 'Server-reverify edited revision', ar: 'Server-reverify edited revision' })}</b>
          <label>{localized(lang, { ko: '리비전 프로그램 JSON', en: 'Revision program JSON', ja: 'Revision program JSON', zh: 'Revision program JSON', es: 'Revision program JSON', ar: 'Revision program JSON' })}<input data-testid="robot-revision-program" type="file" accept="application/json,.json" onChange={event => { setRevisionProgramFile(event.target.files?.[0] ?? null); clearIntegrationState(); }} /></label>
          <label>{localized(lang, { ko: '리비전 manifest JSON', en: 'Revision manifest JSON', ja: 'Revision manifest JSON', zh: 'Revision manifest JSON', es: 'Revision manifest JSON', ar: 'Revision manifest JSON' })}<input data-testid="robot-revision-manifest" type="file" accept="application/json,.json" onChange={event => { setRevisionManifestFile(event.target.files?.[0] ?? null); clearIntegrationState(); }} /></label>
          <button type="button" data-testid="robot-revision-reverify" disabled={!revisionProgramFile || !revisionManifestFile || revisionVerifyBusy} onClick={runRevisionReverification}>{revisionVerifyBusy ? (localized(lang, { ko: '정밀 재검증 중…', en: 'Precisely reverifying…', ja: 'Precisely reverifying…', zh: 'Precisely reverifying…', es: 'Precisely reverifying…', ar: 'Precisely reverifying…' })) : (localized(lang, { ko: '서버 재검증 후 report.json 다운로드', en: 'Server-reverify and download report.json', ja: 'Server-reverify and download report.json', zh: 'Server-reverify and download report.json', es: 'Server-reverify and download report.json', ar: 'Server-reverify and download report.json' }))}</button>
          <span style={{ color: '#92400e' }}>{localized(lang, { ko: '업로드 파일은 저장하지 않으며, 이 단계는 릴리스·견적·RFQ를 만들지 않습니다.', en: 'Uploads are not persisted; this does not release, quote, or send an RFQ.', ja: 'Uploads are not persisted; this does not release, quote, or send an RFQ.', zh: 'Uploads are not persisted; this does not release, quote, or send an RFQ.', es: 'Uploads are not persisted; this does not release, quote, or send an RFQ.', ar: 'Uploads are not persisted; this does not release, quote, or send an RFQ.' })}</span>
        </div>
        {evidenceError && <div data-testid="robot-evidence-error" role="alert" style={{ color: '#b91c1c' }}>{evidenceError}</div>}
        {evidence && <div data-testid="robot-evidence-summary" style={{ display: 'grid', gap: 3, padding: 6, border: '1px solid var(--nx-border)', borderRadius: 5, fontSize: 10.5 }}>
          <div><b>{localized(lang, { ko: '무결성', en: 'Integrity', ja: 'Integrity', zh: 'Integrity', es: 'Integrity', ar: 'Integrity' })}:</b> linked · report {evidence.reportHash.slice(0, 12)}… · program {evidence.programHash.slice(0, 12)}…</div>
          {baselineEvidence && <div><b>{localized(lang, { ko: '설계 계보·기준선', en: 'Design lineage · baseline', ja: 'Design lineage · baseline', zh: 'Design lineage · baseline', es: 'Design lineage · baseline', ar: 'Design lineage · baseline' })}:</b> {baselineEvidence.lineageId} · r{baselineEvidence.revision} · {baselineEvidence.programHash.slice(0, 12)}…</div>}
          {baselineEvidence && <button type="button" data-testid="robot-export-edited-revision" disabled={revisionExportBusy} onClick={exportEditedRevision}>{revisionExportBusy ? (localized(lang, { ko: '새 리비전 구성 중…', en: 'Building revision…', ja: 'Building revision…', zh: 'Building revision…', es: 'Building revision…', ar: 'Building revision…' })) : (localized(lang, { ko: `현재 CAD를 r${baselineEvidence.revision + 1} 재검증 패키지로 내보내기`, en: `Export current CAD as r${baselineEvidence.revision + 1} reverification package`, ja: `Export current CAD as r${baselineEvidence.revision + 1} reverification package`, zh: `Export current CAD as r${baselineEvidence.revision + 1} reverification package`, es: `Export current CAD as r${baselineEvidence.revision + 1} reverification package`, ar: `Export current CAD as r${baselineEvidence.revision + 1} reverification package` }))}</button>}
          {revisionExportMessage && <div data-testid="robot-revision-export-message">{revisionExportMessage}</div>}
          <div><b>CAD:</b> {evidence.editableParts} parts · {evidence.mates} mates · DoF {evidence.rankDoF ?? '?'} / {evidence.allowedDoF ?? '?'}</div>
          <div><b>{localized(lang, { ko: '정적 정밀 간섭', en: 'Static precise interference', ja: 'Static precise interference', zh: 'Static precise interference', es: 'Static precise interference', ar: 'Static precise interference' })}:</b> {evidence.flaggedInterferences}</div>
          <div><b>{localized(lang, { ko: '동작 재검증', en: 'Motion reverification', ja: 'Motion reverification', zh: 'Motion reverification', es: 'Motion reverification', ar: 'Motion reverification' })}:</b> {evidence.motionConverged ? 'converged' : 'incomplete'} · {evidence.checkedMotionFrames ?? 0}/{evidence.motionFrames} checked · {evidence.collisionFrames} collision frames</div>
          {evidence.motionAxes && <div data-testid="robot-motion-axes" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 3 }}>
            {evidence.motionAxes.map(axis => <span key={axis.mateId} style={{ padding: 3, border: '1px solid var(--nx-border)', color: axis.allConverged && axis.checkedFrames === axis.frameCount && axis.collisionFrameCount === 0 ? '#166534' : '#b91c1c' }}>
              {axis.mateId} {axis.rangeDeg[0]}°..{axis.rangeDeg[1]}° · {axis.checkedFrames}/{axis.frameCount} · {axis.collisionFrameCount} hit
              {axis.segments.map(segment => <small key={segment.direction} style={{ display: 'block' }}>{segment.direction === 'toward-min' ? 'min' : 'max'}: {segment.allConverged ? 'ok' : `fail@${segment.firstFailureFrame ?? '?'}`} · {segment.collisionFrameCount ? `hit@${segment.firstCollisionFrame ?? '?'} / ${segment.maxPenetrationMm ?? '?'}mm` : 'clear'}</small>)}
            </span>)}
          </div>}
          <div><b>{localized(lang, { ko: '카탈로그·하우징', en: 'Catalog · housing', ja: 'Catalog · housing', zh: 'Catalog · housing', es: 'Catalog · housing', ar: 'Catalog · housing' })}:</b> {evidence.catalogStatus} · {evidence.housingStatus}</div>
          <div style={{ color: evidence.effectiveReleaseReady ? '#166534' : '#b91c1c' }}><b>{localized(lang, { ko: '유효 릴리스', en: 'Effective release', ja: 'Effective release', zh: 'Effective release', es: 'Effective release', ar: 'Effective release' })}:</b> {String(evidence.effectiveReleaseReady)} · {evidence.blockers.length} blocker(s)</div>
          <div style={{ color: '#92400e' }}>{localized(lang, { ko: 'SHA 연결은 파일 무결성만 증명하며 출처·전문가 승인을 대신하지 않습니다.', en: 'SHA binding proves file integrity only; it does not replace provenance or expert approval.', ja: 'SHA binding proves file integrity only; it does not replace provenance or expert approval.', zh: 'SHA binding proves file integrity only; it does not replace provenance or expert approval.', es: 'SHA binding proves file integrity only; it does not replace provenance or expert approval.', ar: 'SHA binding proves file integrity only; it does not replace provenance or expert approval.' })}</div>
          {evidence.interferenceQueue.length > 0 && <div data-testid="robot-interference-queue" style={{ maxHeight: 190, overflow: 'auto', borderTop: '1px solid var(--nx-border)', paddingTop: 4 }}>
            <b>{localized(lang, { ko: '전문가 간섭 수정 큐', en: 'Expert interference remediation queue', ja: 'Expert interference remediation queue', zh: 'Expert interference remediation queue', es: 'Expert interference remediation queue', ar: 'Expert interference remediation queue' })} ({evidence.interferenceQueue.length})</b>
            {evidence.interferenceQueue.map(item => <div key={item.id} data-testid={`robot-interference-${item.id}`} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 5, padding: '4px 0', borderBottom: '1px solid var(--nx-border)' }}>
              <div><span style={{ color: item.priority === 'critical' ? '#b91c1c' : item.priority === 'high' ? '#b45309' : 'var(--nx-text-2)', fontWeight: 700 }}>{item.priority}</span> · {item.category}<br />{item.partA} ↔ {item.partB} · {item.penetrationMm ?? '?'} mm<br /><span style={{ color: 'var(--nx-text-3)' }}>{item.recommendedAction}</span></div>
              <button type="button" data-testid={`robot-focus-${item.id}`} onClick={() => focusQueueItem(item.id, [item.partA, item.partB])}>{localized(lang, { ko: 'CAD 선택', en: 'Select in CAD', ja: 'Select in CAD', zh: 'Select in CAD', es: 'Select in CAD', ar: 'Select in CAD' })}</button>
            </div>)}
          </div>}
          {focusResult && <div data-testid="robot-focus-result" style={{ color: focusResult.missingPartIds.length ? '#b91c1c' : '#166534' }}>{focusResult.selectedPartIds.length} selected · {focusResult.missingPartIds.length} missing</div>}
          {transitions && <div data-testid="robot-remediation-transitions" style={{ borderTop: '1px solid var(--nx-border)', paddingTop: 4 }}>
            <b>{localized(lang, { ko: '정밀 재검증 상태 전이', en: 'Precise reverification transitions', ja: 'Precise reverification transitions', zh: 'Precise reverification transitions', es: 'Precise reverification transitions', ar: 'Precise reverification transitions' })}</b>
            {(['regressed_reverified', 'new_interference', 'unchanged_reverified', 'improved_reverified', 'resolved_reverified'] as const).map(status => {
              const count = transitions.filter(item => item.status === status).length;
              return count ? <div key={status}>{status}: {count}</div> : null;
            })}
            <div style={{ color: '#92400e' }}>{localized(lang, { ko: '해결 상태는 새 프로그램 해시와 새 정밀 검증 보고서가 모두 확인된 경우에만 계산됩니다.', en: 'Resolved status is computed only from a new program hash and a new precise-verification report.', ja: 'Resolved status is computed only from a new program hash and a new precise-verification report.', zh: 'Resolved status is computed only from a new program hash and a new precise-verification report.', es: 'Resolved status is computed only from a new program hash and a new precise-verification report.', ar: 'Resolved status is computed only from a new program hash and a new precise-verification report.' })}</div>
            <button type="button" data-testid="robot-remediation-promote-baseline" onClick={() => { setBaselineEvidence(evidence); setTransitions(null); }}>{localized(lang, { ko: '이 재검증본을 다음 기준선으로 사용', en: 'Use this verified revision as next baseline', ja: 'Use this verified revision as next baseline', zh: 'Use this verified revision as next baseline', es: 'Use this verified revision as next baseline', ar: 'Use this verified revision as next baseline' })}</button>
          </div>}
        </div>}
      </div>
    </details>
  </section>;
}
