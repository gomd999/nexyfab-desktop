'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { toIsoLang, type IsoLang } from '@/lib/i18n/normalize';
import { useAuthStore } from '@/hooks/useAuth';

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

type NotificationCopy = {
  alerts: string; notifications: string; markAllRead: string; empty: string; unread: string; clearRead: string;
  unreadCount: (count: number) => string;
  ago: { now: string; minutes: (value: number) => string; hours: (value: number) => string; days: (value: number) => string };
};

const COPY: Record<IsoLang, NotificationCopy> = {
  ko: { alerts: '알림', notifications: '알림', markAllRead: '모두 읽음', empty: '새 알림이 없습니다', unread: '읽지 않음', clearRead: '읽은 알림 지우기', unreadCount: (n) => `알림 ${n}개 읽지 않음`, ago: { now: '방금 전', minutes: (n) => `${n}분 전`, hours: (n) => `${n}시간 전`, days: (n) => `${n}일 전` } },
  en: { alerts: 'Alerts', notifications: 'Notifications', markAllRead: 'Mark all read', empty: 'No new notifications', unread: 'Unread', clearRead: 'Clear read notifications', unreadCount: (n) => `Notifications, ${n} unread`, ago: { now: 'just now', minutes: (n) => `${n}m ago`, hours: (n) => `${n}h ago`, days: (n) => `${n}d ago` } },
  ja: { alerts: '通知', notifications: '通知', markAllRead: 'すべて既読', empty: '新しい通知はありません', unread: '未読', clearRead: '既読通知を削除', unreadCount: (n) => `未読通知 ${n}件`, ago: { now: 'たった今', minutes: (n) => `${n}分前`, hours: (n) => `${n}時間前`, days: (n) => `${n}日前` } },
  zh: { alerts: '通知', notifications: '通知', markAllRead: '全部标为已读', empty: '没有新通知', unread: '未读', clearRead: '清除已读通知', unreadCount: (n) => `${n} 条未读通知`, ago: { now: '刚刚', minutes: (n) => `${n}分钟前`, hours: (n) => `${n}小时前`, days: (n) => `${n}天前` } },
  es: { alerts: 'Avisos', notifications: 'Notificaciones', markAllRead: 'Marcar todo como leído', empty: 'No hay notificaciones nuevas', unread: 'No leído', clearRead: 'Borrar notificaciones leídas', unreadCount: (n) => `${n} notificaciones sin leer`, ago: { now: 'ahora mismo', minutes: (n) => `hace ${n} min`, hours: (n) => `hace ${n} h`, days: (n) => `hace ${n} d` } },
  ar: { alerts: 'التنبيهات', notifications: 'الإشعارات', markAllRead: 'تحديد الكل كمقروء', empty: 'لا توجد إشعارات جديدة', unread: 'غير مقروء', clearRead: 'مسح الإشعارات المقروءة', unreadCount: (n) => `${n} إشعارات غير مقروءة`, ago: { now: 'الآن', minutes: (n) => `قبل ${n} دقيقة`, hours: (n) => `قبل ${n} ساعة`, days: (n) => `قبل ${n} يوم` } },
};

function timeAgo(ts: number, copy: NotificationCopy): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return copy.ago.now;
  if (m < 60) return copy.ago.minutes(m);
  const h = Math.floor(m / 60);
  if (h < 24) return copy.ago.hours(h);
  return copy.ago.days(Math.floor(h / 24));
}

