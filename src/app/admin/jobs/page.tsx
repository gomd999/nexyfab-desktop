'use client';
import { useAdminI18n } from '../AdminI18nProvider';
import { createCommercialLocalizer } from '@/lib/i18n/commercialLocalizer';
import { formatDate } from '@/lib/i18n/format';

import { useEffect, useState, useCallback, useMemo } from 'react';

interface JobEntry {
  id: string; type: string; status: string; attempts: number; maxAttempts: number;
  scheduledAt: string; createdAt: string; processedAt: string | null;
  errorMessage: string | null;
}

interface JobsResponse {
  jobs: JobEntry[];
  summary: Record<string, number>;
  total: number;
}

type BridgeQueueStatus = 'PENDING' | 'CLAIMED' | 'SENT' | 'COMPLETED' | 'HOLD' | 'VERIFIED_UNKNOWN';

interface BridgeOperationsResponse {
  ok: true;
  status: 'READY' | 'DEGRADED' | 'ACTION_REQUIRED';
  generatedAt: string;
  manufacturingReleaseReady: false;
  counts: Record<BridgeQueueStatus, number>;
  oldestAgeMs: Record<BridgeQueueStatus, number | null>;
  throughput24h: { completed: number; held: number; receiptsAccepted: number };
  leases: { active: number; expired: number };
  alerts: Array<{ code: string; severity: 'warning' | 'critical'; count: number; oldestAgeMs: number | null }>;
  exceptions: Array<{
    jobId: string; status: 'HOLD' | 'VERIFIED_UNKNOWN' | 'CLAIMED' | 'SENT';
    attempt: number; leaseGeneration: number; ageMs: number; leaseExpired: boolean;
    lastErrorCode: string | null; updatedAt: string;
  }>;
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  processing: 'bg-blue-100 text-blue-700 border-blue-200',
  done: 'bg-green-100 text-green-700 border-green-200',
  failed: 'bg-red-100 text-red-700 border-red-200',
};

const TYPE_ICONS: Record<string, string> = {
  send_email: '📧',
  stripe_reprocess: '💳',
};

