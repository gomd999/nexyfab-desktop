/**
 * useCrdtDoc — React hook wrapper around crdtAdapter.createCrdtDoc.
 *
 * Phase 1 follow-up to ADR-013 (collaborative editing). Gives React consumers
 * an idiomatic state-hook API on top of the imperative CrdtDoc handle:
 *   - `state` is the materialised value (re-rendered on local + remote updates)
 *   - `update` is a stable callback that proxies through to doc.update
 *   - `awareness` exposes local + remote presence state with React-friendly
 *     setters; cursor / selection overlays subscribe via `remoteStates`
 *   - `isConnected` is a transport-aware liveness flag (memory == always
 *     true; websocket == true only while the socket is OPEN)
 *
 * The hook owns the underlying CrdtDoc lifecycle — it is created on mount via
 * useMemo, torn down in the effect cleanup (covers React 18 StrictMode's
 * double-invoke as well as normal unmount). Consumers must NOT call destroy()
 * themselves on the returned awareness/state — that would corrupt the doc.
 *
 * Stability notes:
 *   - `update`, `awareness.setLocal` are stable across renders (useCallback)
 *     so they're safe to include in effect dep arrays.
 *   - `state` reference changes on every CRDT mutation (cheap structural
 *     clone from the snapshot — same semantics as crdtAdapter).
 *   - `awareness.localState` / `awareness.remoteStates` are fresh object
 *     references on every awareness change so React equality checks don't
 *     silently skip re-renders.
 *
 * Websocket liveness: when `transport === 'websocket'`, we open a *probe*
 * WebSocket to `wsUrl` purely to populate `isConnected`. The crdtAdapter
 * itself is still in Phase-1 stub mode (no real provider wiring), so the
 * probe is the single source of truth for the badge until Phase 2 lands.
 * The probe is closed on unmount and on any error.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createCrdtDoc,
  type CrdtDoc,
  type CrdtTransport,
  type UserId,
} from './crdtAdapter';

export interface UseCrdtDocOptions<T> {
  /** Logical document id (room). Two hooks sharing this id on the same
   *  transport stay in sync. */
  docId: string;
  /** Materialised initial state. The hook does NOT re-seed when this changes
   *  across renders — change the docId to switch documents. */
  initialState: T;
  /** Transport selector (passed straight through to createCrdtDoc). */
  transport: CrdtTransport;
  /** Required when transport === 'websocket'. */
  wsUrl?: string;
  /** Optional stable client id for awareness. Falls back to a random id. */
  userId?: UserId;
}

export interface UseCrdtDocAwareness {
  /** This client's published presence state (cursor, selection, …). */
  localState: Record<string, unknown>;
  /** Other clients' last-known presence keyed by user id. */
  remoteStates: Record<UserId, Record<string, unknown>>;
  /** Publish a single key of the local presence state. Stable across renders. */
  setLocal: (key: string, value: unknown) => void;
}

export interface UseCrdtDocResult<T> {
  /** Materialised CRDT state. New reference on every mutation. */
  state: T;
  /** Apply a structural mutation. Stable across renders. */
  update: (mutator: (draft: T) => void) => void;
  /** Presence sub-state. */
  awareness: UseCrdtDocAwareness;
  /** Transport-aware liveness flag. Memory: always true after first commit.
   *  Websocket: true only while the probe socket is OPEN. */
  isConnected: boolean;
}

/**
 * useCrdtDoc — bind a React component to a CRDT document.
 *
 * The CrdtDoc instance is created on mount (or when `docId` / `transport`
 * change) and destroyed on unmount. Updating other option fields (initial
 * state, wsUrl, userId) after mount has no effect — by design, since the
 * doc identity is the *room*, not the React tree.
 */
