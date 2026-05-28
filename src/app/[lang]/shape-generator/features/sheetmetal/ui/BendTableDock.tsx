'use client';

/**
 * BendTableDock.tsx — bottom dock showing the full Schema A K-factor table.
 *
 * Wave 2 Phase 2 Track B Week 5 (B5). Spec §6.4 — bend-table-fixed-dock.
 *
 * Columns: Material × R/t ratios (0.5 / 1 / 1.5 / 2 / 3 / 5 / 10).
 * Each cell = getKFactor(material, rt × t, t) for a unit thickness t=1
 * (since rt is a dimensionless ratio, the K-factor curve is t-invariant
 * when evaluated at a fixed R/t — useful as a quick-reference dock).
 *
 * Interactions:
 *   • Click cell → highlights + copies value to clipboard
 *   • Toolbar: refresh + copy-as-CSV + close + collapse/expand
 *
 * The dock is intentionally collapsible so it can be docked at the bottom
 * of the modeler shell without permanently consuming vertical real estate.
 *
 * NOTE: like SheetMetalRightPane, this is the isolated component. Wiring
 * into the actual BottomDrawer happens in the W7 integration step.
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  SHEET_METAL_MATERIALS,
  getKFactor,
  type SheetMetalMaterial,
} from '../../sheetMetalTables';
import { pickSheetMetalDict, type SheetMetalLang } from '../i18n';
import { K_FACTOR_RT_COLUMNS } from './SheetMetalRightPane';

export interface BendTableDockProps {
  lang?: SheetMetalLang | string;
  /** Initially collapsed? */
  initialCollapsed?: boolean;
  /** Callback when dock close button is clicked. */
  onClose?: () => void;
  /** Test hook — override clipboard for jsdom tests. */
  clipboard?: { writeText: (s: string) => Promise<void> };
}

interface CellId {
  material: SheetMetalMaterial;
  rt: number;
}