function compactDuration(milliseconds: number | null): string {
  if (milliseconds === null) return '-';
  const minutes = Math.floor(milliseconds / 60_000);
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

export default function AdminJobsPage() {
  const { locale } = useAdminI18n();
  const L = useMemo(() => createCommercialLocalizer(locale), [locale]);
  const [data, setData] = useState<JobsResponse | null>(null);
  const [bridge, setBridge] = useState<BridgeOperationsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [triggerMsg, setTriggerMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [triggering, setTriggering] = useState<string | null>(null);
  const [cleaning, setCleaning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const url = `/api/admin/jobs${statusFilter ? `?status=${statusFilter}` : ''}`;
      const [res, bridgeRes] = await Promise.all([
        fetch(url),
        fetch('/api/admin/ai-precision-bridge', { cache: 'no-store' }),
      ]);
      if (res.ok) setData(await res.json());
      setBridge(bridgeRes.ok ? await bridgeRes.json() as BridgeOperationsResponse : null);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  const trigger = async (action: string, label: string) => {
    setTriggering(action);
    setTriggerMsg(null);
    try {
      const res = await fetch('/api/admin/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const _d = await res.json();
      setTriggerMsg({ text: L(`${label} 완료`, `${label} complete`), ok: res.ok });
      await load();
    } catch {
      setTriggerMsg({ text: L(`${label} 실패`, `${label} failed`), ok: false });
    } finally {
      setTriggering(null);
    }
  };

  const cleanOld = async () => {
    setCleaning(true);
    try {
      const res = await fetch('/api/admin/jobs?days=7', { method: 'DELETE' });
      const d = await res.json();
      setTriggerMsg({ text: L(`${d.deleted}건 정리 완료 (7일 이상 된 완료/실패 작업)`, `${d.deleted} jobs cleaned up (completed/failed for 7+ days)`), ok: true });
      await load();
    } finally {
      setCleaning(false); }
  };

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{L('작업 대기열 모니터', 'Job queue monitor')}</h1>
          <p className="text-sm text-gray-500 mt-1">{L('백그라운드 작업 현황 및 수동 트리거', 'Background job status and manual triggers')}</p>
        </div>
        <button onClick={load} disabled={loading}
          className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50">
          {L('새로고침', 'Refresh')}
        </button>
      </div>

      {/* Summary */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {(['pending', 'processing', 'done', 'failed'] as const).map(s => (
            <button key={s} onClick={() => setStatusFilter(statusFilter === s ? '' : s)}
              className={`rounded-xl border p-4 text-center transition-all ${
                statusFilter === s ? 'ring-2 ring-blue-500' : 'hover:border-blue-200'
              } ${STATUS_COLORS[s] ?? 'bg-white border-gray-200'}`}>
              <div className="text-2xl font-black">{data.summary[s] ?? 0}</div>
              <div className="text-xs font-semibold mt-1 capitalize">{s}</div>
            </button>
          ))}
        </div>
      )}

      {bridge && (
        <section className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 mb-6" aria-labelledby="ai-precision-bridge-title">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div>
              <h2 id="ai-precision-bridge-title" className="text-sm font-bold text-gray-800">
                {L('AI → 정밀 CAD 정확 실행 브리지', 'AI → Precision CAD exact bridge')}
              </h2>
              <p className="text-xs text-gray-500 mt-1">
                {L('대기 SLA, lease, HOLD 및 불확실 실행을 감시합니다. 제조 승인을 부여하지 않습니다.', 'Monitors backlog SLA, leases, HOLD, and uncertain executions. It never grants manufacturing approval.')}
              </p>
            </div>
            <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${
              bridge.status === 'READY' ? 'bg-green-50 text-green-700 border-green-200'
                : bridge.status === 'DEGRADED' ? 'bg-yellow-50 text-yellow-700 border-yellow-200'
                  : 'bg-red-50 text-red-700 border-red-200'
            }`}>
              {bridge.status}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-4">
            {(Object.keys(bridge.counts) as BridgeQueueStatus[]).map(status => (
              <div key={status} className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
                <div className="text-lg font-black text-gray-800">{bridge.counts[status]}</div>
                <div className="text-[10px] font-bold text-gray-500">{status}</div>
                <div className="text-[10px] text-gray-400">{L('최장', 'Oldest')} {compactDuration(bridge.oldestAgeMs[status])}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs mb-4">
            <div><span className="text-gray-400">{L('24시간 완료', 'Completed 24h')}</span><div className="font-bold">{bridge.throughput24h.completed}</div></div>
            <div><span className="text-gray-400">{L('24시간 HOLD', 'HOLD 24h')}</span><div className="font-bold">{bridge.throughput24h.held}</div></div>
            <div><span className="text-gray-400">{L('수락 영수증', 'Accepted receipts')}</span><div className="font-bold">{bridge.throughput24h.receiptsAccepted}</div></div>
            <div><span className="text-gray-400">{L('활성 lease', 'Active leases')}</span><div className="font-bold">{bridge.leases.active}</div></div>
            <div><span className="text-gray-400">{L('만료 lease', 'Expired leases')}</span><div className={`font-bold ${bridge.leases.expired ? 'text-red-600' : ''}`}>{bridge.leases.expired}</div></div>
          </div>

          {bridge.alerts.length > 0 && (
            <div className="space-y-1 mb-4" role="status" aria-live="polite">
              {bridge.alerts.map(alert => (
                <div key={alert.code} className={`rounded-lg border px-3 py-2 text-xs font-semibold ${
                  alert.severity === 'critical' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-yellow-50 border-yellow-200 text-yellow-700'
                }`}>
                  {alert.code} · {L('건수', 'Count')} {alert.count} · {L('최장', 'Oldest')} {compactDuration(alert.oldestAgeMs)}
                </div>
              ))}
            </div>
          )}

          {bridge.exceptions.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-gray-400 border-b"><th className="py-2">Job</th><th>Status</th><th>{L('시도', 'Attempt')}</th><th>{L('경과', 'Age')}</th><th>{L('오류 코드', 'Error code')}</th></tr></thead>
                <tbody>{bridge.exceptions.map(item => (
                  <tr key={`${item.jobId}:${item.status}`} className="border-b border-gray-50 last:border-0">
                    <td className="py-2 font-mono text-[10px]">{item.jobId.slice(0, 30)}</td>
                    <td className={item.leaseExpired || item.status === 'VERIFIED_UNKNOWN' ? 'font-bold text-red-600' : 'font-semibold'}>{item.status}</td>
                    <td>{item.attempt}/{item.leaseGeneration}</td>
                    <td>{compactDuration(item.ageMs)}</td>
                    <td className="font-mono text-[10px]">{item.lastErrorCode ?? '-'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Cron triggers */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 mb-6">
        <div className="text-sm font-bold text-gray-700 mb-4">{L('수동 트리거', 'Manual triggers')}</div>
        {triggerMsg && (
          <div className={`text-xs font-semibold px-3 py-2 rounded-lg mb-3 ${
            triggerMsg.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-600 border border-red-200'
          }`}>
            {triggerMsg.text}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {[
            { action: 'process_queue', label: L('대기 작업 즉시 처리', 'Process queued jobs now'), icon: '⚡' },
            { action: 'quote_expiry_remind', label: L('견적 만료 리마인더', 'Quote expiry reminders'), icon: '📨' },
            { action: 'sla_check', label: L('SLA 기한 체크', 'SLA deadline check'), icon: '⏰' },
            { action: 'db_backup', label: L('DB 백업', 'Database backup'), icon: '💾' },
          ].map(t => (
            <button key={t.action}
              onClick={() => trigger(t.action, t.label)}
              disabled={!!triggering}
              className="flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:border-blue-300 hover:text-blue-700 hover:bg-blue-50 transition disabled:opacity-50">
              <span>{t.icon}</span>
              {triggering === t.action ? L('실행 중...', 'Running...') : t.label}
            </button>
          ))}
          <button onClick={cleanOld} disabled={cleaning}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-red-200 text-sm font-semibold text-red-600 hover:bg-red-50 transition disabled:opacity-50 ml-auto">
            🧹 {cleaning ? L('정리 중...', 'Cleaning...') : L('완료/실패 정리 (7일 이상)', 'Clean completed/failed (7+ days)')}
          </button>
        </div>
      </div>

      {/* Job list */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <span className="text-sm font-bold text-gray-700">{L('최근 작업 목록', 'Recent jobs')}</span>
          <div className="flex gap-1">
            {['', 'pending', 'processing', 'done', 'failed'].map(s => (
              <button key={s || 'all'} onClick={() => setStatusFilter(s)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                  statusFilter === s ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-100'
                }`}>
                {s || L('전체', 'All')}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12 text-gray-400">{L('불러오는 중...', 'Loading…')}</div>
        ) : !data || data.jobs.length === 0 ? (
          <div className="text-center py-12 text-gray-400">{L('작업이 없습니다.', 'No jobs found.')}</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {data.jobs.map(job => (
              <div key={job.id} className="px-5 py-3 flex items-center gap-3 text-sm">
                <span className="text-base">{TYPE_ICONS[job.type] ?? '⚙️'}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-800">{job.type}</span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${STATUS_COLORS[job.status] ?? 'bg-gray-100'}`}>
                      {job.status}
                    </span>
                    {job.attempts > 0 && (
                      <span className="text-[10px] text-gray-400">{L('시도', 'Attempts')} {job.attempts}/{job.maxAttempts}</span>
                    )}
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5 truncate">
                    <span>{L('생성:', 'Created:')} {formatDate(job.createdAt, locale, { dateStyle: 'short', timeStyle: 'medium' }) ?? '-'}</span>
                    {job.processedAt && <span className="ml-3">{L('처리:', 'Processed:')} {formatDate(job.processedAt, locale, { dateStyle: 'short', timeStyle: 'medium' }) ?? '-'}</span>}
                  </div>
                  {job.errorMessage && (
                    <div className="text-xs text-red-500 mt-0.5 truncate">{job.errorMessage}</div>
                  )}
                </div>
                <code className="text-[9px] font-mono text-gray-300 shrink-0 hidden sm:block">
                  {job.id.slice(0, 14)}
                </code>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
