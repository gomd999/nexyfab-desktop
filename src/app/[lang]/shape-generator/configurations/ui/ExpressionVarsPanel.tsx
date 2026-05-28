'use client';

/**
 * ExpressionVarsPanel.tsx — collapsible side panel for the active
 * config's `expressionVars` + the table-wide `globalVars`.
 *
 * Wave 2 Phase 2 Track A Week 4 (A4). Spec §7.3 "Variable panel toggle".
 *
 * Two sections stacked vertically:
 *   1. Global vars — table-wide; always visible (no active config needed).
 *   2. Expression vars — config-scoped; only when an active config
 *      exists. The two are layered at resolution time
 *      (`expressionVars` > `globalVars`, spec §4.2).
 *
 * Each row: name input, value input (text — runtime coerces with
 * `Number()` to detect literals vs. expression strings), remove button.
 * "+ Var" button appends a blank row. Naming policy: identifier-ish
 * — alphanumerics + underscores; we don't validate strictly because
 * the A2 runtime accepts any string key, and validation lives in
 * `validateModel`.
 */

import React, { useCallback, useState } from 'react';
import type { ConfigurationTable as ConfigurationTableRuntime } from '../ConfigurationTable';
import { pickDict, type Lang } from './dict';

export interface ExpressionVarsPanelProps {
  table: ConfigurationTableRuntime;
  /** The active config's id; `null` means master / no overlay (no
   *  config-scoped vars editable in that state). */
  activeConfigId: string | null;
  lang: Lang | string;
  onMutate?: () => void;
  /** When true, panel starts expanded — useful for tests + Playwright. */
  defaultOpen?: boolean;
}

const C = {
  bg: 'var(--nx-panel-2)',
  border: 'var(--nx-border)',
  text: 'var(--nx-text)',
  muted: 'var(--nx-text-2)',
  accent: 'var(--nx-accent-2)',
  danger: 'var(--nx-error)',
};

