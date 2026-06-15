'use client';

/**
 * PresencePanel.tsx — Wave 2 Phase 3 W5 Track Z5.
 *
 * Fixed-corner panel listing every peer currently in the room. One row per
 * peer with:
 *
 *   ● color dot · name · "editing X" / "viewing Y" / idle badge
 *
 * Behaviours:
 *   - Auto-hides when only the local peer is present (nothing useful to
 *     show; if you're alone in a doc the panel is just chrome).
 *   - Collapsible: click the header to fold to a single dot+count summary.
 *   - "Invite link" button copies the current `location.href` to clipboard
 *     (placeholder — a real share/permission UX lands in W6+).
 *   - 6-language i18n; the dict mirrors the rest of shape-generator.
 *
 * Reads everything from `useCollabPresence()` — no Awareness handle leaks
 * past the Provider boundary.
 *
 * Self vs. remote — `useCollabPresence` returns `{ localPeer, remotePeers }`;
 * we list every remote first, then the local peer (with a "you" badge) at
 * the bottom for orientation.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useCollabPresenceOptional } from './CollabProvider';
import { CollabSafe } from './CollabSafe';
import type { PeerInfo } from './awareness';
// ─── Z7 boundary-marked import (activity feed embed) ────────────────────────
import { ActivityFeed } from './ActivityFeedPanel';
import { useActivityFeed } from './useActivityFeed';
// ─── End Z7 boundary ────────────────────────────────────────────────────────

// ─── i18n dict (6 languages) ────────────────────────────────────────────────

type Lang = 'ko' | 'en' | 'ja' | 'cn' | 'es' | 'ar';

const DICT: Record<Lang, Record<string, string>> = {
  ko: {
    presence: '함께 작업 중',
    onlinePeers: '접속 인원',
    you: '나',
    idle: '대기',
    editing: '편집 중',
    viewing: '보는 중',
    inSketch: '스케치',
    inTree: '피처 트리',
    inForm: '입력 양식',
    inviteLink: '초대 링크 복사',
    inviteCopied: '복사 완료',
    inviteFailed: '복사 실패',
    collapse: '접기',
    expand: '펼치기',
    alone: '혼자 작업 중',
    activityTab: '활동',
  },
  en: {
    presence: 'Presence',
    onlinePeers: 'Online',
    you: 'you',
    idle: 'idle',
    editing: 'editing',
    viewing: 'viewing',
    inSketch: 'sketch',
    inTree: 'tree',
    inForm: 'form',
    inviteLink: 'Copy invite link',
    inviteCopied: 'Copied!',
    inviteFailed: 'Copy failed',
    collapse: 'Collapse',
    expand: 'Expand',
    alone: 'You are alone',
    activityTab: 'Activity',
  },
  ja: {
    presence: 'プレゼンス',
    onlinePeers: 'オンライン',
    you: 'あなた',
    idle: 'アイドル',
    editing: '編集中',
    viewing: '閲覧中',
    inSketch: 'スケッチ',
    inTree: 'ツリー',
    inForm: 'フォーム',
    inviteLink: '招待リンクをコピー',
    inviteCopied: 'コピー済み',
    inviteFailed: 'コピー失敗',
    collapse: '折りたたむ',
    expand: '展開',
    alone: '一人で作業中',
    activityTab: 'アクティビティ',
  },
  cn: {
    presence: '在线状态',
    onlinePeers: '在线',
    you: '你',
    idle: '空闲',
    editing: '编辑中',
    viewing: '查看中',
    inSketch: '草图',
    inTree: '特征树',
    inForm: '表单',
    inviteLink: '复制邀请链接',
    inviteCopied: '已复制',
    inviteFailed: '复制失败',
    collapse: '折叠',
    expand: '展开',
    alone: '独自工作中',
    activityTab: '活动',
  },
  es: {
    presence: 'Presencia',
    onlinePeers: 'En línea',
    you: 'tú',
    idle: 'inactivo',
    editing: 'editando',
    viewing: 'viendo',
    inSketch: 'boceto',
    inTree: 'árbol',
    inForm: 'formulario',
    inviteLink: 'Copiar enlace',
    inviteCopied: '¡Copiado!',
    inviteFailed: 'Error al copiar',
    collapse: 'Contraer',
    expand: 'Expandir',
    alone: 'Estás solo',
    activityTab: 'Actividad',
  },
  ar: {
    presence: 'الحضور',
    onlinePeers: 'متصل',
    you: 'أنت',
    idle: 'خامل',
    editing: 'يحرر',
    viewing: 'يشاهد',
    inSketch: 'الرسم',
    inTree: 'الشجرة',
    inForm: 'النموذج',
    inviteLink: 'نسخ رابط الدعوة',
    inviteCopied: 'تم النسخ',
    inviteFailed: 'فشل النسخ',
    collapse: 'طي',
    expand: 'توسيع',
    alone: 'تعمل وحدك',
    activityTab: 'النشاط',
  },
};

// ─── Public props ───────────────────────────────────────────────────────────

export interface PresencePanelProps {
  /** UI language. Default `'en'`. */
  lang?: Lang;
  /** Corner anchor. Default `'top-right'`. */
  position?: 'top-right' | 'bottom-right' | 'top-left' | 'bottom-left';
  /** Inline z-index override. Default 49 (one below CollabConnectionBadge). */
  zIndex?: number;
  /** When set, always render the panel even with only the local peer.
   *  Default false — auto-hides the panel when alone. Useful for stories. */
  forceShow?: boolean;
  /**
   * Optional invite-link override. The default reads `window.location.href`;
   * tests / Tauri can inject a deterministic value here.
   *
   * **Spec ambiguity resolved (W5):** real share-flow is W6+ Z6 territory.
   * The W5 button copies the canonical doc URL so users can paste it into
   * an IM / email; the receiver opening it joins the same Y.Doc via
   * BroadcastChannel (same-origin) or the WS provider (cross-origin once
   * the worker is deployed). No permission gate yet — that's W6+.
   */
  getInviteUrl?: () => string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const IDLE_AFTER_MS = 30_000;
