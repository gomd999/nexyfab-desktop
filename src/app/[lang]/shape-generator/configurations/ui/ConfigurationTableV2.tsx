'use client';

/**
 * ConfigurationTableV2.tsx — Excel-style v2 grid backed by the A2
 * `ConfigurationTable` runtime class.
 *
 * Wave 2 Phase 2 Track A Week 4 (A4). Mounted side-by-side with the
 * legacy `panels/ConfigurationTable.tsx` and gated behind the same
 * `?configs=v2` flag the A3 pipeline integration uses. The legacy panel
 * stays as the default safety net per the master tracker (Track A row
 * W4 / W6 — legacy delete lands W6).
 *
 * **Columns** layout (spec §5, §7.1):
 *
 *   ┌──────────┬─────────────────────────────────────────┐
 *   │ rows ↓   │   Master  │  cfg-0  │  cfg-1  │  ...    │
 *   ├──────────┼───────────┼─────────┼─────────┼─────────┤
 *   │ feat #1  │ default   │ literal │ inherit │ ...     │
 *   │ feat #2  │ ✓         │ ·       │ inherit │ ...     │
 *   │ ...                                                 │
 *
 *   - Rows = features (one row per param key + one row for suppress per feature)
 *   - Columns = master + N configs
 *   - "Master" column is read-only — shows feature defaults (spec §15.1)
 *   - Inherited cells render dimmed/italic
 *   - Expression cells render `= expr` badge
 *
 * **Performance / virtualization** (spec §7.5): we ship a *lightweight*
 * custom windowing implementation rather than a `react-window`
 * dependency. Reasons:
 *   1. Zero added bundle weight — fits the Wave 2 perf budget
 *      (`wave-2-soak-runbook.md` UI ≤ 16ms p95 / 1000 cells).
 *   2. We only need vertical virtualization (rows = ~50-200; columns
 *      are bounded by config count ≈ ≤ 100 per spec).
 *   3. The Husky ≤800-line / ≤15-file budget rules out a multi-file
 *      `react-window` wiring + types package.
 *
 * The window keeps `OVERSCAN` rows above + below the visible viewport
 * mounted. At N < `WINDOW_THRESHOLD` rows we mount the full table —
 * react-window has overhead in the cold path too.
 *
 * **Side-by-side with legacy** — the legacy `panels/ConfigurationTable.tsx`
 * is NOT removed in W4 (master tracker: delete in W6). Mount this
 * component instead when the v2 runtime flag is on; the host already
 * carries both runtimes simultaneously via `migrateFromV1`.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ConfigurationTable as ConfigurationTableRuntime } from '../ConfigurationTable';
import type { ConfigEntry } from '../types';
import type { FeatureInstance } from '../../features/types';
import { pickDict, type Lang } from './dict';
import ExpressionVarsPanel from './ExpressionVarsPanel';
import FamilyExportButton from './FamilyExportButton';
import ConfigCsvBomButton from './ConfigCsvBomButton';

export interface ConfigurationTableV2Props {
  /** The A2 runtime — canonical state. */
  table: ConfigurationTableRuntime;
  /** Master features (for column labels + default values + suppress
   *  defaults). The runtime never mutates this list (spec §5 invariant). */
  features: FeatureInstance[];
  /** UI language; falls back to `en`. */
  lang: Lang | string;
  /** Called after every mutating op so the host can bump a re-render
   *  signature (we don't subscribe to the runtime — it's a plain class). */
  onMutate?: () => void;
  /** Close handler (host-controlled panel chrome). */
  onClose?: () => void;
  /** Optional test hook — used by Playwright to scope queries. */
  'data-testid'?: string;
}

const C = {
  bg: 'var(--nx-panel)',
  bg2: 'var(--nx-panel-2)',
  border: 'var(--nx-border)',
  text: 'var(--nx-text)',
  muted: 'var(--nx-text-2)',
  accent: 'var(--nx-accent-2)',
  active: '#1f6feb22',
  cellBg: 'var(--nx-bg)',
  danger: 'var(--nx-error)',
  inherited: 'var(--nx-text-2)',
};

