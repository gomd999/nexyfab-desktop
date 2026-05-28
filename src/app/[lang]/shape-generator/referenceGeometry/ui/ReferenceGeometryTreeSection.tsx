'use client';

/**
 * ReferenceGeometryTreeSection.tsx — feature-tree side panel section.
 *
 * Wave 2 Phase 2 Track D Week 2. Spec §13.3.
 *
 * Renders the live list of `ReferenceNode`s as a sibling group beneath
 * "Reference geometry" in the existing feature-tree side pane. This
 * component is purely presentational: it reads from the store via the
 * adapter, but mutations (delete, hide, click-to-edit) are dispatched to
 * the parent through prop callbacks.
 *
 * Important boundary: **ref-geom nodes are NOT added to the existing
 * `HistoryNode[]`** (see tracker D2 row). They live in their own store
 * and render as a parallel group. The parent feature-tree component
 * just hosts this section between its other groups.
 *
 * Scope (W2):
 *   - Display: kind icon + label + error chip + hide-eye + delete.
 *   - Click row → fires `onEdit(node)` so the parent can open the
 *     matching method-picker dialog. Wire-up happens in the host (W2).
 *   - No drag-to-reorder yet (spec §13.3 doesn't require it).
 *   - No CRDT presence (Phase 2 W3 follow-up).
 */

import React from 'react';
import { useReferenceGeometryStore } from '../store';
import { useReferenceNodesAdapter } from '../useReferenceNodesAdapter';
import type { ReferenceNode } from '../types';

const KIND_ICON: Record<ReferenceNode['kind'], string> = {
  plane: '▱',
  axis: '↕',
  point: '•',
  csys: '⌖',
};

export interface ReferenceGeometryTreeSectionProps {
  /** Fires when the user clicks a row to edit it. The host opens the
   *  matching method-picker dialog pre-populated with the node. */
  onEdit?: (node: ReferenceNode) => void;
  /** Optional override for "no items yet" copy — used in tests. */
  emptyLabel?: string;
}

const styles = {
  section: {
    padding: '8px 10px',
    borderTop: '1px solid var(--nx-border)',
    background: 'var(--nx-panel)',
    color: 'var(--nx-text)',
    fontSize: 12,
  } as React.CSSProperties,
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '4px 0 6px',
    fontWeight: 700,
    color: 'var(--nx-text-2)',
    textTransform: 'uppercase' as const,
    fontSize: 10,
    letterSpacing: 0.4,
  },
  empty: {
    padding: '6px 4px',
    color: 'var(--nx-text-3)',
    fontStyle: 'italic' as const,
    fontSize: 11,
  },
  row: (hasError: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '4px 6px',
    borderRadius: 4,
    cursor: 'pointer',
    color: hasError ? 'var(--nx-warn, #d28e3a)' : 'var(--nx-text)',
  }),
  icon: {
    width: 16,
    textAlign: 'center' as const,
    opacity: 0.7,
    fontSize: 13,
  },
  label: {
    flex: 1,
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
  },
  badge: {
    background: 'var(--nx-warn-bg, #5d3f1f)',
    color: 'var(--nx-warn, #d28e3a)',
    padding: '0 6px',
    fontSize: 10,
    borderRadius: 999,
    fontWeight: 600,
  },
  iconBtn: {
    background: 'transparent',
    border: 'none',
    color: 'var(--nx-text-3)',
    cursor: 'pointer',
    padding: '2px 4px',
    fontSize: 12,
  },
};

export default function ReferenceGeometryTreeSection(
  props: ReferenceGeometryTreeSectionProps,
): React.ReactElement {
  const { onEdit, emptyLabel = 'No reference geometry yet.' } = props;
  const { orderedNodes, issues } = useReferenceNodesAdapter();
  const remove = useReferenceGeometryStore((s) => s.remove);
  const update = useReferenceGeometryStore((s) => s.update);

  // Build a per-node issue counter so the row knows whether to flag.
  const issueCount = React.useMemo(() => {
    const c = new Map<string, number>();
    for (const i of issues) c.set(i.nodeId, (c.get(i.nodeId) ?? 0) + 1);
    return c;
  }, [issues]);

  return (
    <div style={styles.section} data-testid="ref-geom-tree-section">
      <div style={styles.header}>
        <span>Reference geometry</span>
        <span style={{ color: 'var(--nx-text-3)', fontSize: 10 }}>
          {orderedNodes.length}
        </span>
      </div>
      {orderedNodes.length === 0 ? (
        <div style={styles.empty}>{emptyLabel}</div>
      ) : (
        orderedNodes.map((n) => {
          const errs = issueCount.get(n.id) ?? 0;
          return (
            <div
              key={n.id}
              style={styles.row(errs > 0)}
              onClick={() => onEdit?.(n)}
              data-testid={`ref-geom-tree-row-${n.id}`}
              role="button"
            >
              <span style={styles.icon} aria-hidden>
                {KIND_ICON[n.kind]}
              </span>
              <span style={styles.label} title={n.label}>
                {n.label}
              </span>
              {errs > 0 ? <span style={styles.badge}>!</span> : null}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  update(n.id, { hidden: !n.hidden });
                }}
                title={n.hidden ? 'Show' : 'Hide'}
                style={styles.iconBtn}
                data-testid={`ref-geom-tree-hide-${n.id}`}
              >
                {n.hidden ? '◌' : '●'}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  remove(n.id);
                }}
                title="Delete"
                style={styles.iconBtn}
                data-testid={`ref-geom-tree-delete-${n.id}`}
              >
                ×
              </button>
            </div>
          );
        })
      )}
    </div>
  );
}
