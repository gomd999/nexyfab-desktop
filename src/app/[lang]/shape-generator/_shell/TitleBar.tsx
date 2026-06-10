'use client';

import { I } from './Icons';
import { useEffect, useState, type ReactNode } from 'react';

// Self-contained immersive-mode toggle. Lives top-right next to Publish; a
// real click is a valid user gesture for the Fullscreen API (browsers block
// auto-fullscreen), so no popup is needed. (2026-06-09)
function FullscreenToggle() {
  const [isFs, setIsFs] = useState(false);
  useEffect(() => {
    const on = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  const toggle = () => {
    if (typeof document === 'undefined') return;
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };
  return (
    <button
      type="button"
      className="nx-pillbtn"
      onClick={toggle}
      title={isFs ? 'Exit fullscreen' : 'Fullscreen'}
      aria-label={isFs ? 'Exit fullscreen' : 'Fullscreen'}
      style={{ padding: '0 8px' }}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {isFs ? (
          <>
            <polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" />
            <line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" />
          </>
        ) : (
          <>
            <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
            <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
          </>
        )}
      </svg>
    </button>
  );
}

export interface Avatar {
  initials: string;
  color: string;
}

export interface TitleBarProps {
  filename?: string;
  savedAt?: string;
  breadcrumbs?: string[];
  mode?: string;
  modeHint?: string;
  onExitMode?: () => void;
  modeAccent?: string;
  avatars?: Avatar[];
  searchPlaceholder?: string;
  searchShortcut?: string;
  onNew?: () => void;
  onOpen?: () => void;
  onSave?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onSearch?: () => void;
  onShare?: () => void;
  onPublish?: () => void;
  shareLabel?: string;
  publishLabel?: string;
  canUndo?: boolean;
  canRedo?: boolean;
  rightExtras?: ReactNode;
  /** Navigate to the hub when the NEXYFAB wordmark is clicked. */
  onBrandClick?: () => void;
}

export function TitleBar({
  filename = 'Untitled.nxpart',
  savedAt,
  breadcrumbs,
  mode,
  modeHint,
  onExitMode,
  avatars = [],
  searchPlaceholder = 'Search commands, features…',
  searchShortcut = '⌘K',
  onNew,
  onOpen,
  onSave,
  onUndo,
  onRedo,
  onSearch,
  onShare,
  onPublish,
  shareLabel = 'Share',
  publishLabel = 'Publish',
  canUndo = true,
  canRedo = false,
  rightExtras,
  onBrandClick,
}: TitleBarProps) {
  return (
    <div className="nx-title">
      <div
        className="brand"
        onClick={onBrandClick}
        role={onBrandClick ? 'button' : undefined}
        tabIndex={onBrandClick ? 0 : undefined}
        onKeyDown={onBrandClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onBrandClick(); } } : undefined}
        title={onBrandClick ? 'Hub' : undefined}
        style={onBrandClick ? { cursor: 'pointer' } : undefined}
      >
        <span>NEXYFAB</span>
      </div>

      <div className="quick">
        <button type="button" title="New" onClick={onNew}>
          <I.file size={14} />
        </button>
        <button type="button" title="Open" onClick={onOpen}>
          <I.folder size={14} />
        </button>
        <button type="button" title="Save" onClick={onSave}>
          <I.save size={14} />
        </button>
        <button type="button" title="Undo" disabled={!canUndo} onClick={onUndo}>
          <I.undo size={14} />
        </button>
        <button type="button" title="Redo" disabled={!canRedo} onClick={onRedo}>
          <I.redo size={14} />
        </button>
      </div>

      <div className="file">
        {breadcrumbs && breadcrumbs.length > 0 ? (
          breadcrumbs.map((b, i) => (
            <span key={`${b}-${i}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {i > 0 && <span style={{ color: 'var(--nx-text-3)' }}>›</span>}
              {i === breadcrumbs.length - 1 ? <b>{b}</b> : <span>{b}</span>}
            </span>
          ))
        ) : (
          <b>{filename}</b>
        )}
        {savedAt && <span className="saved">{savedAt}</span>}
      </div>

      <div className="sp" />

      {mode && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span className="nx-chip accent">{mode}</span>
          {modeHint && (
            <span style={{ fontSize: 10, color: 'var(--nx-text-3)' }}>{modeHint}</span>
          )}
          {onExitMode && (
            <button
              type="button"
              className="nx-pillbtn"
              style={{ height: 22, padding: '0 8px', fontSize: 10 }}
              onClick={onExitMode}
            >
              <I.x size={10} /> Exit
            </button>
          )}
        </span>
      )}

      <div className="nx-search" onClick={onSearch} role="button" tabIndex={0}>
        <I.search size={12} />
        <span>{searchPlaceholder}</span>
        <span className="kbd">{searchShortcut}</span>
      </div>

      <div className="right">
        {avatars.length > 0 && (
          <div className="avatars">
            {avatars.map((a, i) => (
              <span key={i} className="av" style={{ background: a.color }}>
                {a.initials}
              </span>
            ))}
          </div>
        )}
        {rightExtras}
        {onShare && (
          <button type="button" className="nx-pillbtn" onClick={onShare}>
            <I.share size={12} /> {shareLabel}
          </button>
        )}
        {onPublish && (
          <button type="button" className="nx-pillbtn primary" onClick={onPublish}>
            <I.bolt size={12} /> {publishLabel}
          </button>
        )}
        <FullscreenToggle />
      </div>
    </div>
  );
}
