'use client';

import React, { useMemo, useState, useRef, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { isKorean } from '@/lib/i18n/normalize';
import type { HistoryNode } from '../useFeatureStack';

// ─── i18n dict ────────────────────────────────────────────────────────────────

const dict = {
  ko: {
    title: 'Feature 의존성 그래프',
    nodes: '노드',
    active: '활성',
    error: '오류',
    disabled: '비활성',
    dragHint: '드래그로 이동',
  },
  en: {
    title: 'Feature Dependency Graph',
    nodes: 'nodes',
    active: 'Active',
    error: 'Error',
    disabled: 'Disabled',
    dragHint: 'Drag to pan',
  },
  ja: {
    title: 'Feature 依存関係グラフ',
    nodes: 'ノード',
    active: 'アクティブ',
    error: 'エラー',
    disabled: '無効',
    dragHint: 'ドラッグで移動',
  },
  zh: {
    title: 'Feature 依赖关系图',
    nodes: '节点',
    active: '活动',
    error: '错误',
    disabled: '禁用',
    dragHint: '拖动平移',
  },
  es: {
    title: 'Grafo de Dependencias de Feature',
    nodes: 'nodos',
    active: 'Activo',
    error: 'Error',
    disabled: 'Desactivado',
    dragHint: 'Arrastra para mover',
  },
  ar: {
    title: 'رسم بياني لتبعيات الميزات',
    nodes: 'عقد',
    active: 'نشط',
    error: 'خطأ',
    disabled: 'معطل',
    dragHint: 'اسحب للتحريك',
  },
} as const;

interface FeatureDependencyGraphProps {
  nodes: HistoryNode[];
  activeNodeId: string;
  onSelectNode?: (id: string) => void;
  lang?: string;
}

// ─── Layout algorithm (simple tree layout) ───────────────────────────────────

interface GraphNode {
  id: string;
  label: string;
  icon: string;
  enabled: boolean;
  error?: string;
  featureType?: string;
  x: number;
  y: number;
  depth: number;
  children: string[];
  parentId: string | null;
}

const NODE_W = 120;
const NODE_H = 36;
const H_GAP = 20;
const V_GAP = 56;

function layoutTree(nodes: HistoryNode[]): GraphNode[] {
  if (!nodes.length) return [];

  // Build lookup
  const lookup = new Map(nodes.map(n => [n.id, n]));

  // DFS layout
  const result: GraphNode[] = [];
  const colCounters: Map<number, number> = new Map();

  function dfs(id: string, depth: number): number {
    const node = lookup.get(id);
    if (!node) return 0;

    const col = colCounters.get(depth) ?? 0;
    colCounters.set(depth, col + 1);

    const gn: GraphNode = {
      id: node.id,
      label: node.label,
      icon: node.icon,
      enabled: node.enabled,
      error: node.error,
      featureType: node.featureType,
      x: col * (NODE_W + H_GAP),
      y: depth * V_GAP,
      depth,
      children: node.children,
      parentId: node.parentId,
    };
    result.push(gn);

    node.children.forEach(childId => dfs(childId, depth + 1));
    return col;
  }

  const root = nodes.find(n => !n.parentId);
  if (root) dfs(root.id, 0);
  return result;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function FeatureDependencyGraph({
  nodes,
  activeNodeId,
  onSelectNode,
  lang,
}: FeatureDependencyGraphProps) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? 'en';
  const langMap: Record<string, keyof typeof dict> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  const t = dict[langMap[seg] ?? (isKorean(lang ?? 'en') ? 'ko' : 'en')];
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [pan, setPan] = useState({ x: 16, y: 16 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, px: 0, py: 0 });

  const graphNodes = useMemo(() => layoutTree(nodes), [nodes]);
  const graphMap = useMemo(() => new Map(graphNodes.map(n => [n.id, n])), [graphNodes]);

  const svgW = useMemo(() => {
    const maxX = Math.max(...graphNodes.map(n => n.x + NODE_W), 300);
    return maxX + 32;
  }, [graphNodes]);
  const svgH = useMemo(() => {
    const maxY = Math.max(...graphNodes.map(n => n.y + NODE_H), 200);
    return maxY + 32;
  }, [graphNodes]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsPanning(true);
    panStart.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
  }, [pan]);
  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning) return;
    setPan({
      x: panStart.current.px + e.clientX - panStart.current.x,
      y: panStart.current.py + e.clientY - panStart.current.y,
    });
  }, [isPanning]);
  const onMouseUp = useCallback(() => setIsPanning(false), []);

  return (
    <div style={{ width: '100%', height: '100%', background: '#0d1117', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '10px 14px', borderBottom: '1px solid #21262d', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <span style={{ fontSize: 13 }}>🕸</span>
        <span style={{ fontWeight: 700, fontSize: 12, color: '#c9d1d9', flex: 1 }}>
          {t.title}
        </span>
        <span style={{ fontSize: 10, color: '#6e7681' }}>
          {nodes.length} {t.nodes}
        </span>
      </div>

      {/* Graph canvas */}
      <div
        style={{ flex: 1, overflow: 'hidden', cursor: isPanning ? 'grabbing' : 'grab', position: 'relative' }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      >
        <svg
          ref={svgRef}
          width={svgW}
          height={svgH}
          style={{ transform: `translate(${pan.x}px, ${pan.y}px)`, overflow: 'visible', display: 'block' }}
        >
          <defs>
            <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L0,6 L8,3 z" fill="#388bfd88" />
            </marker>
          </defs>

          {/* Edges */}
          {graphNodes.map(gn => {
            const parent = gn.parentId ? graphMap.get(gn.parentId) : null;
            if (!parent) return null;
            const x1 = parent.x + NODE_W / 2;
            const y1 = parent.y + NODE_H;
            const x2 = gn.x + NODE_W / 2;
            const y2 = gn.y;
            const mx = (x1 + x2) / 2;
            const my = (y1 + y2) / 2;
            return (
              <g key={`edge-${gn.id}`}>
                <path
                  d={`M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`}
                  fill="none"
                  stroke={gn.enabled ? '#388bfd55' : '#30363d'}
                  strokeWidth={1.5}
                  markerEnd="url(#arrow)"
                  strokeDasharray={gn.enabled ? undefined : '4 3'}
                />
              </g>
            );
          })}

          {/* Nodes */}
          {graphNodes.map(gn => {
            const isActive = gn.id === activeNodeId;
            const isHovered = gn.id === hoveredId;
            const hasError = !!gn.error;
            const borderColor = hasError ? '#f85149' : isActive ? '#388bfd' : isHovered ? '#8b9cf4' : '#30363d';
            const bg = isActive ? '#388bfd18' : hasError ? '#f8514918' : '#161b22';

            return (
              <g
                key={gn.id}
                transform={`translate(${gn.x}, ${gn.y})`}
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHoveredId(gn.id)}
                onMouseLeave={() => setHoveredId(null)}
                onClick={() => onSelectNode?.(gn.id)}
              >
                {/* Node box */}
                <rect
                  width={NODE_W}
                  height={NODE_H}
                  rx={6}
                  fill={bg}
                  stroke={borderColor}
                  strokeWidth={isActive ? 1.5 : 1}
                />

                {/* Disabled overlay */}
                {!gn.enabled && (
                  <rect width={NODE_W} height={NODE_H} rx={6} fill="#0d111788" />
                )}

                {/* Icon */}
                <text x={8} y={NODE_H / 2 + 1} dominantBaseline="middle" fontSize={12}>
                  {gn.icon}
                </text>

                {/* Label */}
                <text
                  x={26}
                  y={NODE_H / 2}
                  dominantBaseline="middle"
                  fontSize={10}
                  fontWeight={isActive ? 700 : 400}
                  fill={gn.enabled ? (hasError ? '#f85149' : '#c9d1d9') : '#6e7681'}
                  fontFamily="system-ui, sans-serif"
                >
                  {gn.label.length > 12 ? gn.label.slice(0, 11) + '…' : gn.label}
                </text>

                {/* Error indicator */}
                {hasError && (
                  <circle cx={NODE_W - 7} cy={7} r={5} fill="#f85149" />
                )}

                {/* Active dot */}
                {isActive && !hasError && (
                  <circle cx={NODE_W - 7} cy={7} r={5} fill="#388bfd" />
                )}

                {/* Tooltip on hover */}
                {isHovered && gn.error && (
                  <foreignObject x={NODE_W + 4} y={0} width={160} height={60}>
                    <div style={{
                      background: '#1c2128', border: '1px solid #f8514944', borderRadius: 6,
                      padding: '5px 8px', fontSize: 10, color: '#f85149', lineHeight: 1.4,
                      fontFamily: 'system-ui, sans-serif',
                    }}>
                      {gn.error}
                    </div>
                  </foreignObject>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Legend */}
      <div style={{ padding: '6px 14px', borderTop: '1px solid #21262d', display: 'flex', gap: 12, flexShrink: 0 }}>
        {[
          { color: '#388bfd', label: t.active },
          { color: '#f85149', label: t.error },
          { color: '#30363d', label: t.disabled },
        ].map(({ color, label }) => (
          <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: '#6e7681' }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
            {label}
          </span>
        ))}
        <span style={{ fontSize: 9, color: '#6e7681', marginLeft: 'auto' }}>
          {t.dragHint}
        </span>
      </div>
    </div>
  );
}
