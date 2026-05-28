'use client';

/**
 * ActivityFeed.tsx — Wave 2 Phase 3 W7 Track Z7.
 *
 * Fixed-corner panel that lists the chronological "who-did-what" log for
 * the workspace. Sibling overlay to Z5's PresencePanel — both are
 * corner-anchored, both can be mounted standalone, and PresencePanel
 * also embeds a compact ActivityFeed inline via its "Activity (N)" tab.
 *
 * Layout decisions:
 *   - Auto-hides when the log is empty (mirrors PresencePanel's
 *     "alone in the doc → render nothing" UX).
 *   - Newest entry at the top — matches the Y.Array root ordering, so
 *     no client-side sort step.
 *   - Click a row → emits `CustomEvent('nfab:activity-focus', {
 *       detail: { entityId, kind } })` for the host to handle (scroll
 *     the affected entity into view, select it, ...). Default behaviour
 *     when no host listens: harmless no-op.
 *   - "Clear local view" button hides currently-visible entries on this
 *     peer only — does NOT touch the Y.Doc. Subsequent ops replicate
 *     normally.
 *
 * Why no time-since-now ticker:
 *   The relative-time string is computed at render only. Hosts that want
 *   a live ticker should wrap us in a `useInterval(setNow, 30_000)` —
 *   we keep the panel pure to avoid burning rAF budget on idle docs.
 *
 * Reads everything via `useActivityFeed()`; the hook handles the
 * with-/without-Provider degradation.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useActivityFeed } from './useActivityFeed';
import { CollabSafe } from './CollabSafe';
import {
  defaultActivityDictionary,
  formatRelativeTime,
  type ActivityEntry,
  type ActivityKind,
} from './activityFeed';

// ─── i18n ───────────────────────────────────────────────────────────────────

type Lang = 'ko' | 'en' | 'ja' | 'cn' | 'es' | 'ar';

const PANEL_DICT: Record<Lang, Record<string, string>> = {
  en: {
    activity: 'Activity',
    empty: 'No activity yet',
    clearLocal: 'Clear local view',
    anonymous: 'anonymous',
    collapse: 'Collapse',
    expand: 'Expand',
  },
  ko: {
    activity: '활동',
    empty: '아직 활동이 없습니다',
    clearLocal: '로컬 보기 지우기',
    anonymous: '익명',
    collapse: '접기',
    expand: '펼치기',
  },
  ja: {
    activity: 'アクティビティ',
    empty: 'まだアクティビティがありません',
    clearLocal: 'ローカルビューをクリア',
    anonymous: '匿名',
    collapse: '折りたたむ',
    expand: '展開',
  },
  cn: {
    activity: '活动',
    empty: '暂无活动',
    clearLocal: '清除本地视图',
    anonymous: '匿名',
    collapse: '折叠',
    expand: '展开',
  },
  es: {
    activity: 'Actividad',
    empty: 'Sin actividad todavía',
    clearLocal: 'Limpiar vista local',
    anonymous: 'anónimo',
    collapse: 'Contraer',
    expand: 'Expandir',
  },
  ar: {
    activity: 'النشاط',
    empty: 'لا يوجد نشاط بعد',
    clearLocal: 'مسح العرض المحلي',
    anonymous: 'مجهول',
    collapse: 'طي',
    expand: 'توسيع',
  },
};

// ─── Props ──────────────────────────────────────────────────────────────────

export interface ActivityFeedProps {
  /** UI language. Default `'en'`. */
  lang?: Lang;
  /** Corner anchor. Default `'bottom-right'`. */
  position?: 'top-right' | 'bottom-right' | 'top-left' | 'bottom-left';
  /** Inline z-index override. Default 48 (just below PresencePanel). */
  zIndex?: number;
  /** When set, always render the panel even when the log is empty.
   *  Default `false`. Useful for stories / debugging. */
  forceShow?: boolean;
  /**
   * Compact mode — used by PresencePanel's embedded section. Drops the
   * outer chrome and renders the rows inline. Default `false`.
   */
  compact?: boolean;
  /**
   * Maximum rows to render. Useful for the compact embed. Default 50
   * (matches `ACTIVITY_LOG_CAP`).
   */
  maxRows?: number;
  /**
   * Optional override for "now" used by relative-time formatting. Tests
   * use this for deterministic output.
   */
  nowMs?: number;
}

