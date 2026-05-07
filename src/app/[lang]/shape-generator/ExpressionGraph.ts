/**
 * Expression Dependency Graph
 *
 * Builds a directed acyclic graph (DAG) of parametric dependencies
 * from a set of paramExpressions. Enables:
 *
 *  - Topological-order evaluation (each param resolved after its deps)
 *  - Cycle detection with clear error reporting
 *  - Incremental re-evaluation: only params downstream of a changed value
 *    are recalculated
 *  - "Impact analysis": given a changed param name, find all params that
 *    will change as a result
 *
 * This module is framework-free (no React) so it can also run in a Worker.
 *
 * Relation to ExpressionEngine.ts:
 *  - ExpressionEngine.ts handles *parsing* single expressions.
 *  - This module handles the *topology* of the full parameter graph.
 */

import { evaluateExpression, extractIdentifiers } from './ExpressionEngine';
import type { ExprVariable } from './ExpressionEngine';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ExprNode {
  /** Parameter key (e.g. "width", "radius", "feature.fillet.radius") */
  key: string;
  /** Raw expression string or numeric literal */
  expression: string;
  /** Keys this node directly depends on */
  deps: string[];
  /** Keys that depend on this node (reverse edges) */
  dependents: string[];
}

export interface ExprGraph {
  /** All nodes keyed by param name */
  nodes: Record<string, ExprNode>;
  /** Topological evaluation order (leaves first) */
  evalOrder: string[];
  /** Any cycle warnings detected during build */
  cycleWarnings: string[];
}

export interface PropagationResult {
  /** Updated values for all parameters */
  resolved: Record<string, number>;
  /** Keys that changed compared to previous values */
  changed: string[];
  /** Errors per key, if any expression failed to evaluate */
  errors: Record<string, string>;
}

// ─── Graph construction ───────────────────────────────────────────────────────

/**
 * Build an expression dependency graph from a paramExpressions map.
 *
 * @param expressions  Map of param key → expression string (or numeric string)
 * @param knownKeys    Additional keys in scope that are not expressions
 *                     (e.g. shape primitive params resolved elsewhere)
 */
export function buildExprGraph(
  expressions: Record<string, string>,
  knownKeys: string[] = [],
): ExprGraph {
  const allKeys = new Set([...Object.keys(expressions), ...knownKeys]);
  const nodes: Record<string, ExprNode> = {};
  const cycleWarnings: string[] = [];

  // Build nodes
  for (const [key, expr] of Object.entries(expressions)) {
    const rawDeps = extractIdentifiers(expr).filter((id: string) => allKeys.has(id));
    nodes[key] = { key, expression: expr, deps: rawDeps, dependents: [] };
  }

  // Wire reverse edges
  for (const node of Object.values(nodes)) {
    for (const dep of node.deps) {
      if (nodes[dep]) {
        nodes[dep].dependents.push(node.key);
      }
    }
  }

  // Topological sort via Kahn's algorithm
  const inDegree: Record<string, number> = {};
  for (const node of Object.values(nodes)) {
    inDegree[node.key] = node.deps.filter(d => d in nodes).length;
  }

  const queue = Object.keys(nodes).filter(k => inDegree[k] === 0);
  const evalOrder: string[] = [];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const key = queue.shift()!;
    if (visited.has(key)) continue;
    visited.add(key);
    evalOrder.push(key);

    for (const dep of nodes[key]?.dependents ?? []) {
      inDegree[dep] = (inDegree[dep] ?? 1) - 1;
      if (inDegree[dep] === 0) queue.push(dep);
    }
  }

  // Any node not in evalOrder is part of a cycle
  const cycleNodes = Object.keys(nodes).filter(k => !visited.has(k));
  if (cycleNodes.length > 0) {
    cycleWarnings.push(`Circular dependency detected among: ${cycleNodes.join(', ')}`);
    // Append cycle nodes at end so evaluation still proceeds (with stale values)
    evalOrder.push(...cycleNodes);
  }

  return { nodes, evalOrder, cycleWarnings };
}

// ─── Evaluation ──────────────────────────────────────────────────────────────

/**
 * Evaluate all expressions in the graph, returning resolved numeric values.
 *
 * @param graph       Dependency graph from buildExprGraph
 * @param baseValues  Pre-resolved numeric values (shape primitive params, etc.)
 * @param prevValues  Previous resolved values for change detection
 */
