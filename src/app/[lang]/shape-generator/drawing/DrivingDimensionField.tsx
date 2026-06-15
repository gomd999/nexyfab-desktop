'use client';

/**
 * DrivingDimensionField — D2 UI: a constraint-DRIVEN dimension input.
 *
 * A normal drawing dimension is read-only (it reports the model). This field is
 * the two-way affordance: it shows the dimension's current value (computed from
 * the bound global variable via `dimensionValueOf`) and, on commit (Enter/blur),
 * drives the model by calling `applyDimensionEdit` — which writes the variable
 * and lets the EquationManager DAG re-evaluate every dependent feature param.
 * The host then rebuilds via `onRebuild`.
 *
 * It owns no model state: all parametric logic lives in
 * `equations/dimensionDriver.ts` (headless, tested). This is the thin,
 * jsdom-testable presentation layer over it.
 */

import * as React from 'react';
import type { EquationManager } from '../equations/equationManager';
import {
  applyDimensionEdit,
  dimensionValueOf,
  type DimensionBinding,
} from '../equations/dimensionDriver';

export interface DrivingDimensionFieldProps {
  em: EquationManager;
  binding: DimensionBinding;
  /** Optional label shown before the input. */
  label?: string;
  /** Called with the new variable value after a successful drive. */
  onCommitted?: (variableValue: number) => void;
  /** Called after a successful drive so the host rebuilds the model. */
  onRebuild?: () => void;
}

function currentValue(em: EquationManager, binding: DimensionBinding): number {
  try {
    return dimensionValueOf(em, binding);
  } catch {
    return NaN;
  }
}

export default function DrivingDimensionField({
  em, binding, label, onCommitted, onRebuild,
}: DrivingDimensionFieldProps): React.ReactElement {
  const [text, setText] = React.useState(() => String(currentValue(em, binding)));
  const [error, setError] = React.useState<string | null>(null);

  const commit = React.useCallback(() => {
    const v = Number(text);
    const r = applyDimensionEdit(em, [binding], binding.dimensionId, v);
    if (!r.ok) {
      setError(r.error ?? 'edit failed');
      return;
    }
    setError(null);
    setText(String(currentValue(em, binding)));
    if (r.variableValue !== undefined) onCommitted?.(r.variableValue);
    onRebuild?.();
  }, [text, em, binding, onCommitted, onRebuild]);

  return (
    <span
      data-testid="driving-dim-field"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}
    >
      {label ? <label style={{ color: 'var(--nx-text-2)' }}>{label}</label> : null}
      <input
        data-testid="driving-dim-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
        onBlur={commit}
        style={{
          width: 64, padding: '2px 4px', textAlign: 'right',
          background: 'var(--nx-panel-2)', color: 'var(--nx-text)',
          border: `1px solid ${error ? 'var(--nx-error)' : 'var(--nx-border)'}`, borderRadius: 4,
        }}
      />
      <span
        data-testid="driving-dim-var"
        title={`drives ${binding.variable}`}
        style={{ color: 'var(--nx-accent)', fontFamily: 'monospace' }}
      >
        ƒ{binding.variable}
      </span>
      {error ? (
        <span data-testid="driving-dim-error" style={{ color: 'var(--nx-error)' }}>{error}</span>
      ) : null}
    </span>
  );
}
