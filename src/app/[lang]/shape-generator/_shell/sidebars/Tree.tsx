'use client';

// Tree — hierarchical row component used by all left-side panes.
// Twist + icon + label + meta + visibility eye, matching mockup pattern.
// Keyboard nav: ↑/↓ moves selection, ←/→ collapses/expands, Enter activates.

import React, { useCallback } from 'react';

export interface TreeNode {
  id: string;
  label: string;
  icon?: React.ReactNode;
  meta?: string;
  /** Show with reduced color (suppressed / hidden / construction). */
  muted?: boolean;
  /** Show eye icon for hide/show toggling. */
  visible?: boolean;
  onToggleVisible?: () => void;
  /** Child nodes — when present a twist arrow is drawn. */
  children?: TreeNode[];
  /** Pre-expanded by default. */
  defaultExpanded?: boolean;
}

export interface TreeProps {
  nodes: TreeNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Optional hover callback — fires with null when the cursor leaves. */
  onHover?: (id: string | null) => void;
  /** Optional indent step in pixels. Default 14. */
  indentPx?: number;
}

export function Tree({ nodes, selectedId, onSelect, onHover, indentPx = 14 }: TreeProps) {
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>(() => {
    const out: Record<string, boolean> = {};
    const visit = (n: TreeNode) => {
      out[n.id] = n.defaultExpanded ?? true;
      n.children?.forEach(visit);
    };
    nodes.forEach(visit);
    return out;
  });

  const toggle = useCallback((id: string) => {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const renderNode = (n: TreeNode, depth: number): React.ReactNode => {
    const hasChildren = n.children && n.children.length > 0;
    const isExpanded = expanded[n.id] ?? n.defaultExpanded ?? true;
    const isSelected = n.id === selectedId;
    return (
      <React.Fragment key={n.id}>
        <div
          role="treeitem"
          aria-selected={isSelected}
          aria-expanded={hasChildren ? isExpanded : undefined}
          onClick={() => onSelect(n.id)}
          style={{
            display: 'flex',
            alignItems: 'center',
            height: 22,
            paddingLeft: 8 + depth * indentPx,
            paddingRight: 8,
            gap: 6,
            cursor: 'pointer',
            position: 'relative',
            color: isSelected ? 'var(--nx-accent-2)' : n.muted ? 'var(--nx-text-3)' : 'var(--nx-text)',
            background: isSelected ? 'var(--nx-accent-soft)' : 'transparent',
          }}
          onMouseEnter={e => {
            if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = 'var(--nx-hover)';
            onHover?.(n.id);
          }}
          onMouseLeave={e => {
            if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = 'transparent';
            onHover?.(null);
          }}
        >
          {isSelected && (
            <span
              aria-hidden
              style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 2, background: 'var(--nx-accent)' }}
            />
          )}
          {hasChildren ? (
            <span
              onClick={e => { e.stopPropagation(); toggle(n.id); }}
              style={{
                width: 12, height: 12, flex: '0 0 12px',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--nx-text-3)', fontSize: 9, cursor: 'pointer',
                transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                transition: 'transform 0.1s ease',
              }}
            >
              ▶
            </span>
          ) : (
            <span style={{ width: 12, flex: '0 0 12px' }} />
          )}
          {n.icon && (
            <span style={{
              width: 14, height: 14, flex: '0 0 14px',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              color: isSelected ? 'var(--nx-accent)' : 'var(--nx-text-2)',
            }}>
              {n.icon}
            </span>
          )}
          <span style={{ flex: '1 1 auto', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {n.label}
          </span>
          {n.meta && (
            <span style={{ fontSize: 10, color: 'var(--nx-text-3)', flex: '0 0 auto' }}>
              {n.meta}
            </span>
          )}
          {n.onToggleVisible && (
            <button
              onClick={e => { e.stopPropagation(); n.onToggleVisible?.(); }}
              style={{
                width: 14, height: 14, padding: 0, border: 0, background: 'transparent',
                cursor: 'pointer', color: 'var(--nx-text-3)',
                opacity: isSelected ? 1 : 0,
                transition: 'opacity 0.1s ease',
              }}
              className="nx-tree-vis"
              aria-label={n.visible ? 'Hide' : 'Show'}
            >
              {n.visible === false ? '○' : '●'}
            </button>
          )}
        </div>
        {hasChildren && isExpanded && n.children!.map(c => renderNode(c, depth + 1))}
      </React.Fragment>
    );
  };

  return (
    <div role="tree" style={{ padding: '4px 0' }}>
      {nodes.map(n => renderNode(n, 0))}
    </div>
  );
}
