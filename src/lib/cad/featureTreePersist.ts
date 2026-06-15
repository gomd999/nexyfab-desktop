/**
 * featureTreePersist — Phase 2.8 UX of NexyFab Pro own-CAD (ADR-013).
 *
 * Serialize / deserialize a FeatureTree to a JSON string and persist it to
 * the browser's `localStorage`. This is the smallest possible save layer
 * that the SolverSketchEditorWithExtrude wrapper (today: memory-only) can
 * adopt without changing its public IR types.
 *
 * Why versioned JSON, not structured-clone IndexedDB?
 *   - Single, line-diffable artifact for cache-busting + cross-tab debugging.
 *   - Trivially exportable to a *.nexyfab file once the desktop importer
 *     lands (Phase 3.x); same on-wire schema.
 *   - All FeaturePayload kinds in Phase 2 are already plain JSON values
 *     (no Maps, no Date, no Symbol), so JSON.stringify round-trips
 *     losslessly.
 *
 * What this file deliberately does NOT cover:
 *   - Cross-tab sync (storage events) — caller can listen on `window`
 *     directly if they want it; we don't want to surprise the wrapper with
 *     unsolicited re-renders.
 *   - Schema migration: only version 1 exists today. The dispatch shape
 *     (`migrate(parsed) → tree`) is laid out so v2 can slot in without
 *     touching call sites.
 *   - Compression: typical trees (< 50 nodes) stringify to a few KB. The
 *     5-10 MB per-origin localStorage quota is fine even for the largest
 *     trees we permit (1000 nodes). We surface a `quota_exceeded` save
 *     error rather than silently dropping the write.
 *
 * Versioning strategy:
 *   - The on-disk envelope is `{ version: number; tree: <plain tree> }`.
 *   - `SCHEMA_VERSION` is bumped only on breaking shape changes; additive
 *     fields stay on v1 because deserializeFeatureTree validates required
 *     fields per kind (unknown optional fields are tolerated and copied).
 *   - Reading any other version → `{ ok: false, error: 'version_mismatch' }`
 *     so the caller can show "saved with a newer/older NexyFab" and fall
 *     back to an empty tree instead of crashing.
 *
 * Debounce decision (500 ms in useFeatureTreeStorage):
 *   - Sketch parameter-edit interactions emit O(60) setTree calls / second
 *     while a slider is being dragged. Writing each one would burn ~5 ms
 *     of main-thread JSON.stringify on a medium tree (~60 nodes, ~30 KB).
 *   - 500 ms ≈ the SOLIDWORKS "pause-to-save" default, long enough that a
 *     typical pause between commits is captured, short enough that an
 *     accidental tab close costs at most one half-second of work.
 *   - The timer is cleared on unmount (no leaked timers in tests) and
 *     flushed synchronously if the key changes (no stale write to the
 *     wrong key).
 *
 * Quota handling (5-10 MB):
 *   - On QuotaExceededError, we surface a `quota_exceeded` save error so
 *     UI can pop a "your tree is too large to save locally" toast.
 *   - We never try to evict other keys — that's the caller's domain.
 */

import {
  validateTree,
  type FeatureTree,
  type FeatureNode,
  type FeatureKind,
  type FeaturePayload,
} from './featureTree';
import { useCallback, useEffect, useRef, useState } from 'react';

// ─── version ──────────────────────────────────────────────────────────────

export const SCHEMA_VERSION = 1;

/** On-wire envelope. Kept minimal so future fields can be added without
 *  forcing a version bump (additive-only rule). */
interface SerializedEnvelope {
  version: number;
  tree: FeatureTree;
}

// ─── serialization ────────────────────────────────────────────────────────

/**
 * Serialize a FeatureTree to a JSON string with the current SCHEMA_VERSION
 * envelope. The output is deterministic for identical input (no Map,
 * Set, Date or other non-stable encodings appear).
 *
 * The tree is NOT validated here — call `validateTree` first if you need
 * to guarantee the serialized blob round-trips cleanly. Reason: the
 * editor flushes auto-saves frequently, and we want to capture even
 * in-progress / invalid trees so users can recover after a crash and fix
 * them by hand.
 */
