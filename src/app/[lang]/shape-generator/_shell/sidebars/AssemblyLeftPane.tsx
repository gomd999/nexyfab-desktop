'use client';

// Assembly mode left pane — Components / Mates / BOM 3-tab matching
// mockup #31. Reads the assembly snapshot from shellBridgeStore.

import { useState } from 'react';
import { SidePanel, Tree, type TreeNode, PropItemRow } from './';
import { useShellBridge } from '../shellBridgeStore';
import { I } from '../Icons';

export interface AssemblyLeftPaneProps {
  isKo: boolean;
}

export function AssemblyLeftPane({ isKo }: AssemblyLeftPaneProps) {
  const items = useShellBridge(s => s.assemblyItems);
  const selectedId = useShellBridge(s => s.selectedAssemblyId);
  const [activeTab, setActiveTab] = useState<'components' | 'mates' | 'bom'>('components');

  const treeNodes: TreeNode[] = items.length > 0
    ? items.map(item => ({
        id: item.id,
        label: item.label,
        icon: item.kind === 'subassembly'
          ? <I.layers size={12} />
          : <I.cube size={12} />,
        meta: item.count > 1 ? `${item.count}×` : undefined,
      }))
    : DEFAULT_TREE;

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
        <Tree
          nodes={treeNodes}
          selectedId={selectedId}
          onSelect={() => { /* TODO wire selection */ }}
        />
      )}
      {activeTab === 'mates' && (
        <div style={{ padding: '8px 0', fontSize: 11 }}>
          {(items.length > 0 ? items.slice(0, 6) : MATE_PLACEHOLDERS).map((m, i) => (
            <PropItemRow
              key={(m as { id?: string }).id ?? i}
              bullet="↗"
              label={typeof m === 'string' ? m : `Mate ${i + 1}`}
              meta={i % 2 === 0 ? 'Concentric' : 'Coincident'}
            />
          ))}
        </div>
      )}
      {activeTab === 'bom' && (
        <BomList items={items.length > 0 ? items : []} isKo={isKo} />
      )}
    </SidePanel>
  );
}

const DEFAULT_TREE: TreeNode[] = [
  {
    id: 'asm',
    label: 'GearboxAssy_v07.nxasm',
    icon: <I.layers size={12} />,
    defaultExpanded: true,
    children: [
      { id: 'refGeo', label: 'Reference Geometry', icon: <I.plane size={12} /> },
      { id: 'housingTop', label: 'Housing_Top', icon: <I.cube size={12} />, meta: '1' },
      { id: 'housingBot', label: 'Housing_Bottom', icon: <I.cube size={12} />, meta: '1' },
      { id: 'bearing', label: 'Bearing_6202-RS', icon: <I.cube size={12} />, meta: '4', children: [
        { id: 'bearingExt', label: 'External · McMaster #5972K12', icon: <I.link size={12} /> },
      ]},
      { id: 'inputShaft', label: 'InputShaft', icon: <I.cube size={12} />, meta: '1' },
      { id: 'gear24', label: 'Gear_24T_M1', icon: <I.cube size={12} />, meta: '1' },
      { id: 'gear48', label: 'Gear_48T_M1', icon: <I.cube size={12} />, meta: '1' },
      { id: 'outputShaft', label: 'OutputShaft', icon: <I.cube size={12} />, meta: '1' },
      { id: 'bolt', label: 'Bolt_M5×20', icon: <I.cube size={12} />, meta: '12' },
      { id: 'bracket', label: 'Bracket_v14', icon: <I.cube size={12} />, meta: '1' },
    ],
  },
];

const MATE_PLACEHOLDERS = ['Concentric · 1', 'Coincident · 2', 'Distance · 1', 'Parallel · 1', 'Angle · 1', 'Tangent · 1'];

function BomList({ items, isKo }: { items: ReturnType<typeof useShellBridge.getState>['assemblyItems']; isKo: boolean }) {
  const list = items.length > 0 ? items : DEFAULT_BOM;
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

const DEFAULT_BOM = [
  { id: 'p1', label: 'Housing_Top', count: 1, massG: 82.4 },
  { id: 'p2', label: 'Housing_Bot', count: 1, massG: 96.1 },
  { id: 'p3', label: 'Bearing 6202-RS', count: 4, massG: 12.0 },
  { id: 'p4', label: 'InputShaft', count: 1, massG: 24.2 },
  { id: 'p5', label: 'Gear_24T_M1', count: 1, massG: 12.8 },
  { id: 'p6', label: 'Gear_48T_M1', count: 1, massG: 38.4 },
  { id: 'p7', label: 'OutputShaft', count: 1, massG: 28.4 },
  { id: 'p8', label: 'Bolt M5×20', count: 12, massG: 0.55 },
  { id: 'p9', label: 'Bracket_v14', count: 1, massG: 184.3 },
];

const th: React.CSSProperties = { padding: '4px 6px', textAlign: 'left', fontSize: 9, fontWeight: 600, color: 'var(--nx-text-3)', textTransform: 'uppercase' };
const td: React.CSSProperties = { padding: '3px 6px', color: 'var(--nx-text)' };
