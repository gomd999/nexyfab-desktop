/**
 * K (Stage 4) — Multi-user CAD collab adapter (Yjs-shaped).
 *
 * The agent runs server-side, but a CAD design is fundamentally shared
 * state — multiple users (or multiple agent sessions) may want to edit
 * the same project concurrently. Onshape solves this with proprietary
 * geometric merge; we lean on Yjs CRDTs for the conflict-free part of
 * the state (text-like metadata) and sequencing for the geometric part
 * (B-rep ops applied in causal order).
 *
 * This module defines the *adapter shape* the agent will consume — the
 * actual Yjs wiring lives in NexyFab's existing collab layer
 * (`@/hooks/useCollabPolling`, memory mentions Yjs is already vendored
 * for the broader app). The agent only needs to know:
 *
 *   - "Is this session shared with anyone else?" → isCollaborative()
 *   - "Lock these handles before I edit" → acquireLock()
 *   - "Broadcast my new B-rep state" → applyOp()
 *
 * Adapter is optional — when absent, the agent runs single-user.
 */

import type { AgentSession } from './types';

export interface CollabPresence {
  /** Stable id of a participant (user id or agent session id). */
  id: string;
  /** Display label. */
  label: string;
  /** True if this presence corresponds to the local agent. */
  self: boolean;
}

/**
 * A geometric op the agent has just applied. Broadcast to peers so their
 * sessions can mirror state. Bigger than text ops — a B-rep handle creation
 * or a sketch_solve outcome is what others see.
 */
export type AgentOp =
  | { type: 'brep_added'; handle: string; kind: string }
  | { type: 'brep_removed'; handle: string }
  | { type: 'sketch_updated'; sketchName: string }
  | { type: 'mate_added'; mateId: string }
  | { type: 'mates_solved'; transforms: Record<string, [number, number, number]> }
  | { type: 'render_completed'; ok: boolean; triangleCount?: number };

export interface CollabLock {
  /** Resource identifier — handle, sketch name, or 'session'. */
  resource: string;
  /** True iff acquired (false → another participant holds it). */
  acquired: boolean;
  /** Who holds the lock if not us. */
  holder?: string;
}

export interface CollabAdapter {
  /** Is multi-user mode active for this session? */
  isCollaborative(session: AgentSession): boolean;
  /** Current participant roster (including us). */
  presence(session: AgentSession): Promise<CollabPresence[]>;
  /**
   * Acquire an advisory lock on a resource (B-rep handle, sketch name, or
   * the whole session). Returns immediately — does NOT block. Caller decides
   * how to proceed when not acquired.
   */
  acquireLock(session: AgentSession, resource: string, ttlMs?: number): Promise<CollabLock>;
  /** Release a previously acquired lock. */
  releaseLock(session: AgentSession, resource: string): Promise<void>;
  /** Broadcast an op so peers can mirror it. Fire-and-forget. */
  applyOp(session: AgentSession, op: AgentOp): Promise<void>;
}

// ─── Default no-op adapter (single-user mode) ───────────────────────────

/**
 * Default adapter used when collab isn't wired up. Treats the session
 * as solo — no peers, all locks acquired, broadcasts are no-ops.
 *
 * Production swaps this for `serverCollabAdapter` (Yjs-backed) at the
 * route layer when the project is shared.
 */
export const SOLO_COLLAB_ADAPTER: CollabAdapter = {
  isCollaborative() { return false; },
  async presence(session) {
    return [{ id: session.id, label: 'You (solo)', self: true }];
  },
  async acquireLock(_session, resource) {
    return { resource, acquired: true };
  },
  async releaseLock() { /* noop */ },
  async applyOp() { /* noop */ },
};
