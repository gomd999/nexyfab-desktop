'use client';

// Phase 2 Track A5 — multi-client soak browser companion. Fourth route
// added to the Phase 1 review-checkpoint family at
// /[lang]/collab-smoke{,-feature-tree,-persistence}.
//
// What this verifies in a real browser (the node-side soak in
// __tests__/configStoreSoak.test.ts uses in-process Y.Doc, this proves
// the same code path under React 19 + Next.js client bundling):
//   1. configStoreYjs round-trip preserves a multi-config table across
//      browser-side ESM
//   2. applyConfigOp ops broadcast atomically (transact wraps every op)
//   3. Concurrent addConfig on different ids leaves both configs in the doc
//   4. Concurrent setOverride on disjoint configs both survive
//   5. Concurrent setOverride on same (config, feature, key) converges via LWW
//
// Out of scope: cloud transport, persistence, awareness — those have
// their own routes / tests.

import { useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';

import {
  applyConfigOp,
  configsEqual,
  readActiveConfigId,
  readAllConfigs,
} from '../shape-generator/configurations/configStoreYjs';
import type { ConfigEntry } from '../shape-generator/configurations/types';

const ORIGIN_LOCAL = 'local-ui';
const ORIGIN_REMOTE = 'remote-update';

interface PanelState {
  configs: ConfigEntry[];
  activeId: string | null;
  docSize: number;
  lastOp: string;
}

function snapshotPanel(doc: Y.Doc): Omit<PanelState, 'lastOp'> {
  return {
    configs: readAllConfigs(doc),
    activeId: readActiveConfigId(doc),
    docSize: Y.encodeStateAsUpdate(doc).byteLength,
  };
}

function bootstrap(): { docA: Y.Doc; docB: Y.Doc } {
  const docA = new Y.Doc();
  // Bootstrap on A only — same "join existing doc" invariant from the
  // sketch / feature-tree smoke harnesses (avoids the two-peer
  // createSketch race documented in collab-smoke runbook §Finding).
  applyConfigOp(docA, {
    kind: 'addConfig',
    entry: { id: 'master', name: 'Master', overrides: {}, expressionVars: {} },
  }, ORIGIN_LOCAL);
  const docB = new Y.Doc();
  Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA), ORIGIN_REMOTE);
  return { docA, docB };
}

