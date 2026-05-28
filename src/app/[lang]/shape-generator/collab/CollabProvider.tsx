'use client';

/**
 * CollabProvider.tsx — Wave 2 Phase 3 W1 Track Z1.
 *
 * React Context provider that owns the Y.Doc + transports + awareness for a
 * single collaborative document. This is the FOUNDATION every Phase 3 follow-
 * up week (Z2 sketch wiring, Z3 feature-tree wiring, Z4 configs wiring)
 * depends on.
 *
 * Transports attached (per `docs/wave-2-crdt-architecture.md` §3 + §5):
 *
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │  CollabProvider (this file)                                      │
 *   │     ├─ Y.Doc                                                     │
 *   │     ├─ Awareness  (y-protocols/awareness)                        │
 *   │     ├─ IndexeddbPersistence  ← offlinePersistence.ts (Phase 1)   │
 *   │     ├─ BroadcastChannel  (same-tab + cross-tab same-origin)      │
 *   │     └─ WebsocketProvider  (occt-collab-worker; flag-gated)       │
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * Three connection modes, in priority order:
 *
 *   1. **Local-only** — `wsEndpoint` unset. BroadcastChannel + IndexedDB.
 *      Works today with zero infra; ideal for solo users and "edit while
 *      offline" flows. This is the default mode for Z1 (no worker yet).
 *
 *   2. **Local + WS** — `wsEndpoint` set, worker reachable. All three
 *      transports run concurrently. The y-websocket provider has its OWN
 *      BroadcastChannel that handles cross-tab sync to other tabs *also*
 *      connected to the same WS; our manual BC keeps the local-only
 *      tabs in sync (e.g. when the WS is down for one tab).
 *
 *   3. **Degraded (WS configured but down)** — falls back to BC + IDB.
 *      Status badge surfaces "Disconnected" so the user knows.
 *
 * Env var contract (NEW for Z1):
 *
 *   NEXT_PUBLIC_OCCT_COLLAB_WS_URL — base URL of the production collab
 *                                    worker, e.g.
 *                                    "wss://occt-collab.nexyfab.workers.dev"
 *                                    Per-doc paths are computed by the
 *                                    Provider:
 *                                    `${base}/ws/${docId}`
 *                                    Falsy/missing → local-only mode.
 *
 * The worker itself is task #31 (Wave 2 phase 0 backlog, not Z1's scope).
 * Until it's deployed, leave the env var unset; everything else still works.
 *
 * Lifecycle:
 *
 *   - On mount: create Y.Doc → attach IDB → attach BC → maybe attach WS.
 *     Awareness is initialised with `{ id, name, color }` BEFORE BC fires
 *     so peers never see an unnamed cursor.
 *
 *   - On unmount: tear down in reverse order. Provider destroys the doc
 *     LAST so transports can flush final updates to IDB without crashing
 *     on a destroyed doc.
 *
 * Out of scope (Z2/Z3/Z4 will handle):
 *
 *   - Wiring the doc into sketch / featureTree / configs (Z2-Z4 weeks).
 *   - Multi-cursor + selection UI (just emits the data here; rendering
 *     happens in `AwarenessCursors.tsx`, wired separately).
 *   - Auth / JWT mint (worker checks auth; Provider just forwards the
 *     URL it's given). Z4 of phase 3 wires JWT mint.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from 'react';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { setupOfflinePersistence } from './offlinePersistence';
import {
  encodeLocalPresence,
  decodeRemotePresence,
  readLocalPresence,
  peerColorFromId,
  generatePeerId,
  defaultPeerName,
  type PeerInfo,
} from './awareness';

// ─── Public types ───────────────────────────────────────────────────────────

export interface CollabConnectionState {
  /** WebSocket transport status. `unavailable` means no wsEndpoint provided. */
  ws: 'connected' | 'connecting' | 'disconnected' | 'unavailable';
  /** BroadcastChannel transport status. */
  bc: 'active' | 'inactive';
  /** IndexedDB persistence status. */
  idb: 'syncing' | 'synced' | 'unavailable';
  /** Total connected peers (remote, not counting self). */
  peerCount: number;
}

