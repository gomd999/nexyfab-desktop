'use client';

// Assembly mode left pane — Components / Mates / BOM 3-tab matching
// mockup #31. Reads the assembly snapshot from shellBridgeStore.

import { useState } from 'react';
import { SidePanel, Tree, type TreeNode } from './';
import { pickShellDict, type ShellDict } from '../shellDict';

// Mate-type → bullet glyph. Shared with the right pane.
export const MATE_BULLET: Record<string, string> = {
  coincident: '≡', concentric: '◎', distance: '↔', angle: '∠',
  parallel: '∥', perpendicular: '⟂', tangent: '◠', hinge: '⤿', slider: '⇄', gear: '⚙',
};

export function mateMeta(type: string, value: number | undefined, d: ShellDict): string {
  const name = d.mateTypes[type as keyof ShellDict['mateTypes']]
    ?? type.charAt(0).toUpperCase() + type.slice(1);
  if (value === undefined) return name;
  const unit = type === 'angle' ? '°' : ' mm';
  return `${name} · ${value}${unit}`;
}
import { useShellBridge, type ShellMate } from '../shellBridgeStore';
import { useUIStore } from '../../store/uiStore';
import { I } from '../Icons';

// Mate list with inline add / delete / lock controls — shared by the left and
// right assembly panes. Opens the full editor via the uiStore; per-row actions
// dispatch events the Inner monolith listens for. (2026-06-09 P1)
export function MateList({ mates, isEmpty, d }: { mates: ShellMate[]; isEmpty: boolean; d: ShellDict }) {
  const openEditor = () => { try { useUIStore.getState().setShowAssemblyPanel(true); } catch { /* ignore */ } };
  const remove = (id: string) => window.dispatchEvent(new CustomEvent('nexyfab:assembly-mate-remove', { detail: { id } }));
  const toggle = (id: string) => window.dispatchEvent(new CustomEvent('nexyfab:assembly-mate-toggle', { detail: { id } }));
  const iconBtn: React.CSSProperties = {
    border: 'none', background: 'transparent', color: 'var(--nx-text-3)',
    cursor: 'pointer', fontSize: 11, padding: '2px 4px', flexShrink: 0,
  };
  return (
    <div style={{ padding: '6px 0', fontSize: 11 }}>
      <button
        type="button"
        onClick={openEditor}
        disabled={isEmpty}
        style={{
          width: '100%', marginBottom: 6, padding: '6px 8px', borderRadius: 6,
          border: '1px solid var(--nx-accent-line)', background: 'var(--nx-accent-soft)',
          color: 'var(--nx-text)', fontSize: 11, fontWeight: 700,
          cursor: isEmpty ? 'not-allowed' : 'pointer', opacity: isEmpty ? 0.5 : 1,
        }}
      >
        + {d.addMate}
      </button>
      {mates.length === 0 ? (
        <div style={{ padding: '12px 8px', textAlign: 'center', color: 'var(--nx-text-3)', lineHeight: 1.5 }}>
          {isEmpty ? d.insertPartsFirst : d.noMatesYet}
        </div>
      ) : mates.map(m => (
        <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 4px' }}>
          <span style={{ width: 12, flexShrink: 0, textAlign: 'center', color: 'var(--nx-text-2)' }}>{MATE_BULLET[m.type] ?? '↗'}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.partA} ↔ {m.partB}</div>
            <div style={{ fontSize: 9, color: 'var(--nx-text-3)' }}>{mateMeta(m.type, m.value, d)}</div>
          </div>
          <button type="button" onClick={() => toggle(m.id)} title={m.locked ? 'Unlock' : 'Lock'} style={iconBtn}>{m.locked ? '🔒' : '🔓'}</button>
          <button type="button" onClick={() => remove(m.id)} title={d.deleteWord} style={iconBtn}>✕</button>
        </div>
      ))}
    </div>
  );
}

export interface AssemblyLeftPaneProps {
  lang: string;
}

