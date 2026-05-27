/**
 * presenceEnriched.ts — Extended per-user presence beyond cursor.
 *
 * The base `PresenceState` (in `yjsDoc.ts`) covers cursor position.
 * Real collaboration needs more context: who is currently editing
 * which feature, which face is hovered, what tool is active. Without
 * that the other user just sees a cursor moving — they don't know
 * whether to wait, jump in, or take over.
 *
 * State synced via Yjs Awareness (ephemeral, not persisted):
 *   - selection: currently-selected feature / face / edge id.
 *   - hover: hover-highlighted element id.
 *   - tool: active tool name (`sketch.line`, `assembly.mate`, etc.).
 *   - editing: feature id being interactively edited (drag, slider).
 *
 * All fields are optional and self-expiring — when a user goes
 * inactive, awareness flushes their state automatically. This module
 * just provides the typed shape and helpers for read/write.
 */

import type { Awareness } from 'y-protocols/awareness';

export interface EnrichedPresence {
  /** Display name. */
  name?: string;
  /** Stable colour for cursor / selection outline. */
  color?: string;
  /** Currently selected element id (feature / face / edge / mate). */
  selectionId?: string;
  /** Element id currently under hover highlight. */
  hoverId?: string;
  /** Active tool the user is wielding right now. */
  tool?: string;
  /** Feature id being interactively edited (slider drag / numpad). */
  editingId?: string;
  /** ms timestamp of last update — clients can dim stale presences. */
  lastActivity?: number;
}

/** Merge a partial presence patch into the local awareness state. The
 *  Awareness API replaces the whole local state per call, so we
 *  read-modify-write to preserve unchanged fields. */
export function setPresencePatch(awareness: Awareness, patch: Partial<EnrichedPresence>): void {
  const current = (awareness.getLocalState() ?? {}) as EnrichedPresence;
  const next: EnrichedPresence = {
    ...current,
    ...patch,
    lastActivity: Date.now(),
  };
  awareness.setLocalState(next);
}

/** Read every other user's presence (excluding self). Sorted by name
 *  so the cursor / panel UI renders deterministically. */
export function readRemotePresences(awareness: Awareness): Array<{ clientId: number; state: EnrichedPresence }> {
  const out: Array<{ clientId: number; state: EnrichedPresence }> = [];
  const selfId = awareness.clientID;
  awareness.getStates().forEach((state, clientId) => {
    if (clientId === selfId) return;
    out.push({ clientId, state: state as EnrichedPresence });
  });
  out.sort((a, b) => {
    const an = a.state.name ?? '';
    const bn = b.state.name ?? '';
    return an.localeCompare(bn);
  });
  return out;
}

/** Filter presences by activity recency. Useful for the "active users"
 *  badge — drop anyone idle > N seconds. */
export function activePresences(
  presences: Array<{ clientId: number; state: EnrichedPresence }>,
  maxIdleMs = 30_000,
  now: number = Date.now(),
): Array<{ clientId: number; state: EnrichedPresence }> {
  return presences.filter(({ state }) => {
    if (typeof state.lastActivity !== 'number') return false;
    return now - state.lastActivity <= maxIdleMs;
  });
}

/** Find any other user editing the same element as we are. Used to
 *  show a "{user} is editing this" hint before we start dragging.
 *  Returns the first match — handling N-way concurrent edits is rare
 *  enough that one user gets the warning. */
export function findEditingPeer(
  awareness: Awareness,
  elementId: string,
): { clientId: number; state: EnrichedPresence } | null {
  const selfId = awareness.clientID;
  const states = awareness.getStates();
  for (const [clientId, state] of states) {
    if (clientId === selfId) continue;
    const p = state as EnrichedPresence;
    if (p.editingId === elementId) return { clientId, state: p };
  }
  return null;
}

/** Convenience: clear a particular field of our local presence. Avoids
 *  the "tool stays sticky after I switch away" UX bug. */
export function clearPresenceField(awareness: Awareness, field: keyof EnrichedPresence): void {
  const current = (awareness.getLocalState() ?? {}) as EnrichedPresence;
  const next = { ...current, lastActivity: Date.now() };
  delete next[field];
  awareness.setLocalState(next);
}