// ─── Public component ──────────────────────────────────────────────────────

export function ActivityFeed(props: ActivityFeedProps = {}) {
  return (
    <CollabSafe>
      <ActivityFeedInner {...props} />
    </CollabSafe>
  );
}

// ─── Custom event helper ────────────────────────────────────────────────────

/** Name of the focus-request event the feed emits on row click. */
export const NFAB_ACTIVITY_FOCUS_EVENT = 'nfab:activity-focus';

export interface NfabActivityFocusDetail {
  entityId: string;
  kind: ActivityKind;
}

function emitFocusEvent(entry: ActivityEntry): void {
  if (typeof window === 'undefined') return;
  if (!entry.entityId) return;
  try {
    const detail: NfabActivityFocusDetail = {
      entityId: entry.entityId,
      kind: entry.kind,
    };
    window.dispatchEvent(new CustomEvent(NFAB_ACTIVITY_FOCUS_EVENT, { detail }));
  } catch {
    /* CustomEvent not supported in some test envs; harmless */
  }
}

// ─── Inner component ────────────────────────────────────────────────────────

function ActivityFeedInner(props: ActivityFeedProps) {
  const {
    lang = 'en',
    position = 'bottom-right',
    zIndex = 48,
    forceShow = false,
    compact = false,
    maxRows,
    nowMs,
  } = props;
  const t = PANEL_DICT[lang] ?? PANEL_DICT.en;
  const dict = defaultActivityDictionary[lang] ?? defaultActivityDictionary.en;
  const { entries, clearLocalView } = useActivityFeed();
  const [collapsed, setCollapsed] = useState(false);

  // Snapshot a `now` once per render — caller can override for tests.
  // We deliberately don't tick at runtime; hosts wrap us in a setInterval
  // if they want live "30s ago → 31s ago" updates.
  const [renderedNow, setRenderedNow] = useState<number>(() =>
    typeof nowMs === 'number' ? nowMs : Date.now(),
  );
  useEffect(() => {
    if (typeof nowMs === 'number') setRenderedNow(nowMs);
    else setRenderedNow(Date.now());
  }, [nowMs, entries.length]);

  const rows = useMemo(() => {
    const max = maxRows ?? entries.length;
    return entries.slice(0, max);
  }, [entries, maxRows]);

  const handleRowClick = useCallback((entry: ActivityEntry) => {
    emitFocusEvent(entry);
  }, []);

  const handleClearLocal = useCallback(() => {
    clearLocalView();
  }, [clearLocalView]);

  // Auto-hide when empty.
  if (!forceShow && entries.length === 0) {
    if (compact) {
      // Compact embed renders a minimal "no activity" hint so the host
      // (PresencePanel) doesn't render a blank section.
      return (
        <div
          data-testid="collab-activity-empty"
          style={{ fontSize: 10, color: 'var(--nx-text-3, #9ca3af)', padding: '4px 0' }}
        >
          {t.empty}
        </div>
      );
    }
    return null;
  }

  // ── Compact embed (used by PresencePanel) ──────────────────────────────

  if (compact) {
    return (
      <div data-testid="collab-activity-compact">
        {rows.map((entry) => (
          <ActivityRow
            key={entry.id}
            entry={entry}
            dict={dict}
            anonymous={t.anonymous}
            nowMs={renderedNow}
            lang={lang}
            onClick={handleRowClick}
          />
        ))}
      </div>
    );
  }

  // ── Full panel ─────────────────────────────────────────────────────────

  const posStyle: React.CSSProperties = (() => {
    switch (position) {
      case 'top-right':
        return { top: 8, right: 8 };
      case 'top-left':
        return { top: 8, left: 8 };
      case 'bottom-left':
        return { bottom: 8, left: 8 };
      case 'bottom-right':
      default:
        return { bottom: 8, right: 8 };
    }
  })();

  return (
    <div
      role="region"
      aria-label={t.activity}
      data-testid="collab-activity-panel"
      style={{
        position: 'fixed',
        ...posStyle,
        zIndex,
        background: 'var(--nx-glass-strong, rgba(13,17,23,0.92))',
        border: '1px solid var(--nx-border, #374151)',
        borderRadius: 10,
        padding: collapsed ? '4px 10px' : '8px 10px 6px',
        minWidth: collapsed ? 0 : 240,
        maxWidth: 320,
        maxHeight: 360,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 11,
        color: 'var(--nx-text, #e5e7eb)',
        boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
      }}
    >
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        data-testid="collab-activity-toggle"
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
        <span>
          {t.activity} <span style={{ color: 'var(--nx-text-3, #9ca3af)', fontWeight: 500 }}>· {entries.length}</span>
        </span>
        <span style={{ fontSize: 9, color: 'var(--nx-text-3, #9ca3af)' }}>
          {collapsed ? '▸' : '▾'}
        </span>
      </button>

      {!collapsed && (
        <>
          <div
            data-testid="collab-activity-body"
            style={{
              marginTop: 6,
              overflowY: 'auto',
              flex: '1 1 auto',
              minHeight: 0,
            }}
          >
            {rows.map((entry) => (
              <ActivityRow
                key={entry.id}
                entry={entry}
                dict={dict}
                anonymous={t.anonymous}
                nowMs={renderedNow}
                lang={lang}
                onClick={handleRowClick}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={handleClearLocal}
            data-testid="collab-activity-clear"
            style={{
              marginTop: 6,
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
            }}
          >
            {t.clearLocal}
          </button>
        </>
      )}
    </div>
  );
}

// ─── ActivityRow ────────────────────────────────────────────────────────────

function ActivityRow(props: {
  entry: ActivityEntry;
  dict: Record<ActivityKind, string>;
  anonymous: string;
  nowMs: number;
  lang: Lang;
  onClick: (entry: ActivityEntry) => void;
}): React.ReactElement {
  const { entry, anonymous, nowMs, lang, onClick } = props;
  const name = entry.peerName ?? anonymous;
  const relTime = formatRelativeTime(entry.timestamp, nowMs, lang);
  const clickable = !!entry.entityId;

  const handleClick = (): void => {
    if (clickable) onClick(entry);
  };

  return (
    <div
      data-testid="collab-activity-row"
      data-entry-id={entry.id}
      data-entity-id={entry.entityId ?? ''}
      data-kind={entry.kind}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : -1}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (!clickable) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 6,
        padding: '4px 0',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
        cursor: clickable ? 'pointer' : 'default',
      }}
    >
      <span
        aria-hidden="true"
        data-testid="collab-activity-color"
        style={{
          width: 8,
          height: 8,
          flex: '0 0 8px',
          marginTop: 3,
          borderRadius: '50%',
          background: entry.peerColor,
          boxShadow: `0 0 4px ${entry.peerColor}`,
        }}
      />
      <div style={{ flex: '1 1 auto', minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 6,
            justifyContent: 'space-between',
          }}
        >
          <span
            style={{
              fontWeight: 600,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              flex: '1 1 auto',
            }}
            title={name}
          >
            {name}
          </span>
          <span
            data-testid="collab-activity-time"
            style={{
              flex: '0 0 auto',
              fontSize: 9,
              color: 'var(--nx-text-3, #9ca3af)',
            }}
          >
            {relTime}
          </span>
        </div>
        <div
          style={{
            color: 'var(--nx-text-2, #d1d5db)',
            fontSize: 10,
            wordBreak: 'break-word',
          }}
        >
          {entry.summary}
        </div>
      </div>
    </div>
  );
}

export default ActivityFeed;
