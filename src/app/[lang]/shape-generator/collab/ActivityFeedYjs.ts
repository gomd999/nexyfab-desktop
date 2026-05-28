/**
 * ActivityFeedYjs.ts — Wave 2 Phase 3 W7 Track Z7.
 *
 * Y.Doc binding for the activity feed log. Mirrors the sketchYjs /
 * featureTreeYjs / configStoreYjs patterns so the feel is identical to
 * the other CRDT sub-trees.
 *
 *   Y.Doc (workspace-scoped — the same doc CollabProvider wraps)
 *   └── activity: Y.Array<Y.Map>           ← newest-first, capped at 50
 *         └── (each ActivityEntry encoded as Y.Map fields)
 *
 * Why Y.Array (not Y.Map keyed by id):
 *   - Activity is intrinsically ordered (chronological). Two peers
 *     appending in the same millisecond on different clocks merge by
 *     Y.Array's deterministic linearisation; both entries survive.
 *   - Dedup by entry id is the reader's job (`mergeActivityLogs` in
 *     activityFeed.ts) — readers always wrap raw Y.Array output through
 *     `readActivityLog` which de-dupes anyway.
 *
 * 50-cap enforcement:
 *   At append time. After the new entry is unshifted at index 0, any
 *   excess at the tail is deleted in the same `doc.transact`. This keeps
 *   the array bounded without a periodic sweep, matching the
 *   `appendActivityEntry` pure helper's behaviour.
 *
 * Origins:
 *   - ORIGIN_LOCAL_UI       — local peer appended.
 *   - ORIGIN_REMOTE_UPDATE  — `Y.applyUpdate` from a peer.
 */

import * as Y from 'yjs';
import {
  ACTIVITY_LOG_CAP,
  type ActivityEntry,
  type ActivityKind,
} from './activityFeed';

// ─── Wire-format constants ─────────────────────────────────────────────────

const ACTIVITY_ROOT_KEY = 'activity';

const ENTRY_FIELDS = {
  id: 'id',
  kind: 'kind',
  peerId: 'peerId',
  peerName: 'peerName',
  peerColor: 'peerColor',
  timestamp: 'timestamp',
  summary: 'summary',
  entityId: 'entityId',
} as const;

// ─── Origins ───────────────────────────────────────────────────────────────

export const ORIGIN_LOCAL_UI = 'local-ui';
export const ORIGIN_REMOTE_UPDATE = 'remote-update';

export type ActivityOpOrigin =
  | typeof ORIGIN_LOCAL_UI
  | typeof ORIGIN_REMOTE_UPDATE;

// ─── Public accessors ──────────────────────────────────────────────────────

/** Get (creating if needed) the shared `activity` Y.Array root. */
export function getActivityRoot(doc: Y.Doc): Y.Array<Y.Map<unknown>> {
  return doc.getArray<Y.Map<unknown>>(ACTIVITY_ROOT_KEY);
}

/** Read the full activity log as a plain `ActivityEntry[]`. The result is
 *  newest-first. Caller is responsible for any downstream dedup against
 *  a local log via `mergeActivityLogs`. */
export function readActivityLog(doc: Y.Doc): ActivityEntry[] {
  const root = getActivityRoot(doc);
  const out: ActivityEntry[] = [];
  root.forEach((m) => {
    const decoded = yMapToEntry(m);
    if (decoded) out.push(decoded);
  });
  return out;
}

// ─── Encoders / decoders ───────────────────────────────────────────────────

function entryToYMap(entry: ActivityEntry): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  m.set(ENTRY_FIELDS.id, entry.id);
  m.set(ENTRY_FIELDS.kind, entry.kind);
  m.set(ENTRY_FIELDS.peerId, entry.peerId);
  // peerName is nullable per the type — Y.Map cannot store `undefined`
  // but `null` is fine.
  m.set(ENTRY_FIELDS.peerName, entry.peerName);
  m.set(ENTRY_FIELDS.peerColor, entry.peerColor);
  m.set(ENTRY_FIELDS.timestamp, entry.timestamp);
  m.set(ENTRY_FIELDS.summary, entry.summary);
  if (entry.entityId !== undefined) {
    m.set(ENTRY_FIELDS.entityId, entry.entityId);
  }
  return m;
}

