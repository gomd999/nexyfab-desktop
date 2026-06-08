/**
 * dimensionDriver.ts — D2: constraint-driven (bidirectional) dimensions.
 *
 * Drawing dimensions are normally one-way annotations: they READ the model. A
 * SolidWorks "driving dimension" is two-way — type a new value on the drawing
 * and the model rebuilds. NexyFab already has the parametric backbone for the
 * forward direction: the {@link EquationManager} global-variable table drives
 * feature params via expressions (e.g. a feature param `= width`). This module
 * closes the loop: BIND a drawing dimension to a global variable, then editing
 * the dimension solves for and SETS that variable, so every dependent
 * feature param re-evaluates through the existing equation DAG.
 *
 * A dimension rarely equals a raw variable — it can measure an affine function
 * of it (a diameter dim reads 2·radius; an overall length reads inner + 2·wall).
 * So a binding is `measured = scale · variable + offset`, invertible both ways:
 *   - forward (model → drawing): {@link dimensionValueOf}
 *   - reverse (drawing edit → model): {@link applyDimensionEdit}
 *
 * Headless + pure; the UI layer just calls applyDimensionEdit on a dim-edit and
 * then rebuilds. No solver of its own — it delegates propagation to the
 * EquationManager's topological re-evaluation.
 */

import type { EquationManager } from './equationManager';

export interface DimensionBinding {
  /** The drawing dimension's id. */
  dimensionId: string;
  /** Global variable (in the EquationManager) this dimension drives. */
  variable: string;
  /** measured = scale · variable + offset. Default scale 1. */
  scale?: number;
  /** measured = scale · variable + offset. Default offset 0. */
  offset?: number;
}

export interface DimensionEditResult {
  ok: boolean;
  /** The variable that was driven (on success). */
  variable?: string;
  /** The new variable value written to the table (on success). */
  variableValue?: number;
  error?: string;
}

/** Build a fast id → binding lookup. Later bindings win on duplicate ids. */
export function bindingMap(bindings: ReadonlyArray<DimensionBinding>): Map<string, DimensionBinding> {
  const m = new Map<string, DimensionBinding>();
  for (const b of bindings) m.set(b.dimensionId, b);
  return m;
}

/**
 * Forward: the measured dimension value implied by the model's current variable
 * value (`scale · variable + offset`). Throws if the variable is unknown.
 */
export function dimensionValueOf(em: EquationManager, binding: DimensionBinding): number {
  const v = em.get(binding.variable);
  if (v === null) throw new Error(`dimensionValueOf: unknown variable "${binding.variable}"`);
  return (binding.scale ?? 1) * v + (binding.offset ?? 0);
}

/**
 * Reverse: apply a user edit of dimension `dimensionId` to `newMeasuredValue`.
 * Solves `variable = (newMeasuredValue − offset) / scale` and writes it into the
 * EquationManager, which re-evaluates all dependent variables. The caller then
 * rebuilds the model from the updated variable table.
 */
export function applyDimensionEdit(
  em: EquationManager,
  bindings: ReadonlyArray<DimensionBinding> | Map<string, DimensionBinding>,
  dimensionId: string,
  newMeasuredValue: number,
): DimensionEditResult {
  const map = bindings instanceof Map ? bindings : bindingMap(bindings);
  const binding = map.get(dimensionId);
  if (!binding) {
    return { ok: false, error: `dimension "${dimensionId}" is not constraint-driven (no binding)` };
  }
  if (!Number.isFinite(newMeasuredValue)) {
    return { ok: false, error: `value must be finite, got ${newMeasuredValue}` };
  }
  const scale = binding.scale ?? 1;
  if (scale === 0 || !Number.isFinite(scale)) {
    return { ok: false, error: `binding scale must be non-zero finite, got ${scale}` };
  }
  const varValue = (newMeasuredValue - (binding.offset ?? 0)) / scale;
  try {
    // Writing a constant expression updates the variable and topologically
    // re-evaluates every dependent through the existing equation DAG.
    em.set(binding.variable, String(varValue));
  } catch (e) {
    return { ok: false, error: `failed to drive "${binding.variable}": ${e instanceof Error ? e.message : String(e)}` };
  }
  return { ok: true, variable: binding.variable, variableValue: varValue };
}
