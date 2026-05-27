/**
 * featureGraphLayout.ts — 2D layout for the feature-graph DAG.
 *
 * `featureGraph.ts` builds the logical DAG. To *show* it on screen,
 * we need 2D coordinates: x-position for evaluation order, y-position
 * for parallel branches. This module computes that layout.
 *
 * Algorithm — Sugiyama-style with longest-path layering:
 *   1. Partition into levels (already in featureGraph.partitionLevels).
 *   2. Within each level, order nodes to minimize edge crossings via
 *      the barycenter heuristic.
 *   3. Assign (x, y) coordinates with configurable horizontal +
 *      vertical spacing.
 *   4. Route edges as polylines: vertical segments at parent and
 *      child levels + horizontal jump in between.
 *
 * Output is renderer-agnostic: callers wire the result into SVG,
 * Canvas, or React-Flow as they prefer.
 */

import {
  buildGraph,
  partitionLevels,
  type FeatureNode,
  type DependencyGraph,
} from './featureGraph';

export interface LayoutNode {
  id: string;
  /** Display label. */
  label: string;
  /** Optional feature kind for color/icon. */
  kind?: string;
  /** Position (px). */
  x: number;
  y: number;
  /** Render width / height (px). */
  width: number;
  height: number;
  /** Level (0 = leftmost). */
  level: number;
}

export interface LayoutEdge {
  fromId: string;
  toId: string;
  /** Polyline waypoints (px). Always 3+ points (start, optional knee, end). */
  waypoints: Array<[number, number]>;
}

export interface GraphLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  /** Bounding box of the layout (px). */
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
}

export interface LayoutOptions {
  /** Horizontal spacing between levels (px). */
  levelSpacing?: number;
  /** Vertical spacing between nodes within a level (px). */
  nodeSpacing?: number;
  /** Node width / height. */
  nodeWidth?: number;
  nodeHeight?: number;
  /** Apply the crossing-reduction pass (default true). */
  reduceCrossings?: boolean;
}

const DEFAULTS = {
  levelSpacing: 160,
  nodeSpacing: 50,
  nodeWidth: 120,
  nodeHeight: 36,
  reduceCrossings: true,
};

// ── Layout main entry ───────────────────────────────────────────

export function layoutFeatureGraph(
  features: FeatureNode[],
  options: LayoutOptions = {},
): GraphLayout {
  const opts = { ...DEFAULTS, ...options };
  const graph = buildGraph(features);
  const levels = partitionLevels(graph);

  // Order within each level (barycenter heuristic).
  if (opts.reduceCrossings) {
    barycenterOrder(levels, graph);
  }

  // Assign coords.
  const nodes: LayoutNode[] = [];
  const featureById = new Map(features.map(f => [f.id, f]));
  for (const level of levels) {
    const totalHeight = level.featureIds.length * (opts.nodeHeight + opts.nodeSpacing) - opts.nodeSpacing;
    const startY = -totalHeight / 2;
    for (let i = 0; i < level.featureIds.length; i++) {
      const id = level.featureIds[i]!;
      const feat = featureById.get(id);
      nodes.push({
        id,
        label: feat?.id ?? id,
        kind: feat?.kind,
        x: level.index * opts.levelSpacing,
        y: startY + i * (opts.nodeHeight + opts.nodeSpacing),
        width: opts.nodeWidth,
        height: opts.nodeHeight,
        level: level.index,
      });
    }
  }

  // Build edges with right-angle routing.
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const edges: LayoutEdge[] = [];
  for (const f of features) {
    const child = nodeById.get(f.id);
    if (!child) continue;
    for (const parentId of f.parentIds) {
      const parent = nodeById.get(parentId);
      if (!parent) continue;
      const parentExit: [number, number] = [parent.x + parent.width, parent.y + parent.height / 2];
      const childEnter: [number, number] = [child.x, child.y + child.height / 2];
      const midX = (parentExit[0] + childEnter[0]) / 2;
      edges.push({
        fromId: parent.id,
        toId: child.id,
        waypoints: [
          parentExit,
          [midX, parentExit[1]],
          [midX, childEnter[1]],
          childEnter,
        ],
      });
    }
  }

  // Bbox.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.x + n.width > maxX) maxX = n.x + n.width;
    if (n.y + n.height > maxY) maxY = n.y + n.height;
  }
  if (nodes.length === 0) {
    minX = minY = maxX = maxY = 0;
  }

  return { nodes, edges, bbox: { minX, minY, maxX, maxY } };
}

// ── Barycenter ordering to reduce edge crossings ────────────────

