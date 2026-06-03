'use client';

/**
 * OrdinateDimensionPanel — Phase 4.2 of NexyFab Pro own-CAD (ADR-013).
 *
 * Standalone control surface for the ordinate (baseline / CMM-style)
 * dimensioning engine (lib/drawing/ordinateDimension.ts). A single datum
 * origin fixes (0, 0); every point's value is its signed distance from the
 * origin along the chosen axis (x / y / both).
 *
 *   - Datum origin (x, y), axis, precision, unit controls.
 *   - Editable point table (id + x + y), add / delete.
 *   - Live: validates the chain on every change; when valid, shows the
 *     computed signed values; when invalid, shows the validation errors.
 *   - A compact SVG preview drawn from `buildOrdinateRenderHints` (datum
 *     axes + leader lines + staggered labels).
 *
 * Standalone-by-design: pure (no DOM/canvas) engine, mounts in jsdom. Does
 * NOT modify ordinateDimension.ts, sheet.ts, or SheetRenderer.tsx — it's a
 * working surface for laying out an ordinate chain before it's committed to
 * a sheet in a later phase.
 *
 * Test surface (data-testids):
 *   drawing-ordinate-panel
 *   drawing-ordinate-origin-x / -origin-y
 *   drawing-ordinate-axis / -precision / -unit
 *   drawing-ordinate-add-point
 *   drawing-ordinate-empty
 *   drawing-ordinate-errors
 *   drawing-ordinate-point-row-{key}
 *   drawing-ordinate-point-id-{key} / -x-{key} / -y-{key} / -del-{key}
 *   drawing-ordinate-value-{pointId}-{axis}
 *   drawing-ordinate-preview
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  validateOrdinateChain,
  computeOrdinateValues,
  buildOrdinateRenderHints,
  type OrdinateAxis,
  type OrdinateDimensionChain,
} from '@/lib/drawing/ordinateDimension';

export type { OrdinateDimensionChain } from '@/lib/drawing/ordinateDimension';

// ─── i18n (6 langs) ────────────────────────────────────────────────────────

export type DrawingLang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

interface Dict {
  title: string;
  origin: string;
  axis: string;
  axisX: string;
  axisY: string;
  axisBoth: string;
  precision: string;
  unit: string;
  addPoint: string;
  addToSheet: string;
  empty: string;
  values: string;
  point: string;
  preview: string;
}

const dict: Record<DrawingLang, Dict> = {
  ko: {
    title: '기준선 치수', origin: '원점', axis: '축',
    axisX: 'X', axisY: 'Y', axisBoth: 'X+Y',
    precision: '소수', unit: '단위', addPoint: '점 추가', addToSheet: '시트에 추가',
    empty: '점이 없습니다', values: '값', point: '점', preview: '미리보기',
  },
  en: {
    title: 'Ordinate Dimensions', origin: 'Origin', axis: 'Axis',
    axisX: 'X', axisY: 'Y', axisBoth: 'X+Y',
    precision: 'Decimals', unit: 'Unit', addPoint: 'Add point', addToSheet: 'Add to sheet',
    empty: 'No points yet', values: 'Values', point: 'Point', preview: 'Preview',
  },
  ja: {
    title: '基準線寸法', origin: '原点', axis: '軸',
    axisX: 'X', axisY: 'Y', axisBoth: 'X+Y',
    precision: '小数', unit: '単位', addPoint: '点を追加', addToSheet: 'シートに追加',
    empty: '点がありません', values: '値', point: '点', preview: 'プレビュー',
  },
  zh: {
    title: '基准线尺寸', origin: '原点', axis: '轴',
    axisX: 'X', axisY: 'Y', axisBoth: 'X+Y',
    precision: '小数', unit: '单位', addPoint: '添加点', addToSheet: '添加到图纸',
    empty: '尚无点', values: '值', point: '点', preview: '预览',
  },
  es: {
    title: 'Cotas de ordenada', origin: 'Origen', axis: 'Eje',
    axisX: 'X', axisY: 'Y', axisBoth: 'X+Y',
    precision: 'Decimales', unit: 'Unidad', addPoint: 'Añadir punto', addToSheet: 'Añadir a la hoja',
    empty: 'Sin puntos', values: 'Valores', point: 'Punto', preview: 'Vista previa',
  },
  ar: {
    title: 'أبعاد خط الأساس', origin: 'الأصل', axis: 'المحور',
    axisX: 'X', axisY: 'Y', axisBoth: 'X+Y',
    precision: 'الكسور', unit: 'الوحدة', addPoint: 'إضافة نقطة', addToSheet: 'إضافة إلى الورقة',
    empty: 'لا توجد نقاط بعد', values: 'القيم', point: 'نقطة', preview: 'معاينة',
  },
};

// ─── types ────────────────────────────────────────────────────────────────

/** One editable point row. `key` is a stable internal id (survives id edits). */
interface PointRow {
  key: string;
  id: string;
  x: string;
  y: string;
}

