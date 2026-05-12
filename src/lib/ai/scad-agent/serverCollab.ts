/**
 * K (Stage 4 wired) — server-side collab adapter.
 *
 * The agent runs server-side per request, so it can't directly read the
 * Y.js awareness map (that's client-side, peer-to-peer). Instead the
 * client passes a snapshot of the live participant roster on each
 * agent invocation, and the server holds an advisory-lock table in
 * process memory keyed by `(projectId, resource)`.
 *
 * Limits / scope:
 *   - In-memory locks survive only within one process. For Railway with
 *     multiple replicas this is a soft consistency model; if a strong
 *     lock is needed, swap the Map for Redis (interface unchanged).
 *   - Locks have a TTL — if the holder crashes mid-edit, the lock auto-
 *     releases. Default 60s, configurable per-call.
 *   - Presence list comes from the client and is *advisory*. The agent
 *     uses it for "should I take a lock first?" decisions but never
 *     enforces it as a security boundary.
 */
import type { CollabAdapter, CollabPresence } from './collab';

interface LockRow {
  resource: string;
  holder: string;
  expiresAtMs: number;
}

/** S — Stored op event for replay / catch-up to peers that joined late. */
interface OpEvent {
  ts: number;
  fromSessionId: string;
  op: import('./collab').AgentOp;
}

/** Module-scoped lock table. Use Redis behind this interface for HA. */
const LOCKS = new Map<string, LockRow>();
/** Per-session participant snapshots, populated by the route from the
 *  client's `collab` payload. Same caveat as LOCKS. */
const PARTICIPANTS = new Map<string, CollabPresence[]>();
/**
 * S — Per-project op log. v0 uses session.id as the project key (same as
 * locks). For multi-tenant, prepend projectId. Capped at 1000 ops/session.
 */
const OP_LOG = new Map<string, OpEvent[]>();
const OP_LOG_CAP = 1000;
/** S — In-process subscribers for live op fan-out. */
const OP_SUBSCRIBERS = new Map<string, Set<(ev: OpEvent) => void>>();

// v0: lock keyed by resource only — global across all agent sessions
// in this process. For multi-tenant, prepend projectId once AgentSession
// carries it.
function lockKey(_sessionId: string, resource: string): string {
  return resource;
}

function gc(): void {
  const now = Date.now();
  for (const [k, row] of LOCKS) {
    if (row.expiresAtMs < now) LOCKS.delete(k);
  }
}

/**
 * Route layer calls this on each POST /api/nexyfab/scad-agent request
 * to refresh the server's view of who's in the project.
 */
export function setSessionParticipants(sessionId: string, peers: CollabPresence[]): void {
  PARTICIPANTS.set(sessionId, peers);
}

export function clearSessionParticipants(sessionId: string): void {
  PARTICIPANTS.delete(sessionId);
}

export const serverCollabAdapter: CollabAdapter = {
  isCollaborative(session) {
    const peers = PARTICIPANTS.get(session.id);
    return !!(peers && peers.length > 1);
  },

  async presence(session) {
    const peers = PARTICIPANTS.get(session.id);
    if (!peers || peers.length === 0) {
      return [{ id: session.id, label: 'You (solo)', self: true }];
    }
    // Ensure the local agent itself is included; if the client didn't add us,
    // synthesize a self entry so list is never empty.
    if (!peers.some(p => p.self)) {
      return [{ id: session.id, label: 'Agent (you)', self: true }, ...peers];
    }
    return peers;
  },

  async acquireLock(session, resource, ttlMs = 60_000) {
    gc();
    const key = lockKey(session.id, resource);
    const existing = LOCKS.get(key);
    const now = Date.now();
    if (existing && existing.expiresAtMs > now && existing.holder !== session.id) {
      return { resource, acquired: false, holder: existing.holder };
    }
    LOCKS.set(key, {
      resource,
      holder: session.id,
      expiresAtMs: now + Math.max(1_000, Math.min(600_000, ttlMs)),
    });
    return { resource, acquired: true };
  },

  async releaseLock(session, resource) {
    const key = lockKey(session.id, resource);
    const row = LOCKS.get(key);
    if (row && row.holder === session.id) LOCKS.delete(key);
  },

  async applyOp(session, op) {
    // S — append to op log + fan out to live subscribers. Both are
    // best-effort: an exception in a subscriber must not break the
    // agent's tool flow.
    const ev: OpEvent = { ts: Date.now(), fromSessionId: session.id, op };
    let log = OP_LOG.get(session.id);
    if (!log) { log = []; OP_LOG.set(session.id, log); }
    log.push(ev);
    if (log.length > OP_LOG_CAP) log.splice(0, log.length - OP_LOG_CAP);
    const subs = OP_SUBSCRIBERS.get(session.id);
    if (subs) {
      for (const fn of subs) {
        try { fn(ev); } catch (e) { console.warn('[collab] op subscriber threw', e); }
      }
    }
  },
};

// ─── S — Subscription / replay helpers (used by route SSE) ─────────────

/** Pull all ops broadcast in this project after the given timestamp. Used
 *  by a peer's catch-up call when their connection drops + reconnects. */
export function pollOps(projectKey: string, afterMs = 0): readonly OpEvent[] {
  const log = OP_LOG.get(projectKey);
  if (!log) return [];
  return log.filter(ev => ev.ts > afterMs);
}

/** Subscribe to live op events. Returns an unsubscribe function. */
export function subscribeOps(projectKey: string, fn: (ev: OpEvent) => void): () => void {
  let set = OP_SUBSCRIBERS.get(projectKey);
  if (!set) { set = new Set(); OP_SUBSCRIBERS.set(projectKey, set); }
  set.add(fn);
  return () => {
    set?.delete(fn);
    if (set && set.size === 0) OP_SUBSCRIBERS.delete(projectKey);
  };
}

// ─── Test helpers ──────────────────────────────────────────────────────
/** Reset all collab state. Used by vitest between tests. */
export function _resetCollabState(): void {
  LOCKS.clear();
  PARTICIPANTS.clear();
  OP_LOG.clear();
  OP_SUBSCRIBERS.clear();
}

export function _peekLocks(): ReadonlyMap<string, LockRow> {
  return LOCKS;
}