export function serializeFeatureTree(tree: FeatureTree): string {
  const envelope: SerializedEnvelope = {
    version: SCHEMA_VERSION,
    tree: normalizeTreeForJson(tree),
  };
  return JSON.stringify(envelope);
}

/**
 * Strip ReadonlyArray / Map / Set wrappers down to plain JSON values.
 * In practice all our IR fields are already plain JSON, but we do a
 * defensive shallow clone so the caller can't observe identity sharing
 * (which would surprise anyone treating the serialized output as a
 * stable snapshot).
 */
function normalizeTreeForJson(tree: FeatureTree): FeatureTree {
  return {
    nodes: tree.nodes.map((n) => ({
      id: String(n.id),
      name: String(n.name),
      ...(n.suppressed !== undefined ? { suppressed: !!n.suppressed } : {}),
      dependencies: [...n.dependencies].map((d) => String(d)),
      payload: n.payload,
    })),
  };
}

// ─── deserialization ──────────────────────────────────────────────────────

export type DeserializeError =
  | 'invalid_json'
  | 'missing_envelope'
  | 'version_mismatch'
  | 'missing_tree'
  | 'invalid_tree_shape'
  | 'invalid_node'
  | 'invalid_payload'
  | 'validate_tree_failed';

export type DeserializeResult =
  | { ok: true; tree: FeatureTree }
  | { ok: false; error: DeserializeError; message: string };

/**
 * Parse a JSON string back into a FeatureTree.
 *
 * Validation contract (in order, fail-fast):
 *   1. JSON.parse must succeed              → invalid_json
 *   2. Top-level shape must look like SerializedEnvelope
 *                                            → missing_envelope / missing_tree
 *   3. envelope.version must equal SCHEMA_VERSION
 *                                            → version_mismatch
 *   4. tree.nodes must be an array; each node has the FeatureNode shape
 *                                            → invalid_tree_shape / invalid_node
 *   5. Each payload.kind matches the known FeatureKind union AND carries
 *      the required fields for that kind     → invalid_payload
 *   6. validateTree (cycles / forward refs / dup ids) must pass
 *                                            → validate_tree_failed
 *
 * Returns a discriminated-union result so callers can distinguish "no
 * saved tree" from "save was malformed" and surface appropriate UI.
 */
export function deserializeFeatureTree(json: string): DeserializeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: 'invalid_json', message: `JSON.parse failed: ${msg}` };
  }
  if (!isPlainObject(parsed)) {
    return { ok: false, error: 'missing_envelope', message: 'top-level must be an object' };
  }
  const envelope = parsed as Record<string, unknown>;
  if (typeof envelope.version !== 'number') {
    return { ok: false, error: 'missing_envelope', message: 'envelope.version must be a number' };
  }
  if (envelope.version !== SCHEMA_VERSION) {
    return {
      ok: false,
      error: 'version_mismatch',
      message: `expected version ${SCHEMA_VERSION}, got ${envelope.version}`,
    };
  }
  const rawTree = envelope.tree;
  if (!isPlainObject(rawTree)) {
    return { ok: false, error: 'missing_tree', message: 'envelope.tree must be an object' };
  }
  const rawNodes = (rawTree as Record<string, unknown>).nodes;
  if (!Array.isArray(rawNodes)) {
    return { ok: false, error: 'invalid_tree_shape', message: 'tree.nodes must be an array' };
  }

  const nodes: FeatureNode[] = [];
  for (let i = 0; i < rawNodes.length; i++) {
    const nodeRes = validateNode(rawNodes[i], i);
    if (!nodeRes.ok) return nodeRes;
    nodes.push(nodeRes.node);
  }

  const tree: FeatureTree = { nodes };

  try {
    validateTree(tree);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: 'validate_tree_failed', message: msg };
  }

  return { ok: true, tree };
}

