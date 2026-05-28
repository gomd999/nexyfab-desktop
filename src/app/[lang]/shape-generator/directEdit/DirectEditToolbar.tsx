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

/** Full direct-edit mode union. `push-pull` is E1; `move-body` /
 *  `rotate-body` are E3 (this PR). When E2 lands the union grows to
 *  include `dynamic-fillet` / `dynamic-chamfer`. */
export type DirectEditMode =
  | 'off'
  | 'push-pull'
  | 'move-body'
  | 'rotate-body';

export interface DirectEditToolbarProps {
  /** Current viewer language. Defaults to 'en'. */
  lang?: string;
  /** Legacy boolean API (E1) — when true, push-pull mode is on. The
   *  toolbar still accepts this for back-compat with the host that
   *  hasn't migrated to the union yet. When `mode` is provided it
   *  takes precedence. */
  modeActive?: boolean;
  /** Legacy boolean setter — paired with `modeActive`. */
  onModeChange?: (active: boolean) => void;
  /** New union API (E3) — explicit mode. When provided, supersedes
   *  the legacy boolean. */
  mode?: DirectEditMode;
  /** Setter for the union mode. Required when `mode` is provided. */
  onModeSelect?: (mode: DirectEditMode) => void;
  /** Optional CSS class for parent containers that want to slot
   *  the toolbar into a specific layout cell. */
  className?: string;
}

export function DirectEditToolbar({
  lang = 'en',
  modeActive,
  onModeChange,
  mode,
  onModeSelect,
  className,
}: DirectEditToolbarProps): React.ReactElement | null {
  const enabled = useDirectEditEnabled();
  const { stack, popOp, clearStack } = useDirectEditController();
  const strings = getDirectEditStrings(lang);

  // Resolve the effective mode. When the new union API is provided
  // it wins; otherwise we derive it from the legacy boolean (true =
  // push-pull, false = off).
  const effectiveMode: DirectEditMode = mode ?? (modeActive ? 'push-pull' : 'off');

  // Legacy boolean fallback for the push-pull mode-toggle button —
  // preserves the E1 behaviour (one toggle button) when the host has
  // not yet migrated to the union API.
  const handleToggle = useCallback(() => {
    if (onModeSelect) {
      onModeSelect(effectiveMode === 'push-pull' ? 'off' : 'push-pull');
      return;
    }
    if (onModeChange) onModeChange(!modeActive);
  }, [effectiveMode, modeActive, onModeChange, onModeSelect]);

  // Radio-style mode selectors for the new union API. Each mode
  // button calls `onModeSelect`; clicking the active mode again
  // deselects (returns to 'off').
  const handleSelectMode = useCallback(
    (next: DirectEditMode) => {
      if (onModeSelect) {
        onModeSelect(effectiveMode === next ? 'off' : next);
        return;
      }
      // Fallback through legacy boolean — only 'push-pull' / 'off'
      // round-trip correctly. Move + rotate require the union API.
      if (onModeChange) {
        onModeChange(next === 'push-pull');
      }
    },
    [effectiveMode, onModeChange, onModeSelect],
  );

  const handleUndo = useCallback(() => {
    popOp();
  }, [popOp]);

  const handleClear = useCallback(() => {
    clearStack('manual');
  }, [clearStack]);

  // Flag-gated: render nothing when ?direct-edit=v1 is not set.
  if (!enabled) return null;

  const opCount = stack.ops.length;
  const isPushPull = effectiveMode === 'push-pull';
  const isMoveBody = effectiveMode === 'move-body';
  const isRotateBody = effectiveMode === 'rotate-body';
  const status = opCount === 0
    ? strings.statusNone
    : strings.statusCount(opCount);
  // Mode-specific status hint appended when a non-push-pull mode is
  // active. Mirrors the SolidWorks "current tool: rotate" status bar.
  const modeStatusHint =
    effectiveMode === 'off'
      ? null
      : effectiveMode === 'push-pull'
        ? strings.modeStatusPushPull
        : effectiveMode === 'move-body'
          ? strings.modeStatusMoveBody
          : strings.modeStatusRotateBody;

  // Style helpers for the mode-radio buttons.
  const radioStyle = (active: boolean): React.CSSProperties => ({
    padding: '4px 10px',
    background: active ? 'var(--nx-accent-1, #22d3ee)' : 'transparent',
    color: active ? '#000' : 'var(--nx-text-1, #fff)',
    border: '1px solid var(--nx-accent-1, #22d3ee)',
    borderRadius: 3,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 600,
  });

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
        aria-pressed={isPushPull}
        onClick={mode !== undefined ? () => handleSelectMode('push-pull') : handleToggle}
        style={radioStyle(isPushPull)}
      >
        {isPushPull ? strings.modeButtonActive : strings.modeButton}
      </button>
      {/* E3 mode buttons — only rendered when the host opts into the
       *  union API by passing `mode`. The legacy boolean API gets the
       *  E1 single-button experience to avoid a sudden UI churn. */}
      {mode !== undefined && (
        <>
          <button
            type="button"
            data-testid="direct-edit-move-body"
            aria-label={strings.ariaMoveBody}
            aria-pressed={isMoveBody}
            onClick={() => handleSelectMode('move-body')}
            style={radioStyle(isMoveBody)}
          >
            {isMoveBody ? strings.moveBodyActive : strings.moveBody}
          </button>
          <button
            type="button"
            data-testid="direct-edit-rotate-body"
            aria-label={strings.ariaRotateBody}
            aria-pressed={isRotateBody}
            onClick={() => handleSelectMode('rotate-body')}
            style={radioStyle(isRotateBody)}
          >
            {isRotateBody ? strings.rotateBodyActive : strings.rotateBody}
          </button>
        </>
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
      {modeStatusHint && (
        <span
          data-testid="direct-edit-mode-status"
          style={{
            color: 'var(--nx-accent-1, #22d3ee)',
            fontSize: 11,
            marginLeft: 4,
            fontStyle: 'italic',
          }}
        >
          {modeStatusHint}
        </span>
      )}
    </div>
  );
}

export type { DirectEditLang };
