/**
 * csgHistoryReplay.ts — Replay a CSG operation history.
 *
 * Beyond per-feature suppression states (`features/suppressionStates`),
 * users sometimes need to replay the *sequence* of CSG operations
 * that built the model: union → fillet → mirror → pattern. Useful
 * for:
 *
 *   - **Time-travel debugging** — "the part broke after step 7;
 *     what was the model like at step 6?".
 *   - **Macro recording** — capture a sequence, parameterize, replay
 *     for variants.
 *   - **Audit trails** — show clients every operation that produced
 *     the current geometry.
 *
 * Records:
 *
 *   - `OperationLog` — ordered list of CSG ops with timestamps + params.
 *   - **Replay** evaluates ops up to a target step.
 *   - **Diff** compares two histories to highlight what changed.
 *   - **Compress** removes no-op or redundant operations.
 */

export type CsgOpKind = 'union' | 'subtract' | 'intersect' | 'fillet' | 'chamfer' | 'mirror' | 'pattern' | 'shell' | 'extrude' | 'revolve';

export interface CsgOperation {
  id: string;
  kind: CsgOpKind;
  /** Parameter blob (kind-specific). */
  params: Record<string, unknown>;
  /** Timestamp (ms epoch). */
  timestamp: number;
  /** Notes / annotations (for audit). */
  notes?: string;
}

export interface OperationLog {
  /** Operations in chronological order. */
  operations: CsgOperation[];
  /** Version number to support schema migrations. */
  version: number;
}

// ── Log management ─────────────────────────────────────────────

export function createLog(): OperationLog {
  return { operations: [], version: 1 };
}

export function appendOperation(log: OperationLog, op: Omit<CsgOperation, 'timestamp'>): CsgOperation {
  const stamped: CsgOperation = { ...op, timestamp: Date.now() };
  log.operations.push(stamped);
  return stamped;
}

// ── Replay ────────────────────────────────────────────────────

export interface ReplayHandler<TModel> {
  /** Starting model state. */
  initial: () => TModel;
  /** Apply one operation to the model. */
  apply: (model: TModel, op: CsgOperation) => TModel;
}

export interface ReplayOptions {
  /** Stop after this many operations (inclusive). -1 = all. */
  stopAtIndex: number;
  /** Skip operations whose ids are in this set. */
  skipIds: Set<string>;
}

export const DEFAULT_REPLAY_OPTIONS: ReplayOptions = {
  stopAtIndex: -1,
  skipIds: new Set(),
};

export interface ReplayResult<TModel> {
  model: TModel;
  /** Number of operations actually applied. */
  appliedCount: number;
  /** Operations that errored. */
  failedOps: Array<{ op: CsgOperation; error: string }>;
  /** Wall-clock elapsed (ms). */
  elapsedMs: number;
}

