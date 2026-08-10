'use client';

import { useCallback, useEffect, useState } from 'react';

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
  missing: '없음', fresh: '유효', stale: '오래됨', expired: '헬스 만료', invalid: '형식 불량',
} as const;

const STATUS: Record<WorkerRow['status'], { label: string; className: string; next: string }> = {
  unconfigured: { label: '미구성', className: 'bg-gray-100 text-gray-700', next: '격리된 라이선스 워커 명령을 배포 환경에 설정' },
  configured_unprobed: { label: '헬스 미검증', className: 'bg-amber-100 text-amber-800', next: 'health probe 실행 후 최신 증거 경로 연결' },
  health_failed: { label: '헬스 실패', className: 'bg-red-100 text-red-700', next: 'OS·라이선스·정밀 형상·네이티브 의미 기능 점검' },
  health_stale: { label: '헬스 만료', className: 'bg-orange-100 text-orange-800', next: '24시간 이내 health probe 재실행' },
  ready_for_canary: { label: '카나리 대기', className: 'bg-blue-100 text-blue-800', next: '해시 고정 카나리 1건 실행 및 승인' },
  canary_passed: { label: '배치 가능', className: 'bg-emerald-100 text-emerald-800', next: '승인된 워커 종류의 대기 배치만 재개' },
};

export default function NativeCadWorkersPage() {
  const [data, setData] = useState<WorkerResponse | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const response = await fetch('/api/admin/native-cad-workers', { credentials: 'include', cache: 'no-store' });
    if (!response.ok) { setError(`상태 조회 실패 (${response.status})`); return; }
    setData(await response.json() as WorkerResponse); setError('');
  }, []);
  useEffect(() => { void load(); const timer = setInterval(() => void load(), 30_000); return () => clearInterval(timer); }, [load]);

  return <main className="mx-auto max-w-7xl px-5 py-8">
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-2xl font-bold text-gray-950">Native CAD Worker Readiness</h1><p className="mt-1 text-sm text-gray-600">환경 변수 존재가 아니라 최신 헬스 검증과 카나리 승인까지 단계별로 표시합니다.</p></div>
      <button onClick={() => void load()} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-gray-50">새로고침</button>
    </div>
    {error && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    {data && <>
      <section className="mb-5 grid gap-3 sm:grid-cols-4">{[
        ['전체', data.summary.workers], ['명령 구성', data.summary.configured], ['헬스 통과', data.summary.healthReady], ['카나리 통과', data.summary.canaryPassed],
      ].map(([label, value]) => <div key={label} className="rounded-xl border bg-white p-4"><div className="text-xs text-gray-500">{label}</div><div className="mt-1 text-2xl font-bold">{value}</div></div>)}</section>
      <div className={`mb-5 rounded-xl border p-4 text-sm ${data.releaseReady ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>
        {data.releaseReady ? '7종 모두 최신 헬스와 카나리가 통과했습니다.' : '제조 릴리스용 네이티브 CAD 배치는 아직 잠겨 있습니다.'}
        <span className="ml-2 text-xs opacity-75">헬스 증거 {EVIDENCE_LABEL[data.evidenceStatus.health]} · 카나리 증거 {EVIDENCE_LABEL[data.evidenceStatus.canary]} (파일: {data.evidence.healthLoaded ? '연결' : '미연결'}/{data.evidence.canaryLoaded ? '연결' : '미연결'})</span>
      </div>
      <section className="overflow-hidden rounded-xl border bg-white"><table className="w-full text-left text-sm">
        <thead className="bg-gray-50 text-xs text-gray-600"><tr><th className="p-3">CAD 엔진</th><th className="p-3">상태</th><th className="p-3">헬스</th><th className="p-3">카나리</th><th className="p-3">다음 조치</th></tr></thead>
        <tbody>{data.workers.map((worker) => { const status = STATUS[worker.status]; return <tr key={worker.workerKind} className="border-t"><td className="p-3"><div className="font-semibold">{worker.nativeApplication}</div><div className="text-xs text-gray-500">{worker.workerKind}</div></td><td className="p-3"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${status.className}`}>{status.label}</span></td><td className="p-3 text-xs">{worker.healthStatus}</td><td className="p-3 text-xs">{worker.canaryStatus}</td><td className="p-3 text-xs text-gray-600">{status.next}</td></tr>; })}</tbody>
      </table></section>
      <p className="mt-4 text-xs text-gray-500">명령 경로, 라이선스 정보, 토큰은 API와 화면에 노출되지 않습니다. 증거 유효기간은 24시간입니다.</p>
    </>}
  </main>;
}
