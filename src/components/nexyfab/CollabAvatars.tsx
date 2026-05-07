'use client';
// ─── CollabAvatars ────────────────────────────────────────────────────────────
// Shows a row of overlapping avatar circles for active collaborators.
// Dark-theme, inline styles only.

import { useState } from 'react';
import type { CollabSession } from '@/hooks/useCollabPolling';

// ─── Props ────────────────────────────────────────────────────────────────────

interface CollabAvatarsProps {
  sessions: CollabSession[];
  mySessionId: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MAX_VISIBLE = 5;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ─── Avatar atom ─────────────────────────────────────────────────────────────

function Avatar({
  session,
  isMe,
  zIndex,
}: {
  session: CollabSession;
  isMe: boolean;
  zIndex: number;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 36,
        height: 36,
        borderRadius: '50%',
        background: session.color,
        border: isMe ? '2px solid #fff' : '2px solid #1f2937',
        marginLeft: -8,
        zIndex,
        cursor: 'default',
        flexShrink: 0,
        userSelect: 'none',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Initials */}
      <span
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: '#fff',
          letterSpacing: '0.03em',
          lineHeight: 1,
        }}
      >
        {initials(session.userName)}
      </span>

      {/* "나" badge for self */}
      {isMe && (
        <span
          style={{
            position: 'absolute',
            bottom: -4,
            right: -4,
            background: '#3B82F6',
            color: '#fff',
            fontSize: 8,
            fontWeight: 700,
            borderRadius: 4,
            padding: '1px 3px',
            lineHeight: 1.4,
            border: '1px solid #1f2937',
          }}
        >
          나
        </span>
      )}

      {/* Tooltip */}
      {hovered && (
        <div
          style={{
            position: 'absolute',
            bottom: 44,
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#111827',
            color: '#e5e7eb',
            fontSize: 12,
            fontWeight: 500,
            padding: '4px 8px',
            borderRadius: 6,
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            border: '1px solid #374151',
            zIndex: 9999,
          }}
        >
          {session.userName}
          {isMe && (
            <span style={{ marginLeft: 4, color: '#60A5FA', fontSize: 11 }}>
              (나 / me)
            </span>
          )}
          {/* Tooltip arrow */}
          <span
            style={{
              position: 'absolute',
              top: '100%',
              left: '50%',
              transform: 'translateX(-50%)',
              width: 0,
              height: 0,
              borderLeft: '5px solid transparent',
              borderRight: '5px solid transparent',
              borderTop: '5px solid #374151',
            }}
          />
        </div>
      )}
    </div>
  );
}

// ─── Overflow badge ───────────────────────────────────────────────────────────

function OverflowBadge({ count }: { count: number }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 36,
        height: 36,
        borderRadius: '50%',
        background: '#374151',
        border: '2px solid #1f2937',
        marginLeft: -8,
        zIndex: 1,
        cursor: 'default',
        flexShrink: 0,
        userSelect: 'none',
        fontSize: 12,
        fontWeight: 700,
        color: '#9CA3AF',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      +{count}
      {hovered && (
        <div
          style={{
            position: 'absolute',
            bottom: 44,
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#111827',
            color: '#e5e7eb',
            fontSize: 12,
            padding: '4px 8px',
            borderRadius: 6,
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            border: '1px solid #374151',
            zIndex: 9999,
          }}
        >
          {count}명 더 접속 중 / {count} more online
        </div>
      )}
    </div>
  );
}

// ─── CollabAvatars ────────────────────────────────────────────────────────────

export default function CollabAvatars({ sessions, mySessionId }: CollabAvatarsProps) {
  if (!sessions || sessions.length === 0) return null;

  const visible = sessions.slice(0, MAX_VISIBLE);
  const overflow = sessions.length - MAX_VISIBLE;

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        paddingLeft: 8,
      }}
      aria-label={`${sessions.length}명 접속 중`}
      title={`${sessions.length}명 실시간 접속 중`}
    >
      {visible.map((session, idx) => (
        <Avatar
          key={session.sessionId}
          session={session}
          isMe={session.sessionId === mySessionId}
          zIndex={MAX_VISIBLE - idx}
        />
      ))}
      {overflow > 0 && <OverflowBadge count={overflow} />}
    </div>
  );
}
