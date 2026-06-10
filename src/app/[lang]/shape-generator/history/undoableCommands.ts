// ─── Phase A undo unification — command factories ─────────────────────────────
//
// Pure builders for HistoryCommand objects used by ShapeGeneratorInner to make
// previously-untracked mutations (assembly mates, placed parts, COTS inserts,
// feature param edits, suppress toggles, feature removal) flow through the
// EXISTING commandHistory stack. Extracted here so the do/undo logic is
// unit-testable without mounting the component (see __tests__/).
//
// Conventions (mirrors the mate→placement + base-shape-param patterns in
// ShapeGeneratorInner):
//   - commandHistory.execute(cmd) runs cmd.execute() immediately, so every
//     execute() must be safe to run when the new state is ALREADY applied
//     (idempotent re-apply) — it also runs again on redo.
//   - placedParts / assemblyMates are backed by useAssemblyState's Yjs maps
//     keyed by `id` and re-sorted by id on read, so undo only needs to
//     re-add/remove ITEMS — array order restoration is not required.

import type { HistoryCommand } from './CommandHistory';
import type { HistoryNode } from '../useFeatureStack';

/** Matches both useYjsMapAsArray setters and React Dispatch<SetStateAction<T[]>>. */
export type ArraySetter<T> = (action: T[] | ((prev: T[]) => T[])) => void;

interface BaseArgs {
  commandId: string;
  label: string;
  labelKo: string;
}

/* ── Generic id-keyed array commands (assemblyMates / placedParts) ─────────── */

/** Add one or more items to an id-keyed array (mate add, batch smart-mates). */
export function makeArrayAddCommand<T extends { id: string }>(
  args: BaseArgs & { items: T[]; set: ArraySetter<T> },
): HistoryCommand {
  const ids = new Set(args.items.map(i => i.id));
  return {
    id: args.commandId,
    label: args.label,
    labelKo: args.labelKo,
    // Filter-then-append keeps execute idempotent (initial run + redo).
    execute: () => args.set(prev => [...prev.filter(i => !ids.has(i.id)), ...args.items]),
    undo: () => args.set(prev => prev.filter(i => !ids.has(i.id))),
  };
}

/** Remove an item from an id-keyed array; undo re-adds the captured snapshot. */
export function makeArrayRemoveCommand<T extends { id: string }>(
  args: BaseArgs & { item: T; set: ArraySetter<T> },
): HistoryCommand {
  return {
    id: args.commandId,
    label: args.label,
    labelKo: args.labelKo,
    execute: () => args.set(prev => prev.filter(i => i.id !== args.item.id)),
    undo: () =>
      args.set(prev => (prev.some(i => i.id === args.item.id) ? prev : [...prev, args.item])),
  };
}

/** Patch an item; undo restores the full pre-edit item snapshot. */
export function makeArrayUpdateCommand<T extends { id: string }>(
  args: BaseArgs & { before: T; updates: Partial<T>; set: ArraySetter<T> },
): HistoryCommand {
  return {
    id: args.commandId,
    label: args.label,
    labelKo: args.labelKo,
    execute: () =>
      args.set(prev => prev.map(i => (i.id === args.before.id ? { ...i, ...args.updates } : i))),
    undo: () => args.set(prev => prev.map(i => (i.id === args.before.id ? args.before : i))),
  };
}

/** Self-inverse toggle (feature suppress, mate lock). */
export function makeToggleCommand(args: BaseArgs & { toggle: () => void }): HistoryCommand {
  return {
    id: args.commandId,
    label: args.label,
    labelKo: args.labelKo,
    execute: args.toggle,
    undo: args.toggle,
  };
}

/* ── Composite commands ────────────────────────────────────────────────────── */

/** COTS standard-part insert: placedParts entry (id-keyed) + bomParts entry
 *  (plain useState array, matched by reference — entries have no id). */
export function makeInsertStandardPartCommand<P extends { id: string }, B>(
  args: BaseArgs & {
    part: P;
    setParts: ArraySetter<P>;
    bomEntry: B;
    setBom: ArraySetter<B>;
  },
): HistoryCommand {
  return {
    id: args.commandId,
    label: args.label,
    labelKo: args.labelKo,
    execute: () => {
      args.setParts(prev => (prev.some(p => p.id === args.part.id) ? prev : [...prev, args.part]));
      args.setBom(prev => (prev.includes(args.bomEntry) ? prev : [...prev, args.bomEntry]));
    },
    undo: () => {
      args.setParts(prev => prev.filter(p => p.id !== args.part.id));
      args.setBom(prev => prev.filter(b => b !== args.bomEntry));
    },
  };
}

/** Viewport drag-place of a standard part + its auto smart-mates as ONE step. */
export function makePlacePartWithMatesCommand<P extends { id: string }, M extends { id: string }>(
  args: BaseArgs & {
    part: P;
    setParts: ArraySetter<P>;
    mates: M[];
    setMates: ArraySetter<M>;
  },
): HistoryCommand {
  const mateIds = new Set(args.mates.map(m => m.id));
  return {
    id: args.commandId,
    label: args.label,
    labelKo: args.labelKo,
    execute: () => {
      args.setParts(prev => (prev.some(p => p.id === args.part.id) ? prev : [...prev, args.part]));
      if (args.mates.length > 0) {
        args.setMates(prev => [...prev.filter(m => !mateIds.has(m.id)), ...args.mates]);
      }
    },
    undo: () => {
      args.setParts(prev => prev.filter(p => p.id !== args.part.id));
      if (args.mates.length > 0) {
        args.setMates(prev => prev.filter(m => !mateIds.has(m.id)));
      }
    },
  };
}

