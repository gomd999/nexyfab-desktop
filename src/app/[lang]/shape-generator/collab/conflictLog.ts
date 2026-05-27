/**
 * conflictLog.ts — Detect and report last-writer-wins (LWW) overwrites
 * in concurrent CRDT edits.
 *
 * Yjs guarantees merge convergence but at the per-key level it's LWW —
 * when two users set the same Y.Map key at the same time, one side's
 * value disappears. From the user's perspective they made a change
 * and it silently reverted. This module catches those events so the
 * UI can surface "your edit was overwritten by {other user}, click
 * to restore".
 *
 * Approach:
 *   1. Track each user's local edit intent (key + value + timestamp).
 *   2. Observe the shared doc's update stream; when a key's value
 *      changes to something different from this user's last intent
 *      WITHIN the conflict window, flag it as a conflict.
 *   3. Emit a structured `ConflictEvent` the chat / banner picks up.
 *
 * Trade-off: the implementation here is the "intent-vs-observed"
 * detector, not the full Yjs internals. It misses LWW that happens
 * during the same Yjs transaction (where intent and observed are the
 * same). That's acceptable — those are by-design merges, not
 * user-visible conflicts.
 */

export interface ConflictIntent {
  /** Stable id of the user making the edit. */
  userId: string;
  /** Stable id of the field being edited (e.g. `mate.m1.distance`). */
  field: string;
  /** Value the user wrote. JSON-serialisable. */
  value: unknown;
  /** Timestamp the local edit was made (ms epoch). */
  timestamp: number;
}

export interface ConflictEvent {
  /** Field that was overwritten. */
  field: string;
  /** Who lost the edit (the user whose intent didn't win). */
  loserUserId: string;
  /** Value that the loser wrote. */
  loserValue: unknown;
  /** Who won — when known from the incoming update's origin field. */
  winnerUserId: string | null;
  /** Value that's now in the shared doc. */
  winnerValue: unknown;
  /** When the conflict was detected (ms epoch). */
  detectedAt: number;
}

/**
 * Conflict detector. Track local intents via `recordIntent`; observe
 * incoming changes via `observeChange`. Each detected conflict is
 * emitted to the supplied callback.
 */
export class ConflictDetector {
  private readonly intents = new Map<string, ConflictIntent>();
  private readonly listeners: Array<(e: ConflictEvent) => void> = [];

  /** Window (ms) within which an "observed change" to a recently-set
   *  field counts as overwriting our intent. Default: 5 seconds. */
  conflictWindowMs = 5_000;

  /** Hook called for each detected conflict. */
  onConflict(fn: (e: ConflictEvent) => void): () => void {
    this.listeners.push(fn);
    return () => {
      const i = this.listeners.indexOf(fn);
      if (i !== -1) this.listeners.splice(i, 1);
    };
  }

  /** Record this user's local intent to set a field. Called from the
   *  UI handler that mutates the shared doc. */
  recordIntent(intent: ConflictIntent): void {
    this.intents.set(intent.field, intent);
  }

  /** Forget intent for a field (e.g. when the user explicitly reverts). */
  clearIntent(field: string): void {
    this.intents.delete(field);
  }

  /** Observe a value change that came from the shared doc. When the
   *  observed value differs from our last intent for the same field
   *  within the conflict window, emit a conflict event.
   *
   *  `originUserId` is the user the change came from (when known); if
   *  null, we treat it as "external" and report `winnerUserId = null`. */
  observeChange(field: string, value: unknown, originUserId: string | null, observedAt: number = Date.now()): ConflictEvent | null {
    const intent = this.intents.get(field);
    if (!intent) return null;
    // Same user as us → not a conflict, our own intent landed.
    if (originUserId !== null && originUserId === intent.userId) return null;
    // Outside the conflict window → user has moved on, don't bug them.
    if (observedAt - intent.timestamp > this.conflictWindowMs) return null;
    // Same value → not actually a conflict, just an echo.
    if (deepEqual(value, intent.value)) return null;

    const event: ConflictEvent = {
      field,
      loserUserId: intent.userId,
      loserValue: intent.value,
      winnerUserId: originUserId,
      winnerValue: value,
      detectedAt: observedAt,
    };
    // Clear so we don't double-fire on subsequent observations.
    this.intents.delete(field);
    for (const fn of this.listeners) fn(event);
    return event;
  }

  /** Drop all tracked intents (e.g. on session end). */
  reset(): void {
    this.intents.clear();
  }
}

/** Cheap deep-equal — JSON.stringify works for the value types we
 *  store (numbers, strings, arrays, plain objects). NaN-tolerant. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') {
    return (Number.isNaN(a) && Number.isNaN(b)) || a === b;
  }
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}
