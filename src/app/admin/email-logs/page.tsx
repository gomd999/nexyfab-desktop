'use client';

import { useEffect, useState, useCallback } from 'react';
import { formatDateTime } from '@/lib/formatDate';
import { useToast } from '@/hooks/useToast';

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
  htmlBody?: string;
}

const STATUS_COLORS: Record<string, string> = {
  pending:    'bg-yellow-100 text-yellow-700 border-yellow-200',
  processing: 'bg-blue-100 text-blue-700 border-blue-200',
  done:       'bg-green-100 text-green-700 border-green-200',
  failed:     'bg-red-100 text-red-700 border-red-200',
};

const STATUS_LABELS: Record<string, string> = {
  pending: '대기중', processing: '처리중', done: '발송완료', failed: '실패',
};

const PAGE_SIZE = 20;

// ── Loading skeleton row ──────────────────────────────────────────────────────
function SkeletonRow() {
  return (
    <div className="px-5 py-3 flex items-start gap-3 border-b border-gray-100 animate-pulse">
      <div className="w-5 h-5 rounded-full bg-gray-200 mt-0.5 shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="flex gap-2">
          <div className="h-4 w-14 rounded bg-gray-200" />
          <div className="h-4 w-28 rounded bg-gray-200" />
        </div>
        <div className="h-3 w-48 rounded bg-gray-100" />
        <div className="h-3 w-36 rounded bg-gray-100" />
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminEmailLogsPage() {
  const [jobs, setJobs] = useState<EmailJob[]>([]);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [retrying, setRetrying] = useState<string | null>(null);
  const toast = useToast();

  // Per-row state
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [resendingId, setResendingId] = useState<string | null>(null);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);

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
  // Reset to page 1 when search/filter changes
  useEffect(() => { setCurrentPage(1); }, [search, statusFilter]);

  const retryFailed = async () => {
    setRetrying('retry');
    try {
      const res = await fetch('/api/admin/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'process_queue' }),
      });
      if (res.ok) toast.success('대기/실패 Job 재처리 완료');
      else toast.error('재처리 실패');
      await load();
    } catch {
      toast.error('오류 발생');
    } finally {
      setRetrying(null);
    }
  };

  const cleanOld = async () => {
    setRetrying('clean');
    try {
      const res = await fetch('/api/admin/jobs?days=30', { method: 'DELETE' });
      const d = await res.json();
      toast.success(`${d.deleted}건 정리 완료 (30일 이상 된 완료/실패)`);
      await load();
    } finally {
      setRetrying(null);
    }
  };

  const resendOne = async (jobId: string) => {
    setResendingId(jobId);
    try {
      const res = await fetch('/api/admin/email-logs/resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) toast.success('재발송 요청 완료');
      else toast.error(d.error ?? '재발송 실패');
      if (res.ok) await load();
    } catch {
      toast.error('재발송 오류');
    } finally {
      setResendingId(null);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Filter
  const filtered = jobs.filter(j => {
    const matchesStatus = !statusFilter || j.status === statusFilter;
    if (!matchesStatus) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (j.to ?? '').toLowerCase().includes(q) ||
      (j.subject ?? '').toLowerCase().includes(q) ||
      j.id.toLowerCase().includes(q) ||
      (j.errorMessage ?? '').toLowerCase().includes(q)
    );
  });

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // Summary counts from all loaded jobs
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

      {/* Status filter tabs (summary cards) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {(['pending', 'processing', 'done', 'failed'] as const).map(s => (
          <button key={s} onClick={() => setStatusFilter(statusFilter === s ? '' : s)}
            className={`rounded-xl border p-4 text-center transition-all ${
              statusFilter === s ? 'ring-2 ring-blue-500' : 'hover:border-blue-200'
            } ${STATUS_COLORS[s] ?? 'bg-white border-gray-200'}`}>
            <div className="text-2xl font-black">{typeSummary[s]}</div>
            <div className="text-xs font-semibold mt-1 capitalize">{STATUS_LABELS[s]}</div>
          </button>
        ))}
      </div>

      {/* Actions */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 mb-6">
        <div className="text-sm font-bold text-gray-700 mb-4">관리 액션</div>
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
          <span className="text-sm font-bold text-gray-700">
            이메일 발송 내역 ({filtered.length}건)
          </span>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Search bar */}
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="수신자 이메일 또는 제목 검색"
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 outline-none focus:border-blue-400 w-52"
            />
            {/* Status filter pills */}
            <div className="flex gap-1">
              {[
                { value: '', label: '전체' },
                { value: 'done', label: '발송완료' },
                { value: 'failed', label: '실패' },
                { value: 'pending', label: '대기중' },
                { value: 'processing', label: '처리중' },
              ].map(opt => (
                <button key={opt.value || 'all'} onClick={() => setStatusFilter(opt.value)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                    statusFilter === opt.value ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-100'
                  }`}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {loading ? (
          // Loading skeleton — 5 shimmer rows
          <div>
            {Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-400">이메일 발송 기록이 없습니다</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {paginated.map(job => {
              const isExpanded = expandedIds.has(job.id);
              const isFailed = job.status === 'failed';
              return (
                <div key={job.id}>
                  {/* Main row */}
                  <div className="px-5 py-3 flex items-start gap-3 text-sm hover:bg-gray-50 transition-colors">
                    {/* Expand toggle */}
                    <button
                      onClick={() => toggleExpand(job.id)}
                      className="text-gray-400 hover:text-gray-600 mt-0.5 shrink-0 transition-transform"
                      style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}
                      title={isExpanded ? '접기' : '펼치기'}
                    >
                      ▶
                    </button>
                    <span className="text-base mt-0.5 shrink-0">📧</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${STATUS_COLORS[job.status] ?? 'bg-gray-100'}`}>
                          {STATUS_LABELS[job.status] ?? job.status}
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
                        <span>생성: {formatDateTime(job.createdAt)}</span>
                        {job.processedAt && <span>처리: {formatDateTime(job.processedAt)}</span>}
                      </div>
                      {job.errorMessage && (
                        <div className="text-xs text-red-500 mt-1 break-all">{job.errorMessage}</div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {/* Resend button for failed rows */}
                      {isFailed && (
                        <button
                          onClick={() => resendOne(job.id)}
                          disabled={resendingId === job.id}
                          className="text-[11px] font-semibold px-2.5 py-1 rounded-lg border border-blue-200 text-blue-600 hover:bg-blue-50 transition disabled:opacity-50"
                        >
                          {resendingId === job.id ? '발송 중...' : '재발송'}
                        </button>
                      )}
                      <code className="text-[9px] font-mono text-gray-300 hidden sm:block self-center">
                        {job.id.slice(0, 14)}
                      </code>
                    </div>
                  </div>

                  {/* Expandable HTML preview */}
                  {isExpanded && (
                    <div className="px-5 pb-4 bg-gray-50 border-b border-gray-100">
                      <div className="text-xs font-bold text-gray-500 mb-2 mt-1">이메일 미리보기</div>
                      {job.htmlBody ? (
                        <div
                          className="border border-gray-200 rounded-lg overflow-auto bg-white"
                          style={{ maxHeight: 320 }}
                        >
                          <iframe
                            srcDoc={job.htmlBody}
                            title="email preview"
                            sandbox="allow-same-origin"
                            className="w-full"
                            style={{ minHeight: 200, border: 'none' }}
                          />
                        </div>
                      ) : (
                        <div className="rounded-lg bg-white border border-gray-200 p-4">
                          <table className="w-full text-xs text-gray-700 border-collapse">
                            <tbody>
                              {[
                                ['Job ID', job.id],
                                ['수신자', job.to ?? '-'],
                                ['제목', job.subject ?? '-'],
                                ['상태', STATUS_LABELS[job.status] ?? job.status],
                                ['시도 횟수', `${job.attempts} / ${job.maxAttempts}`],
                                ['생성 시각', formatDateTime(job.createdAt)],
                                ['처리 시각', job.processedAt ? formatDateTime(job.processedAt) : '-'],
                                ['오류 메시지', job.errorMessage ?? '-'],
                              ].map(([k, v]) => (
                                <tr key={k} className="border-b border-gray-100">
                                  <td className="py-1.5 pr-4 font-semibold text-gray-400 w-28">{k}</td>
                                  <td className="py-1.5 break-all">{v}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {!loading && totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100">
            <span className="text-xs text-gray-400">
              {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} / {filtered.length}건
            </span>
            <div className="flex gap-1.5">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1 rounded-lg border border-gray-200 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
              >
                이전
              </button>
              {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                const p = i + 1;
                return (
                  <button
                    key={p}
                    onClick={() => setCurrentPage(p)}
                    className={`px-3 py-1 rounded-lg border text-xs font-semibold transition-colors ${
                      currentPage === p
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {p}
                  </button>
                );
              })}
              {totalPages > 7 && <span className="text-xs text-gray-400 self-center px-1">…{totalPages}</span>}
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-1 rounded-lg border border-gray-200 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
              >
                다음
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
