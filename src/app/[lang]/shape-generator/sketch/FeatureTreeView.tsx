'use client';

/**
 * FeatureTreeView — Phase 2.7 standalone tree view for the FeatureTree IR.
 *
 * Renders the ordered list of FeatureNodes from `featureTree.ts` as a flat
 * list (single-level for now — depth-1 grouping by dependencies comes
 * later) with per-row controls: select, suppress, delete, drag-reorder.
 *
 * Architecture:
 *   - Standalone (NOT a wrapper of SolverSketchEditor). Accepts the tree
 *     as a prop and reports user intent via callbacks. The parent owns
 *     mutation (applyEdit) and re-passes the new tree on each cycle.
 *   - Each callback (onToggleSuppress / onDelete / onReorder) is optional;
 *     omitting it hides the corresponding UI control. This lets read-only
 *     views (e.g., diff preview) drop in the same component.
 *   - Reorder UX (phase 1): HTML5 drag-and-drop. fromIdx → toIdx is
 *     reported to the parent which is responsible for calling validateTree
 *     (or applyMove) and rejecting topology-violating moves. The view does
 *     not re-render an optimistic preview; the parent's next tree prop is
 *     the source of truth.
 *
 * Test surface (data-testids):
 *   feature-tree-view
 *   feature-tree-empty
 *   feature-tree-row-{id}
 *   feature-tree-row-{id}-name
 *   feature-tree-row-{id}-icon
 *   feature-tree-row-{id}-suppress
 *   feature-tree-row-{id}-delete
 *   feature-tree-row-{id}-handle
 *   feature-tree-row-{id}-deps
 */

import React, { useCallback } from 'react';
import type { FeatureKind, FeatureNode, FeatureTree } from '@/lib/cad/featureTree';

export type FeatureTreeLang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

export interface FeatureTreeViewProps {
  lang: FeatureTreeLang;
  tree: FeatureTree;
  selectedId?: string;
  onSelect: (id: string) => void;
  /** When provided, a toggle button is rendered per row. */
  onToggleSuppress?: (id: string) => void;
  /** When provided, a delete (X) button is rendered per row. */
  onDelete?: (id: string) => void;
  /** When provided, a drag handle is rendered per row + drop targets fire. */
  onReorder?: (fromIdx: number, toIdx: number) => void;
}

// ─── i18n ─────────────────────────────────────────────────────────────────

interface Dict {
  title: string;
  suppress: string;
  unsuppress: string;
  delete: string;
  reorder: string;
  empty: string;
  depsPrefix: string;
}

const dict: Record<FeatureTreeLang, Dict> = {
  ko: {
    title: '피처 트리',
    suppress: '숨김',
    unsuppress: '표시',
    delete: '삭제',
    reorder: '순서 변경',
    empty: '피처를 추가하여 시작하세요',
    depsPrefix: '의존:',
  },
  en: {
    title: 'Feature tree',
    suppress: 'Suppress',
    unsuppress: 'Unsuppress',
    delete: 'Delete',
    reorder: 'Reorder',
    empty: 'Add feature to begin',
    depsPrefix: 'deps:',
  },
  ja: {
    title: 'フィーチャツリー',
    suppress: '抑制',
    unsuppress: '表示',
    delete: '削除',
    reorder: '並べ替え',
    empty: 'フィーチャを追加して開始',
    depsPrefix: '依存:',
  },
  zh: {
    title: '特征树',
    suppress: '抑制',
    unsuppress: '显示',
    delete: '删除',
    reorder: '重新排序',
    empty: '添加特征以开始',
    depsPrefix: '依赖:',
  },
  es: {
    title: 'Árbol de funciones',
    suppress: 'Suprimir',
    unsuppress: 'Mostrar',
    delete: 'Eliminar',
    reorder: 'Reordenar',
    empty: 'Añade una función para empezar',
    depsPrefix: 'deps:',
  },
  ar: {
    title: 'شجرة الميزات',
    suppress: 'إخفاء',
    unsuppress: 'إظهار',
    delete: 'حذف',
    reorder: 'إعادة ترتيب',
    empty: 'أضف ميزة للبدء',
    depsPrefix: 'يعتمد:',
  },
};

// ─── icon mapping ─────────────────────────────────────────────────────────

const KIND_ICON: Record<FeatureKind, string> = {
  extrude: '⬆',
  revolve: '↻',
  sweep: '✏',
  loft: '🥯',
  linear_pattern: '↔',
  circular_pattern: '↻',
  hole: '⊙',
  fillet: '◜',
  chamfer: '◢',
};

// ─── component ────────────────────────────────────────────────────────────

