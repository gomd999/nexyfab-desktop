'use client';

import { useEffect, useState, useCallback } from 'react';
import type { SLAAlert } from '@/lib/sla-checker';

interface SLAResponse {
  alerts: SLAAlert[];
  summary: { total: number; overdue: number; warning: number };
}

function DaysBadge({ days }: { days: number }) {
  if (days < 0) {
    return (
      <span className="text-xs font-black px-2.5 py-1 rounded-full bg-red-100 text-red-700 border border-red-200">
        D+{Math.abs(days)} 연체
      </span>
    );
  }
  if (days === 0) {
    return (
      <span className="text-xs font-black px-2.5 py-1 rounded-full bg-red-50 text-red-600 border border-red-200">
        D-Day
      </span>
    );
  }
  return (
    <span className={`text-xs font-black px-2.5 py-1 rounded-full border ${
      days <= 1 ? 'bg-orange-100 text-orange-700 border-orange-200'
      : 'bg-yellow-50 text-yellow-700 border-yellow-200'
    }`}>
      D-{days}
    </span>
  );
}

export default function SLAPage() {
  const [data, setData] = useState<SLAResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [triggerMsg, setTriggerMsg] = useState('');
  const [filter, setFilter] = useState<'all' | 'overdue' | 'warning'>('all');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/sla');
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const triggerCheck = async () => {
    setTriggering(true);
    setTriggerMsg('');
    try {
      const res = await fetch('/api/admin/sla', { method: 'POST' });
      const d = await res.json();
      setTriggerMsg(`SLA 체크 완료 — 알림 ${d.alertsFound}건 발견`);
      await load();
    } catch {
      setTriggerMsg('오류가 발생했습니다.');
    } finally {
      setTriggering(false);
    }
  };

  const filtered = (data?.alerts ?? []).filter(a => {
    if (filter === 'overdue' && a.status !== 'overdue') return false;
    if (filter === 'warning' && a.status !== 'warning') return false;
    if (search) {
      const q = search.toLowerCase();
      return a.title.toLowerCase().includes(q) || a.contractId.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">SLA 모니터링</h1>
          <p className="text-sm text-gray-500 mt-1">마일스톤 기한 경고 및 연체 현황</p>
        </div>
        <div className="flex gap-2 items-center">
          {triggerMsg && (
            <span className="text-xs text-blue-700 bg-blue-50 border border-blue-200 px-3 py-1.5 rounded-lg">
              {triggerMsg}
            </span>
          )}
          <button onClick={triggerCheck} disabled={triggering}
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition disabled:opacity-50">
            {triggering ? '체크 중...' : '수동 SLA 체크'}
          </button>
          <button onClick={load} disabled={loading}
            className="px-3 py-2 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
            새로고침
          </button>
        </div>
      </div>

      {/* Summary cards */}
      {data && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[
            { label: '전체 알림', value: data.summary.total, color: 'text-gray-900', bg: 'bg-white' },
            { label: '연체', value: data.summary.overdue, color: 'text-red-700', bg: 'bg-red-50' },
            { label: '경고 (3일 이내)', value: data.summary.warning, color: 'text-amber-700', bg: 'bg-amber-50' },
          ].map(c => (
            <div key={c.label} className={`${c.bg} rounded-xl border p-5 text-center shadow-sm`}>
              <div className="text-xs text-gray-400 mb-1">{c.label}</div>
              <div className={`text-3xl font-black ${c.color}`}>{c.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <div className="flex gap-1 p-1 bg-gray-100 rounded-xl">
          {(['all', 'overdue', 'warning'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                filter === f ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}>
              {f === 'all' ? '전체' : f === 'overdue' ? '연체' : '경고'}
            </button>
          ))}
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="마일스톤 또는 계약 ID 검색..."
          className="flex-1 min-w-[200px] px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400" />
      </div>

      {/* Alert list */}
      {loading ? (
        <div className="text-center py-16 text-gray-400">불러오는 중...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-4xl mb-3">✅</div>
          <p className="text-gray-500 text-sm">
            {data?.summary.total === 0 ? '모든 마일스톤이 정상입니다.' : '검색 결과가 없습니다.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((alert, i) => (
            <div key={`${alert.contractId}-${alert.milestoneId}-${i}`}
              className={`bg-white rounded-xl border shadow-sm p-5 ${
                alert.status === 'overdue' ? 'border-red-200' : 'border-yellow-200'
              }`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                      alert.status === 'overdue'
                        ? 'bg-red-100 text-red-700'
                        : 'bg-yellow-100 text-yellow-700'
                    }`}>
                      {alert.status === 'overdue' ? '연체' : '경고'}
                    </span>
                    <span className="text-sm font-bold text-gray-900 truncate">{alert.title}</span>
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs text-gray-500 mt-1">
                    <span>계약: <code className="font-mono text-gray-700 bg-gray-100 px-1 rounded">{alert.contractId}</code></span>
                    <span>기한: <strong className={alert.status === 'overdue' ? 'text-red-600' : 'text-amber-600'}>{alert.dueDate}</strong></span>
                  </div>
                </div>
                <div className="shrink-0 flex flex-col items-end gap-2">
                  <DaysBadge days={alert.daysUntilDue} />
                  <a href={`/admin/contracts?id=${alert.contractId}`}
                    className="text-xs text-blue-600 hover:underline">계약 보기 →</a>
                </div>
              </div>

              {/* Timeline bar */}
              <div className="mt-3">
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${
                    alert.status === 'overdue' ? 'bg-red-500 w-full'
                    : alert.daysUntilDue <= 1 ? 'bg-orange-500 w-5/6'
                    : 'bg-yellow-400 w-3/4'
                  }`} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
