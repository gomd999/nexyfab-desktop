/**
 * editOriginTracker.ts — Per-feature origin tagging so AI edits and
 * human edits can be undone independently.
 *
 * Without origin awareness, a single Ctrl+Z would undo *whatever
 * happened last* — sometimes AI work, sometimes user work,
 * depending on order. Users found this confusing in beta:
 * "I edited a dimension and then Ctrl+Z undid the AI's whole
 * fillet generation". The fix is to keep separate undo stacks per
 * origin.
 *
 * Pattern modeled on memory `nexyfab-collab-crdt`'s
 * `originIsolatedUndo` (Yjs-style) — the same idea applied to the
 * local feature store rather than the CRDT doc.
 *
 * This module is the *registry*: it records every feature mutation
 * along with origin ('ai' / 'human'), and exposes
 * `nextUndoForOrigin(origin)` so the UI can offer separate undo
 * shortcuts ("Undo my last edit" / "Undo AI's last edit"). The
 * actual reversal still uses the existing feature store's APIs.
 */

import type { FeatureInstance } from '../features/types';

export type EditOrigin = 'human' | 'ai';

export type EditAction =
  | { kind: 'add'; feature: FeatureInstance }
  | { kind: 'remove'; feature: FeatureInstance }
  | { kind: 'update_param'; featureId: string; paramKey: string; before: number; after: number }
  | { kind: 'move'; featureId: string; before: number; after: number }
  | { kind: 'toggle'; featureId: string; before: boolean; after: boolean };

export interface EditRecord {
  /** Wall-clock timestamp. */
  timestamp: number;
  origin: EditOrigin;
  action: EditAction;
  /** Optional batch id — group consecutive related actions (e.g.
   *  one AI call inserting 5 features all share the same batch). */
  batchId?: string;
}

export class EditOriginTracker {
  private records: EditRecord[] = [];
  private maxRecords: number;

  constructor(opts: { maxRecords?: number } = {}) {
    this.maxRecords = opts.maxRecords ?? 200;
  }

  /** Record a mutation. */
  record(origin: EditOrigin, action: EditAction, batchId?: string): void {
    this.records.push({
      timestamp: Date.now(),
      origin,
      action,
      batchId,
    });
    if (this.records.length > this.maxRecords) {
      this.records = this.records.slice(-this.maxRecords);
    }
  }

  /** Records as immutable snapshot — useful for inspection / tests. */
  snapshot(): readonly EditRecord[] {
    return this.records.slice();
  }

  /** The most recent record made by the given origin. */
  lastFor(origin: EditOrigin): EditRecord | null {
    for (let i = this.records.length - 1; i >= 0; i--) {
      if (this.records[i]!.origin === origin) return this.records[i]!;
    }
    return null;
  }

  /** All records that share the same batch as the most recent
   *  origin-action — used so "Undo AI" reverses the entire batch
   *  (5 features inserted in one call) instead of just the last
   *  feature. Returns newest first. */
  lastBatchFor(origin: EditOrigin): EditRecord[] {
    const last = this.lastFor(origin);
    if (!last) return [];
    if (!last.batchId) return [last];
    return this.records
      .filter(r => r.origin === origin && r.batchId === last.batchId)
      .reverse();
  }

  /** Drop the most recent batch for the given origin. Used after a
   *  successful undo. */
  popLastBatch(origin: EditOrigin): EditRecord[] {
    const batch = this.lastBatchFor(origin);
    if (batch.length === 0) return [];
    const idsToRemove = new Set(batch);
    this.records = this.records.filter(r => !idsToRemove.has(r));
    return batch;
  }

  /** Total record count (per origin). */
  count(origin?: EditOrigin): number {
    if (!origin) return this.records.length;
    return this.records.filter(r => r.origin === origin).length;
  }

  /** Reset — used when project loads / version restore. */
  reset(): void {
    this.records = [];
  }
}

/** Generate a stable batch id from a logical AI operation. */
let batchCounter = 0;
export function nextBatchId(): string {
  return `b_${Date.now().toString(36)}_${++batchCounter}`;
}