export default function FeatureTreeView(props: FeatureTreeViewProps): React.ReactElement {
  const { lang, tree, selectedId, onSelect, onToggleSuppress, onDelete, onReorder } = props;
  const t = dict[lang];

  // Drag state lives in a ref-like outer closure; parent owns the
  // post-drop tree. We only need the source index between dragstart and
  // drop to fire onReorder(from, to).
  const dragSrcRef = React.useRef<number | null>(null);

  const handleDragStart = useCallback((idx: number, e: React.DragEvent<HTMLDivElement>) => {
    dragSrcRef.current = idx;
    // Required for Firefox to actually start a drag.
    try { e.dataTransfer.setData('text/plain', String(idx)); } catch { /* jsdom */ }
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    // Must preventDefault to allow a drop event to fire.
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback((toIdx: number, e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const from = dragSrcRef.current;
    dragSrcRef.current = null;
    if (from === null || from === toIdx) return;
    onReorder?.(from, toIdx);
  }, [onReorder]);

  const handleDragEnd = useCallback(() => {
    dragSrcRef.current = null;
  }, []);

  if (tree.nodes.length === 0) {
    return (
      <div
        data-testid="feature-tree-view"
        style={{
          padding: 16,
          fontFamily: 'system-ui, sans-serif',
          color: 'var(--nx-text-2, #6b7280)',
          background: 'var(--nx-panel, #111827)',
          borderRadius: 6,
          minHeight: 80,
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>{t.title}</div>
        <div
          data-testid="feature-tree-empty"
          style={{ fontSize: 12, fontStyle: 'italic', textAlign: 'center', padding: '16px 0' }}
        >
          {t.empty}
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="feature-tree-view"
      style={{
        padding: 8,
        fontFamily: 'system-ui, sans-serif',
        background: 'var(--nx-panel, #111827)',
        borderRadius: 6,
        color: 'var(--nx-text, #e5e7eb)',
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, padding: '0 4px' }}>
        {t.title}
      </div>
      <div role="list">
        {tree.nodes.map((node, idx) => (
          <FeatureTreeRow
            key={node.id}
            node={node}
            idx={idx}
            selected={selectedId === node.id}
            t={t}
            onSelect={onSelect}
            onToggleSuppress={onToggleSuppress}
            onDelete={onDelete}
            onReorder={onReorder}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onDragEnd={handleDragEnd}
          />
        ))}
      </div>
    </div>
  );
}

// ─── row ──────────────────────────────────────────────────────────────────

interface RowProps {
  node: FeatureNode;
  idx: number;
  selected: boolean;
  t: Dict;
  onSelect: (id: string) => void;
  onToggleSuppress?: (id: string) => void;
  onDelete?: (id: string) => void;
  onReorder?: (fromIdx: number, toIdx: number) => void;
  onDragStart: (idx: number, e: React.DragEvent<HTMLDivElement>) => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (idx: number, e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
}

function FeatureTreeRow(props: RowProps): React.ReactElement {
  const {
    node, idx, selected, t,
    onSelect, onToggleSuppress, onDelete, onReorder,
    onDragStart, onDragOver, onDrop, onDragEnd,
  } = props;

  const kind: FeatureKind = node.payload.kind;
  const icon = KIND_ICON[kind] ?? '•';
  const suppressed = node.suppressed === true;
  const reorderable = onReorder !== undefined;

  const rowBg = selected
    ? 'var(--nx-row-selected, #1f2937)'
    : 'transparent';
  const nameStyle: React.CSSProperties = {
    fontSize: 12,
    fontWeight: selected ? 600 : 400,
    textDecoration: suppressed ? 'line-through' : 'none',
    opacity: suppressed ? 0.6 : 1,
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };

  return (
    <div
      role="listitem"
      data-testid={`feature-tree-row-${node.id}`}
      data-node-id={node.id}
      data-selected={selected ? 'true' : 'false'}
      data-suppressed={suppressed ? 'true' : 'false'}
      draggable={reorderable}
      onDragStart={reorderable ? (e) => onDragStart(idx, e) : undefined}
      onDragOver={reorderable ? onDragOver : undefined}
      onDrop={reorderable ? (e) => onDrop(idx, e) : undefined}
      onDragEnd={reorderable ? onDragEnd : undefined}
      onClick={() => onSelect(node.id)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 8px',
        background: rowBg,
        borderRadius: 4,
        cursor: 'pointer',
        userSelect: 'none',
      }}
    >
      {reorderable && (
        <span
          data-testid={`feature-tree-row-${node.id}-handle`}
          title={t.reorder}
          aria-label={t.reorder}
          style={{
            cursor: 'grab',
            fontSize: 14,
            color: 'var(--nx-text-3, #9ca3af)',
            padding: '0 2px',
            flex: '0 0 auto',
          }}
        >
          ≡
        </span>
      )}
      <span
        data-testid={`feature-tree-row-${node.id}-icon`}
        data-kind={kind}
        aria-label={kind}
        style={{ fontSize: 14, width: 18, textAlign: 'center', flex: '0 0 auto' }}
      >
        {icon}
      </span>
      <span data-testid={`feature-tree-row-${node.id}-name`} style={nameStyle}>
        {node.name}
      </span>
      {node.dependencies.length > 0 && (
        <span
          data-testid={`feature-tree-row-${node.id}-deps`}
          style={{
            fontSize: 10,
            color: 'var(--nx-text-3, #9ca3af)',
            fontFamily: 'monospace',
            flex: '0 0 auto',
            marginRight: 4,
          }}
        >
          {t.depsPrefix} {node.dependencies.join(', ')}
        </span>
      )}
      {onToggleSuppress && (
        <button
          data-testid={`feature-tree-row-${node.id}-suppress`}
          type="button"
          aria-label={suppressed ? t.unsuppress : t.suppress}
          title={suppressed ? t.unsuppress : t.suppress}
          onClick={(e) => {
            e.stopPropagation();
            onToggleSuppress(node.id);
          }}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--nx-text-2, #9ca3af)',
            cursor: 'pointer',
            fontSize: 13,
            padding: '2px 4px',
            flex: '0 0 auto',
          }}
        >
          {suppressed ? '🚫' : '👁'}
        </button>
      )}
      {onDelete && (
        <button
          data-testid={`feature-tree-row-${node.id}-delete`}
          type="button"
          aria-label={t.delete}
          title={t.delete}
          onClick={(e) => {
            e.stopPropagation();
            onDelete(node.id);
          }}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--nx-text-2, #9ca3af)',
            cursor: 'pointer',
            fontSize: 13,
            padding: '2px 4px',
            flex: '0 0 auto',
          }}
        >
          ✕
        </button>
      )}
    </div>
  );
}