export function AssemblyLeftPane({ lang }: AssemblyLeftPaneProps) {
  const d = pickShellDict(lang);
  const items = useShellBridge(s => s.assemblyItems);
  const mates = useShellBridge(s => s.assemblyMates);
  const selectedId = useShellBridge(s => s.selectedAssemblyId);
  const [activeTab, setActiveTab] = useState<'components' | 'mates' | 'bom'>('components');

  const treeNodes: TreeNode[] = items.map(item => ({
    id: item.id,
    label: item.label,
    icon: item.kind === 'subassembly'
      ? <I.layers size={12} />
      : <I.cube size={12} />,
    meta: item.count > 1 ? `${item.count}×` : undefined,
  }));
  const isEmpty = items.length === 0;

  return (
    <SidePanel
      side="left"
      title={d.asmTitle}
      titleIcon={<I.layers size={12} />}
      tabs={[
        { id: 'components', label: d.tabComponents, icon: <I.cube size={12} /> },
        { id: 'mates', label: d.tabMates, icon: <I.link size={12} /> },
        { id: 'bom', label: 'BOM', icon: <I.doc size={12} /> },
      ]}
      activeTab={activeTab}
      onTabChange={(id) => setActiveTab(id as typeof activeTab)}
    >
      {activeTab === 'components' && (
        isEmpty ? (
          <EmptyHint text={d.noComponents} />
        ) : (
          <Tree
            nodes={treeNodes}
            selectedId={selectedId}
            onSelect={(id) => {
              // Inner listens via `nexyfab:select-assembly` and routes to
              // the assembly browser / selection store. Event-based wiring
              // mirrors how the feature tree fires `nexyfab:select-feature`
              // so this sidebar stays decoupled from Inner's state.
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('nexyfab:select-assembly', { detail: { id } }));
              }
            }}
          />
        )
      )}
      {activeTab === 'mates' && (
        <MateList mates={mates} isEmpty={isEmpty} d={d} />
      )}
      {activeTab === 'bom' && (
        isEmpty
          ? <EmptyHint text={d.bomEmpty} />
          : <BomList items={items} d={d} />
      )}
    </SidePanel>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div style={{
      padding: '24px 16px', textAlign: 'center',
      fontSize: 11, lineHeight: 1.6, color: 'var(--nx-text-3)',
    }}>
      {text}
    </div>
  );
}

function BomList({ items, d }: { items: ReturnType<typeof useShellBridge.getState>['assemblyItems']; d: ShellDict }) {
  const list = items;
  const total = list.reduce((acc, i) => acc + ((i.massG ?? 0) * i.count), 0);
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
      <thead>
        <tr style={{ background: 'var(--nx-panel-2)' }}>
          <th style={th}>#</th>
          <th style={th}>{d.thPart}</th>
          <th style={{ ...th, textAlign: 'right' }}>{d.thQty}</th>
          <th style={{ ...th, textAlign: 'right' }}>{d.thMass}</th>
        </tr>
      </thead>
      <tbody>
        {list.map((row, i) => (
          <tr key={row.id} style={{ borderBottom: '1px solid var(--nx-border)' }}>
            <td style={td}>{i + 1}</td>
            <td style={td}>{row.label}</td>
            <td style={{ ...td, textAlign: 'right' }}>{row.count}</td>
            <td style={{ ...td, textAlign: 'right' }}>{row.massG ? `${row.massG.toFixed(1)} g` : '—'}</td>
          </tr>
        ))}
        <tr>
          <td style={{ ...td, fontWeight: 700 }} colSpan={2}>{d.totalRow}</td>
          <td style={{ ...td, textAlign: 'right' }}>{list.reduce((a, i) => a + i.count, 0)} parts</td>
          <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{total.toFixed(1)} g</td>
        </tr>
      </tbody>
    </table>
  );
}

const th: React.CSSProperties = { padding: '4px 6px', textAlign: 'left', fontSize: 9, fontWeight: 600, color: 'var(--nx-text-3)', textTransform: 'uppercase' };
const td: React.CSSProperties = { padding: '3px 6px', color: 'var(--nx-text)' };