const ROW_HEIGHT = 24;
const HEADER_HEIGHT = 60;
const OVERSCAN = 8;
const WINDOW_THRESHOLD = 60; // below this, render all rows
const MAX_HEIGHT_VH = 70;

/** Each grid row is a (featureId, paramKey | '__suppressed__') pair. */
interface GridRow {
  feature: FeatureInstance;
  paramKey: string | '__suppressed__';
}

export default function ConfigurationTableV2(props: ConfigurationTableV2Props): React.JSX.Element {
  const { table, features, lang, onMutate, onClose } = props;
  const t = pickDict(lang as string);

  // Re-render bump after every mutating op — the runtime is a class so
  // React doesn't see its state changes. We keep our own counter, and
  // include it in dep arrays of memos that read live runtime state.
  const [bump, setBump] = useState(0);
  const mutated = useCallback(() => {
    setBump(b => (b + 1) | 0);
    onMutate?.();
  }, [onMutate]);

  // List of configs (cloned — entries are frozen at the runtime level).
  // Computed on every render: the runtime is a class with mutable state
  // and React doesn't track changes through it, so memoising would
  // stale-cache. `bump` triggers re-renders on mutation; references it
  // explicitly to satisfy the linter.
  void bump;
  const configs: ConfigEntry[] = table.list();
  const activeId = table.getActiveId();

  // Build grid rows — one per (feature, paramKey) + one suppress-toggle row per feature.
  const rows: GridRow[] = useMemo(() => {
    const out: GridRow[] = [];
    for (const f of features) {
      // Suppress row first (a single row labelled "suppress").
      out.push({ feature: f, paramKey: '__suppressed__' });
      for (const k of Object.keys(f.params).sort()) {
        out.push({ feature: f, paramKey: k });
      }
    }
    return out;
  }, [features]);

  // ── Virtualization ──────────────────────────────────────────────
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(400);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const update = () => setViewportH(el.clientHeight);
    update();
    const onScroll = () => setScrollTop(el.scrollTop);
    el.addEventListener('scroll', onScroll);
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(update);
      ro.observe(el);
      return () => {
        el.removeEventListener('scroll', onScroll);
        ro.disconnect();
      };
    }
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  const totalRows = rows.length;
  const useWindow = totalRows >= WINDOW_THRESHOLD;
  const firstIdx = useWindow ? Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN) : 0;
  const visibleCount = useWindow
    ? Math.min(totalRows - firstIdx, Math.ceil(viewportH / ROW_HEIGHT) + OVERSCAN * 2)
    : totalRows;
  const visibleRows = rows.slice(firstIdx, firstIdx + visibleCount);
  const topSpacer = useWindow ? firstIdx * ROW_HEIGHT : 0;
  const bottomSpacer = useWindow ? Math.max(0, (totalRows - firstIdx - visibleCount) * ROW_HEIGHT) : 0;

  // ── Mutators (all dual-write the runtime + bump the re-render) ──
  const handleAddConfig = useCallback(() => {
    const idx = configs.length;
    table.add(`Config ${idx + 1}`);
    mutated();
  }, [table, configs.length, mutated]);

  const handleRemoveConfig = useCallback(
    (id: string) => {
      if (typeof window !== 'undefined' && !window.confirm(t.delConfirm)) return;
      table.remove(id);
      mutated();
    },
    [table, t.delConfirm, mutated],
  );

  const handleRename = useCallback(
    (id: string, name: string) => {
      if (!name.trim()) return;
      table.rename(id, name.trim());
      mutated();
    },
    [table, mutated],
  );

  const handleActivate = useCallback(
    (id: string | null) => {
      // Spec §5.1: blur the active input on switch so a pending edit
      // doesn't auto-commit to the wrong config.
      if (typeof document !== 'undefined') {
        const active = document.activeElement;
        if (active && 'blur' in active && typeof (active as HTMLElement).blur === 'function') {
          (active as HTMLElement).blur();
        }
      }
      table.activate(id);
      mutated();
    },
    [table, mutated],
  );

  const handleSetParent = useCallback(
    (id: string, parentId: string | null) => {
      const result = table.setParent(id, parentId);
      if (!result.ok && result.error === 'cycle') {
        // Cycle refused — toast via console for now (host owns the
        // ToastContainer; cleanest hook lands in W5 polish).
        if (typeof window !== 'undefined' && typeof window.alert === 'function') {
          // Use alert as the cycle is rare and load-bearing UX.
          // Tests stub window.alert.
          window.alert(t.cycleError);
        }
        return;
      }
      mutated();
    },
    [table, t.cycleError, mutated],
  );

  const handleSetOverride = useCallback(
    (configId: string, featureId: string, paramKey: string, value: number | string) => {
      table.setOverride(configId, featureId, paramKey, value);
      mutated();
    },
    [table, mutated],
  );

  const handleClearOverride = useCallback(
    (configId: string, featureId: string, paramKey: string) => {
      table.clearOverride(configId, featureId, paramKey);
      mutated();
    },
    [table, mutated],
  );

  const handleToggleSuppress = useCallback(
    (configId: string, featureId: string, current: boolean) => {
      table.setSuppressed(configId, featureId, !current);
      mutated();
    },
    [table, mutated],
  );

  // ── Resolve the effective value/state for a cell. ───────────────
  //
  // Walks the parent chain to detect inheritance — used to render
  // dimmed cells when no direct override exists but a parent provides
  // a value.
  const resolveCell = useCallback(
    (config: ConfigEntry, featureId: string, paramKey: string): CellState => {
      const chain = table.parentChain(config.id);
      let value: number | string | undefined;
      let fromParent = false;
      for (let i = 0; i < chain.length; i += 1) {
        const cfg = chain[i]!;
        const ov = cfg.overrides[featureId];
        if (ov?.params && paramKey in ov.params) {
          value = ov.params[paramKey];
          fromParent = cfg.id !== config.id;
        }
      }
      const direct = config.overrides[featureId]?.params?.[paramKey];
      if (direct !== undefined) {
        return {
          state: typeof direct === 'string' ? 'expression' : 'override',
          value: direct,
        };
      }
      if (value !== undefined) {
        return { state: 'inherited', value, fromParent };
      }
      return { state: 'default', value: undefined };
    },
    [table],
  );

  const resolveSuppressCell = useCallback(
    (config: ConfigEntry, featureId: string): SuppressState => {
      const chain = table.parentChain(config.id);
      let suppressed: boolean | undefined;
      let fromParent = false;
      for (let i = 0; i < chain.length; i += 1) {
        const cfg = chain[i]!;
        const ov = cfg.overrides[featureId];
        if (ov?.suppressed !== undefined) {
          suppressed = ov.suppressed;
          fromParent = cfg.id !== config.id;
        }
      }
      const direct = config.overrides[featureId]?.suppressed;
      if (direct !== undefined) {
        return { suppressed: direct, source: 'direct' };
      }
      if (suppressed !== undefined) {
        return { suppressed, source: fromParent ? 'inherited' : 'direct' };
      }
      return { suppressed: false, source: 'default' };
    },
    [table],
  );

  // ── Empty state ─────────────────────────────────────────────────
  if (configs.length === 0) {
    return (
      <div
        data-testid={props['data-testid'] ?? 'configuration-table-v2'}
        style={panelStyle}
      >
        <PanelHeader t={t} onAddConfig={handleAddConfig} onClose={onClose}>
          <FamilyExportButton table={table} features={features} lang={lang} />
          <ConfigCsvBomButton table={table} features={features} lang={lang} />
        </PanelHeader>
        <div style={{ padding: 24, color: C.muted, fontSize: 12, textAlign: 'center' }}>
          {t.empty}
        </div>
        <ExpressionVarsPanel
          table={table}
          activeConfigId={activeId}
          lang={lang}
          onMutate={mutated}
        />
      </div>
    );
  }

  return (
    <div
      data-testid={props['data-testid'] ?? 'configuration-table-v2'}
      style={panelStyle}
    >
      <PanelHeader t={t} onAddConfig={handleAddConfig} onClose={onClose}>
        <FamilyExportButton table={table} features={features} lang={lang} />
        <ConfigCsvBomButton table={table} features={features} lang={lang} />
      </PanelHeader>

      {/* Column header (sticky) — config names + parent dropdown + active dot */}
      <div style={headerRowStyle}>
        <div style={{ ...headerCellStyle, width: 220, position: 'sticky', left: 0, background: C.bg2 }}>
          {t.featureCol} / {t.paramCol}
        </div>
        <div style={headerCellStyle}>{t.master}</div>
        {configs.map(cfg => (
          <div key={cfg.id} style={headerCellStyle}>
            <input
              data-testid={`config-rename-${cfg.id}`}
              type="text"
              value={cfg.name}
              onChange={e => handleRename(cfg.id, e.target.value)}
              style={configNameInputStyle(cfg.id === activeId)}
            />
            <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
              <button
                data-testid={`config-activate-${cfg.id}`}
                onClick={() => handleActivate(cfg.id === activeId ? null : cfg.id)}
                title={t.activate}
                style={activateButtonStyle(cfg.id === activeId)}
              >
                {cfg.id === activeId ? '●' : '○'}
              </button>
              <select
                data-testid={`config-parent-${cfg.id}`}
                value={cfg.parentId ?? ''}
                onChange={e => handleSetParent(cfg.id, e.target.value || null)}
                title={t.parent}
                style={parentSelectStyle}
              >
                <option value="">{t.none}</option>
                {configs
                  .filter(c => c.id !== cfg.id)
                  .map(c => (
                    <option key={c.id} value={c.id}>
                      ↑ {c.name}
                    </option>
                  ))}
              </select>
              <button
                data-testid={`config-delete-${cfg.id}`}
                onClick={() => handleRemoveConfig(cfg.id)}
                title={t.del}
                style={delButtonStyle}
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Scroller (windowed) */}
      <div ref={scrollerRef} style={scrollerStyle} data-testid="config-grid-scroller">
        {topSpacer > 0 && <div style={{ height: topSpacer }} />}
        {visibleRows.map((row, i) => {
          const realIdx = firstIdx + i;
          const isSuppress = row.paramKey === '__suppressed__';
          return (
            <div
              key={`${row.feature.id}:${row.paramKey}:${realIdx}`}
              style={gridRowStyle(realIdx % 2 === 0)}
            >
              <div style={rowLabelCellStyle} title={`${row.feature.type}#${row.feature.id}`}>
                <span style={{ color: C.accent, fontFamily: 'monospace' }}>
                  {row.feature.type}
                </span>
                <span style={{ color: C.muted, marginLeft: 6 }}>
                  {isSuppress ? `[${t.toggleSuppress}]` : row.paramKey}
                </span>
              </div>

              {/* Master column — read-only */}
              <div style={masterCellStyle}>
                {isSuppress
                  ? row.feature.enabled
                    ? '✓'
                    : '·'
                  : typeof row.feature.params[row.paramKey] === 'number'
                    ? (row.feature.params[row.paramKey] as number).toFixed(2)
                    : '—'}
              </div>

              {/* One cell per config */}
              {configs.map(cfg => {
                if (isSuppress) {
                  const sup = resolveSuppressCell(cfg, row.feature.id);
                  return (
                    <div key={cfg.id} style={configCellStyle(cfg.id === activeId)}>
                      <button
                        data-testid={`cell-suppress-${cfg.id}-${row.feature.id}`}
                        onClick={() => handleToggleSuppress(cfg.id, row.feature.id, sup.suppressed)}
                        title={sup.suppressed ? t.suppressed : t.unsuppressed}
                        style={suppressButtonStyle(sup)}
                      >
                        {sup.suppressed ? '·' : '✓'}
                      </button>
                    </div>
                  );
                }
                const cell = resolveCell(cfg, row.feature.id, row.paramKey);
                return (
                  <div key={cfg.id} style={configCellStyle(cfg.id === activeId)}>
                    <CellEditor
                      cell={cell}
                      dictExpression={t.expression}
                      dictInherited={t.inherited}
                      onCommit={value => handleSetOverride(cfg.id, row.feature.id, row.paramKey, value)}
                      onClear={() => handleClearOverride(cfg.id, row.feature.id, row.paramKey)}
                      testId={`cell-${cfg.id}-${row.feature.id}-${row.paramKey}`}
                    />
                  </div>
                );
              })}
            </div>
          );
        })}
        {bottomSpacer > 0 && <div style={{ height: bottomSpacer }} />}
      </div>

      <ExpressionVarsPanel
        table={table}
        activeConfigId={activeId}
        lang={lang}
        onMutate={mutated}
      />
    </div>
  );
}

// ── Cell editor ────────────────────────────────────────────────────

type CellState =
  | { state: 'default'; value: undefined }
  | { state: 'inherited'; value: number | string; fromParent?: boolean }
  | { state: 'override'; value: number | string }
  | { state: 'expression'; value: string | number };

interface SuppressState {
  suppressed: boolean;
  source: 'direct' | 'inherited' | 'default';
}

interface CellEditorProps {
  cell: CellState;
  dictExpression: string;
  dictInherited: string;
  onCommit: (value: number | string) => void;
  onClear: () => void;
  testId: string;
}

function CellEditor(props: CellEditorProps): React.JSX.Element {
  const { cell, dictExpression, dictInherited, onCommit, onClear, testId } = props;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const display = useMemo(() => {
    if (cell.state === 'default') return '—';
    if (typeof cell.value === 'number') return cell.value.toFixed(2);
    return String(cell.value);
  }, [cell]);

  const commit = useCallback(
    (raw: string) => {
      const trimmed = raw.trim();
      setEditing(false);
      if (trimmed === '') {
        onClear();
        return;
      }
      const num = Number(trimmed);
      if (Number.isFinite(num) && /^[\d\-+.eE\s]+$/.test(trimmed)) {
        onCommit(num);
      } else {
        // Non-numeric → store as expression string.
        onCommit(trimmed);
      }
    },
    [onCommit, onClear],
  );

  if (editing) {
    return (
      <input
        data-testid={testId}
        autoFocus
        defaultValue={draft}
        onBlur={e => commit(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setEditing(false);
          }
        }}
        style={cellInputStyle}
      />
    );
  }

  const isInherited = cell.state === 'inherited';
  const isExpr = cell.state === 'expression' || (cell.state === 'override' && typeof cell.value === 'string');

  return (
    <span
      data-testid={testId}
      onClick={() => {
        setDraft(cell.state === 'default' ? '' : String(cell.value));
        setEditing(true);
      }}
      title={
        isInherited
          ? dictInherited
          : isExpr
            ? dictExpression
            : undefined
      }
      style={cellSpanStyle(cell.state)}
    >
      {isExpr && <span style={exprBadgeStyle}>=</span>}
      {display}
    </span>
  );
}

