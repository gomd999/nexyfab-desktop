/**
 * constraintPropagation.ts — Track dependency graph between sketch
 * constraints + dimensions, propagate changes.
 *
 * When a designer edits a single dimension (e.g. "make slot length
 * 50mm"), the constraint solver must figure out which other sketch
 * entities move. We pre-build a dependency graph so the change
 * propagation is fast (no full re-solve unless needed).
 *
 *   - **Nodes**: sketch entities (points, lines, arcs) and dimensions
 *     (driving + driven values).
 *   - **Edges**: "this entity's position depends on that constraint
 *     being satisfied". Built by inspecting each constraint's
 *     `entityIds`.
 *
 * Topological sort gives the propagation order. Cycles are flagged
 * as over-constrained.
 */

export interface ConstraintNode {
  id: string;
  /** Constraint kind. */
  kind: string;
  /** Entity ids this constraint applies to. */
  entityIds: string[];
  /** True for a driving dimension (drives geometry). */
  driving: boolean;
}

export interface EntityNode {
  id: string;
  /** Entity kind. */
  kind: 'point' | 'line' | 'arc' | 'circle';
}

export interface DependencyGraph {
  entities: Map<string, EntityNode>;
  constraints: Map<string, ConstraintNode>;
  /** For each entity, which constraints reference it. */
  entityToConstraints: Map<string, Set<string>>;
}

export function buildGraph(entities: EntityNode[], constraints: ConstraintNode[]): DependencyGraph {
  const eMap = new Map<string, EntityNode>();
  const cMap = new Map<string, ConstraintNode>();
  const e2c = new Map<string, Set<string>>();
  for (const e of entities) {
    eMap.set(e.id, e);
    e2c.set(e.id, new Set());
  }
  for (const c of constraints) {
    cMap.set(c.id, c);
    for (const eid of c.entityIds) {
      if (!e2c.has(eid)) e2c.set(eid, new Set());
      e2c.get(eid)!.add(c.id);
    }
  }
  return { entities: eMap, constraints: cMap, entityToConstraints: e2c };
}

// ── Propagation ────────────────────────────────────────────────

export interface PropagationResult {
  /** Entities that need re-solving in order. */
  affectedEntities: string[];
  /** Constraints touched during propagation. */
  visitedConstraints: string[];
  /** Cycle detected? */
  hasCycle: boolean;
}

/** Compute the propagation closure starting from a changed entity.
 *  Visits all constraints referencing the entity, then all other entities
 *  in those constraints, breadth-first. */
export function propagateChange(graph: DependencyGraph, startEntityId: string): PropagationResult {
  const visitedEntities = new Set<string>([startEntityId]);
  const visitedConstraints = new Set<string>();
  const queue = [startEntityId];
  while (queue.length > 0) {
    const eid = queue.shift()!;
    const constraints = graph.entityToConstraints.get(eid);
    if (!constraints) continue;
    for (const cid of constraints) {
      if (visitedConstraints.has(cid)) continue;
      visitedConstraints.add(cid);
      const constraint = graph.constraints.get(cid);
      if (!constraint) continue;
      for (const otherE of constraint.entityIds) {
        if (otherE === eid) continue;
        if (!visitedEntities.has(otherE)) {
          visitedEntities.add(otherE);
          queue.push(otherE);
        }
      }
    }
  }
  // For the change-from-start cycle, we check via topological sort.
  const cycle = hasCycleInSubgraph(graph, visitedEntities);
  return {
    affectedEntities: [...visitedEntities],
    visitedConstraints: [...visitedConstraints],
    hasCycle: cycle,
  };
}

function hasCycleInSubgraph(graph: DependencyGraph, entityIds: Set<string>): boolean {
  // Simple cycle detection: count edges within subgraph; if # > # entities, cycle exists.
  const entityCount = entityIds.size;
  let edgeCount = 0;
  const seenC = new Set<string>();
  for (const eid of entityIds) {
    const cs = graph.entityToConstraints.get(eid);
    if (!cs) continue;
    for (const cid of cs) {
      if (seenC.has(cid)) continue;
      seenC.add(cid);
      const c = graph.constraints.get(cid);
      if (!c) continue;
      const interior = c.entityIds.filter(e => entityIds.has(e)).length;
      if (interior >= 2) edgeCount += interior - 1;
    }
  }
  return edgeCount >= entityCount;
}

// ── Topological order for solving ──────────────────────────────

