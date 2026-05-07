'use client';

import { useState, useCallback, useMemo } from 'react';
import type { FeatureType, FeatureInstance } from './features/types';
import { getFeatureDefinition } from './features';
import type { SketchProfile, SketchConfig } from './sketch/types';

// ─── Feature param validation ─────────────────────────────────────────────────

export function validateFeatureParams(
  type: FeatureType,
  params: Record<string, unknown>,
): string | null {
  if (type === 'sketch' || type === 'sketchExtrude') return null;
  if (type === 'fillet' || type === 'chamfer') {
    const radius = params.radius as number;
    if (!radius || radius <= 0) return 'Radius must be greater than 0';
  }
  if (type === 'shell') {
    const thickness = params.thickness as number;
    if (!thickness || thickness <= 0) return 'Shell thickness must be greater than 0';
  }
  if (type === 'hole') {
    const diameter = params.diameter as number;
    if (!diameter || diameter <= 0) return 'Hole diameter must be greater than 0';
  }
  return null;
}

// ─── History Node types ───────────────────────────────────────────────────────

export type HistoryNodeType =
  | 'baseShape'
  | 'sketch'
  | 'feature'
  | 'extrudeCut'
  | 'import'
  | 'sheetMetal';

export interface SketchNodeData {
  profile: SketchProfile;
  config: SketchConfig;
  plane: 'xy' | 'xz' | 'yz';
  planeOffset: number;
  operation: 'add' | 'subtract';
  constraints?: import('./sketch/types').SketchConstraint[];
  dimensions?: import('./sketch/types').SketchDimension[];
}

export interface HistoryNode {
  id: string;
  type: HistoryNodeType;
  label: string;
  icon: string;
  featureType?: FeatureType;
  params: Record<string, any>;
  enabled: boolean;
  /** Optional JS-like expression that controls enabled state.
   *  Variables: param names from this node (e.g. "width > 50 && height < 100").
   *  Evaluated at pipeline time; overrides `enabled` when non-empty. */
  enabledExpr?: string;
  expanded: boolean;
  error?: string;
  parentId: string | null;
  children: string[];
  editingActive: boolean;
  timestamp: number;
  /** Optional explicit upstream node ids for 재생성 순서·진단 (상용 히스토리 그래프 1단계). */
  dependsOn?: string[];
  /** Present only when featureType === 'sketchExtrude' */
  sketchData?: SketchNodeData;
}

