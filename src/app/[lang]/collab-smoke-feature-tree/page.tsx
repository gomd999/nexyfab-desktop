'use client';

// Phase 1 review-checkpoint signal #1 — feature-tree CRDT browser smoke.
//
// Companion to /[lang]/collab-smoke (which exercises sketchYjs). The
// feature-tree CRDT has different topology (Y.Array<Y.Map> at the root,
// not Y.Map<id, Y.Map>) so it has its own convergence properties worth
// exercising in a real browser.
//
// What this verifies in a browser (the node-side vitest cases use plain
// in-process Y.Doc instances; this proves the same code path under
// React 19 + Next.js client bundling):
//   1. featureTreeToYDoc / yDocToFeatureTree round-trip preserves a
//      multi-node tree across browser-side ESM
//   2. applyFeatureOp ops broadcast atomically (transact wraps every op)
//   3. Concurrent addNode on different ids leaves both nodes in the array
//   4. Concurrent updateParams on the same node converges per-key LWW
//      (the per-key merge property — different from sketch's per-id LWW)
//
// Out of scope here: cloud transport, persistence, awareness, undo —
// each has its own vitest coverage on the same branch.

import { useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';

import {
  applyFeatureOp,
  featureTreeToYDoc,
  yDocToFeatureTree,
} from '../shape-generator/collab/featureTreeYjs';
import type { FeatureHistory, HistoryNode } from '../shape-generator/useFeatureStack';

const FEATURE_TYPES = ['fillet', 'chamfer', 'shell', 'hole'] as const;

function makeRootNode(): HistoryNode {
  return {
    id: 'root',
    type: 'baseShape',
    label: 'Base',
    icon: '📦',
    params: { width: 100, height: 100, depth: 100 },
    enabled: true,
    expanded: true,
    parentId: null,
    children: [],
    editingActive: false,
    timestamp: Date.now(),
  };
}

function makeBaseHistory(): FeatureHistory {
  return {
    nodes: [makeRootNode()],
    rootId: 'root',
    activeNodeId: 'root',
    editingNodeId: null,
  };
}

function makeFeatureNode(label: 'A' | 'B', seq: number): HistoryNode {
  const featureType = FEATURE_TYPES[seq % FEATURE_TYPES.length]!;
  const id = `feat-${label}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const params: Record<string, number> =
    featureType === 'fillet' ? { radius: 5 } :
    featureType === 'chamfer' ? { distance: 2 } :
    featureType === 'shell' ? { thickness: 3 } :
    /* hole */ { diameter: 6 };
  return {
    id,
    type: 'feature',
    featureType,
    label: `${featureType}-${seq}`,
    icon: '🔧',
    params,
    enabled: true,
    expanded: true,
    parentId: 'root',
    children: [],
    editingActive: false,
    timestamp: Date.now(),
  };
}

interface PanelState {
  nodes: HistoryNode[];
  docSize: number;
  lastOp: string;
}

function snapshotPanel(doc: Y.Doc): Omit<PanelState, 'lastOp'> {
  const snap = yDocToFeatureTree(doc);
  return {
    nodes: snap.tree.nodes,
    docSize: Y.encodeStateAsUpdate(doc).byteLength,
  };
}

const ORIGIN_LOCAL = 'local-ui';
const ORIGIN_REMOTE = 'remote-update';

export default function CollabSmokeFeatureTreePage() {
  const { docA, docB } = useMemo(() => {
    // Bootstrap on A only — "join existing doc" invariant from the
    // sketch smoke harness applies equally here.
    const a = featureTreeToYDoc(makeBaseHistory());
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a), ORIGIN_REMOTE);
    return { docA: a, docB: b };
  }, []);

  const [autoSync, setAutoSync] = useState(true);
  const [panelA, setPanelA] = useState<PanelState>(() => ({ ...snapshotPanel(docA), lastOp: 'bootstrap' }));
  const [panelB, setPanelB] = useState<PanelState>(() => ({ ...snapshotPanel(docB), lastOp: 'bootstrap (synced from A)' }));
  const [log, setLog] = useState<string[]>([]);
  const lastOpRefA = useRef('init');
  const lastOpRefB = useRef('init');
  const seqRef = useRef(0);

  const pushLog = (line: string) => {
    setLog(prev => {
      const next = [...prev, `${new Date().toISOString().slice(11, 23)}  ${line}`];
      return next.length > 40 ? next.slice(-40) : next;
    });
  };

  const autoSyncRef = useRef(autoSync);
  useEffect(() => { autoSyncRef.current = autoSync; }, [autoSync]);

  useEffect(() => {
    const onA = (update: Uint8Array, origin: unknown) => {
      if (origin === ORIGIN_REMOTE) return;
      setPanelA({ ...snapshotPanel(docA), lastOp: lastOpRefA.current });
      if (autoSyncRef.current) {
        Y.applyUpdate(docB, update, ORIGIN_REMOTE);
      }
    };
    const onB = (update: Uint8Array, origin: unknown) => {
      if (origin === ORIGIN_REMOTE) return;
      setPanelB({ ...snapshotPanel(docB), lastOp: lastOpRefB.current });
      if (autoSyncRef.current) {
        Y.applyUpdate(docA, update, ORIGIN_REMOTE);
      }
    };
    const onRemoteA = (_u: Uint8Array, origin: unknown) => {
      if (origin === ORIGIN_REMOTE) setPanelA({ ...snapshotPanel(docA), lastOp: 'remote-applied' });
    };
    const onRemoteB = (_u: Uint8Array, origin: unknown) => {
      if (origin === ORIGIN_REMOTE) setPanelB({ ...snapshotPanel(docB), lastOp: 'remote-applied' });
    };
    docA.on('update', onA);
    docB.on('update', onB);
    docA.on('update', onRemoteA);
    docB.on('update', onRemoteB);
    return () => {
      docA.off('update', onA);
      docB.off('update', onB);
      docA.off('update', onRemoteA);
      docB.off('update', onRemoteB);
    };
  }, [docA, docB]);

  // ── Mutations ───────────────────────────────────────────────────────────

  const featureCount = (state: PanelState) =>
    state.nodes.filter(n => n.type === 'feature').length;
  const firstFeature = (state: PanelState) =>
    state.nodes.find(n => n.type === 'feature') ?? null;

  const addFeature = (doc: Y.Doc, label: 'A' | 'B', state: PanelState) => {
    seqRef.current += 1;
    const node = makeFeatureNode(label, seqRef.current);
    const opLabel = `addNode ${node.label} (${node.id.slice(0, 12)}…)`;
    if (label === 'A') lastOpRefA.current = opLabel;
    else lastOpRefB.current = opLabel;
    applyFeatureOp(doc, { kind: 'addNode', node });
    pushLog(`${label}: ${opLabel}`);
    void state;
  };

  const editFirst = (doc: Y.Doc, label: 'A' | 'B', state: PanelState) => {
    const first = firstFeature(state);
    if (!first) { pushLog(`${label}: (no feature to edit)`); return; }
    const paramKey = Object.keys(first.params)[0];
    if (!paramKey) { pushLog(`${label}: (no params to edit)`); return; }
    const newVal = Math.round((first.params[paramKey] ?? 0) + (Math.random() - 0.5) * 10);
    const opLabel = `updateParams ${first.label} ${paramKey}=${newVal}`;
    if (label === 'A') lastOpRefA.current = opLabel;
    else lastOpRefB.current = opLabel;
    applyFeatureOp(doc, { kind: 'updateParams', id: first.id, params: { [paramKey]: newVal } });
    pushLog(`${label}: ${opLabel}`);
  };

  const toggleFirst = (doc: Y.Doc, label: 'A' | 'B', state: PanelState) => {
    const first = firstFeature(state);
    if (!first) { pushLog(`${label}: (no feature to toggle)`); return; }
    const opLabel = `setEnabled ${first.label}=${!first.enabled}`;
    if (label === 'A') lastOpRefA.current = opLabel;
    else lastOpRefB.current = opLabel;
    applyFeatureOp(doc, { kind: 'setEnabled', id: first.id, enabled: !first.enabled });
    pushLog(`${label}: ${opLabel}`);
  };

  const removeFirst = (doc: Y.Doc, label: 'A' | 'B', state: PanelState) => {
    const first = firstFeature(state);
    if (!first) { pushLog(`${label}: (no feature to remove)`); return; }
    const opLabel = `removeNode ${first.label}`;
    if (label === 'A') lastOpRefA.current = opLabel;
    else lastOpRefB.current = opLabel;
    applyFeatureOp(doc, { kind: 'removeNode', id: first.id });
    pushLog(`${label}: ${opLabel}`);
  };

  const manualSync = (from: Y.Doc, to: Y.Doc, label: string) => {
    const update = Y.encodeStateAsUpdate(from);
    Y.applyUpdate(to, update, ORIGIN_REMOTE);
    pushLog(`manual sync ${label} (${update.byteLength}B)`);
  };

  const stressBoth = () => {
    pushLog('stress: 10 + 10 concurrent adds, autoSync OFF');
    const wasAuto = autoSyncRef.current;
    autoSyncRef.current = false;
    setAutoSync(false);
    for (let i = 0; i < 10; i++) {
      addFeature(docA, 'A', panelA);
      addFeature(docB, 'B', panelB);
    }
    manualSync(docA, docB, 'A→B');
    manualSync(docB, docA, 'B→A');
    autoSyncRef.current = wasAuto;
    setAutoSync(wasAuto);
  };

  const converged = featureCount(panelA) === featureCount(panelB);

  return (
    <main style={{ padding: 24, fontFamily: 'ui-sans-serif, system-ui, sans-serif', color: '#e5e7eb', background: '#0a0a0a', minHeight: '100vh' }}>
      <h1 style={{ fontSize: 20, marginBottom: 8 }}>
        Feature-tree CRDT Smoke — Phase 1 review signal #1 (companion to /collab-smoke)
      </h1>
      <p style={{ fontSize: 13, color: '#a3a3a3', marginBottom: 16, maxWidth: 720 }}>
        Two Y.Doc instances share a feature tree (root + N feature nodes).
        Mutations go through <code>applyFeatureOp</code>. Tree topology is
        Y.Array&lt;Y.Map&gt; (ordered), distinct from the sketch CRDT&apos;s
        Y.Map&lt;id, Y.Map&gt;. Per-key params LWW.
      </p>

      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 16, fontSize: 13 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={autoSync} onChange={e => setAutoSync(e.target.checked)} />
          auto-sync
        </label>
        <button onClick={() => manualSync(docA, docB, 'A→B')} style={btnStyle}>Sync A→B</button>
        <button onClick={() => manualSync(docB, docA, 'B→A')} style={btnStyle}>Sync B→A</button>
        <button onClick={stressBoth} style={{ ...btnStyle, background: '#7c2d12' }}>Stress: 20 concurrent</button>
        <span style={{
          marginLeft: 'auto', padding: '4px 10px', borderRadius: 4,
          background: converged ? '#14532d' : '#7f1d1d', fontWeight: 600,
        }}>
          {converged ? 'CONVERGED' : 'DIVERGED'}  (A={featureCount(panelA)}  B={featureCount(panelB)})
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Panel
          title="Panel A" color="#3b82f6" state={panelA}
          onAdd={() => addFeature(docA, 'A', panelA)}
          onEdit={() => editFirst(docA, 'A', panelA)}
          onToggle={() => toggleFirst(docA, 'A', panelA)}
          onRemove={() => removeFirst(docA, 'A', panelA)}
        />
        <Panel
          title="Panel B" color="#10b981" state={panelB}
          onAdd={() => addFeature(docB, 'B', panelB)}
          onEdit={() => editFirst(docB, 'B', panelB)}
          onToggle={() => toggleFirst(docB, 'B', panelB)}
          onRemove={() => removeFirst(docB, 'B', panelB)}
        />
      </div>

      <h2 style={{ fontSize: 14, marginTop: 24, marginBottom: 8 }}>Op log</h2>
      <pre style={{
        background: '#171717', padding: 12, borderRadius: 6,
        fontSize: 12, lineHeight: 1.5, maxHeight: 240, overflowY: 'auto',
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

function Panel(props: {
  title: string;
  color: string;
  state: PanelState;
  onAdd: () => void;
  onEdit: () => void;
  onToggle: () => void;
  onRemove: () => void;
}) {
  return (
    <div style={{ border: `1px solid ${props.color}`, borderRadius: 6, padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <strong style={{ color: props.color, fontSize: 14 }}>{props.title}</strong>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#a3a3a3' }}>
          {props.state.nodes.length} nodes · {props.state.docSize}B
        </span>
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
        <button onClick={props.onAdd} style={btnStyle}>+ Feature</button>
        <button onClick={props.onEdit} style={btnStyle}>Edit first</button>
        <button onClick={props.onToggle} style={btnStyle}>Toggle first</button>
        <button onClick={props.onRemove} style={btnStyle}>− First</button>
      </div>
      <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 6 }}>
        last: {props.state.lastOp}
      </div>
      <ul style={{
        listStyle: 'none', padding: 0, margin: 0, maxHeight: 200, overflowY: 'auto',
        fontSize: 12, fontFamily: 'ui-monospace, monospace',
      }}>
        {props.state.nodes.map(node => (
          <li key={node.id} style={{
            padding: '2px 0', borderBottom: '1px solid #262626',
            opacity: node.enabled ? 1 : 0.5,
          }}>
            <span style={{ color: props.color }}>{node.label}</span>
            {' '}
            <span style={{ color: '#a3a3a3' }}>
              [{node.type}{node.featureType ? `/${node.featureType}` : ''}]
              {' '}{node.enabled ? '✓' : '✗'}
              {' '}
              {Object.entries(node.params).map(([k, v]) => `${k}=${v}`).join(', ')}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
