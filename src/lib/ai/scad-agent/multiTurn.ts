/**
 * multiTurn.ts — Refinement state machine for NL→design dialogue.
 *
 * A single-shot NL→intent call works well when the user has a fully
 * specified description ("box 50×30×20mm with a Ø10mm hole at the
 * centre"). Real users iterate — "make it taller", "round the corners",
 * "no, the OTHER edge" — and the agent needs to retain the previous
 * intent + apply a diff, not start from scratch each turn.
 *
 * This module is the deterministic side of that loop. The LLM still
 * does the natural-language understanding, but every turn produces a
 * `RefinementOp` (or list of ops) that this state machine applies to
 * the prior intent. The result is a clean audit trail: every change
 * is a discrete, undoable operation rather than a brand-new intent
 * the user has to compare against the previous one by hand.
 *
 * Supported ops:
 *   - `set-param` — replace a numeric param value.
 *   - `scale-param` — multiply a param by a factor (handy for "twice
 *     as tall").
 *   - `add-feature` — append to features[].
 *   - `remove-feature` — remove the feature at the given index.
 *   - `update-feature-param` — tweak a single feature param.
 *   - `toggle-feature` — flip the `enabled` flag.
 *   - `change-shape` — swap shapeId (params preserved where compatible).
 *
 * Out of scope (intentionally simple):
 *   - Branching / what-if (would need tree state).
 *   - Rebase across shape changes (user re-confirms params on swap).
 *   - Server-side persistence (caller stores history wherever).
 */

import type { IntentInput } from '@/lib/openscad-render/intentToScad';

export type RefinementOp =
  | { kind: 'set-param'; key: string; value: number }
  | { kind: 'scale-param'; key: string; factor: number }
  | { kind: 'add-feature'; type: string; params?: Record<string, number> }
  | { kind: 'remove-feature'; index: number }
  | { kind: 'update-feature-param'; index: number; key: string; value: number }
  | { kind: 'toggle-feature'; index: number }
  | { kind: 'change-shape'; shapeId: string };

export interface RefinementApplyResult {
  ok: boolean;
  intent: IntentInput;
  /** Empty when ok=true; populated when the op didn't apply cleanly. */
  errors: string[];
}

export interface RefinementHistoryEntry {
  /** Timestamp the op was applied (Date.now()). */
  appliedAt: number;
  op: RefinementOp;
  /** Snapshot of the intent AFTER the op (for undo / audit). */
  resultingIntent: IntentInput;
}

/**
 * Apply a single refinement op to an intent and return the new intent.
 * The input is not mutated — the returned `intent` is a deep copy
 * (Vector3-free, so structuredClone-equivalent JSON copying suffices).
 */
export function applyRefinement(
  base: IntentInput,
  op: RefinementOp,
): RefinementApplyResult {
  // Deep copy the input so the caller's reference stays untouched.
  const intent: IntentInput = JSON.parse(JSON.stringify(base));
  const errors: string[] = [];

  switch (op.kind) {
    case 'set-param': {
      if (!Number.isFinite(op.value)) {
        errors.push(`set-param: value must be finite, got ${op.value}`);
        break;
      }
      intent.params[op.key] = op.value;
      break;
    }
    case 'scale-param': {
      if (!Number.isFinite(op.factor) || op.factor <= 0) {
        errors.push(`scale-param: factor must be a positive finite number, got ${op.factor}`);
        break;
      }
      const cur = intent.params[op.key];
      if (typeof cur !== 'number') {
        errors.push(`scale-param: param '${op.key}' is not set on the current intent`);
        break;
      }
      intent.params[op.key] = cur * op.factor;
      break;
    }
    case 'add-feature': {
      if (!op.type) {
        errors.push(`add-feature: type is required`);
        break;
      }
      intent.features = intent.features ?? [];
      intent.features.push({ type: op.type, params: op.params });
      break;
    }
    case 'remove-feature': {
      const list = intent.features ?? [];
      if (op.index < 0 || op.index >= list.length) {
        errors.push(`remove-feature: index ${op.index} out of range (size ${list.length})`);
        break;
      }
      intent.features = [...list.slice(0, op.index), ...list.slice(op.index + 1)];
      break;
    }
    case 'update-feature-param': {
      const list = intent.features ?? [];
      const f = list[op.index];
      if (!f) {
        errors.push(`update-feature-param: index ${op.index} out of range`);
        break;
      }
      if (!Number.isFinite(op.value)) {
        errors.push(`update-feature-param: value must be finite`);
        break;
      }
      f.params = { ...(f.params ?? {}), [op.key]: op.value };
      break;
    }
    case 'toggle-feature': {
      const list = intent.features ?? [];
      const f = list[op.index];
      if (!f) {
        errors.push(`toggle-feature: index ${op.index} out of range`);
        break;
      }
      f.enabled = !(f.enabled ?? true);
      break;
    }
    case 'change-shape': {
      if (!op.shapeId) {
        errors.push(`change-shape: shapeId is required`);
        break;
      }
      intent.shapeId = op.shapeId;
      // Params kept as-is — caller / user re-confirms compatibility.
      break;
    }
  }

  return { ok: errors.length === 0, intent, errors };
}

/**
 * Apply a series of refinement ops sequentially. Returns the final
 * intent plus a history entry per applied op (for undo / debugging).
 * Continues past failed ops, accumulating errors — the alternative
 * (fail-fast) makes batch refinement brittle.
 */
export function applyRefinements(
  base: IntentInput,
  ops: RefinementOp[],
  now: () => number = Date.now,
): {
  intent: IntentInput;
  history: RefinementHistoryEntry[];
  errors: string[];
} {
  let intent = base;
  const history: RefinementHistoryEntry[] = [];
  const errors: string[] = [];
  for (const op of ops) {
    const r = applyRefinement(intent, op);
    if (!r.ok) errors.push(...r.errors);
    intent = r.intent;
    history.push({ appliedAt: now(), op, resultingIntent: r.intent });
  }
  return { intent, history, errors };
}

/** Revert to the intent that existed BEFORE the given history index.
 *  Useful for "undo last 2 turns" UX. Returns the original base when
 *  the index is 0 or negative. */
export function revertTo(
  base: IntentInput,
  history: RefinementHistoryEntry[],
  index: number,
): IntentInput {
  if (index <= 0 || history.length === 0) return JSON.parse(JSON.stringify(base));
  const clampedIdx = Math.min(index - 1, history.length - 1);
  return JSON.parse(JSON.stringify(history[clampedIdx].resultingIntent));
}
