/**
 * operationOrdering.ts — CAM operation order optimizer.
 *
 * A CAM job for a single part may have 20+ operations: face mill,
 * pocket clear, profile, drill 5 hole sizes, tap, chamfer, finish.
 * The *order* matters for:
 *
 *   - **Tool change minimization** — sequential ops sharing a tool
 *     avoid the ATC dwell time (typically 5-15s per change).
 *   - **Rapid travel minimization** — adjacent ops on the same Z
 *     plane should be grouped to cut air time.
 *   - **Roughing-before-finishing** — finish ops must come last on
 *     each feature so chip-load doesn't deflect the part.
 *   - **Tolerance stack ordering** — datum-A reference cuts come
 *     before datum-A-relative GD&T checks.
 *
 * This module implements a TSP-style ordering with:
 *   - Greedy nearest-neighbour seed
 *   - 2-opt local improvement
 *   - Hard-precedence constraints (e.g. drill before tap)
 *   - Cost model: rapid distance + tool-change penalty
 */

export interface CamOperation {
  id: string;
  /** Tool identifier. Operations sharing a toolId pay no tool-change cost. */
  toolId: string;
  /** Type label for human display. */
  kind: string;
  /** Operation's location in machine coords (start point). */
  startMm: [number, number, number];
  /** Operation's exit point. */
  endMm: [number, number, number];
  /** Hard precedence: this op must run AFTER each of these ids. */
  afterIds?: string[];
  /** Tool-change time penalty in seconds. */
  toolChangeSec?: number;
}

export interface OrderingResult {
  /** Ordered operation ids. */
  order: string[];
  /** Total rapid travel distance (mm). */
  totalRapidMm: number;
  /** Total tool changes. */
  toolChangeCount: number;
  /** Estimated tool-change time (s). */
  toolChangeSec: number;
  /** Total "cost" in seconds (rapid_mm / rapid_rate + tool_change_sec). */
  totalCostSec: number;
  /** True if precedence constraints satisfied. */
  precedenceSatisfied: boolean;
}

export interface OrderingOptions {
  /** Rapid feed rate (mm/sec). Default 500 mm/s. */
  rapidRateMmPerSec: number;
  /** Default tool-change time when not specified per-op (s). Default 8. */
  defaultToolChangeSec: number;
  /** Max 2-opt iterations. Default 100. */
  maxIterations: number;
  /** Optional starting position (e.g. fixture origin). */
  startPosition?: [number, number, number];
}

export const DEFAULT_ORDERING_OPTIONS: OrderingOptions = {
  rapidRateMmPerSec: 500,
  defaultToolChangeSec: 8,
  maxIterations: 100,
};

// ── Top-level entry ─────────────────────────────────────────────

export function optimizeOrder(
  operations: CamOperation[],
  options: Partial<OrderingOptions> = {},
): OrderingResult {
  const opts = { ...DEFAULT_ORDERING_OPTIONS, ...options };
  if (operations.length === 0) {
    return emptyResult();
  }
  // Step 1: greedy nearest-neighbour seed.
  let order = greedyNearestNeighbour(operations, opts);
  // Step 2: enforce precedence.
  order = enforcePrecedence(order, operations);
  // Step 3: 2-opt improvement.
  order = twoOptImprovement(order, operations, opts);
  // Step 4: re-enforce precedence (2-opt may have violated it).
  order = enforcePrecedence(order, operations);

  return evaluateOrder(order, operations, opts);
}

function emptyResult(): OrderingResult {
  return {
    order: [],
    totalRapidMm: 0,
    toolChangeCount: 0,
    toolChangeSec: 0,
    totalCostSec: 0,
    precedenceSatisfied: true,
  };
}

// ── Greedy nearest-neighbour ────────────────────────────────────

export function greedyNearestNeighbour(
  operations: CamOperation[],
  opts: OrderingOptions,
): string[] {
  const remaining = new Set(operations.map(o => o.id));
  const idToOp = new Map(operations.map(o => [o.id, o]));
  const order: string[] = [];
  let pos: [number, number, number] = opts.startPosition ?? [0, 0, 0];
  let lastTool: string | null = null;

  while (remaining.size > 0) {
    let bestId: string | null = null;
    let bestCost = Infinity;
    for (const id of remaining) {
      const op = idToOp.get(id)!;
      const travel = distance(pos, op.startMm);
      const sameTool = lastTool === op.toolId ? 0 : (op.toolChangeSec ?? opts.defaultToolChangeSec);
      const cost = travel / opts.rapidRateMmPerSec + sameTool;
      if (cost < bestCost) {
        bestCost = cost;
        bestId = id;
      }
    }
    if (!bestId) break;
    const op = idToOp.get(bestId)!;
    order.push(bestId);
    remaining.delete(bestId);
    pos = op.endMm;
    lastTool = op.toolId;
  }
  return order;
}

// ── Precedence enforcement ──────────────────────────────────────

