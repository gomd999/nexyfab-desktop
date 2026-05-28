'use client';

/**
 * FeatureTreePeerHighlight.tsx — Wave 2 Phase 3 W5 Track Z5.
 *
 * Feature-tree overlay. For each remote peer whose awareness state has
 * `activeNodeId === nodeId`, renders a small color pill anchored next to
 * that node row.
 *
 * Render strategies:
 *   1. **Inline pill** (`<PeerNodePill nodeId={...} />`) — drop directly
 *      next to a tree row's label.
 *   2. **Lookup hook** (`useRemotePeersOnNode(nodeId)`) — returns the
 *      peers on a node so consumers can render whatever UI they want.
 *
 * Self filtering:
 *   `useCollabPresence` already excludes the local peer from `remotePeers`,
 *   so we never render a pill for our own activeNodeId. Good — there's
 *   already a selected-row chrome for the local user.
 *
 * Multi-peer collision:
 *   Two peers can sit on the same node. The pill stacks them horizontally
 *   with a small overlap, capped at 3 visible; "+N more" pill after.
 *
 * Touchpoint discipline:
 *   The Tree component in `_shell/sidebars/Tree.tsx` is generic — it
 *   doesn't know about collab. Rather than fork that file, this module
 *   exports `<PeerNodePill>` to drop alongside the label OR `<FeatureTreePeerOverlay>`
 *   which positions absolutely against `data-node-id={...}` rows in the
 *   tree DOM. Either mount works; the host picks based on layout
 *   constraints.
 */

import React, { useMemo, useEffect, useState, useCallback } from 'react';
import { useCollabPresence } from '../collab/CollabProvider';
import { CollabSafe } from '../collab/CollabSafe';
import type { PeerInfo } from '../collab/awareness';

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Returns the remote peers currently editing the given feature-tree node.
 * Self is implicitly excluded (Provider strips it from `remotePeers`).
 */
export function useRemotePeersOnNode(nodeId: string | null): PeerInfo[] {
  const { remotePeers } = useCollabPresence();
  return useMemo(() => {
    if (!nodeId) return [];
    return Object.values(remotePeers).filter((p) => p.activeNodeId === nodeId);
  }, [remotePeers, nodeId]);
}

// ─── Inline pill ────────────────────────────────────────────────────────────

export interface PeerNodePillProps {
  /** Feature-tree node id. */
  nodeId: string;
  /** Max number of color dots before collapsing to "+N". Default 3. */
  maxVisible?: number;
  /** Optional className override (defaults to inline style). */
  className?: string;
}

/**
 * Drops a small horizontal cluster of color dots next to a tree-row label.
 * Renders `null` when no remote peer is on this node — the surrounding
 * row stays untouched.
 *
 * Wrapped in `<CollabSafe>` so dropping it into the legacy tree (pre-Z6,
 * no `<CollabProvider>`) is a no-op rather than a runtime throw.
 */
export function PeerNodePill(props: PeerNodePillProps) {
  return (
    <CollabSafe>
      <PeerNodePillInner {...props} />
    </CollabSafe>
  );
}

function PeerNodePillInner(props: PeerNodePillProps) {
  const { nodeId, maxVisible = 3, className } = props;
  const peers = useRemotePeersOnNode(nodeId);
  if (peers.length === 0) return null;

  const sorted = [...peers].sort((a, b) => a.id.localeCompare(b.id));
  const visible = sorted.slice(0, maxVisible);
  const extra = Math.max(0, sorted.length - maxVisible);

  return (
    <span
      data-testid="feature-tree-peer-pill"
      data-node-id={nodeId}
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        marginLeft: 6,
        gap: 0,
      }}
    >
      {visible.map((p, idx) => (
        <span
          key={p.id}
          data-testid="feature-tree-peer-dot"
          data-peer-id={p.id}
          title={p.name}
          aria-label={p.name}
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: p.color,
            boxShadow: '0 0 0 1.5px var(--nx-panel, #111827)',
            marginLeft: idx === 0 ? 0 : -3,
            display: 'inline-block',
            flex: '0 0 8px',
          }}
        />
      ))}
      {extra > 0 && (
        <span
          data-testid="feature-tree-peer-overflow"
          style={{
            marginLeft: 3,
            fontSize: 9,
            fontWeight: 700,
            color: 'var(--nx-text-3, #9ca3af)',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          +{extra}
        </span>
      )}
    </span>
  );
}

