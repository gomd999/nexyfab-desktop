'use client';

/**
 * DirectEditToolbar.tsx — Wave 2 Phase 3 Track E1.
 *
 * Minimal direct-edit UI:
 *   - Mode-toggle button (gated on `?direct-edit=v1`)
 *   - Undo last direct edit
 *   - Clear all direct edits
 *   - Status: "N direct edits applied this session"
 *
 * The button visibility is gated by the controller's `enabled` flag,
 * which the host sets from `searchParams.get('direct-edit') === 'v1'`.
 * When OFF, the toolbar renders nothing — zero footprint for users
 * not on the flag.
 *
 * The toolbar is intentionally self-contained: it owns its own mode
 * toggle state (passed up via onModeChange to the overlay). The
 * controller owns the stack, the toolbar owns the "am I active?"
 * UI state. Mirrors the same separation used by `SectionPlane` /
 * `CSGPanel`.
 */

import React, { useCallback } from 'react';
import {
  useDirectEditController,
  useDirectEditEnabled,
} from './DirectEditController';
import { getDirectEditStrings, type DirectEditLang } from './directEditI18n';

export interface DirectEditToolbarProps {
  /** Current viewer language. Defaults to 'en'. */
  lang?: string;
  /** Whether direct-edit mode is currently the active pointer mode
   *  in the viewport. Owned by the host. */
  modeActive: boolean;
  /** Host-side mode setter. Toggled by the mode button. */
  onModeChange: (active: boolean) => void;
  /** Optional CSS class for parent containers that want to slot
   *  the toolbar into a specific layout cell. */
  className?: string;
}

export function DirectEditToolbar({
  lang = 'en',
  modeActive,
  onModeChange,
  className,
}: DirectEditToolbarProps): React.ReactElement | null {
  const enabled = useDirectEditEnabled();
  const { stack, popOp, clearStack } = useDirectEditController();
  const strings = getDirectEditStrings(lang);

  const handleToggle = useCallback(() => {
    onModeChange(!modeActive);
  }, [modeActive, onModeChange]);

  const handleUndo = useCallback(() => {
    popOp();
  }, [popOp]);

  const handleClear = useCallback(() => {
    clearStack('manual');
  }, [clearStack]);

  // Flag-gated: render nothing when ?direct-edit=v1 is not set.
  if (!enabled) return null;

  const opCount = stack.ops.length;
  const status = opCount === 0
    ? strings.statusNone
    : strings.statusCount(opCount);

  return (
    <div
      className={className}
      data-testid="direct-edit-toolbar"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 8px',
        background: 'var(--nx-bg-2, #1a1d23)',
        border: '1px solid var(--nx-border, #2d3138)',
        borderRadius: 4,
        fontSize: 12,
      }}
    >
      <button
        type="button"
        data-testid="direct-edit-mode-toggle"
        aria-label={strings.ariaModeToggle}
        aria-pressed={modeActive}
        onClick={handleToggle}
        style={{
          padding: '4px 10px',
          background: modeActive
            ? 'var(--nx-accent-1, #22d3ee)'
            : 'transparent',
          color: modeActive ? '#000' : 'var(--nx-text-1, #fff)',
          border: '1px solid var(--nx-accent-1, #22d3ee)',
          borderRadius: 3,
          cursor: 'pointer',
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        {modeActive ? strings.modeButtonActive : strings.modeButton}
      </button>
      <button
        type="button"
        data-testid="direct-edit-undo"
        onClick={handleUndo}
        disabled={opCount === 0}
        style={{
          padding: '4px 8px',
          background: 'transparent',
          color: opCount === 0
            ? 'var(--nx-text-3, #6b7280)'
            : 'var(--nx-text-1, #fff)',
          border: '1px solid var(--nx-border, #2d3138)',
          borderRadius: 3,
          cursor: opCount === 0 ? 'default' : 'pointer',
          fontSize: 11,
        }}
      >
        {strings.undo}
      </button>
      <button
        type="button"
        data-testid="direct-edit-clear-all"
        onClick={handleClear}
        disabled={opCount === 0}
        style={{
          padding: '4px 8px',
          background: 'transparent',
          color: opCount === 0
            ? 'var(--nx-text-3, #6b7280)'
            : 'var(--nx-text-1, #fff)',
          border: '1px solid var(--nx-border, #2d3138)',
          borderRadius: 3,
          cursor: opCount === 0 ? 'default' : 'pointer',
          fontSize: 11,
        }}
      >
        {strings.clearAll}
      </button>
      <span
        data-testid="direct-edit-status"
        style={{
          color: 'var(--nx-text-2, #cbd5e0)',
          fontSize: 11,
          marginLeft: 4,
        }}
      >
        {status}
      </span>
    </div>
  );
}

export type { DirectEditLang };
