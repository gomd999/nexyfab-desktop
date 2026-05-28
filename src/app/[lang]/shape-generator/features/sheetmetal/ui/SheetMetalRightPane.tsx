'use client';

/**
 * SheetMetalRightPane.tsx — Korean-first sheet metal right pane (B5, spec §6.3).
 *
 * Wave 2 Phase 2 Track B Week 5. Renders the right-pane property block
 * documented in `docs/wave-2-phase-2-sheet-metal-spec.md` §6.3:
 *
 *   • Material picker (Schema A — see features/sheetMetalTables.ts)
 *   • Thickness slider
 *   • K-factor table condensed view (R/t ∈ {0.5, 1, 1.5, 2, 3, 5, 10})
 *     with the current R/t row highlighted
 *   • Bend allowance preview for a sample (R=2, t=2, θ=90°)
 *   • "Auto-drawing" button that opens AutoDrawingDialog
 *
 * The component is intentionally self-contained — it takes raw props and
 * does not subscribe to any Zustand store, so it is trivially testable in
 * jsdom (15+ cases in `__tests__/SheetMetalRightPane.test.tsx`).
 *
 * NOTE: this is the *isolated* component. The actual mounting into
 * ModelerRightPane is a follow-up integration step — B5 ships the pane
 * shell + tests + i18n; integration follows in W7 when sheet-metal feature
 * tree selection becomes wired (B4 follow-up).
 */

import React, { useMemo, useState, useCallback } from 'react';
import {
  SHEET_METAL_MATERIALS,
  DEFAULT_MATERIAL,
  getKFactor,
  bendAllowance,
  type SheetMetalMaterial,
} from '../../sheetMetalTables';
import { pickSheetMetalDict, type SheetMetalLang } from '../i18n';
import { AutoDrawingDialog } from './AutoDrawingDialog';

// R/t column set per spec §6.3 + tracker B5 description.
export const K_FACTOR_RT_COLUMNS: readonly number[] = [0.5, 1, 1.5, 2, 3, 5, 10];

export interface SheetMetalRightPaneProps {
  lang?: SheetMetalLang | string;
  /** Initial material. Defaults to mildSteel (SPCC) — Korean market default. */
  initialMaterial?: SheetMetalMaterial;
  /** Initial thickness in mm. Defaults to 1.5 mm (spec §2.2). */
  initialThickness?: number;
  /** Initial inner bend radius. Used to choose the highlighted row. */
  initialRadius?: number;
  /** Test hook — invoked with the current state every time it changes. */
  onChange?: (state: SheetMetalPaneState) => void;
}

export interface SheetMetalPaneState {
  material: SheetMetalMaterial;
  thickness: number;
  radius: number;
  /** Computed K-factor for (material, radius, thickness). */
  kFactor: number;
  /** Computed BA for the sample bend (R=2, t=2, θ=90°). */
  sampleBendAllowance: number;
}

function asLangKey(lang: SheetMetalLang | string | undefined): SheetMetalLang | string | undefined {
  return lang;
}

