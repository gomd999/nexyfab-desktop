'use client';

import { useEffect, useState, useCallback } from 'react';

interface EmailJob {
  id: string;
  type: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  scheduledAt: string;
  createdAt: string;
  processedAt: string | null;
  errorMessage: string | null;
  to?: string;
  subject?: string;
}

const STATUS_COLORS: Record<string, string> = {
  pending:    'bg-yellow-100 text-yellow-700 border-yellow-200',
  processing: 'bg-blue-100 text-blue-700 border-blue-200',
  done:       'bg-green-100 text-green-700 border-green-200',
  failed:     'bg-red-100 text-red-700 border-red-200',
};

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString('ko-KR', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

export default function AdminEmailLogsPage() {
  const [jobs, setJobs] = useState<EmailJob[]>([]);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [retrying, setRetrying] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ type: 'send_email', limit: '200' });
      if (statusFilter) params.set('status', statusFilter);
      const res = await fetch(`/api/admin/jobs?${params}`);
      if (res.ok) {
        const data = await res.json();
        setJobs(data.jobs ?? []);
        setSummary(data.summary ?? {});
      }
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  const retryFailed = async () => {
    setRetrying('retry');
    setMsg(null);
    try {
      const res = await fetch('/api/admin/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'process_queue' }),
      });
      setMsg({ text: res.ok ? '대기/실패 Job 재처리 완료' : '재처리 실패', ok: res.ok });
      await load();
    } catch {
      setMsg({ text: '오류 발생', ok: false });
    } finally {
      setRetrying(null);
    }
  };

  const cleanOld = async () => {
    setRetrying('clean');
    try {
      const res = await fetch('/api/admin/jobs?days=30', { method: 'DELETE' });
      const d = await res.json();
      setMsg({ text: `${d.deleted}건 정리 완료 (30일 이상 된 완료/실패)`, ok: true });
      await load();
    } finally {
      setRetrying(null);
    }
  };

  const filtered = jobs.filter(j => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      j.id.toLowerCase().includes(q) ||
      j.status.includes(q) ||
      (j.errorMessage ?? '').toLowerCase().includes(q)
    );
  });

  // Counts for send_email type specifically (from filtered jobs)
  const typeSummary = { pending: 0, processing: 0, done: 0, failed: 0 };
  for (const j of jobs) {
    if (j.status in typeSummary) typeSummary[j.status as keyof typeof typeSummary]++;
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">이메일 발송 로그</h1>
          <p className="text-sm text-gray-500 mt-1">send_email 타입 Job 상태 조회 및 재처리</p>
        </div>
        <button onClick={load} disabled={loading}
          className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50">
          새로고침
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {(['pending', 'processing', 'done', 'failed'] as const).map(s => (
          <button key={s} onClick={() => setStatusFilter(statusFilter === s ? '' : s)}
            className={`rounded-xl border p-4 text-center transition-all ${
              statusFilter === s ? 'ring-2 ring-blue-500' : 'hover:border-blue-200'
            } ${STATUS_COLORS[s] ?? 'bg-white border-gray-200'}`}>
            <div className="text-2xl font-black">{typeSummary[s]}</div>
            <div className="text-xs font-semibold mt-1 capitalize">{
              s === 'pending' ? '대기' : s === 'processing' ? '처리중' : s === 'done' ? '완료' : '실패'
            }</div>
          </button>
        ))}
      </div>

      {/* Actions */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 mb-6">
        <div className="text-sm font-bold text-gray-700 mb-4">관리 액션</div>
        {msg && (
          <div className={`text-xs font-semibold px-3 py-2 rounded-lg mb-3 ${
            msg.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-600 border border-red-200'
          }`}>
            {msg.text}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <button onClick={retryFailed} disabled={!!retrying}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:border-blue-300 hover:text-blue-700 hover:bg-blue-50 transition disabled:opacity-50">
            ⚡ {retrying === 'retry' ? '처리 중...' : '실패 Job 재처리'}
          </button>
          <button onClick={cleanOld} disabled={!!retrying}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-red-200 text-sm font-semibold text-red-600 hover:bg-red-50 transition disabled:opacity-50 ml-auto">
            🧹 {retrying === 'clean' ? '정리 중...' : '30일 이상 된 완료/실패 정리'}
          </button>
        </div>
      </div>

      {/* Log list */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 gap-3 flex-wrap">
          <span className="text-sm font-bold text-gray-700">이메일 발송 내역 ({filtered.length}건)</span>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="검색 (ID · 오류 메시지)"
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 outline-none focus:border-blue-400 w-48"
            />
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
        </div>

        {loading ? (
          <div className="text-center py-12 text-gray-400">불러오는 중...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-400">이메일 발송 기록이 없습니다</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {filtered.map(job => (
              <div key={job.id} className="px-5 py-3 flex items-start gap-3 text-sm hover:bg-gray-50 transition-colors">
                <span className="text-base mt-0.5">📧</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${STATUS_COLORS[job.status] ?? 'bg-gray-100'}`}>
                      {job.status === 'pending' ? '대기' : job.status === 'processing' ? '처리중' : job.status === 'done' ? '완료' : '실패'}
                    </span>
                    {job.attempts > 0 && (
                      <span className="text-[10px] text-gray-400">시도 {job.attempts}/{job.maxAttempts}</span>
                    )}
                    {job.to && (
                      <span className="text-[10px] font-mono bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{job.to}</span>
                    )}
                  </div>
                  {job.subject && (
                    <div className="text-xs font-semibold text-gray-700 mt-1 truncate">{job.subject}</div>
                  )}
                  <div className="text-xs text-gray-400 mt-1 flex flex-wrap gap-x-3">
                    <span>생성: {fmtTime(job.createdAt)}</span>
                    {job.processedAt && <span>처리: {fmtTime(job.processedAt)}</span>}
                  </div>
                  {job.errorMessage && (
                    <div className="text-xs text-red-500 mt-1 break-all">{job.errorMessage}</div>
                  )}
                </div>
                <code className="text-[9px] font-mono text-gray-300 shrink-0 hidden sm:block self-center">
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