type NodeValidationResult =
  | { ok: true; node: FeatureNode }
  | { ok: false; error: DeserializeError; message: string };

function validateNode(raw: unknown, index: number): NodeValidationResult {
  if (!isPlainObject(raw)) {
    return { ok: false, error: 'invalid_node', message: `node[${index}] must be an object` };
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string') {
    return { ok: false, error: 'invalid_node', message: `node[${index}].id must be string` };
  }
  if (typeof r.name !== 'string') {
    return { ok: false, error: 'invalid_node', message: `node[${index}].name must be string` };
  }
  if (!Array.isArray(r.dependencies)) {
    return {
      ok: false,
      error: 'invalid_node',
      message: `node[${index}].dependencies must be an array`,
    };
  }
  for (let j = 0; j < r.dependencies.length; j++) {
    if (typeof r.dependencies[j] !== 'string') {
      return {
        ok: false,
        error: 'invalid_node',
        message: `node[${index}].dependencies[${j}] must be string`,
      };
    }
  }
  if (r.suppressed !== undefined && typeof r.suppressed !== 'boolean') {
    return {
      ok: false,
      error: 'invalid_node',
      message: `node[${index}].suppressed must be boolean or absent`,
    };
  }
  const payloadRes = validatePayload(r.payload, index);
  if (!payloadRes.ok) return payloadRes;

  const node: FeatureNode = {
    id: r.id,
    name: r.name,
    dependencies: r.dependencies as ReadonlyArray<string>,
    payload: payloadRes.payload,
  };
  if (typeof r.suppressed === 'boolean') {
    (node as { suppressed?: boolean }).suppressed = r.suppressed;
  }
  return { ok: true, node };
}

type PayloadValidationResult =
  | { ok: true; payload: FeaturePayload }
  | { ok: false; error: 'invalid_payload'; message: string };

const KNOWN_KINDS: ReadonlySet<FeatureKind> = new Set<FeatureKind>([
  'extrude',
  'revolve',
  'sweep',
  'loft',
  'linear_pattern',
  'circular_pattern',
  'hole',
  'fillet',
  'chamfer',
]);

/**
 * Per-kind structural validation. We check the fields the IR considers
 * required so a corrupted blob can't sneak past round-trip and explode
 * during replay (when the SCAD serializer dereferences a missing prop).
 *
 * Optional fields (e.g. extrude.draftDegrees, hole.counterboreDepth) are
 * tolerated when absent; we don't re-run the builder-level invariants
 * (those are the IR builders' job, not the persistence layer's).
 */