export default function ExpressionVarsPanel(props: ExpressionVarsPanelProps): React.JSX.Element {
  const { table, activeConfigId, lang, onMutate, defaultOpen } = props;
  const t = pickDict(lang as string);

  const [open, setOpen] = useState<boolean>(defaultOpen ?? false);
  const [bumpCounter, setBump] = useState(0);
  const bump = useCallback(() => {
    setBump(b => (b + 1) | 0);
    onMutate?.();
  }, [onMutate]);

  // Snapshot the current vars on each render. Cheap — these are small
  // objects (≤ a few dozen entries in practice). We can't useMemo on
  // the runtime's class state because the class mutates in place;
  // `bumpCounter` triggers fresh renders on mutation.
  void bumpCounter;
  const globalVars = Object.entries(table.getGlobalVars());
  const activeEntry = activeConfigId !== null ? table.get(activeConfigId) : null;
  const exprVars = activeEntry ? Object.entries(activeEntry.expressionVars) : [];

  const handleAddGlobal = useCallback(() => {
    // Generate a unique name `var_N` so it doesn't collide.
    let i = 0;
    const existing = new Set(Object.keys(table.getGlobalVars()));
    while (existing.has(`var_${i}`)) i += 1;
    table.setGlobalVar(`var_${i}`, 0);
    bump();
  }, [table, bump]);

  const handleRenameGlobal = useCallback(
    (oldName: string, newName: string) => {
      const trimmed = newName.trim();
      if (!trimmed || trimmed === oldName) return;
      // Re-key: read the value, drop the old, set the new. The runtime
      // doesn't expose `delete` so we use the storage-level snapshot
      // approach: rebuild via JSON round-trip.
      const all = { ...table.getGlobalVars() };
      const v = all[oldName];
      delete all[oldName];
      all[trimmed] = v ?? 0;
      // Reset by setting each — the runtime overwrites on duplicate.
      // For the deletion to actually stick we need to round-trip through
      // toJSON/fromJSON; do a lightweight in-place replace by reaching
      // through the snapshot.
      const snap = table.toJSON();
      snap.globalVars = all;
      // Re-create a fresh runtime would lose our entries; instead clear
      // by setting each existing key to `0` then setting the new map.
      // The cleanest path: expose setGlobalVar — and delete on next save.
      // For W4 UI we keep both keys until next save; this is documented
      // limitation.
      table.setGlobalVar(trimmed, v ?? 0);
      bump();
    },
    [table, bump],
  );

  const handleSetGlobalValue = useCallback(
    (name: string, raw: string) => {
      const trimmed = raw.trim();
      if (trimmed === '') return;
      const num = Number(trimmed);
      const value = Number.isFinite(num) && /^[\d\-+.eE\s]+$/.test(trimmed) ? num : trimmed;
      table.setGlobalVar(name, value);
      bump();
    },
    [table, bump],
  );

  const handleRemoveGlobal = useCallback(
    (name: string) => {
      // Workaround for no `unsetGlobalVar` on the A2 runtime: tag with
      // `0` and let the next persistence cycle drop empty entries.
      // (When A3 expression resolution lands, `0` is the additive
      // identity for numeric ops and "0" string is the closest-to-empty
      // expression. Documented in spec §13.4 orphan-cleanup behaviour.)
      table.setGlobalVar(name, 0);
      bump();
    },
    [table, bump],
  );

  const handleAddExpr = useCallback(() => {
    if (activeConfigId === null) return;
    let i = 0;
    const existing = new Set(Object.keys(activeEntry?.expressionVars ?? {}));
    while (existing.has(`var_${i}`)) i += 1;
    table.setExpressionVar(activeConfigId, `var_${i}`, 0);
    bump();
  }, [table, activeConfigId, activeEntry, bump]);

  const handleSetExprValue = useCallback(
    (name: string, raw: string) => {
      if (activeConfigId === null) return;
      const trimmed = raw.trim();
      if (trimmed === '') return;
      const num = Number(trimmed);
      const value = Number.isFinite(num) && /^[\d\-+.eE\s]+$/.test(trimmed) ? num : trimmed;
      table.setExpressionVar(activeConfigId, name, value);
      bump();
    },
    [table, activeConfigId, bump],
  );

  const handleRemoveExpr = useCallback(
    (name: string) => {
      if (activeConfigId === null) return;
      // Same workaround as global — A2 has no `unsetExpressionVar`.
      table.setExpressionVar(activeConfigId, name, 0);
      bump();
    },
    [table, activeConfigId, bump],
  );

  return (
    <div data-testid="expression-vars-panel" style={panelStyle}>
      <button
        data-testid="expression-vars-toggle"
        onClick={() => setOpen(o => !o)}
        style={toggleStyle}
      >
        {open ? '▼' : '▶'} {t.expressionVars} / {t.globalVars}
      </button>

      {open && (
        <div style={bodyStyle}>
          {/* Global Vars */}
          <section data-testid="global-vars-section">
            <div style={sectionHeaderStyle}>
              <span>{t.globalVars}</span>
              <button
                data-testid="global-vars-add"
                onClick={handleAddGlobal}
                style={addBtnStyle}
              >
                {t.addVar}
              </button>
            </div>
            {globalVars.length === 0 ? (
              <div style={emptyStyle}>—</div>
            ) : (
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>{t.varName}</th>
                    <th style={thStyle}>{t.varValue}</th>
                    <th style={thStyle}></th>
                  </tr>
                </thead>
                <tbody>
                  {globalVars.map(([name, value]) => (
                    <tr key={name} data-testid={`global-var-row-${name}`}>
                      <td style={tdStyle}>
                        <input
                          type="text"
                          defaultValue={name}
                          onBlur={e => handleRenameGlobal(name, e.target.value)}
                          style={inputStyle}
                          data-testid={`global-var-name-${name}`}
                        />
                      </td>
                      <td style={tdStyle}>
                        <input
                          type="text"
                          defaultValue={String(value)}
                          onBlur={e => handleSetGlobalValue(name, e.target.value)}
                          style={inputStyle}
                          data-testid={`global-var-value-${name}`}
                        />
                      </td>
                      <td style={tdStyle}>
                        <button
                          onClick={() => handleRemoveGlobal(name)}
                          style={removeBtnStyle}
                          title={t.removeVar}
                          data-testid={`global-var-remove-${name}`}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* Expression Vars (active config only) */}
          {activeConfigId !== null && (
            <section data-testid="expr-vars-section" style={{ marginTop: 10 }}>
              <div style={sectionHeaderStyle}>
                <span>
                  {t.expressionVars} <span style={{ color: C.muted }}>({activeEntry?.name})</span>
                </span>
                <button
                  data-testid="expr-vars-add"
                  onClick={handleAddExpr}
                  style={addBtnStyle}
                >
                  {t.addVar}
                </button>
              </div>
              {exprVars.length === 0 ? (
                <div style={emptyStyle}>—</div>
              ) : (
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={thStyle}>{t.varName}</th>
                      <th style={thStyle}>{t.varValue}</th>
                      <th style={thStyle}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {exprVars.map(([name, value]) => (
                      <tr key={name} data-testid={`expr-var-row-${name}`}>
                        <td style={tdStyle}>
                          <span style={inputStyle}>{name}</span>
                        </td>
                        <td style={tdStyle}>
                          <input
                            type="text"
                            defaultValue={String(value)}
                            onBlur={e => handleSetExprValue(name, e.target.value)}
                            style={inputStyle}
                            data-testid={`expr-var-value-${name}`}
                          />
                        </td>
                        <td style={tdStyle}>
                          <button
                            onClick={() => handleRemoveExpr(name)}
                            style={removeBtnStyle}
                            title={t.removeVar}
                            data-testid={`expr-var-remove-${name}`}
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  borderTop: `1px solid ${C.border}`,
  background: C.bg,
};

const toggleStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 12px',
  background: 'transparent',
  border: 'none',
  color: C.text,
  fontSize: 11,
  fontWeight: 600,
  textAlign: 'left',
  cursor: 'pointer',
};

const bodyStyle: React.CSSProperties = {
  padding: '6px 12px 10px',
};

const sectionHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  fontSize: 11,
  fontWeight: 600,
  color: C.muted,
  marginBottom: 4,
};

const addBtnStyle: React.CSSProperties = {
  padding: '2px 8px',
  borderRadius: 3,
  border: `1px solid ${C.accent}`,
  background: 'transparent',
  color: C.accent,
  fontSize: 10,
  fontWeight: 600,
  cursor: 'pointer',
};

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 11,
};

const thStyle: React.CSSProperties = {
  padding: '2px 6px',
  textAlign: 'left',
  fontSize: 10,
  color: C.muted,
  borderBottom: `1px solid ${C.border}`,
};

const tdStyle: React.CSSProperties = {
  padding: '2px 6px',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '2px 4px',
  background: 'transparent',
  color: C.text,
  border: `1px solid ${C.border}`,
  borderRadius: 3,
  fontSize: 11,
  fontFamily: 'monospace',
};

const removeBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: C.danger,
  fontSize: 11,
  cursor: 'pointer',
};

const emptyStyle: React.CSSProperties = {
  fontSize: 11,
  color: C.muted,
  padding: '4px 0',
};
