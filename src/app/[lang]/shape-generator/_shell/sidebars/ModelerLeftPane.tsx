'use client';

// Modeling mode left pane — Features / Bodies / Components 3-tab structure
// matching mockup #29. Reads feature snapshot from shellBridgeStore so the
// underlying useFeatureStack stays Inner's responsibility.

import { useMemo, useState } from 'react';
import { SidePanel, Tree, type TreeNode } from './';
import { useShellBridge, type ShellFeatureItem, type ShellBodyItem } from '../shellBridgeStore';
import { I } from '../Icons';
import { StandardPartsGrid } from './StandardPartsGrid';
import { UserPartsSection } from './UserPartsSection';

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
  const setHoveredFeatureId = useShellBridge(s => s.setHoveredFeatureId);
  const bodies = useShellBridge(s => s.bodyItems);
  const activeBodyId = useShellBridge(s => s.activeBodyId);
  const selectedBodyIds = useShellBridge(s => s.selectedBodyIds);
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
            onSelect={id => {
              onSelectFeature?.(id);
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('nexyfab:select-feature', { detail: { id } }));
              }
            }}
            onHover={setHoveredFeatureId}
          />
        )
      )}
      {activeTab === 'bodies' && (
        bodies.length === 0 ? (
          <EmptyHint isKo={isKo} message={isKo ? '바디 없음 — 형상을 추가하면 표시' : 'No bodies — add geometry to start'} />
        ) : (
          <BodyList
            bodies={bodies}
            activeId={activeBodyId}
            selectedIds={selectedBodyIds}
            isKo={isKo}
          />
        )
      )}
      {activeTab === 'components' && (
        <>
          <UserPartsSection isKo={isKo} />
          <StandardPartsGrid isKo={isKo} />
        </>
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

interface BodyListProps {
  bodies: ShellBodyItem[];
  activeId: string | null;
  selectedIds: string[];
  isKo: boolean;
}

function BodyList({ bodies, activeId, selectedIds, isKo }: BodyListProps) {
  // Click → publish select event so Inner can update its selection state
  // without ModelerLeftPane needing direct hooks into Inner's setBodies.
  const onSelect = (id: string) => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('nexyfab:select-body', { detail: { id } }));
  };
  const onToggleVisible = (id: string) => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('nexyfab:toggle-body-visible', { detail: { id } }));
  };

  return (
    <div style={{ padding: '4px 0' }}>
      {bodies.map(b => {
        const isActive = activeId === b.id;
        const isSelected = selectedIds.includes(b.id);
        const muted = !b.visible;
        return (
          <div
            key={b.id}
            onClick={() => onSelect(b.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '4px 12px',
              fontSize: 11,
              cursor: 'pointer',
              background: isActive ? 'var(--nx-accent-soft)' : isSelected ? 'var(--nx-row-selected)' : 'transparent',
              color: muted ? 'var(--nx-text-3)' : 'var(--nx-text)',
              borderLeft: isActive ? '2px solid var(--nx-accent)' : '2px solid transparent',
              opacity: b.locked ? 0.7 : 1,
            }}
          >
            <div
              aria-label={isKo ? '색상' : 'colour'}
              style={{
                width: 10, height: 10, borderRadius: 2,
                background: b.color,
                opacity: muted ? 0.4 : 1,
                flex: '0 0 auto',
              }}
            />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {b.name}
            </span>
            {b.mergedFrom && b.mergedFrom.length > 0 && (
              <span style={{ fontSize: 9, color: 'var(--nx-text-3)' }}>{isKo ? '병합' : 'merged'}</span>
            )}
            {b.splitFromId && (
              <span style={{ fontSize: 9, color: 'var(--nx-text-3)' }}>{isKo ? '분할' : 'split'}</span>
            )}
            {b.locked && <I.lock size={10} />}
            <button
              type="button"
              className="nx-icon-btn"
              aria-label={b.visible ? (isKo ? '숨김' : 'Hide') : (isKo ? '표시' : 'Show')}
              onClick={(e) => { e.stopPropagation(); onToggleVisible(b.id); }}
              style={{ opacity: muted ? 0.5 : 0.8 }}
            >
              {b.visible ? <I.eye size={11} /> : <I.eye_off size={11} />}
            </button>
          </div>
        );
      })}
    </div>
  );
}