export interface CollabContextValue {
  doc: Y.Doc;
  awareness: Awareness;
  connection: CollabConnectionState;
  localPeer: PeerInfo;
  remotePeers: Record<string, PeerInfo>;
  updateLocalPresence: (patch: Partial<PeerInfo>) => void;
}

export interface CollabProviderProps {
  /** Canonical doc identifier (uuid / project id). */
  docId: string;
  /**
   * Optional. When set, the Provider attempts a WS connection to
   * `${wsEndpoint}/ws/${docId}`. When unset → local-only mode.
   *
   * Production value comes from `NEXT_PUBLIC_OCCT_COLLAB_WS_URL` — see file
   * header. Callers that want to wire it from env should do:
   *
   *   const ws = process.env.NEXT_PUBLIC_OCCT_COLLAB_WS_URL || undefined;
   *   <CollabProvider docId={...} wsEndpoint={ws}>
   */
  wsEndpoint?: string;
  /** Initial display name. Falls back to `User XXXX` if not provided. */
  initialName?: string;
  /** Optional fixed peer id (testing); production generates one. */
  initialPeerId?: string;
  children: React.ReactNode;
}

// ─── Context ────────────────────────────────────────────────────────────────

const CollabContext = createContext<CollabContextValue | null>(null);

// ─── BroadcastChannel wire format ───────────────────────────────────────────
//
// We use BroadcastChannel directly (not y-websocket's built-in BC) so the
// local-only mode works without the WS provider. Wire format mirrors
// y-websocket's BC channel: tagged ArrayBuffer-or-object payloads.

type BcMessage =
  | { kind: 'update'; payload: Uint8Array; senderClientId: number }
  | { kind: 'awareness'; payload: Uint8Array; senderClientId: number }
  | { kind: 'sync-request'; senderClientId: number };

const BC_PREFIX = 'nexyfab-collab::';
const BC_ORIGIN_REMOTE = Symbol('bc-remote-update');

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeInitialLocalPeer(peerId: string, name: string): PeerInfo {
  return {
    id: peerId,
    name,
    color: peerColorFromId(peerId),
    cursor: null,
    selection: [],
    activeNodeId: null,
    ts: Date.now(),
  };
}

// ─── Provider ───────────────────────────────────────────────────────────────

