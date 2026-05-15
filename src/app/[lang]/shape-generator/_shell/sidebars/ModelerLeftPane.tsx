'use client';

// Modeling mode left pane — Features / Bodies / Components 3-tab structure
// matching mockup #29. Reads feature snapshot from shellBridgeStore so the
// underlying useFeatureStack stays Inner's responsibility.

import { useMemo, useState } from 'react';
import { SidePanel, Tree, type TreeNode } from './';
import { useShellBridge, type ShellFeatureItem } from '../shellBridgeStore';
import { I } from '../Icons';

export interface ModelerLeftPaneProps {
  isKo: boolean;
  onSelectFeature?: (id: string) => void;
}

const FEATURE_ICON: Record<string, React.ReactNode> = {
  origin: <I.plane size={12} />,
  material: <I.cube size={12} />,
  sketch: <I.sketch size={12} />,
  sketchExtrude: <I.extrude size={12} />,
  extrude: <I.extrude size={12} />,
  revolve: <I.revolve size={12} />,
  sweep: <I.sweep size={12} />,
  loft: <I.loft size={12} />,
  fillet: <I.fillet size={12} />,
  chamfer: <I.chamfer size={12} />,
  shell: <I.shell size={12} />,
  hole: <I.hole size={12} />,
  linearPattern: <I.pattern size={12} />,
  circularPattern: <I.pattern size={12} />,
  mirror: <I.mirror size={12} />,
  draft: <I.draft size={12} />,
  boolean: <I.combine size={12} />,
  rib: <I.rect size={12} />,
};

function featureToTreeNode(item: ShellFeatureItem): TreeNode {
  return {
    id: item.id,
    label: item.label,
    icon: FEATURE_ICON[item.type] ?? <I.cube size={12} />,
    meta: item.meta,
    muted: item.muted,
    children: item.children?.map(featureToTreeNode),
  };
}

export function ModelerLeftPane({ isKo, onSelectFeature }: ModelerLeftPaneProps) {
  const features = useShellBridge(s => s.featureItems);
  const selectedFeatureId = useShellBridge(s => s.selectedFeatureId);
  const [activeTab, setActiveTab] = useState<'features' | 'bodies' | 'components'>('features');
  const [filter, setFilter] = useState('');

  const filtered = useMemo<ShellFeatureItem[]>(() => {
    if (!filter.trim()) return features;
    const q = filter.toLowerCase();
    return features.filter(f => f.label.toLowerCase().includes(q));
  }, [features, filter]);

  const treeNodes = useMemo(() => filtered.map(featureToTreeNode), [filtered]);

  return (
    <SidePanel
      side="left"
      tabs={[
        { id: 'features', label: isKo ? '피처' : 'Features', icon: <I.tree size={12} /> },
        { id: 'bodies', label: isKo ? '바디' : 'Bodies', icon: <I.layers size={12} /> },
        { id: 'components', label: isKo ? '컴포넌트' : 'Components', icon: <I.cube size={12} /> },
      ]}
      activeTab={activeTab}
      onTabChange={(id) => setActiveTab(id as typeof activeTab)}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div className="nx-filter">
            <I.search size={11} />
            <input
              type="text"
              placeholder={isKo ? '피처 필터…' : 'Filter features…'}
              value={filter}
              onChange={e => setFilter(e.target.value)}
              style={{
                flex: 1, minWidth: 0, height: 18, border: 0, background: 'transparent',
                color: 'var(--nx-text)', fontSize: 11, outline: 'none',
              }}
            />
          </div>
          <button className="nx-icon-btn" aria-label={isKo ? '추가' : 'Add'}>
            <I.plus size={11} />
          </button>
        </div>
      }
    >
      {activeTab === 'features' && (
        treeNodes.length === 0 ? (
          <EmptyHint isKo={isKo} message={isKo ? '피처 없음 — 스케치를 만들어 시작' : 'No features — create a sketch to start'} />
        ) : (
          <Tree
            nodes={treeNodes}
            selectedId={selectedFeatureId}
            onSelect={id => onSelectFeature?.(id)}
          />
        )
      )}
      {activeTab === 'bodies' && (
        <EmptyHint isKo={isKo} message={isKo ? '바디 보기 — 모든 솔리드 / 서피스 / 메시 보디' : 'Bodies view — solids, surfaces, meshes'} />
      )}
      {activeTab === 'components' && (
        <EmptyHint isKo={isKo} message={isKo ? '컴포넌트 보기 — 어셈블리 모드로 전환' : 'Components view — switch to assembly mode'} />
      )}
    </SidePanel>
  );
}

function EmptyHint({ message }: { isKo: boolean; message: string }) {
  return (
    <div style={{
      padding: '20px 16px',
      fontSize: 11,
      color: 'var(--nx-text-3)',
      textAlign: 'center',
      lineHeight: 1.5,
    }}>
      {message}
    </div>
  );
}
