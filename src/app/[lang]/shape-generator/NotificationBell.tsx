'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read: number;
  created_at: number;
}

// ─── Time Ago Helper ──────────────────────────────────────────────────────────

function timeAgo(ts: number, isKo: boolean): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return isKo ? `${diff}초 전` : `${diff}s ago`;
  if (diff < 3600) {
    const m = Math.floor(diff / 60);
    return isKo ? `${m}분 전` : `${m}m ago`;
  }
  if (diff < 86400) {
    const h = Math.floor(diff / 3600);
    return isKo ? `${h}시간 전` : `${h}h ago`;
  }
  const d = Math.floor(diff / 86400);
  return isKo ? `${d}일 전` : `${d}d ago`;
}

// ─── Type Icon ────────────────────────────────────────────────────────────────

function typeIcon(type: string): string {
  switch (type) {
    case 'order': return '📦';
    case 'share': return '🔗';
    case 'system': return '⚙️';
    default: return '🔔';
  }
}

// ─── Notification Bell ────────────────────────────────────────────────────────

export default function NotificationBell({ lang }: { lang: string }) {
  const isKo = lang === 'ko';

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch Notifications ─────────────────────────────────────────────────────
  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/nexyfab/notifications');
      if (!r.ok) return;
      const data = await r.json() as { notifications: Notification[]; unreadCount: number };
      setNotifications(data.notifications ?? []);
      setUnreadCount(data.unreadCount ?? 0);
    } catch {
      // silently ignore
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Mark All Read ───────────────────────────────────────────────────────────
  const markAllRead = useCallback(async () => {
    try {
      await fetch('/api/nexyfab/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });
      setNotifications(prev => prev.map(n => ({ ...n, read: 1 })));
      setUnreadCount(0);
    } catch {
      // ignore
    }
  }, []);

  // ── Clear All ───────────────────────────────────────────────────────────────
  const clearAll = useCallback(async () => {
    try {
      await fetch('/api/nexyfab/notifications', { method: 'DELETE' });
      setNotifications([]);
      setUnreadCount(0);
    } catch {
      // ignore
    }
  }, []);

  // ── Bell click ──────────────────────────────────────────────────────────────
  const handleBellClick = useCallback(() => {
    setOpen(prev => {
      const next = !prev;
      if (next && unreadCount > 0) {
        markAllRead();
      }
      return next;
    });
  }, [unreadCount, markAllRead]);

  // ── Polling ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    fetchNotifications();
    intervalRef.current = setInterval(fetchNotifications, 60_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchNotifications]);

  // ── Click Outside ───────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div ref={wrapperRef} style={{ position: 'relative', display: 'inline-block' }}>
      {/* Bell Button */}
      <button
        onClick={handleBellClick}
        title={isKo ? '알림' : 'Notifications'}
        style={{
          position: 'relative',
          width: 36, height: 36,
          border: '1px solid #30363d',
          borderRadius: 8,
          background: open ? '#21262d' : 'transparent',
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16,
          transition: 'background 0.15s',
        }}
      >
        🔔
        {/* Unread badge */}
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute',
            top: -4, right: -4,
            minWidth: 17, height: 17,
            borderRadius: 9,
            background: '#da3633',
            color: '#fff',
            fontSize: 10,
            fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '2px solid #0d1117',
            paddingInline: 3,
            lineHeight: 1,
          }}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: 'absolute',
          top: 40, right: 0,
          width: 320,
          zIndex: 9999,
          background: '#161b22',
          border: '1px solid #30363d',
          borderRadius: 12,
          boxShadow: '0 8px 32px #0009',
          overflow: 'hidden',
        }}>
          {/* Header */}
          <div style={{
            padding: '12px 16px',
            borderBottom: '1px solid #21262d',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#e6edf3' }}>
              {isKo ? '알림' : 'Notifications'}
              {loading && (
                <span style={{ marginLeft: 8, fontSize: 10, color: '#8b949e' }}>
                  {isKo ? '새로고침 중...' : 'Refreshing...'}
                </span>
              )}
            </span>
            <button
              onClick={clearAll}
              style={{
                fontSize: 11, color: '#8b949e', background: 'none',
                border: 'none', cursor: 'pointer', padding: '2px 6px',
                borderRadius: 4,
              }}
              title={isKo ? '모두 지우기' : 'Clear all'}
            >
              {isKo ? '모두 지우기' : 'Clear all'}
            </button>
          </div>

          {/* Notification list */}
          <div style={{ maxHeight: 380, overflowY: 'auto' }}>
            {notifications.length === 0 ? (
              <div style={{
                padding: '32px 16px', textAlign: 'center',
                color: '#8b949e', fontSize: 13,
              }}>
                {isKo ? '알림 없음' : 'No notifications'}
              </div>
            ) : (
              notifications.map(n => (
                <NotificationItem key={n.id} notification={n} isKo={isKo} />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Notification Item ────────────────────────────────────────────────────────

function NotificationItem({ notification: n, isKo }: { notification: Notification; isKo: boolean }) {
  const unread = n.read === 0;

  const inner = (
    <div style={{
      padding: '12px 16px',
      borderBottom: '1px solid #21262d',
      display: 'flex', gap: 10,
      background: unread ? '#161b2299' : 'transparent',
      borderLeft: unread ? '3px solid #388bfd' : '3px solid transparent',
      transition: 'background 0.15s',
      cursor: n.link ? 'pointer' : 'default',
    }}>
      {/* Icon */}
      <span style={{ fontSize: 18, flexShrink: 0, lineHeight: 1.4 }}>
        {typeIcon(n.type)}
      </span>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: unread ? 700 : 500,
          color: '#e6edf3', lineHeight: 1.4,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {n.title}
        </div>
        {n.body && (
          <div style={{
            fontSize: 11, color: '#8b949e', marginTop: 2, lineHeight: 1.4,
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical' as React.CSSProperties['WebkitBoxOrient'],
          }}>
            {n.body}
          </div>
        )}
        <div style={{ fontSize: 10, color: '#6e7681', marginTop: 4 }}>
          {timeAgo(n.created_at, isKo)}
        </div>
      </div>
    </div>
  );

  if (n.link) {
    return (
      <a href={n.link} style={{ textDecoration: 'none', display: 'block' }}>
        {inner}
      </a>
    );
  }
  return inner;
}