function barycenterOrder(
  levels: Array<{ index: number; featureIds: string[] }>,
  graph: DependencyGraph,
): void {
  // Sweep top-to-bottom + bottom-to-top, repeatedly reordering each
  // level by the average y-position of its connected neighbours in
  // the previous level.
  const passes = 4;
  for (let pass = 0; pass < passes; pass++) {
    const forward = pass % 2 === 0;
    const order = forward ? levels : levels.slice().reverse();
    for (let li = 1; li < order.length; li++) {
      const cur = order[li]!;
      const prev = order[li - 1]!;
      const prevIdx = new Map<string, number>();
      prev.featureIds.forEach((id, i) => prevIdx.set(id, i));
      cur.featureIds.sort((a, b) => {
        const baryA = barycenter(a, prev.featureIds, prevIdx, graph, forward);
        const baryB = barycenter(b, prev.featureIds, prevIdx, graph, forward);
        return baryA - baryB;
      });
    }
  }
}

function barycenter(
  id: string,
  prevIds: string[],
  prevIdx: Map<string, number>,
  graph: DependencyGraph,
  forward: boolean,
): number {
  const neighbours = forward
    ? graph.predecessors.get(id) ?? new Set()
    : graph.successors.get(id) ?? new Set();
  let sum = 0;
  let count = 0;
  for (const n of neighbours) {
    const idx = prevIdx.get(n);
    if (idx !== undefined) {
      sum += idx;
      count++;
    }
  }
  return count > 0 ? sum / count : prevIds.length / 2;
}

// ── Critical-path highlighting ─────────────────────────────────

/** Walk the longest weighted path in the DAG. Caller can highlight
 *  these nodes + edges in red. */
export function findCriticalPath(
  features: FeatureNode[],
  timings: Map<string, number>,
): string[] {
  const graph = buildGraph(features);
  const longestTo = new Map<string, number>();
  const parentOnPath = new Map<string, string>();
  const levels = partitionLevels(graph);
  for (const level of levels) {
    for (const id of level.featureIds) {
      let longest = 0;
      let parent: string | undefined;
      for (const p of graph.predecessors.get(id) ?? []) {
        const lp = longestTo.get(p) ?? 0;
        if (lp > longest) { longest = lp; parent = p; }
      }
      longestTo.set(id, longest + (timings.get(id) ?? 1));
      if (parent) parentOnPath.set(id, parent);
    }
  }
  let endpoint: string | null = null;
  let maxLen = -Infinity;
  for (const [id, l] of longestTo) {
    if (l > maxLen) { maxLen = l; endpoint = id; }
  }
  const path: string[] = [];
  let cur: string | null = endpoint;
  while (cur) {
    path.unshift(cur);
    cur = parentOnPath.get(cur) ?? null;
  }
  return path;
}

// ── SVG output ──────────────────────────────────────────────────

/** Render the layout as an SVG string. Optional `highlightPath` paints
 *  the critical-path nodes/edges in the highlight color. */
export interface SvgRenderOptions {
  highlightPath?: string[];
  nodeColor?: string;
  highlightColor?: string;
  edgeColor?: string;
  textColor?: string;
  padding?: number;
}

export function renderGraphSvg(layout: GraphLayout, options: SvgRenderOptions = {}): string {
  const pad = options.padding ?? 20;
  const w = layout.bbox.maxX - layout.bbox.minX + pad * 2;
  const h = layout.bbox.maxY - layout.bbox.minY + pad * 2;
  const tx = -layout.bbox.minX + pad;
  const ty = -layout.bbox.minY + pad;
  const nodeColor = options.nodeColor ?? '#1e293b';
  const highlightColor = options.highlightColor ?? '#ef4444';
  const edgeColor = options.edgeColor ?? '#64748b';
  const textColor = options.textColor ?? '#f1f5f9';
  const onPath = new Set(options.highlightPath ?? []);

  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`);
  parts.push(`<g transform="translate(${tx} ${ty})">`);

  for (const e of layout.edges) {
    const isHl = onPath.has(e.fromId) && onPath.has(e.toId);
    const stroke = isHl ? highlightColor : edgeColor;
    const path = e.waypoints
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ');
    parts.push(`<path d="${path}" fill="none" stroke="${stroke}" stroke-width="${isHl ? 2 : 1}"/>`);
  }

  for (const n of layout.nodes) {
    const isHl = onPath.has(n.id);
    const fill = isHl ? highlightColor : nodeColor;
    parts.push(
      `<rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="4" fill="${fill}"/>`,
      `<text x="${n.x + n.width / 2}" y="${n.y + n.height / 2}" text-anchor="middle" dominant-baseline="middle" font-size="11" font-family="Helvetica, Arial, sans-serif" fill="${textColor}">${escapeXml(n.label)}</text>`,
    );
  }

  parts.push('</g></svg>');
  return parts.join('');
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
