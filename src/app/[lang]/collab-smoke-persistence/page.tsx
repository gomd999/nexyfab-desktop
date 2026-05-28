'use client';

// Phase 1 review-checkpoint signal #1 — offline IndexedDB persistence smoke.
//
// Companion to /[lang]/collab-smoke and /[lang]/collab-smoke-feature-tree.
// IndexedDB only exists in actual browsers — the 15 vitest cases in
// offlinePersistence.test.ts use fake-indexeddb shim, which catches API
// shape regressions but does not exercise:
//   1. The real browser's IndexedDB transaction semantics (auto-commit,
//      multi-tab locking, version upgrade quirks)
//   2. The Tauri webview's IndexedDB implementation (a future-prod target)
//   3. navigator.storage.estimate() — the cache-size display path
//   4. The connect-replay race: y-indexeddb's whenSynced must resolve
//      before any transport connects, otherwise the local cache replay
//      collides with remote initial sync
//
// This harness exercises the round-trip:
//   create doc → apply ops → destroy → recreate from same docId →
//   verify state survived → also test clearLocalCache wipes cleanly.

import { useCallback, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import type { IndexeddbPersistence } from 'y-indexeddb';

import {
  clearLocalCache,
  dbNameFor,
  formatCacheSize,
  getCacheSize,
  setupOfflinePersistence,
} from '../shape-generator/collab/offlinePersistence';
import {
  ORIGIN_LOCAL_UI,
  applySketchOp,
  readSketch,
  type Sketch,
} from '../shape-generator/collab/sketchYjs';
import type { SketchSegment } from '../shape-generator/sketch/types';

const SKETCH_ID = 'smoke-persistence-sketch';
const DOC_ID = 'smoke-persistence-doc';

function makeBaseSketch(): Sketch {
  return {
    id: SKETCH_ID,
    plane: 'xy',
    planeOffset: 0,
    operation: 'add',
    faceFrame: null,
    config: {
      mode: 'extrude',
      depth: 50,
      revolveAngle: 360,
      revolveAxis: 'y',
      segments: 32,
    },
    segments: [],
    constraints: [],
    dimensions: [],
  };
}

function makeLineSeg(id: string): SketchSegment {
  const x1 = Math.round(Math.random() * 100);
  const y1 = Math.round(Math.random() * 100);
  const x2 = Math.round(Math.random() * 100);
  const y2 = Math.round(Math.random() * 100);
  return {
    id,
    type: 'line',
    points: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
  };
}

interface State {
  ready: boolean;
  segCount: number;
  segments: SketchSegment[];
  cacheBytes: number;
  cacheLabel: string;
  dbName: string;
  syncedAt: number | null;
  cycle: number;
}

export default function CollabSmokePersistencePage() {
  const docRef = useRef<Y.Doc | null>(null);
  const persistenceRef = useRef<IndexeddbPersistence | null>(null);
  const [state, setState] = useState<State>({
    ready: false,
    segCount: 0,
    segments: [],
    cacheBytes: 0,
    cacheLabel: '0 B',
    dbName: dbNameFor(DOC_ID),
    syncedAt: null,
    cycle: 0,
  });
  const [log, setLog] = useState<string[]>([]);
  const cycleRef = useRef(0);

  const pushLog = (line: string) => {
    setLog(prev => {
      const next = [...prev, `${new Date().toISOString().slice(11, 23)}  ${line}`];
      return next.length > 50 ? next.slice(-50) : next;
    });
  };

  const refreshSize = useCallback(async () => {
    const bytes = await getCacheSize();
    setState(s => ({ ...s, cacheBytes: bytes, cacheLabel: formatCacheSize(bytes) }));
  }, []);

  const refreshSegments = useCallback(() => {
    const doc = docRef.current;
    if (!doc) return;
    const sk = readSketch(doc, SKETCH_ID);
    setState(s => ({
      ...s,
      segCount: sk?.segments.length ?? 0,
      segments: sk?.segments ?? [],
    }));
  }, []);

  const openDoc = useCallback(async () => {
    if (typeof indexedDB === 'undefined') {
      pushLog('ERROR: IndexedDB not available — run this in a browser.');
      return;
    }
    cycleRef.current += 1;
    const cycle = cycleRef.current;
    const doc = new Y.Doc();
    const persistence = setupOfflinePersistence(doc, DOC_ID);
    docRef.current = doc;
    persistenceRef.current = persistence;
    pushLog(`open #${cycle}: waiting whenSynced…`);
    await persistence.whenSynced;
    pushLog(`open #${cycle}: whenSynced resolved`);

    // Bootstrap the sketch shell if this is a fresh doc.
    const existing = readSketch(doc, SKETCH_ID);
    if (!existing) {
      applySketchOp(doc, { kind: 'createSketch', sketch: makeBaseSketch() }, ORIGIN_LOCAL_UI);
      pushLog(`open #${cycle}: bootstrapped empty sketch`);
    } else {
      pushLog(`open #${cycle}: replayed ${existing.segments.length} segments from cache`);
    }

    const updateHandler = () => refreshSegments();
    doc.on('update', updateHandler);

    setState(s => ({
      ...s,
      ready: true,
      syncedAt: Date.now(),
      cycle,
    }));
    refreshSegments();
    await refreshSize();
  }, [refreshSegments, refreshSize]);

  const closeDoc = useCallback(async () => {
    const doc = docRef.current;
    const persistence = persistenceRef.current;
    if (persistence) {
      await persistence.destroy();
      pushLog('destroy: closed IndexedDB handle (data retained)');
    }
    if (doc) doc.destroy();
    docRef.current = null;
    persistenceRef.current = null;
    setState(s => ({ ...s, ready: false, segments: [], segCount: 0, syncedAt: null }));
  }, []);

  const reopenDoc = useCallback(async () => {
    pushLog('reopen: closing then reopening');
    await closeDoc();
    await openDoc();
  }, [closeDoc, openDoc]);

  const wipeDoc = useCallback(async () => {
    pushLog('clearLocalCache: closing handle + wiping DB');
    await closeDoc();
    await clearLocalCache(DOC_ID);
    pushLog('clearLocalCache: DB deleted, opening fresh');
    await openDoc();
    await refreshSize();
  }, [closeDoc, openDoc, refreshSize]);

  // ── Mutations ───────────────────────────────────────────────────────────

  const addSeg = useCallback(() => {
    const doc = docRef.current;
    if (!doc) return;
    const id = `seg-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    applySketchOp(
      doc,
      { kind: 'addSegment', sketchId: SKETCH_ID, segment: makeLineSeg(id) },
      ORIGIN_LOCAL_UI,
    );
    pushLog(`add: ${id}`);
    void refreshSize();
  }, [refreshSize]);

  const removeFirst = useCallback(() => {
    const doc = docRef.current;
    if (!doc) return;
    const sk = readSketch(doc, SKETCH_ID);
    const first = sk?.segments[0];
    if (!first?.id) { pushLog('(nothing to remove)'); return; }
    applySketchOp(
      doc,
      { kind: 'removeSegment', sketchId: SKETCH_ID, segmentId: first.id },
      ORIGIN_LOCAL_UI,
    );
    pushLog(`remove: ${first.id}`);
    void refreshSize();
  }, [refreshSize]);

  // ── Lifecycle ───────────────────────────────────────────────────────────

  useEffect(() => {
    void openDoc();
    return () => {
      // Best-effort teardown — we don't await here; the IDB handle close
      // is async and React's strict mode runs effect cleanup synchronously.
      void closeDoc();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── UI ───────────────────────────────────────────────────────────────────

  return (
    <main style={{ padding: 24, fontFamily: 'ui-sans-serif, system-ui, sans-serif', color: '#e5e7eb', background: '#0a0a0a', minHeight: '100vh' }}>
      <h1 style={{ fontSize: 20, marginBottom: 8 }}>
        IndexedDB persistence smoke — Phase 1 review signal #1 (third companion)
      </h1>
      <p style={{ fontSize: 13, color: '#a3a3a3', marginBottom: 16, maxWidth: 720 }}>
        Single panel with a Y.Doc + IndexedDB persistence (
        <code>{state.dbName}</code>). Add segments, refresh the page —
        they survive. Click <strong>Wipe + reopen</strong> to confirm{' '}
        <code>clearLocalCache</code> resets the DB cleanly. Cache size
        comes from <code>navigator.storage.estimate()</code> (origin
        total, not just this DB).
      </p>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, fontSize: 13, alignItems: 'center' }}>
        <button onClick={addSeg} style={btnStyle} disabled={!state.ready}>+ Segment</button>
        <button onClick={removeFirst} style={btnStyle} disabled={!state.ready}>− First</button>
        <button onClick={reopenDoc} style={btnStyle} disabled={!state.ready}>Close + reopen</button>
        <button onClick={() => void refreshSize()} style={btnStyle}>Refresh size</button>
        <button onClick={wipeDoc} style={{ ...btnStyle, background: '#7f1d1d' }} disabled={!state.ready}>
          Wipe + reopen
        </button>
        <span style={{
          marginLeft: 'auto', padding: '4px 10px', borderRadius: 4,
          background: state.ready ? '#14532d' : '#525252', fontWeight: 600,
        }}>
          {state.ready ? `READY · cycle #${state.cycle}` : 'WAITING…'}
          {' · '}{state.segCount} seg · {state.cacheLabel}
        </span>
      </div>

      <div style={{ border: '1px solid #3b82f6', borderRadius: 6, padding: 12, marginBottom: 16 }}>
        <strong style={{ color: '#3b82f6', fontSize: 14 }}>Segments (current doc)</strong>
        <ul style={{
          listStyle: 'none', padding: 0, margin: '8px 0 0 0',
          maxHeight: 240, overflowY: 'auto',
          fontSize: 12, fontFamily: 'ui-monospace, monospace',
        }}>
          {state.segments.length === 0 ? (
            <li style={{ color: '#737373' }}>(no segments — try adding some, then refreshing the page)</li>
          ) : state.segments.map(seg => (
            <li key={seg.id ?? Math.random()} style={{ padding: '2px 0', borderBottom: '1px solid #262626' }}>
              <span style={{ color: '#3b82f6' }}>{seg.id}</span>
              {' '}
              <span style={{ color: '#a3a3a3' }}>
                {seg.points.map(p => `(${p.x},${p.y})`).join('→')}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <h2 style={{ fontSize: 14, marginBottom: 8 }}>Op log</h2>
      <pre style={{
        background: '#171717', padding: 12, borderRadius: 6,
        fontSize: 12, lineHeight: 1.5, maxHeight: 320, overflowY: 'auto',
      }}>
        {log.length === 0 ? '(no ops yet)' : log.join('\n')}
      </pre>
    </main>
  );
}

const btnStyle: React.CSSProperties = {
  background: '#1f2937', color: '#e5e7eb', border: '1px solid #374151',
  padding: '6px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 13,
};
