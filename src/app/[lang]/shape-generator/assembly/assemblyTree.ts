/**
 * assemblyTree.ts — Nested (sub-)assembly hierarchy.
 *
 * Until now the AssemblyState was a flat list of bodies + mates. That
 * suffices for single-level designs but breaks down on assemblies that
 * use repeated sub-assemblies — a `wheel` containing hub + spokes + rim
 * referenced four times by a `car` assembly should not require the user
 * to manually paste 4 × (1 + N + 1) = many bodies and redo all mates.
 *
 * **Tree shape**:
 *   - **Leaf**: a single `AssemblyBody`.
 *   - **Group**: a node with its own pose plus N children (leaves or
 *     other groups). The group's pose composes into every descendant
 *     during flattening.
 *
 * **Flattening** walks the tree depth-first, multiplying transforms
 * down the chain. The output is a flat `AssemblyBody[]` ready to feed
 * into the existing `solveAssembly` pipeline — so the new hierarchy
 * is purely a data-organisation layer; the solver does not need to
 * change.
 *
 * **Cycle defence**: groups are referenced by identity (object refs).
 * Flattening detects a node being its own ancestor via a visited-set
 * and emits an empty subtree there, preventing infinite recursion when
 * the user mis-wires a reference.
 */

import * as THREE from 'three';
import type { AssemblyBody } from './matesSolver';

export interface AssemblyGroupNode {
  kind: 'group';
  /** Human-readable label for this sub-assembly. */
  name: string;
  /** Group-local pose. Composes into children. */
  position: THREE.Vector3;
  rotation: THREE.Euler;
  /** Children — leaves or further groups. */
  children: AssemblyTreeNode[];
}

export interface AssemblyLeafNode {
  kind: 'leaf';
  body: AssemblyBody;
}

export type AssemblyTreeNode = AssemblyGroupNode | AssemblyLeafNode;

/** Bundle the flattened body list with any diagnostic data the caller
 *  might want — currently just the count of cycles detected during the
 *  walk (zero on healthy trees). */
export interface FlattenResult {
  bodies: AssemblyBody[];
  cyclesDetected: number;
}

function composeMatrix(position: THREE.Vector3, rotation: THREE.Euler): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    position,
    new THREE.Quaternion().setFromEuler(rotation),
    new THREE.Vector3(1, 1, 1),
  );
}

function applyMatrixToBody(body: AssemblyBody, matrix: THREE.Matrix4, namePath: string): AssemblyBody {
  // Compose the existing body transform with the matrix, then decompose
  // into position + rotation. We use a separate THREE.Matrix4 instead
  // of mutating the inputs so the original tree is not modified.
  const localMat = composeMatrix(body.position, body.rotation);
  const worldMat = new THREE.Matrix4().multiplyMatrices(matrix, localMat);
  const newPos = new THREE.Vector3();
  const newQuat = new THREE.Quaternion();
  const newScale = new THREE.Vector3();
  worldMat.decompose(newPos, newQuat, newScale);
  return {
    name: namePath ? `${namePath}/${body.name}` : body.name,
    position: newPos,
    rotation: new THREE.Euler().setFromQuaternion(newQuat),
    fixed: body.fixed,
    geometry: body.geometry,
  };
}

/**
 * Walk the tree depth-first and emit every leaf body with its composed
 * world-space transform. Group nodes contribute their own pose to all
 * descendants. Cycles (a node containing itself directly or indirectly)
 * are skipped and counted in the result.
 */
export function flattenTree(root: AssemblyTreeNode): FlattenResult {
  const out: AssemblyBody[] = [];
  let cyclesDetected = 0;
  const visiting = new Set<AssemblyTreeNode>();

  function recurse(node: AssemblyTreeNode, parentMatrix: THREE.Matrix4, namePath: string): void {
    if (visiting.has(node)) {
      cyclesDetected++;
      return;
    }
    visiting.add(node);
    if (node.kind === 'leaf') {
      out.push(applyMatrixToBody(node.body, parentMatrix, namePath));
    } else {
      const localMatrix = composeMatrix(node.position, node.rotation);
      const groupMatrix = new THREE.Matrix4().multiplyMatrices(parentMatrix, localMatrix);
      const childPath = namePath ? `${namePath}/${node.name}` : node.name;
      for (const child of node.children) {
        recurse(child, groupMatrix, childPath);
      }
    }
    visiting.delete(node);
  }

  recurse(root, new THREE.Matrix4().identity(), '');
  return { bodies: out, cyclesDetected };
}

/** Count leaf nodes in a tree without flattening transforms — useful
 *  for UI badges (`Wheel (5 parts)`) without doing the matrix math. */
export function countLeaves(node: AssemblyTreeNode): number {
  if (node.kind === 'leaf') return 1;
  let n = 0;
  for (const c of node.children) n += countLeaves(c);
  return n;
}

/** Build a leaf node from an existing AssemblyBody. */
export function leaf(body: AssemblyBody): AssemblyLeafNode {
  return { kind: 'leaf', body };
}

/** Build a group node with optional pose (defaults to identity). */
export function group(
  name: string,
  children: AssemblyTreeNode[],
  pose: { position?: THREE.Vector3; rotation?: THREE.Euler } = {},
): AssemblyGroupNode {
  return {
    kind: 'group',
    name,
    position: pose.position ?? new THREE.Vector3(),
    rotation: pose.rotation ?? new THREE.Euler(),
    children,
  };
}
