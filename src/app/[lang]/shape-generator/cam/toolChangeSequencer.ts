/**
 * toolChangeSequencer.ts — Minimize tool changes in a CNC operation
 * sequence.
 *
 * A NC job has N operations, each requiring a specific tool. The
 * raw order from the CAM (machining order optimized for chip
 * removal) may have many tool changes (op1 with T1, op2 with T2,
 * op3 with T1, op4 with T2…) which wastes 30 seconds each.
 *
 * Without breaking machining dependencies, can we reorder
 * operations to *group consecutive same-tool ops*?
 *
 * This module models operations + their dependencies + tools, and
 * uses a greedy heuristic + dependency-aware scheduling:
 *
 *   1. Topological order satisfies dependencies.
 *   2. Within the topological order, prefer the next op that uses
 *      the currently loaded tool.
 *   3. Fall back to a fresh tool when forced.
 *
 * Output: reordered op sequence + tool change count + saved time.
 */

export interface Operation {
  id: string;
  /** Tool id required for this op. */
  toolId: string;
  /** Op duration, sec (informational). */
  durationSec: number;
  /** Op ids that must complete before this op. */
  dependencies: string[];
}

export interface ScheduleResult {
  /** Ordered op ids. */
  order: string[];
  /** Tool changes between consecutive ops (i.e., toolId changes). */
  toolChangeCount: number;
  /** Initial tool load doesn't count; changes between ops do. */
  totalToolChangeSec: number;
  /** Comparison with input order (no reordering). */
  comparisonInputChanges: number;
  /** Did dependency resolution succeed (no cycles)? */
  scheduledAll: boolean;
}

export interface ScheduleOptions {
  /** Tool change time, sec. */
  toolChangeSec: number;
}

export const DEFAULT_OPTIONS: ScheduleOptions = {
  toolChangeSec: 30,
};

// ── Top-level entry ────────────────────────────────────────────

export function sequenceOperations(ops: Operation[], options: Partial<ScheduleOptions> = {}): ScheduleResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  if (ops.length === 0) {
    return {
      order: [],
      toolChangeCount: 0,
      totalToolChangeSec: 0,
      comparisonInputChanges: 0,
      scheduledAll: true,
    };
  }

  // Build dependency graph.
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const op of ops) {
    indeg.set(op.id, 0);
    adj.set(op.id, []);
  }
  for (const op of ops) {
    for (const d of op.dependencies) {
      if (!indeg.has(d)) continue;
      adj.get(d)!.push(op.id);
      indeg.set(op.id, (indeg.get(op.id) ?? 0) + 1);
    }
  }

  const opMap = new Map(ops.map(o => [o.id, o]));
  const ready = new Set<string>();
  for (const [id, n] of indeg) {
    if (n === 0) ready.add(id);
  }

  const order: string[] = [];
  let currentTool: string | null = null;
  let changes = 0;
  while (ready.size > 0) {
    // Prefer an op that uses currentTool; otherwise pick any (deterministic by id).
    let chosen: string | null = null;
    if (currentTool !== null) {
      for (const id of ready) {
        if (opMap.get(id)!.toolId === currentTool) {
          chosen = id;
          break;
        }
      }
    }
    if (chosen === null) {
      // Pick lexicographically smallest for determinism.
      chosen = [...ready].sort()[0]!;
      if (currentTool !== null && opMap.get(chosen)!.toolId !== currentTool) changes++;
    }
    order.push(chosen);
    const nextTool = opMap.get(chosen)!.toolId;
    currentTool = nextTool;
    ready.delete(chosen);
    for (const n of adj.get(chosen) ?? []) {
      indeg.set(n, (indeg.get(n) ?? 0) - 1);
      if (indeg.get(n) === 0) ready.add(n);
    }
  }

  // Compare with input order.
  let inputChanges = 0;
  for (let i = 1; i < ops.length; i++) {
    if (ops[i]!.toolId !== ops[i - 1]!.toolId) inputChanges++;
  }

  return {
    order,
    toolChangeCount: changes,
    totalToolChangeSec: changes * opts.toolChangeSec,
    comparisonInputChanges: inputChanges,
    scheduledAll: order.length === ops.length,
  };
}

// ── Tool-load report ──────────────────────────────────────────

export interface ToolUsage {
  toolId: string;
  opCount: number;
  totalDurationSec: number;
}

export function reportToolUsage(ops: Operation[]): ToolUsage[] {
  const map = new Map<string, ToolUsage>();
  for (const op of ops) {
    const existing = map.get(op.toolId) ?? { toolId: op.toolId, opCount: 0, totalDurationSec: 0 };
    existing.opCount++;
    existing.totalDurationSec += op.durationSec;
    map.set(op.toolId, existing);
  }
  return [...map.values()].sort((a, b) => b.totalDurationSec - a.totalDurationSec);
}

// ── Summary ────────────────────────────────────────────────────

export interface SequenceSummary {
  operationCount: number;
  uniqueToolCount: number;
  toolChangesSaved: number;
  timeSavedSec: number;
}

export function summarize(ops: Operation[], result: ScheduleResult, options: Partial<ScheduleOptions> = {}): SequenceSummary {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const unique = new Set(ops.map(o => o.toolId)).size;
  const saved = result.comparisonInputChanges - result.toolChangeCount;
  return {
    operationCount: ops.length,
    uniqueToolCount: unique,
    toolChangesSaved: saved,
    timeSavedSec: saved * opts.toolChangeSec,
  };
}
