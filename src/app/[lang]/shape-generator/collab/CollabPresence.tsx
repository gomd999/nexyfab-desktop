'use client';

import { useState, useCallback } from 'react';
import type { CollabUser } from './CollabTypes';
import type { CollabMode } from './useCollab';

// ─── CollabPresence: avatar overlay showing online users ─────────────────────

interface CollabPresenceProps {
  users: CollabUser[];
  mode?: CollabMode;
  isConnected?: boolean;
  roomId?: string;
  onSetMode?: (mode: CollabMode) => void;
  /** i18n labels — optional, falls back to English */
  labels?: {
    collabLive?: string;
    collabDemo?: string;
    collabConnected?: string;
    collabRoom?: string;
    collabUsers?: string;
  };
}

export default function CollabPresence({
  users,
  mode = 'off',
  isConnected = false,
  roomId,
  onSetMode,
  labels = {},
}: CollabPresenceProps) {
  const t = {
    collabLive: labels.collabLive ?? 'Live',
    collabDemo: labels.collabDemo ?? 'Demo',
    collabConnected: labels.collabConnected ?? 'Connected',
    collabRoom: labels.collabRoom ?? 'Room',
    collabUsers: labels.collabUsers ?? 'Users',
  };

  const [copied, setCopied] = useState(false);

  const copyRoom = useCallback(() => {
    if (!roomId) return;
    navigator.clipboard.writeText(roomId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {/* ignore */});
  }, [roomId]);

  const toggleMode = useCallback(() => {
    if (!onSetMode) return;
    if (mode === 'realtime') onSetMode('off');
    else if (mode === 'demo') onSetMode('realtime');
    else onSetMode('demo');
  }, [mode, onSetMode]);

  const connected = mode !== 'off' && isConnected;

  return (
    <div
      style={{
        position: 'absolute',
        top: 8,
        right: 8,
        zIndex: 30,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 4,
        pointerEvents: 'auto',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {/* Top row: mode toggle + connection dot + user count + avatars */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>

        {/* Mode toggle button */}
        {onSetMode && (
          <button
            onClick={toggleMode}
            title={mode === 'realtime' ? t.collabLive : mode === 'demo' ? t.collabDemo : 'Off'}
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: 10,
              border: '1px solid #30363d',
              background: mode === 'realtime'
                ? 'rgba(34,211,238,0.15)'
                : mode === 'demo'
                ? 'rgba(249,115,22,0.15)'
                : 'rgba(13,17,23,0.8)',
              color: mode === 'realtime'
                ? '#22d3ee'
                : mode === 'demo'
                ? '#f97316'
                : '#8b949e',
              cursor: 'pointer',
              transition: 'background 0.2s, color 0.2s',
            }}
          >
            {mode === 'realtime' ? t.collabLive : mode === 'demo' ? t.collabDemo : 'Off'}
          </button>
        )}

        {/* Connection status dot */}
        {mode !== 'off' && (
          <span
            title={connected ? t.collabConnected : 'Disconnected'}
            style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: connected ? '#22c55e' : '#6b7280',
              boxShadow: connected ? '0 0 4px #22c55e' : 'none',
              transition: 'background 0.3s, box-shadow 0.3s',
            }}
          />
        )}

        {/* User count badge */}
        {users.length > 0 && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: '#8b949e',
              background: 'rgba(13,17,23,0.8)',
              padding: '2px 8px',
              borderRadius: 10,
              border: '1px solid #30363d',
            }}
          >
            {users.length} {t.collabUsers}
          </span>
        )}

        {/* Avatar circles */}
        {users.map(u => (
          <AvatarCircle key={u.id} user={u} />
        ))}
      </div>

      {/* Room ID row — only in realtime mode */}
      {mode === 'realtime' && roomId && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            background: 'rgba(13,17,23,0.85)',
            border: '1px solid #30363d',
            borderRadius: 8,
            padding: '2px 8px',
          }}
        >
          <span style={{ fontSize: 10, color: '#6e7681', fontWeight: 600 }}>
            {t.collabRoom}:
          </span>
          <span style={{ fontSize: 10, color: '#c9d1d9', fontWeight: 700, letterSpacing: '0.05em' }}>
            {roomId}
          </span>
          <button
            onClick={copyRoom}
            title="Copy room ID"
            style={{
              fontSize: 10,
              background: 'none',
              border: 'none',
              color: copied ? '#22c55e' : '#8b949e',
              cursor: 'pointer',
              padding: '0 2px',
              transition: 'color 0.2s',
            }}
          >
            {copied ? '✓' : '⎘'}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── AvatarCircle ─────────────────────────────────────────────────────────────

function AvatarCircle({ user }: { user: CollabUser }) {
  const [hover, setHover] = useState(false);
  const stale = Date.now() - user.lastSeen > 10_000;

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ position: 'relative' }}
    >
      <div
        style={{
          width: 26,
          height: 26,
          borderRadius: '50%',
          background: user.color,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 12,
          fontWeight: 800,
          color: '#fff',
          border: '2px solid #0d1117',
          opacity: stale ? 0.45 : 1,
          transition: 'opacity 0.3s',
          cursor: 'default',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        {user.name.charAt(0).toUpperCase()}
      </div>

      {/* Tooltip */}
      {hover && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 4,
            background: '#161b22',
            color: '#c9d1d9',
            fontSize: 11,
            fontWeight: 600,
            padding: '3px 8px',
            borderRadius: 4,
            border: '1px solid #30363d',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          {user.name}
          {stale && <span style={{ color: '#6e7681', marginLeft: 4 }}>(away)</span>}
        </div>
      )}
    </div>
  );
}
