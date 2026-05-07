'use client';

import { useState, useEffect, useCallback } from 'react';

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  contractId?: string;
  createdAt: string;
  read: boolean;
}

const TYPE_ICON: Record<string, string> = {
  contract_status: '📋',
  completion_request: '✅',
  progress_update: '📊',
  quote_received: '💰',
  partner_approved: '🎉',
  partner_rejected: '❌',
  new_message: '💬',
  sla_warning: '⏰',
  sla_overdue: '🚨',
  milestone_due: '🏁',
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return '방금 전';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

export default function PartnerNotificationBell({ session }: { session: string }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const fetchNotifications = useCallback(async () => {
    if (!session) return;
    try {
      const res = await fetch('/api/partner/notifications', {
        headers: { Authorization: `Bearer ${session}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setNotifications(data.notifications ?? []);
    } catch { /* silent */ }
  }, [session]);

  useEffect(() => { fetchNotifications(); }, [fetchNotifications]);

  useEffect(() => {
    const id = setInterval(fetchNotifications, 30_000);
    return () => clearInterval(id);
  }, [fetchNotifications]);

  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  const unread = notifications.filter(n => !n.read).length;

  async function markRead(id: string) {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    fetch('/api/partner/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session}` },
      body: JSON.stringify({ id }),
    }).catch(() => {});
  }

  async function markAllRead() {
    setLoading(true);
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    await fetch('/api/partner/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session}` },
      body: JSON.stringify({ all: true }),
    }).catch(() => {});
    setLoading(false);
  }

  async function clearAll() {
    setLoading(true);
    setNotifications([]);
    await fetch('/api/partner/notifications', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${session}` },
    }).catch(() => {});
    setLoading(false);
  }

  async function deleteOne(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    setNotifications(prev => prev.filter(n => n.id !== id));
    fetch('/api/partner/notifications', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session}` },
      body: JSON.stringify({ id }),
    }).catch(() => {});
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="relative w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
      >
        <span className="text-base relative">
          🔔
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center leading-none">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </span>
        <span>알림</span>
        {unread > 0 && (
          <span className="ml-auto text-xs font-bold text-red-500">{unread}</span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} />
          <div
            className="relative w-full max-w-sm bg-white h-full shadow-2xl flex flex-col"
            style={{ animation: 'slideInRight 0.2s ease-out' }}
          >
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <span className="font-black text-gray-900">알림</span>
                {unread > 0 && (
                  <span className="px-2 py-0.5 bg-red-500 text-white text-xs font-bold rounded-full">{unread}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {unread > 0 && (
                  <button onClick={markAllRead} disabled={loading} className="text-xs text-blue-600 hover:underline font-semibold disabled:opacity-50">
                    모두 읽음
                  </button>
                )}
                {notifications.length > 0 && (
                  <button onClick={clearAll} disabled={loading} className="text-xs text-gray-400 hover:text-red-500 hover:underline disabled:opacity-50">
                    모두 삭제
                  </button>
                )}
                <button onClick={() => setOpen(false)} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 text-lg leading-none">✕</button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto py-2">
              {notifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center px-6 py-16">
                  <div className="text-5xl mb-4">🔔</div>
                  <p className="text-sm font-semibold text-gray-500">알림이 없습니다</p>
                  <p className="text-xs text-gray-400 mt-1">새 알림이 오면 여기에 표시됩니다</p>
                </div>
              ) : (
                notifications.map(n => (
                  <div
                    key={n.id}
                    onClick={() => { markRead(n.id); setOpen(false); }}
                    className={`relative group px-5 py-3.5 border-b border-gray-50 hover:bg-gray-50 transition flex items-start gap-3 cursor-pointer ${!n.read ? 'bg-blue-50/40' : ''}`}
                  >
                    <div className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-lg ${!n.read ? 'bg-blue-100' : 'bg-gray-100'}`}>
                      {TYPE_ICON[n.type] || '🔔'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className={`text-sm font-semibold truncate ${!n.read ? 'text-gray-900' : 'text-gray-700'}`}>{n.title}</p>
                        {!n.read && <span className="shrink-0 w-2 h-2 bg-blue-500 rounded-full mt-1.5" />}
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{n.message}</p>
                      <p className="text-[10px] text-gray-400 mt-1.5">{timeAgo(n.createdAt)}</p>
                    </div>
                    <button
                      onClick={(e) => deleteOne(n.id, e)}
                      className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1 rounded text-gray-300 hover:text-red-400 hover:bg-red-50 transition-all text-xs"
                      title="삭제"
                    >
                      ✕
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="px-5 py-3 border-t border-gray-100 shrink-0">
              <button onClick={() => { setOpen(false); fetchNotifications(); }} className="w-full py-2 text-xs font-semibold text-gray-500 hover:bg-gray-50 rounded-lg transition">
                새로고침
              </button>
            </div>
          </div>
        </div>
      )}

    </>
  );
}
