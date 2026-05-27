'use client';

// PDM version tree panel — visualises a project's commit graph. Lives in
// the BottomDrawer; future revision swaps the in-memory VersionRepo for
// the production nf_projects table via parent_id column.

import { useMemo, useState } from 'react';
import { VersionRepo, type VersionNode } from '@/lib/nexyfab/versionTree';

export interface VersionTreePanelProps {
  isKo: boolean;
}

// Demo seed — replaced by real repo state when the production backend
// adds the parent_id column. In the meantime the panel showcases the
// branching/merging UX with a realistic-looking history.
const DEMO_SEED: VersionNode[] = (() => {
  const now = Date.now();
  return [
    { id: 'c1', parentId: null,  branch: 'main', createdAt: now - 7 * 86400_000, author: 'gomd9', message: 'Initial bracket', payload: null, tags: ['v0.1'] },
    { id: 'c2', parentId: 'c1',  branch: 'main', createdAt: now - 6 * 86400_000, author: 'gomd9', message: 'Add mounting holes', payload: null },
    { id: 'c3', parentId: 'c2',  branch: 'main', createdAt: now - 5 * 86400_000, author: 'gomd9', message: 'Fillet R 2.0', payload: null, tags: ['v0.2'] },
    { id: 'c4', parentId: 'c3',  branch: 'experiment/lighter', createdAt: now - 4 * 86400_000, author: 'kim', message: 'Pocket array test', payload: null },
    { id: 'c5', parentId: 'c4',  branch: 'experiment/lighter', createdAt: now - 3 * 86400_000, author: 'kim', message: 'Shell 1.5mm', payload: null },
    { id: 'c6', parentId: 'c3',  branch: 'main', createdAt: now - 2 * 86400_000, author: 'gomd9', message: 'Counterbore holes', payload: null, tags: ['v0.3'] },
    { id: 'c7', parentId: 'c6',  branch: 'main', createdAt: now - 86400_000,    author: 'moon',  message: 'Spec review fixes', payload: null },
  ];
})();

