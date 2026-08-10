'use client';

import { useState } from 'react';
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
  applyIntegration?: (program: File, revision: File, packet: File, review: File, housing: File, requirements: File, manifest: File, artifacts: File[]) => Promise<{ bundle: Blob; filename: string; targetHash: string; programHash: string; revision: number; cadAppliedToWorkspace: false; releaseReady: false }>;
  postVerifyIntegration?: (program: File, revision: File, preciseReport: File, receipt: File, packet: File, review: File, housing: File, requirements: File, manifest: File, artifacts: File[]) => Promise<RobotPostIntegrationEvidence>;
  auditReleaseEvidence?: (post: File, exactCad: File | null, manufacturing: File | null) => Promise<RobotReleaseEvidenceAuditV2>;
  validateFinalReleaseReview?: (audit: File, review: File) => Promise<RobotFinalReleaseDecision>;
  buildReleaseWorkPacket?: (post: File) => Promise<RobotReleaseWorkPacketV2>;
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
  const targetHash = response.headers.get('x-nexyfab-target-hash') ?? '', programHash = response.headers.get('x-nexyfab-program-hash') ?? '', revisionNumber = Number(response.headers.get('x-nexyfab-revision')); if (!/^[a-f0-9]{64}$/.test(targetHash) || !/^[a-f0-9]{64}$/.test(programHash) || !Number.isInteger(revisionNumber) || response.headers.get('x-nexyfab-cad-applied-workspace') !== 'false' || response.headers.get('x-nexyfab-release-ready') !== 'false') throw new Error('unsafe CAD integration bundle response'); const disposition = response.headers.get('content-disposition') ?? ''; const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? `robot-cad-r${revisionNumber}-${programHash}.zip`; return { bundle: await response.blob(), filename, targetHash, programHash, revision: revisionNumber, cadAppliedToWorkspace: false, releaseReady: false };
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

