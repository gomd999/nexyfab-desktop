'use client';

import { useState, useEffect, useCallback } from 'react';
import { formatDateTime } from '@/lib/formatDate';

interface WebhookEvent {
  id: string;
  eventId: string;
  type: string;
  processedAt: number;
  hasPayload: boolean;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

type ToastState = { message: string; ok: boolean } | null;

function EventTypeBadge({ type }: { type: string }) {
  let cls = 'bg-gray-100 text-gray-600';
  if (type.includes('payment_intent.succeeded') || type.includes('invoice.paid')) cls = 'bg-green-100 text-green-700';
  else if (type.includes('failed') || type.includes('cancelled')) cls = 'bg-red-100 text-red-700';
  else if (type.includes('subscription')) cls = 'bg-blue-100 text-blue-700';
  else if (type.includes('invoice')) cls = 'bg-purple-100 text-purple-700';
  return <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap ${cls}`}>{type}</span>;
}

export default function WebhooksAdminPage() {
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [eventTypes, setEventTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filterType, setFilterType] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const [reprocessingId, setReprocessingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);

  const showToast = (message: string, ok: boolean) => {
    setToast({ message, ok });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '50' });
      if (filterType) params.set('type', filterType);
      if (search) params.set('q', search);
      const res = await fetch(`/api/admin/webhooks?${params}`);
      if (!res.ok) { setError('이벤트를 불러오는 데 실패했습니다.'); return; }
      const data = await res.json();
      setEvents(data.events ?? []);
      setPagination(data.pagination ?? null);
      if (data.types?.length > 0) setEventTypes(data.types);
    } catch {
      setError('네트워크 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }, [page, filterType, search]);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  async function handleReprocess(eventId: string) {
    setReprocessingId(eventId);
    try {
      const res = await fetch('/api/admin/webhooks/reprocess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        showToast(`재처리 완료 — ${data.eventType}`, true);
        fetchEvents();
      } else {
        showToast(data.error || '재처리에 실패했습니다.', false);
      }
    } catch {
      showToast('네트워크 오류가 발생했습니다.', false);
    } finally {
      setReprocessingId(null);
    }
  }

  async function handleDelete(eventId: string) {
    if (!confirm(`이벤트 ${eventId}를 삭제하시겠습니까?`)) return;
    setDeletingId(eventId);
    try {
      const res = await fetch(`/api/admin/webhooks?id=${encodeURIComponent(eventId)}`, { method: 'DELETE' });
      if (res.ok) {
        showToast('삭제되었습니다.', true);
        fetchEvents();
      } else {
        const data = await res.json();
        showToast(data.error || '삭제에 실패했습니다.', false);
      }
    } catch {
      showToast('네트워크 오류가 발생했습니다.', false);
    } finally {
      setDeletingId(null);
    }
  }

  const typeStats = events.reduce<Record<string, number>>((acc, e) => {
    acc[e.type] = (acc[e.type] || 0) + 1;
    return acc;
  }, {});

  const succeededCount = events.filter(e => e.type.includes('succeeded') || e.type.includes('paid')).length;
  const failedCount = events.filter(e => e.type.includes('failed') || e.type.includes('cancelled')).length;

  return (
    <div className="p-6 space-y-6">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-5 right-5 z-50 px-5 py-3 rounded-xl shadow-lg text-sm font-semibold ${
          toast.ok ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
        }`}>
          {toast.message}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">웹훅 이벤트</h1>
          <p className="text-sm text-gray-500 mt-0.5">Airwallex 결제 웹훅 수신 내역</p>
        </div>
        <button
          onClick={() => fetchEvents()}
          className="px-4 py-2 text-sm font-semibold border border-gray-200 rounded-lg hover:bg-gray-50 transition"
        >
          새로고침
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-2xl font-bold text-blue-600">{pagination?.total ?? events.length}</div>
          <div className="text-xs text-gray-500 mt-1">총 이벤트</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-2xl font-bold text-green-600">{succeededCount}</div>
          <div className="text-xs text-gray-500 mt-1">성공 (현재 페이지)</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-2xl font-bold text-red-600">{failedCount}</div>
          <div className="text-xs text-gray-500 mt-1">실패/취소 (현재 페이지)</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-2xl font-bold text-gray-700">{Object.keys(typeStats).length}</div>
          <div className="text-xs text-gray-500 mt-1">이벤트 유형</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          value={filterType}
          onChange={e => { setFilterType(e.target.value); setPage(1); }}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none"
        >
          <option value="">모든 이벤트 유형</option>
          {eventTypes.map(t => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="이벤트 ID / 타입 검색..."
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg flex-1 min-w-[200px] focus:ring-2 focus:ring-blue-500 outline-none"
        />
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        {loading ? (
          <div className="text-center py-16 text-gray-400 text-sm">불러오는 중...</div>
        ) : error ? (
          <div className="text-center py-16 text-red-400 text-sm">{error}</div>
        ) : events.length === 0 ? (
          <div className="text-center py-16 text-gray-400 text-sm">이벤트가 없습니다.</div>
        ) : (
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 text-xs font-bold text-gray-500">이벤트 유형</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-gray-500">처리 일시</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-gray-500">이벤트 ID</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-gray-500">페이로드</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-gray-500">작업</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event, i) => (
                <tr key={event.id} className={i < events.length - 1 ? 'border-b border-gray-50' : ''}>
                  <td className="px-4 py-3">
                    <EventTypeBadge type={event.type} />
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                    {formatDateTime(event.processedAt)}
                  </td>
                  <td className="px-4 py-3 font-mono text-[11px] text-gray-400 max-w-[200px] truncate" title={event.eventId}>
                    {event.eventId}
                  </td>
                  <td className="px-4 py-3">
                    {event.hasPayload ? (
                      <span className="text-xs text-green-600 font-semibold">있음</span>
                    ) : (
                      <span className="text-xs text-gray-400">없음</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleReprocess(event.eventId)}
                        disabled={reprocessingId === event.eventId || !event.hasPayload}
                        title={!event.hasPayload ? '페이로드가 없어 재처리 불가' : '이벤트 재처리'}
                        className="px-3 py-1 text-[11px] font-bold text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 transition disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {reprocessingId === event.eventId ? '처리중...' : '재처리'}
                      </button>
                      <button
                        onClick={() => handleDelete(event.eventId)}
                        disabled={deletingId === event.eventId}
                        className="px-3 py-1 text-[11px] font-bold text-red-500 border border-red-200 rounded-lg hover:bg-red-50 transition disabled:opacity-40"
                      >
                        {deletingId === event.eventId ? '삭제중...' : '삭제'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500">
            총 {pagination.total}개 중 {(pagination.page - 1) * pagination.limit + 1}–
            {Math.min(pagination.page * pagination.limit, pagination.total)}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40"
            >
              이전
            </button>
            <span className="px-3 py-1.5 text-sm text-gray-600">{page} / {pagination.totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))}
              disabled={page === pagination.totalPages}
              className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40"
            >
              다음
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
