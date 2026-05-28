'use client';

/**
 * DirectEditToolbar.tsx — Wave 2 Phase 3 Track E1 + E2.
 *
 * Direct-edit UI:
 *   - Mode-toggle button (active/inactive) — gated on `?direct-edit=v1`.
 *     When active, a sub-mode selector chooses between
 *     `push-pull` / `dynamic-fillet` / `dynamic-chamfer` (E2 §6).
 *   - Undo last direct edit.
 *   - Clear all direct edits.
 *   - Status: "N direct edits applied this session".
 *
 * The button visibility is gated by the controller's `enabled` flag,
 * which the host sets from `searchParams.get('direct-edit') === 'v1'`.
 * When OFF, the toolbar renders nothing — zero footprint for users
 * not on the flag.
 *
 * Mode semantics:
 *   - Only one sub-mode is active at a time (radio-button-style).
 *   - When `modeActive` is false, sub-mode buttons are hidden — the
 *     toolbar collapses to the single Direct-edit toggle.
 *   - The host controls both `modeActive` AND `subMode` via callbacks,
 *     so the toolbar is fully controlled (mirrors E1's stateless
 *     contract for `modeActive`).
 */

import React, { useCallback } from 'react';
import {
  useDirectEditController,
  useDirectEditEnabled,
} from './DirectEditController';
import { getDirectEditStrings, type DirectEditLang } from './directEditI18n';

/** Toolbar sub-modes — radio-button-style; only one active at a time.
 *  Phase 3 W3 (E1) shipped `push-pull` only. W4 (E2) adds the two
 *  dynamic edge modes. */
export type DirectEditSubMode =
  | 'push-pull'
  | 'dynamic-fillet'
  | 'dynamic-chamfer';

export interface DirectEditToolbarProps {
  /** Current viewer language. Defaults to 'en'. */
  lang?: string;
  /** Whether direct-edit mode is currently the active pointer mode
   *  in the viewport. Owned by the host. */
  modeActive: boolean;
  /** Host-side mode setter. Toggled by the mode button. */
  onModeChange: (active: boolean) => void;
  /** Currently active sub-mode. Defaults to `push-pull` for
   *  backward compatibility with E1 callers that haven't migrated. */
  subMode?: DirectEditSubMode;
  /** Sub-mode setter. Optional — if absent, the sub-mode selector is
   *  hidden (E1-style single-mode operation). */
  onSubModeChange?: (mode: DirectEditSubMode) => void;
  /** Optional CSS class for parent containers that want to slot
   *  the toolbar into a specific layout cell. */
  className?: string;
}

export function DirectEditToolbar({
  lang = 'en',
  modeActive,
  onModeChange,
  subMode = 'push-pull',
  onSubModeChange,
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

  // Sub-mode selector visible only when mode is active AND the host
  // provided the setter. Keeps the E1 single-mode harness working.
  const showSubModes = modeActive && typeof onSubModeChange === 'function';

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
      {showSubModes && (
        <div
          role="radiogroup"
          aria-label={strings.ariaModeGroup}
          data-testid="direct-edit-submode-group"
          style={{ display: 'flex', gap: 4 }}
        >
          <SubModeButton
            active={subMode === 'push-pull'}
            testid="direct-edit-submode-push-pull"
            label={strings.modePushPull}
            onClick={() => onSubModeChange?.('push-pull')}
          />
          <SubModeButton
            active={subMode === 'dynamic-fillet'}
            testid="direct-edit-submode-dynamic-fillet"
            label={strings.modeDynamicFillet}
            onClick={() => onSubModeChange?.('dynamic-fillet')}
          />
          <SubModeButton
            active={subMode === 'dynamic-chamfer'}
            testid="direct-edit-submode-dynamic-chamfer"
            label={strings.modeDynamicChamfer}
            onClick={() => onSubModeChange?.('dynamic-chamfer')}
          />
        </div>
      )}
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

function SubModeButton({
  active,
  testid,
  label,
  onClick,
}: {
  active: boolean;
  testid: string;
  label: string;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      data-testid={testid}
      onClick={onClick}
      style={{
        padding: '3px 8px',
        background: active ? 'var(--nx-accent-2, #fbbf24)' : 'transparent',
        color: active ? '#000' : 'var(--nx-text-1, #fff)',
        border: '1px solid var(--nx-border, #2d3138)',
        borderRadius: 3,
        cursor: 'pointer',
        fontSize: 11,
        fontWeight: active ? 600 : 400,
      }}
    >
      {label}
    </button>
  );
}

export type { DirectEditLang };