export function BendTableDock({
  lang,
  initialCollapsed = false,
  onClose,
  clipboard,
}: BendTableDockProps) {
  const t = pickSheetMetalDict(lang);
  const [collapsed, setCollapsed] = useState<boolean>(initialCollapsed);
  const [selectedCell, setSelectedCell] = useState<CellId | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [copiedMessage, setCopiedMessage] = useState<string | null>(null);

  // Effective clipboard — fall back to navigator.clipboard, then no-op.
  const cb = clipboard ?? (typeof navigator !== 'undefined' ? navigator.clipboard : undefined);

  // Build the full table — rows = materials, cols = R/t values.
  // K-factor is t-invariant when looked up at fixed R/t (curve is parametrised by rt).
  // We pick t=1 → R = rt × 1 = rt.
  const rows = useMemo(() => {
    const materials = Object.keys(SHEET_METAL_MATERIALS) as SheetMetalMaterial[];
    return materials.map(m => ({
      material: m,
      cells: K_FACTOR_RT_COLUMNS.map(rt => ({
        rt,
        k: getKFactor(m, rt, 1),
      })),
    }));
    // refreshKey causes re-memoization; the underlying data is static, but
    // we still trigger the refresh button for parity with the spec.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const handleRefresh = useCallback(() => {
    setRefreshKey(k => k + 1);
    setSelectedCell(null);
  }, []);

  const handleCsvExport = useCallback(async () => {
    const header = [t.kTableMaterialCol, ...K_FACTOR_RT_COLUMNS.map(r => `R/t=${r}`)].join(',');
    const dataLines = rows.map(({ material, cells }) => {
      return [localMaterialLabel(material, t), ...cells.map(c => c.k.toFixed(3))].join(',');
    });
    const csv = [header, ...dataLines].join('\n');
    try {
      if (cb && typeof cb.writeText === 'function') {
        await cb.writeText(csv);
      }
      setCopiedMessage(t.kTableCopiedToClipboard);
      setTimeout(() => setCopiedMessage(null), 1500);
    } catch {
      // best effort — jsdom clipboard may reject; the test passes the data via prop.
    }
  }, [rows, cb, t]);

  const handleCellClick = useCallback(
    async (material: SheetMetalMaterial, rt: number, k: number) => {
      setSelectedCell({ material, rt });
      try {
        if (cb && typeof cb.writeText === 'function') {
          await cb.writeText(k.toFixed(3));
        }
        setCopiedMessage(`${k.toFixed(3)} · ${t.kTableCopiedToClipboard}`);
        setTimeout(() => setCopiedMessage(null), 1500);
      } catch {
        /* swallow */
      }
    },
    [cb, t.kTableCopiedToClipboard],
  );

  return (
    <div
      data-testid="bend-table-dock"
      data-collapsed={collapsed || undefined}
      style={{
        background: 'var(--nx-panel, #18181b)',
        color: 'var(--nx-text, #e5e7eb)',
        border: '1px solid var(--nx-border, #2a2a2a)',
        borderRadius: 6,
        fontSize: 11,
      }}
    >
      {/* Toolbar */}
      <div
        data-testid="bend-table-dock-toolbar"
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 10px',
          borderBottom: collapsed ? 0 : '1px solid var(--nx-border, #2a2a2a)',
        }}
      >
        <span style={{ fontWeight: 700, flex: 1 }}>{t.dockTitle}</span>
        <button
          data-testid="bend-table-dock-refresh"
          onClick={handleRefresh}
          style={btnStyle()}
        >
          {t.refreshButton}
        </button>
        <button
          data-testid="bend-table-dock-csv"
          onClick={handleCsvExport}
          style={btnStyle()}
        >
          {t.exportCsvButton}
        </button>
        <button
          data-testid="bend-table-dock-toggle"
          onClick={() => setCollapsed(c => !c)}
          aria-label={collapsed ? t.dockExpand : t.dockCollapse}
          style={btnStyle()}
        >
          {collapsed ? t.dockExpand : t.dockCollapse}
        </button>
        {onClose && (
          <button
            data-testid="bend-table-dock-close"
            onClick={onClose}
            aria-label={t.dockClose}
            style={btnStyle()}
          >
            ×
          </button>
        )}
      </div>

      {/* Table */}
      {!collapsed && (
        <div style={{ maxHeight: 220, overflow: 'auto' }}>
          <table
            data-testid="bend-table-dock-table"
            style={{
              width: '100%', borderCollapse: 'collapse', fontSize: 11,
            }}
          >
            <thead>
              <tr>
                <th
                  style={{
                    textAlign: 'left', padding: '4px 8px',
                    borderBottom: '1px solid var(--nx-border, #2a2a2a)',
                    background: 'var(--nx-panel-2, #1f1f23)',
                    position: 'sticky', top: 0,
                  }}
                >
                  {t.kTableMaterialCol}
                </th>
                {K_FACTOR_RT_COLUMNS.map(rt => (
                  <th
                    key={rt}
                    data-testid={`bend-table-dock-header-${rt}`}
                    style={{
                      textAlign: 'right', padding: '4px 8px',
                      borderBottom: '1px solid var(--nx-border, #2a2a2a)',
                      background: 'var(--nx-panel-2, #1f1f23)',
                      position: 'sticky', top: 0,
                    }}
                  >
                    R/t = {rt}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ material, cells }) => (
                <tr
                  key={material}
                  data-testid={`bend-table-dock-row-${material}`}
                >
                  <td
                    style={{
                      padding: '3px 8px',
                      borderBottom: '1px solid var(--nx-border, #2a2a2a)',
                      color: 'var(--nx-text-2, #a1a1aa)',
                    }}
                  >
                    {localMaterialLabel(material, t)}
                  </td>
                  {cells.map(({ rt, k }) => {
                    const isSel =
                      selectedCell?.material === material && selectedCell?.rt === rt;
                    return (
                      <td
                        key={rt}
                        data-testid={`bend-table-dock-cell-${material}-${rt}`}
                        data-selected={isSel || undefined}
                        onClick={() => handleCellClick(material, rt, k)}
                        style={{
                          padding: '3px 8px',
                          textAlign: 'right',
                          fontFamily: 'monospace',
                          cursor: 'pointer',
                          borderBottom: '1px solid var(--nx-border, #2a2a2a)',
                          background: isSel
                            ? 'var(--nx-accent-soft, rgba(108, 182, 255, 0.18))'
                            : 'transparent',
                          fontWeight: isSel ? 700 : 400,
                          color: isSel ? 'var(--nx-accent, #6cb6ff)' : 'inherit',
                        }}
                      >
                        {k.toFixed(3)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {copiedMessage && (
        <div
          data-testid="bend-table-dock-copied-toast"
          style={{
            padding: '4px 10px', fontSize: 10,
            color: 'var(--nx-accent, #6cb6ff)',
            borderTop: '1px solid var(--nx-border, #2a2a2a)',
          }}
        >
          {copiedMessage}
        </div>
      )}
    </div>
  );
}

function btnStyle(): React.CSSProperties {
  return {
    padding: '2px 8px', height: 22,
    border: '1px solid var(--nx-border, #2a2a2a)',
    background: 'var(--nx-bg, #111114)', color: 'inherit',
    fontSize: 10, borderRadius: 3, cursor: 'pointer',
  };
}

function localMaterialLabel(
  id: SheetMetalMaterial,
  dict: ReturnType<typeof pickSheetMetalDict>,
): string {
  switch (id) {
    case 'mildSteel': return dict.materialMildSteel;
    case 'stainless304': return dict.materialStainless304;
    case 'aluminum5052': return dict.materialAluminum5052;
    case 'aluminum6061': return dict.materialAluminum6061;
    case 'galvanized': return dict.materialGalvanized;
    case 'brass': return dict.materialBrass;
    case 'copper': return dict.materialCopper;
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}

export default BendTableDock;
