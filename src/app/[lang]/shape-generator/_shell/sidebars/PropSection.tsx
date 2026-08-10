'use client';

// PropSection — collapsible UPPERCASE section heading + body, matching the
// mockup Inspector pattern. Used by all right-side panes (Inspector / Sketch
// properties / View properties / Material properties).

import React, { useState } from 'react';

export interface PropSectionProps {
  title: string;
  children: React.ReactNode;
  defaultExpanded?: boolean;
  /** Right-aligned chip (e.g. "(12)" or status indicator). */
  badge?: React.ReactNode;
}

export function PropSection({ title, children, defaultExpanded = true, badge }: PropSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  return (
    <div style={{ borderBottom: '1px solid var(--nx-border)' }}>
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          display: 'flex',
          alignItems: 'center',
          width: '100%',
          height: 24,
          padding: '0 10px',
          fontSize: 11,
          color: 'var(--nx-text-2)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          fontWeight: 600,
          background: 'transparent',
          border: 0,
          cursor: 'pointer',
          textAlign: 'left',
          gap: 6,
        }}
      >
        <span
          aria-hidden
          style={{
            fontSize: 8,
            color: 'var(--nx-text-3)',
            transform: expanded ? 'rotate(90deg)' : 'rotate(0)',
            transition: 'transform 0.1s',
            display: 'inline-block',
          }}
        >
          ▶
        </span>
        <span style={{ flex: 1 }}>{title}</span>
        {badge}
      </button>
      {expanded && <div style={{ padding: '4px 10px 8px' }}>{children}</div>}
    </div>
  );
}

// ─── Prop rows — building blocks for sections ──────────────────────────────

export interface PropRowProps {
  label: string;
  children: React.ReactNode;
}

/** Standard "Label   Value" two-column row. */
export function PropRow({ label, children }: PropRowProps) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '90px 1fr',
        alignItems: 'center',
        gap: 8,
        padding: '3px 0',
        fontSize: 11,
        color: 'var(--nx-text)',
      }}
    >
      <span style={{ color: 'var(--nx-text-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {label}
      </span>
      <span style={{ minWidth: 0 }}>{children}</span>
    </div>
  );
}

/** Numeric input that visually matches the mockup. */
export function PropNumber({
  value, onChange, suffix, min, max, step, ariaLabel, testId,
}: {
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  min?: number;
  max?: number;
  step?: number;
  ariaLabel?: string;
  testId?: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <input
        type="number"
        aria-label={ariaLabel}
        data-testid={testId}
        value={value}
        min={min}
        max={max}
        step={step ?? 0.1}
        onChange={e => {
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
        style={{
          flex: 1,
          minWidth: 0,
          height: 22,
          padding: '0 6px',
          borderRadius: 3,
          border: '1px solid var(--nx-border)',
          background: 'var(--nx-bg)',
          color: 'var(--nx-text)',
          fontSize: 11,
          fontFamily: 'ui-monospace, monospace',
          textAlign: 'right',
        }}
      />
      {suffix && <span style={{ fontSize: 10, color: 'var(--nx-text-3)', flex: '0 0 auto' }}>{suffix}</span>}
    </div>
  );
}

/** Select dropdown matching the mockup. */
export function PropSelect<T extends string>({
  value, onChange, options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value as T)}
      style={{
        width: '100%',
        height: 22,
        padding: '0 6px',
        borderRadius: 3,
        border: '1px solid var(--nx-border)',
        background: 'var(--nx-bg)',
        color: 'var(--nx-text)',
        fontSize: 11,
      }}
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

/** Boolean check toggle. */
export function PropCheck({
  checked, onChange, label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        style={{ accentColor: 'var(--nx-accent)' }}
      />
      {label && <span style={{ fontSize: 11, color: 'var(--nx-text)' }}>{label}</span>}
    </label>
  );
}

/** Item list row used by EDGES / DIMENSIONS / CONSTRAINTS sections. */
export function PropItemRow({
  bullet, label, meta, onRemove,
}: {
  bullet?: React.ReactNode;
  label: string;
  meta?: string;
  onRemove?: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 0',
        fontSize: 11,
        color: 'var(--nx-text)',
      }}
    >
      {bullet && <span style={{ flex: '0 0 auto', color: 'var(--nx-accent)' }}>{bullet}</span>}
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </span>
      {meta && <span style={{ fontSize: 10, color: 'var(--nx-text-3)' }}>{meta}</span>}
      {onRemove && (
        <button
          onClick={onRemove}
          aria-label="Remove"
          style={{
            width: 16, height: 16, border: 0, background: 'transparent',
            color: 'var(--nx-text-3)', cursor: 'pointer', fontSize: 12,
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}
