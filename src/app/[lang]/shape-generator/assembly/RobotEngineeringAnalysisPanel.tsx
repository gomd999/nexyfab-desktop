'use client';

import { useState } from 'react';
import { downloadBlob } from '@/lib/platform';
import type {
  RobotEngineeringAnalysisPacketFiles,
  RobotEngineeringAnalysisPacketReport,
} from '@/lib/ai/robot/robotEngineeringAnalysisPacket';
import { createCommercialLocalizer } from '@/lib/i18n/commercialLocalizer';

type FileKey = keyof RobotEngineeringAnalysisPacketFiles;
type Analyze = (files: Record<FileKey, File>) => Promise<RobotEngineeringAnalysisPacketReport>;

const INPUTS: Array<{ key: FileKey; label: string }> = [
  { key: 'requirements', label: 'Frozen system requirements' },
  { key: 'dynamicInput', label: 'Dynamic load input' },
  { key: 'dynamicReport', label: 'Dynamic load report' },
  { key: 'thermalInput', label: 'Duty thermal input' },
  { key: 'lifeInput', label: 'Bearing/reducer life input' },
  { key: 'complianceInput', label: 'Structural compliance input' },
  { key: 'precisionInput', label: 'TCP precision budget input' },
];

const defaultAnalyze: Analyze = async files => {
  const form = new FormData();
  for (const { key } of INPUTS) form.set(key, files[key]);
  const response = await fetch('/api/cad/v1/robot/engineering/analyze', { method: 'POST', body: form });
  const body = await response.json() as { report?: RobotEngineeringAnalysisPacketReport; message?: string };
  if (!body.report) throw new Error(body.message ?? `Engineering analysis failed (${response.status})`);
  return body.report;
};

export default function RobotEngineeringAnalysisPanel({ lang, analyze = defaultAnalyze }: { lang: string; analyze?: Analyze }) {
  const L = createCommercialLocalizer(lang);
  const [files, setFiles] = useState<Partial<Record<FileKey, File>>>({});
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<RobotEngineeringAnalysisPacketReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ready = INPUTS.every(({ key }) => files[key]);

  const run = async () => {
    if (!ready || busy) return;
    setBusy(true); setError(null); setReport(null);
    try {
      const result = await analyze(files as Record<FileKey, File>);
      const allComponents = Object.values(result.componentStatus).every(Boolean);
      const unsafe = result.releaseReady !== false
        || result.externalValidationComplete !== false
        || result.sideEffects.persisted !== false
        || result.sideEffects.cadModified !== false
        || result.sideEffects.quoteCreated !== false
        || result.sideEffects.rfqSent !== false
        || result.scope.fullRequirementsCoverageComplete !== false
        || (result.engineeringAnalysisReady && (result.status !== 'passed' || !allComponents || result.errors.length !== 0));
      if (unsafe) throw new Error('unsafe or contradictory engineering analysis response');
      setReport(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    if (!report) return;
    await downloadBlob(`robot-engineering-analysis-${report.applicationHash}.json`, new Blob([`${JSON.stringify(report, null, 2)}\n`], { type: 'application/json' }));
  };

  return <details data-testid="robot-engineering-analysis" style={{ marginTop: 8 }}>
    <summary style={{ cursor: 'pointer', fontWeight: 700 }}>{L('로봇 동역학·열·수명·강성·TCP 정밀도 결속', 'Bind robot dynamics, thermal, life, stiffness and TCP precision')}</summary>
    <div style={{ marginTop: 6, display: 'grid', gap: 5 }}>
      <div style={{ fontSize: 10.5, color: 'var(--nx-text-3)' }}>
        {L('서버가 동역학을 독립 재계산하고 모든 입력을 동일한 동결 요구사항·경로·페이로드·기구 모델에 결속합니다.', 'The server independently recomputes dynamics and binds every input to one frozen requirement, path, payload and kinematic model.')}
      </div>
      {INPUTS.map(({ key, label }) => <label key={key} style={{ display: 'grid', gap: 2, fontSize: 10.5 }}>
        {label}
        <input data-testid={`robot-engineering-${key}`} type="file" accept="application/json,.json" onChange={event => { setFiles(current => ({ ...current, [key]: event.target.files?.[0] })); setReport(null); setError(null); }} />
      </label>)}
      <button data-testid="robot-engineering-run" type="button" disabled={!ready || busy} onClick={run}>
        {busy ? (L('재계산·결속 중…', 'Recomputing and binding…')) : (L('엔지니어링 분석 패킷 검증', 'Verify engineering analysis packet'))}
      </button>
      {error && <div data-testid="robot-engineering-error" role="alert" style={{ color: '#b91c1c' }}>{error}</div>}
      {report && <div data-testid="robot-engineering-report" style={{ padding: 7, border: '1px solid var(--nx-border)', borderRadius: 5, color: report.engineeringAnalysisReady ? '#166534' : '#b91c1c' }}>
        <b>{report.engineeringAnalysisReady ? (L('단일 경로·페이로드 분석 통과', 'Single path/payload analysis passed')) : (L('엔지니어링 분석 차단', 'Engineering analysis blocked'))}</b>
        {Object.entries(report.componentStatus).map(([name, passed]) => <div key={name}>{passed ? '✓' : '✕'} {name}</div>)}
        {report.errors.map(message => <div key={message}>{message}</div>)}
        <div style={{ color: '#92400e' }}>
          {L('전체 요구조건 조합 커버리지와 TCP·강성·열·수명 물리 실증이 남아 있어 생산 릴리스는 차단됩니다.', 'Production release remains blocked pending full requirement-combination coverage and physical TCP, stiffness, thermal and life validation.')}
        </div>
        <div>application {report.applicationHash.slice(0, 12)}… · release false</div>
        <button data-testid="robot-engineering-download" type="button" onClick={download}>{L('해시 결속 분석 패킷 다운로드', 'Download hash-bound analysis packet')}</button>
      </div>}
    </div>
  </details>;
}
