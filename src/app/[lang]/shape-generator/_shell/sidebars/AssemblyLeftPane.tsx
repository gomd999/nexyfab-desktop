'use client';

// Assembly mode left pane — Components / Mates / BOM 3-tab matching
// mockup #31. Reads the assembly snapshot from shellBridgeStore.

import { useState } from 'react';
import { SidePanel, Tree, type TreeNode } from './';

// Mate-type → bullet glyph. Shared with the right pane.
export const MATE_BULLET: Record<string, string> = {
  coincident: '≡', concentric: '◎', distance: '↔', angle: '∠',
  parallel: '∥', perpendicular: '⟂', tangent: '◠', hinge: '⤿', slider: '⇄', gear: '⚙',
};

export function mateMeta(type: string, value: number | undefined, isKo: boolean): string {
  const name = isKo ? (MATE_LABEL_KO[type] ?? type) : type.charAt(0).toUpperCase() + type.slice(1);
  if (value === undefined) return name;
  const unit = type === 'angle' ? '°' : ' mm';
  return `${name} · ${value}${unit}`;
}

const MATE_LABEL_KO: Record<string, string> = {
  coincident: '일치', concentric: '동심', distance: '거리', angle: '각도',
  parallel: '평행', perpendicular: '수직', tangent: '접함', hinge: '경첩', slider: '슬라이더', gear: '기어',
};
import { useShellBridge, type ShellMate } from '../shellBridgeStore';
import { useUIStore } from '../../store/uiStore';
import { I } from '../Icons';

// Mate list with inline add / delete / lock controls — shared by the left and
// right assembly panes. Opens the full editor via the uiStore; per-row actions
// dispatch events the Inner monolith listens for. (2026-06-09 P1)
export function MateList({ mates, isEmpty, isKo }: { mates: ShellMate[]; isEmpty: boolean; isKo: boolean }) {
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
        + {isKo ? '메이트 추가' : 'Add mate'}
      </button>
      {mates.length === 0 ? (
        <div style={{ padding: '12px 8px', textAlign: 'center', color: 'var(--nx-text-3)', lineHeight: 1.5 }}>
          {isEmpty
            ? (isKo ? '부품을 먼저 삽입하세요.' : 'Insert parts first.')
            : (isKo ? '메이트가 없습니다. 위 버튼이나 리본의 메이트 도구로 추가하세요.' : 'No mates yet. Use the button above or the ribbon mate tools.')}
        </div>
      ) : mates.map(m => (
        <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 4px' }}>
          <span style={{ width: 12, flexShrink: 0, textAlign: 'center', color: 'var(--nx-text-2)' }}>{MATE_BULLET[m.type] ?? '↗'}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.partA} ↔ {m.partB}</div>
            <div style={{ fontSize: 9, color: 'var(--nx-text-3)' }}>{mateMeta(m.type, m.value, isKo)}</div>
          </div>
          <button type="button" onClick={() => toggle(m.id)} title={m.locked ? 'Unlock' : 'Lock'} style={iconBtn}>{m.locked ? '🔒' : '🔓'}</button>
          <button type="button" onClick={() => remove(m.id)} title={isKo ? '삭제' : 'Delete'} style={iconBtn}>✕</button>
        </div>
      ))}
    </div>
  );
}

export interface AssemblyLeftPaneProps {
  isKo: boolean;
}

export function AssemblyLeftPane({ isKo }: AssemblyLeftPaneProps) {
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
      title={isKo ? '어셈블리' : 'ASSEMBLY'}
      titleIcon={<I.layers size={12} />}
      tabs={[
        { id: 'components', label: isKo ? '컴포넌트' : 'Components', icon: <I.cube size={12} /> },
        { id: 'mates', label: isKo ? '메이트' : 'Mates', icon: <I.link size={12} /> },
        { id: 'bom', label: isKo ? 'BOM' : 'BOM', icon: <I.doc size={12} /> },
      ]}
      activeTab={activeTab}
      onTabChange={(id) => setActiveTab(id as typeof activeTab)}
    >
      {activeTab === 'components' && (
        isEmpty ? (
          <EmptyHint text={isKo
            ? '아직 컴포넌트가 없습니다. 상단 Insert로 부품을 추가하세요.'
            : 'No components yet. Use Insert to add parts.'} />
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
        <MateList mates={mates} isEmpty={isEmpty} isKo={isKo} />
      )}
      {activeTab === 'bom' && (
        isEmpty
          ? <EmptyHint text={isKo ? '부품이 없어 BOM이 비어 있습니다.' : 'No parts — the BOM is empty.'} />
          : <BomList items={items} isKo={isKo} />
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

function BomList({ items, isKo }: { items: ReturnType<typeof useShellBridge.getState>['assemblyItems']; isKo: boolean }) {
  const list = items;
  const total = list.reduce((acc, i) => acc + ((i.massG ?? 0) * i.count), 0);
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
      <thead>
        <tr style={{ background: 'var(--nx-panel-2)' }}>
          <th style={th}>#</th>
          <th style={th}>{isKo ? '부품' : 'PART'}</th>
          <th style={{ ...th, textAlign: 'right' }}>{isKo ? '수량' : 'QTY'}</th>
          <th style={{ ...th, textAlign: 'right' }}>{isKo ? '중량' : 'MASS'}</th>
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
          <td style={{ ...td, fontWeight: 700 }} colSpan={2}>{isKo ? '합계' : 'TOTAL'}</td>
          <td style={{ ...td, textAlign: 'right' }}>{list.reduce((a, i) => a + i.count, 0)} parts</td>
          <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{total.toFixed(1)} g</td>
        </tr>
      </tbody>
    </table>
  );
}

const th: React.CSSProperties = { padding: '4px 6px', textAlign: 'left', fontSize: 9, fontWeight: 600, color: 'var(--nx-text-3)', textTransform: 'uppercase' };
const td: React.CSSProperties = { padding: '3px 6px', color: 'var(--nx-text)' };
