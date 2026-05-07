'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  contractId?: string;
  quoteId?: string;
  createdAt: string;
  read: boolean;
}

interface NotificationBellProps {
  recipient: string;
}

const TYPE_ICON: Record<string, string> = {
  contract_status: '📋',
  completion_request: '✅',
  progress_update: '📊',
  quote_received: '💰',
  partner_approved: '🎉',
  partner_rejected: '❌',
  new_message: '💬',
  sla_overdue: '🚨',
  sla_warning: '⏰',
};

function getNotificationLink(n: Notification, recipient: string): string {
  const isAdmin = recipient === 'admin';
  if (n.contractId) return isAdmin ? '/admin/contracts' : '/partner/projects';
  if (n.quoteId) return isAdmin ? '/admin/quotes' : '/partner/quotes';
  if (n.type === 'partner_approved' || n.type === 'partner_rejected') return '/partner/dashboard';
  return isAdmin ? '/admin' : '/partner/dashboard';
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return '방금 전';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}일 전`;
  return new Date(iso).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
}

function groupByDate(notifications: Notification[]): { label: string; items: Notification[] }[] {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const weekAgo = new Date(today); weekAgo.setDate(today.getDate() - 7);

  const groups: Record<string, Notification[]> = { '오늘': [], '어제': [], '이번 주': [], '이전': [] };

  for (const n of notifications) {
    const d = new Date(n.createdAt); d.setHours(0, 0, 0, 0);
    if (d >= today) groups['오늘'].push(n);
    else if (d >= yesterday) groups['어제'].push(n);
    else if (d >= weekAgo) groups['이번 주'].push(n);
    else groups['이전'].push(n);
  }

  return Object.entries(groups)
    .filter(([, items]) => items.length > 0)
    .map(([label, items]) => ({ label, items }));
}

export default function NotificationBell({ recipient }: NotificationBellProps) {
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [loading, setLoading] = useState(false);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch(`/api/notifications?recipient=${encodeURIComponent(recipient)}`);
      if (!res.ok) return;
      const data = await res.json();
      setNotifications(data.notifications || []);
    } catch { /* silent */ }
  }, [recipient]);

  useEffect(() => { fetchNotifications(); }, [fetchNotifications]);

  // 30초 폴링
  useEffect(() => {
    const id = setInterval(fetchNotifications, 30_000);
    return () => clearInterval(id);
  }, [fetchNotifications]);

  // body scroll lock when panel open
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  const unreadCount = notifications.filter(n => !n.read).length;

  async function markRead(id: string) {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    try {
      await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient, id }),
      });
    } catch { /* silent */ }
  }

  async function markAllRead() {
    setLoading(true);
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    try {
      await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient, all: true }),
      });
    } catch { /* silent */ } finally { setLoading(false); }
  }

  async function clearAll() {
    setLoading(true);
    setNotifications([]);
    try {
      await fetch('/api/notifications', { method: 'DELETE' });
    } catch { /* silent */ } finally { setLoading(false); }
  }

  async function deleteOne(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    setNotifications(prev => prev.filter(n => n.id !== id));
    try {
      await fetch('/api/notifications', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
    } catch { /* silent */ }
  }

  async function handleClick(n: Notification) {
    if (!n.read) await markRead(n.id);
    setOpen(false);
    router.push(getNotificationLink(n, recipient));
  }

  const visible = filter === 'unread' ? notifications.filter(n => !n.read) : notifications;
  const groups = groupByDate(visible);

  return (
    <>
      {/* Bell Button */}
      <button
        onClick={() => setOpen(true)}
        className="relative p-2 rounded-lg text-gray-500 hover:bg-gray-100 transition"
        aria-label="알림"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Overlay + Slide-over Panel */}
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/30 backdrop-blur-[1px]"
            onClick={() => setOpen(false)}
          />

          {/* Panel */}
          <div
            className="relative w-full max-w-sm bg-white h-full shadow-2xl flex flex-col"
            style={{ animation: 'slideInRight 0.22s cubic-bezier(0.4,0,0.2,1)' }}
          >
            {/* Header */}
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-base font-black text-gray-900">알림</span>
                {unreadCount > 0 && (
                  <span className="px-2 py-0.5 bg-red-500 text-white text-xs font-bold rounded-full leading-none">
                    {unreadCount}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button
                    onClick={markAllRead}
                    disabled={loading}
                    className="text-xs text-blue-600 hover:underline font-semibold disabled:opacity-50"
                  >
                    모두 읽음
                  </button>
                )}
                {notifications.length > 0 && (
                  <button
                    onClick={clearAll}
                    disabled={loading}
                    className="text-xs text-gray-400 hover:text-red-500 hover:underline disabled:opacity-50"
                    title="모두 삭제"
                  >
                    모두 삭제
                  </button>
                )}
                <button
                  onClick={() => setOpen(false)}
                  className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Filter tabs */}
            <div className="px-5 pt-3 pb-0 flex gap-1 shrink-0">
              {(['all', 'unread'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${filter === f ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-100'}`}
                >
                  {f === 'all' ? '전체' : `읽지 않음 ${unreadCount > 0 ? `(${unreadCount})` : ''}`}
                </button>
              ))}
            </div>

            {/* Notification List */}
            <div className="flex-1 overflow-y-auto py-2">
              {groups.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center px-6 py-16">
                  <div className="text-5xl mb-4">🔔</div>
                  <p className="text-sm font-semibold text-gray-500">
                    {filter === 'unread' ? '읽지 않은 알림이 없습니다' : '알림이 없습니다'}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">새 알림이 오면 여기에 표시됩니다</p>
                </div>
              ) : (
                groups.map(({ label, items }) => (
                  <div key={label}>
                    <div className="px-5 py-2 text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                      {label}
                    </div>
                    {items.map(n => (
                      <div
                        key={n.id}
                        className={`relative group border-b border-gray-50 hover:bg-gray-50 transition flex items-start gap-3 px-5 py-3.5 cursor-pointer ${!n.read ? 'bg-blue-50/40' : ''}`}
                        onClick={() => handleClick(n)}
                      >
                        {/* Icon */}
                        <div className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-lg ${!n.read ? 'bg-blue-100' : 'bg-gray-100'}`}>
                          {TYPE_ICON[n.type] || '🔔'}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <p className={`text-sm font-semibold truncate ${!n.read ? 'text-gray-900' : 'text-gray-700'}`}>
                              {n.title}
                            </p>
                            {!n.read && (
                              <span className="shrink-0 w-2 h-2 bg-blue-500 rounded-full mt-1.5" />
                            )}
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5 line-clamp-2 leading-relaxed">{n.message}</p>
                          <p className="text-[10px] text-gray-400 mt-1.5 font-medium">{timeAgo(n.createdAt)}</p>
                        </div>

                        {/* Delete button */}
                        <button
                          onClick={(e) => deleteOne(n.id, e)}
                          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1 rounded text-gray-300 hover:text-red-400 hover:bg-red-50 transition-all text-xs leading-none"
                          title="삭제"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-gray-100 shrink-0">
              <button
                onClick={() => { setOpen(false); fetchNotifications(); }}
                className="w-full py-2 text-xs font-semibold text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-lg transition"
              >
                새로고침
              </button>
            </div>
          </div>
        </div>
      )}

    </>
  );
}