export function SheetMetalRightPane({
  lang,
  initialMaterial = DEFAULT_MATERIAL,
  initialThickness = 1.5,
  initialRadius = 1.5,
  onChange,
}: SheetMetalRightPaneProps) {
  const t = pickSheetMetalDict(asLangKey(lang));

  const [material, setMaterial] = useState<SheetMetalMaterial>(initialMaterial);
  const [thickness, setThickness] = useState<number>(initialThickness);
  const [radius, setRadius] = useState<number>(initialRadius);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Current R/t value — used to highlight the matching column.
  const currentRt = thickness > 0 ? radius / thickness : 0;

  // Derived K-factor for the current (material, R, t).
  const currentK = useMemo(
    () => getKFactor(material, radius, thickness),
    [material, radius, thickness],
  );

  // Sample bend allowance for the preview row (R=2, t=2, θ=90°).
  const sampleBA = useMemo(() => {
    const sampleR = 2;
    const sampleT = 2;
    const sampleAngle = 90;
    const sampleK = getKFactor(material, sampleR, sampleT);
    return bendAllowance(sampleAngle, sampleR, sampleT, sampleK);
  }, [material]);

  // Notify parent of state changes (test hook).
  React.useEffect(() => {
    onChange?.({
      material,
      thickness,
      radius,
      kFactor: currentK,
      sampleBendAllowance: sampleBA,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [material, thickness, radius, currentK, sampleBA]);

  const handleOpenDialog = useCallback(() => setDialogOpen(true), []);
  const handleCloseDialog = useCallback(() => setDialogOpen(false), []);

  // K-factor table row for currently-selected material across R/t columns.
  const kRow = useMemo(() => {
    return K_FACTOR_RT_COLUMNS.map(rt => {
      // For column-row computation we hold t at the user's t and use R = rt × t.
      const r = rt * thickness;
      return { rt, k: getKFactor(material, r, thickness) };
    });
  }, [material, thickness]);

  return (
    <div
      data-testid="sheet-metal-right-pane"
      style={{
        padding: '8px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        fontSize: 12,
        color: 'var(--nx-text, #e5e7eb)',
      }}
    >
      <h2
        data-testid="sheet-metal-pane-title"
        style={{ margin: 0, fontSize: 13, fontWeight: 700 }}
      >
        {t.rightPaneTitle}
      </h2>

      {/* ─── Material section ───────────────────────────── */}
      <section data-testid="sheet-metal-section-material">
        <label
          style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}
        >
          {t.sectionMaterial}
        </label>
        <select
          data-testid="sheet-metal-material-select"
          value={material}
          onChange={e => setMaterial(e.target.value as SheetMetalMaterial)}
          style={{
            width: '100%', padding: '4px 8px', borderRadius: 4,
            border: '1px solid var(--nx-border, #2a2a2a)',
            background: 'var(--nx-bg, #1a1a1a)', color: 'inherit', fontSize: 12,
          }}
        >
          {(Object.keys(SHEET_METAL_MATERIALS) as SheetMetalMaterial[]).map(id => (
            <option key={id} value={id}>
              {localMaterialLabel(id, t)}
            </option>
          ))}
        </select>
      </section>

      {/* ─── Thickness section ──────────────────────────── */}
      <section data-testid="sheet-metal-section-thickness">
        <div
          style={{
            display: 'flex', justifyContent: 'space-between',
            fontSize: 11, fontWeight: 600, marginBottom: 4,
          }}
        >
          <span>{t.sectionThickness}</span>
          <span
            data-testid="sheet-metal-thickness-value"
            style={{ color: 'var(--nx-accent, #6cb6ff)' }}
          >
            {thickness.toFixed(2)} mm
          </span>
        </div>
        <input
          data-testid="sheet-metal-thickness-slider"
          type="range"
          min={0.5}
          max={10}
          step={0.1}
          value={thickness}
          onChange={e => setThickness(Number(e.target.value))}
          style={{ width: '100%' }}
        />
      </section>

      {/* ─── Inner radius row ──────────────────────────── */}
      <section data-testid="sheet-metal-section-radius">
        <div
          style={{
            display: 'flex', justifyContent: 'space-between',
            fontSize: 11, fontWeight: 600, marginBottom: 4,
          }}
        >
          <span>{t.radiusLabel}</span>
          <span
            data-testid="sheet-metal-radius-value"
            style={{ color: 'var(--nx-accent, #6cb6ff)' }}
          >
            {radius.toFixed(2)} mm
          </span>
        </div>
        <input
          data-testid="sheet-metal-radius-slider"
          type="range"
          min={0.5}
          max={20}
          step={0.1}
          value={radius}
          onChange={e => setRadius(Number(e.target.value))}
          style={{ width: '100%' }}
        />
      </section>

      {/* ─── K-factor table (condensed) ──────────────────── */}
      <section data-testid="sheet-metal-section-k-table">
        <div
          style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}
        >
          {t.sectionKFactorTable}
        </div>
        <table
          data-testid="sheet-metal-k-table"
          style={{
            width: '100%', borderCollapse: 'collapse', fontSize: 11,
          }}
        >
          <thead>
            <tr>
              <th
                style={{
                  textAlign: 'left', padding: '2px 6px',
                  borderBottom: '1px solid var(--nx-border, #2a2a2a)',
                  fontWeight: 600,
                }}
              >
                {t.kTableRatioCol}
              </th>
              {K_FACTOR_RT_COLUMNS.map(rt => (
                <th
                  key={rt}
                  data-testid={`k-table-header-${rt}`}
                  style={{
                    textAlign: 'right', padding: '2px 6px',
                    borderBottom: '1px solid var(--nx-border, #2a2a2a)',
                    fontWeight: 600,
                  }}
                >
                  {rt}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td
                style={{
                  padding: '2px 6px', color: 'var(--nx-text-2, #a1a1aa)',
                }}
              >
                {t.kTableValueCol}
              </td>
              {kRow.map(({ rt, k }) => {
                const isCurrent = closestRtColumn(currentRt) === rt;
                return (
                  <td
                    key={rt}
                    data-testid={`k-table-cell-${rt}`}
                    data-current={isCurrent || undefined}
                    style={{
                      padding: '2px 6px',
                      textAlign: 'right',
                      fontFamily: 'monospace',
                      background: isCurrent
                        ? 'var(--nx-accent-soft, rgba(108, 182, 255, 0.18))'
                        : 'transparent',
                      color: isCurrent ? 'var(--nx-accent, #6cb6ff)' : 'inherit',
                      fontWeight: isCurrent ? 700 : 400,
                    }}
                  >
                    {k.toFixed(3)}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
        <div
          data-testid="sheet-metal-current-rt"
          style={{ fontSize: 10, color: 'var(--nx-text-3, #71717a)', marginTop: 4 }}
        >
          {t.highlightedRow}: {currentRt.toFixed(2)} · {t.kFactorLabel} ={' '}
          <span style={{ color: 'var(--nx-accent, #6cb6ff)' }}>{currentK.toFixed(3)}</span>
        </div>
      </section>

      {/* ─── Bend-allowance preview ─────────────────────── */}
      <section data-testid="sheet-metal-section-ba-preview">
        <div
          style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}
        >
          {t.sectionBendPreview}
        </div>
        <div
          style={{
            padding: 8, borderRadius: 4,
            background: 'var(--nx-panel-2, #1f1f23)',
            fontSize: 11, lineHeight: 1.6,
          }}
        >
          <div style={{ color: 'var(--nx-text-2, #a1a1aa)' }}>
            {t.bendPreviewSampleLine}
          </div>
          <div
            data-testid="sheet-metal-ba-formula"
            style={{ fontFamily: 'monospace', color: 'var(--nx-text-3, #71717a)' }}
          >
            {t.bendPreviewFormulaLine}
          </div>
          <div
            data-testid="sheet-metal-ba-value"
            style={{
              fontFamily: 'monospace', color: 'var(--nx-accent, #6cb6ff)',
              fontWeight: 700, marginTop: 4,
            }}
          >
            {t.bendAllowanceLabel} = {sampleBA.toFixed(3)} mm
          </div>
        </div>
      </section>

      {/* ─── Auto-drawing button ───────────────────────── */}
      <button
        data-testid="sheet-metal-auto-drawing-button"
        onClick={handleOpenDialog}
        style={{
          width: '100%', padding: '8px 12px', borderRadius: 4,
          border: 0, fontSize: 12, fontWeight: 700, cursor: 'pointer',
          background: 'var(--nx-accent, #6cb6ff)', color: '#fff',
        }}
      >
        {t.autoDrawingButton}
      </button>

      {dialogOpen && (
        <AutoDrawingDialog
          lang={lang}
          material={material}
          thickness={thickness}
          onClose={handleCloseDialog}
        />
      )}
    </div>
  );
}

/** Pick the K-factor table column closest to a given current R/t value.
 *  Used for the highlighted-cell logic — `currentRt` is rarely exactly
 *  one of the discrete columns (0.5 / 1 / 1.5 / 2 / 3 / 5 / 10), so we
 *  snap to the nearest one. */
export function closestRtColumn(currentRt: number): number {
  let best = K_FACTOR_RT_COLUMNS[0];
  let bestDist = Math.abs(currentRt - best);
  for (const rt of K_FACTOR_RT_COLUMNS) {
    const d = Math.abs(currentRt - rt);
    if (d < bestDist) {
      best = rt;
      bestDist = d;
    }
  }
  return best;
}

/** Localised material label. */
function localMaterialLabel(id: SheetMetalMaterial, dict: ReturnType<typeof pickSheetMetalDict>): string {
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

export default SheetMetalRightPane;