export function replay<TModel>(log: OperationLog, handler: ReplayHandler<TModel>, options: Partial<ReplayOptions> = {}): ReplayResult<TModel> {
  const opts = { ...DEFAULT_REPLAY_OPTIONS, ...options };
  const start = nowMs();
  let model = handler.initial();
  let applied = 0;
  const failed: Array<{ op: CsgOperation; error: string }> = [];

  const upTo = opts.stopAtIndex < 0 ? log.operations.length - 1 : opts.stopAtIndex;
  for (let i = 0; i <= upTo && i < log.operations.length; i++) {
    const op = log.operations[i]!;
    if (opts.skipIds.has(op.id)) continue;
    try {
      model = handler.apply(model, op);
      applied++;
    } catch (e) {
      failed.push({ op, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return {
    model,
    appliedCount: applied,
    failedOps: failed,
    elapsedMs: nowMs() - start,
  };
}

// ── Time-travel snapshot capture ──────────────────────────────

export interface Snapshot<TModel> {
  /** Operation index after which this snapshot was taken. */
  afterIndex: number;
  /** Model state. */
  state: TModel;
  /** Optional clone function (else assumes immutable state). */
}

/** Replay and capture intermediate snapshots at specified indices.
 *  Snapshots cost memory; caller picks key-frame indices. */
export function replayWithSnapshots<TModel>(
  log: OperationLog,
  handler: ReplayHandler<TModel>,
  snapshotAtIndices: number[],
  options: Partial<ReplayOptions> = {},
): { result: ReplayResult<TModel>; snapshots: Snapshot<TModel>[] } {
  const opts = { ...DEFAULT_REPLAY_OPTIONS, ...options };
  const start = nowMs();
  let model = handler.initial();
  const snapshots: Snapshot<TModel>[] = [];
  const targetSet = new Set(snapshotAtIndices);
  let applied = 0;
  const failed: Array<{ op: CsgOperation; error: string }> = [];
  const upTo = opts.stopAtIndex < 0 ? log.operations.length - 1 : opts.stopAtIndex;
  for (let i = 0; i <= upTo && i < log.operations.length; i++) {
    const op = log.operations[i]!;
    if (opts.skipIds.has(op.id)) continue;
    try {
      model = handler.apply(model, op);
      applied++;
    } catch (e) {
      failed.push({ op, error: e instanceof Error ? e.message : String(e) });
    }
    if (targetSet.has(i)) {
      snapshots.push({ afterIndex: i, state: model });
    }
  }
  return {
    result: { model, appliedCount: applied, failedOps: failed, elapsedMs: nowMs() - start },
    snapshots,
  };
}

// ── Diff between two logs ─────────────────────────────────────

export interface LogDiff {
  /** Operations present in B but not A. */
  added: CsgOperation[];
  /** Operations present in A but not B. */
  removed: CsgOperation[];
  /** Operations in both but with different params (by JSON match). */
  modified: Array<{ before: CsgOperation; after: CsgOperation }>;
}

export function diffLogs(a: OperationLog, b: OperationLog): LogDiff {
  const aById = new Map(a.operations.map(op => [op.id, op]));
  const bById = new Map(b.operations.map(op => [op.id, op]));
  const added: CsgOperation[] = [];
  const removed: CsgOperation[] = [];
  const modified: Array<{ before: CsgOperation; after: CsgOperation }> = [];
  for (const op of b.operations) {
    const inA = aById.get(op.id);
    if (!inA) added.push(op);
    else if (JSON.stringify(inA.params) !== JSON.stringify(op.params)) {
      modified.push({ before: inA, after: op });
    }
  }
  for (const op of a.operations) {
    if (!bById.has(op.id)) removed.push(op);
  }
  return { added, removed, modified };
}

// ── Compression ───────────────────────────────────────────────

/** Drop operations marked as no-ops or merge consecutive same-kind ops. */
export function compress(log: OperationLog): OperationLog {
  const ops: CsgOperation[] = [];
  for (const op of log.operations) {
    // Skip empty params for ops where params are required.
    if ((op.kind === 'union' || op.kind === 'subtract' || op.kind === 'intersect') && Object.keys(op.params).length === 0) continue;
    ops.push(op);
  }
  return { operations: ops, version: log.version };
}

// ── Stats ─────────────────────────────────────────────────────

export interface LogStats {
  operationCount: number;
  byKind: Record<CsgOpKind, number>;
  firstTimestamp: number | null;
  lastTimestamp: number | null;
  spanMs: number;
}

export function summarize(log: OperationLog): LogStats {
  const byKind: Partial<Record<CsgOpKind, number>> = {};
  for (const op of log.operations) {
    byKind[op.kind] = (byKind[op.kind] ?? 0) + 1;
  }
  const first = log.operations[0]?.timestamp ?? null;
  const last = log.operations[log.operations.length - 1]?.timestamp ?? null;
  return {
    operationCount: log.operations.length,
    byKind: byKind as Record<CsgOpKind, number>,
    firstTimestamp: first,
    lastTimestamp: last,
    spanMs: first !== null && last !== null ? last - first : 0,
  };
}

function nowMs(): number {
  if (typeof performance !== 'undefined') return performance.now();
  return Date.now();
}