export default function RobotPrecisionHandoffPanel({ lang, onHandoff, generate = defaultGenerate, verifyEvidence = verifyRobotEvidenceBundle, reverifyRevision = defaultReverifyRevision, admitCatalog = defaultAdmitCatalog, selectCatalog = defaultSelectCatalog, evaluateHousing = defaultEvaluateHousing, prepareIntegration = defaultPrepareIntegration, validateIntegrationReview = defaultValidateIntegrationReview, applyIntegration = defaultApplyIntegration, postVerifyIntegration = defaultPostVerifyIntegration, auditReleaseEvidence = defaultAuditReleaseEvidence, validateFinalReleaseReview = defaultValidateFinalReleaseReview, buildReleaseWorkPacket = defaultBuildReleaseWorkPacket }: RobotPrecisionHandoffPanelProps) {
  const ko = lang === 'ko';
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
  const [integrationReceiptFile, setIntegrationReceiptFile] = useState<File | null>(null);
  const [postIntegrationBusy, setPostIntegrationBusy] = useState(false);
  const [postIntegrationReport, setPostIntegrationReport] = useState<RobotPostIntegrationEvidence | null>(null);
  const [postIntegrationEvidenceFile, setPostIntegrationEvidenceFile] = useState<File | null>(null); const [exactCadEvidenceFile, setExactCadEvidenceFile] = useState<File | null>(null); const [manufacturingEvidenceFile, setManufacturingEvidenceFile] = useState<File | null>(null); const [releaseAuditBusy, setReleaseAuditBusy] = useState(false); const [releaseAuditReport, setReleaseAuditReport] = useState<RobotReleaseEvidenceAuditV2 | null>(null); const [finalAuditFile, setFinalAuditFile] = useState<File | null>(null); const [finalReviewFile, setFinalReviewFile] = useState<File | null>(null); const [finalReviewBusy, setFinalReviewBusy] = useState(false); const [finalDecision, setFinalDecision] = useState<RobotFinalReleaseDecision | null>(null);
  const [releaseWorkBusy, setReleaseWorkBusy] = useState(false); const [releaseWorkPacket, setReleaseWorkPacket] = useState<RobotReleaseWorkPacketV2 | null>(null);
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
    const finish = (message: string | null) => { window.removeEventListener(AI_ASSEMBLY_REVISION_RESULT_EVENT, onResult); setRevisionExportBusy(false); setRevisionExportMessage(message ?? (ko ? 'CAD 리비전 응답 시간 초과' : 'CAD revision response timed out')); };
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
      if (report.releaseReady !== false || report.cadIntegrationStatus !== 'not_run' || report.sideEffects.persisted !== false || report.sideEffects.catalogActivated !== false || report.sideEffects.cadModified !== false || report.sideEffects.quoteCreated !== false || report.sideEffects.rfqSent !== false) throw new Error('unsafe catalog selection response');
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
    setIntegrationBusy(true); setCatalogError(null); setIntegrationPacket(null);
    try {
      const packet = await prepareIntegration(revisionProgramFile, revisionManifestFile, housingFile, catalogRequirementsFile, catalogManifestFile, catalogArtifactFiles);
      if (packet.expertReviewRequired !== true || packet.cadIntegrationStatus !== 'not_applied' || packet.releaseReady !== false || packet.sideEffects.persisted !== false || packet.sideEffects.sourceModified !== false || packet.sideEffects.cadModified !== false || packet.sideEffects.quoteCreated !== false || packet.sideEffects.rfqSent !== false) throw new Error('unsafe CAD integration packet');
      setIntegrationPacket(packet);
    } catch (cause) { setCatalogError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setIntegrationBusy(false); }
  };
  const downloadIntegrationPacket = async () => {
    if (!integrationPacket) return; const bytes = new TextEncoder().encode(`${JSON.stringify(integrationPacket, null, 2)}\n`);
    await downloadBlob(`robot-cad-integration-review-${integrationPacket.targetHash}.json`, new Blob([bytes], { type: 'application/json' }));
  };
  const runIntegrationReview = async () => {
    if (!integrationPacketFile || !integrationReviewFile || integrationReviewBusy) return; setIntegrationReviewBusy(true); setCatalogError(null); setIntegrationReviewResult(null);
    try { const result = await validateIntegrationReview(integrationPacketFile, integrationReviewFile); if (result.cadApplied !== false || result.releaseReady !== false || result.nextStep !== 'create_new_cad_revision_then_reverify' || result.sideEffects.persisted !== false || result.sideEffects.cadModified !== false || result.sideEffects.quoteCreated !== false || result.sideEffects.rfqSent !== false) throw new Error('unsafe CAD integration review result'); setIntegrationReviewResult(result); }
    catch (cause) { setCatalogError(cause instanceof Error ? cause.message : String(cause)); } finally { setIntegrationReviewBusy(false); }
  };
  const downloadIntegrationReviewResult = async () => { if (!integrationReviewResult) return; const bytes = new TextEncoder().encode(`${JSON.stringify(integrationReviewResult, null, 2)}\n`); await downloadBlob(`robot-cad-integration-review-validation-${integrationReviewResult.targetHash}.json`, new Blob([bytes], { type: 'application/json' })); };
  const runIntegrationApplication = async () => {
    if (!integrationReviewResult?.approved || !revisionProgramFile || !revisionManifestFile || !integrationPacketFile || !integrationReviewFile || !housingFile || !catalogRequirementsFile || !catalogManifestFile || !catalogArtifactFiles.length || integrationApplyBusy) return; setIntegrationApplyBusy(true); setCatalogError(null); setIntegrationApplyMessage(null);
    try { const result = await applyIntegration(revisionProgramFile, revisionManifestFile, integrationPacketFile, integrationReviewFile, housingFile, catalogRequirementsFile, catalogManifestFile, catalogArtifactFiles); if (result.cadAppliedToWorkspace !== false || result.releaseReady !== false || result.targetHash !== integrationReviewResult.targetHash) throw new Error('unsafe or mismatched CAD integration bundle'); await downloadBlob(result.filename, result.bundle); setIntegrationApplyMessage(`r${result.revision} · ${result.programHash.slice(0, 12)}… · precise reverification required`); }
    catch (cause) { setCatalogError(cause instanceof Error ? cause.message : String(cause)); } finally { setIntegrationApplyBusy(false); }
  };
  const runPostIntegrationVerification = async () => { if (!revisionProgramFile || !revisionManifestFile || !reportFile || !integrationReceiptFile || !integrationPacketFile || !integrationReviewFile || !housingFile || !catalogRequirementsFile || !catalogManifestFile || !catalogArtifactFiles.length || postIntegrationBusy) return; setPostIntegrationBusy(true); setCatalogError(null); setPostIntegrationReport(null); try { const report = await postVerifyIntegration(revisionProgramFile, revisionManifestFile, reportFile, integrationReceiptFile, integrationPacketFile, integrationReviewFile, housingFile, catalogRequirementsFile, catalogManifestFile, catalogArtifactFiles); if (report.releaseReady !== false || report.sideEffects.persisted !== false || report.sideEffects.sourceModified !== false || report.sideEffects.workspaceModified !== false || report.sideEffects.quoteCreated !== false || report.sideEffects.rfqSent !== false) throw new Error('unsafe post-integration evidence response'); setPostIntegrationReport(report); } catch (cause) { setCatalogError(cause instanceof Error ? cause.message : String(cause)); } finally { setPostIntegrationBusy(false); } };
  const downloadPostIntegrationReport = async () => { if (!postIntegrationReport) return; const bytes = new TextEncoder().encode(`${JSON.stringify(postIntegrationReport, null, 2)}\n`); await downloadBlob(`robot-post-integration-${postIntegrationReport.targetHash}-${postIntegrationReport.programHash}.json`, new Blob([bytes], { type: 'application/json' })); };
  const runReleaseAudit = async () => { if (!postIntegrationEvidenceFile || releaseAuditBusy) return; setReleaseAuditBusy(true); setCatalogError(null); setReleaseAuditReport(null); try { const report = await auditReleaseEvidence(postIntegrationEvidenceFile, exactCadEvidenceFile, manufacturingEvidenceFile); if (report.externalCadRequired !== false || report.releaseReady !== false || report.sideEffects.persisted !== false || report.sideEffects.cadModified !== false || report.sideEffects.quoteCreated !== false || report.sideEffects.rfqSent !== false) throw new Error('unsafe release evidence audit'); setReleaseAuditReport(report); } catch (cause) { setCatalogError(cause instanceof Error ? cause.message : String(cause)); } finally { setReleaseAuditBusy(false); } };
  const downloadReleaseAudit = async () => { if (!releaseAuditReport) return; const bytes = new TextEncoder().encode(`${JSON.stringify(releaseAuditReport, null, 2)}\n`); await downloadBlob(`robot-release-audit-${releaseAuditReport.releaseTargetHash ?? releaseAuditReport.postIntegrationSha256}.json`, new Blob([bytes], { type: 'application/json' })); };
  const runFinalReleaseReview = async () => { if (!finalAuditFile || !finalReviewFile || finalReviewBusy) return; setFinalReviewBusy(true); setCatalogError(null); setFinalDecision(null); try { const decision = await validateFinalReleaseReview(finalAuditFile, finalReviewFile); if (decision.releaseExecuted !== false || decision.sideEffects.persisted !== false || decision.sideEffects.cadModified !== false || decision.sideEffects.releasePublished !== false || decision.sideEffects.quoteCreated !== false || decision.sideEffects.rfqSent !== false) throw new Error('unsafe final release decision'); setFinalDecision(decision); } catch (cause) { setCatalogError(cause instanceof Error ? cause.message : String(cause)); } finally { setFinalReviewBusy(false); } };
  const downloadFinalDecision = async () => { if (!finalDecision) return; const bytes = new TextEncoder().encode(`${JSON.stringify(finalDecision, null, 2)}\n`); await downloadBlob(`robot-final-release-decision-${finalDecision.targetHash ?? finalDecision.auditReportSha256}.json`, new Blob([bytes], { type: 'application/json' })); };
  const runReleaseWorkPacket = async () => { if (!postIntegrationEvidenceFile || releaseWorkBusy) return; setReleaseWorkBusy(true); setCatalogError(null); setReleaseWorkPacket(null); try { const packet = await buildReleaseWorkPacket(postIntegrationEvidenceFile); if (packet.externalCadRequired !== false || packet.sourceBytesEmbedded !== false || packet.privateKeysEmbedded !== false || packet.releaseReady !== false || packet.finalReviewTask.releaseExecutionIncluded !== false) throw new Error('unsafe release work packet'); setReleaseWorkPacket(packet); } catch (cause) { setCatalogError(cause instanceof Error ? cause.message : String(cause)); } finally { setReleaseWorkBusy(false); } };
  const downloadReleaseWorkPacket = async () => { if (!releaseWorkPacket) return; const bytes = new TextEncoder().encode(`${JSON.stringify(releaseWorkPacket, null, 2)}\n`); await downloadBlob(`robot-release-work-${releaseWorkPacket.packetHash}.json`, new Blob([bytes], { type: 'application/json' })); };

  return <section data-testid="robot-precision-handoff" style={{ padding: 9, border: '1px solid var(--nx-border)', borderRadius: 7, background: 'var(--nx-panel-2)' }}>
    <div style={{ fontWeight: 750 }}>{ko ? 'AI 6축 로봇 제품 구현 → 필요 시 정밀 CAD' : 'AI 6-axis product build → precision CAD when required'}</div>
    <div style={{ margin: '3px 0 8px', fontSize: 10.5, color: 'var(--nx-text-3)' }}>
      {ko ? 'AI가 부품·조립·동작·제조 증거까지 완성 파이프라인을 진행합니다. 정확 형상이나 공차 증거가 필요한 범위만 정밀 CAD로 전환하며, 생산 승인은 별도입니다.' : 'AI advances parts, assembly, motion and manufacturing evidence toward a complete product. Only governed exact-geometry or tolerance gaps enter precision CAD; production approval remains separate.'}
    </div>
    <button type="button" data-testid="robot-generate" onClick={run} disabled={busy} style={{ width: '100%', padding: 7, borderRadius: 5, border: 0, background: '#2563eb', color: '#fff', fontWeight: 700 }}>
      {busy ? (ko ? '제품 구현·검증 중…' : 'Building and verifying product…') : (ko ? 'AI로 복잡 제품 구현 시작' : 'Build complex product with AI')}
    </button>
    {error && <div role="alert" style={{ marginTop: 6, color: '#b91c1c' }}>{error}</div>}
    {result && <div style={{ display: 'grid', gap: 5, marginTop: 8 }}>
      <Gate testId="robot-gate-geometry" label={ko ? '편집 가능 형상' : 'Editable geometry'} state={result.program ? 'passed' : 'failed'} detail={result.program ? `${result.program.parts.length} parts / ${result.program.assembly.mates.length} mates` : (ko ? '프로그램 없음' : 'No program')} />
      <Gate testId="robot-gate-requirements" label={ko ? '선정 요구조건' : 'Selection requirements'} state={requirementsPassed ? 'passed' : 'failed'} detail={requirementsPassed ? (ko ? '6축 하중·속도·축경 요구조건 준비' : 'Six-joint load, speed and shaft requirements ready') : (result.selectionRequirements?.errors?.join(' · ') ?? 'not available')} />
      <Gate testId="robot-gate-catalog" label={ko ? '부품 카탈로그 증거' : 'Component catalog evidence'} state={catalogPassed ? 'passed' : 'blocked'} detail={catalogPassed ? 'production eligible' : `${result.catalogEvidence?.status ?? 'not_supplied'} · preview-only · offline manifest required`} />
      <Gate testId="robot-gate-housing" label={ko ? '하우징 적합성' : 'Housing fit'} state={result.housingFit?.status ?? 'not_run'} detail={result.housingFit?.reason ?? (ko ? '추적 가능한 실제 부품 선정 후 실행' : 'Runs after traceable real-component selection')} />
      <Gate testId="robot-gate-interference" label={ko ? '정밀 간섭·동작' : 'Precise interference and motion'} state={collisionCount === 0 ? 'not_run' : collisionCount ? 'failed' : 'not_run'} detail={collisionCount ? `${collisionCount} sampled self-collision(s); precise B-rep motion verification required` : 'precise B-rep motion verification required'} />
      <Gate testId="robot-gate-release" label={ko ? '생산 릴리스' : 'Production release'} state={result.releaseReady ? 'passed' : 'blocked'} detail={(result.releaseBlockers ?? []).join(' · ') || (ko ? '릴리스 증거 미완료' : 'Release evidence incomplete')} />
      <button type="button" data-testid="robot-handoff" disabled={!result.program} onClick={() => result.program && onHandoff(result.program)} style={{ width: '100%', padding: 7, borderRadius: 5, border: '1px solid var(--nx-border)', fontWeight: 700 }}>
        {ko ? '정밀 CAD에서 편집 계속' : 'Continue editing in precision CAD'}
      </button>
      <div style={{ fontSize: 10, color: '#92400e' }}>{ko ? '이 인계는 편집 시작이며 승인·서명·견적 요청을 수행하지 않습니다.' : 'This handoff starts editing; it does not approve, sign, or request a quote.'}</div>
    </div>}
    <details style={{ marginTop: 8 }}>
      <summary style={{ cursor: 'pointer', fontWeight: 700 }}>{ko ? '생산 부품 카탈로그 증거 검사' : 'Validate production component catalog evidence'}</summary>
      <div style={{ marginTop: 6, display: 'grid', gap: 5 }}>
        <label>{ko ? 'catalog manifest JSON' : 'Catalog manifest JSON'}<input data-testid="robot-catalog-manifest" type="file" accept="application/json,.json" onChange={event => setCatalogManifestFile(event.target.files?.[0] ?? null)} /></label>
        <label>{ko ? 'manifest에 선언된 실제 artifact 파일' : 'Exact artifact files declared by manifest'}<input data-testid="robot-catalog-artifacts" type="file" multiple onChange={event => setCatalogArtifactFiles(Array.from(event.target.files ?? []))} /></label>
        <button type="button" data-testid="robot-catalog-admit" disabled={!catalogManifestFile || !catalogArtifactFiles.length || catalogBusy} onClick={runCatalogAdmission}>{catalogBusy ? (ko ? '바이트·SHA-256 검사 중…' : 'Checking bytes and SHA-256…') : (ko ? '저장 없이 생산 적격성 검사' : 'Check production eligibility without storage')}</button>
        {catalogError && <div data-testid="robot-catalog-error" role="alert" style={{ color: '#b91c1c' }}>{catalogError}</div>}
        {catalogReport && <div data-testid="robot-catalog-report" style={{ padding: 6, border: '1px solid var(--nx-border)', borderRadius: 5, color: catalogReport.productionEligible ? '#166534' : '#b91c1c' }}>
          <b>{catalogReport.productionEligible ? (ko ? '바이트 검증 통과' : 'Byte validation passed') : (ko ? '생산 카탈로그 부적격' : 'Production catalog rejected')}</b> · {catalogReport.componentCount} components · {catalogReport.artifactCount} artifacts · {catalogReport.totalArtifactBytes} bytes
          {catalogReport.artifacts.map(item => <div key={item.name}>{item.verified ? '✓' : '✗'} {item.name} · {item.actualSha256 ? `${item.actualSha256.slice(0, 12)}…` : 'missing'}</div>)}
          {catalogReport.errors.map((message, index) => <div key={`${index}-${message}`}>{message}</div>)}
          <div>manifest {catalogReport.manifestSha256.slice(0, 12)}… · artifact set {catalogReport.artifactSetSha256.slice(0, 12)}…</div>
          <div style={{ color: '#92400e' }}>{ko ? '6축 요구조건에 대한 실제 부품 선정은 아직 실행되지 않았습니다.' : 'Actual component selection against six-axis requirements has not run.'}</div>
          <button type="button" data-testid="robot-catalog-report-download" onClick={downloadCatalogReport}>{ko ? '해시 결합 검증 보고서 다운로드' : 'Download hash-bound validation report'}</button>
          <div style={{ color: '#92400e' }}>{ko ? '검사 결과는 카탈로그를 활성화하거나 견적·RFQ를 만들지 않습니다.' : 'Validation does not activate the catalog or create a quote/RFQ.'}</div>
        </div>}
        <label>{ko ? 'J1~J6 선정 요구조건 JSON' : 'J1–J6 selection requirements JSON'}<input data-testid="robot-catalog-requirements" type="file" accept="application/json,.json" onChange={event => setCatalogRequirementsFile(event.target.files?.[0] ?? null)} /></label>
        <button type="button" data-testid="robot-catalog-select" disabled={!catalogRequirementsFile || !catalogManifestFile || !catalogArtifactFiles.length || selectionBusy} onClick={runCatalogSelection}>{selectionBusy ? (ko ? '6축 선정·마진 계산 중…' : 'Selecting and calculating margins…') : (ko ? '6축 부품 선정 시뮬레이션' : 'Simulate six-axis component selection')}</button>
        {selectionReport && <div data-testid="robot-catalog-selection-report" style={{ padding: 6, border: '1px solid var(--nx-border)', borderRadius: 5, color: selectionReport.selectionReady ? '#166534' : '#b91c1c' }}>
          <b>{selectionReport.selectionReady ? (ko ? '6축 선정 통과' : 'Six-axis selection passed') : (ko ? '선정 실패' : 'Selection failed')}</b> · CAD integration {selectionReport.cadIntegrationStatus} · release {String(selectionReport.releaseReady)}
          {selectionReport.selections.map(item => <div key={item.joint}>J{item.joint}: {item.motor.model} + {item.reducer.model} + {item.bearing.model} · torque {item.margins.torque.toFixed(2)}× · speed {item.margins.speed.toFixed(2)}× · bearing {item.margins.bearingLoad.toFixed(2)}×</div>)}
          {selectionReport.errors.map((message, index) => <div key={`${index}-${message}`}>{message}</div>)}
          <button type="button" data-testid="robot-catalog-selection-download" onClick={downloadSelectionReport}>{ko ? '선정 증거 보고서 다운로드' : 'Download selection evidence report'}</button>
          <div style={{ color: '#92400e' }}>{ko ? '선정 통과는 CAD 반영·하우징 적합성·릴리스를 수행하지 않습니다.' : 'Selection does not apply CAD changes, prove housing fit, or release production.'}</div>
        </div>}
        <label>{ko ? 'J1~J6 하우징 내부 치수·여유·증거 JSON' : 'J1–J6 housing dimensions, clearances and evidence JSON'}<input data-testid="robot-housing-capacities" type="file" accept="application/json,.json" onChange={event => setHousingFile(event.target.files?.[0] ?? null)} /></label>
        <button type="button" data-testid="robot-housing-fit" disabled={!housingFile || !catalogRequirementsFile || !catalogManifestFile || !catalogArtifactFiles.length || housingBusy} onClick={runHousingFit}>{housingBusy ? (ko ? '6축 하우징 여유 검증 중…' : 'Checking six-axis housing clearances…') : (ko ? '저장·CAD 수정 없이 하우징 적합성 검사' : 'Check housing fit without storage or CAD changes')}</button>
        {housingReport && <div data-testid="robot-housing-fit-report" style={{ padding: 6, border: '1px solid var(--nx-border)', borderRadius: 5, color: housingReport.housingStatus === 'passed' ? '#166534' : '#b91c1c' }}>
          <b>{ko ? '하우징 적합성' : 'Housing fit'}: {housingReport.housingStatus}</b> · CAD integration {housingReport.cadIntegrationStatus} · release {String(housingReport.releaseReady)}
          {housingReport.fits.map(item => <div key={item.joint}>J{item.joint}: {item.status} · required {item.requiredInternalMm ? `${item.requiredInternalMm.x}×${item.requiredInternalMm.y}×${item.requiredInternalMm.z} mm` : 'n/a'} · available {item.availableInternalMm ? `${item.availableInternalMm.x}×${item.availableInternalMm.y}×${item.availableInternalMm.z} mm` : 'n/a'}</div>)}
          {housingReport.errors.map((message, index) => <div key={`${index}-${message}`}>{message}</div>)}
          <button type="button" data-testid="robot-housing-fit-download" onClick={downloadHousingReport}>{ko ? '해시 결합 하우징 보고서 다운로드' : 'Download hash-bound housing report'}</button>
          <div style={{ color: '#92400e' }}>{ko ? '통과해도 CAD 형상을 수정하거나 생산 릴리스를 승인하지 않습니다.' : 'Passing does not modify CAD geometry or approve production release.'}</div>
        </div>}
        <button type="button" data-testid="robot-integration-prepare" disabled={!revisionProgramFile || !revisionManifestFile || !housingFile || !catalogRequirementsFile || !catalogManifestFile || !catalogArtifactFiles.length || integrationBusy} onClick={runIntegrationPreparation}>{integrationBusy ? (ko ? '통합 target hash 구성 중…' : 'Building integration target hash…') : (ko ? '전문가 CAD 통합 검토 패키지 준비' : 'Prepare expert CAD integration review packet')}</button>
        {integrationPacket && <div data-testid="robot-integration-packet" style={{ padding: 6, border: '1px solid var(--nx-border)', borderRadius: 5, color: integrationPacket.readiness === 'review_pending' ? '#92400e' : '#b91c1c' }}>
          <b>{integrationPacket.readiness}</b> · target {integrationPacket.targetHash.slice(0, 12)}… · CAD {integrationPacket.cadIntegrationStatus} · release {String(integrationPacket.releaseReady)}
          {integrationPacket.replacements.map(item => <div key={item.joint}>J{item.joint}: {item.placeholders.motor} / {item.placeholders.reducer} / {item.placeholders.bearing} → {item.selected.motor} / {item.selected.reducer} / {item.selected.bearing}</div>)}
          {integrationPacket.errors.map((message, index) => <div key={`${index}-${message}`}>{message}</div>)}
          <button type="button" data-testid="robot-integration-download" onClick={downloadIntegrationPacket}>{ko ? '불변 전문가 검토 패키지 다운로드' : 'Download immutable expert review packet'}</button>
          <div>{ko ? '전문가 검토가 필수이며, 이 패키지는 CAD를 적용하거나 생산을 승인하지 않습니다.' : 'Expert review is required; this packet neither applies CAD nor approves production.'}</div>
        </div>}
        <label>{ko ? '다운로드한 통합 검토 패키지 JSON' : 'Downloaded integration review packet JSON'}<input data-testid="robot-integration-packet-file" type="file" accept="application/json,.json" onChange={event => setIntegrationPacketFile(event.target.files?.[0] ?? null)} /></label>
        <label>{ko ? '오프라인 Ed25519 이중 서명 검토 JSON' : 'Offline Ed25519 dual-signoff review JSON'}<input data-testid="robot-integration-review-file" type="file" accept="application/json,.json" onChange={event => setIntegrationReviewFile(event.target.files?.[0] ?? null)} /></label>
        <button type="button" data-testid="robot-integration-review" disabled={!integrationPacketFile || !integrationReviewFile || integrationReviewBusy} onClick={runIntegrationReview}>{integrationReviewBusy ? (ko ? '서명 검증 중…' : 'Verifying signatures…') : (ko ? '서버 신뢰 키로 이중 서명 검증' : 'Verify dual signatures against server trust registry')}</button>
        {integrationReviewResult && <div data-testid="robot-integration-review-result" style={{ padding: 6, border: '1px solid var(--nx-border)', borderRadius: 5, color: integrationReviewResult.approved ? '#166534' : '#b91c1c' }}>
          <b>{integrationReviewResult.approved ? (ko ? '통합 작업 승인됨' : 'Integration work authorized') : (ko ? '검토 승인 안 됨' : 'Review not approved')}</b> · CAD applied {String(integrationReviewResult.cadApplied)} · release {String(integrationReviewResult.releaseReady)}
          {integrationReviewResult.errors.map((message, index) => <div key={`${index}-${message}`}>{message}</div>)}
          <div>{ko ? '다음 단계: 새 CAD 리비전 생성 후 전체 정밀 재검증' : 'Next: create a new CAD revision, then run full precise reverification.'}</div>
          <button type="button" data-testid="robot-integration-review-download" onClick={downloadIntegrationReviewResult}>{ko ? '서명 검증 결과 다운로드' : 'Download signature validation result'}</button>
        </div>}
        <button type="button" data-testid="robot-integration-apply-revision" disabled={!integrationReviewResult?.approved || !revisionProgramFile || !revisionManifestFile || !integrationPacketFile || !integrationReviewFile || !housingFile || !catalogRequirementsFile || !catalogManifestFile || !catalogArtifactFiles.length || integrationApplyBusy} onClick={runIntegrationApplication}>{integrationApplyBusy ? (ko ? '새 CAD 리비전 구성 중…' : 'Building new CAD revision…') : (ko ? '승인 target으로 새 CAD 리비전 ZIP 생성' : 'Build new CAD revision ZIP from approved target')}</button>
        {integrationApplyMessage && <div data-testid="robot-integration-apply-message">{integrationApplyMessage}</div>}
        <label>{ko ? 'ZIP의 integration application 영수증 JSON' : 'Integration application receipt JSON from ZIP'}<input data-testid="robot-integration-receipt" type="file" accept="application/json,.json" onChange={event => setIntegrationReceiptFile(event.target.files?.[0] ?? null)} /></label>
        <button type="button" data-testid="robot-post-integration-verify" disabled={!revisionProgramFile || !revisionManifestFile || !reportFile || !integrationReceiptFile || !integrationPacketFile || !integrationReviewFile || !housingFile || !catalogRequirementsFile || !catalogManifestFile || !catalogArtifactFiles.length || postIntegrationBusy} onClick={runPostIntegrationVerification}>{postIntegrationBusy ? (ko ? '사후 통합 증거 교차검증 중…' : 'Cross-checking post-integration evidence…') : (ko ? 'r+1 정밀·카탈로그·하우징 사후 통합 검증' : 'Post-verify r+1 precision, catalog and housing evidence')}</button>
        {postIntegrationReport && <div data-testid="robot-post-integration-report" style={{ padding: 6, border: '1px solid var(--nx-border)', borderRadius: 5, color: postIntegrationReport.postIntegrationStatus === 'passed' ? '#166534' : '#b91c1c' }}>
          <b>{ko ? '사후 통합' : 'Post-integration'}: {postIntegrationReport.postIntegrationStatus}</b> · precision {postIntegrationReport.precisionStatus} · release {String(postIntegrationReport.releaseReady)}
          <div>{postIntegrationReport.counts.selectedOccurrences}/18 occurrences · motion {postIntegrationReport.counts.checkedMotionFrames}/{postIntegrationReport.counts.motionFrames} · collisions {postIntegrationReport.counts.collisionFrames} · interferences {postIntegrationReport.counts.preciseInterferences}</div>
          {postIntegrationReport.errors.map((message, index) => <div key={`${index}-${message}`}>{message}</div>)}
          <div>{ko ? '남은 릴리스 차단' : 'Remaining release blockers'}: {postIntegrationReport.blockers.join(' · ')}</div>
          <button type="button" data-testid="robot-post-integration-download" onClick={downloadPostIntegrationReport}>{ko ? '사후 통합 증거 보고서 다운로드' : 'Download post-integration evidence report'}</button>
        </div>}
        <label>{ko ? '다운로드한 사후 통합 증거 JSON' : 'Downloaded post-integration evidence JSON'}<input data-testid="robot-release-post-evidence" type="file" accept="application/json,.json" onChange={event => setPostIntegrationEvidenceFile(event.target.files?.[0] ?? null)} /></label>
        <button type="button" data-testid="robot-release-work-packet" disabled={!postIntegrationEvidenceFile || releaseWorkBusy} onClick={runReleaseWorkPacket}>{releaseWorkBusy ? (ko ? '내부 작업 패킷 구성 중…' : 'Building internal work packet…') : (ko ? 'NexyFab 정밀 CAD·제조 작업 패킷 만들기' : 'Build NexyFab exact-CAD and manufacturing work packet')}</button>
        {releaseWorkPacket && <div data-testid="robot-release-work-report"><b>{ko ? '자체 정밀 CAD 증거 프리플라이트' : 'NexyFab exact-CAD evidence preflight'}</b> · exact CAD keys {releaseWorkPacket.registryPreflight.exactCadSignerKeys} · manufacturing keys {releaseWorkPacket.registryPreflight.manufacturingReviewerKeys} · final pair {String(releaseWorkPacket.registryPreflight.finalReview.distinctPairAvailable)}<div>program {releaseWorkPacket.programHash.slice(0, 12)}… · external CAD false · source bytes false · private keys false · release false</div><button type="button" data-testid="robot-release-work-download" onClick={downloadReleaseWorkPacket}>{ko ? '해시 결합 작업 패킷 다운로드' : 'Download hash-bound work packet'}</button></div>}
        <label>{ko ? '서명된 NexyFab 정밀 CAD 증거 JSON (없어도 부족분 감사 가능)' : 'Signed NexyFab exact-CAD evidence JSON (optional for gap audit)'}<input data-testid="robot-release-exact-cad-evidence" type="file" accept="application/json,.json" onChange={event => setExactCadEvidenceFile(event.target.files?.[0] ?? null)} /></label>
        <label>{ko ? '서명된 제조 검증 JSON (없어도 부족분 감사 가능)' : 'Signed manufacturing validation JSON (optional for gap audit)'}<input data-testid="robot-release-manufacturing-evidence" type="file" accept="application/json,.json" onChange={event => setManufacturingEvidenceFile(event.target.files?.[0] ?? null)} /></label>
        <button type="button" data-testid="robot-release-audit" disabled={!postIntegrationEvidenceFile || releaseAuditBusy} onClick={runReleaseAudit}>{releaseAuditBusy ? (ko ? '자체 증거 감사 중…' : 'Auditing NexyFab evidence…') : (ko ? '정밀 CAD·제조 릴리스 증거 감사' : 'Audit exact-CAD and manufacturing release evidence')}</button>
        {releaseAuditReport && <div data-testid="robot-release-audit-report"><b>{releaseAuditReport.status}</b> · exact CAD {String(releaseAuditReport.exactCadEvidenceValid)} · manufacturing {String(releaseAuditReport.manufacturingEvidenceValid)} · external CAD false · release false<div>{releaseAuditReport.blockers.join(' · ')}</div>{releaseAuditReport.errors.map((message, index) => <div key={`${index}-${message}`}>{message}</div>)}<button type="button" data-testid="robot-release-audit-download" onClick={downloadReleaseAudit}>{ko ? '릴리스 감사 보고서 다운로드' : 'Download release audit report'}</button></div>}
        <label>{ko ? 'ready_for_final_review 감사 보고서 JSON' : 'ready_for_final_review audit JSON'}<input data-testid="robot-final-audit-file" type="file" accept="application/json,.json" onChange={event => setFinalAuditFile(event.target.files?.[0] ?? null)} /></label>
        <label>{ko ? '최종 오프라인 이중 서명 JSON' : 'Final offline dual-signoff JSON'}<input data-testid="robot-final-review-file" type="file" accept="application/json,.json" onChange={event => setFinalReviewFile(event.target.files?.[0] ?? null)} /></label>
        <button type="button" data-testid="robot-final-review" disabled={!finalAuditFile || !finalReviewFile || finalReviewBusy} onClick={runFinalReleaseReview}>{finalReviewBusy ? (ko ? '최종 서명 검증 중…' : 'Verifying final signatures…') : (ko ? '최종 릴리스 자격 검증' : 'Verify final release eligibility')}</button>
        {finalDecision && <div data-testid="robot-final-decision"><b>{finalDecision.approved ? (ko ? '릴리스 자격 승인' : 'Release eligible') : (ko ? '릴리스 자격 없음' : 'Not release eligible')}</b> · ready {String(finalDecision.releaseReady)} · executed {String(finalDecision.releaseExecuted)}<div>{finalDecision.errors.join(' · ')}</div><button type="button" data-testid="robot-final-decision-download" onClick={downloadFinalDecision}>{ko ? '최종 결정 다운로드' : 'Download final decision'}</button><div>{ko ? '이 화면은 실제 릴리스 게시를 실행하지 않습니다.' : 'This screen does not execute or publish a release.'}</div></div>}
      </div>
    </details>
    <details style={{ marginTop: 8 }}>
      <summary style={{ cursor: 'pointer', fontWeight: 700 }}>{ko ? '검증 증거 묶음 대조' : 'Cross-check evidence bundle'}</summary>
      <div style={{ marginTop: 6, display: 'grid', gap: 5 }}>
        <label style={{ fontSize: 10.5 }}>{ko ? 'report.json' : 'report.json'}<input data-testid="robot-evidence-report" type="file" accept="application/json,.json" onChange={event => setReportFile(event.target.files?.[0] ?? null)} /></label>
        <label style={{ fontSize: 10.5 }}>{ko ? '편집 프로그램 JSON' : 'Editable program JSON'}<input data-testid="robot-evidence-program" type="file" accept="application/json,.json" onChange={event => setProgramFile(event.target.files?.[0] ?? null)} /></label>
        <button type="button" data-testid="robot-evidence-verify" disabled={!reportFile || !programFile} onClick={loadEvidence}>{baselineEvidence ? (ko ? '새 수정본 재검증·비교' : 'Reverify and compare revision') : (ko ? 'SHA-256 연결 및 기준선 설정' : 'Verify SHA-256 binding and set baseline')}</button>
        <div style={{ display: 'grid', gap: 4, padding: 6, border: '1px solid var(--nx-border)', borderRadius: 5 }}>
          <b>{ko ? '수정 리비전 서버 재검증' : 'Server-reverify edited revision'}</b>
          <label>{ko ? '리비전 프로그램 JSON' : 'Revision program JSON'}<input data-testid="robot-revision-program" type="file" accept="application/json,.json" onChange={event => setRevisionProgramFile(event.target.files?.[0] ?? null)} /></label>
          <label>{ko ? '리비전 manifest JSON' : 'Revision manifest JSON'}<input data-testid="robot-revision-manifest" type="file" accept="application/json,.json" onChange={event => setRevisionManifestFile(event.target.files?.[0] ?? null)} /></label>
          <button type="button" data-testid="robot-revision-reverify" disabled={!revisionProgramFile || !revisionManifestFile || revisionVerifyBusy} onClick={runRevisionReverification}>{revisionVerifyBusy ? (ko ? '정밀 재검증 중…' : 'Precisely reverifying…') : (ko ? '서버 재검증 후 report.json 다운로드' : 'Server-reverify and download report.json')}</button>
          <span style={{ color: '#92400e' }}>{ko ? '업로드 파일은 저장하지 않으며, 이 단계는 릴리스·견적·RFQ를 만들지 않습니다.' : 'Uploads are not persisted; this does not release, quote, or send an RFQ.'}</span>
        </div>
        {evidenceError && <div data-testid="robot-evidence-error" role="alert" style={{ color: '#b91c1c' }}>{evidenceError}</div>}
        {evidence && <div data-testid="robot-evidence-summary" style={{ display: 'grid', gap: 3, padding: 6, border: '1px solid var(--nx-border)', borderRadius: 5, fontSize: 10.5 }}>
          <div><b>{ko ? '무결성' : 'Integrity'}:</b> linked · report {evidence.reportHash.slice(0, 12)}… · program {evidence.programHash.slice(0, 12)}…</div>
          {baselineEvidence && <div><b>{ko ? '설계 계보·기준선' : 'Design lineage · baseline'}:</b> {baselineEvidence.lineageId} · r{baselineEvidence.revision} · {baselineEvidence.programHash.slice(0, 12)}…</div>}
          {baselineEvidence && <button type="button" data-testid="robot-export-edited-revision" disabled={revisionExportBusy} onClick={exportEditedRevision}>{revisionExportBusy ? (ko ? '새 리비전 구성 중…' : 'Building revision…') : (ko ? `현재 CAD를 r${baselineEvidence.revision + 1} 재검증 패키지로 내보내기` : `Export current CAD as r${baselineEvidence.revision + 1} reverification package`)}</button>}
          {revisionExportMessage && <div data-testid="robot-revision-export-message">{revisionExportMessage}</div>}
          <div><b>CAD:</b> {evidence.editableParts} parts · {evidence.mates} mates · DoF {evidence.rankDoF ?? '?'} / {evidence.allowedDoF ?? '?'}</div>
          <div><b>{ko ? '정적 정밀 간섭' : 'Static precise interference'}:</b> {evidence.flaggedInterferences}</div>
          <div><b>{ko ? '동작 재검증' : 'Motion reverification'}:</b> {evidence.motionConverged ? 'converged' : 'incomplete'} · {evidence.checkedMotionFrames ?? 0}/{evidence.motionFrames} checked · {evidence.collisionFrames} collision frames</div>
          {evidence.motionAxes && <div data-testid="robot-motion-axes" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 3 }}>
            {evidence.motionAxes.map(axis => <span key={axis.mateId} style={{ padding: 3, border: '1px solid var(--nx-border)', color: axis.allConverged && axis.checkedFrames === axis.frameCount && axis.collisionFrameCount === 0 ? '#166534' : '#b91c1c' }}>
              {axis.mateId} {axis.rangeDeg[0]}°..{axis.rangeDeg[1]}° · {axis.checkedFrames}/{axis.frameCount} · {axis.collisionFrameCount} hit
              {axis.segments.map(segment => <small key={segment.direction} style={{ display: 'block' }}>{segment.direction === 'toward-min' ? 'min' : 'max'}: {segment.allConverged ? 'ok' : `fail@${segment.firstFailureFrame ?? '?'}`} · {segment.collisionFrameCount ? `hit@${segment.firstCollisionFrame ?? '?'} / ${segment.maxPenetrationMm ?? '?'}mm` : 'clear'}</small>)}
            </span>)}
          </div>}
          <div><b>{ko ? '카탈로그·하우징' : 'Catalog · housing'}:</b> {evidence.catalogStatus} · {evidence.housingStatus}</div>
          <div style={{ color: evidence.effectiveReleaseReady ? '#166534' : '#b91c1c' }}><b>{ko ? '유효 릴리스' : 'Effective release'}:</b> {String(evidence.effectiveReleaseReady)} · {evidence.blockers.length} blocker(s)</div>
          <div style={{ color: '#92400e' }}>{ko ? 'SHA 연결은 파일 무결성만 증명하며 출처·전문가 승인을 대신하지 않습니다.' : 'SHA binding proves file integrity only; it does not replace provenance or expert approval.'}</div>
          {evidence.interferenceQueue.length > 0 && <div data-testid="robot-interference-queue" style={{ maxHeight: 190, overflow: 'auto', borderTop: '1px solid var(--nx-border)', paddingTop: 4 }}>
            <b>{ko ? '전문가 간섭 수정 큐' : 'Expert interference remediation queue'} ({evidence.interferenceQueue.length})</b>
            {evidence.interferenceQueue.map(item => <div key={item.id} data-testid={`robot-interference-${item.id}`} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 5, padding: '4px 0', borderBottom: '1px solid var(--nx-border)' }}>
              <div><span style={{ color: item.priority === 'critical' ? '#b91c1c' : item.priority === 'high' ? '#b45309' : 'var(--nx-text-2)', fontWeight: 700 }}>{item.priority}</span> · {item.category}<br />{item.partA} ↔ {item.partB} · {item.penetrationMm ?? '?'} mm<br /><span style={{ color: 'var(--nx-text-3)' }}>{item.recommendedAction}</span></div>
              <button type="button" data-testid={`robot-focus-${item.id}`} onClick={() => focusQueueItem(item.id, [item.partA, item.partB])}>{ko ? 'CAD 선택' : 'Select in CAD'}</button>
            </div>)}
          </div>}
          {focusResult && <div data-testid="robot-focus-result" style={{ color: focusResult.missingPartIds.length ? '#b91c1c' : '#166534' }}>{focusResult.selectedPartIds.length} selected · {focusResult.missingPartIds.length} missing</div>}
          {transitions && <div data-testid="robot-remediation-transitions" style={{ borderTop: '1px solid var(--nx-border)', paddingTop: 4 }}>
            <b>{ko ? '정밀 재검증 상태 전이' : 'Precise reverification transitions'}</b>
            {(['regressed_reverified', 'new_interference', 'unchanged_reverified', 'improved_reverified', 'resolved_reverified'] as const).map(status => {
              const count = transitions.filter(item => item.status === status).length;
              return count ? <div key={status}>{status}: {count}</div> : null;
            })}
            <div style={{ color: '#92400e' }}>{ko ? '해결 상태는 새 프로그램 해시와 새 정밀 검증 보고서가 모두 확인된 경우에만 계산됩니다.' : 'Resolved status is computed only from a new program hash and a new precise-verification report.'}</div>
            <button type="button" data-testid="robot-remediation-promote-baseline" onClick={() => { setBaselineEvidence(evidence); setTransitions(null); }}>{ko ? '이 재검증본을 다음 기준선으로 사용' : 'Use this verified revision as next baseline'}</button>
          </div>}
        </div>}
      </div>
    </details>
  </section>;
}