function validatePayload(raw: unknown, nodeIndex: number): PayloadValidationResult {
  if (!isPlainObject(raw)) {
    return {
      ok: false,
      error: 'invalid_payload',
      message: `node[${nodeIndex}].payload must be an object`,
    };
  }
  const p = raw as Record<string, unknown>;
  const kind = p.kind;
  if (typeof kind !== 'string' || !KNOWN_KINDS.has(kind as FeatureKind)) {
    return {
      ok: false,
      error: 'invalid_payload',
      message: `node[${nodeIndex}].payload.kind=${JSON.stringify(kind)} is not a known FeatureKind`,
    };
  }
  const missing = (field: string): PayloadValidationResult => ({
    ok: false,
    error: 'invalid_payload',
    message: `node[${nodeIndex}].payload (kind=${kind}) missing required field: ${field}`,
  });

  switch (kind as FeatureKind) {
    case 'extrude':
      if (!Array.isArray(p.loop)) return missing('loop');
      if (typeof p.depth !== 'number') return missing('depth');
      if (typeof p.direction !== 'string') return missing('direction');
      if (typeof p.mode !== 'string') return missing('mode');
      break;
    case 'revolve':
      if (!Array.isArray(p.loop)) return missing('loop');
      if (typeof p.angleDegrees !== 'number') return missing('angleDegrees');
      if (typeof p.mode !== 'string') return missing('mode');
      break;
    case 'sweep':
      if (!isPlainObject(p.profile)) return missing('profile');
      if (!Array.isArray((p.profile as { points?: unknown }).points)) return missing('profile.points');
      if (!Array.isArray(p.path)) return missing('path');
      if (typeof p.mode !== 'string') return missing('mode');
      break;
    case 'loft':
      if (!Array.isArray(p.sections)) return missing('sections');
      for (let i = 0; i < (p.sections as unknown[]).length; i++) {
        const s = (p.sections as unknown[])[i];
        if (!isPlainObject(s)) return missing(`sections[${i}]`);
        const srec = s as Record<string, unknown>;
        if (!isPlainObject(srec.profile)) return missing(`sections[${i}].profile`);
        if (!Array.isArray((srec.profile as { points?: unknown }).points)) {
          return missing(`sections[${i}].profile.points`);
        }
        if (typeof srec.z !== 'number') return missing(`sections[${i}].z`);
      }
      if (typeof p.mode !== 'string') return missing('mode');
      break;
    case 'linear_pattern':
      if (typeof p.childScad !== 'string') return missing('childScad');
      if (typeof p.count !== 'number') return missing('count');
      if (!isPlainObject(p.direction)) return missing('direction');
      if (typeof p.spacing !== 'number') return missing('spacing');
      break;
    case 'circular_pattern':
      if (typeof p.childScad !== 'string') return missing('childScad');
      if (typeof p.count !== 'number') return missing('count');
      if (!isPlainObject(p.axisOrigin)) return missing('axisOrigin');
      if (!isPlainObject(p.axisDirection)) return missing('axisDirection');
      if (typeof p.totalAngleDegrees !== 'number') return missing('totalAngleDegrees');
      break;
    case 'hole':
      if (!isPlainObject(p.center)) return missing('center');
      if (typeof (p.center as { x?: unknown }).x !== 'number') return missing('center.x');
      if (typeof (p.center as { y?: unknown }).y !== 'number') return missing('center.y');
      if (typeof p.holeType !== 'string') return missing('holeType');
      if (typeof p.diameter !== 'number') return missing('diameter');
      if (typeof p.depth !== 'number') return missing('depth');
      break;
    case 'fillet':
      if (!isPlainObject(p.childExtrude)) return missing('childExtrude');
      if ((p.childExtrude as { kind?: unknown }).kind !== 'extrude') {
        return {
          ok: false,
          error: 'invalid_payload',
          message: `node[${nodeIndex}].payload.childExtrude.kind must be 'extrude'`,
        };
      }
      if (typeof p.radius !== 'number') return missing('radius');
      if (typeof p.edgeSelection !== 'string') return missing('edgeSelection');
      break;
    case 'chamfer':
      if (!isPlainObject(p.childExtrude)) return missing('childExtrude');
      if ((p.childExtrude as { kind?: unknown }).kind !== 'extrude') {
        return {
          ok: false,
          error: 'invalid_payload',
          message: `node[${nodeIndex}].payload.childExtrude.kind must be 'extrude'`,
        };
      }
      if (typeof p.distance !== 'number') return missing('distance');
      if (typeof p.edgeSelection !== 'string') return missing('edgeSelection');
      break;
  }
  // Trust the round-trip: pass the raw object through as the payload. We
  // route through `unknown` because TS can't relate `Record<string,unknown>`
  // to the discriminated union directly — the structural checks above are
  // the actual contract.
  return { ok: true, payload: raw as unknown as FeaturePayload };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// ─── localStorage write helpers ───────────────────────────────────────────

export type SaveError = 'no_storage' | 'quota_exceeded' | 'unknown';

export type SaveResult =
  | { ok: true }
  | { ok: false; error: SaveError; message: string };

/**
 * Persist a serialized tree blob under `key`. Surface storage failures as
 * a structured result instead of throwing so callers can show a UI toast
 * without try/catch every call site.
 */
export function writeToStorage(key: string, json: string): SaveResult {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { ok: false, error: 'no_storage', message: 'localStorage not available' };
  }
  try {
    window.localStorage.setItem(key, json);
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Browsers (incl. jsdom) raise QuotaExceededError as a DOMException with
    // name === 'QuotaExceededError' OR legacy code === 22.
    if (
      (err instanceof Error && err.name === 'QuotaExceededError') ||
      (err && typeof err === 'object' && (err as { code?: number }).code === 22)
    ) {
      return {
        ok: false,
        error: 'quota_exceeded',
        message: `localStorage quota exceeded for key=${key} (~${json.length} chars): ${msg}`,
      };
    }
    return { ok: false, error: 'unknown', message: msg };
  }
}