const STALE_AFTER_MS = 60_000;

interface PeerStatus {
  kind: 'idle' | 'editing-tree' | 'editing-sketch' | 'editing-form' | 'viewing-sketch' | 'viewing';
  detail?: string;
}

function classifyPeer(peer: PeerInfo, now: number): PeerStatus {
  const ts = peer.ts ?? now;
  const age = now - ts;
  if (peer.activeNodeId) {
    return { kind: 'editing-tree', detail: peer.activeNodeId };
  }
  if (peer.selection && peer.selection.length > 0) {
    return { kind: 'editing-form', detail: peer.selection[0] };
  }
  if (peer.cursor && peer.cursor.viewport === 'sketch') {
    return { kind: age > IDLE_AFTER_MS ? 'idle' : 'viewing-sketch' };
  }
  if (peer.cursor) {
    return { kind: age > IDLE_AFTER_MS ? 'idle' : 'viewing', detail: peer.cursor.viewport };
  }
  return { kind: 'idle' };
}

function statusLabel(status: PeerStatus, t: Record<string, string>): string {
  switch (status.kind) {
    case 'editing-tree':
      return `${t.editing} · ${t.inTree}`;
    case 'editing-sketch':
      return `${t.editing} · ${t.inSketch}`;
    case 'editing-form':
      return `${t.editing} · ${t.inForm}`;
    case 'viewing-sketch':
      return `${t.viewing} · ${t.inSketch}`;
    case 'viewing':
      return status.detail ? `${t.viewing} · ${status.detail}` : t.viewing;
    case 'idle':
    default:
      return t.idle;
  }
}

