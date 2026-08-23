'use client';

import { useState } from 'react';
import { downloadBlob } from '@/lib/platform';
import { createCommercialLocalizer } from '@/lib/i18n/commercialLocalizer';

type StageId = 'engineering' | 'motion' | 'cable' | 'safety' | 'physical' | 'audit';
type StageReport = {
  schema: string;
  status: string;
  errors: string[];
  releaseReady: boolean;
  releaseExecuted?: boolean;
  sideEffects: Record<string, boolean>;
  coverageReady?: boolean;
  motionCoverageReady?: boolean;
  cableLifeReady?: boolean;
  designSupportReady?: boolean;
  physicalValidationReady?: boolean;
  releaseTargetHash?: string | null;
  coverageHash?: string;
  auditIssuerId?: string | null;
  signature?: string | null;
};
type VerifyStage = (stage: StageId, files: Record<string, File>, artifacts: File[]) => Promise<StageReport>;
type StageDefinition = { id: StageId; endpoint: string; title: string; titleKo: string; inputs: string[]; artifacts?: boolean; artifactField?: string };

const STAGES: StageDefinition[] = [
  { id: 'engineering', endpoint: '/api/cad/v1/robot/engineering/coverage', title: 'All payload × path engineering coverage', titleKo: '전체 페이로드 × 경로 엔지니어링 커버리지', inputs: ['requirements', 'manifest'], artifacts: true },
  { id: 'motion', endpoint: '/api/cad/v1/robot/motion/coverage', title: 'Adaptive continuous-motion coverage', titleKo: '적응형 연속 동작 커버리지', inputs: ['requirements', 'motionInput'], artifacts: true, artifactField: 'sweptEvidence' },
  { id: 'cable', endpoint: '/api/cad/v1/robot/cable/life', title: 'Cable routing and life sweep', titleKo: '케이블 라우팅·수명 스윕', inputs: ['requirements', 'motionReport', 'cableInput'] },
  { id: 'safety', endpoint: '/api/cad/v1/robot/safety/electrical', title: 'Safety and electrical design evidence', titleKo: '안전·전기 설계 증거', inputs: ['requirements', 'safetyElectricalInput'] },
  { id: 'physical', endpoint: '/api/cad/v1/robot/physical/verify', title: 'Signed physical validation receipt', titleKo: '서명된 물리 실증 영수증', inputs: ['engineeringCoverage', 'motionCoverage', 'cableLife', 'safetyElectrical', 'receipt'], artifacts: true },
  { id: 'audit', endpoint: '/api/cad/v1/robot/release/verified-audit', title: 'Server-attested Verified Systems audit', titleKo: '서버 서명 Verified Systems 감사', inputs: ['postIntegration', 'exactCadEvidence', 'manufacturingEvidence', 'engineeringCoverage', 'motionCoverage', 'cableLife', 'safetyElectrical', 'physicalReceipt', 'systemBinding'], artifacts: true },
];

const defaultVerify: VerifyStage = async (stage, files, artifacts) => {
  const definition = STAGES.find(item => item.id === stage)!;
  const form = new FormData();
  for (const key of definition.inputs) form.set(key, files[key]!);
  for (const artifact of artifacts) form.append(definition.artifactField ?? 'artifact', artifact);
  const response = await fetch(definition.endpoint, { method: 'POST', body: form });
  const body = await response.json() as { report?: StageReport; message?: string };
  if (!body.report) throw new Error(body.message ?? `${definition.title} failed (${response.status})`);
  return body.report;
};

function stagePassed(stage: StageId, report: StageReport) {
  if (stage === 'audit') return report.status === 'ready_for_final_review';
  return Boolean(report.coverageReady ?? report.motionCoverageReady ?? report.cableLifeReady ?? report.designSupportReady ?? report.physicalValidationReady);
}

function validateReport(stage: StageId, report: StageReport) {
  const passed = stagePassed(stage, report);
  if (report.releaseReady !== false || report.releaseExecuted === true || !Array.isArray(report.errors) || !report.sideEffects || Object.values(report.sideEffects).some(value => value !== false)) return false;
  if (passed && (report.errors.length !== 0 || (stage !== 'audit' && report.status !== 'passed'))) return false;
  if (stage === 'audit' && passed && (!report.auditIssuerId || !report.signature || !/^[a-f0-9]{64}$/.test(report.releaseTargetHash ?? ''))) return false;
  return true;
}