export function useCrdtDoc<T>(opts: UseCrdtDocOptions<T>): UseCrdtDocResult<T> {
  const { docId, initialState, transport, wsUrl, userId } = opts;

  // useMemo'd creation, keyed on the bits that change the doc *identity*.
  // wsUrl is included for websocket — switching servers mid-mount means a
  // new doc.
  //
  // `initialState` and `userId` are *captured at mount time* (and at doc-id
  // swap time) — they're not in the dep array, so passing a new initialState
  // reference on every render does NOT tear down the room. Re-key the host
  // component on docId if you genuinely want a fresh doc with a new seed.
  // We read them via the closure (createCrdtDoc receives them directly); the
  // useMemo dependency list deliberately excludes them.
  const doc = useMemo<CrdtDoc<T>>(
    () =>
      createCrdtDoc<T>({
        docId,
        initialState,
        transport,
        wsUrl,
        userId,
      }),
    // initialState + userId intentionally omitted: doc identity is (docId,
    // transport, wsUrl). Passing a new initialState reference on each render
    // would otherwise rebuild the doc and detonate the memory room.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [docId, transport, wsUrl],
  );

  // ─── State sync ─────────────────────────────────────────────────────────
  // Mirror the doc.state into React so children re-render on remote updates.
  // useState's initializer captures the freshest cached state from the
  // freshly-built doc. The subscribe wiring lives in an effect so React's
  // strict-mode-double-mount cycle wires/un-wires cleanly.
  const [state, setState] = useState<T>(() => doc.state);

  useEffect(() => {
    // On every doc re-creation, hard-reset React state to the doc's snapshot
    // before subscribing — covers strict-mode remount where the old state
    // would otherwise be a stale snapshot from the previous doc.
    setState(doc.state);
    const unsubscribe = doc.subscribe((next) => {
      setState(next);
    });
    return unsubscribe;
  }, [doc]);

  // ─── Awareness sync ─────────────────────────────────────────────────────
  const [awarenessSnap, setAwarenessSnap] = useState<{
    localState: Record<string, unknown>;
    remoteStates: Record<UserId, Record<string, unknown>>;
  }>(() => ({
    localState: { ...doc.awareness.localState },
    remoteStates: { ...doc.awareness.remoteStates },
  }));

  useEffect(() => {
    // Seed from the new doc; awareness state from the previous doc is gone.
    setAwarenessSnap({
      localState: { ...doc.awareness.localState },
      remoteStates: { ...doc.awareness.remoteStates },
    });
    const unsubscribe = doc.awareness.onUpdate((snap) => {
      // Spread to guarantee a fresh reference — React bails on `===` parent
      // objects, which would silently skip re-renders for cursor moves that
      // mutate values in place.
      setAwarenessSnap({
        localState: { ...snap.localState },
        remoteStates: { ...snap.remoteStates },
      });
    });
    return unsubscribe;
  }, [doc]);

  // ─── Destroy on unmount / doc swap ──────────────────────────────────────
  useEffect(() => {
    return () => {
      doc.destroy();
    };
  }, [doc]);

  // ─── Connection liveness ────────────────────────────────────────────────
  // memory: synchronous, always live once the doc exists.
  // websocket: open a probe socket to wsUrl. crdtAdapter is Phase-1 stub
  // (no real provider) so we own the truth of the badge here.
  const [isConnected, setIsConnected] = useState<boolean>(transport === 'memory');

  useEffect(() => {
    if (transport === 'memory') {
      setIsConnected(true);
      return;
    }
    if (transport !== 'websocket' || !wsUrl) {
      setIsConnected(false);
      return;
    }

    // SSR / node-test environments can lack WebSocket; degrade gracefully.
    const WS: typeof WebSocket | undefined =
      typeof WebSocket !== 'undefined' ? WebSocket : undefined;
    if (!WS) {
      setIsConnected(false);
      return;
    }

    let ws: WebSocket | null = null;
    let cancelled = false;
    try {
      ws = new WS(wsUrl);
    } catch {
      setIsConnected(false);
      return;
    }
    setIsConnected(ws.readyState === 1 /* OPEN */);

    const onOpen = (): void => {
      if (!cancelled) setIsConnected(true);
    };
    const onClose = (): void => {
      if (!cancelled) setIsConnected(false);
    };
    const onError = (): void => {
      if (!cancelled) setIsConnected(false);
    };
    ws.addEventListener('open', onOpen);
    ws.addEventListener('close', onClose);
    ws.addEventListener('error', onError);

    return () => {
      cancelled = true;
      try {
        ws?.removeEventListener('open', onOpen);
        ws?.removeEventListener('close', onClose);
        ws?.removeEventListener('error', onError);
        if (ws && ws.readyState !== 3 /* CLOSED */) ws.close();
      } catch {
        // socket teardown errors are non-fatal
      }
    };
  }, [transport, wsUrl]);

  // ─── Stable callbacks ───────────────────────────────────────────────────
  const update = useCallback<UseCrdtDocResult<T>['update']>(
    (mutator) => {
      doc.update(mutator);
    },
    [doc],
  );

  const setLocal = useCallback<UseCrdtDocAwareness['setLocal']>(
    (key, value) => {
      doc.awareness.setLocal(key, value);
    },
    [doc],
  );

  const awareness = useMemo<UseCrdtDocAwareness>(
    () => ({
      localState: awarenessSnap.localState,
      remoteStates: awarenessSnap.remoteStates,
      setLocal,
    }),
    [awarenessSnap, setLocal],
  );

  return { state, update, awareness, isConnected };
}
