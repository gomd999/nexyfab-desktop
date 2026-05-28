'use client';

/**
 * CommitToHistoryButton.tsx — Wave 2 Phase 3 Track E5 (W7).
 *
 * Opt-in "promote session stack → parametric history" button. Visible
 * only when:
 *   - `?direct-edit=v1` flag is ON (controller's enabled flag)
 *   - The direct-edit stack has at least one op
 *
 * Click flow:
 *   1. Open a confirm modal showing the op count.
 *   2. User clicks "Commit" → the orchestrator runs.
 *   3a. Full success → toast "N committed to history", stack cleared.
 *   3b. Partial failure → modal shows the "Commit partial" / "Cancel"
 *       branch with the rejection reason.
 *
 * The button does NOT auto-commit on history-rerun, save, or any other
 * implicit event. ADR-012 §6 specifies "opt-in commit-to-history" — the
 * differentiator vs Fusion/SolidWorks is the user choice.
 */

import React, { useCallback, useState } from 'react';
import { useDirectEditController, useDirectEditEnabled } from './DirectEditController';
import {
  getDirectEditStrings,
  getCommitRejectionReasonString,
} from './directEditI18n';
import {
  commitDirectEditStackToHistory,
  commitPartialNodes,
  type CommitStackResult,
  type StackCommitCallbacks,
} from './commitStack';
import type { CommitContext } from './commitToHistory';
import type { HistoryNode } from '../useFeatureStack';

export interface CommitToHistoryButtonProps {
  /** Viewer language. Defaults to 'en'. */
  lang?: string;
  /** Resolve a face id to its owner feature id (delegated to the host
   *  via `faceProvenance.getFaceFeatureId(geometry, triIdx)`). */
  getFaceFeatureId: (faceId: string) => string | null;
  /** Resolve a face id to its world-space unit normal. Optional —
   *  enables the push-pull mapper to populate `_normalX/Y/Z` params
   *  for the W8 follow-up applier. */
  getFaceNormal?: (faceId: string) => readonly [number, number, number] | null;
  /** Active node id (from `useFeatureStack.history.activeNodeId`). The
   *  committed nodes become children of this node. */
  activeNodeId: string;
  /** Allocate a new node id. Defaults to crypto.randomUUID. */
  nextNodeId?: () => string;
  /** Append the synthesized nodes to the feature stack. The host wires
   *  this to `useFeatureStack.addNode(...)` (or a batch equivalent). */
  appendHistoryNodes: (nodes: HistoryNode[]) => void;
  /** Optional toast emitter — when omitted the component dispatches a
   *  CustomEvent that the host can listen to. */
  emitToast?: (message: string) => void;
  /** Optional className for layout slot. */
  className?: string;
}

/** Default `nextNodeId` implementation — mirrors `useFeatureStack`'s
 *  internal `genId`. Inlined here so this module stays decoupled. */
function defaultNextNodeId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** CustomEvent fired when a commit completes (full or partial). */
export const COMMIT_TO_HISTORY_TOAST_EVENT = 'nfab:direct-edit-committed';

export interface CommitToHistoryToastDetail {
  /** Number of nodes appended to history. */
  appended: number;
  /** Number of ops still in the stack (partial path only; 0 on full). */
  remaining: number;
}

function dispatchCommitToast(detail: CommitToHistoryToastDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<CommitToHistoryToastDetail>(
      COMMIT_TO_HISTORY_TOAST_EVENT,
      { detail },
    ),
  );
}

type ModalState =
  | { kind: 'closed' }
  | { kind: 'confirm' }
  | { kind: 'partial'; result: Extract<CommitStackResult, { ok: false }> };

