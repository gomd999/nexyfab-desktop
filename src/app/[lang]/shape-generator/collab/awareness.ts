/**
 * awareness.ts — Wave 2 Phase 3 W1 Track Z1.
 *
 * Pure helpers around the Yjs Awareness protocol (`y-protocols/awareness`).
 *
 * Awareness is the ephemeral sibling of the persistent CRDT: cursor positions,
 * selection set, "X is editing this" hints. None of it persists; on disconnect
 * the peer state is auto-removed by the protocol.
 *
 * This module deliberately stays decoupled from the React Provider — every
 * helper takes an `Awareness` instance, never reads from a global. That keeps
 * the same helpers usable from non-React surfaces (Tauri menu commands, CLI
 * import-wizard, future server-side preview renderer).
 *
 * Z1 only ships the read/write primitives + the color hash. The actual cursor
 * + selection UI is wired in Z2/Z3 (those weeks consume these helpers).
 */

import type { Awareness } from 'y-protocols/awareness';

// ─── Wire shape ─────────────────────────────────────────────────────────────

/**
 * What every peer publishes about itself via awareness. All fields except
 * `id`/`name`/`color` are optional — the consumer must be defensive.
 *
 * `cursor.viewport` is a free-form tag the consumer chooses: 'sketch',
 * 'modeling', 'drawing', ...; multiple modeling surfaces share an awareness
 * channel and the viewport tag lets each one filter the cursors it draws.
 */
export interface PeerInfo {
  /** Stable per-peer uuid for this session. Survives reconnects within one tab. */
  id: string;
  /** Display name for cursor labels / presence panel. */
  name: string;
  /** HSL string assigned deterministically from `id`. */
  color: string;
  /** 2D screen-space cursor in viewport-local coords, mm-scale. */
  cursor?: { x: number; y: number; viewport: string } | null;
  /** Currently-selected feature / face / edge / dim ids. */
  selection?: string[];
  /** Feature-tree node id this peer is currently editing (drag, slider). */
  activeNodeId?: string | null;
  /** Last activity ms — clients dim stale presences past N seconds. */
  ts?: number;
}

// ─── Color palette ──────────────────────────────────────────────────────────

/** FNV-1a-ish 32-bit hash. Cheap, deterministic, no deps. */
function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/**
 * Map a peer id to an HSL color. Deterministic so the same peer always lands
 * on the same hue across tabs / reconnects.
 *
 * We anchor saturation/lightness within a "tasteful" band so all peer colors
 * look visually consistent against the dark CAD background — never neon, never
 * muddy. The hue is the only thing the hash gets to pick.
 */
export function peerColorFromId(id: string): string {
  if (typeof id !== 'string' || id.length === 0) {
    return 'hsl(0, 0%, 60%)';
  }
  const hue = hashString(id) % 360;
  // Saturation 65%, lightness 58% — passes WCAG AA on the #0a0a0a panel bg.
  return `hsl(${hue}, 65%, 58%)`;
}

// ─── Encode / decode ────────────────────────────────────────────────────────

/**
 * Merge a partial patch into the local awareness state. The Awareness API
 * replaces the whole local state per call, so we read-modify-write to preserve
 * unchanged fields. Always stamps `ts: Date.now()` so peers can age stale
 * presences out of the panel.
 *
 * Caller must have already initialized `id`, `name`, `color` (the Provider
 * does this on mount). Passing only deltas (e.g. `{ cursor: ... }`) is the
 * intended hot-path for cursor moves.
 */
export function encodeLocalPresence(awareness: Awareness, patch: Partial<PeerInfo>): void {
  const current = (awareness.getLocalState() ?? {}) as Partial<PeerInfo>;
  const next: Partial<PeerInfo> = {
    ...current,
    ...patch,
    ts: Date.now(),
  };
  awareness.setLocalState(next);
}

/**
 * Snapshot every remote peer's state (excludes self) as a keyed record.
 * Yjs Awareness uses numeric `clientID`s; we re-key by the peer's logical
 * `id` (the uuid the Provider assigns) so consumers can correlate across
 * disconnect/reconnect cycles.
 *
 * Peers without a logical `id` (e.g. a half-initialized handshake) are
 * dropped — better to skip them than render a partial cursor.
 */
export function decodeRemotePresence(awareness: Awareness): Record<string, PeerInfo> {
  const out: Record<string, PeerInfo> = {};
  const selfClientId = awareness.clientID;
  awareness.getStates().forEach((rawState, clientId) => {
    if (clientId === selfClientId) return;
    const state = (rawState ?? {}) as Partial<PeerInfo>;
    if (!state.id || typeof state.id !== 'string') return;
    if (!state.name || typeof state.name !== 'string') return;
    if (!state.color || typeof state.color !== 'string') return;
    out[state.id] = {
      id: state.id,
      name: state.name,
      color: state.color,
      cursor: state.cursor ?? null,
      selection: state.selection ?? [],
      activeNodeId: state.activeNodeId ?? null,
      ts: typeof state.ts === 'number' ? state.ts : undefined,
    };
  });
  return out;
}

/**
 * Read the local peer's published state. Returns `null` until the Provider
 * has set initial fields. After mount the Provider guarantees at least
 * `{ id, name, color }`.
 */
export function readLocalPresence(awareness: Awareness): PeerInfo | null {
  const raw = awareness.getLocalState() as Partial<PeerInfo> | null;
  if (!raw || !raw.id || !raw.name || !raw.color) return null;
  return {
    id: raw.id,
    name: raw.name,
    color: raw.color,
    cursor: raw.cursor ?? null,
    selection: raw.selection ?? [],
    activeNodeId: raw.activeNodeId ?? null,
    ts: typeof raw.ts === 'number' ? raw.ts : undefined,
  };
}

/**
 * Generate a random peer id. The Provider uses this on mount and persists the
 * value in memory for the session lifetime. We deliberately do NOT persist to
 * localStorage — re-opening the doc starts a fresh session, which matches the
 * mental model of "each tab is its own presence".
 *
 * Uses `crypto.randomUUID` when available (browsers + Node 18+); falls back
 * to a Math.random pseudoseq for environments without crypto (older Tauri).
 */
export function generatePeerId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback — adequate for collision avoidance within one room.
  return 'peer-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Default name for the local peer until the app feeds in a real one. */
export function defaultPeerName(id: string): string {
  return `User ${id.slice(0, 4)}`;
}
