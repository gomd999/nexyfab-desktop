'use client';

// Modeling mode left pane — Features / Bodies / Components 3-tab structure
// matching mockup #29. Reads feature snapshot from shellBridgeStore so the
// underlying useFeatureStack stays Inner's responsibility.

import { useMemo, useState } from 'react';
import { SidePanel, Tree, type TreeNode } from './';
import { useShellBridge, type ShellFeatureItem } from '../shellBridgeStore';
import { I } from '../Icons';
import { StandardPartsGrid } from './StandardPartsGrid';
import { pickShellDict } from '../shellDict';

export interface ModelerLeftPaneProps {
  lang: string;
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

export function ModelerLeftPane({ lang, onSelectFeature }: ModelerLeftPaneProps) {
  const d = pickShellDict(lang);
  const baseShape = useShellBridge(s => s.baseShapeItem);
  const features = useShellBridge(s => s.featureItems);
  const selectedFeatureId = useShellBridge(s => s.selectedFeatureId);
  const setHoveredFeatureId = useShellBridge(s => s.setHoveredFeatureId);
  const [activeTab, setActiveTab] = useState<'features' | 'bodies' | 'components'>('features');
  const [filter, setFilter] = useState('');

  const filtered = useMemo<ShellFeatureItem[]>(() => {
    const items = baseShape ? [baseShape, ...features] : features;
    if (!filter.trim()) return items;
    const q = filter.toLowerCase();
    return items.filter(f => f.label.toLowerCase().includes(q));
  }, [baseShape, features, filter]);

  const treeNodes = useMemo(() => filtered.map(featureToTreeNode), [filtered]);

  return (
    <SidePanel
      side="left"
      tabs={[
        { id: 'features', label: d.tabFeatures, icon: <I.tree size={12} /> },
        { id: 'bodies', label: d.tabBodies, icon: <I.layers size={12} /> },
        { id: 'components', label: d.tabComponents, icon: <I.cube size={12} /> },
      ]}
      activeTab={activeTab}
      onTabChange={(id) => setActiveTab(id as typeof activeTab)}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div className="nx-filter">
            <I.search size={11} />
            <input
              id="shell-feature-filter"
              name="featureFilter"
              aria-label={d.filterFeatures}
              type="text"
              placeholder={d.filterFeatures}
              value={filter}
              onChange={e => setFilter(e.target.value)}
              style={{
                flex: 1, minWidth: 0, height: 18, border: 0, background: 'transparent',
                color: 'var(--nx-text)', fontSize: 11, outline: 'none',
              }}
            />
          </div>
          <button
            type="button"
            className="nx-icon-btn"
            aria-label={d.add}
            onClick={() => window.dispatchEvent(new CustomEvent('nexyfab:open-command-palette'))}
          >
            <I.plus size={11} />
          </button>
        </div>
      }
    >
      {activeTab === 'features' && (
        treeNodes.length === 0 ? (
          <EmptyHint message={d.noFeatures} />
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
        // Honest state instead of a static "Bodies view — solids/surfaces"
        // description that masqueraded as content. The shell bridge tracks
        // features, not a separate multi-body list. (2026-06-09 C3)
        <EmptyHint message={features.length === 0 ? d.noBodies : d.singleBody} />
      )}
      {activeTab === 'components' && <StandardPartsGrid lang={lang} />}
    </SidePanel>
  );
}

function EmptyHint({ message }: { message: string }) {
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