export function CommitToHistoryButton({
  lang = 'en',
  getFaceFeatureId,
  getFaceNormal,
  activeNodeId,
  nextNodeId = defaultNextNodeId,
  appendHistoryNodes,
  emitToast,
  className,
}: CommitToHistoryButtonProps): React.ReactElement | null {
  const enabled = useDirectEditEnabled();
  const {
    stack,
    clearStack,
    shiftOps,
    beginCommitFlow,
  } = useDirectEditController();
  const strings = getDirectEditStrings(lang);
  const [modal, setModal] = useState<ModalState>({ kind: 'closed' });

  const opCount = stack.ops.length;
  const visible = enabled && opCount > 0;

  const runCommit = useCallback((): CommitStackResult => {
    const ctx: CommitContext = {
      nextNodeId,
      activeNodeId,
      getFaceFeatureId,
      ...(getFaceNormal ? { getFaceNormal } : {}),
    };
    const release = beginCommitFlow();
    const cb: StackCommitCallbacks = {
      appendNodes: nodes => appendHistoryNodes(nodes),
      clearStack: () => clearStack('manual'),
    };
    try {
      return commitDirectEditStackToHistory(stack, ctx, cb);
    } finally {
      release();
    }
  }, [
    nextNodeId,
    activeNodeId,
    getFaceFeatureId,
    getFaceNormal,
    beginCommitFlow,
    appendHistoryNodes,
    clearStack,
    stack,
  ]);

  const onOpenClick = useCallback(() => {
    setModal({ kind: 'confirm' });
  }, []);

  const onCancel = useCallback(() => {
    setModal({ kind: 'closed' });
  }, []);

  const fireToast = useCallback((message: string, detail: CommitToHistoryToastDetail) => {
    if (emitToast) {
      emitToast(message);
    } else {
      dispatchCommitToast(detail);
    }
  }, [emitToast]);

  const onConfirm = useCallback(() => {
    const result = runCommit();
    if (result.ok) {
      fireToast(strings.commitSuccessToast(result.clearedOps), {
        appended: result.clearedOps,
        remaining: 0,
      });
      setModal({ kind: 'closed' });
    } else {
      // Failure path — open the partial-commit chooser.
      setModal({ kind: 'partial', result });
    }
  }, [runCommit, fireToast, strings]);

  const onCommitPartial = useCallback(() => {
    if (modal.kind !== 'partial') return;
    const release = beginCommitFlow();
    try {
      const out = commitPartialNodes(
        modal.result.partialNodes,
        modal.result.failedAt,
        {
          appendNodes: nodes => appendHistoryNodes(nodes),
          clearStack: () => clearStack('manual'),
          shiftOps,
        },
      );
      const remaining = Math.max(0, opCount - out.appendedCount);
      fireToast(
        strings.commitPartialToast(out.appendedCount, remaining),
        { appended: out.appendedCount, remaining },
      );
    } finally {
      release();
    }
    setModal({ kind: 'closed' });
  }, [modal, beginCommitFlow, appendHistoryNodes, clearStack, shiftOps, opCount, fireToast, strings]);

  if (!visible) return null;

  return (
    <>
      <button
        type="button"
        data-testid="direct-edit-commit-button"
        aria-label={strings.ariaCommit}
        onClick={onOpenClick}
        className={className}
        style={{
          padding: '4px 10px',
          background: 'var(--nx-accent-2, #f59e0b)',
          color: '#000',
          border: '1px solid var(--nx-accent-2, #f59e0b)',
          borderRadius: 3,
          cursor: 'pointer',
          fontSize: 11,
          fontWeight: 600,
        }}
      >
        {strings.commitButton}
      </button>

      {modal.kind === 'confirm' && (
        <div
          data-testid="direct-edit-commit-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="direct-edit-commit-modal-title"
          style={modalBackdropStyle}
        >
          <div style={modalContentStyle}>
            <h3
              id="direct-edit-commit-modal-title"
              data-testid="direct-edit-commit-modal-title"
              style={modalTitleStyle}
            >
              {strings.commitModalTitle}
            </h3>
            <p
              data-testid="direct-edit-commit-modal-body"
              style={modalBodyStyle}
            >
              {strings.commitModalBody(opCount)}
            </p>
            <div style={modalActionsStyle}>
              <button
                type="button"
                data-testid="direct-edit-commit-cancel"
                onClick={onCancel}
                style={modalSecondaryButtonStyle}
              >
                {strings.commitCancel}
              </button>
              <button
                type="button"
                data-testid="direct-edit-commit-confirm"
                onClick={onConfirm}
                style={modalPrimaryButtonStyle}
              >
                {strings.commitConfirm}
              </button>
            </div>
          </div>
        </div>
      )}

      {modal.kind === 'partial' && (
        <div
          data-testid="direct-edit-commit-modal-partial"
          role="dialog"
          aria-modal="true"
          aria-labelledby="direct-edit-commit-modal-partial-title"
          style={modalBackdropStyle}
        >
          <div style={modalContentStyle}>
            <h3
              id="direct-edit-commit-modal-partial-title"
              data-testid="direct-edit-commit-modal-partial-title"
              style={modalTitleStyle}
            >
              {strings.commitModalTitle}
            </h3>
            <p
              data-testid="direct-edit-commit-modal-partial-body"
              style={modalBodyStyle}
            >
              {strings.commitPartialBody(
                modal.result.partialNodes.length,
                opCount,
                getCommitRejectionReasonString(strings, modal.result.reason),
              )}
            </p>
            <div style={modalActionsStyle}>
              <button
                type="button"
                data-testid="direct-edit-commit-cancel"
                onClick={onCancel}
                style={modalSecondaryButtonStyle}
              >
                {strings.commitCancel}
              </button>
              <button
                type="button"
                data-testid="direct-edit-commit-partial"
                onClick={onCommitPartial}
                disabled={modal.result.partialNodes.length === 0}
                style={
                  modal.result.partialNodes.length === 0
                    ? modalDisabledButtonStyle
                    : modalPrimaryButtonStyle
                }
              >
                {strings.commitPartial}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Inline styles (kept local — matches the existing E1 toolbar pattern) ──

const modalBackdropStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.4)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
};

const modalContentStyle: React.CSSProperties = {
  background: 'var(--nx-bg-1, #0f1115)',
  border: '1px solid var(--nx-border, #2d3138)',
  borderRadius: 6,
  padding: 16,
  maxWidth: 420,
  width: '90%',
  color: 'var(--nx-text-1, #fff)',
  fontSize: 12,
};

const modalTitleStyle: React.CSSProperties = {
  margin: 0,
  marginBottom: 8,
  fontSize: 14,
  fontWeight: 600,
};

const modalBodyStyle: React.CSSProperties = {
  margin: 0,
  marginBottom: 16,
  fontSize: 12,
  color: 'var(--nx-text-2, #cbd5e0)',
  lineHeight: 1.5,
};

const modalActionsStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
};

const modalPrimaryButtonStyle: React.CSSProperties = {
  padding: '6px 14px',
  background: 'var(--nx-accent-1, #22d3ee)',
  color: '#000',
  border: '1px solid var(--nx-accent-1, #22d3ee)',
  borderRadius: 3,
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 600,
};

const modalSecondaryButtonStyle: React.CSSProperties = {
  padding: '6px 14px',
  background: 'transparent',
  color: 'var(--nx-text-1, #fff)',
  border: '1px solid var(--nx-border, #2d3138)',
  borderRadius: 3,
  cursor: 'pointer',
  fontSize: 12,
};

const modalDisabledButtonStyle: React.CSSProperties = {
  ...modalPrimaryButtonStyle,
  background: 'var(--nx-text-3, #6b7280)',
  borderColor: 'var(--nx-text-3, #6b7280)',
  cursor: 'default',
  opacity: 0.6,
};
