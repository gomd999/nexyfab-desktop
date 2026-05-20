/**
 * supportTreeGenerator.ts — Tree-style support generation for 3D
 * printing (SLA/FDM/MJF).
 *
 * Overhang regions need support — material printed in mid-air. Two
 * styles:
 *
 *   - **Pillar supports** — vertical struts. Cheap to generate,
 *     hard to peel, leave dimples.
 *   - **Tree supports** — branching trunks that converge near the
 *     build plate. Less material, easier to peel, but requires more
 *     planning. This module generates them.
 *
 * Algorithm (greedy hierarchical merge, à la Cura/Bambu):
 *
 *   1. **Sample** overhang points on the model: any vertex with a
 *      normal pointing more than `overhangAngleDeg` away from the
 *      build direction.
 *   2. **Drop** each point straight down to the build plate to get
 *      a tip + a base.
 *   3. **Merge** tips that are within `mergeRadius` mm of each other
 *      into a shared parent node, repeatedly, until no more merges.
 *   4. **Emit** the tree as a list of trunk segments + leaf tips.
 */

export interface Vec3 { x: number; y: number; z: number }

export interface OverhangPoint {
  id: string;
  /** Vertex position (where support tip touches the model). */
  position: Vec3;
  /** Outward normal — used to filter overhangs. */
  normal: Vec3;
}

export interface SupportTreeNode {
  id: string;
  /** Top of this trunk segment (closer to model). */
  top: Vec3;
  /** Bottom of this trunk segment (closer to build plate). */
  bottom: Vec3;
  /** Trunk radius, mm. */
  radiusMm: number;
  /** Parent node id (closer to build plate). */
  parentId: string | null;
  /** Is this a leaf (touches a model vertex)? */
  isLeaf: boolean;
  /** Overhang point ids this node ultimately supports. */
  supportedPointIds: string[];
}

export interface SupportTreeResult {
  /** All nodes in the tree (leaves + branches + roots). */
  nodes: SupportTreeNode[];
  /** Build-plate footprint Z. */
  buildPlateZ: number;
  /** Total support volume (mm³). */
  totalVolumeMm3: number;
  /** Overhang points that received supports. */
  supportedCount: number;
  /** Overhang points filtered out by angle. */
  skippedCount: number;
}

export interface TreeOptions {
  /** Build direction (default +Z = print bottom-up). */
  buildDirection: 'up' | 'down';
  /** Overhang threshold (degrees from build direction). */
  overhangAngleDeg: number;
  /** Build plate Z. */
  buildPlateZ: number;
  /** Tip radius, mm. */
  tipRadiusMm: number;
  /** Trunk radius growth per merge level, mm. */
  radiusGrowthPerMerge: number;
  /** Merge radius (mm) — tips closer than this merge into a parent. */
  mergeRadiusMm: number;
}

export const DEFAULT_OPTIONS: TreeOptions = {
  buildDirection: 'up',
  overhangAngleDeg: 45,
  buildPlateZ: 0,
  tipRadiusMm: 0.5,
  radiusGrowthPerMerge: 0.3,
  mergeRadiusMm: 3.0,
};

// ── Top-level entry ────────────────────────────────────────────

