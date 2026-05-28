'use client';

/**
 * CollabConnectionBadge.tsx — Wave 2 Phase 3 W1 Track Z1.
 *
 * Small fixed-position indicator showing the live state of the collab
 * Provider's transports. Stateless — reads everything from `useCollabConnectionState`.
 *
 * Color codes follow the system tokens used elsewhere in the shape-generator:
 *   - var(--nx-ok)   ≈ green  → WS connected + N peers
 *   - var(--nx-warn) ≈ yellow → local-only mode (no WS configured)
 *   - var(--nx-err)  ≈ red    → WS configured but disconnected
 *   - var(--nx-text-3) ≈ grey → initial connecting state
 *
 * The badge is intentionally tiny — at most a dot + 1 short label. The
 * tooltip on hover shows the detailed per-transport breakdown.
 */

import { useState } from 'react';
import { useCollabConnectionState } from './CollabProvider';

interface CollabConnectionBadgeProps {
  /**
   * Where to anchor the badge. Defaults to top-right; sketch-mode uses
   * `bottom-right` so it doesn't collide with the property manager.
   */
  position?: 'top-right' | 'bottom-right' | 'top-left' | 'bottom-left';
  /** Optional i18n labels. */
  labels?: {
    online?: string;
    localOnly?: string;
    disconnected?: string;
    connecting?: string;
    peers?: string;
    indexedDb?: string;
    broadcastChannel?: string;
    webSocket?: string;
  };
  /** Inline z-index override. */
  zIndex?: number;
}

const DEFAULT_LABELS = {
  online: 'Online',
  localOnly: 'Local-only',
  disconnected: 'Disconnected',
  connecting: 'Connecting…',
  peers: 'peers',
  indexedDb: 'IndexedDB',
  broadcastChannel: 'BroadcastChannel',
  webSocket: 'WebSocket',
};

type Severity = 'ok' | 'warn' | 'err' | 'idle';

function severityColor(s: Severity): string {
  switch (s) {
    case 'ok':
      return 'var(--nx-ok, #22c55e)';
    case 'warn':
      return 'var(--nx-warn, #f59e0b)';
    case 'err':
      return 'var(--nx-err, #ef4444)';
    case 'idle':
    default:
      return 'var(--nx-text-3, #6b7280)';
  }
}

export function CollabConnectionBadge(props: CollabConnectionBadgeProps = {}) {
  const { position = 'top-right', zIndex = 50 } = props;
  const labels = { ...DEFAULT_LABELS, ...(props.labels ?? {}) };
  const state = useCollabConnectionState();
  const [hover, setHover] = useState(false);

  // ─── Pick the headline severity + label ────────────────────────────────────

  let severity: Severity;
  let title: string;
  if (state.ws === 'connected') {
    severity = 'ok';
    title = `${labels.online} (${state.peerCount} ${labels.peers})`;
  } else if (state.ws === 'unavailable') {
    severity = state.bc === 'active' ? 'warn' : 'idle';
    title = labels.localOnly;
  } else if (state.ws === 'connecting') {
    severity = 'idle';
    title = labels.connecting;
  } else {
    severity = 'err';
    title = labels.disconnected;
  }

  // ─── Position styling ──────────────────────────────────────────────────────

  const posStyle: React.CSSProperties = (() => {
    switch (position) {
      case 'bottom-right':
        return { bottom: 8, right: 8 };
      case 'top-left':
        return { top: 8, left: 8 };
      case 'bottom-left':
        return { bottom: 8, left: 8 };
      case 'top-right':
      default:
        return { top: 8, right: 8 };
    }
  })();

  return (
    <div
      role="status"
      aria-label={`Collab connection: ${title}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'fixed',
        ...posStyle,
        zIndex,
        display: 'flex',
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
      data-testid="collab-connection-badge"
    >
      <span
        aria-hidden="true"
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: severityColor(severity),
          boxShadow:
            severity === 'ok'
              ? '0 0 4px var(--nx-ok, #22c55e)'
              : severity === 'err'
              ? '0 0 4px var(--nx-err, #ef4444)'
              : 'none',
          transition: 'background 0.2s, box-shadow 0.2s',
        }}
      />
      <span>{title}</span>
      {hover && (
        <DetailTooltip
          state={state}
          labels={labels}
          severity={severity}
          anchor={position}
        />
      )}
    </div>
  );
}

// ─── Tooltip ────────────────────────────────────────────────────────────────

function DetailTooltip(props: {
  state: ReturnType<typeof useCollabConnectionState>;
  labels: typeof DEFAULT_LABELS;
  severity: Severity;
  anchor: NonNullable<CollabConnectionBadgeProps['position']>;
}) {
  const { state, labels } = props;
  // Anchor tooltip OPPOSITE the badge edge so it doesn't run off screen.
  const placement: React.CSSProperties =
    props.anchor.startsWith('top')
      ? { top: '100%', marginTop: 6 }
      : { bottom: '100%', marginBottom: 6 };
  const align: React.CSSProperties =
    props.anchor.endsWith('right')
      ? { right: 0 }
      : { left: 0 };

  return (
    <div
      role="tooltip"
      style={{
        position: 'absolute',
        ...placement,
        ...align,
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
      }}
      data-testid="collab-connection-tooltip"
    >
      <DetailRow label={labels.webSocket} value={state.ws} />
      <DetailRow label={labels.broadcastChannel} value={state.bc} />
      <DetailRow label={labels.indexedDb} value={state.idb} />
      <DetailRow label={labels.peers} value={String(state.peerCount)} />
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
      <span style={{ color: 'var(--nx-text-3, #9ca3af)' }}>{label}</span>
      <span style={{ fontFamily: 'ui-monospace, monospace' }}>{value}</span>
    </div>
  );
}

export default CollabConnectionBadge;