export function enforcePrecedence(order: string[], operations: CamOperation[]): string[] {
  const opMap = new Map(operations.map(o => [o.id, o]));
  // Topological sort that prefers the given order as tiebreaker.
  const indegree = new Map<string, number>();
  const dependents = new Map<string, Set<string>>();
  for (const op of operations) {
    indegree.set(op.id, 0);
    dependents.set(op.id, new Set());
  }
  for (const op of operations) {
    for (const before of op.afterIds ?? []) {
      indegree.set(op.id, (indegree.get(op.id) ?? 0) + 1);
      dependents.get(before)?.add(op.id);
    }
  }
  // Schedule.
  const result: string[] = [];
  const seen = new Set<string>();
  // Greedy: iterate in current order, pick the first op whose deps are met.
  let progress = true;
  while (progress && result.length < operations.length) {
    progress = false;
    for (const id of order) {
      if (seen.has(id)) continue;
      const op = opMap.get(id);
      if (!op) continue;
      const deps = op.afterIds ?? [];
      const ok = deps.every(d => seen.has(d));
      if (ok) {
        result.push(id);
        seen.add(id);
        progress = true;
      }
    }
  }
  if (result.length < operations.length) {
    // Cycle or unresolvable; append anything left in original order.
    for (const id of order) if (!seen.has(id)) result.push(id);
  }
  return result;
}

// ── 2-opt improvement ───────────────────────────────────────────

export function twoOptImprovement(
  order: string[],
  operations: CamOperation[],
  opts: OrderingOptions,
): string[] {
  const opMap = new Map(operations.map(o => [o.id, o]));
  let bestOrder = order.slice();
  let bestCost = evaluateOrder(bestOrder, operations, opts).totalCostSec;
  for (let iter = 0; iter < opts.maxIterations; iter++) {
    let improved = false;
    for (let i = 0; i < bestOrder.length - 1; i++) {
      for (let j = i + 1; j < bestOrder.length; j++) {
        const trial = bestOrder.slice();
        // Reverse segment [i..j].
        const segment = trial.slice(i, j + 1).reverse();
        trial.splice(i, j - i + 1, ...segment);
        // Check precedence still holds.
        if (!isPrecedenceValid(trial, opMap)) continue;
        const cost = evaluateOrder(trial, operations, opts).totalCostSec;
        if (cost < bestCost - 1e-6) {
          bestOrder = trial;
          bestCost = cost;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
  return bestOrder;
}

function isPrecedenceValid(order: string[], opMap: Map<string, CamOperation>): boolean {
  const pos = new Map(order.map((id, idx) => [id, idx]));
  for (const id of order) {
    const op = opMap.get(id);
    if (!op || !op.afterIds) continue;
    for (const before of op.afterIds) {
      const bp = pos.get(before);
      if (bp === undefined) continue;
      if (bp >= pos.get(id)!) return false;
    }
  }
  return true;
}

// ── Evaluation ──────────────────────────────────────────────────

export function evaluateOrder(
  order: string[],
  operations: CamOperation[],
  opts: Partial<OrderingOptions> = {},
): OrderingResult {
  const o = { ...DEFAULT_ORDERING_OPTIONS, ...opts };
  const opMap = new Map(operations.map(op => [op.id, op]));
  let totalRapid = 0;
  let toolChanges = 0;
  let toolChangeSec = 0;
  let lastTool: string | null = null;
  let pos: [number, number, number] = o.startPosition ?? [0, 0, 0];
  for (const id of order) {
    const op = opMap.get(id);
    if (!op) continue;
    totalRapid += distance(pos, op.startMm);
    if (lastTool !== null && lastTool !== op.toolId) {
      toolChanges++;
      toolChangeSec += op.toolChangeSec ?? o.defaultToolChangeSec;
    }
    pos = op.endMm;
    lastTool = op.toolId;
  }
  const totalCost = totalRapid / o.rapidRateMmPerSec + toolChangeSec;
  const precedenceSatisfied = isPrecedenceValid(order, opMap);
  return {
    order: order.slice(),
    totalRapidMm: totalRapid,
    toolChangeCount: toolChanges,
    toolChangeSec,
    totalCostSec: totalCost,
    precedenceSatisfied,
  };
}

// ── Grouping by tool ────────────────────────────────────────────

/** Quick alternate: group operations by tool, then nearest-neighbour
 *  within each tool group. Lower tool-change count by construction;
 *  may have higher rapid distance. */
export function orderByToolGroup(operations: CamOperation[], opts: OrderingOptions): string[] {
  const byTool = new Map<string, CamOperation[]>();
  for (const op of operations) {
    if (!byTool.has(op.toolId)) byTool.set(op.toolId, []);
    byTool.get(op.toolId)!.push(op);
  }
  // Within each tool, nearest-neighbour.
  const result: string[] = [];
  let pos: [number, number, number] = opts.startPosition ?? [0, 0, 0];
  // Visit tools in arbitrary order — they're already grouped.
  for (const ops of byTool.values()) {
    const remaining = new Set(ops);
    while (remaining.size > 0) {
      let best: CamOperation | null = null;
      let bestD = Infinity;
      for (const op of remaining) {
        const d = distance(pos, op.startMm);
        if (d < bestD) { bestD = d; best = op; }
      }
      if (!best) break;
      result.push(best.id);
      remaining.delete(best);
      pos = best.endMm;
    }
  }
  return result;
}

// ── Helpers ─────────────────────────────────────────────────────

function distance(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