export interface FeatureHistory {
  nodes: HistoryNode[];
  rootId: string;
  activeNodeId: string;
  editingNodeId: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function genId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

const NODE_ICONS: Record<HistoryNodeType, string> = {
  baseShape: '📦',
  sketch: '✏️',
  feature: '🔧',
  extrudeCut: '🗜️',
  import: '📥',
  sheetMetal: '🪨',
};

const FEATURE_ICONS: Partial<Record<FeatureType, string>> = {
  sketch: '✏️',
  fillet: '🔵',
  chamfer: '🔶',
  shell: '🐚',
  hole: '🕳️',
  linearPattern: '📐',
  circularPattern: '🔄',
  mirror: '🪞',
  boolean: '⊕',
  draft: '📏',
  scale: '↔️',
  moveCopy: '↗️',
  splitBody: '✂️',
  sketchExtrude: '✏️',
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useFeatureStack() {
  // Internal flat map for efficient lookups
  const [nodeMap, setNodeMap] = useState<Map<string, HistoryNode>>(() => {
    const rootId = genId();
    const root: HistoryNode = {
      id: rootId,
      type: 'baseShape',
      label: 'Base Shape',
      icon: '📦',
      params: {},
      enabled: true,
      expanded: true,
      parentId: null,
      children: [],
      editingActive: false,
      timestamp: Date.now(),
    };
    return new Map([[rootId, root]]);
  });

  const [rootId, setRootId] = useState<string>(() => {
    return Array.from(nodeMap.keys())[0];
  });

  const [activeNodeId, setActiveNodeId] = useState<string>(rootId);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [labelCounters, setLabelCounters] = useState<Map<string, number>>(new Map());
  const [featureErrors, setFeatureErrors] = useState<Record<string, string>>({});

  const setFeatureError = useCallback((id: string, message: string) => {
    setFeatureErrors(prev => ({ ...prev, [id]: message }));
  }, []);

  const clearFeatureError = useCallback((id: string) => {
    setFeatureErrors(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  // ── DFS-ordered list of all nodes ──

  const getOrderedNodes = useCallback((): HistoryNode[] => {
    const result: HistoryNode[] = [];
    const visited = new Set<string>();

    function dfs(id: string) {
      if (visited.has(id)) return;
      visited.add(id);
      const node = nodeMap.get(id);
      if (!node) return;
      result.push(node);
      for (const childId of node.children) {
        dfs(childId);
      }
    }

    const root = nodeMap.get(rootId);
    if (root) dfs(rootId);
    return result;
  }, [nodeMap, rootId]);

  // ── Determine which nodes are "active" (at or before activeNodeId in DFS) ──

  const activeNodeSet = useMemo((): Set<string> => {
    const ordered = getOrderedNodes();
    const set = new Set<string>();
    for (const node of ordered) {
      set.add(node.id);
      if (node.id === activeNodeId) break;
    }
    return set;
  }, [getOrderedNodes, activeNodeId]);

  const isNodeActive = useCallback(
    (id: string): boolean => activeNodeSet.has(id),
    [activeNodeSet],
  );

  // ── History object for external consumption ──

  const history = useMemo((): FeatureHistory => ({
    nodes: getOrderedNodes(),
    rootId,
    activeNodeId,
    editingNodeId,
  }), [getOrderedNodes, rootId, activeNodeId, editingNodeId]);

  // ── Auto-numbered label generation ──

  const generateLabel = useCallback((type: HistoryNodeType, featureType?: FeatureType): string => {
    const key = featureType || type;
    const labelBase =
      featureType
        ? featureType.charAt(0).toUpperCase() + featureType.slice(1).replace(/([A-Z])/g, ' $1')
        : type.charAt(0).toUpperCase() + type.slice(1).replace(/([A-Z])/g, ' $1');

    const current = labelCounters.get(key) || 0;
    const next = current + 1;
    setLabelCounters(prev => new Map(prev).set(key, next));
    return `${labelBase} ${next}`;
  }, [labelCounters]);

  // ── Add a new node to the tree ──

  const addNode = useCallback((
    type: HistoryNodeType,
    label?: string,
    icon?: string,
    params?: Record<string, any>,
    featureType?: FeatureType,
  ): string => {
    const id = genId();
    const resolvedLabel = label || generateLabel(type, featureType);
    const resolvedIcon = icon || (featureType ? FEATURE_ICONS[featureType] : undefined) || NODE_ICONS[type] || '🔧';

    const newNode: HistoryNode = {
      id,
      type,
      label: resolvedLabel,
      icon: resolvedIcon,
      featureType,
      params: params || {},
      enabled: true,
      expanded: true,
      parentId: activeNodeId,
      children: [],
      editingActive: false,
      timestamp: Date.now(),
      dependsOn: [activeNodeId],
    };

    setNodeMap(prev => {
      const next = new Map(prev);
      next.set(id, newNode);
      // Add as child of active node
      const parent = next.get(activeNodeId);
      if (parent) {
        next.set(activeNodeId, {
          ...parent,
          children: [...parent.children, id],
        });
      }
      return next;
    });

    setActiveNodeId(id);
    return id;
  }, [activeNodeId, generateLabel]);

  // ── Remove a node and all descendants ──

  const removeNode = useCallback((id: string) => {
    if (id === rootId) return; // cannot remove root

    setNodeMap(prev => {
      const next = new Map(prev);

      // Collect all descendants
      const toRemove = new Set<string>();
      function collect(nid: string) {
        toRemove.add(nid);
        const node = next.get(nid);
        if (node) node.children.forEach(collect);
      }
      collect(id);

      // Remove from parent's children
      const node = next.get(id);
      if (node?.parentId) {
        const parent = next.get(node.parentId);
        if (parent) {
          next.set(node.parentId, {
            ...parent,
            children: parent.children.filter(c => c !== id),
          });
        }
      }

      // Delete all collected nodes
      toRemove.forEach(nid => next.delete(nid));
      return next;
    });

    // If active node was removed, roll back to parent or root
    setActiveNodeId(prev => {
      const node = nodeMap.get(id);
      if (prev === id || !nodeMap.has(prev)) {
        return node?.parentId || rootId;
      }
      return prev;
    });

    if (editingNodeId === id) setEditingNodeId(null);
  }, [rootId, nodeMap, editingNodeId]);

  // ── Update a node ──

  const updateNode = useCallback((id: string, updates: Partial<HistoryNode>) => {
    setNodeMap(prev => {
      const node = prev.get(id);
      if (!node) return prev;
      const next = new Map(prev);
      next.set(id, { ...node, ...updates, id }); // id is immutable
      return next;
    });
  }, []);

  // ── Rollback: set active node, suppressing everything after it ──

  const rollbackTo = useCallback((id: string) => {
    if (!nodeMap.has(id)) return;
    setActiveNodeId(id);
  }, [nodeMap]);

  // ── Editing ──

  const startEditing = useCallback((id: string) => {
    if (!nodeMap.has(id)) return;
    // Clear previous editing state
    if (editingNodeId) {
      setNodeMap(prev => {
        const next = new Map(prev);
        const old = next.get(editingNodeId);
        if (old) next.set(editingNodeId, { ...old, editingActive: false });
        return next;
      });
    }
    setEditingNodeId(id);
    setNodeMap(prev => {
      const next = new Map(prev);
      const node = next.get(id);
      if (node) next.set(id, { ...node, editingActive: true });
      return next;
    });
  }, [nodeMap, editingNodeId]);

  const finishEditing = useCallback(() => {
    if (!editingNodeId) return;
    setNodeMap(prev => {
      const next = new Map(prev);
      const node = next.get(editingNodeId);
      if (node) next.set(editingNodeId, { ...node, editingActive: false });
      return next;
    });
    setEditingNodeId(null);
    // Recomputation is automatic because the features getter re-derives from nodeMap
  }, [editingNodeId]);

  const toggleExpanded = useCallback((id: string) => {
    setNodeMap(prev => {
      const node = prev.get(id);
      if (!node) return prev;
      const next = new Map(prev);
      next.set(id, { ...node, expanded: !node.expanded });
      return next;
    });
  }, []);

  /** Expand nodes (e.g. design-tree search) without toggling already-expanded rows. */
  const ensureExpanded = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setNodeMap(prev => {
      const next = new Map(prev);
      let changed = false;
      for (const id of ids) {
        const node = next.get(id);
        if (node && !node.expanded && node.children.length > 0) {
          next.set(id, { ...node, expanded: true });
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // Backward-compatible API (FeatureInstance[]-based)
  // ═══════════════════════════════════════════════════════════════════════════

  /** Ordered list of enabled feature nodes, mapped to FeatureInstance shape */
  const features = useMemo((): (HistoryNode & { type: FeatureType })[] => {
    const ordered = getOrderedNodes();
    return ordered
      .filter(n => n.type === 'feature' && n.featureType && activeNodeSet.has(n.id) && n.enabled)
      .map(n => n as HistoryNode & { type: FeatureType });
  }, [getOrderedNodes, activeNodeSet]);

  /** Backward-compatible features as FeatureInstance[] for applyFeaturePipeline */
  const featuresCompat = useMemo((): FeatureInstance[] => {
    const ordered = getOrderedNodes();
    return ordered
      .filter(n => {
        if (!(n.type === 'feature' && n.featureType && activeNodeSet.has(n.id))) return false;
        // Evaluate conditional expression if present; otherwise use enabled flag
        if (n.enabledExpr) return evaluateEnabledExpr(n.enabledExpr, n.params);
        return n.enabled;
      })
      .map(n => ({
        id: n.id,
        type: n.featureType!,
        params: { ...n.params },
        enabled: n.enabled,
        error: n.error,
        sketchData: n.sketchData,
      }));
  }, [getOrderedNodes, activeNodeSet]);

  const addFeature = useCallback((type: FeatureType) => {
    const def = getFeatureDefinition(type);
    if (!def) return;
    const params: Record<string, any> = {};
    def.params.forEach(p => {
      params[p.key] = p.default;
    });
    addNode('feature', undefined, def.icon, params, type);
  }, [addNode]);

  /** Add a feature with caller-supplied params (merged onto defaults). Used by
   *  wizards like Hole Wizard that pre-compute standard-spec values. */
  const addFeatureWithParams = useCallback((
    type: FeatureType,
    overrides: Record<string, any>,
  ) => {
    const def = getFeatureDefinition(type);
    if (!def) return;
    const params: Record<string, any> = {};
    def.params.forEach(p => {
      params[p.key] = p.default;
    });
    Object.assign(params, overrides);
    addNode('feature', undefined, def.icon, params, type);
  }, [addNode]);

  const addSketchFeature = useCallback((
    profile: SketchProfile,
    config: SketchConfig,
    plane: 'xy' | 'xz' | 'yz',
    operation: 'add' | 'subtract',
    planeOffset: number = 0,
    constraints?: import('./sketch/types').SketchConstraint[],
    dimensions?: import('./sketch/types').SketchDimension[],
  ): void => {
    const id = genId();
    const current = labelCounters.get('sketchExtrude') || 0;
    const next = current + 1;
    setLabelCounters(prev => new Map(prev).set('sketchExtrude', next));
    const label = `Sketch Extrude ${next}`;

    const newNode: HistoryNode = {
      id,
      type: 'feature',
      label,
      icon: '✏️',
      featureType: 'sketchExtrude',
      params: {
        depth: config.depth,
        planeOffset,
      },
      enabled: true,
      expanded: true,
      parentId: activeNodeId,
      children: [],
      editingActive: false,
      timestamp: Date.now(),
      sketchData: { profile, config, plane, planeOffset, operation, constraints, dimensions },
    };

    setNodeMap(prev => {
      const next = new Map(prev);
      next.set(id, newNode);
      const parent = next.get(activeNodeId);
      if (parent) {
        next.set(activeNodeId, { ...parent, children: [...parent.children, id] });
      }
      return next;
    });
    setActiveNodeId(id);
  }, [activeNodeId, labelCounters]);

  const removeFeature = useCallback((id: string) => {
    removeNode(id);
  }, [removeNode]);

  const updateFeatureParam = useCallback((id: string, key: string, value: any) => {
    setNodeMap(prev => {
      const node = prev.get(id);
      if (!node) return prev;
      const next = new Map(prev);
      let newParams = { ...node.params, [key]: value };
      // NURBS: uCount/vCount 변경 시 기존 커스텀 CP 좌표 초기화 (인덱스 불일치 방지)
      if (node.featureType === 'nurbsSurface' && (key === 'uCount' || key === 'vCount')) {
        newParams = Object.fromEntries(
          Object.entries(newParams).filter(([k]) => !k.startsWith('cp_')),
        );
      }
      next.set(id, { ...node, params: newParams, error: undefined });
      return next;
    });
  }, []);

  const toggleFeature = useCallback((id: string) => {
    setNodeMap(prev => {
      const node = prev.get(id);
      if (!node) return prev;
      const next = new Map(prev);
      next.set(id, { ...node, enabled: !node.enabled });
      return next;
    });
  }, []);

  const setNodeEnabledExpr = useCallback((id: string, expr: string) => {
    setNodeMap(prev => {
      const node = prev.get(id);
      if (!node) return prev;
      const next = new Map(prev);
      next.set(id, { ...node, enabledExpr: expr.trim() || undefined });
      return next;
    });
  }, []);

  const moveFeature = useCallback((fromIdOrIdx: number | string, toIdxOrDir: number | 'up' | 'down') => {
    // Support both old API (fromIdx, toIdx) and new API (id, direction)
    if (typeof fromIdOrIdx === 'string') {
      // New API: moveFeature(id, 'up' | 'down')
      const id = fromIdOrIdx;
      const direction = toIdxOrDir as 'up' | 'down';
      setNodeMap(prev => {
        const node = prev.get(id);
        if (!node || !node.parentId) return prev;
        const parent = prev.get(node.parentId);
        if (!parent) return prev;
        const idx = parent.children.indexOf(id);
        if (idx < 0) return prev;
        const newIdx = direction === 'up' ? idx - 1 : idx + 1;
        if (newIdx < 0 || newIdx >= parent.children.length) return prev;
        const next = new Map(prev);
        const newChildren = [...parent.children];
        [newChildren[idx], newChildren[newIdx]] = [newChildren[newIdx], newChildren[idx]];
        next.set(node.parentId, { ...parent, children: newChildren });
        return next;
      });
    } else {
      // Old API: moveFeature(fromIdx, toIdx) - now implements Reorder (Splice) instead of Swap
      const fromIdx = fromIdOrIdx as number;
      const toIdx = toIdxOrDir as number;
      const ordered = getOrderedNodes().filter(n => n.type === 'feature' && n.featureType);
      if (fromIdx < 0 || fromIdx >= ordered.length || toIdx < 0 || toIdx >= ordered.length || fromIdx === toIdx) return;
      
      const movingNode = ordered[fromIdx];
      const targetNode = ordered[toIdx];
      if (!movingNode || !targetNode) return;

      setNodeMap(prev => {
        if (movingNode.parentId !== targetNode.parentId || !movingNode.parentId) return prev;
        const parent = prev.get(movingNode.parentId);
        if (!parent) return prev;
        
        const next = new Map(prev);
        const children = [...parent.children];
        const fi = children.indexOf(movingNode.id);
        const ti = children.indexOf(targetNode.id);
        
        if (fi < 0 || ti < 0 || fi === ti) return prev;
        
        // Remove from current position
        const [movedId] = children.splice(fi, 1);
        
        // Find new target index (which may have shifted if we removed from before it)
        const newTi = children.indexOf(targetNode.id);
        
        // Insert at target index (shifts target to the right)
        children.splice(newTi, 0, movedId);
        
        next.set(parent.id, { ...parent, children });
        return next;
      });
    }
  }, [getOrderedNodes]);

  const undoLast = useCallback(() => {
    const ordered = getOrderedNodes();
    if (ordered.length <= 1) return; // only root remains
    const last = ordered[ordered.length - 1];
    if (last.id === rootId) return;
    removeNode(last.id);
  }, [getOrderedNodes, rootId, removeNode]);

  /** Bulk replace the entire feature history — used by .nfab project loading */
  const replaceHistory = useCallback((nodes: HistoryNode[], newRootId: string, newActiveId: string) => {
    if (nodes.length === 0) return;
    const map = new Map<string, HistoryNode>();
    for (const n of nodes) map.set(n.id, { ...n });
    if (!map.has(newRootId)) return;
    // Project load / branch switch: old node ids no longer apply
    setFeatureErrors({});
    setNodeMap(map);
    setRootId(newRootId);
    setActiveNodeId(map.has(newActiveId) ? newActiveId : newRootId);
    setEditingNodeId(null);
    setLabelCounters(new Map());
  }, []);

  const clearAll = useCallback(() => {
    const newRootId = genId();
    const root: HistoryNode = {
      id: newRootId,
      type: 'baseShape',
      label: 'Base Shape',
      icon: '📦',
      params: {},
      enabled: true,
      expanded: true,
      parentId: null,
      children: [],
      editingActive: false,
      timestamp: Date.now(),
    };
    setNodeMap(new Map([[newRootId, root]]));
    setRootId(newRootId);
    setActiveNodeId(newRootId);
    setEditingNodeId(null);
    setLabelCounters(new Map());
  }, []);

  return {
    // Backward-compatible API
    features: featuresCompat,
    addFeature,
    addFeatureWithParams,
    addSketchFeature,
    removeFeature,
    updateFeatureParam,
    toggleFeature,
    moveFeature,
    undoLast,
    clearAll,
    replaceHistory,

    // Feature error state
    featureErrors,
    setFeatureError,
    clearFeatureError,

    // New history tree API
    history,
    addNode,
    removeNode,
    updateNode,
    rollbackTo,
    startEditing,
    finishEditing,
    toggleExpanded,
    ensureExpanded,
    getOrderedNodes,
    isNodeActive,
    setNodeEnabledExpr,
  };
}

// ─── Evaluate enabledExpr for a node ──────────────────────────────────────────
// Returns true (enabled) if expr is empty/undefined, otherwise evaluates it.

export function evaluateEnabledExpr(expr: string | undefined, params: Record<string, any>): boolean {
  if (!expr || !expr.trim()) return true;
  try {
    const keys = Object.keys(params);
    const vals = keys.map(k => params[k]);
     
    const fn = new Function(...keys, `"use strict"; return !!(${expr});`);
    return fn(...vals) === true;
  } catch {
    return true; // on error, default to enabled
  }
}
