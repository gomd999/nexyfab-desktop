/**
 * subAssemblyMotion.ts — Recursive transform update across nested
 * assembly trees.
 *
 * Stage-2 assembly handles single-level mates. SolidWorks parity
 * needs *sub-assemblies* — a top-level mate change cascades down
 * to all nested components. Without this, an arm-on-arm robot
 * model can't be driven from the top joint.
 *
 * Strategy:
 *   - Each assembly node holds a *local* transform (relative to
 *     its parent), plus its own mate constraints.
 *   - On change, we walk the tree depth-first, composing world
 *     transforms as we go.
 *   - Cycle detection — assemblies referencing each other (rare
 *     but possible after copy-paste) abort with a clear error.
 *
 * Transforms are 4×4 matrices in row-major Float64Array form,
 * compatible with three.js Matrix4 and our existing assembly code.
 */

export type Matrix4 = number[]; // 16-length row-major

export interface AssemblyNode {
  id: string;
  /** Local transform relative to parent. Identity for the root. */
  localTransform: Matrix4;
  /** Child node ids — references to other AssemblyNode entries. */
  childIds: string[];
  /** Reference to the file/component this node instantiates. */
  componentRef: string;
  /** Optional flex parameter — set by `flexiblePart.ts` after a
   *  motion update completes (e.g. spring length adapts to mate). */
  flexParams?: Record<string, number>;
}

export interface AssemblyTree {
  rootId: string;
  nodes: Map<string, AssemblyNode>;
}

const IDENTITY_4x4: Matrix4 = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

/** Multiply A · B (both 4×4 row-major). Allocates a new array. */
export function multiplyMat4(a: Matrix4, b: Matrix4): Matrix4 {
  const o: number[] = new Array(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[r * 4 + k]! * b[k * 4 + c]!;
      o[r * 4 + c] = s;
    }
  }
  return o;
}

export interface WorldTransformResult {
  /** Per-node world transform. */
  worldTransforms: Map<string, Matrix4>;
  /** Depth of each node (root = 0). */
  depths: Map<string, number>;
  /** Cycle path when detected, else null. */
  cycleDetected: string[] | null;
}

/** Compute world transforms for every node, walking depth-first
 *  from the root. */
export function computeWorldTransforms(tree: AssemblyTree): WorldTransformResult {
  const worldTransforms = new Map<string, Matrix4>();
  const depths = new Map<string, number>();
  let cycleDetected: string[] | null = null;

  const visiting = new Set<string>(); // current DFS stack
  const path: string[] = [];

  function visit(nodeId: string, parentWorld: Matrix4, depth: number): void {
    if (visiting.has(nodeId)) {
      // Found a cycle. Record the path from cycle start to now.
      const start = path.indexOf(nodeId);
      cycleDetected = path.slice(start).concat(nodeId);
      return;
    }
    const node = tree.nodes.get(nodeId);
    if (!node) return;
    visiting.add(nodeId);
    path.push(nodeId);

    const world = multiplyMat4(parentWorld, node.localTransform);
    worldTransforms.set(nodeId, world);
    depths.set(nodeId, depth);

    for (const childId of node.childIds) {
      visit(childId, world, depth + 1);
      if (cycleDetected) break;
    }

    visiting.delete(nodeId);
    path.pop();
  }

  visit(tree.rootId, IDENTITY_4x4, 0);
  return { worldTransforms, depths, cycleDetected };
}

/** Update a single node's local transform and return all nodes
 *  whose world transform changes as a result (the subtree).
 *  Convenience for UI updates — caller can re-render just these
 *  nodes rather than the whole tree. */
export function applyLocalTransformDelta(
  tree: AssemblyTree,
  nodeId: string,
  newLocal: Matrix4,
): string[] {
  const node = tree.nodes.get(nodeId);
  if (!node) return [];
  node.localTransform = newLocal;
  // Collect subtree.
  const affected: string[] = [];
  const stack: string[] = [nodeId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    affected.push(id);
    const n = tree.nodes.get(id);
    if (n) stack.push(...n.childIds);
  }
  return affected;
}

/** Build an empty 4x4 identity matrix (helper). */
export function identityMatrix(): Matrix4 {
  return IDENTITY_4x4.slice();
}
