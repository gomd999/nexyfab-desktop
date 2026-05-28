/**
 * commitStack.ts — Wave 2 Phase 3 Track E5 (W7).
 *
 * Stack-level commit-to-history orchestrator. Walks the direct-edit
 * `DirectEditStack.ops` in order, maps each to a `HistoryNode` via
 * `directEditOpToHistoryNode`, and collects the results.
 *
 * Partial-commit semantics (ADR-012 §6 + E5 brief §4):
 *   - The mapper runs op-by-op in stack order.
 *   - On the FIRST rejection the orchestrator stops mapping and returns
 *     `{ ok: false, partialNodes }` carrying every node that mapped
 *     successfully BEFORE the rejection.
 *   - The UI (CommitToHistoryButton modal) can then offer two paths:
 *       1. "Commit partial" — caller passes the partialNodes to its
 *          `appendNodes` callback, then trims the prefix from the stack
 *          via `controller.popOp` × N (or a single `clearPrefix(N)`).
 *       2. "Cancel" — caller does nothing, the stack stays intact.
 *   - On full success the orchestrator runs `appendNodes` once and
 *     clears the entire stack.
 *
 * Ordering invariant: successes occupy stack positions [0..k-1] and
 * the failure is at position k. All ops at positions [k+1..N-1] are
 * NOT inspected — leaving them in place preserves the property that
 * "failed ops live at the FRONT of the surviving stack after a partial
 * commit". The UI label "M-N could not be mapped" reflects the gap.
 */

import type { HistoryNode } from '../useFeatureStack';
import type { DirectEditStack } from './directEditTypes';
import {
  directEditOpToHistoryNode,
  type CommitContext,
  type CommitRejectionReason,
} from './commitToHistory';

export type CommitStackResult =
  | {
      ok: true;
      /** Nodes appended to the history, in stack order. */
      appendedNodes: HistoryNode[];
      /** Number of ops removed from the stack (== appendedNodes.length). */
      clearedOps: number;
    }
  | {
      ok: false;
      reason: CommitRejectionReason;
      /** Successfully mapped nodes BEFORE the failing op. Caller may
       *  choose to commit these via `appendNodes` and pop the
       *  corresponding prefix from the stack. */
      partialNodes: HistoryNode[];
      /** Stack index of the first op that failed to map. */
      failedAt: number;
    };

/** Extra callbacks the stack-level commit needs beyond the per-op
 *  mapper's `CommitContext`. The host supplies these — the orchestrator
 *  stays free of React / FeatureStack imports. */
export interface StackCommitCallbacks {
  /** Append a batch of synthesized nodes to the parametric history.
   *  The host is expected to wire this to `useFeatureStack.addNode`
   *  (or the lower-level `replaceHistory`) and to bump the active node
   *  id to the LAST appended node so subsequent UI operations land on
   *  the freshly-committed tail. */
  appendNodes: (nodes: HistoryNode[]) => void;
  /** Clear the direct-edit stack. Called after `appendNodes` so the
   *  ordering invariant "the stack ALWAYS reflects pending uncommitted
   *  ops" survives a commit-then-rerun round-trip. */
  clearStack: () => void;
  /** Optional callback fired right before the toast event would
   *  normally trigger the "history was rerun" invalidation. The
   *  controller wires this to suppress the toast when the history bump
   *  is caused by THIS commit (not by an external rerun). */
  beginCommit?: () => void;
  /** Mirror of `beginCommit` — fires after the commit completes (or
   *  fails). Used to re-enable the invalidation toast for subsequent
   *  bumps. */
  endCommit?: () => void;
}

/**
 * Commit every op in `stack` to history. Either fully succeeds (clears
 * the stack + appends N nodes) or fully fails (no side effects, returns
 * the prefix that WOULD have committed).
 *
 * On a partial-failure result the caller may follow up with
 * `commitPartialNodes` to commit just the prefix.
 */
export function commitDirectEditStackToHistory(
  stack: DirectEditStack,
  ctx: CommitContext,
  cb: StackCommitCallbacks,
): CommitStackResult {
  if (stack.ops.length === 0) {
    return { ok: true, appendedNodes: [], clearedOps: 0 };
  }

  const successes: HistoryNode[] = [];
  for (let i = 0; i < stack.ops.length; i++) {
    const op = stack.ops[i]!;
    const r = directEditOpToHistoryNode(op, ctx);
    if (!r.ok) {
      // First failure — stop mapping. Side effects deferred until the
      // caller decides between full-rollback and partial commit.
      return {
        ok: false,
        reason: r.reason,
        partialNodes: successes,
        failedAt: i,
      };
    }
    successes.push(r.node);
  }

  // Full success — fire callbacks in order: beginCommit → appendNodes
  // → clearStack → endCommit. The host uses the begin/end pair to
  // suppress the invalidation toast that would otherwise fire when the
  // history version bumps from the append.
  cb.beginCommit?.();
  try {
    cb.appendNodes(successes);
    cb.clearStack();
  } finally {
    cb.endCommit?.();
  }

  return {
    ok: true,
    appendedNodes: successes,
    clearedOps: successes.length,
  };
}

/**
 * Best-effort partial commit. Called by the UI when the user clicks
 * "Commit partial" after a mapper rejection. Appends the prefix and
 * removes ONLY the corresponding ops from the front of the stack.
 *
 * The caller is responsible for passing the `partialNodes` from a
 * prior `commitDirectEditStackToHistory` result and the matching
 * `failedAt` index — this function does not re-run the mapper. That
 * keeps the partial-commit path deterministic with respect to the
 * earlier user-facing modal preview.
 */
export function commitPartialNodes(
  partialNodes: HistoryNode[],
  failedAt: number,
  cb: StackCommitCallbacks & {
    /** Pop the first `count` ops from the stack (preserving the
     *  remaining ops in their original order). The host wires this to
     *  a private setter on the controller (`shiftOps(count)`). */
    shiftOps: (count: number) => void;
  },
): { appendedCount: number; remainingFailedAt: number } {
  if (partialNodes.length === 0) {
    return { appendedCount: 0, remainingFailedAt: failedAt };
  }
  cb.beginCommit?.();
  try {
    cb.appendNodes(partialNodes);
    cb.shiftOps(partialNodes.length);
  } finally {
    cb.endCommit?.();
  }
  // The failing op is now at position 0 (everything before it was
  // popped). Surface the new index so the UI can re-message the
  // remaining state without re-walking the stack.
  return {
    appendedCount: partialNodes.length,
    remainingFailedAt: 0,
  };
}
