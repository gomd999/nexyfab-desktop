/**
 * CollabStatusBadge — standalone connection + peer-count pill for the
 * shape-generator collab UI (Phase 1 follow-up to ADR-013).
 *
 * Pairs with `useCrdtDoc` — the caller forwards `isConnected` from the hook
 * plus a `peerCount` derived from `Object.keys(awareness.remoteStates).length`.
 * The badge is intentionally *transport-agnostic*: it knows nothing about
 * WebSocket, IndexedDB, BroadcastChannel, or the CollabProvider context.
 * That keeps it usable from any host (sketch editor, drawing view, …) that
 * holds the raw connection-state values without paying for the provider tree.
 *
 * (There is a sibling `collab/CollabConnectionBadge` that *does* read from
 * CollabProvider — it serves the global page-level indicator. This badge is
 * the local, embedded variant; pick the one that matches your wiring.)
 *
 * ─── Status colour matrix ─────────────────────────────────────────────────
 * The dot encodes the *interesting* state of the room at a glance:
 *   - green  (#10b981)  connected AND peers > 0   → "live with other people"
 *   - blue   (#3b82f6)  connected AND peers === 0 → "alone in the room"
 *   - red    (#ef4444)  disconnected              → "your edits aren't syncing"
 * Disconnected always wins regardless of peer count — a stale peer count from
 * before the drop is misleading, so we surface the disconnect first.
 *
 * ─── Tooltip ──────────────────────────────────────────────────────────────
 * On hover we render an absolutely-positioned tooltip listing each peer id
 * with a colored swatch. If `userColors[id]` is set we honour it; otherwise
 * we fall back to `colorForUserId` from CursorOverlay so the swatch matches
 * the cursor marker exactly. IDs are truncated visually but the full id is
 * rendered as text so screen readers / `getByText` can find it.
 *
 * The tooltip uses `pointer-events: none` so it never intercepts clicks on
 * underlying viewport content — and a fresh hover/blur listener means it
 * is keyboard-accessible via focus on the trigger.
 */

'use client';

import React, { useState } from 'react';
import { colorForUserId } from './CursorOverlay';

// ─── i18n ────────────────────────────────────────────────────────────────

type Lang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

interface Dict {
  /** "Collab" prefix word for the badge text. */
  collab: string;
  connected: string;
  disconnected: string;
  /** "{N} peers" — `{n}` placeholder is substituted at render time. */
  peers: string;
  /** Tooltip header when there are no peers connected. */
  noPeers: string;
  /** Tooltip header listing remote peers. */
  peerListTitle: string;
}

const DICT: Record<Lang, Dict> = {
  ko: {
    collab: '협업',
    connected: '연결됨',
    disconnected: '연결 끊김',
    peers: '명 접속 중',
    noPeers: '접속 중인 다른 사용자가 없습니다',
    peerListTitle: '접속 중인 사용자',
  },
  en: {
    collab: 'Collab',
    connected: 'Connected',
    disconnected: 'Disconnected',
    peers: 'peers',
    noPeers: 'No other peers connected',
    peerListTitle: 'Connected peers',
  },
  ja: {
    collab: 'コラボ',
    connected: '接続中',
    disconnected: '切断',
    peers: '人接続中',
    noPeers: '他の参加者はいません',
    peerListTitle: '接続中の参加者',
  },
  zh: {
    collab: '协作',
    connected: '已连接',
    disconnected: '已断开',
    peers: '人在线',
    noPeers: '没有其他用户在线',
    peerListTitle: '在线用户',
  },
  es: {
    collab: 'Colab',
    connected: 'Conectado',
    disconnected: 'Desconectado',
    peers: 'usuarios',
    noPeers: 'No hay otros usuarios conectados',
    peerListTitle: 'Usuarios conectados',
  },
  ar: {
    collab: 'تعاون',
    connected: 'متصل',
    disconnected: 'غير متصل',
    peers: 'مستخدمين',
    noPeers: 'لا يوجد مستخدمون آخرون متصلون',
    peerListTitle: 'المستخدمون المتصلون',
  },
};

// ─── Status palette ───────────────────────────────────────────────────────

/** Exported so tests + sibling components can assert the contract. */
export const STATUS_COLORS = {
  /** Connected with peers — the "everything is great" green. */
  active: '#10b981',
  /** Connected but alone — calm blue, not an alarm. */
  idle: '#3b82f6',
  /** Disconnected — red, demands attention. */
  offline: '#ef4444',
} as const;

export type CollabStatus = keyof typeof STATUS_COLORS;

export function resolveStatus(isConnected: boolean, peerCount: number): CollabStatus {
  if (!isConnected) return 'offline';
  return peerCount > 0 ? 'active' : 'idle';
}

