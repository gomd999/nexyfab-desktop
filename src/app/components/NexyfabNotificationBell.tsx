'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

interface NxNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read: number;
  created_at: number;
}

const TYPE_ICON: Record<string, string> = {
  rfq_created: '📋', rfq_status: '⚙️', comment: '💬',
  share: '🔗', cloud_save: '☁️', design: '🧊',
  version: '🕐', cots: '⚙️', system: '🔔',
};

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return '방금 전';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}일 전`;
  return new Date(ts).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
}

export default function NexyfabNotificationBell() {
  const [notifications, setNotifications] = useState<NxNotification[]>([]);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [clearing, setClearing] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch('/api/nexyfab/notifications');
      if (!res.ok) return;
      const data = await res.json() as { notifications: NxNotification[] };
      setNotifications(data.notifications ?? []);
    } catch { /* silent */ }
  }, []);

  useEffect(() => { void fetchNotifications(); }, [fetchNotifications]);

  // 30초 폴링
  useEffect(() => {
    const id = setInterval(fetchNotifications, 30_000);
    return () => clearInterval(id);
  }, [fetchNotifications]);

  // 외부 클릭 시 닫기
  useEffect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  const unreadCount = notifications.filter(n => n.read === 0).length;

  const markRead = useCallback(async (id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: 1 } : n));
    await fetch('/api/nexyfab/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    }).catch(() => {});
  }, []);

  const markAllRead = useCallback(async () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: 1 })));
    await fetch('/api/nexyfab/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true }),
    }).catch(() => {});
  }, []);

  const clearRead = useCallback(async () => {
    setClearing(true);
    await fetch('/api/nexyfab/notifications', { method: 'DELETE' }).catch(() => {});
    setNotifications(prev => prev.filter(n => n.read === 0));
    setClearing(false);
  }, []);

  const handleItemClick = useCallback((n: NxNotification) => {
    if (n.read === 0) void markRead(n.id);
    if (n.link) window.location.href = n.link;
    setOpen(false);
  }, [markRead]);

  const visible = filter === 'unread' ? notifications.filter(n => n.read === 0) : notifications;

  return (
    <div ref={dropdownRef} style={{ position: 'relative' }}>
      {/* 벨 버튼 */}
      <button
        onClick={() => setOpen(p => !p)}
        aria-label="NexyFab 알림"
        style={{
          position: 'relative', padding: '8px', borderRadius: '10px',
          border: open ? '1px solid #e0e7ff' : '1px solid transparent',
          background: open ? '#f5f7ff' : 'none', cursor: 'pointer',
          transition: 'all 0.15s', lineHeight: 1,
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
          stroke={unreadCount > 0 ? '#0b5cff' : '#9ca3af'} strokeWidth={2}
          strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute', top: 4, right: 4,
            minWidth: 16, height: 16, borderRadius: 8,
            background: '#ef4444', color: '#fff',
            fontSize: 9, fontWeight: 900,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '0 3px', lineHeight: 1,
          }}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* 드롭다운 패널 */}
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 5000,
          width: 360, maxHeight: 520,
          background: '#fff', borderRadius: '16px',
          border: '1px solid #e5e7eb',
          boxShadow: '0 12px 40px rgba(0,0,0,0.12)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
          animation: 'nxbell-drop 0.18s ease-out',
        }}>
          {/* 헤더 */}
          <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 900, color: '#111827', flex: 1 }}>
              NexyFab 알림 {unreadCount > 0 && (
                <span style={{ marginLeft: 6, fontSize: 11, background: '#ef4444', color: '#fff', borderRadius: 8, padding: '1px 7px', fontWeight: 700 }}>
                  {unreadCount}
                </span>
              )}
            </span>
            {unreadCount > 0 && (
              <button onClick={markAllRead}
                style={{ fontSize: 11, color: '#0b5cff', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
                모두 읽음
              </button>
            )}
          </div>

          {/* 필터 탭 */}
          <div style={{ padding: '8px 12px 0', display: 'flex', gap: 4 }}>
            {(['all', 'unread'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                style={{
                  padding: '5px 12px', borderRadius: 8, border: 'none',
                  background: filter === f ? '#0b5cff' : 'transparent',
                  color: filter === f ? '#fff' : '#9ca3af',
                  fontSize: 11, fontWeight: 700, cursor: 'pointer',
                }}>
                {f === 'all' ? '전체' : `읽지 않음${unreadCount > 0 ? ` (${unreadCount})` : ''}`}
              </button>
            ))}
          </div>

          {/* 알림 목록 */}
          <div style={{ overflowY: 'auto', flex: 1, paddingTop: 6 }}>
            {visible.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: '#9ca3af' }}>
                <div style={{ fontSize: 36, marginBottom: 10 }}>🔔</div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  {filter === 'unread' ? '읽지 않은 알림이 없습니다' : '알림이 없습니다'}
                </div>
              </div>
            ) : (
              visible.map(n => (
                <button key={n.id} onClick={() => handleItemClick(n)}
                  style={{
                    width: '100%', textAlign: 'left', padding: '10px 16px',
                    border: 'none', borderBottom: '1px solid #f9fafb',
                    background: n.read === 0 ? '#eff6ff' : '#fff',
                    cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'flex-start',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = n.read === 0 ? '#dbeafe' : '#f9fafb'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = n.read === 0 ? '#eff6ff' : '#fff'; }}
                >
                  <div style={{
                    flexShrink: 0, width: 36, height: 36, borderRadius: 10,
                    background: n.read === 0 ? '#dbeafe' : '#f3f4f6',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
                  }}>
                    {TYPE_ICON[n.type] ?? '🔔'}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: n.read === 0 ? 700 : 600, color: '#111827', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {n.title}
                      </span>
                      {n.read === 0 && <span style={{ flexShrink: 0, width: 7, height: 7, borderRadius: '50%', background: '#0b5cff', marginTop: 5 }} />}
                    </div>
                    {n.body && <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as React.CSSProperties['WebkitBoxOrient'] }}>{n.body}</div>}
                    <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 4, fontWeight: 500 }}>{timeAgo(n.created_at)}</div>
                  </div>
                </button>
              ))
            )}
          </div>

          {/* 푸터 */}
          <div style={{ padding: '10px 16px', borderTop: '1px solid #f0f0f0', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={clearRead} disabled={clearing}
              style={{ fontSize: 11, color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
              {clearing ? '…' : '읽은 알림 지우기'}
            </button>
            <button onClick={() => { setOpen(false); void fetchNotifications(); }}
              style={{ fontSize: 11, color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
              새로고침
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes nxbell-drop {
          from { opacity: 0; transform: translateY(-8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
