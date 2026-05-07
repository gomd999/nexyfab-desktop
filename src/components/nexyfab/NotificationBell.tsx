'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { isKorean } from '@/lib/i18n/normalize';

interface NotificationBellProps {
  token: string | null;
  lang: string;
}

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read: number;
  created_at: number;
}

const TYPE_ICON: Record<string, string> = {
  'team.invite_accepted': '🎉',
  'team.member_joined':   '👋',
  'rfq.quoted':           '💬',
  'rfq.accepted':         '✅',
  'contract.completed':   '📄',
  'payment.success':      '💳',
  'payment.failed':       '⚠️',
};

function getIcon(type: string): string {
  return TYPE_ICON[type] ?? '🔔';
}

function timeAgo(ts: number, isKo: boolean): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return isKo ? '방금 전' : 'just now';
  if (m < 60) return isKo ? `${m}분 전` : `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return isKo ? `${h}시간 전` : `${h}h ago`;
  return isKo ? `${Math.floor(h / 24)}일 전` : `${Math.floor(h / 24)}d ago`;
}

export default function NotificationBell({ token, lang }: NotificationBellProps) {
  const isKo = isKorean(lang);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);

  // Initial + periodic fetch (fallback / initial load)
  const fetchNotifications = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/nexyfab/notifications', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      if (!res.ok) return;
      const data = await res.json();
      setNotifications(data.notifications ?? []);
      setUnreadCount(data.unreadCount ?? 0);
    } catch { /* silent */ }
  }, [token]);

  // SSE subscription for real-time push
  useEffect(() => {
    if (!token) return;

    // Initial fetch to populate existing notifications
    fetchNotifications();

    const connect = () => {
      if (esRef.current) esRef.current.close();

      const es = new EventSource('/api/notifications/stream');
      esRef.current = es;

      es.addEventListener('notification', (e) => {
        try {
          const n = JSON.parse(e.data) as Notification & { createdAt: string };
          const notif: Notification = {
            ...n,
            created_at: new Date(n.createdAt).getTime(),
            read: typeof n.read === 'boolean' ? (n.read ? 1 : 0) : n.read,
          };
          setNotifications(prev => {
            if (prev.some(p => p.id === notif.id)) return prev;
            return [notif, ...prev].slice(0, 50);
          });
          if (!notif.read) setUnreadCount(c => c + 1);
        } catch { /* malformed */ }
      });

      // On error, close and retry after 15s
      es.onerror = () => {
        es.close();
        esRef.current = null;
        setTimeout(connect, 15000);
      };
    };

    connect();

    return () => {
      esRef.current?.close();
      esRef.current = null;
    };
  }, [token, fetchNotifications]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const markRead = async (id: string) => {
    if (!token) return;
    await fetch('/api/nexyfab/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id }),
    }).catch(() => {});
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: 1 } : n));
    setUnreadCount(prev => Math.max(0, prev - 1));
  };

  const markAllRead = async () => {
    if (!token) return;
    await fetch('/api/nexyfab/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ all: true }),
    }).catch(() => {});
    setNotifications(prev => prev.map(n => ({ ...n, read: 1 })));
    setUnreadCount(0);
  };

  const clearRead = async () => {
    if (!token) return;
    await fetch('/api/nexyfab/notifications', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
    setNotifications(prev => prev.filter(n => n.read === 0));
  };

  const handleNotificationClick = async (n: Notification) => {
    if (n.read === 0) await markRead(n.id);
    if (n.link) {
      router.push(`/${lang}${n.link}`);
      setOpen(false);
    }
  };

  return (
    <div ref={dropdownRef} style={{ position: 'relative', borderTop: '1px solid #21262d', padding: '8px 12px' }}>
      {/* Bell button */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '6px 8px',
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          color: '#6e7681',
          fontSize: 13,
          position: 'relative',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = '#161b22'; e.currentTarget.style.color = '#c9d1d9'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = '#6e7681'; }}
      >
        <span style={{ fontSize: 16, position: 'relative', flexShrink: 0 }}>
          🔔
          {unreadCount > 0 && (
            <span style={{
              position: 'absolute',
              top: -4,
              right: -4,
              background: '#da3633',
              color: '#fff',
              borderRadius: '50%',
              fontSize: 9,
              fontWeight: 800,
              minWidth: 14,
              height: 14,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 3px',
              boxSizing: 'border-box',
              lineHeight: 1,
            }}>
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </span>
        <span className="nf-nav-label" style={{ fontSize: 13 }}>{isKo ? '알림' : 'Alerts'}</span>
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: 'absolute',
          bottom: '100%',
          left: 8,
          width: 320,
          background: '#161b22',
          border: '1px solid #30363d',
          borderRadius: 10,
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          zIndex: 9999,
          overflow: 'hidden',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}>
          {/* Header */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 14px',
            borderBottom: '1px solid #30363d',
          }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#e6edf3' }}>
              {isKo ? '알림' : 'Notifications'}
            </span>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 11,
                  color: '#388bfd',
                  fontWeight: 600,
                  padding: 0,
                }}
              >
                {isKo ? '모두 읽음' : 'Mark all read'}
              </button>
            )}
          </div>

          {/* List */}
          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            {notifications.length === 0 ? (
              <div style={{
                padding: '24px 14px',
                textAlign: 'center',
                color: '#6e7681',
                fontSize: 13,
              }}>
                {isKo ? '새 알림이 없습니다' : 'No new notifications'}
              </div>
            ) : (
              notifications.map(n => (
                <div
                  key={n.id}
                  onClick={() => handleNotificationClick(n)}
                  style={{
                    display: 'flex',
                    gap: 10,
                    padding: '10px 14px',
                    borderBottom: '1px solid #21262d',
                    cursor: n.link ? 'pointer' : 'default',
                    background: n.read === 0 ? '#1c2128' : 'transparent',
                    transition: 'background 0.12s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#21262d'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = n.read === 0 ? '#1c2128' : 'transparent'; }}
                >
                  <span style={{ fontSize: 18, flexShrink: 0, lineHeight: 1.4 }}>{getIcon(n.type)}</span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <p style={{
                      margin: 0,
                      fontSize: 13,
                      fontWeight: n.read === 0 ? 600 : 400,
                      color: '#e6edf3',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {n.title}
                    </p>
                    {n.body && (
                      <p style={{
                        margin: '2px 0 0',
                        fontSize: 12,
                        color: '#8b949e',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {n.body}
                      </p>
                    )}
                    <span style={{ fontSize: 11, color: '#6e7681' }}>{timeAgo(n.created_at, isKo)}</span>
                  </div>
                  {n.read === 0 && (
                    <span style={{
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      background: '#388bfd',
                      flexShrink: 0,
                      marginTop: 6,
                    }} />
                  )}
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div style={{ padding: '8px 14px', borderTop: '1px solid #21262d' }}>
            <button
              onClick={clearRead}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: 12,
                color: '#6e7681',
                padding: 0,
                width: '100%',
                textAlign: 'left',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = '#c9d1d9'; }}
              onMouseLeave={e => { e.currentTarget.style.color = '#6e7681'; }}
            >
              {isKo ? '읽은 알림 지우기' : 'Clear read notifications'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