/**
 * Read a serialized tree blob from localStorage. Returns null if the key
 * is absent OR localStorage is unavailable (the hook treats both the same
 * way — start with an empty tree).
 */
export function readFromStorage(key: string): string | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

// ─── React hook ───────────────────────────────────────────────────────────

const EMPTY_TREE: FeatureTree = Object.freeze({ nodes: [] as ReadonlyArray<FeatureNode> });
export const FEATURE_TREE_AUTOSAVE_DEBOUNCE_MS = 500;

export type SetFeatureTree = (next: FeatureTree | ((prev: FeatureTree) => FeatureTree)) => void;

/**
 * React hook that keeps a FeatureTree in sync with `localStorage[key]`.
 *
 * Mount lifecycle:
 *   1. On first render, synchronously read localStorage. If present and
 *      valid → use as initial state. If absent / invalid → start with the
 *      shared empty tree singleton (no allocation per mount).
 *   2. When `key` changes, re-read from the new key and replace state.
 *      Any pending debounced write for the previous key is flushed
 *      synchronously so we don't write the new tree under the old key
 *      or vice versa.
 *
 * Auto-save:
 *   - Every successful `setTree` schedules a write to localStorage after
 *     FEATURE_TREE_AUTOSAVE_DEBOUNCE_MS (500 ms). Successive setTree
 *     calls within the window collapse to a single write.
 *   - On unmount, the pending timer is cleared. We do NOT flush on
 *     unmount; in React 19 the strict-mode double-mount would write
 *     twice and the typical close-tab flow already triggers `pagehide`
 *     which we intentionally don't hook (that's the wrapper's call).
 *
 * Multiple components sharing a key:
 *   - Each useFeatureTreeStorage instance owns its own state. The last
 *     setTree wins at the localStorage layer; cross-tab / cross-instance
 *     sync via `storage` events is out of scope.
 *
 * Optional `onError` callback fires on every save failure so a wrapper
 * can show a toast.
 */