function yMapToEntry(m: Y.Map<unknown>): ActivityEntry | null {
  const id = m.get(ENTRY_FIELDS.id) as string | undefined;
  const kind = m.get(ENTRY_FIELDS.kind) as ActivityKind | undefined;
  const peerId = m.get(ENTRY_FIELDS.peerId) as string | undefined;
  const peerColor = m.get(ENTRY_FIELDS.peerColor) as string | undefined;
  const timestamp = m.get(ENTRY_FIELDS.timestamp) as number | undefined;
  const summary = m.get(ENTRY_FIELDS.summary) as string | undefined;
  // Refuse to decode entries missing any required field — defensively
  // skip rather than poison the reader.
  if (
    typeof id !== 'string' ||
    typeof kind !== 'string' ||
    typeof peerId !== 'string' ||
    typeof peerColor !== 'string' ||
    typeof timestamp !== 'number' ||
    typeof summary !== 'string'
  ) {
    return null;
  }
  const peerNameRaw = m.get(ENTRY_FIELDS.peerName);
  const peerName: string | null = typeof peerNameRaw === 'string' ? peerNameRaw : null;
  const entityIdRaw = m.get(ENTRY_FIELDS.entityId);
  const out: ActivityEntry = {
    id,
    kind,
    peerId,
    peerName,
    peerColor,
    timestamp,
    summary,
  };
  if (typeof entityIdRaw === 'string') out.entityId = entityIdRaw;
  return out;
}

// ─── Mutation API ──────────────────────────────────────────────────────────

/**
 * Append one entry to the doc's activity log. The new entry lands at
 * index 0 (newest-first); the array is trimmed to `ACTIVITY_LOG_CAP`
 * within the same transact so observers never see a >50-length state.
 *
 * Idempotency: if an entry with the same `id` is already present, this
 * is a no-op (returns false). This protects against double-appends from
 * re-entered subscriptions.
 *
 * Returns `true` when the append landed, `false` on dedup/no-op.
 */
export function appendActivityToDoc(
  doc: Y.Doc,
  entry: ActivityEntry,
  origin: ActivityOpOrigin = ORIGIN_LOCAL_UI,
): boolean {
  let applied = false;
  doc.transact(() => {
    const root = getActivityRoot(doc);
    // Dedup-by-id guard — linear scan; cap = 50 so this is O(50).
    let exists = false;
    root.forEach((m) => {
      if (exists) return;
      if ((m.get(ENTRY_FIELDS.id) as string | undefined) === entry.id) exists = true;
    });
    if (exists) return;
    // Insert at head and trim tail if necessary.
    root.unshift([entryToYMap(entry)]);
    const overflow = root.length - ACTIVITY_LOG_CAP;
    if (overflow > 0) {
      root.delete(ACTIVITY_LOG_CAP, overflow);
    }
    applied = true;
  }, origin);
  return applied;
}

/** Clear all entries on the doc. Used by tests + the "clear local view"
 *  ⚠ DOES affect the shared doc — UI should NOT call this. The
 *  ActivityFeed UI's "clear local view" only hides locally; it does
 *  not call this function. */
export function clearActivityLog(
  doc: Y.Doc,
  origin: ActivityOpOrigin = ORIGIN_LOCAL_UI,
): void {
  doc.transact(() => {
    const root = getActivityRoot(doc);
    if (root.length > 0) root.delete(0, root.length);
  }, origin);
}

// ─── Sync helper ──────────────────────────────────────────────────────────

/** Exchange state between two docs (mirror of sketchYjs.syncDocs).
 *  Used by multi-peer tests. */
export function syncDocs(a: Y.Doc, b: Y.Doc): { aToB: number; bToA: number } {
  const stateA = Y.encodeStateVector(a);
  const stateB = Y.encodeStateVector(b);
  const updateForB = Y.encodeStateAsUpdate(a, stateB);
  const updateForA = Y.encodeStateAsUpdate(b, stateA);
  Y.applyUpdate(b, updateForB, ORIGIN_REMOTE_UPDATE);
  Y.applyUpdate(a, updateForA, ORIGIN_REMOTE_UPDATE);
  return { aToB: updateForB.byteLength, bToA: updateForA.byteLength };
}
