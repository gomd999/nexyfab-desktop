'use client';

import { use, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/hooks/useAuth';
import { isKorean } from '@/lib/i18n/normalize';

interface EmailLog {
  id: string;
  to_email: string;
  subject: string;
  status: string;
  error: string | null;
  created_at: number;
}

interface ApiResponse {
  logs: EmailLog[];
  total: number;
  page: number;
  limit: number;
}

const T = {
  ko: {
    title: '이메일 발송 로그',
    to: '수신자',
    subject: '제목',
    status: '상태',
    error: '오류',
    date: '날짜',
    sent: '발송 완료',
    failed: '실패',
    all: '전체',
    filter: '상태 필터',
    clearOld: '오래된 로그 삭제',
    clearing: '삭제 중...',
    prev: '이전',
    next: '다음',
    loading: '로딩 중...',
    empty: '로그가 없습니다.',
    error_load: '로그를 불러오지 못했습니다.',
    page_of: (p: number, t: number) => `${p} / ${t} 페이지`,
    cleared: (n: number) => `${n}건 삭제되었습니다.`,
    clearFail: '삭제 실패',
    total: (n: number) => `총 ${n}건`,
  },
  en: {
    title: 'Email Delivery Logs',
    to: 'To',
    subject: 'Subject',
    status: 'Status',
    error: 'Error',
    date: 'Date',
    sent: 'Sent',
    failed: 'Failed',
    all: 'All',
    filter: 'Filter by Status',
    clearOld: 'Clear Old Logs',
    clearing: 'Clearing...',
    prev: 'Prev',
    next: 'Next',
    loading: 'Loading...',
    empty: 'No logs found.',
    error_load: 'Failed to load logs.',
    page_of: (p: number, t: number) => `Page ${p} of ${t}`,
    cleared: (n: number) => `${n} record(s) deleted.`,
    clearFail: 'Clear failed',
    total: (n: number) => `${n} total`,
  },
};

export default function AdminEmailLogsPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = use(params);
  const t = isKorean(lang) ? T.ko : T.en;

  const router = useRouter();
  const { user, isLoading: authLoading } = useAuthStore();
  useEffect(() => {
    if (!authLoading && user && user.role !== 'admin') {
      router.replace('/nexyfab');
    }
  }, [user, authLoading, router]);

  const [logs, setLogs] = useState<EmailLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<'all' | 'sent' | 'failed'>('all');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [clearing, setClearing] = useState(false);

  const LIMIT = 50;

  const fetchLogs = useCallback(
    async (p: number, filter: 'all' | 'sent' | 'failed') => {
      setLoading(true);
      setErr('');
      try {
        const url = `/api/admin/email-logs?page=${p}&limit=${LIMIT}${filter !== 'all' ? `&status=${filter}` : ''}`;
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: ApiResponse = await res.json();
        setLogs(data.logs ?? []);
        setTotal(data.total ?? 0);
      } catch (e) {
        setErr(t.error_load);
        console.error(e);
      } finally {
        setLoading(false);
      }
    },
    [t.error_load],
  );

  useEffect(() => {
    if (authLoading || !user || user.role !== 'admin') return;
    void fetchLogs(page, statusFilter);
  }, [fetchLogs, page, statusFilter, authLoading, user]);

  if (authLoading) return <div className="p-8 text-center text-gray-400">확인 중...</div>;
  if (!user || user.role !== 'admin') return null;

  const handleFilterChange = (val: 'all' | 'sent' | 'failed') => {
    setStatusFilter(val);
    setPage(1);
  };

  const handleClearOld = async () => {
    if (!confirm(isKorean(lang) ? '30일 이상 된 로그를 삭제할까요?' : 'Delete logs older than 30 days?')) return;
    setClearing(true);
    setMsg('');
    try {
      const res = await fetch('/api/admin/email-logs', { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error();
      const data = await res.json() as { deleted?: number };
      setMsg(t.cleared(data.deleted ?? 0));
      void fetchLogs(1, statusFilter);
      setPage(1);
    } catch {
      setMsg(t.clearFail);
    } finally {
      setClearing(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  const fmtDate = (ms: number) =>
    new Date(ms).toLocaleString(isKorean(lang) ? 'ko-KR' : 'en-US', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });

  const truncate = (s: string | null, n: number) =>
    !s ? '—' : s.length > n ? s.slice(0, n) + '…' : s;

  return (
    <div style={{ minHeight: '100vh', background: '#0d1117', color: '#c9d1d9', padding: '32px 24px', fontFamily: 'system-ui, sans-serif' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#f0f6fc' }}>{t.title}</h1>
          {!loading && <span style={{ fontSize: 13, color: '#8b949e', marginTop: 4, display: 'block' }}>{t.total(total)}</span>}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Status filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ fontSize: 13, color: '#8b949e' }}>{t.filter}:</label>
            <select
              value={statusFilter}
              onChange={(e) => handleFilterChange(e.target.value as 'all' | 'sent' | 'failed')}
              style={{ background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, padding: '6px 10px', fontSize: 13, cursor: 'pointer' }}
            >
              <option value="all">{t.all}</option>
              <option value="sent">{t.sent}</option>
              <option value="failed">{t.failed}</option>
            </select>
          </div>
          {/* Clear old button */}
          <button
            onClick={handleClearOld}
            disabled={clearing}
            style={{ background: '#21262d', border: '1px solid #f8514933', color: '#f85149', padding: '7px 14px', borderRadius: 6, fontSize: 13, cursor: clearing ? 'not-allowed' : 'pointer', opacity: clearing ? 0.6 : 1 }}
          >
            {clearing ? t.clearing : t.clearOld}
          </button>
          {/* Refresh */}
          <button
            onClick={() => fetchLogs(page, statusFilter)}
            style={{ background: '#21262d', border: '1px solid #30363d', color: '#c9d1d9', padding: '7px 14px', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}
          >
            ↻
          </button>
        </div>
      </div>

      {/* Status/error messages */}
      {msg && (
        <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 6, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#58a6ff' }}>
          {msg}
        </div>
      )}
      {err && (
        <div style={{ background: '#161b22', border: '1px solid #f85149', borderRadius: 6, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#f85149' }}>
          {err}
        </div>
      )}

      {/* Table */}
      <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 48, textAlign: 'center', color: '#8b949e' }}>{t.loading}</div>
        ) : logs.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: '#8b949e' }}>{t.empty}</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#0d1117', borderBottom: '1px solid #30363d' }}>
                  {[t.to, t.subject, t.status, t.error, t.date].map((col) => (
                    <th key={col} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: '#8b949e', whiteSpace: 'nowrap' }}>
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logs.map((log, i) => (
                  <tr
                    key={log.id}
                    style={{ borderBottom: i < logs.length - 1 ? '1px solid #21262d' : 'none', background: i % 2 === 0 ? 'transparent' : '#0d111766' }}
                  >
                    <td style={{ padding: '10px 14px', color: '#c9d1d9', fontFamily: 'monospace', fontSize: 12 }}>
                      {log.to_email}
                    </td>
                    <td style={{ padding: '10px 14px', color: '#c9d1d9', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {log.subject}
                    </td>
                    <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                      <span style={{
                        display: 'inline-block',
                        padding: '2px 10px',
                        borderRadius: 99,
                        fontSize: 12,
                        fontWeight: 600,
                        background: log.status === 'sent' ? '#1f4e2b' : '#4e1f1f',
                        color: log.status === 'sent' ? '#3fb950' : '#f85149',
                        border: `1px solid ${log.status === 'sent' ? '#2ea04333' : '#f8514933'}`,
                      }}>
                        {log.status === 'sent' ? t.sent : t.failed}
                      </span>
                    </td>
                    <td style={{ padding: '10px 14px', color: '#f85149', fontFamily: 'monospace', fontSize: 11 }}>
                      {truncate(log.error, 60)}
                    </td>
                    <td style={{ padding: '10px 14px', color: '#8b949e', whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: 11 }}>
                      {fmtDate(log.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 20 }}>
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
            style={{ background: '#21262d', border: '1px solid #30363d', color: page <= 1 ? '#484f58' : '#c9d1d9', padding: '7px 16px', borderRadius: 6, fontSize: 13, cursor: page <= 1 ? 'not-allowed' : 'pointer' }}
          >
            {t.prev}
          </button>
          <span style={{ fontSize: 13, color: '#8b949e' }}>{t.page_of(page, totalPages)}</span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || loading}
            style={{ background: '#21262d', border: '1px solid #30363d', color: page >= totalPages ? '#484f58' : '#c9d1d9', padding: '7px 16px', borderRadius: 6, fontSize: 13, cursor: page >= totalPages ? 'not-allowed' : 'pointer' }}
          >
            {t.next}
          </button>
        </div>
      )}
    </div>
  );
}
