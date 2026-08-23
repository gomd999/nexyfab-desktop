'use client';
import { useAdminI18n } from '../AdminI18nProvider';
import { createCommercialLocalizer } from '@/lib/i18n/commercialLocalizer';

import { useCallback, useEffect, useMemo, useState } from 'react';

interface WorkerRow {
  workerKind: string; nativeApplication: string; configured: boolean;
  status: 'unconfigured' | 'configured_unprobed' | 'health_failed' | 'health_stale' | 'ready_for_canary' | 'canary_passed';
  healthStatus: string; canaryStatus: string; batchEligible: boolean;
}
interface WorkerResponse {
  releaseReady: boolean;
  evidenceStatus: { health: 'missing' | 'fresh' | 'stale'; canary: 'missing' | 'fresh' | 'stale' | 'expired' | 'invalid' };
  summary: { workers: number; configured: number; healthReady: number; canaryPassed: number };
  workers: WorkerRow[];
  evidence: { healthLoaded: boolean; canaryLoaded: boolean };
}

const EVIDENCE_LABEL = {
  missing: { ko: '없음', en: 'Missing' },
  fresh: { ko: '유효', en: 'Fresh' },
  stale: { ko: '오래됨', en: 'Stale' },
  expired: { ko: '헬스 만료', en: 'Health expired' },
  invalid: { ko: '형식 불량', en: 'Invalid format' },
} as const;

const STATUS: Record<WorkerRow['status'], { labelKo: string; labelEn: string; className: string; descKo: string; descEn: string }> = {
  unconfigured: { labelKo: '미구성', labelEn: 'Unconfigured', className: 'bg-gray-100 text-gray-700', descKo: '격리된 라이선스 워커 명령을 배포 환경에 설정', descEn: 'Configure the isolated licensed-worker command in the deployment environment' },
  configured_unprobed: { labelKo: '헬스 미검증', labelEn: 'Health unverified', className: 'bg-amber-100 text-amber-800', descKo: '헬스 프로브 실행 후 최신 증거 경로 연결', descEn: 'Run the health probe and connect the latest evidence path' },
  health_failed: { labelKo: '헬스 실패', labelEn: 'Health failed', className: 'bg-red-100 text-red-700', descKo: 'OS·라이선스·정밀 형상·네이티브 의미 기능 점검', descEn: 'Check the OS, license, precision geometry, and native semantic capabilities' },
  health_stale: { labelKo: '헬스 만료', labelEn: 'Health expired', className: 'bg-orange-100 text-orange-800', descKo: '24시간 이내 헬스 프로브 재실행', descEn: 'Rerun the health probe within 24 hours' },
  ready_for_canary: { labelKo: '카나리 대기', labelEn: 'Ready for canary', className: 'bg-blue-100 text-blue-800', descKo: '해시 고정 카나리 1건 실행 및 승인', descEn: 'Run and approve one hash-pinned canary' },
  canary_passed: { labelKo: '배치 가능', labelEn: 'Batch eligible', className: 'bg-emerald-100 text-emerald-800', descKo: '승인된 워커 종류의 대기 배치만 재개', descEn: 'Resume only queued batches for approved worker types' },
};

export default function NativeCadWorkersPage() {
  const { locale } = useAdminI18n();
  const L = useMemo(() => createCommercialLocalizer(locale), [locale]);
  const [data, setData] = useState<WorkerResponse | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const response = await fetch('/api/admin/native-cad-workers', { credentials: 'include', cache: 'no-store' });
    if (!response.ok) { setError(L(`상태 조회 실패 (${response.status})`, `Failed to retrieve status (${response.status})`)); return; }
    setData(await response.json() as WorkerResponse); setError('');
  }, [L]);
  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), 30_000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, [load]);

  return <main className="mx-auto max-w-7xl px-5 py-8">
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-2xl font-bold text-gray-950">Native CAD Worker Readiness</h1><p className="mt-1 text-sm text-gray-600">{L('환경 변수 존재 여부가 아니라 최신 헬스 검증과 카나리 승인까지 단계별로 표시합니다.', 'Shows each stage through current health verification and canary approval, not merely whether environment variables exist.')}</p></div>
      <button onClick={() => void load()} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-gray-50">{L('새로고침', 'Refresh')}</button>
    </div>
    {error && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    {data && <>
      <section className="mb-5 grid gap-3 sm:grid-cols-4">{[
        [L('전체', 'Total'), data.summary.workers], [L('명령 구성', 'Commands configured'), data.summary.configured], [L('헬스 통과', 'Health passed'), data.summary.healthReady], [L('카나리 통과', 'Canary passed'), data.summary.canaryPassed],
      ].map(([label, value]) => <div key={label} className="rounded-xl border bg-white p-4"><div className="text-xs text-gray-500">{label}</div><div className="mt-1 text-2xl font-bold">{value}</div></div>)}</section>
      <div className={`mb-5 rounded-xl border p-4 text-sm ${data.releaseReady ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>
        {data.releaseReady ? L('7종 모두 최신 헬스와 카나리가 통과했습니다.', 'All seven worker types have passed current health and canary checks.') : L('제조 릴리스용 네이티브 CAD 배치는 아직 잠겨 있습니다.', 'Native CAD batching for manufacturing releases is still locked.')}
        <span className="ml-2 text-xs opacity-75">{L('헬스 증거', 'Health evidence')} {L(EVIDENCE_LABEL[data.evidenceStatus.health].ko, EVIDENCE_LABEL[data.evidenceStatus.health].en)} · {L('카나리 증거', 'Canary evidence')} {L(EVIDENCE_LABEL[data.evidenceStatus.canary].ko, EVIDENCE_LABEL[data.evidenceStatus.canary].en)} ({L('파일:', 'Files:')} {data.evidence.healthLoaded ? L('연결', 'connected') : L('미연결', 'not connected')}/{data.evidence.canaryLoaded ? L('연결', 'connected') : L('미연결', 'not connected')})</span>
      </div>
      <section className="overflow-hidden rounded-xl border bg-white"><table className="w-full text-left text-sm">
        <thead className="bg-gray-50 text-xs text-gray-600"><tr><th className="p-3">{L('CAD 엔진', 'CAD engine')}</th><th className="p-3">{L('상태', 'Status')}</th><th className="p-3">{L('헬스', 'Health')}</th><th className="p-3">{L('카나리', 'Canary')}</th><th className="p-3">{L('다음 조치', 'Next action')}</th></tr></thead>
        <tbody>{data.workers.map((worker) => { const status = STATUS[worker.status]; return <tr key={worker.workerKind} className="border-t"><td className="p-3"><div className="font-semibold">{worker.nativeApplication}</div><div className="text-xs text-gray-500">{worker.workerKind}</div></td><td className="p-3"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${status.className}`}>{L(status.labelKo, status.labelEn)}</span></td><td className="p-3 text-xs">{worker.healthStatus}</td><td className="p-3 text-xs">{worker.canaryStatus}</td><td className="p-3 text-xs text-gray-600">{L(status.descKo, status.descEn)}</td></tr>; })}</tbody>
      </table></section>
      <p className="mt-4 text-xs text-gray-500">{L('명령 경로, 라이선스 정보, 토큰은 API와 화면에 노출되지 않습니다. 증거 유효기간은 24시간입니다.', 'Command paths, license information, and tokens are not exposed through the API or UI. Evidence remains valid for 24 hours.')}</p>
    </>}
  </main>;
}
