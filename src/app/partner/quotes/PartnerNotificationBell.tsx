'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  read: number;
  created_at: number;
}

const TYPE_ICON: Record<string, string> = {
  new_rfq: '📋',
  quote_accepted: '✅',
  order_update: '📦',
  payment: '💳',
};

function timeAgo(ts: number): string {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return '방금 전';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

export default function PartnerNotificationBell({ session }: { session: string }) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  const fetch_ = useCallback(async () => {
    if (!session || session === 'demo') return;
    try {
      const res = await fetch('/api/partner/notifications', {
        headers: { Authorization: `Bearer ${session}` },
      });
      if (res.ok) {
        const d = await res.json() as { notifications?: Notification[] };
        setNotifications(d.notifications ?? []);
      }
    } catch { /* ignore */ }
  }, [session]);

  useEffect(() => { fetch_(); }, [fetch_]);

  // Poll every 30s
  useEffect(() => {
    const t = setInterval(fetch_, 30000);
    return () => clearInterval(t);
  }, [fetch_]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const unread = notifications.filter(n => n.read === 0).length;

  const markAllRead = async () => {
    await fetch('/api/partner/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session}` },
      body: JSON.stringify({ all: true }),
    }).catch(() => {});
    setNotifications(prev => prev.map(n => ({ ...n, read: 1 })));
  };

  const markOne = async (id: string) => {
    await fetch('/api/partner/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session}` },
      body: JSON.stringify({ id }),
    }).catch(() => {});
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: 1 } : n));
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          position: 'relative', background: 'none', border: 'none',
          cursor: 'pointer', padding: '6px 10px', borderRadius: 8,
          fontSize: 18, lineHeight: 1, color: '#6b7280',
        }}
        title="알림"
      >
        🔔
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: 2, right: 4,
            background: '#dc2626', color: '#fff', borderRadius: '50%',
            fontSize: 9, fontWeight: 800,
            minWidth: 14, height: 14,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '0 3px', boxSizing: 'border-box',
          }}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', right: 0, top: '110%', zIndex: 9999,
          width: 300, background: '#fff', borderRadius: 12,
          border: '1px solid #e5e7eb', boxShadow: '0 8px 24px #0000001a',
          overflow: 'hidden', fontFamily: 'system-ui, sans-serif',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid #f3f4f6' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#111' }}>알림</span>
            {unread > 0 && (
              <button onClick={markAllRead} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#2563eb', fontWeight: 600 }}>
                모두 읽음
              </button>
            )}
          </div>

          <div style={{ maxHeight: 300, overflowY: 'auto' }}>
            {notifications.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
                새 알림이 없습니다
              </div>
            ) : notifications.map(n => (
              <div
                key={n.id}
                onClick={() => markOne(n.id)}
                style={{
                  display: 'flex', gap: 10, padding: '10px 14px',
                  borderBottom: '1px solid #f3f4f6',
                  background: n.read === 0 ? '#eff6ff' : '#fff',
                  cursor: 'pointer', transition: 'background 0.1s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = '#f9fafb'; }}
                onMouseLeave={e => { e.currentTarget.style.background = n.read === 0 ? '#eff6ff' : '#fff'; }}
              >
                <span style={{ fontSize: 16, flexShrink: 0 }}>{TYPE_ICON[n.type] ?? '🔔'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: n.read === 0 ? 700 : 400, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {n.title}
                  </p>
                  {n.body && (
                    <p style={{ margin: '2px 0 0', fontSize: 11, color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {n.body}
                    </p>
                  )}
                  <span style={{ fontSize: 10, color: '#9ca3af' }}>{timeAgo(n.created_at)}</span>
                </div>
                {n.read === 0 && (
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#2563eb', flexShrink: 0, marginTop: 6 }} />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