/* ── Feature removal (full-tree snapshot restore) ──────────────────────────── */

export interface FeatureTreeSnapshot {
  nodes: HistoryNode[];
  rootId: string;
  activeNodeId: string;
}

/** Deep-enough copy of the feature tree for later restore. `removeNode` never
 *  mutates node internals (it replaces map entries), but children arrays are
 *  copied defensively so a captured snapshot can't drift. */
export function snapshotFeatureTree(
  nodes: HistoryNode[],
  rootId: string,
  activeNodeId: string,
): FeatureTreeSnapshot {
  return {
    nodes: nodes.map(n => ({ ...n, children: [...n.children], params: { ...n.params } })),
    rootId,
    activeNodeId,
  };
}

/** Remove-feature command. Undo restores the FULL pre-removal tree via
 *  replaceHistory — original position, sketchData, edgeSelections,
 *  faceSelections and any descendants removed alongside the node — instead of
 *  the old re-add-at-end-with-numeric-params-only behavior. */
export function makeRemoveFeatureCommand(
  args: BaseArgs & {
    featureId: string;
    snapshot: FeatureTreeSnapshot;
    removeFeature: (id: string) => void;
    replaceHistory: (nodes: HistoryNode[], rootId: string, activeNodeId: string) => void;
    onRestored?: () => void;
    onRestoreFailed?: () => void;
  },
): HistoryCommand {
  const canRestore = args.snapshot.nodes.some(n => n.id === args.featureId);
  return {
    id: args.commandId,
    label: args.label,
    labelKo: args.labelKo,
    execute: () => args.removeFeature(args.featureId),
    undo: () => {
      if (!canRestore) {
        args.onRestoreFailed?.();
        return;
      }
      args.replaceHistory(args.snapshot.nodes, args.snapshot.rootId, args.snapshot.activeNodeId);
      args.onRestored?.();
    },
  };
}

/* ── Feature-param edit coalescing (commit-on-settle) ──────────────────────── */

export interface FeatureParamCoalescer {
  /** Apply a param edit immediately; the undo command is pushed on settle. */
  edit(featureId: string, key: string, value: number): void;
  /** Push any pending command now (called before undo/redo drains). */
  flush(): void;
}

/**
 * Mirrors the base-shape param pattern (handleParamChange snapshot-on-rising-
 * edge + handleParamCommit single command per drag), adapted to call sites
 * that have no commit/release callback: successive edits to the same
 * (featureId, paramKey) coalesce into ONE undo step, committed after
 * `settleMs` of idle or as soon as a different key/feature is edited.
 *
 * Exception: NURBS control-point drags alternate between sibling `cp_*` keys
 * on every pointer-move, so `cp_*` keys on the same feature coalesce together
 * (otherwise each axis change would flush the previous one — command flood).
 *
 * Undo/redo restore WHOLE param objects, which also reverses side effects like
 * the cp_* wipe that updateFeatureParam performs on uCount/vCount changes.
 */
export function createFeatureParamCoalescer(opts: {
  /** Read the node's CURRENT params (latest tree) — null when feature gone. */
  getParams: (featureId: string) => Record<string, number> | null;
  /** Raw (untracked) single-param apply — useFeatureStack.updateFeatureParam. */
  applyParam: (featureId: string, key: string, value: number) => void;
  /** Whole-params restore — useFeatureStack.updateNode({ params }). */
  restoreParams: (featureId: string, params: Record<string, number>) => void;
  /** commandHistory.execute */
  push: (cmd: HistoryCommand) => void;
  settleMs?: number;
}): FeatureParamCoalescer {
  const settleMs = opts.settleMs ?? 500;
  let pending: {
    featureId: string;
    key: string;
    before: Record<string, number>;
    timer: ReturnType<typeof setTimeout> | null;
  } | null = null;

  const sameTarget = (featureId: string, key: string): boolean =>
    pending !== null &&
    pending.featureId === featureId &&
    (pending.key === key || (pending.key.startsWith('cp_') && key.startsWith('cp_')));

  function flush(): void {
    if (!pending) return;
    const { featureId, before, timer } = pending;
    pending = null;
    if (timer) clearTimeout(timer);
    const current = opts.getParams(featureId);
    // Feature deleted before settle — the removal command owns the restore.
    if (!current) return;
    const after = { ...current };
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    let changed = false;
    for (const k of keys) {
      if (before[k] !== after[k]) { changed = true; break; }
    }
    if (!changed) return; // round-trip back to start — skip empty undo step
    opts.push({
      id: `feature-param-${featureId}-${Date.now()}`,
      label: 'Edit feature parameter',
      labelKo: '피처 파라미터 수정',
      // State already holds `after` when this is pushed — initial execute() is
      // an idempotent re-apply; redo re-applies after an undo.
      execute: () => opts.restoreParams(featureId, after),
      undo: () => opts.restoreParams(featureId, before),
    });
  }

  function edit(featureId: string, key: string, value: number): void {
    if (pending && !sameTarget(featureId, key)) flush();
    if (!pending) {
      pending = {
        featureId,
        key,
        before: { ...(opts.getParams(featureId) ?? {}) },
        timer: null,
      };
    } else {
      pending.key = key; // track latest key (cp_* family hops within one drag)
      if (pending.timer) clearTimeout(pending.timer);
    }
    opts.applyParam(featureId, key, value);
    pending.timer = setTimeout(flush, settleMs);
  }

  return { edit, flush };
}