// ─── Props ────────────────────────────────────────────────────────────────

export interface CollabStatusBadgeProps {
  lang: Lang;
  isConnected: boolean;
  /** Number of remote peers currently present in the room. */
  peerCount: number;
  /** Optional list of peer user IDs for the hover tooltip. Order is preserved
   *  in the rendered list (we *don't* re-sort — the caller controls ordering
   *  to match their PresencePanel / cursor overlay). */
  peerIds?: string[];
  /** Optional override for the per-peer swatch colour. Falls back to the
   *  deterministic `colorForUserId` hash from CursorOverlay so a peer's
   *  swatch and cursor stay colour-matched. */
  userColors?: Record<string, string>;
  /** Optional escape hatch className applied to the outer pill. */
  className?: string;
}

// ─── Component ────────────────────────────────────────────────────────────

export function CollabStatusBadge({
  lang,
  isConnected,
  peerCount,
  peerIds,
  userColors,
  className,
}: CollabStatusBadgeProps): React.ReactElement {
  const t = DICT[lang] ?? DICT.en;
  const status = resolveStatus(isConnected, peerCount);
  const color = STATUS_COLORS[status];
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const showTooltip = hover || focus;

  // Headline label:
  //   - disconnected → "Collab: Disconnected"
  //   - connected    → "Collab: Connected (N peers)"
  // Even with 0 peers we show "(0 peers)" — it confirms the connection is
  // live and the room is just empty, rather than something being broken.
  const headline = !isConnected
    ? `${t.collab}: ${t.disconnected}`
    : `${t.collab}: ${t.connected} (${peerCount} ${t.peers})`;

  return (
    <div
      data-testid="collab-status-badge"
      data-status={status}
      data-color={color}
      data-peer-count={peerCount}
      data-connected={isConnected ? 'true' : 'false'}
      role="status"
      aria-label={headline}
      tabIndex={0}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      className={className}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        borderRadius: 12,
        background: 'var(--nx-glass-strong, rgba(13,17,23,0.85))',
        border: '1px solid var(--nx-border, #374151)',
        color: 'var(--nx-text, #e5e7eb)',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 11,
        fontWeight: 600,
        cursor: 'default',
        userSelect: 'none',
      }}
    >
      <span
        data-testid="collab-status-dot"
        aria-hidden="true"
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: color,
          boxShadow:
            status === 'active'
              ? `0 0 4px ${STATUS_COLORS.active}`
              : status === 'offline'
                ? `0 0 4px ${STATUS_COLORS.offline}`
                : 'none',
          transition: 'background 0.2s, box-shadow 0.2s',
          flex: '0 0 auto',
        }}
      />
      <span data-testid="collab-status-text">{headline}</span>
      {showTooltip && (
        <PeerTooltip
          dict={t}
          peerIds={peerIds ?? []}
          userColors={userColors}
        />
      )}
    </div>
  );
}

// ─── Tooltip ──────────────────────────────────────────────────────────────

function PeerTooltip({
  dict,
  peerIds,
  userColors,
}: {
  dict: Dict;
  peerIds: string[];
  userColors?: Record<string, string>;
}): React.ReactElement {
  const empty = peerIds.length === 0;
  return (
    <div
      data-testid="collab-status-tooltip"
      role="tooltip"
      style={{
        position: 'absolute',
        top: '100%',
        left: 0,
        marginTop: 6,
        zIndex: 50,
        background: 'var(--nx-panel, #111827)',
        border: '1px solid var(--nx-border, #374151)',
        borderRadius: 8,
        padding: '8px 12px',
        fontSize: 11,
        fontWeight: 500,
        color: 'var(--nx-text, #e5e7eb)',
        whiteSpace: 'nowrap',
        boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
        pointerEvents: 'none',
        minWidth: 120,
      }}
    >
      <div
        style={{
          color: 'var(--nx-text-3, #9ca3af)',
          marginBottom: empty ? 0 : 4,
          fontWeight: 600,
        }}
      >
        {empty ? dict.noPeers : dict.peerListTitle}
      </div>
      {!empty && (
        <ul
          data-testid="collab-status-peer-list"
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          {peerIds.map((id) => {
            const swatchColor = userColors?.[id] ?? colorForUserId(id);
            return (
              <li
                key={id}
                data-testid={`collab-status-peer-${id}`}
                data-user-id={id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span
                  data-testid={`collab-status-peer-swatch-${id}`}
                  data-color={swatchColor}
                  aria-hidden="true"
                  style={{
                    display: 'inline-block',
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: swatchColor,
                    flex: '0 0 auto',
                  }}
                />
                <span style={{ fontFamily: 'ui-monospace, monospace' }}>{id}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default CollabStatusBadge;