function isStale(peer: PeerInfo, now: number): boolean {
  if (typeof peer.ts !== 'number') return false;
  return now - peer.ts > STALE_AFTER_MS;
}

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * ErrorBoundary-wrapped shell. See `CollabSafe.tsx` for why this matters
 * pre-Z6 (production shell isn't yet wrapped in `<CollabProvider>`).
 * Inner implementation in `PresencePanelInner`.
 */
export function PresencePanel(props: PresencePanelProps = {}) {
  return (
    <CollabSafe>
      <PresencePanelInner {...props} />
    </CollabSafe>
  );
}

function PresencePanelInner(props: PresencePanelProps) {
  const {
    lang = 'en',
    position = 'top-right',
    zIndex = 49,
    forceShow = false,
    getInviteUrl,
  } = props;
  const t = DICT[lang] ?? DICT.en;
  const { localPeer, remotePeers } = useCollabPresenceOptional();
  const [collapsed, setCollapsed] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'err'>('idle');

  const remoteList = useMemo(
    () => Object.values(remotePeers).sort((a, b) => a.name.localeCompare(b.name)),
    [remotePeers],
  );
  const totalCount = remoteList.length + 1; // +1 self
  // `now` is snapshotted in an effect whenever `remotePeers` identity
  // changes — keeps the staleness check fresh without calling `Date.now()`
  // during render (impure under react-hooks/purity).
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
  }, [remotePeers]);

  const handleCopy = useCallback(async () => {
    const url = (() => {
      if (getInviteUrl) return getInviteUrl();
      if (typeof window !== 'undefined' && window.location?.href) return window.location.href;
      return '';
    })();
    if (!url) {
      setCopyState('err');
      window.setTimeout(() => setCopyState('idle'), 1500);
      return;
    }
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        setCopyState('ok');
      } else {
        // Best-effort fallback for older browsers / Tauri webview.
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand?.('copy') ?? false;
        document.body.removeChild(ta);
        setCopyState(ok ? 'ok' : 'err');
      }
    } catch {
      setCopyState('err');
    }
    window.setTimeout(() => setCopyState('idle'), 1500);
  }, [getInviteUrl]);

  // No <CollabProvider> upstream (bare modeler route) → nothing to show.
  // Also auto-hide when only self is present.
  if (!localPeer || (!forceShow && remoteList.length === 0)) {
    return null;
  }

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
        return { top: 40, right: 8 }; // tucked below the connection badge
    }
  })();

  return (
    <div
      role="region"
      aria-label={t.presence}
      data-testid="collab-presence-panel"
      style={{
        position: 'fixed',
        ...posStyle,
        zIndex,
        background: 'var(--nx-glass-strong, rgba(13,17,23,0.92))',
        border: '1px solid var(--nx-border, #374151)',
        borderRadius: 10,
        padding: collapsed ? '4px 10px' : '8px 10px 6px',
        minWidth: collapsed ? 0 : 200,
        maxWidth: 280,
        fontFamily: 'system-ui, sans-serif',
        fontSize: 11,
        color: 'var(--nx-text, #e5e7eb)',
        boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
        userSelect: 'none',
      }}
    >
      {/* ── Header (clickable to collapse) ── */}
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        data-testid="collab-presence-toggle"
        aria-label={collapsed ? t.expand : t.collapse}
        aria-expanded={!collapsed}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          padding: 0,
          background: 'transparent',
          border: 0,
          color: 'inherit',
          cursor: 'pointer',
          fontFamily: 'inherit',
          fontSize: 11,
          fontWeight: 700,
          textAlign: 'left',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            aria-hidden="true"
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: 'var(--nx-ok, #22c55e)',
              boxShadow: '0 0 4px var(--nx-ok, #22c55e)',
            }}
          />
          <span>{t.presence}</span>
          <span style={{ color: 'var(--nx-text-3, #9ca3af)', fontWeight: 500 }}>
            · {totalCount}
          </span>
        </span>
        <span style={{ fontSize: 9, color: 'var(--nx-text-3, #9ca3af)' }}>
          {collapsed ? '▸' : '▾'}
        </span>
      </button>

      {/* ── Body (peer rows + invite button) ── */}
      {!collapsed && (
        <div data-testid="collab-presence-body" style={{ marginTop: 6 }}>
          {remoteList.map((peer) => {
            const status = classifyPeer(peer, now);
            const stale = isStale(peer, now);
            return (
              <PeerRow
                key={peer.id}
                peer={peer}
                statusText={statusLabel(status, t)}
                stale={stale}
              />
            );
          })}

          {/* Self row — at the bottom for orientation. */}
          <PeerRow
            key={localPeer.id}
            peer={localPeer}
            statusText={`(${t.you})`}
            stale={false}
            selfBadge
          />

          {/* ── Invite link ── */}
          <button
            type="button"
            onClick={handleCopy}
            data-testid="collab-presence-invite"
            style={{
              marginTop: 8,
              padding: '4px 8px',
              width: '100%',
              borderRadius: 6,
              border: '1px solid var(--nx-border, #374151)',
              background:
                copyState === 'ok'
                  ? 'rgba(34,197,94,0.15)'
                  : copyState === 'err'
                  ? 'rgba(239,68,68,0.15)'
                  : 'var(--nx-panel, #111827)',
              color: 'inherit',
              fontFamily: 'inherit',
              fontSize: 10,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'background 0.15s',
            }}
          >
            {copyState === 'ok'
              ? t.inviteCopied
              : copyState === 'err'
              ? t.inviteFailed
              : t.inviteLink}
          </button>

          {/* ── Z7 boundary-marked addition ── activity tab ── */}
          <ActivityTabSection labelActivity={t.activityTab} lang={lang} />
          {/* ── End Z7 boundary ── */}
        </div>
      )}
    </div>
  );
}

