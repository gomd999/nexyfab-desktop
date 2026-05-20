/**
 * collabUndo.ts — Collaboration-aware undo / redo using Y.UndoManager.
 *
 * The single-user undo stack reverts everything in the document; in a
 * multi-user session that would also revert OTHER users' edits, which
 * is famously wrong (Google Docs handles this by scoping undo to the
 * local user's edits). Yjs ships `Y.UndoManager` which does exactly
 * that — it only tracks operations whose origin matches the local
 * user, so undo / redo reverts your own edits and leaves the rest
 * alone.
 *
 * This module wraps Y.UndoManager with:
 *   - Single entry-point for both sketch + assembly + feature-tree
 *     types (each scope can have its own UndoManager but typically
 *     one global is fine).
 *   - Convenience helpers for `setOrigin` so the caller's edit funnel
 *     can ensure all writes go through the right transaction origin.
 *   - Stack-size + clear helpers for memory management.
 */

import * as Y from 'yjs';

export interface CollabUndoOptions {
  /** Yjs types that should participate in undo / redo. Loose generic
   *  because Y.AbstractType<X> is invariant in X — callers pass any
   *  Y.Map / Y.Array / Y.Text instance. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  trackedTypes: Array<Y.AbstractType<any>>;
  /** Local user identifier used as transaction origin. Operations
   *  authored under this origin are the only ones the manager tracks. */
  localOrigin: string;
  /** Capture timer — operations within this window merge into a single
   *  undo step. Default 500ms (Y.UndoManager default). */
  captureTimeoutMs?: number;
}

export class CollabUndoManager {
  private readonly mgr: Y.UndoManager;
  readonly localOrigin: string;

  constructor(opts: CollabUndoOptions) {
    this.localOrigin = opts.localOrigin;
    this.mgr = new Y.UndoManager(opts.trackedTypes, {
      trackedOrigins: new Set([opts.localOrigin]),
      captureTimeout: opts.captureTimeoutMs ?? 500,
    });
  }

  /** Wrap a mutation in a transaction tagged with the local origin so
   *  Y.UndoManager picks it up. */
  transact(doc: Y.Doc, mutator: () => void): void {
    doc.transact(mutator, this.localOrigin);
  }

  /** Pop the last local edit. Returns true when an undo was performed. */
  undo(): boolean {
    const item = this.mgr.undo();
    return item !== null && item !== undefined;
  }

  /** Re-apply the last undone local edit. Returns true when a redo
   *  was performed. */
  redo(): boolean {
    const item = this.mgr.redo();
    return item !== null && item !== undefined;
  }

  /** Whether anything is on the undo stack. */
  canUndo(): boolean { return this.mgr.undoStack.length > 0; }
  /** Whether anything is on the redo stack. */
  canRedo(): boolean { return this.mgr.redoStack.length > 0; }

  /** Stack sizes — handy for the toolbar button enabled state. */
  undoStackSize(): number { return this.mgr.undoStack.length; }
  redoStackSize(): number { return this.mgr.redoStack.length; }

  /** Wipe both stacks. Called when the user signals "this is a new
   *  edit session, drop the history" (file open, share link join). */
  clear(): void {
    this.mgr.clear();
  }

  /** Release the underlying observers — call on unmount. */
  destroy(): void {
    this.mgr.destroy();
  }
}