export function useFeatureTreeStorage(
  key: string,
  options: { onError?: (e: SaveError, message: string) => void } = {},
): [FeatureTree, SetFeatureTree] {
  const onErrorRef = useRef(options.onError);
  useEffect(() => {
    onErrorRef.current = options.onError;
  });

  // We track the "currently loaded" key alongside the tree so a key prop
  // change can be detected during render without firing a setState-in-effect
  // (React 19's react-hooks/set-state-in-effect rule). The key-change branch
  // below mirrors the lazy initializer and writes both atomically.
  const [state, setStateInternal] = useState<{ key: string; tree: FeatureTree }>(() => ({
    key,
    tree: loadOrEmpty(key),
  }));

  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingTreeRef = useRef<FeatureTree | null>(null);
  // The localStorage key the pending write is targeting. Updated only when
  // a debounce timer is scheduled, cleared when the timer fires or is
  // cancelled. Used by the key-change effect to flush before swap.
  const pendingWriteKeyRef = useRef<string | null>(null);

  // Synchronously flush any queued tree to a specific key. Used both by
  // the key-change effect and by the debounce-fire timer.
  const flushPending = useCallback((forKey: string): void => {
    if (pendingTimerRef.current !== null) {
      clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }
    const toWrite = pendingTreeRef.current;
    pendingTreeRef.current = null;
    pendingWriteKeyRef.current = null;
    if (toWrite === null) return;
    const json = serializeFeatureTree(toWrite);
    const res = writeToStorage(forKey, json);
    if (!res.ok && onErrorRef.current) {
      onErrorRef.current(res.error, res.message);
    }
  }, []);

  // Queue a tree for debounced save under `writeKey`. The closure captures
  // the key explicitly so a mid-debounce key swap doesn't write to the
  // wrong slot.
  const schedulePending = useCallback((next: FeatureTree, writeKey: string): void => {
    pendingTreeRef.current = next;
    pendingWriteKeyRef.current = writeKey;
    if (pendingTimerRef.current !== null) {
      clearTimeout(pendingTimerRef.current);
    }
    pendingTimerRef.current = setTimeout(() => {
      pendingTimerRef.current = null;
      const toWrite = pendingTreeRef.current;
      pendingTreeRef.current = null;
      pendingWriteKeyRef.current = null;
      if (toWrite === null) return;
      const json = serializeFeatureTree(toWrite);
      const res = writeToStorage(writeKey, json);
      if (!res.ok && onErrorRef.current) {
        onErrorRef.current(res.error, res.message);
      }
    }, FEATURE_TREE_AUTOSAVE_DEBOUNCE_MS);
  }, []);

  // Key-change branch — runs during render when the consumer passes a new
  // key. We schedule the load via setStateInternal (gated so React's
  // bail-out detection collapses duplicate calls) and let the effect below
  // flush the previous key's write after commit. Pattern from React 19
  // docs ("You might not need an Effect" / "Resetting state on prop
  // change") — preferred over a useEffect that depends on `key` because
  // the visible tree updates on the same render the prop changes.
  if (state.key !== key) {
    // Schedule the reload (React deduplicates same-tick setState calls).
    setStateInternal({ key, tree: loadOrEmpty(key) });
  }

  // Track the most-recently-mounted key in a ref. The key-change effect
  // detects a transition by comparing this ref to the current `state.key`,
  // flushes the queued write under the OLD key before swapping. Using a
  // ref + the effect-body (not the cleanup) keeps both "key changed" and
  // "unmount" distinct: cleanups don't have to differentiate.
  const lastSeenKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const prevKey = lastSeenKeyRef.current;
    lastSeenKeyRef.current = state.key;
    if (prevKey !== null && prevKey !== state.key) {
      // Key transition (k_old → k_new): flush any queued write to k_old.
      if (pendingWriteKeyRef.current === prevKey) {
        flushPending(prevKey);
      }
    }
  }, [state.key, flushPending]);

  // Cleanup on unmount: clear timer + queued tree (no memory leak / no
  // late write). Discards rather than flushing — that's the contract:
  // closing the wrapper while a save is in flight should not commit the
  // partial state.
  useEffect(() => {
    return () => {
      if (pendingTimerRef.current !== null) {
        clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
      pendingTreeRef.current = null;
      pendingWriteKeyRef.current = null;
    };
  }, []);

  const setTree = useCallback<SetFeatureTree>(
    (next) => {
      setStateInternal((prev) => {
        const resolved =
          typeof next === 'function'
            ? (next as (p: FeatureTree) => FeatureTree)(prev.tree)
            : next;
        schedulePending(resolved, prev.key);
        return { key: prev.key, tree: resolved };
      });
    },
    [schedulePending],
  );

  return [state.tree, setTree];
}

/**
 * Synchronously read + parse localStorage[key]; fall back to the empty
 * tree on any failure (missing key, parse error, version mismatch,
 * payload validation error). Exported only for tests; production code
 * should go through the hook.
 */
export function loadOrEmpty(key: string): FeatureTree {
  const raw = readFromStorage(key);
  if (raw === null) return EMPTY_TREE;
  const res = deserializeFeatureTree(raw);
  if (!res.ok) return EMPTY_TREE;
  return res.tree;
}