export default function CollabSmokeConfigsPage() {
  const { docA, docB } = useMemo(() => bootstrap(), []);

  const [autoSync, setAutoSync] = useState(true);
  const [panelA, setPanelA] = useState<PanelState>(() => ({ ...snapshotPanel(docA), lastOp: 'bootstrap' }));
  const [panelB, setPanelB] = useState<PanelState>(() => ({ ...snapshotPanel(docB), lastOp: 'bootstrap (synced from A)' }));
  const [log, setLog] = useState<string[]>([]);
  const lastOpRefA = useRef('init');
  const lastOpRefB = useRef('init');
  const seqRef = useRef(0);

  const autoSyncRef = useRef(autoSync);
  useEffect(() => { autoSyncRef.current = autoSync; }, [autoSync]);

  const pushLog = (line: string) => {
    setLog(prev => {
      const next = [...prev, `${new Date().toISOString().slice(11, 23)}  ${line}`];
      return next.length > 40 ? next.slice(-40) : next;
    });
  };

  // ── Wire up update propagation between docs ───────────────────────────────
  useEffect(() => {
    const onA = (update: Uint8Array, origin: unknown) => {
      if (origin === ORIGIN_REMOTE) return;
      setPanelA({ ...snapshotPanel(docA), lastOp: lastOpRefA.current });
      if (autoSyncRef.current) Y.applyUpdate(docB, update, ORIGIN_REMOTE);
    };
    const onB = (update: Uint8Array, origin: unknown) => {
      if (origin === ORIGIN_REMOTE) return;
      setPanelB({ ...snapshotPanel(docB), lastOp: lastOpRefB.current });
      if (autoSyncRef.current) Y.applyUpdate(docA, update, ORIGIN_REMOTE);
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

  // ── Mutations ─────────────────────────────────────────────────────────────

  const addConfig = (doc: Y.Doc, label: 'A' | 'B') => {
    seqRef.current += 1;
    const id = `${label.toLowerCase()}-${seqRef.current}`;
    const opLabel = `addConfig ${id}`;
    if (label === 'A') lastOpRefA.current = opLabel; else lastOpRefB.current = opLabel;
    applyConfigOp(doc, {
      kind: 'addConfig',
      entry: { id, name: `Variant-${id}`, overrides: {}, expressionVars: {} },
    });
    pushLog(`${label}: ${opLabel}`);
  };

  const overrideFirst = (doc: Y.Doc, label: 'A' | 'B', state: PanelState) => {
    const target = state.configs.find(c => c.id !== 'master');
    if (!target) { pushLog(`${label}: (no config to override)`); return; }
    const val = Math.floor(Math.random() * 100);
    const opLabel = `setOverride ${target.id}/f1.radius=${val}`;
    if (label === 'A') lastOpRefA.current = opLabel; else lastOpRefB.current = opLabel;
    applyConfigOp(doc, { kind: 'setOverride', configId: target.id, featureId: 'f1', paramKey: 'radius', value: val });
    pushLog(`${label}: ${opLabel}`);
  };

  const removeFirst = (doc: Y.Doc, label: 'A' | 'B', state: PanelState) => {
    const target = state.configs.find(c => c.id !== 'master');
    if (!target) { pushLog(`${label}: (no config to remove)`); return; }
    const opLabel = `removeConfig ${target.id}`;
    if (label === 'A') lastOpRefA.current = opLabel; else lastOpRefB.current = opLabel;
    applyConfigOp(doc, { kind: 'removeConfig', id: target.id });
    pushLog(`${label}: ${opLabel}`);
  };

  const renameFirst = (doc: Y.Doc, label: 'A' | 'B', state: PanelState) => {
    const target = state.configs.find(c => c.id !== 'master');
    if (!target) { pushLog(`${label}: (no config to rename)`); return; }
    const opLabel = `renameConfig ${target.id} → ${label}-renamed-${Date.now() % 100}`;
    if (label === 'A') lastOpRefA.current = opLabel; else lastOpRefB.current = opLabel;
    applyConfigOp(doc, { kind: 'renameConfig', id: target.id, name: `${label}-${Date.now() % 100}` });
    pushLog(`${label}: ${opLabel}`);
  };

  const manualSync = (from: Y.Doc, to: Y.Doc, label: string) => {
    const update = Y.encodeStateAsUpdate(from);
    Y.applyUpdate(to, update, ORIGIN_REMOTE);
    pushLog(`manual sync ${label} (${update.byteLength}B)`);
  };

  const stressBoth = () => {
    pushLog('stress: 10 + 10 concurrent adds + 10 + 10 overrides, autoSync OFF');
    const wasAuto = autoSyncRef.current;
    autoSyncRef.current = false;
    setAutoSync(false);
    for (let i = 0; i < 10; i++) {
      addConfig(docA, 'A');
      addConfig(docB, 'B');
    }
    for (let i = 0; i < 10; i++) {
      overrideFirst(docA, 'A', { ...snapshotPanel(docA), lastOp: '' });
      overrideFirst(docB, 'B', { ...snapshotPanel(docB), lastOp: '' });
    }
    manualSync(docA, docB, 'A→B');
    manualSync(docB, docA, 'B→A');
    autoSyncRef.current = wasAuto;
    setAutoSync(wasAuto);
  };

  const converged = configsEqual(panelA.configs, panelB.configs);

  return (
    <main style={{ padding: 24, fontFamily: 'ui-sans-serif, system-ui, sans-serif', color: '#e5e7eb', background: '#0a0a0a', minHeight: '100vh' }}>
      <h1 style={{ fontSize: 20, marginBottom: 8 }}>
        Configurations CRDT Smoke — Phase 2 Track A5 (companion to /collab-smoke{'{,-feature-tree,-persistence}'})
      </h1>
      <p style={{ fontSize: 13, color: '#a3a3a3', marginBottom: 16, maxWidth: 760 }}>
        Two <code>Y.Doc</code> instances share a configurations table.
        Mutations route through <code>applyConfigOp</code>. Top-level
        <code> Y.Map&lt;configId, Y.Map&gt;</code>; per-key LWW on overrides.
      </p>

      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 16, fontSize: 13, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={autoSync} onChange={e => setAutoSync(e.target.checked)} />
          auto-sync
        </label>
        <button onClick={() => manualSync(docA, docB, 'A→B')} style={btnStyle}>Sync A→B</button>
        <button onClick={() => manualSync(docB, docA, 'B→A')} style={btnStyle}>Sync B→A</button>
        <button onClick={stressBoth} style={{ ...btnStyle, background: '#7c2d12' }}>Stress: 40 concurrent</button>
        <span style={{
          marginLeft: 'auto', padding: '4px 10px', borderRadius: 4,
          background: converged ? '#14532d' : '#7f1d1d', fontWeight: 600,
        }}>
          {converged ? 'CONVERGED' : 'DIVERGED'}  (A={panelA.configs.length}  B={panelB.configs.length})
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Panel
          title="Panel A" color="#3b82f6" state={panelA}
          onAdd={() => addConfig(docA, 'A')}
          onOverride={() => overrideFirst(docA, 'A', panelA)}
          onRename={() => renameFirst(docA, 'A', panelA)}
          onRemove={() => removeFirst(docA, 'A', panelA)}
        />
        <Panel
          title="Panel B" color="#10b981" state={panelB}
          onAdd={() => addConfig(docB, 'B')}
          onOverride={() => overrideFirst(docB, 'B', panelB)}
          onRename={() => renameFirst(docB, 'B', panelB)}
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
  onOverride: () => void;
  onRename: () => void;
  onRemove: () => void;
}) {
  return (
    <div style={{ border: `1px solid ${props.color}`, borderRadius: 6, padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <strong style={{ color: props.color, fontSize: 14 }}>{props.title}</strong>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#a3a3a3' }}>
          {props.state.configs.length} configs · active={props.state.activeId ?? '∅'} · {props.state.docSize}B
        </span>
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
        <button onClick={props.onAdd} style={btnStyle}>+ Config</button>
        <button onClick={props.onOverride} style={btnStyle}>Override first</button>
        <button onClick={props.onRename} style={btnStyle}>Rename first</button>
        <button onClick={props.onRemove} style={btnStyle}>− First</button>
      </div>
      <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 6 }}>
        last: {props.state.lastOp}
      </div>
      <ul style={{
        listStyle: 'none', padding: 0, margin: 0, maxHeight: 240, overflowY: 'auto',
        fontSize: 12, fontFamily: 'ui-monospace, monospace',
      }}>
        {props.state.configs.map(cfg => (
          <li key={cfg.id} style={{
            padding: '2px 0', borderBottom: '1px solid #262626',
            color: cfg.id === props.state.activeId ? props.color : '#d4d4d4',
          }}>
            <span style={{ color: props.color }}>{cfg.id}</span>
            {' '}
            <span style={{ color: '#a3a3a3' }}>
              [{cfg.name}{cfg.parentId ? ` p=${cfg.parentId}` : ''}]
              {' '}
              {Object.keys(cfg.overrides).length} ov, {Object.keys(cfg.expressionVars).length} vars
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