export default function NotificationBell({ token, lang }: NotificationBellProps) {
  const sessionStatus = useAuthStore(state => state.sessionStatus);
  const canLoadNotifications = sessionStatus === 'authenticated' && Boolean(token);
  const copy = COPY[toIsoLang(lang)];
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);

  // Initial + periodic fetch (fallback / initial load)
  const fetchNotifications = useCallback(async () => {
    if (!canLoadNotifications || !token) return;
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
  }, [canLoadNotifications, token]);

  // SSE subscription for real-time push
  useEffect(() => {
    if (!canLoadNotifications || !token) {
      queueMicrotask(() => {
        setNotifications([]);
        setUnreadCount(0);
        setOpen(false);
      });
      return;
    }

    // Initial fetch to populate existing notifications
    queueMicrotask(() => { void fetchNotifications(); });

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
  }, [canLoadNotifications, token, fetchNotifications]);

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
    if (!canLoadNotifications || !token) return;
    await fetch('/api/nexyfab/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id }),
    }).catch(() => {});
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: 1 } : n));
    setUnreadCount(prev => Math.max(0, prev - 1));
  };

  const markAllRead = async () => {
    if (!canLoadNotifications || !token) return;
    await fetch('/api/nexyfab/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ all: true }),
    }).catch(() => {});
    setNotifications(prev => prev.map(n => ({ ...n, read: 1 })));
    setUnreadCount(0);
  };

  const clearRead = async () => {
    if (!canLoadNotifications || !token) return;
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
    <div ref={dropdownRef} style={{ position: 'relative', borderTop: '1px solid var(--nx-panel-2)', padding: '8px 12px' }}>
      {/* Bell button */}
      <button
        onClick={() => setOpen(o => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={
          unreadCount > 0
            ? copy.unreadCount(unreadCount)
            : copy.notifications
        }
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
          color: 'var(--nx-text-3)',
          fontSize: 13,
          position: 'relative',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--nx-panel)'; e.currentTarget.style.color = 'var(--nx-text)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--nx-text-3)'; }}
      >
        <span aria-hidden="true" style={{ fontSize: 16, position: 'relative', flexShrink: 0 }}>
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
        <span className="nf-nav-label" style={{ fontSize: 13 }}>{copy.alerts}</span>
      </button>

      {/* Dropdown */}
      {open && (
        <div
          role="dialog"
          aria-modal="false"
          aria-labelledby="nx-notif-title"
          style={{
            position: 'absolute',
            bottom: '100%',
            left: 8,
            width: 320,
            background: 'var(--nx-panel)',
            border: '1px solid var(--nx-border)',
            borderRadius: 10,
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            zIndex: 9999,
            overflow: 'hidden',
            fontFamily: 'system-ui, -apple-system, sans-serif',
          }}
        >
          {/* Header */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 14px',
            borderBottom: '1px solid var(--nx-border)',
          }}>
            <span id="nx-notif-title" style={{ fontSize: 13, fontWeight: 700, color: 'var(--nx-text)' }}>
              {copy.notifications}
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
                {copy.markAllRead}
              </button>
            )}
          </div>

          {/* List */}
          <div role="list" aria-live="polite" style={{ maxHeight: 320, overflowY: 'auto' }}>
            {notifications.length === 0 ? (
              <div style={{
                padding: '24px 14px',
                textAlign: 'center',
                color: 'var(--nx-text-3)',
                fontSize: 13,
              }}>
                {copy.empty}
              </div>
            ) : (
              notifications.map(n => (
                <div
                  key={n.id}
                  role="listitem"
                  onClick={() => handleNotificationClick(n)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleNotificationClick(n); } }}
                  tabIndex={n.link ? 0 : -1}
                  aria-label={`${n.read === 0 ? copy.unread + ': ' : ''}${n.title}`}
                  style={{
                    display: 'flex',
                    gap: 10,
                    padding: '10px 14px',
                    borderBottom: '1px solid var(--nx-panel-2)',
                    cursor: n.link ? 'pointer' : 'default',
                    background: n.read === 0 ? 'var(--nx-panel-2)' : 'transparent',
                    transition: 'background 0.12s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--nx-panel-2)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = n.read === 0 ? 'var(--nx-panel-2)' : 'transparent'; }}
                >
                  <span aria-hidden="true" style={{ fontSize: 18, flexShrink: 0, lineHeight: 1.4 }}>{getIcon(n.type)}</span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <p style={{
                      margin: 0,
                      fontSize: 13,
                      fontWeight: n.read === 0 ? 600 : 400,
                      color: 'var(--nx-text)',
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
                        color: 'var(--nx-text-2)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {n.body}
                      </p>
                    )}
                    <span style={{ fontSize: 11, color: 'var(--nx-text-3)' }}>{timeAgo(n.created_at, copy)}</span>
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
          <div style={{ padding: '8px 14px', borderTop: '1px solid var(--nx-panel-2)' }}>
            <button
              onClick={clearRead}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: 12,
                color: 'var(--nx-text-3)',
                padding: 0,
                width: '100%',
                textAlign: 'left',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--nx-text)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--nx-text-3)'; }}
            >
              {copy.clearRead}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
