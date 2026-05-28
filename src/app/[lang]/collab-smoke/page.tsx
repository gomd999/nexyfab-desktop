'use client';

// Phase 1 review-checkpoint signal #1 — CRDT prototype browser smoke test.
//
// Two side-by-side Y.Doc panels share one sketchId. Each panel mutates its
// own Y.Doc through the production applySketchOp API; an observer ships the
// resulting Y update to the OTHER doc via Y.encodeStateAsUpdate /
// Y.applyUpdate. Both docs are kept in the same window so reviewers can
// exercise convergence without running two browsers.
//
// What this verifies (none of these are covered by the node-side vitest
// suites — those use fake-indexeddb and never exercise a real browser yjs
// runtime):
//   1. sketchYjs.applySketchOp runs in a real browser without ESM/CommonJS
//      friction
//   2. Y.encodeStateAsUpdate / Y.applyUpdate round-trip preserves the
//      Y.Map<id, Y.Map> structure across docs
//   3. Concurrent edits on different ids merge cleanly
//   4. Concurrent edits on the same id LWW-converge per the architecture
//      doc (Wave 2 doc §3.3)
//
// Out of scope here: cloud transport (occt-collab-worker), awareness,
// persistence. Those have their own runbooks.

import { useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';

import {
  ORIGIN_LOCAL_UI,
  ORIGIN_REMOTE_UPDATE,
  applySketchOp,
  readSketch,
  type Sketch,
} from '../shape-generator/collab/sketchYjs';
import type { SketchSegment } from '../shape-generator/sketch/types';

const SKETCH_ID = 'smoke-sketch';

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

function makeLineSegment(id: string, x1: number, y1: number, x2: number, y2: number): SketchSegment {
  return {
    id,
    type: 'line',
    points: [
      { x: x1, y: y1 },
      { x: x2, y: y2 },
    ],
  };
}

interface PanelState {
  segmentCount: number;
  segments: SketchSegment[];
  docSize: number;
  lastOp: string;
}

function snapshotPanel(doc: Y.Doc): PanelState {
  const sk = readSketch(doc, SKETCH_ID);
  return {
    segmentCount: sk?.segments.length ?? 0,
    segments: sk?.segments ?? [],
    docSize: Y.encodeStateAsUpdate(doc).byteLength,
    lastOp: '',
  };
}

export default function CollabSmokePage() {
  const docA = useMemo(() => new Y.Doc(), []);
  const docB = useMemo(() => new Y.Doc(), []);

  const [autoSync, setAutoSync] = useState(true);
  const [panelA, setPanelA] = useState<PanelState>(() => ({
    segmentCount: 0,
    segments: [],
    docSize: 0,
    lastOp: 'init',
  }));
  const [panelB, setPanelB] = useState<PanelState>(() => ({
    segmentCount: 0,
    segments: [],
    docSize: 0,
    lastOp: 'init',
  }));
  const [log, setLog] = useState<string[]>([]);
  const lastOpRefA = useRef('init');
  const lastOpRefB = useRef('init');

  const pushLog = (line: string) => {
    setLog(prev => {
      const next = [...prev, `${new Date().toISOString().slice(11, 23)}  ${line}`];
      return next.length > 40 ? next.slice(-40) : next;
    });
  };

  useEffect(() => {
    // Bootstrap on A only, then ship the initial state to B. Two
    // independent createSketch calls with the same sketchId would LWW
    // into one and discard the loser's sub-tree (sketchYjs.ts:417). In a
    // real collab session both peers arrive at an existing doc via sync,
    // so this mirrors production.
    applySketchOp(docA, { kind: 'createSketch', sketch: makeBaseSketch() }, ORIGIN_LOCAL_UI);
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA), ORIGIN_REMOTE_UPDATE);
    setPanelA({ ...snapshotPanel(docA), lastOp: 'bootstrap' });
    setPanelB({ ...snapshotPanel(docB), lastOp: 'bootstrap (synced from A)' });
    pushLog('bootstrap: createSketch on A → sync to B');

    const onA = (update: Uint8Array, origin: unknown) => {
      if (origin === ORIGIN_REMOTE_UPDATE) return;
      setPanelA({ ...snapshotPanel(docA), lastOp: lastOpRefA.current });
      if (autoSyncRef.current) {
        Y.applyUpdate(docB, update, ORIGIN_REMOTE_UPDATE);
      }
    };
    const onB = (update: Uint8Array, origin: unknown) => {
      if (origin === ORIGIN_REMOTE_UPDATE) return;
      setPanelB({ ...snapshotPanel(docB), lastOp: lastOpRefB.current });
      if (autoSyncRef.current) {
        Y.applyUpdate(docA, update, ORIGIN_REMOTE_UPDATE);
      }
    };

    docA.on('update', onA);
    docB.on('update', onB);

    // Also re-snapshot panels on remote-update so the UI reflects the
    // mirrored state after applyUpdate.
    const onRemoteA = (_update: Uint8Array, origin: unknown) => {
      if (origin === ORIGIN_REMOTE_UPDATE) {
        setPanelA({ ...snapshotPanel(docA), lastOp: 'remote-applied' });
      }
    };
    const onRemoteB = (_update: Uint8Array, origin: unknown) => {
      if (origin === ORIGIN_REMOTE_UPDATE) {
        setPanelB({ ...snapshotPanel(docB), lastOp: 'remote-applied' });
      }
    };
    docA.on('update', onRemoteA);
    docB.on('update', onRemoteB);

    return () => {
      docA.off('update', onA);
      docB.off('update', onB);
      docA.off('update', onRemoteA);
      docB.off('update', onRemoteB);
      docA.destroy();
      docB.destroy();
    };
  }, [docA, docB]);

  // Keep autoSync flag readable from inside the update handler without
  // re-subscribing the listener on every toggle.
  const autoSyncRef = useRef(autoSync);
  useEffect(() => {
    autoSyncRef.current = autoSync;
  }, [autoSync]);

  // ── Mutations ───────────────────────────────────────────────────────────

  const addRandomSegmentTo = (doc: Y.Doc, label: 'A' | 'B') => {
    const id = `seg-${label}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const x1 = Math.round(Math.random() * 100);
    const y1 = Math.round(Math.random() * 100);
    const x2 = Math.round(Math.random() * 100);
    const y2 = Math.round(Math.random() * 100);
    const opLabel = `addSegment ${id} (${x1},${y1})→(${x2},${y2})`;
    if (label === 'A') lastOpRefA.current = opLabel;
    else lastOpRefB.current = opLabel;
    applySketchOp(
      doc,
      {
        kind: 'addSegment',
        sketchId: SKETCH_ID,
        segment: makeLineSegment(id, x1, y1, x2, y2),
      },
      ORIGIN_LOCAL_UI,
    );
    pushLog(`${label}: ${opLabel}`);
  };

  const removeFirstFrom = (doc: Y.Doc, label: 'A' | 'B') => {
    const sk = readSketch(doc, SKETCH_ID);
    const first = sk?.segments[0];
    if (!first || !first.id) {
      pushLog(`${label}: (nothing to remove)`);
      return;
    }
    const opLabel = `removeSegment ${first.id}`;
    if (label === 'A') lastOpRefA.current = opLabel;
    else lastOpRefB.current = opLabel;
    applySketchOp(
      doc,
      { kind: 'removeSegment', sketchId: SKETCH_ID, segmentId: first.id },
      ORIGIN_LOCAL_UI,
    );
    pushLog(`${label}: ${opLabel}`);
  };

  const movePointOnFirst = (doc: Y.Doc, label: 'A' | 'B') => {
    const sk = readSketch(doc, SKETCH_ID);
    const first = sk?.segments[0];
    if (!first || !first.id) {
      pushLog(`${label}: (nothing to move)`);
      return;
    }
    const dx = Math.round((Math.random() - 0.5) * 40);
    const dy = Math.round((Math.random() - 0.5) * 40);
    const moved = first.points.map((p, i) =>
      i === 0 ? { x: p.x + dx, y: p.y + dy } : p,
    );
    const opLabel = `updateSegment ${first.id} d=(${dx},${dy})`;
    if (label === 'A') lastOpRefA.current = opLabel;
    else lastOpRefB.current = opLabel;
    applySketchOp(
      doc,
      {
        kind: 'updateSegment',
        sketchId: SKETCH_ID,
        segmentId: first.id,
        patch: { points: moved },
      },
      ORIGIN_LOCAL_UI,
    );
    pushLog(`${label}: ${opLabel}`);
  };

  const manualSync = (from: Y.Doc, to: Y.Doc, label: string) => {
    const update = Y.encodeStateAsUpdate(from);
    Y.applyUpdate(to, update, ORIGIN_REMOTE_UPDATE);
    pushLog(`manual sync ${label} (${update.byteLength}B)`);
  };

  const stressBoth = () => {
    pushLog('stress: 20 concurrent adds, half on each, autoSync OFF');
    const wasAuto = autoSyncRef.current;
    autoSyncRef.current = false;
    setAutoSync(false);
    for (let i = 0; i < 10; i++) {
      addRandomSegmentTo(docA, 'A');
      addRandomSegmentTo(docB, 'B');
    }
    // Cross-sync to converge.
    manualSync(docA, docB, 'A→B');
    manualSync(docB, docA, 'B→A');
    autoSyncRef.current = wasAuto;
    setAutoSync(wasAuto);
  };

  // ── UI ───────────────────────────────────────────────────────────────────

  const converged = panelA.segmentCount === panelB.segmentCount;

  return (
    <main style={{ padding: 24, fontFamily: 'ui-sans-serif, system-ui, sans-serif', color: '#e5e7eb', background: '#0a0a0a', minHeight: '100vh' }}>
      <h1 style={{ fontSize: 20, marginBottom: 8 }}>
        CRDT Smoke Harness — Phase 1 review signal #1
      </h1>
      <p style={{ fontSize: 13, color: '#a3a3a3', marginBottom: 16, maxWidth: 720 }}>
        Two Y.Doc instances (panel A and B) share <code>sketchId=&quot;{SKETCH_ID}&quot;</code>.
        Each panel&apos;s mutations go through <code>applySketchOp</code> (the production CRDT API).
        Auto-sync forwards every local update to the peer; the &quot;Stress&quot; button
        queues concurrent ops while sync is paused, then converges.
      </p>

      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 16, fontSize: 13 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="checkbox"
            checked={autoSync}
            onChange={e => setAutoSync(e.target.checked)}
          />
          auto-sync
        </label>
        <button onClick={() => manualSync(docA, docB, 'A→B')} style={btnStyle}>Sync A→B</button>
        <button onClick={() => manualSync(docB, docA, 'B→A')} style={btnStyle}>Sync B→A</button>
        <button onClick={stressBoth} style={{ ...btnStyle, background: '#7c2d12' }}>
          Stress: 20 concurrent
        </button>
        <span style={{
          marginLeft: 'auto',
          padding: '4px 10px',
          borderRadius: 4,
          background: converged ? '#14532d' : '#7f1d1d',
          fontWeight: 600,
        }}>
          {converged ? 'CONVERGED' : 'DIVERGED'}  (A={panelA.segmentCount}  B={panelB.segmentCount})
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Panel
          title="Panel A"
          color="#3b82f6"
          state={panelA}
          onAdd={() => addRandomSegmentTo(docA, 'A')}
          onMove={() => movePointOnFirst(docA, 'A')}
          onRemove={() => removeFirstFrom(docA, 'A')}
        />
        <Panel
          title="Panel B"
          color="#10b981"
          state={panelB}
          onAdd={() => addRandomSegmentTo(docB, 'B')}
          onMove={() => movePointOnFirst(docB, 'B')}
          onRemove={() => removeFirstFrom(docB, 'B')}
        />
      </div>

      <h2 style={{ fontSize: 14, marginTop: 24, marginBottom: 8 }}>Op log</h2>
      <pre style={{
        background: '#171717',
        padding: 12,
        borderRadius: 6,
        fontSize: 12,
        lineHeight: 1.5,
        maxHeight: 240,
        overflowY: 'auto',
      }}>
        {log.length === 0 ? '(no ops yet)' : log.join('\n')}
      </pre>
    </main>
  );
}

const btnStyle: React.CSSProperties = {
  background: '#1f2937',
  color: '#e5e7eb',
  border: '1px solid #374151',
  padding: '6px 12px',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 13,
};

function Panel(props: {
  title: string;
  color: string;
  state: PanelState;
  onAdd: () => void;
  onMove: () => void;
  onRemove: () => void;
}) {
  return (
    <div style={{ border: `1px solid ${props.color}`, borderRadius: 6, padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <strong style={{ color: props.color, fontSize: 14 }}>{props.title}</strong>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#a3a3a3' }}>
          {props.state.segmentCount} seg · {props.state.docSize}B
        </span>
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <button onClick={props.onAdd} style={btnStyle}>+ Segment</button>
        <button onClick={props.onMove} style={btnStyle}>Move first</button>
        <button onClick={props.onRemove} style={btnStyle}>− First</button>
      </div>
      <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 6 }}>
        last: {props.state.lastOp}
      </div>
      <ul style={{
        listStyle: 'none',
        padding: 0,
        margin: 0,
        maxHeight: 200,
        overflowY: 'auto',
        fontSize: 12,
        fontFamily: 'ui-monospace, monospace',
      }}>
        {props.state.segments.map(seg => (
          <li key={seg.id ?? Math.random()} style={{ padding: '2px 0', borderBottom: '1px solid #262626' }}>
            <span style={{ color: props.color }}>{seg.id}</span>
            {' '}
            <span style={{ color: '#a3a3a3' }}>
              {seg.points.map(p => `(${p.x},${p.y})`).join('→')}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