export function VersionTreePanel({ isKo }: VersionTreePanelProps) {
  // Production hookup: replace with useProjectsStore version state.
  const [repo] = useState(() => new VersionRepo(DEMO_SEED));
  const [selectedId, setSelectedId] = useState<string | null>(DEMO_SEED[DEMO_SEED.length - 1].id);

  const layout = useMemo(() => layoutGraph(repo.list()), [repo]);

  const selected = selectedId ? repo.ancestors(selectedId)[0] : null;

  return (
    <div style={{ display: 'flex', gap: 12, height: '100%', fontSize: 12 }}>
      {/* Graph */}
      <div style={{ flex: 1, overflow: 'auto', minWidth: 0 }}>
        <svg width={layout.width} height={layout.height} style={{ display: 'block' }}>
          {/* Edges */}
          {layout.nodes.map(n => {
            if (!n.parent) return null;
            const p = layout.byId.get(n.parent);
            if (!p) return null;
            return (
              <path
                key={`e-${n.node.id}`}
                d={`M${p.x},${p.y} C${p.x},${(p.y + n.y) / 2} ${n.x},${(p.y + n.y) / 2} ${n.x},${n.y}`}
                fill="none"
                stroke={n.branchColor}
                strokeWidth="1.5"
                opacity={0.8}
              />
            );
          })}
          {/* Nodes */}
          {layout.nodes.map(n => (
            <g
              key={n.node.id}
              onClick={() => setSelectedId(n.node.id)}
              style={{ cursor: 'pointer' }}
            >
              <circle
                cx={n.x} cy={n.y} r={n.node.id === selectedId ? 7 : 5}
                fill={n.branchColor}
                stroke={n.node.id === selectedId ? 'var(--nx-text)' : 'transparent'}
                strokeWidth="2"
              />
              <text
                x={n.x + 12} y={n.y + 3}
                fontSize="10"
                fill="var(--nx-text)"
                style={{ pointerEvents: 'none' }}
              >
                {n.node.message}
                {n.node.tags && n.node.tags.length > 0 && (
                  <tspan fill="var(--nx-accent-2)" dx="6">[{n.node.tags.join(', ')}]</tspan>
                )}
              </text>
            </g>
          ))}
        </svg>
      </div>

      {/* Detail */}
      <div style={{ width: 220, borderLeft: '1px solid var(--nx-border)', paddingLeft: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {selected ? (
          <>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--nx-text)' }}>{selected.message}</div>
            <div style={{ fontSize: 10, color: 'var(--nx-text-3)' }}>
              <div>{selected.author}</div>
              <div>{new Date(selected.createdAt).toLocaleString()}</div>
              <div>branch: <span style={{ color: 'var(--nx-accent-2)' }}>{selected.branch}</span></div>
              {selected.tags && <div>tags: {selected.tags.join(', ')}</div>}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <button onClick={() => alert(isKo ? '체크아웃 — 백엔드 연동 필요' : 'Checkout — backend wiring pending')} style={primaryBtn}>
                {isKo ? '이 버전으로 체크아웃' : 'Checkout this version'}
              </button>
              <button onClick={() => alert(isKo ? '분기 — 백엔드 연동 필요' : 'Branch — backend wiring pending')} style={ghostBtn}>
                {isKo ? '여기서 분기' : 'Branch from here'}
              </button>
              <button onClick={() => alert(isKo ? '머지 — 백엔드 연동 필요' : 'Merge — backend wiring pending')} style={ghostBtn}>
                {isKo ? 'main 으로 머지' : 'Merge into main'}
              </button>
            </div>
          </>
        ) : (
          <div style={{ fontSize: 11, color: 'var(--nx-text-3)' }}>
            {isKo ? '커밋을 선택하세요' : 'Select a commit'}
          </div>
        )}
      </div>
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  padding: '6px 10px', height: 26, border: 0, borderRadius: 4,
  background: 'var(--nx-accent)', color: '#fff', fontSize: 11,
  fontWeight: 600, cursor: 'pointer',
};
const ghostBtn: React.CSSProperties = {
  padding: '6px 10px', height: 26,
  border: '1px solid var(--nx-border)', borderRadius: 4,
  background: 'transparent', color: 'var(--nx-text)',
  fontSize: 11, cursor: 'pointer',
};

// ─── Layout ──────────────────────────────────────────────────────────────

const BRANCH_COLORS = ['#4f8bff', '#a855f7', '#10b981', '#f59e0b', '#ef4444', '#06b6d4'];

interface LaidOutNode {
  node: VersionNode;
  x: number;
  y: number;
  branchColor: string;
  parent: string | null;
}

interface Layout {
  nodes: LaidOutNode[];
  byId: Map<string, LaidOutNode>;
  width: number;
  height: number;
}

function layoutGraph(nodes: VersionNode[]): Layout {
  const sorted = [...nodes].sort((a, b) => a.createdAt - b.createdAt);
  const branchX = new Map<string, number>();
  const branchColor = new Map<string, string>();
  let nextX = 30;
  for (const n of sorted) {
    if (!branchX.has(n.branch)) {
      branchX.set(n.branch, nextX);
      branchColor.set(n.branch, BRANCH_COLORS[branchX.size - 1 % BRANCH_COLORS.length]);
      nextX += 30;
    }
  }
  const ROW = 28;
  const laidOut: LaidOutNode[] = sorted.map((n, i) => ({
    node: n,
    x: branchX.get(n.branch) ?? 30,
    y: 20 + i * ROW,
    branchColor: branchColor.get(n.branch) ?? '#888',
    parent: n.parentId,
  }));
  const byId = new Map(laidOut.map(n => [n.node.id, n]));
  return {
    nodes: laidOut,
    byId,
    width: Math.max(280, nextX + 240),
    height: 20 + laidOut.length * ROW + 10,
  };
}