export interface SolveOrder {
  /** Entities in order they should be re-solved. */
  order: string[];
  /** Nodes that participate in a cycle (over-constrained). */
  cycleNodes: string[];
}

export function topologicalSolveOrder(graph: DependencyGraph): SolveOrder {
  // Build entity→entity edges via shared constraints.
  const adjacency = new Map<string, Set<string>>();
  for (const e of graph.entities.values()) adjacency.set(e.id, new Set());
  for (const c of graph.constraints.values()) {
    if (!c.driving) continue;
    // A driving constraint creates dependencies from its first entity
    // to the rest (caller can refine later).
    const [first, ...rest] = c.entityIds;
    if (!first) continue;
    for (const r of rest) adjacency.get(first)!.add(r);
  }
  // Kahn's algorithm.
  const indegree = new Map<string, number>();
  for (const e of graph.entities.values()) indegree.set(e.id, 0);
  for (const [, neighbors] of adjacency) {
    for (const n of neighbors) indegree.set(n, (indegree.get(n) ?? 0) + 1);
  }
  const order: string[] = [];
  const queue: string[] = [];
  for (const [id, d] of indegree) if (d === 0) queue.push(id);
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const n of adjacency.get(id) ?? []) {
      const d = (indegree.get(n) ?? 0) - 1;
      indegree.set(n, d);
      if (d === 0) queue.push(n);
    }
  }
  const cycleNodes: string[] = [];
  for (const [id, d] of indegree) if (d > 0) cycleNodes.push(id);
  return { order, cycleNodes };
}

// ── Over-constraint detection ──────────────────────────────────

export interface OverConstraintReport {
  /** Total DOF used by driving constraints. */
  drivingDof: number;
  /** Estimated DOF the entities provide. */
  availableDof: number;
  /** True if driving DOF > available. */
  overConstrained: boolean;
  /** Suggested constraints to drop. */
  suggestDropIds: string[];
}

const DOF_PER_ENTITY: Record<EntityNode['kind'], number> = {
  point: 2,
  line: 4,
  arc: 5,
  circle: 3,
};

const DOF_PER_CONSTRAINT_KIND: Record<string, number> = {
  coincident: 2,
  horizontal: 1,
  vertical: 1,
  parallel: 1,
  perpendicular: 1,
  tangent: 1,
  'equal-length': 1,
  'equal-radius': 1,
  distance: 1,
  angle: 1,
  radius: 1,
  diameter: 1,
};

export function analyzeOverConstraint(graph: DependencyGraph): OverConstraintReport {
  let available = 0;
  for (const e of graph.entities.values()) {
    available += DOF_PER_ENTITY[e.kind] ?? 2;
  }
  let used = 0;
  const drivingConstraints: ConstraintNode[] = [];
  for (const c of graph.constraints.values()) {
    if (c.driving) {
      drivingConstraints.push(c);
      used += DOF_PER_CONSTRAINT_KIND[c.kind] ?? 1;
    }
  }
  const overConstrained = used > available;
  const suggestDropIds: string[] = [];
  if (overConstrained) {
    // Suggest dropping low-priority constraints (longest-defined first).
    const excess = used - available;
    const sorted = drivingConstraints.slice().sort((a, b) => (DOF_PER_CONSTRAINT_KIND[a.kind] ?? 1) - (DOF_PER_CONSTRAINT_KIND[b.kind] ?? 1));
    let removed = 0;
    for (const c of sorted) {
      if (removed >= excess) break;
      suggestDropIds.push(c.id);
      removed += DOF_PER_CONSTRAINT_KIND[c.kind] ?? 1;
    }
  }
  return {
    drivingDof: used,
    availableDof: available,
    overConstrained,
    suggestDropIds,
  };
}

// ── Stats ───────────────────────────────────────────────────────

export interface GraphStats {
  entityCount: number;
  constraintCount: number;
  drivingCount: number;
  averageEntityConstraints: number;
}

export function summarize(graph: DependencyGraph): GraphStats {
  let driving = 0;
  for (const c of graph.constraints.values()) if (c.driving) driving++;
  let totalRefs = 0;
  for (const set of graph.entityToConstraints.values()) totalRefs += set.size;
  return {
    entityCount: graph.entities.size,
    constraintCount: graph.constraints.size,
    drivingCount: driving,
    averageEntityConstraints: graph.entities.size > 0 ? totalRefs / graph.entities.size : 0,
  };
}