export interface OrdinateDimensionPanelProps {
  /** Accepts the page's raw lang string; resolved via pickDict (default en). */
  lang?: string;
  initialPoints?: ReadonlyArray<{ id: string; x: number; y: number }>;
  /**
   * When provided, an "Add to sheet" button appears (enabled only while the
   * chain is valid). It hands the current chain to the host, which assigns a
   * unique id and appends it to the Sheet IR so SheetRenderer draws it.
   */
  onCommit?: (chain: OrdinateDimensionChain) => void;
}

/** Resolve a (possibly unknown) lang string to a dict, mirroring the sibling
 *  drawing panels: 'cn' aliases 'zh', anything unknown falls back to en. */
function pickDict(lang: string): Dict {
  const key = lang === 'cn' ? 'zh' : lang;
  return dict[key as DrawingLang] ?? dict.en;
}

// ─── helpers ────────────────────────────────────────────────────────────────

function num(raw: string): number {
  const n = Number(raw.trim());
  return Number.isFinite(n) ? n : NaN;
}

// ─── component ────────────────────────────────────────────────────────────

export default function OrdinateDimensionPanel({
  lang = 'en',
  initialPoints,
  onCommit,
}: OrdinateDimensionPanelProps): React.ReactElement {
  const t = pickDict(lang);
  const counter = useRef<number>(0);
  const nextKey = useCallback((): string => `p${counter.current++}`, []);

  const [originX, setOriginX] = useState<string>('0');
  const [originY, setOriginY] = useState<string>('0');
  const [axis, setAxis] = useState<OrdinateAxis>('x');
  const [precision, setPrecision] = useState<string>('2');
  const [unit, setUnit] = useState<'mm' | 'in'>('mm');
  const [rows, setRows] = useState<PointRow[]>(() =>
    (initialPoints ?? []).map((p) => ({ key: nextKey(), id: p.id, x: String(p.x), y: String(p.y) })),
  );

  const addRow = useCallback((): void => {
    setRows((prev) => [...prev, { key: nextKey(), id: `P${prev.length + 1}`, x: '0', y: '0' }]);
  }, [nextKey]);

  const removeRow = useCallback((key: string): void => {
    setRows((prev) => prev.filter((r) => r.key !== key));
  }, []);

  const setField = useCallback(
    (key: string, field: 'id' | 'x' | 'y', value: string): void => {
      setRows((prev) => prev.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
    },
    [],
  );

  // Assemble the chain IR from the current inputs. Coords that fail to parse
  // become NaN so the engine's validator surfaces them as errors.
  const chain = useMemo<OrdinateDimensionChain>(() => {
    const prec = num(precision);
    return {
      id: 'panel-chain',
      origin: { x: num(originX), y: num(originY) },
      axis,
      precision: Number.isInteger(prec) ? prec : undefined,
      unit,
      points: rows.map((r) => ({ id: r.id.trim(), x: num(r.x), y: num(r.y) })),
    };
  }, [originX, originY, axis, precision, unit, rows]);

  const validation = useMemo(() => validateOrdinateChain(chain), [chain]);
  const values = useMemo(
    () => (validation.ok ? computeOrdinateValues(chain) : []),
    [validation.ok, chain],
  );
  const hints = useMemo(
    () => (validation.ok ? buildOrdinateRenderHints(chain) : []),
    [validation.ok, chain],
  );

  // Format a value lookup for the table: pointId+axis → formatted string.
  const formattedByKey = useMemo(() => {
    const m = new Map<string, string>();
    for (const v of values) m.set(`${v.pointId}-${v.axis}`, v.formatted);
    return m;
  }, [values]);

  // ─── render ────────────────────────────────────────────────────────────

  return (
    <div
      data-testid="drawing-ordinate-panel"
      dir={lang === 'ar' ? 'rtl' : 'ltr'}
      style={{
        display: 'flex', flexDirection: 'column', gap: 8,
        padding: 10, background: '#ffffff',
        border: '1px solid #e5e7eb', borderRadius: 6,
        fontFamily: 'system-ui, sans-serif', fontSize: 12, color: '#111827',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{t.title}</h3>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            data-testid="drawing-ordinate-add-point"
            onClick={addRow}
            style={{
              padding: '4px 10px', fontSize: 11, background: '#0f172a', color: '#fff',
              border: 'none', borderRadius: 4, cursor: 'pointer',
            }}
          >
            {t.addPoint}
          </button>
          {onCommit && (
            <button
              type="button"
              data-testid="drawing-ordinate-commit"
              onClick={() => onCommit(chain)}
              disabled={!validation.ok}
              title={validation.ok ? undefined : validation.errors[0]}
              style={{
                padding: '4px 10px', fontSize: 11,
                background: validation.ok ? '#0e7490' : '#f3f4f6',
                color: validation.ok ? '#fff' : '#9ca3af',
                border: '1px solid ' + (validation.ok ? '#0e7490' : '#e5e7eb'),
                borderRadius: 4,
                cursor: validation.ok ? 'pointer' : 'not-allowed',
              }}
            >
              {t.addToSheet}
            </button>
          )}
        </div>
      </header>

      {/* datum + axis controls */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ color: '#6b7280' }}>{t.origin}</span>
          <input
            data-testid="drawing-ordinate-origin-x" type="number" aria-label={`${t.origin} X`}
            value={originX} onChange={(e) => setOriginX(e.target.value)}
            style={{ width: 56, fontSize: 11, padding: '2px 4px', border: '1px solid #d1d5db', borderRadius: 3 }}
          />
          <input
            data-testid="drawing-ordinate-origin-y" type="number" aria-label={`${t.origin} Y`}
            value={originY} onChange={(e) => setOriginY(e.target.value)}
            style={{ width: 56, fontSize: 11, padding: '2px 4px', border: '1px solid #d1d5db', borderRadius: 3 }}
          />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ color: '#6b7280' }}>{t.axis}</span>
          <select
            data-testid="drawing-ordinate-axis" value={axis}
            onChange={(e) => setAxis(e.target.value as OrdinateAxis)}
            style={{ fontSize: 11, padding: '2px 4px', border: '1px solid #d1d5db', borderRadius: 3 }}
          >
            <option value="x">{t.axisX}</option>
            <option value="y">{t.axisY}</option>
            <option value="both">{t.axisBoth}</option>
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ color: '#6b7280' }}>{t.precision}</span>
          <input
            data-testid="drawing-ordinate-precision" type="number" min={0} max={12}
            value={precision} onChange={(e) => setPrecision(e.target.value)}
            style={{ width: 44, fontSize: 11, padding: '2px 4px', border: '1px solid #d1d5db', borderRadius: 3 }}
          />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ color: '#6b7280' }}>{t.unit}</span>
          <select
            data-testid="drawing-ordinate-unit" value={unit}
            onChange={(e) => setUnit(e.target.value as 'mm' | 'in')}
            style={{ fontSize: 11, padding: '2px 4px', border: '1px solid #d1d5db', borderRadius: 3 }}
          >
            <option value="mm">mm</option>
            <option value="in">in</option>
          </select>
        </label>
      </div>

      {/* points table */}
      {rows.length === 0 ? (
        <div
          data-testid="drawing-ordinate-empty"
          style={{ fontSize: 11, color: '#9ca3af', textAlign: 'center', padding: '8px 0' }}
        >
          {t.empty}
        </div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {rows.map((r) => {
            const vx = formattedByKey.get(`${r.id.trim()}-x`);
            const vy = formattedByKey.get(`${r.id.trim()}-y`);
            return (
              <li
                key={r.key}
                data-testid={`drawing-ordinate-point-row-${r.key}`}
                style={{ display: 'flex', alignItems: 'center', gap: 4 }}
              >
                <input
                  data-testid={`drawing-ordinate-point-id-${r.key}`}
                  aria-label={t.point} value={r.id}
                  onChange={(e) => setField(r.key, 'id', e.target.value)}
                  style={{ width: 56, fontSize: 11, padding: '2px 4px', border: '1px solid #d1d5db', borderRadius: 3 }}
                />
                <input
                  data-testid={`drawing-ordinate-point-x-${r.key}`}
                  type="number" aria-label={`${r.id} X`} value={r.x}
                  onChange={(e) => setField(r.key, 'x', e.target.value)}
                  style={{ width: 56, fontSize: 11, padding: '2px 4px', border: '1px solid #d1d5db', borderRadius: 3 }}
                />
                <input
                  data-testid={`drawing-ordinate-point-y-${r.key}`}
                  type="number" aria-label={`${r.id} Y`} value={r.y}
                  onChange={(e) => setField(r.key, 'y', e.target.value)}
                  style={{ width: 56, fontSize: 11, padding: '2px 4px', border: '1px solid #d1d5db', borderRadius: 3 }}
                />
                <span style={{ flex: '1 1 auto', textAlign: 'right', color: '#0e7490', fontVariantNumeric: 'tabular-nums' }}>
                  {vx !== undefined && (
                    <span data-testid={`drawing-ordinate-value-${r.id.trim()}-x`} style={{ marginInlineStart: 6 }}>
                      X {vx}
                    </span>
                  )}
                  {vy !== undefined && (
                    <span data-testid={`drawing-ordinate-value-${r.id.trim()}-y`} style={{ marginInlineStart: 6 }}>
                      Y {vy}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  data-testid={`drawing-ordinate-point-del-${r.key}`}
                  onClick={() => removeRow(r.key)}
                  style={{
                    padding: '2px 6px', fontSize: 11, background: '#fff', color: '#dc2626',
                    border: '1px solid #fca5a5', borderRadius: 3, cursor: 'pointer',
                  }}
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* validation errors */}
      {!validation.ok && (
        <div
          data-testid="drawing-ordinate-errors"
          style={{
            fontSize: 11, color: '#b91c1c', background: '#fef2f2',
            border: '1px solid #fecaca', borderRadius: 4, padding: '4px 6px',
          }}
        >
          <ul style={{ margin: 0, paddingInlineStart: 16 }}>
            {validation.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {/* SVG preview built from buildOrdinateRenderHints */}
      {validation.ok && hints.length > 0 && (
        <OrdinatePreview hints={hints} label={t.preview} />
      )}
    </div>
  );
}

// ─── preview ─────────────────────────────────────────────────────────────

function OrdinatePreview({
  hints,
  label,
}: {
  hints: ReturnType<typeof buildOrdinateRenderHints>;
  label: string;
}): React.ReactElement {
  // Fit all leader endpoints into a padded viewBox.
  const pts = hints.flatMap((h) => [h.leaderStart, h.leaderEnd]);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(0, ...xs) - 8;
  const maxX = Math.max(0, ...xs) + 24;
  const minY = Math.min(0, ...ys) - 8;
  const maxY = Math.max(0, ...ys) + 8;
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);

  return (
    <figure style={{ margin: 0 }}>
      <figcaption style={{ fontSize: 11, color: '#6b7280', marginBottom: 2 }}>{label}</figcaption>
      <svg
        data-testid="drawing-ordinate-preview"
        viewBox={`${minX} ${minY} ${w} ${h}`}
        width="100%"
        height={120}
        // Sheet Y grows downward in CAD; flip so the preview reads naturally.
        style={{ border: '1px solid #e5e7eb', borderRadius: 4, background: '#fafafa', transform: 'scaleY(-1)' }}
      >
        {/* datum origin marker */}
        <circle cx={0} cy={0} r={1.6} fill="#0f172a" />
        {hints.map((hint, i) => (
          <g key={`${hint.pointId}-${hint.axis}-${i}`}>
            <line
              x1={hint.leaderStart.x} y1={hint.leaderStart.y}
              x2={hint.leaderEnd.x} y2={hint.leaderEnd.y}
              stroke="#0e7490" strokeWidth={0.5}
            />
            <circle cx={hint.leaderStart.x} cy={hint.leaderStart.y} r={1} fill="#0e7490" />
          </g>
        ))}
      </svg>
    </figure>
  );
}
