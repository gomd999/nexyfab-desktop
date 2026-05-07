'use client';

import { useEffect, useState, useCallback } from 'react';

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

function fmtTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function AdminJobsPage() {
  const [data, setData] = useState<JobsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [triggerMsg, setTriggerMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [triggering, setTriggering] = useState<string | null>(null);
  const [cleaning, setCleaning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const url = `/api/admin/jobs${statusFilter ? `?status=${statusFilter}` : ''}`;
      const res = await fetch(url);
      if (res.ok) setData(await res.json());
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
      const d = await res.json();
      setTriggerMsg({ text: `${label} 완료`, ok: res.ok });
      await load();
    } catch {
      setTriggerMsg({ text: `${label} 실패`, ok: false });
    } finally {
      setTriggering(null);
    }
  };

  const cleanOld = async () => {
    setCleaning(true);
    try {
      const res = await fetch('/api/admin/jobs?days=7', { method: 'DELETE' });
      const d = await res.json();
      setTriggerMsg({ text: `${d.deleted}건 정리 완료 (7일 이상 된 done/failed)`, ok: true });
      await load();
    } finally {
      setCleaning(false); }
  };

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Job Queue 모니터</h1>
          <p className="text-sm text-gray-500 mt-1">백그라운드 작업 현황 및 수동 트리거</p>
        </div>
        <button onClick={load} disabled={loading}
          className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50">
          새로고침
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

      {/* Cron triggers */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 mb-6">
        <div className="text-sm font-bold text-gray-700 mb-4">수동 트리거</div>
        {triggerMsg && (
          <div className={`text-xs font-semibold px-3 py-2 rounded-lg mb-3 ${
            triggerMsg.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-600 border border-red-200'
          }`}>
            {triggerMsg.text}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {[
            { action: 'process_queue', label: '대기 Job 즉시 처리', icon: '⚡' },
            { action: 'quote_expiry_remind', label: '견적 만료 리마인더', icon: '📨' },
            { action: 'sla_check', label: 'SLA 기한 체크', icon: '⏰' },
            { action: 'db_backup', label: 'DB 백업', icon: '💾' },
          ].map(t => (
            <button key={t.action}
              onClick={() => trigger(t.action, t.label)}
              disabled={!!triggering}
              className="flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:border-blue-300 hover:text-blue-700 hover:bg-blue-50 transition disabled:opacity-50">
              <span>{t.icon}</span>
              {triggering === t.action ? '실행 중...' : t.label}
            </button>
          ))}
          <button onClick={cleanOld} disabled={cleaning}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-red-200 text-sm font-semibold text-red-600 hover:bg-red-50 transition disabled:opacity-50 ml-auto">
            🧹 {cleaning ? '정리 중...' : '완료/실패 정리 (7일 이상)'}
          </button>
        </div>
      </div>

      {/* Job list */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <span className="text-sm font-bold text-gray-700">최근 Job 목록</span>
          <div className="flex gap-1">
            {['', 'pending', 'processing', 'done', 'failed'].map(s => (
              <button key={s || 'all'} onClick={() => setStatusFilter(s)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                  statusFilter === s ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-100'
                }`}>
                {s || '전체'}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12 text-gray-400">불러오는 중...</div>
        ) : !data || data.jobs.length === 0 ? (
          <div className="text-center py-12 text-gray-400">Job이 없습니다</div>
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
                      <span className="text-[10px] text-gray-400">시도 {job.attempts}/{job.maxAttempts}</span>
                    )}
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5 truncate">
                    <span>생성: {fmtTime(job.createdAt)}</span>
                    {job.processedAt && <span className="ml-3">처리: {fmtTime(job.processedAt)}</span>}
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