export default function RobotVerifiedSystemsPanel({ lang, verify = defaultVerify }: { lang: string; verify?: VerifyStage }) {
  const L = createCommercialLocalizer(lang);
  const [files, setFiles] = useState<Partial<Record<StageId, Record<string, File>>>>({});
  const [artifacts, setArtifacts] = useState<Partial<Record<StageId, File[]>>>({});
  const [busy, setBusy] = useState<StageId | null>(null);
  const [reports, setReports] = useState<Partial<Record<StageId, StageReport>>>({});
  const [errors, setErrors] = useState<Partial<Record<StageId, string>>>({});

  const updateFile = (stage: StageId, key: string, file?: File) => {
    setFiles(current => ({ ...current, [stage]: { ...(current[stage] ?? {}), ...(file ? { [key]: file } : {}) } }));
    setReports(current => ({ ...current, [stage]: undefined }));
    setErrors(current => ({ ...current, [stage]: undefined }));
  };
  const run = async (definition: StageDefinition) => {
    const stageFiles = files[definition.id] ?? {};
    const stageArtifacts = artifacts[definition.id] ?? [];
    if (busy || definition.inputs.some(key => !stageFiles[key]) || (definition.artifacts && !stageArtifacts.length)) return;
    setBusy(definition.id); setErrors(current => ({ ...current, [definition.id]: undefined })); setReports(current => ({ ...current, [definition.id]: undefined }));
    try {
      const report = await verify(definition.id, stageFiles, stageArtifacts);
      if (!validateReport(definition.id, report)) throw new Error('unsafe or contradictory Verified Systems response');
      setReports(current => ({ ...current, [definition.id]: report }));
    } catch (cause) {
      setErrors(current => ({ ...current, [definition.id]: cause instanceof Error ? cause.message : String(cause) }));
    } finally { setBusy(null); }
  };
  const download = async (stage: StageId, report: StageReport) => {
    const identity = report.releaseTargetHash ?? report.coverageHash ?? report.schema;
    await downloadBlob(`robot-${stage}-${identity}.json`, new Blob([`${JSON.stringify(report, null, 2)}\n`], { type: 'application/json' }));
  };

  return <details data-testid="robot-verified-systems" style={{ marginTop: 8 }}>
    <summary style={{ cursor: 'pointer', fontWeight: 700 }}>{L('Verified Systems 전체 검증·실증·감사', 'Verified Systems coverage, physical validation and audit')}</summary>
    <div style={{ marginTop: 6, display: 'grid', gap: 7 }}>
      <div style={{ fontSize: 10.5, color: 'var(--nx-text-3)' }}>
        {L('계산 커버리지에서 실물 계측·서버 서명 감사까지 같은 동결 요구사항에 결속합니다. 통과 표시는 실제 업로드 증거에만 적용되며 이 화면은 릴리스를 게시하지 않습니다.', 'Binds calculated coverage, physical measurements and a server-attested audit to one frozen requirement. Passed states require uploaded evidence; this screen never publishes a release.')}
      </div>
      {STAGES.map((definition, index) => {
        const stageFiles = files[definition.id] ?? {};
        const stageArtifacts = artifacts[definition.id] ?? [];
        const ready = definition.inputs.every(key => stageFiles[key]) && (!definition.artifacts || stageArtifacts.length > 0);
        const report = reports[definition.id];
        return <details key={definition.id} data-testid={`robot-verified-${definition.id}`} style={{ border: '1px solid var(--nx-border)', borderRadius: 5, padding: 7 }}>
          <summary style={{ cursor: 'pointer' }}><b>{index + 1}. {L(definition.titleKo, definition.title)}</b> · {report ? (stagePassed(definition.id, report) ? 'passed' : 'blocked') : 'not_run'}</summary>
          <div style={{ marginTop: 6, display: 'grid', gap: 5 }}>
            {definition.inputs.map(key => <label key={key} style={{ display: 'grid', gap: 2, fontSize: 10.5 }}>{key}<input data-testid={`robot-verified-${definition.id}-${key}`} type="file" accept="application/json,.json" onChange={event => updateFile(definition.id, key, event.target.files?.[0])} /></label>)}
            {definition.artifacts && <label style={{ display: 'grid', gap: 2, fontSize: 10.5 }}>{L('원시·교정·CAD/BOM 증거 파일', 'Raw, calibration and CAD/BOM evidence files')}<input data-testid={`robot-verified-${definition.id}-artifacts`} type="file" multiple onChange={event => { setArtifacts(current => ({ ...current, [definition.id]: Array.from(event.target.files ?? []) })); setReports(current => ({ ...current, [definition.id]: undefined })); }} /></label>}
            <button data-testid={`robot-verified-${definition.id}-run`} type="button" disabled={!ready || busy !== null} onClick={() => run(definition)}>{busy === definition.id ? (L('서버 재계산 중…', 'Server recomputing…')) : (L('검증 실행', 'Run verification'))}</button>
            {errors[definition.id] && <div data-testid={`robot-verified-${definition.id}-error`} role="alert" style={{ color: '#b91c1c' }}>{errors[definition.id]}</div>}
            {report && <div data-testid={`robot-verified-${definition.id}-report`} style={{ color: stagePassed(definition.id, report) ? '#166534' : '#b91c1c' }}>
              <b>{report.status}</b> · release false{definition.id === 'audit' && <> · issuer {report.auditIssuerId}</>}
              {report.errors.map(message => <div key={message}>{message}</div>)}
              <button data-testid={`robot-verified-${definition.id}-download`} type="button" onClick={() => download(definition.id, report)}>{L('결과 JSON 다운로드', 'Download result JSON')}</button>
            </div>}
          </div>
        </details>;
      })}
      <div style={{ color: '#92400e', fontSize: 10.5 }}>{L('최종 releaseReady는 신뢰된 서버 감사자 서명과 감사 이후의 도메인·독립 검토자 이중 서명이 모두 유효할 때만 별도 최종 검토 단계에서 열립니다.', 'Final releaseReady is unlocked only in the separate final-review gate after a trusted server audit signature and two independent post-audit human signatures.')}</div>
    </div>
  </details>;
}