export function CollabProvider(props: CollabProviderProps) {
  const { docId, wsEndpoint, initialName, initialPeerId, children } = props;

  // Y.Doc + Awareness are created ONCE per provider instance. useMemo with
  // an empty dep would also work, but useState's lazy init signals the
  // "once per mount" intent more loudly to future readers.
  const [doc] = useState(() => new Y.Doc());
  const [awareness] = useState(() => new Awareness(doc));

  // Local peer identity. Stable across re-renders within one mount.
  const localPeerIdRef = useRef<string>(initialPeerId ?? generatePeerId());
  const localPeerNameRef = useRef<string>(
    initialName ?? defaultPeerName(localPeerIdRef.current),
  );

  const [connection, setConnection] = useState<CollabConnectionState>({
    ws: wsEndpoint ? 'connecting' : 'unavailable',
    bc: 'inactive',
    idb: typeof indexedDB === 'undefined' ? 'unavailable' : 'syncing',
    peerCount: 0,
  });

  const [remotePeers, setRemotePeers] = useState<Record<string, PeerInfo>>({});
  const [localPeerState, setLocalPeerState] = useState<PeerInfo>(() =>
    makeInitialLocalPeer(localPeerIdRef.current, localPeerNameRef.current),
  );

  // ─── Wire up transports on mount ──────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    // Stamp initial local awareness BEFORE any transport fires so peers
    // never see an unnamed cursor.
    encodeLocalPresence(awareness, localPeerState);

    // 1. IndexedDB persistence (reuses Phase 1 W2 helper).
    let persistence: ReturnType<typeof setupOfflinePersistence> | null = null;
    if (typeof indexedDB !== 'undefined') {
      try {
        persistence = setupOfflinePersistence(doc, docId);
        persistence.whenSynced
          .then(() => {
            if (!cancelled) {
              setConnection((c) => ({ ...c, idb: 'synced' }));
            }
          })
          .catch(() => {
            if (!cancelled) {
              setConnection((c) => ({ ...c, idb: 'unavailable' }));
            }
          });
      } catch {
        // Already-existing connection conflict / quota — degrade gracefully.
        setConnection((c) => ({ ...c, idb: 'unavailable' }));
      }
    }

    // 2. BroadcastChannel (same-origin cross-tab).
    let bc: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        bc = new BroadcastChannel(BC_PREFIX + docId);
        setConnection((c) => ({ ...c, bc: 'active' }));

        const onBcMessage = (ev: MessageEvent<BcMessage>) => {
          const msg = ev.data;
          if (!msg || typeof msg !== 'object') return;
          if (msg.senderClientId === doc.clientID) return; // self echo guard
          try {
            if (msg.kind === 'update' && msg.payload) {
              Y.applyUpdate(doc, msg.payload, BC_ORIGIN_REMOTE);
            } else if (msg.kind === 'awareness' && msg.payload) {
              // Lazy import keeps the awareness apply path off the hot
              // startup loop; same impact, smaller initial chunk.
              import('y-protocols/awareness').then(({ applyAwarenessUpdate }) => {
                if (cancelled || !msg.payload) return;
                applyAwarenessUpdate(awareness, msg.payload, BC_ORIGIN_REMOTE);
              });
            } else if (msg.kind === 'sync-request') {
              const sv = Y.encodeStateAsUpdate(doc);
              bc?.postMessage({
                kind: 'update',
                payload: sv,
                senderClientId: doc.clientID,
              } satisfies BcMessage);
            }
          } catch {
            // A malformed peer payload should never bring the tab down.
          }
        };
        bc.addEventListener('message', onBcMessage);

        // Re-emit local doc updates onto BC.
        const onDocUpdate = (update: Uint8Array, origin: unknown) => {
          if (origin === BC_ORIGIN_REMOTE) return; // don't echo remote back
          bc?.postMessage({
            kind: 'update',
            payload: update,
            senderClientId: doc.clientID,
          } satisfies BcMessage);
        };
        doc.on('update', onDocUpdate);

        // Re-emit local awareness changes onto BC.
        const onAwarenessUpdate = async (
          _changed: { added: number[]; updated: number[]; removed: number[] },
          origin: unknown,
        ) => {
          if (origin === BC_ORIGIN_REMOTE) return;
          const { encodeAwarenessUpdate } = await import('y-protocols/awareness');
          const payload = encodeAwarenessUpdate(awareness, [awareness.clientID]);
          bc?.postMessage({
            kind: 'awareness',
            payload,
            senderClientId: doc.clientID,
          } satisfies BcMessage);
        };
        awareness.on('update', onAwarenessUpdate);

        // Ask any existing peers for their state.
        bc.postMessage({
          kind: 'sync-request',
          senderClientId: doc.clientID,
        } satisfies BcMessage);

        // Defer cleanup so the parent useEffect cleanup gets all handles.
        (bc as unknown as { __cleanup?: () => void }).__cleanup = () => {
          doc.off('update', onDocUpdate);
          awareness.off('update', onAwarenessUpdate);
          bc?.removeEventListener('message', onBcMessage);
        };
      } catch {
        // Some sandboxed iframes block BC; degrade silently.
        bc = null;
        setConnection((c) => ({ ...c, bc: 'inactive' }));
      }
    }

    // 3. WebSocket (optional, only when wsEndpoint set).
    type WsProviderLike = {
      destroy(): void;
      on(event: string, cb: (...args: unknown[]) => void): void;
      off(event: string, cb: (...args: unknown[]) => void): void;
    };
    let wsProvider: WsProviderLike | null = null;
    let wsStatusHandler: ((args: { status: string }) => void) | null = null;

    if (wsEndpoint && typeof WebSocket !== 'undefined') {
      // Dynamic import so SSR / jsdom doesn't pull y-websocket's WebSocket
      // bootstrap into the initial chunk. Failure here drops us to local-only.
      (async () => {
        try {
          const mod = await import('y-websocket');
          if (cancelled) return;
          const { WebsocketProvider } = mod;
          // Trim trailing slash; the doc id is appended as `/ws/<docId>`.
          const base = wsEndpoint.replace(/\/+$/, '');
          // y-websocket appends `/${roomname}` to the serverUrl. We use
          // `${base}/ws` as serverUrl + docId as roomname → final URL is
          // `${base}/ws/${docId}` which matches occt-collab-worker's route.
          const provider = new WebsocketProvider(`${base}/ws`, docId, doc, {
            awareness,
            // Disable y-websocket's built-in BC — we already have one.
            // (Two BCs over the same channel name double every message.)
            disableBc: true,
            connect: true,
          });
          wsProvider = provider as unknown as WsProviderLike;
          wsStatusHandler = ({ status }) => {
            if (cancelled) return;
            setConnection((c) => ({
              ...c,
              ws:
                status === 'connected'
                  ? 'connected'
                  : status === 'connecting'
                  ? 'connecting'
                  : 'disconnected',
            }));
          };
          provider.on('status', wsStatusHandler);
        } catch {
          if (!cancelled) {
            setConnection((c) => ({ ...c, ws: 'disconnected' }));
          }
        }
      })();
    }

    // ─── Awareness change → exposed state ───────────────────────────────────

    const refreshPresence = () => {
      if (cancelled) return;
      const remote = decodeRemotePresence(awareness);
      setRemotePeers(remote);
      setConnection((c) => ({ ...c, peerCount: Object.keys(remote).length }));
      const local = readLocalPresence(awareness);
      if (local) setLocalPeerState(local);
    };
    awareness.on('change', refreshPresence);
    refreshPresence();

    // ─── Cleanup ────────────────────────────────────────────────────────────

    return () => {
      cancelled = true;
      awareness.off('change', refreshPresence);
      if (wsProvider) {
        try {
          if (wsStatusHandler) {
            wsProvider.off('status', wsStatusHandler as (...args: unknown[]) => void);
          }
          wsProvider.destroy();
        } catch {
          /* best-effort */
        }
      }
      if (bc) {
        const cleanup = (bc as unknown as { __cleanup?: () => void }).__cleanup;
        cleanup?.();
        try {
          bc.close();
        } catch {
          /* best-effort */
        }
      }
      if (persistence) {
        // y-indexeddb's destroy is async; we don't await — the doc is about
        // to be destroyed and pending writes will flush via the persistence
        // module's update queue.
        persistence.destroy().catch(() => {
          /* best-effort */
        });
      }
      // Awareness destroyed BEFORE doc — calling `setLocalState(null)`
      // notifies peers of departure cleanly.
      try {
        awareness.setLocalState(null);
        awareness.destroy();
      } catch {
        /* best-effort */
      }
      // Doc is last; transports above have all unbound their listeners.
      try {
        doc.destroy();
      } catch {
        /* best-effort */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, wsEndpoint, doc, awareness]);

  // ─── updateLocalPresence (memoized for stable identity) ────────────────────

  const updateLocalPresence = useCallback(
    (patch: Partial<PeerInfo>) => {
      encodeLocalPresence(awareness, patch);
      const local = readLocalPresence(awareness);
      if (local) setLocalPeerState(local);
    },
    [awareness],
  );

  // ─── Context value ────────────────────────────────────────────────────────

  const value = useMemo<CollabContextValue>(
    () => ({
      doc,
      awareness,
      connection,
      localPeer: localPeerState,
      remotePeers,
      updateLocalPresence,
    }),
    [doc, awareness, connection, localPeerState, remotePeers, updateLocalPresence],
  );

  return <CollabContext.Provider value={value}>{children}</CollabContext.Provider>;
}

// ─── Hooks ──────────────────────────────────────────────────────────────────

function useCollabContext(): CollabContextValue {
  const ctx = useContext(CollabContext);
  if (!ctx) {
    throw new Error('[CollabProvider] hooks must be used within a <CollabProvider>');
  }
  return ctx;
}

export function useCollabDoc(): Y.Doc {
  return useCollabContext().doc;
}

export function useCollabAwareness(): Awareness {
  return useCollabContext().awareness;
}

export function useCollabConnectionState(): CollabConnectionState {
  return useCollabContext().connection;
}

export function useCollabPresence(): {
  localPeer: PeerInfo;
  remotePeers: Record<string, PeerInfo>;
} {
  const ctx = useCollabContext();
  return { localPeer: ctx.localPeer, remotePeers: ctx.remotePeers };
}

export function useCollabUpdateLocalPresence(): (patch: Partial<PeerInfo>) => void {
  return useCollabContext().updateLocalPresence;
}