export function evaluateGraph(
  graph: ExprGraph,
  baseValues: Record<string, number> = {},
  prevValues: Record<string, number> = {},
): PropagationResult {
  const resolved: Record<string, number> = { ...baseValues };
  const errors: Record<string, string> = {};
  const CHANGE_TOL = 1e-9;

  for (const key of graph.evalOrder) {
    const node = graph.nodes[key];
    if (!node) continue;

    const variables: ExprVariable[] = Object.entries(resolved).map(([name, value]) => ({
      name,
      value,
    }));

    try {
      const val = evaluateExpression(node.expression, variables);
      resolved[key] = val;
    } catch (err) {
      errors[key] = err instanceof Error ? err.message : String(err);
      // Use previous value as fallback to avoid cascade failures
      if (key in prevValues) resolved[key] = prevValues[key];
    }
  }

  // Detect changed keys
  const changed = Object.keys(resolved).filter(key => {
    const prev = prevValues[key];
    const curr = resolved[key];
    return prev === undefined || Math.abs((curr ?? 0) - prev) > CHANGE_TOL;
  });

  return { resolved, changed, errors };
}

// ─── Incremental propagation ──────────────────────────────────────────────────

/**
 * Given a set of changed keys, return all downstream (dependent) keys
 * that need to be re-evaluated in topological order.
 *
 * Use this to build a minimal re-evaluation set when the user changes
 * a single parameter — avoids re-running the full graph.
 */
export function getAffectedKeys(
  graph: ExprGraph,
  changedKeys: string[],
): string[] {
  const affected = new Set<string>(changedKeys);
  const queue = [...changedKeys];

  while (queue.length > 0) {
    const key = queue.shift()!;
    for (const dep of graph.nodes[key]?.dependents ?? []) {
      if (!affected.has(dep)) {
        affected.add(dep);
        queue.push(dep);
      }
    }
  }

  // Return in topological order (graph.evalOrder is already sorted)
  return graph.evalOrder.filter(k => affected.has(k));
}

/**
 * Re-evaluate only the affected subgraph after a set of values change.
 * More efficient than evaluateGraph for interactive editing.
 */
export function propagateChanges(
  graph: ExprGraph,
  changedKeys: string[],
  currentValues: Record<string, number>,
  baseValues: Record<string, number> = {},
): PropagationResult {
  const affectedKeys = getAffectedKeys(graph, changedKeys);
  const merged = { ...baseValues, ...currentValues };
  const errors: Record<string, string> = {};
  const CHANGE_TOL = 1e-9;

  for (const key of affectedKeys) {
    const node = graph.nodes[key];
    if (!node) continue;

    const variables: ExprVariable[] = Object.entries(merged).map(([name, value]) => ({
      name,
      value,
    }));

    try {
      const val = evaluateExpression(node.expression, variables);
      merged[key] = val;
    } catch (err) {
      errors[key] = err instanceof Error ? err.message : String(err);
    }
  }

  const changed = affectedKeys.filter(key => {
    const prev = currentValues[key];
    const curr = merged[key];
    return prev === undefined || Math.abs((curr ?? 0) - prev) > CHANGE_TOL;
  });

  return { resolved: merged, changed, errors };
}

// ─── Analysis utilities ──────────────────────────────────────────────────────

/**
 * Returns the "critical path" — the longest dependency chain in the graph.
 * Useful for identifying params that have the broadest downstream impact.
 */
export function findCriticalPath(graph: ExprGraph): string[] {
  const depth: Record<string, number> = {};
  const parent: Record<string, string | null> = {};

  const getDepth = (key: string): number => {
    if (key in depth) return depth[key];
    const node = graph.nodes[key];
    if (!node || node.deps.length === 0) {
      depth[key] = 0;
      parent[key] = null;
      return 0;
    }
    let maxDep = 0;
    let bestParent: string | null = null;
    for (const dep of node.deps) {
      const d = getDepth(dep) + 1;
      if (d > maxDep) { maxDep = d; bestParent = dep; }
    }
    depth[key] = maxDep;
    parent[key] = bestParent;
    return maxDep;
  };

  for (const key of Object.keys(graph.nodes)) getDepth(key);

  // Find deepest node
  let deepestKey = '';
  let maxDepth = 0;
  for (const [key, d] of Object.entries(depth)) {
    if (d > maxDepth) { maxDepth = d; deepestKey = key; }
  }

  // Trace path back to root
  const path: string[] = [];
  let cur: string | null = deepestKey;
  while (cur !== null) {
    path.unshift(cur);
    cur = parent[cur] ?? null;
  }
  return path;
}

/**
 * Summarise a dependency graph for display.
 */
export function summariseGraph(graph: ExprGraph): {
  nodeCount: number;
  edgeCount: number;
  maxDepth: number;
  cycleCount: number;
  roots: string[];
  leaves: string[];
} {
  const edgeCount = Object.values(graph.nodes).reduce(
    (s, n) => s + n.deps.length, 0
  );
  const roots = Object.values(graph.nodes)
    .filter(n => n.deps.length === 0)
    .map(n => n.key);
  const leaves = Object.values(graph.nodes)
    .filter(n => n.dependents.length === 0)
    .map(n => n.key);
  const criticalPath = findCriticalPath(graph);
  return {
    nodeCount: Object.keys(graph.nodes).length,
    edgeCount,
    maxDepth: criticalPath.length - 1,
    cycleCount: graph.cycleWarnings.length,
    roots,
    leaves,
  };
}
