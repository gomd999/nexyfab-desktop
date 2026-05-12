/**
 * Z1 — Parametric feature tree with design intent preservation.
 *
 * The agent builds B-rep handles via brep_primitive / brep_boolean / etc.
 * Without a feature tree, those calls are immediate-mode: changing the
 * radius of a primitive doesn't re-fillet edges that referenced it. The
 * user has to throw away the design and rebuild.
 *
 * The feature tree fixes this by storing every operation as a node with
 * its parameters + parent refs, so a parameter change can mark downstream
 * nodes dirty and rebuild only the affected sub-tree. Names ("hole_for_M3",
 * "bracket.top") are stable refs the agent can use across rebuilds.
 *
 * Storage is in-session (AgentSession.featureTree). The actual rebuild
 * call dispatches via the host's brep adapter — this module owns the
 * graph, not the geometry.
 */

export interface FeatureNode {
  /** Stable internal id. */
  id: string;
  /** User/agent-friendly name. Optional but recommended for refs. */
  name?: string;
  /** Operation kind. Matches the brep_* tool name minus the prefix. */
  op:
    | 'primitive' | 'boolean' | 'fillet' | 'chamfer' | 'shell'
    | 'sweep' | 'loft' | 'draft' | 'helix'
    | 'sketch_extrude' | 'pattern' | 'mirror'
    | 'transform';
  /** Free-form params as the tool received them. */
  params: Record<string, unknown>;
  /** IDs of parent nodes this op depends on (geometry inputs). */
  parents: string[];
  /** Last successful build result handle. Null when never built or dirty. */
  resultHandle: string | null;
  /** Marks the node as needing rebuild. Set when this node OR any parent
   *  has its params changed. Cleared when rebuild completes. */
  dirty: boolean;
  /** Monotonic creation order — used for stable topo sort tie-breaks. */
  seq: number;
}

export interface FeatureTree {
  nodes: Record<string, FeatureNode>;
  /** Ordered list of root node ids (no parents). */
  roots: string[];
  /** Counter for `seq`. */
  nextSeq: number;
}

export function createFeatureTree(): FeatureTree {
  return { nodes: {}, roots: [], nextSeq: 0 };
}

/** Add a new node. Auto-detects roots; caller passes parent ids if any. */
export function addFeatureNode(
  tree: FeatureTree,
  node: Omit<FeatureNode, 'seq' | 'dirty' | 'resultHandle'> & { resultHandle?: string | null },
): FeatureNode {
  const seq = tree.nextSeq++;
  const full: FeatureNode = {
    ...node,
    seq,
    dirty: false,
    resultHandle: node.resultHandle ?? null,
  };
  tree.nodes[node.id] = full;
  if (node.parents.length === 0) tree.roots.push(node.id);
  return full;
}

/** Look up a node by name. Returns null when not found. */
export function findByName(tree: FeatureTree, name: string): FeatureNode | null {
  for (const n of Object.values(tree.nodes)) {
    if (n.name === name) return n;
  }
  return null;
}

/**
 * Update a parameter on a node. Marks the node and all transitive children
 * dirty. Returns the set of dirty node ids in topological order so the
 * caller can rebuild them in dependency-safe sequence.
 */
export function updateParam(
  tree: FeatureTree,
  nodeId: string,
  key: string,
  value: unknown,
): { ok: true; dirty: string[] } | { ok: false; reason: string } {
  const node = tree.nodes[nodeId];
  if (!node) return { ok: false, reason: `unknown node ${nodeId}` };
  node.params = { ...node.params, [key]: value };
  return { ok: true, dirty: markDirtyDownstream(tree, nodeId) };
}

/** Mark a node + all its descendants dirty. Returns dirty ids in topo order. */
export function markDirtyDownstream(tree: FeatureTree, nodeId: string): string[] {
  const dirty = new Set<string>();
  const stack = [nodeId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (dirty.has(id)) continue;
    dirty.add(id);
    const node = tree.nodes[id];
    if (node) node.dirty = true;
    // Find children: any node that lists `id` as a parent.
    for (const candidate of Object.values(tree.nodes)) {
      if (candidate.parents.includes(id) && !dirty.has(candidate.id)) {
        stack.push(candidate.id);
      }
    }
  }
  return topoOrder(tree, Array.from(dirty));
}

/** Topological order over a subset, parents first. Stable by `seq`. */
export function topoOrder(tree: FeatureTree, ids: string[]): string[] {
  const set = new Set(ids);
  const visited = new Set<string>();
  const result: string[] = [];
  const visit = (id: string): void => {
    if (visited.has(id) || !set.has(id)) return;
    visited.add(id);
    const node = tree.nodes[id];
    if (!node) return;
    for (const p of node.parents) visit(p);
    result.push(id);
  };
  for (const id of ids.slice().sort((a, b) => (tree.nodes[a]?.seq ?? 0) - (tree.nodes[b]?.seq ?? 0))) {
    visit(id);
  }
  return result;
}

/** Mark the dirty flag false after a successful rebuild. */
export function markClean(tree: FeatureTree, nodeId: string, newHandle: string | null): void {
  const node = tree.nodes[nodeId];
  if (!node) return;
  node.dirty = false;
  node.resultHandle = newHandle;
}

/** Remove a node and unparent any children. Returns ids that became roots. */
export function removeNode(tree: FeatureTree, nodeId: string): string[] {
  const node = tree.nodes[nodeId];
  if (!node) return [];
  delete tree.nodes[nodeId];
  tree.roots = tree.roots.filter(r => r !== nodeId);
  const newRoots: string[] = [];
  for (const candidate of Object.values(tree.nodes)) {
    if (candidate.parents.includes(nodeId)) {
      candidate.parents = candidate.parents.filter(p => p !== nodeId);
      if (candidate.parents.length === 0 && !tree.roots.includes(candidate.id)) {
        tree.roots.push(candidate.id);
        newRoots.push(candidate.id);
      }
      // The orphan can't rebuild without its parent — mark dirty.
      candidate.dirty = true;
    }
  }
  return newRoots;
}

/** Compact summary for system-prompt context / debugging. */
export function summarizeTree(tree: FeatureTree): string {
  const lines: string[] = [];
  for (const id of topoOrder(tree, Object.keys(tree.nodes))) {
    const n = tree.nodes[id];
    if (!n) continue;
    const refs = n.parents.length > 0 ? ` ← [${n.parents.join(', ')}]` : '';
    const dirtyMark = n.dirty ? ' *DIRTY*' : '';
    const nameMark = n.name ? ` "${n.name}"` : '';
    lines.push(`  ${id}${nameMark} : ${n.op}${refs}${dirtyMark}`);
  }
  return lines.join('\n');
}