// ── Sub-components ─────────────────────────────────────────────────

function PanelHeader({
  t,
  onAddConfig,
  onClose,
  children,
}: {
  t: ReturnType<typeof pickDict>;
  onAddConfig: () => void;
  onClose?: () => void;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div style={panelHeaderStyle}>
      <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>
        {t.title}
      </span>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {children}
        <button
          data-testid="config-add"
          onClick={onAddConfig}
          style={addButtonStyle}
        >
          {t.add}
        </button>
        {onClose && (
          <button
            data-testid="config-close"
            onClick={onClose}
            style={closeButtonStyle}
            aria-label="Close"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}

// ── Styles (file-local) ────────────────────────────────────────────

const panelStyle: React.CSSProperties = {
  position: 'fixed',
  right: 16,
  top: 64,
  width: 'min(960px, calc(100vw - 32px))',
  maxHeight: `${MAX_HEIGHT_VH}vh`,
  background: C.bg,
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
  zIndex: 200,
  display: 'flex',
  flexDirection: 'column',
};

const panelHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '10px 14px',
  borderBottom: `1px solid ${C.border}`,
};

const headerRowStyle: React.CSSProperties = {
  display: 'flex',
  background: C.bg2,
  borderBottom: `1px solid ${C.border}`,
  position: 'sticky',
  top: 0,
  zIndex: 2,
  minHeight: HEADER_HEIGHT,
};

const headerCellStyle: React.CSSProperties = {
  flex: '0 0 120px',
  padding: '6px 8px',
  fontSize: 10,
  fontWeight: 600,
  color: C.muted,
  borderRight: `1px solid ${C.border}`,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
};

const scrollerStyle: React.CSSProperties = {
  overflow: 'auto',
  flex: 1,
};

function gridRowStyle(even: boolean): React.CSSProperties {
  return {
    display: 'flex',
    height: ROW_HEIGHT,
    background: even ? 'transparent' : 'var(--nx-panel-2-soft, transparent)',
    borderBottom: `1px solid ${C.border}`,
  };
}

const rowLabelCellStyle: React.CSSProperties = {
  flex: '0 0 220px',
  padding: '4px 8px',
  fontSize: 11,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  borderRight: `1px solid ${C.border}`,
  position: 'sticky',
  left: 0,
  background: C.bg,
};

const masterCellStyle: React.CSSProperties = {
  flex: '0 0 120px',
  padding: '4px 8px',
  fontSize: 11,
  color: C.muted,
  borderRight: `1px solid ${C.border}`,
  fontStyle: 'italic',
};

function configCellStyle(isActive: boolean): React.CSSProperties {
  return {
    flex: '0 0 120px',
    padding: '4px 8px',
    fontSize: 11,
    background: isActive ? C.active : 'transparent',
    borderRight: `1px solid ${C.border}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-start',
  };
}

function cellSpanStyle(state: CellState['state']): React.CSSProperties {
  return {
    cursor: 'pointer',
    color: state === 'default' ? C.muted : state === 'inherited' ? C.inherited : C.text,
    fontStyle: state === 'inherited' ? 'italic' : 'normal',
    fontWeight: state === 'override' || state === 'expression' ? 600 : 400,
    padding: '0 4px',
  };
}

const exprBadgeStyle: React.CSSProperties = {
  color: C.accent,
  fontFamily: 'monospace',
  marginRight: 2,
};

const cellInputStyle: React.CSSProperties = {
  width: 90,
  padding: '2px 4px',
  background: C.cellBg,
  color: C.text,
  border: `1px solid ${C.accent}`,
  borderRadius: 3,
  fontSize: 11,
};

function configNameInputStyle(isActive: boolean): React.CSSProperties {
  return {
    background: 'transparent',
    color: C.text,
    border: 'none',
    fontSize: 11,
    fontWeight: isActive ? 700 : 500,
    width: '100%',
    outline: 'none',
  };
}

function activateButtonStyle(isActive: boolean): React.CSSProperties {
  return {
    padding: '1px 6px',
    borderRadius: 3,
    border: `1px solid ${isActive ? C.accent : C.border}`,
    background: isActive ? C.accent : 'transparent',
    color: isActive ? 'var(--nx-text)' : C.muted,
    fontSize: 9,
    cursor: 'pointer',
  };
}

const parentSelectStyle: React.CSSProperties = {
  flex: 1,
  padding: '1px 2px',
  background: 'transparent',
  color: C.text,
  border: `1px solid ${C.border}`,
  borderRadius: 3,
  fontSize: 9,
};

const delButtonStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: C.danger,
  fontSize: 11,
  cursor: 'pointer',
  padding: '0 2px',
};

function suppressButtonStyle(state: SuppressState): React.CSSProperties {
  return {
    width: 18,
    height: 18,
    padding: 0,
    borderRadius: 3,
    border: `1px solid ${!state.suppressed ? C.accent : C.border}`,
    background: !state.suppressed ? C.accent + '33' : 'transparent',
    color: !state.suppressed ? C.accent : C.muted,
    fontSize: 11,
    cursor: 'pointer',
    opacity: state.source === 'inherited' ? 0.55 : 1,
    fontStyle: state.source === 'inherited' ? 'italic' : 'normal',
  };
}

const addButtonStyle: React.CSSProperties = {
  padding: '4px 10px',
  borderRadius: 4,
  border: `1px solid ${C.accent}`,
  background: C.accent + '22',
  color: C.accent,
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
};

const closeButtonStyle: React.CSSProperties = {
  width: 22,
  height: 22,
  padding: 0,
  borderRadius: 4,
  background: 'transparent',
  border: 'none',
  color: C.muted,
  fontSize: 16,
  cursor: 'pointer',
};
