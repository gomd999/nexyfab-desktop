'use client';

import { I } from './Icons';
import type { ReactNode } from 'react';

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
}: TitleBarProps) {
  return (
    <div className="nx-title">
      <div className="brand">
        <div className="logo" />
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
      </div>
    </div>
  );
}
