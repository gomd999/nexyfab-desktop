'use client';

// SSE transport layer for Yjs CRDT updates. Pairs with
// /api/nexyfab/collab/sse. Connects an EventSource (downlink for remote
// updates) + posts local updates over fetch (uplink). Lower-latency
// real-time replacement for the 2s useCollabPolling cadence.

import { useEffect, useRef, useState } from 'react';
import type { CollabDoc } from './yjsDoc';

export type TransportStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

export function useCollabSseTransport(
  projectId: string | null,
  doc: CollabDoc | null,
  enabled: boolean,
): { status: TransportStatus; sessionId: string | null; peers: number } {
  const [status, setStatus] = useState<TransportStatus>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [peers, setPeers] = useState(0);
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !projectId || !doc) {
      setStatus('idle');
      return;
    }

    setStatus('connecting');
    const url = `/api/nexyfab/collab/sse?project=${encodeURIComponent(projectId)}`;
    const es = new EventSource(url, { withCredentials: true });

    const onReady = (e: MessageEvent) => {
      try {
        const { sessionId: sid, peers: p } = JSON.parse(e.data);
        sessionIdRef.current = sid;
        setSessionId(sid);
        setPeers(p ?? 0);
        setStatus('open');
      } catch { /* ignore malformed ready */ }
    };
    const onDoc = (e: MessageEvent) => {
      try {
        const { update } = JSON.parse(e.data);
        if (typeof update === 'string') doc.applyRemoteUpdate(update);
      } catch { /* ignore */ }
    };
    const onAwareness = (e: MessageEvent) => {
      try {
        const { update } = JSON.parse(e.data);
        if (typeof update === 'string') doc.applyAwarenessUpdate(update);
      } catch { /* ignore */ }
    };

    es.addEventListener('ready', onReady);
    es.addEventListener('doc', onDoc);
    es.addEventListener('awareness', onAwareness);
    es.onerror = () => setStatus('error');

    const post = async (kind: 'doc' | 'awareness', update: string) => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      try {
        await fetch(`/api/nexyfab/collab/sse?project=${encodeURIComponent(projectId)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: sid, update, kind }),
          keepalive: true,
        });
      } catch { /* network — drop, next update will retry */ }
    };

    const offDoc = doc.onLocalUpdate(u => void post('doc', u));
    const offAwareness = doc.onLocalAwarenessUpdate(u => void post('awareness', u));

    return () => {
      es.removeEventListener('ready', onReady);
      es.removeEventListener('doc', onDoc);
      es.removeEventListener('awareness', onAwareness);
      es.close();
      offDoc();
      offAwareness();
      sessionIdRef.current = null;
      setStatus('closed');
    };
  }, [projectId, doc, enabled]);

  return { status, sessionId, peers };
}