// ─── Overlay ────────────────────────────────────────────────────────────────

export interface FeatureTreePeerOverlayProps {
  /**
   * Optional container ref — when provided, the overlay scans this subtree
   * for `[data-node-id]` elements and positions pills absolutely against
   * each. When omitted, pills aren't rendered (host should use
   * `<PeerNodePill>` inline instead).
   */
  containerRef?: React.RefObject<HTMLElement | null>;
  /** Max number of color dots before collapsing to "+N". Default 3. */
  maxVisible?: number;
}

interface AnchorRect {
  nodeId: string;
  top: number;
  right: number;
}

/**
 * Absolute-positioned overlay that decorates `data-node-id` rows inside
 * the host's tree container. Use this when the tree DOM is rendered by a
 * generic component (e.g. `_shell/sidebars/Tree`) you don't want to fork.
 *
 * Implementation: on every awareness change AND on every container resize
 * we recompute anchor rects (DOMRect.top of each matched row, container.right
 * — 8). Pills float over the row at that y-coordinate.
 *
 * The reflow is throttled internally to once per animation frame.
 *
 * Wrapped in `<CollabSafe>` so dropping it into the legacy tree (pre-Z6,
 * no `<CollabProvider>`) is a no-op rather than a runtime throw.
 */
export function FeatureTreePeerOverlay(props: FeatureTreePeerOverlayProps) {
  return (
    <CollabSafe>
      <FeatureTreePeerOverlayInner {...props} />
    </CollabSafe>
  );
}

function FeatureTreePeerOverlayInner(props: FeatureTreePeerOverlayProps) {
  const { containerRef, maxVisible = 3 } = props;
  const { remotePeers } = useCollabPresence();
  const [anchors, setAnchors] = useState<AnchorRect[]>([]);

  const refresh = useCallback(() => {
    const container = containerRef?.current;
    if (!container) {
      setAnchors([]);
      return;
    }
    const activeNodeIds = new Set<string>();
    Object.values(remotePeers).forEach((p) => {
      if (p.activeNodeId) activeNodeIds.add(p.activeNodeId);
    });
    if (activeNodeIds.size === 0) {
      setAnchors([]);
      return;
    }
    const containerRect = container.getBoundingClientRect();
    const rows = container.querySelectorAll<HTMLElement>('[data-node-id]');
    const next: AnchorRect[] = [];
    rows.forEach((row) => {
      const id = row.getAttribute('data-node-id');
      if (!id || !activeNodeIds.has(id)) return;
      const rect = row.getBoundingClientRect();
      next.push({
        nodeId: id,
        top: rect.top - containerRect.top + 4,
        right: containerRect.right - rect.right + 8,
      });
    });
    setAnchors(next);
  }, [containerRef, remotePeers]);

  // Re-run on awareness change AND on container size change.
  useEffect(() => {
    let rafId: number | null = null;
    const schedule = () => {
      if (rafId !== null) return;
      if (typeof requestAnimationFrame !== 'undefined') {
        rafId = requestAnimationFrame(() => {
          rafId = null;
          refresh();
        });
      } else {
        refresh();
      }
    };
    schedule();
    const container = containerRef?.current;
    if (!container) return;
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(schedule);
      ro.observe(container);
    }
    return () => {
      if (rafId !== null && typeof cancelAnimationFrame !== 'undefined') {
        try { cancelAnimationFrame(rafId); } catch { /* best-effort */ }
      }
      ro?.disconnect();
    };
  }, [refresh, containerRef]);

  if (anchors.length === 0) return null;

  return (
    <div
      data-testid="feature-tree-peer-overlay"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
      }}
    >
      {anchors.map((a) => (
        <div
          key={a.nodeId}
          style={{
            position: 'absolute',
            top: a.top,
            right: a.right,
          }}
        >
          <PeerNodePill nodeId={a.nodeId} maxVisible={maxVisible} />
        </div>
      ))}
    </div>
  );
}

export default PeerNodePill;
