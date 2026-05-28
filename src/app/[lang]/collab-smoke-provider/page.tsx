'use client';

/**
 * collab-smoke-provider — Wave 2 Phase 3 W1 Track Z1 demo harness.
 *
 * This route DOES NOT replace `/collab-smoke` (Phase 1 W2 harness #1). That
 * one exercises the raw `applySketchOp` + manual `Y.encodeStateAsUpdate`
 * round-trip — it's the unit-level CRDT smoke.
 *
 * This harness exercises the NEXT layer up: the `CollabProvider` React
 * Provider that owns the Y.Doc + transports. Two iframes (or two browser
 * tabs) loading this page share the same `docId` and converge through the
 * Provider's BroadcastChannel + IndexedDB layers — no manual update bridging.
 *
 * What this verifies (none of which the Phase 1 harness covers):
 *   1. CollabProvider mounts without crashing in a real browser
 *   2. BroadcastChannel transport propagates updates across tabs
 *   3. y-indexeddb persistence rehydrates on tab reload
 *   4. Awareness layer publishes the local peer + reads remote peers
 *   5. The connection badge reflects the live transport state
 *
 * Open in two tabs of the same browser to see BC sync (no infra needed).
 * Set NEXT_PUBLIC_OCCT_COLLAB_WS_URL to also exercise the WS transport.
 */

import { useEffect, useState } from 'react';
import {
  CollabProvider,
  useCollabDoc,
  useCollabPresence,
  useCollabConnectionState,
  useCollabUpdateLocalPresence,
} from '../shape-generator/collab/CollabProvider';
import { CollabConnectionBadge } from '../shape-generator/collab/CollabConnectionBadge';

const SMOKE_DOC_ID = 'collab-smoke-provider-demo';

function Inner() {
  const doc = useCollabDoc();
  const presence = useCollabPresence();
  const conn = useCollabConnectionState();
  const updatePresence = useCollabUpdateLocalPresence();

  const [counter, setCounter] = useState(0);
  const [name, setName] = useState(presence.localPeer.name);

  // Mirror a counter Y.Map<number> on the shared doc — proves the BC + IDB
  // wiring round-trips production-shaped writes (Y.Map mutate, doc 'update',
  // BC postMessage, peer Y.applyUpdate).
  useEffect(() => {
    const ymap = doc.getMap<number>('demo');
    const refresh = () => {
      setCounter(ymap.get('count') ?? 0);
    };
    ymap.observe(refresh);
    refresh();
    return () => ymap.unobserve(refresh);
  }, [doc]);

  const bump = () => {
    const ymap = doc.getMap<number>('demo');
    const next = (ymap.get('count') ?? 0) + 1;
    ymap.set('count', next);
  };

  const reset = () => {
    doc.getMap<number>('demo').set('count', 0);
  };

  const updateName = (newName: string) => {
    setName(newName);
    updatePresence({ name: newName });
  };

  return (
    <main
      style={{
        padding: 24,
        fontFamily: 'system-ui, sans-serif',
        color: '#e5e7eb',
        background: '#0a0a0a',
        minHeight: '100vh',
      }}
    >
      <h1 style={{ fontSize: 20, marginBottom: 8 }}>
        CollabProvider Smoke Harness — Phase 3 W1 Z1
      </h1>
      <p style={{ fontSize: 13, color: '#a3a3a3', maxWidth: 720, marginBottom: 16 }}>
        Open this page in two tabs of the same browser. The counter and the
        peer list will stay in sync via BroadcastChannel. The connection badge
        (top-right) shows the live transport state.
      </p>

      <section style={section}>
        <h2 style={h2}>Local peer</h2>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          Name:
          <input
            value={name}
            onChange={(e) => updateName(e.target.value)}
            style={input}
          />
          <span
            style={{
              display: 'inline-block',
              width: 14,
              height: 14,
              borderRadius: '50%',
              background: presence.localPeer.color,
              border: '1px solid #374151',
            }}
          />
          <code style={{ color: '#9ca3af', fontSize: 11 }}>id={presence.localPeer.id.slice(0, 8)}…</code>
        </label>
      </section>

      <section style={section}>
        <h2 style={h2}>Shared counter (Y.Map)</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 14 }}>
          <span style={{ fontSize: 24, fontWeight: 700, minWidth: 40, textAlign: 'center' }}>
            {counter}
          </span>
          <button onClick={bump} style={btn}>+ 1</button>
          <button onClick={reset} style={btn}>Reset</button>
        </div>
      </section>

      <section style={section}>
        <h2 style={h2}>Remote peers ({Object.keys(presence.remotePeers).length})</h2>
        {Object.keys(presence.remotePeers).length === 0 ? (
          <p style={{ fontSize: 12, color: '#6b7280', fontStyle: 'italic' }}>
            (open another tab to see remote peers here)
          </p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {Object.values(presence.remotePeers).map((peer) => (
              <li
                key={peer.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '4px 0',
                  fontSize: 13,
                }}
              >
                <span
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    background: peer.color,
                  }}
                />
                <strong>{peer.name}</strong>
                <code style={{ color: '#9ca3af', fontSize: 11 }}>{peer.id.slice(0, 8)}…</code>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section style={section}>
        <h2 style={h2}>Connection state</h2>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 12, fontFamily: 'ui-monospace, monospace' }}>
          <li>WebSocket: <strong>{conn.ws}</strong></li>
          <li>BroadcastChannel: <strong>{conn.bc}</strong></li>
          <li>IndexedDB: <strong>{conn.idb}</strong></li>
          <li>Peer count: <strong>{conn.peerCount}</strong></li>
        </ul>
      </section>
    </main>
  );
}

export default function CollabSmokeProviderPage() {
  // Production wiring: `process.env.NEXT_PUBLIC_OCCT_COLLAB_WS_URL` is the
  // single source of truth. Until the worker (task #31) is deployed leave
  // this env var unset; the Provider falls back to BC+IDB.
  const wsEndpoint = process.env.NEXT_PUBLIC_OCCT_COLLAB_WS_URL || undefined;
  return (
    <CollabProvider docId={SMOKE_DOC_ID} wsEndpoint={wsEndpoint}>
      <CollabConnectionBadge position="top-right" />
      <Inner />
    </CollabProvider>
  );
}

// ─── Inline styles (matches the existing /collab-smoke harness's look) ──────

const section: React.CSSProperties = {
  border: '1px solid #1f2937',
  borderRadius: 6,
  padding: 12,
  marginBottom: 16,
};

const h2: React.CSSProperties = {
  fontSize: 13,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: '#9ca3af',
  marginTop: 0,
  marginBottom: 8,
};

const btn: React.CSSProperties = {
  background: '#1f2937',
  color: '#e5e7eb',
  border: '1px solid #374151',
  padding: '6px 12px',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 13,
};

const input: React.CSSProperties = {
  background: '#111827',
  color: '#e5e7eb',
  border: '1px solid #374151',
  padding: '4px 8px',
  borderRadius: 4,
  fontSize: 13,
  width: 180,
};
