'use client';

/**
 * dialogShell.tsx — shared modal chrome for the four method-picker dialogs.
 *
 * Wave 2 Phase 2 Track D Week 2. Spec §13.2.
 *
 * Keeps the four picker dialogs (Plane / Axis / Point / Csys) visually
 * consistent without each one re-implementing the overlay / panel /
 * header / footer.
 *
 * Layout:
 *
 *   ┌─────────────────────────────────┐
 *   │  Header (title)             [×] │
 *   ├──────────┬──────────────────────┤
 *   │  Methods │  Method params       │
 *   │  list    │  (children)          │
 *   ├──────────┴──────────────────────┤
 *   │              [Cancel]  [Insert] │
 *   └─────────────────────────────────┘
 */

import React, { useEffect } from 'react';

export interface MethodListItem<M extends string> {
  readonly method: M;
  readonly label: string;
}

export interface DialogShellProps<M extends string> {
  readonly title: string;
  readonly methods: ReadonlyArray<MethodListItem<M>>;
  readonly activeMethod: M;
  readonly onMethodChange: (m: M) => void;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
  /** When `true`, the Insert button is disabled (invalid form). */
  readonly confirmDisabled?: boolean;
  readonly children: React.ReactNode;
  /** Test hook. */
  readonly testId?: string;
}

const styles = {
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    background: 'var(--nx-glass-input)',
    backdropFilter: 'blur(4px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9000,
  },
  panel: {
    background: 'var(--nx-panel)',
    border: '1px solid var(--nx-border)',
    borderRadius: 12,
    width: 560,
    maxHeight: '80vh',
    display: 'flex',
    flexDirection: 'column' as const,
    boxShadow: '0 12px 48px rgba(0,0,0,0.55)',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    borderBottom: '1px solid var(--nx-border)',
  },
  title: {
    margin: 0,
    fontSize: 14,
    fontWeight: 700,
    color: 'var(--nx-text)',
  },
  close: {
    background: 'transparent',
    border: 'none',
    color: 'var(--nx-text-2)',
    fontSize: 18,
    cursor: 'pointer',
    padding: 0,
    lineHeight: 1,
  },
  body: {
    display: 'flex',
    flex: 1,
    minHeight: 0,
  },
  methodList: {
    width: 200,
    borderRight: '1px solid var(--nx-border)',
    overflowY: 'auto' as const,
    padding: 6,
  },
  methodRow: (active: boolean): React.CSSProperties => ({
    padding: '8px 10px',
    fontSize: 12,
    borderRadius: 4,
    cursor: 'pointer',
    color: active ? 'var(--nx-text)' : 'var(--nx-text-2)',
    background: active ? 'var(--nx-panel-2)' : 'transparent',
    fontWeight: active ? 600 : 400,
  }),
  paramsArea: {
    flex: 1,
    padding: 16,
    overflowY: 'auto' as const,
    color: 'var(--nx-text)',
    fontSize: 12,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 12,
  },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
    padding: '12px 16px',
    borderTop: '1px solid var(--nx-border)',
  },
  btn: (variant: 'primary' | 'ghost', disabled: boolean): React.CSSProperties => ({
    padding: '7px 14px',
    fontSize: 12,
    fontWeight: 600,
    borderRadius: 6,
    cursor: disabled ? 'not-allowed' : 'pointer',
    border: variant === 'primary' ? 'none' : '1px solid var(--nx-border)',
    background:
      variant === 'primary'
        ? disabled
          ? 'var(--nx-panel-2)'
          : 'var(--nx-accent)'
        : 'transparent',
    color:
      variant === 'primary'
        ? disabled
          ? 'var(--nx-text-3)'
          : 'var(--nx-text)'
        : 'var(--nx-text-2)',
  }),
};

export function DialogShell<M extends string>(props: DialogShellProps<M>): React.ReactElement {
  const {
    title,
    methods,
    activeMethod,
    onMethodChange,
    onClose,
    onConfirm,
    confirmDisabled = false,
    children,
    testId,
  } = props;

  // Escape to close (spec §13.2 — table-stakes for a modal).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      style={styles.overlay}
      onClick={onClose}
      data-testid={testId ?? 'method-picker-overlay'}
    >
      <div
        style={styles.panel}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div style={styles.header}>
          <h3 style={styles.title}>{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={styles.close}
            data-testid="method-picker-close"
          >
            ×
          </button>
        </div>
        <div style={styles.body}>
          <div style={styles.methodList}>
            {methods.map((m) => (
              <div
                key={m.method}
                role="button"
                onClick={() => onMethodChange(m.method)}
                style={styles.methodRow(m.method === activeMethod)}
                data-testid={`method-picker-method-${m.method}`}
              >
                {m.label}
              </div>
            ))}
          </div>
          <div style={styles.paramsArea} data-testid="method-picker-params">
            {children}
          </div>
        </div>
        <div style={styles.footer}>
          <button
            type="button"
            onClick={onClose}
            style={styles.btn('ghost', false)}
            data-testid="method-picker-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirmDisabled}
            style={styles.btn('primary', confirmDisabled)}
            data-testid="method-picker-confirm"
          >
            Insert
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Small shared form atoms ───────────────────────────────────────────────

export function FormRow(props: {
  readonly label: string;
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <label
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        fontSize: 11,
        color: 'var(--nx-text-2)',
      }}
    >
      <span>{props.label}</span>
      {props.children}
    </label>
  );
}

export const fieldStyle: React.CSSProperties = {
  padding: '6px 8px',
  borderRadius: 4,
  border: '1px solid var(--nx-border)',
  background: 'var(--nx-bg)',
  color: 'var(--nx-text)',
  fontSize: 12,
  width: '100%',
  boxSizing: 'border-box',
};

/** Generate a stable id for a newly-created node — uses `crypto.randomUUID`
 *  in the browser. Falls back to a Date.now-based id for environments
 *  without it (tests with a polyfilled crypto are covered by setup.ts). */
export function newReferenceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `ref_${crypto.randomUUID()}`;
  }
  return `ref_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}
