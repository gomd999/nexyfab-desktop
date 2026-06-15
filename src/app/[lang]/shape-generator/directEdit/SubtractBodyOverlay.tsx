'use client';

/**
 * SubtractBodyOverlay.tsx — Wave 2 Phase 3 Track E4 UI.
 *
 * 2-step body picker for the subtract-body direct-edit mode. Renders
 * a floating panel that walks the user through:
 *   1. Pick the TARGET body (receives the cut)
 *   2. Pick the TOOL body (subtracted from target; consumed on apply)
 *   3. Confirm + Apply (calls back to the host)
 *
 * The actual body picking happens via the host's raycaster — the
 * overlay only owns the picker state machine + confirm UI. Host wires
 * `onBodyPicked(bodyId)` to forward viewport clicks while the overlay
 * is active.
 *
 * Activation: host sets `active` prop based on
 * `direct-edit mode === 'subtract-body'`. When inactive, returns null
 * (zero footprint).
 *
 * Apply flow:
 *   - User clicks "Apply" → onApply({ targetBodyId, toolBodyId })
 *   - Host calls applySubtractBody(...) with the picked ids
 *   - Host records the op on the direct-edit session stack
 *   - Overlay resets to "pick target" state for the next op
 *
 * Cancel flow:
 *   - User clicks "Cancel" → overlay resets, no callback
 *   - User clicks Escape (host-handled) → same
 */

import React, { useCallback, useImperativeHandle, useState } from 'react';
import { getDirectEditStrings } from './directEditI18n';

export interface SubtractBodyOverlayHandle {
  /** Host calls this when the viewport raycaster hits a body while
   *  the overlay is active. The overlay advances the picker state. */
  pickBody: (bodyId: string) => void;
  /** Host calls this when Escape is pressed or the mode toggles off. */
  reset: () => void;
}

export interface SubtractBodyOverlayProps {
  /** Active iff the host's direct-edit mode is 'subtract-body'. When
   *  false, the overlay renders null. */
  active: boolean;
  /** Current viewer language. */
  lang?: string;
  /** Fired when the user confirms a target+tool pair. */
  onApply: (op: { targetBodyId: string; toolBodyId: string }) => void;
  /** Optional human-friendly resolver for body ids → display labels
   *  (e.g. "Body_1" → "Cylinder_42"). Default uses the id verbatim. */
  resolveBodyLabel?: (bodyId: string) => string;
  /** Overlay position override (default: top-right of the parent). */
  style?: React.CSSProperties;
  /** Test-only hook for driving the picker without raycasts. */
  testHandleRef?: React.RefObject<SubtractBodyOverlayHandle | null>;
}

type PickerState =
  | { step: 'pickTarget' }
  | { step: 'pickTool'; targetBodyId: string }
  | { step: 'confirm'; targetBodyId: string; toolBodyId: string };

const initialState: PickerState = { step: 'pickTarget' };

export function SubtractBodyOverlay(props: SubtractBodyOverlayProps): React.ReactElement | null {
  const { active, lang = 'en', onApply, resolveBodyLabel, style, testHandleRef } = props;
  const strings = getDirectEditStrings(lang);
  const [state, setState] = useState<PickerState>(initialState);

  const reset = useCallback(() => setState(initialState), []);

  const pickBody = useCallback((bodyId: string) => {
    setState((prev) => {
      if (prev.step === 'pickTarget') {
        return { step: 'pickTool', targetBodyId: bodyId };
      }
      if (prev.step === 'pickTool') {
        // Reject self-subtract at pick time — UX nicer than a post-apply
        // rejection (matches validateDirectEditOp's 'self_subtract'
        // guard in directEditTypes.ts).
        if (bodyId === prev.targetBodyId) return prev;
        return { step: 'confirm', targetBodyId: prev.targetBodyId, toolBodyId: bodyId };
      }
      // In 'confirm' state — ignore further picks until Apply / Cancel.
      return prev;
    });
  }, []);

  useImperativeHandle(testHandleRef, () => ({ pickBody, reset }), [pickBody, reset]);

  const handleApply = useCallback(() => {
    if (state.step !== 'confirm') return;
    onApply({ targetBodyId: state.targetBodyId, toolBodyId: state.toolBodyId });
    reset();
  }, [state, onApply, reset]);

  if (!active) return null;

  const labelOf = (id: string) => resolveBodyLabel?.(id) ?? id;

  return (
    <div
      data-testid="subtract-body-overlay"
      style={{
        position: 'absolute',
        top: 60,
        right: 16,
        zIndex: 50,
        padding: '10px 14px',
        background: 'var(--nx-bg-2, #1a1d23)',
        border: '1px solid var(--nx-accent-1, #22d3ee)',
        borderRadius: 6,
        color: 'var(--nx-text-1, #fff)',
        fontSize: 12,
        minWidth: 240,
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        ...style,
      }}
    >
      {state.step === 'pickTarget' && (
        <div data-testid="subtract-step-pickTarget">
          <strong style={{ color: 'var(--nx-accent-1, #22d3ee)' }}>1.</strong>{' '}
          {strings.subtractPickTarget}
        </div>
      )}
      {state.step === 'pickTool' && (
        <div data-testid="subtract-step-pickTool">
          <div>
            <strong style={{ color: 'var(--nx-text-3, #6b7280)' }}>✓</strong>{' '}
            {labelOf(state.targetBodyId)}
          </div>
          <div style={{ marginTop: 4 }}>
            <strong style={{ color: 'var(--nx-accent-1, #22d3ee)' }}>2.</strong>{' '}
            {strings.subtractPickTool}
          </div>
        </div>
      )}
      {state.step === 'confirm' && (
        <div data-testid="subtract-step-confirm">
          <div style={{ marginBottom: 8 }}>
            {strings.subtractConfirm(labelOf(state.targetBodyId), labelOf(state.toolBodyId))}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              data-testid="subtract-apply"
              onClick={handleApply}
              style={{
                padding: '4px 12px',
                background: 'var(--nx-accent-1, #22d3ee)',
                color: '#000',
                border: 'none',
                borderRadius: 3,
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              {strings.subtractApply}
            </button>
            <button
              type="button"
              data-testid="subtract-cancel"
              onClick={reset}
              style={{
                padding: '4px 12px',
                background: 'transparent',
                color: 'var(--nx-text-2, #cbd5e0)',
                border: '1px solid var(--nx-border, #2d3138)',
                borderRadius: 3,
                cursor: 'pointer',
                fontSize: 11,
              }}
            >
              {strings.subtractCancel}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
