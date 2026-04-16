'use client';

import { useEffect, useState, useCallback } from 'react';

interface AuditEntry {
  id: string;
  userId: string;
  userEmail: string | null;
  userName: string | null;
  action: string;
  resourceId: string | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
}

const ACTION_COLORS: Record<string, string> = {
  'user.login': 'bg-green-100 text-green-700',
  'user.login_failed': 'bg-red-100 text-red-600',
  'user.logout': 'bg-gray-100 text-gray-500',
  'user.delete': 'bg-red-100 text-red-700',
  'rfq.create': 'bg-blue-100 text-blue-700',
  'rfq.update': 'bg-sky-100 text-sky-700',
  'rfq.assign': 'bg-indigo-100 text-indigo-700',
  'project.create': 'bg-violet-100 text-violet-700',
  'project.delete': 'bg-red-100 text-red-600',
  'billing.webhook': 'bg-yellow-100 text-yellow-700',
  'share.create': 'bg-teal-100 text-teal-700',
};

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString('ko-KR', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function ActionBadge({ action }: { action: string }) {
  const color = ACTION_COLORS[action] ?? 'bg-gray-100 text-gray-600';
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded border border-transparent ${color}`}>
      {action}
    </span>
  );
}

export default function AdminAuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [actions, setActions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const limit = 100;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      if (search) params.set('search', search);
      if (actionFilter) params.set('action', actionFilter);
      const res = await fetch(`/api/admin/audit?${params}`);
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries ?? []);
        setTotal(data.total ?? 0);
        setActions(data.actions ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [search, actionFilter, offset]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">감사 로그</h1>
          <p className="text-sm text-gray-500 mt-1">사용자 활동 이력 (총 {total.toLocaleString()}건)</p>
        </div>
        <button onClick={load} disabled={loading}
          className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50">
          새로고침
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          value={search}
          onChange={e => { setSearch(e.target.value); setOffset(0); }}
          placeholder="검색 (액션 · 리소스ID · 사용자ID)"
          className="text-sm px-3 py-2 border border-gray-200 rounded-xl outline-none focus:border-blue-400 w-72"
        />
        <select
          value={actionFilter}
          onChange={e => { setActionFilter(e.target.value); setOffset(0); }}
          className="text-sm px-3 py-2 border border-gray-200 rounded-xl outline-none focus:border-blue-400 bg-white"
        >
          <option value="">전체 액션</option>
          {actions.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                {['시각', '액션', '사용자', '리소스 ID', 'IP', '상세'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-bold text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400">불러오는 중...</td></tr>
              ) : entries.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400">감사 로그가 없습니다</td></tr>
              ) : (
                entries.map(e => (
                  <>
                    <tr key={e.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap font-mono">{fmtTime(e.createdAt)}</td>
                      <td className="px-4 py-2.5"><ActionBadge action={e.action} /></td>
                      <td className="px-4 py-2.5">
                        <div className="text-xs font-semibold text-gray-800 truncate max-w-[140px]">{e.userEmail ?? e.userId}</div>
                        {e.userName && <div className="text-[10px] text-gray-400">{e.userName}</div>}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-gray-500 truncate max-w-[120px]">{e.resourceId ?? '-'}</td>
                      <td className="px-4 py-2.5 text-xs text-gray-400 font-mono">{e.ip ?? '-'}</td>
                      <td className="px-4 py-2.5">
                        {e.metadata && (
                          <button
                            onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                            className="text-xs text-blue-600 hover:text-blue-800 font-semibold"
                          >
                            {expanded === e.id ? '접기 ▲' : '보기 ▼'}
                          </button>
                        )}
                      </td>
                    </tr>
                    {expanded === e.id && e.metadata && (
                      <tr key={`${e.id}-meta`} className="bg-blue-50/40">
                        <td colSpan={6} className="px-4 py-2">
                          <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono bg-white rounded-lg p-3 border border-gray-100 overflow-x-auto">
                            {JSON.stringify(e.metadata, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {total > limit && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <span className="text-xs text-gray-500">{offset + 1}–{Math.min(offset + limit, total)} / {total}</span>
            <div className="flex gap-2">
              <button onClick={() => setOffset(Math.max(0, offset - limit))} disabled={offset === 0}
                className="px-3 py-1 text-xs border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50">
                이전
              </button>
              <button onClick={() => setOffset(offset + limit)} disabled={offset + limit >= total}
                className="px-3 py-1 text-xs border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50">
                다음
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