export function generateSupportTree(points: OverhangPoint[], options: Partial<TreeOptions> = {}): SupportTreeResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  // Filter by overhang angle.
  const dir: Vec3 = opts.buildDirection === 'up' ? { x: 0, y: 0, z: 1 } : { x: 0, y: 0, z: -1 };
  const cosThreshold = Math.cos((180 - opts.overhangAngleDeg) * Math.PI / 180);
  const overhangs: OverhangPoint[] = [];
  let skipped = 0;
  for (const p of points) {
    const d = p.normal.x * dir.x + p.normal.y * dir.y + p.normal.z * dir.z;
    if (d <= cosThreshold) overhangs.push(p);
    else skipped++;
  }

  if (overhangs.length === 0) {
    return {
      nodes: [],
      buildPlateZ: opts.buildPlateZ,
      totalVolumeMm3: 0,
      supportedCount: 0,
      skippedCount: skipped,
    };
  }

  // Initial leaf nodes.
  const nodes: SupportTreeNode[] = [];
  let nodeId = 0;
  type Cur = { node: SupportTreeNode; level: number };
  let frontier: Cur[] = [];
  for (const p of overhangs) {
    const leaf: SupportTreeNode = {
      id: `n${nodeId++}`,
      top: p.position,
      bottom: { x: p.position.x, y: p.position.y, z: p.position.z - 1 },
      radiusMm: opts.tipRadiusMm,
      parentId: null,
      isLeaf: true,
      supportedPointIds: [p.id],
    };
    nodes.push(leaf);
    frontier.push({ node: leaf, level: 0 });
  }

  // Hierarchical merge. At each level, find pairs within mergeRadius
  // and emit a parent node merging them.
  const maxIterations = 50;
  let iter = 0;
  while (frontier.length > 1 && iter < maxIterations) {
    const next: Cur[] = [];
    const used = new Set<number>();
    for (let i = 0; i < frontier.length; i++) {
      if (used.has(i)) continue;
      used.add(i);
      // Find a partner.
      let partnerIdx = -1;
      let bestDist = Infinity;
      for (let j = i + 1; j < frontier.length; j++) {
        if (used.has(j)) continue;
        const d = horizontalDistance(frontier[i]!.node.bottom, frontier[j]!.node.bottom);
        if (d < bestDist && d < opts.mergeRadiusMm * Math.pow(1.5, iter)) {
          bestDist = d;
          partnerIdx = j;
        }
      }
      if (partnerIdx < 0) {
        next.push(frontier[i]!);
        continue;
      }
      used.add(partnerIdx);
      const a = frontier[i]!.node;
      const b = frontier[partnerIdx]!.node;
      // Drop trunk to a midpoint slightly closer to build plate.
      const childZ = Math.min(a.bottom.z, b.bottom.z) - 5;
      const midX = (a.bottom.x + b.bottom.x) / 2;
      const midY = (a.bottom.y + b.bottom.y) / 2;
      const parent: SupportTreeNode = {
        id: `n${nodeId++}`,
        top: { x: midX, y: midY, z: Math.min(a.bottom.z, b.bottom.z) },
        bottom: { x: midX, y: midY, z: childZ },
        radiusMm: Math.max(a.radiusMm, b.radiusMm) + opts.radiusGrowthPerMerge,
        parentId: null,
        isLeaf: false,
        supportedPointIds: [...a.supportedPointIds, ...b.supportedPointIds],
      };
      // Wire children to parent.
      a.parentId = parent.id;
      b.parentId = parent.id;
      // Extend a/b's bottom to parent.top so trunk reaches.
      a.bottom = parent.top;
      b.bottom = parent.top;
      nodes.push(parent);
      next.push({ node: parent, level: iter + 1 });
    }
    if (next.length === frontier.length) break;
    frontier = next;
    iter++;
  }

  // Drop final roots to build plate.
  for (const cur of frontier) {
    const n = cur.node;
    if (n.bottom.z > opts.buildPlateZ) {
      n.bottom = { x: n.bottom.x, y: n.bottom.y, z: opts.buildPlateZ };
    }
  }

  // Compute total volume.
  let totalVol = 0;
  for (const n of nodes) {
    const h = Math.abs(n.top.z - n.bottom.z);
    totalVol += Math.PI * n.radiusMm * n.radiusMm * h;
  }

  return {
    nodes,
    buildPlateZ: opts.buildPlateZ,
    totalVolumeMm3: totalVol,
    supportedCount: overhangs.length,
    skippedCount: skipped,
  };
}

// ── Helpers ────────────────────────────────────────────────────

function horizontalDistance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// ── Stats ──────────────────────────────────────────────────────

export interface TreeStats {
  nodeCount: number;
  leafCount: number;
  rootCount: number;
  maxDepth: number;
  averageBranchingFactor: number;
  totalSupportVolumeMm3: number;
}

export function computeStats(result: SupportTreeResult): TreeStats {
  let leafCount = 0;
  let rootCount = 0;
  const childrenOf = new Map<string, number>();
  for (const n of result.nodes) {
    if (n.isLeaf) leafCount++;
    if (n.parentId === null) rootCount++;
    if (n.parentId) {
      childrenOf.set(n.parentId, (childrenOf.get(n.parentId) ?? 0) + 1);
    }
  }
  let totalChildren = 0;
  let branchingNodes = 0;
  for (const cnt of childrenOf.values()) {
    if (cnt > 0) {
      totalChildren += cnt;
      branchingNodes++;
    }
  }
  // Tree depth via DFS from leaves to roots.
  const depthMap = new Map<string, number>();
  function depthOf(id: string): number {
    if (depthMap.has(id)) return depthMap.get(id)!;
    const node = result.nodes.find(n => n.id === id);
    if (!node || node.parentId === null) {
      depthMap.set(id, 0);
      return 0;
    }
    const d = depthOf(node.parentId) + 1;
    depthMap.set(id, d);
    return d;
  }
  let maxDepth = 0;
  for (const n of result.nodes) {
    const d = depthOf(n.id);
    if (d > maxDepth) maxDepth = d;
  }
  return {
    nodeCount: result.nodes.length,
    leafCount,
    rootCount,
    maxDepth,
    averageBranchingFactor: branchingNodes > 0 ? totalChildren / branchingNodes : 0,
    totalSupportVolumeMm3: result.totalVolumeMm3,
  };
}

// ── Summary ────────────────────────────────────────────────────

export interface TreeSummary {
  supportedPointCount: number;
  totalVolumeMm3: number;
  rootCount: number;
  /** Material saving vs naive vertical pillars (estimate). */
  estimatedMaterialSavingPct: number;
}

export function summarize(points: OverhangPoint[], result: SupportTreeResult): TreeSummary {
  // Naive pillar volume: each overhang point × column height × tip radius².
  let naiveVol = 0;
  for (const p of points) {
    const h = Math.max(0, p.position.z - result.buildPlateZ);
    naiveVol += Math.PI * 0.5 * 0.5 * h;
  }
  const saving = naiveVol > 0 ? Math.max(0, (1 - result.totalVolumeMm3 / naiveVol) * 100) : 0;
  const roots = result.nodes.filter(n => n.parentId === null).length;
  return {
    supportedPointCount: result.supportedCount,
    totalVolumeMm3: result.totalVolumeMm3,
    rootCount: roots,
    estimatedMaterialSavingPct: saving,
  };
}