// ─── Z7 boundary-marked Activity tab section ──────────────────────────────
//
// One additional sub-section at the bottom of PresencePanel's body. The
// section auto-hides when the activity log is empty so the unchanged-
// rendering invariant holds for the "no activity" case.

function ActivityTabSection(props: { labelActivity: string; lang: Lang }): React.ReactNode {
  const { labelActivity, lang } = props;
  const [open, setOpen] = useState(false);
  const { entries } = useActivityFeed();

  // Auto-hide when log is empty — existing rendering unchanged in this case.
  if (entries.length === 0) return null;

  return (
    <div data-testid="collab-presence-activity-section" style={{ marginTop: 8 }}>
      <button
        type="button"
        data-testid="collab-presence-activity-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          padding: '4px 8px',
          width: '100%',
          borderRadius: 6,
          border: '1px solid var(--nx-border, #374151)',
          background: 'var(--nx-panel, #111827)',
          color: 'inherit',
          fontFamily: 'inherit',
          fontSize: 10,
          fontWeight: 600,
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span>{labelActivity} ({entries.length})</span>
        <span style={{ color: 'var(--nx-text-3, #9ca3af)' }}>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div
          data-testid="collab-presence-activity-body"
          style={{
            marginTop: 4,
            maxHeight: 180,
            overflowY: 'auto',
          }}
        >
          <ActivityFeed lang={lang} compact maxRows={10} />
        </div>
      )}
    </div>
  );
}

// ─── PeerRow ────────────────────────────────────────────────────────────────

function PeerRow(props: {
  peer: PeerInfo;
  statusText: string;
  stale: boolean;
  selfBadge?: boolean;
}) {
  const { peer, statusText, stale, selfBadge } = props;
  return (
    <div
      data-testid="collab-presence-row"
      data-peer-id={peer.id}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 0',
        opacity: stale ? 0.5 : 1,
      }}
    >
      <span
        aria-hidden="true"
        data-testid="collab-presence-color"
        style={{
          width: 8,
          height: 8,
          flex: '0 0 8px',
          borderRadius: '50%',
          background: peer.color,
          boxShadow: `0 0 4px ${peer.color}`,
        }}
      />
      <span
        style={{
          flex: '1 1 auto',
          fontWeight: 600,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
        title={peer.name}
      >
        {peer.name}
        {selfBadge && (
          <span
            style={{
              marginLeft: 4,
              fontSize: 9,
              fontWeight: 500,
              color: 'var(--nx-accent, #60a5fa)',
            }}
          >
            ★
          </span>
        )}
      </span>
      <span
        style={{
          flex: '0 0 auto',
          fontSize: 9,
          color: 'var(--nx-text-3, #9ca3af)',
          fontWeight: 500,
        }}
      >
        {statusText}
      </span>
    </div>
  );
}

export default PresencePanel;
