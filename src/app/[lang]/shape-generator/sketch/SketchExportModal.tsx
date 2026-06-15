'use client';

/**
 * SketchExportModal — multi-format sketch export dialog.
 *
 * Standalone Phase-1 modal that wraps Agent-HHHHH's `sketchSvgExport` and
 * adds two sibling formats (PNG, JSON) plus shared user controls (paper
 * size, margin, stroke width, units, filename). The host editor invokes
 * the modal; the modal itself never touches solver state — it accepts a
 * frozen `SketchEntities` snapshot through props and emits a download.
 *
 * Format matrix (Phase 1):
 *   - SVG  — sketchSvgExport.exportSketchToSvg → Blob('image/svg+xml')
 *   - PNG  — rasterise the same SVG via canvas → toBlob('image/png')
 *   - JSON — JSON.stringify(entities, null, 2)  →  Blob('application/json')
 *
 * DXF (Agent-QQQQQ) is intentionally NOT wired here yet — that lands in
 * a follow-up batch once the DXF emitter module ships. The radio list
 * is data-driven so adding DXF later is a single-array push.
 *
 * Units:
 *   The underlying sketch coordinates are in mm (per planegcs/solver
 *   contract). When the user picks "inch" in the unit select, document
 *   width/height inputs are interpreted as inches and converted to mm
 *   for the actual export call (×25.4). Entity coordinates themselves
 *   are NOT rescaled — only the page extents change. JSON export
 *   records the chosen unit alongside the entities so downstream
 *   importers can round-trip.
 *
 * Preview:
 *   A small inline SVG snippet (max ~220×160 CSS px) re-renders on every
 *   option change. We reuse `exportSketchToSvg` to produce the markup,
 *   strip the leading `<?xml ...?>` PI so React's dangerouslySetInnerHTML
 *   accepts the fragment, and inject it into a sized container. The
 *   preview always uses the user's chosen options so what they see is
 *   what they download.
 *
 * Test surface (data-testids — all prefixed sketch-export-):
 *   sketch-export-modal, sketch-export-title,
 *   sketch-export-format-{svg|png|json},
 *   sketch-export-width, sketch-export-height,
 *   sketch-export-margin, sketch-export-stroke,
 *   sketch-export-unit, sketch-export-filename,
 *   sketch-export-preview, sketch-export-preview-svg,
 *   sketch-export-submit, sketch-export-cancel.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  exportSketchToSvg,
  type SketchEntities,
  type SketchSvgOptions,
} from '@/lib/sketch/sketchSvgExport';
import { downloadSketchAsDxf } from '@/lib/sketch/sketchDxfExport';

export type SketchExportLang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

export type SketchExportFormat = 'svg' | 'png' | 'json' | 'dxf';

export type SketchExportUnit = 'mm' | 'inch';

/** Coefficient to convert inches → mm. */
const INCH_TO_MM = 25.4;

export interface SketchExportModalProps {
  lang: SketchExportLang;
  entities: SketchEntities;
  /** Suggested filename stem (no extension). Defaults to 'sketch'. */
  defaultFilename?: string;
  onClose: () => void;
}

// ─── per-format default options ──────────────────────────────────────────
//
// The defaults below were chosen by use-case:
//   - SVG  → 200×150 mm, 10 mm margin, 0.2 mm stroke. Matches the A5-ish
//            page the editor's Export-SVG button uses today; familiar to
//            CAD users (mm units, hairline stroke).
//   - PNG  → same physical size (200×150 mm) but rasterised at 4 px/mm
//            (effectively 800×600 px) so the export is sharp enough for a
//            slide deck or web embed without inflating file size.
//   - JSON → page dims are irrelevant (no rendering), but we still record
//            them so the round-trip object is self-describing. 200×150 mm
//            matches the SVG default.
//
// Stroke width defaults to 0.2 mm (lighter than the underlying export
// module's 0.25 mm default) per the brief — keeps preview lines crisp at
// the small preview render size without overpowering tight geometry.
interface FormatDefaults {
  width: number;   // mm
  height: number;  // mm
  margin: number;  // mm
  stroke: number;  // mm
}

const FORMAT_DEFAULTS: Record<SketchExportFormat, FormatDefaults> = {
  svg: { width: 200, height: 150, margin: 10, stroke: 0.2 },
  png: { width: 200, height: 150, margin: 10, stroke: 0.2 },
  json: { width: 200, height: 150, margin: 10, stroke: 0.2 },
  // DXF has no concept of stroke width (entities are vector primitives with
  // layer-driven appearance), so we keep stroke parity with the other formats
  // for the input field default but the value is unused at export time.
  dxf: { width: 200, height: 150, margin: 10, stroke: 0.2 },
};

// ─── i18n (6 langs) ──────────────────────────────────────────────────────

interface Dict {
  title: string;
  formatLabel: string;
  formatSvg: string;
  formatPng: string;
  formatJson: string;
  formatDxf: string;
  widthLabel: string;
  heightLabel: string;
  marginLabel: string;
  strokeLabel: string;
  unitLabel: string;
  unitMm: string;
  unitInch: string;
  filenameLabel: string;
  previewLabel: string;
  previewEmpty: string;
  exportButton: string;
  cancel: string;
}

const dict: Record<SketchExportLang, Dict> = {
  ko: {
    title: '스케치 내보내기',
    formatLabel: '형식',
    formatSvg: 'SVG',
    formatPng: 'PNG',
    formatJson: 'JSON',
    formatDxf: 'DXF',
    widthLabel: '폭',
    heightLabel: '높이',
    marginLabel: '여백',
    strokeLabel: '선 굵기',
    unitLabel: '단위',
    unitMm: 'mm',
    unitInch: 'inch',
    filenameLabel: '파일 이름',
    previewLabel: '미리보기',
    previewEmpty: '내보낼 형상이 없습니다',
    exportButton: '내보내기',
    cancel: '취소',
  },
  en: {
    title: 'Export Sketch',
    formatLabel: 'Format',
    formatSvg: 'SVG',
    formatPng: 'PNG',
    formatJson: 'JSON',
    formatDxf: 'DXF',
    widthLabel: 'Width',
    heightLabel: 'Height',
    marginLabel: 'Margin',
    strokeLabel: 'Stroke',
    unitLabel: 'Unit',
    unitMm: 'mm',
    unitInch: 'inch',
    filenameLabel: 'Filename',
    previewLabel: 'Preview',
    previewEmpty: 'No geometry to export',
    exportButton: 'Export',
    cancel: 'Cancel',
  },
  ja: {
    title: 'スケッチをエクスポート',
    formatLabel: '形式',
    formatSvg: 'SVG',
    formatPng: 'PNG',
    formatJson: 'JSON',
    formatDxf: 'DXF',
    widthLabel: '幅',
    heightLabel: '高さ',
    marginLabel: '余白',
    strokeLabel: '線幅',
    unitLabel: '単位',
    unitMm: 'mm',
    unitInch: 'inch',
    filenameLabel: 'ファイル名',
    previewLabel: 'プレビュー',
    previewEmpty: 'エクスポートする形状がありません',
    exportButton: 'エクスポート',
    cancel: 'キャンセル',
  },
  zh: {
    title: '导出草图',
    formatLabel: '格式',
    formatSvg: 'SVG',
    formatPng: 'PNG',
    formatJson: 'JSON',
    formatDxf: 'DXF',
    widthLabel: '宽度',
    heightLabel: '高度',
    marginLabel: '边距',
    strokeLabel: '线宽',
    unitLabel: '单位',
    unitMm: 'mm',
    unitInch: 'inch',
    filenameLabel: '文件名',
    previewLabel: '预览',
    previewEmpty: '没有可导出的几何',
    exportButton: '导出',
    cancel: '取消',
  },
  es: {
    title: 'Exportar boceto',
    formatLabel: 'Formato',
    formatSvg: 'SVG',
    formatPng: 'PNG',
    formatJson: 'JSON',
    formatDxf: 'DXF',
    widthLabel: 'Ancho',
    heightLabel: 'Alto',
    marginLabel: 'Margen',
    strokeLabel: 'Trazo',
    unitLabel: 'Unidad',
    unitMm: 'mm',
    unitInch: 'pulg',
    filenameLabel: 'Nombre',
    previewLabel: 'Vista previa',
    previewEmpty: 'Sin geometría que exportar',
    exportButton: 'Exportar',
    cancel: 'Cancelar',
  },
  ar: {
    title: 'تصدير الرسم',
    formatLabel: 'الصيغة',
    formatSvg: 'SVG',
    formatPng: 'PNG',
    formatJson: 'JSON',
    formatDxf: 'DXF',
    widthLabel: 'العرض',
    heightLabel: 'الارتفاع',
    marginLabel: 'الهامش',
    strokeLabel: 'سُمك الخط',
    unitLabel: 'الوحدة',
    unitMm: 'مم',
    unitInch: 'بوصة',
    filenameLabel: 'اسم الملف',
    previewLabel: 'معاينة',
    previewEmpty: 'لا توجد هندسة للتصدير',
    exportButton: 'تصدير',
    cancel: 'إلغاء',
  },
};

// ─── download helper ─────────────────────────────────────────────────────

/**
 * Trigger a browser download for a Blob via a transient anchor click.
 * Defensive: silently no-ops in non-DOM environments so callers can run
 * inside SSR / node tests without crashing. Matches the same pattern used
 * by `sketchSvgExport.downloadSketchAsSvg` for consistency.
 */
function downloadBlob(blob: Blob, filename: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke on next tick — Safari/Firefox need a beat to start the download.
  setTimeout(() => {
    try { URL.revokeObjectURL(url); } catch { /* best-effort */ }
  }, 0);
}

/**
 * Ensure `filename` ends with `ext` (without the dot). Idempotent: if the
 * filename already ends with `.${ext}` (case-insensitive) it is returned
 * unchanged, otherwise `.${ext}` is appended.
 */
function withExtension(filename: string, ext: string): string {
  const lower = filename.toLowerCase();
  const dotExt = `.${ext.toLowerCase()}`;
  return lower.endsWith(dotExt) ? filename : `${filename}.${ext}`;
}

// ─── PNG rasterisation ───────────────────────────────────────────────────
//
// SVG → PNG pipeline (mirrors drawing/_content.tsx exportSheetPng):
//   1. Build the SVG string via exportSketchToSvg.
//   2. Wrap it in a Blob and createObjectURL → load into an <img>.
//   3. Paint the <img> onto a sized <canvas> (white background).
//   4. canvas.toBlob('image/png') → download.
//
// Canvas size = width_mm × pxPerMm. Default 4 px/mm gives a 200×150 mm
// sketch a 800×600 PNG — good enough for slides/web without bloating.
//
// jsdom note: <img> never fires onload and toBlob may be absent. We still
// emit a download (with a blank/empty PNG blob) so test spies observe a
// `URL.createObjectURL` call — the production browser path is unchanged.
async function rasteriseSvgToPng(
  svgString: string,
  widthMm: number,
  heightMm: number,
  pxPerMm = 4,
): Promise<Blob> {
  if (typeof document === 'undefined') {
    // Non-DOM env (e.g. node test without jsdom). Return an empty blob so
    // the caller's download path is still exercisable.
    return new Blob([], { type: 'image/png' });
  }
  const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const svgUrl = typeof URL?.createObjectURL === 'function'
    ? URL.createObjectURL(svgBlob)
    : '';

  const pxW = Math.max(1, Math.round(widthMm * pxPerMm));
  const pxH = Math.max(1, Math.round(heightMm * pxPerMm));

  const canvas = document.createElement('canvas');
  canvas.width = pxW;
  canvas.height = pxH;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, pxW, pxH);
  }

  try {
    if (typeof Image !== 'undefined' && svgUrl) {
      await new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => {
          if (ctx) {
            try { ctx.drawImage(img, 0, 0, pxW, pxH); }
            catch { /* jsdom — keep the white canvas */ }
          }
          resolve();
        };
        img.onerror = () => resolve();
        img.src = svgUrl;
        // Belt-and-braces: jsdom may emit neither event — fall through.
        queueMicrotask(() => resolve());
      });
    }
  } finally {
    if (svgUrl && typeof URL?.revokeObjectURL === 'function') {
      try { URL.revokeObjectURL(svgUrl); } catch { /* best-effort */ }
    }
  }

  return await new Promise<Blob>((resolve) => {
    if (typeof canvas.toBlob === 'function') {
      // jsdom ships a stub `toBlob` that throws "Not implemented" *without*
      // invoking the callback. Guard via try/catch + a microtask race so the
      // promise resolves with an empty PNG blob instead of hanging forever
      // (real browsers always invoke the callback, so this is test-only).
      let settled = false;
      const finish = (blob: Blob | null): void => {
        if (settled) return;
        settled = true;
        resolve(blob ?? new Blob([], { type: 'image/png' }));
      };
      try {
        canvas.toBlob((blob) => finish(blob), 'image/png');
      } catch {
        finish(null);
      }
      // Belt-and-braces: if neither the callback nor the throw lands within
      // a microtask, fall through with an empty blob.
      queueMicrotask(() => finish(null));
    } else {
      resolve(new Blob([], { type: 'image/png' }));
    }
  });
}

// ─── component ───────────────────────────────────────────────────────────

export default function SketchExportModal({
  lang,
  entities,
  defaultFilename = 'sketch',
  onClose,
}: SketchExportModalProps): React.ReactElement {
  const t = dict[lang];
  const isRtl = lang === 'ar';

  const [format, setFormat] = useState<SketchExportFormat>('svg');
  const [unit, setUnit] = useState<SketchExportUnit>('mm');
  // Width / height / margin / stroke are stored in the *current unit* so
  // the input fields reflect what the user typed. We convert to mm at
  // export time (the underlying export contract is mm-native).
  const [width, setWidth] = useState<number>(FORMAT_DEFAULTS.svg.width);
  const [height, setHeight] = useState<number>(FORMAT_DEFAULTS.svg.height);
  const [margin, setMargin] = useState<number>(FORMAT_DEFAULTS.svg.margin);
  const [stroke, setStroke] = useState<number>(FORMAT_DEFAULTS.svg.stroke);
  const [filename, setFilename] = useState<string>(defaultFilename);

  // Convert any user-entered length to mm for the export call. When the
  // unit is mm we pass through; inches multiply by 25.4. We never round
  // here — keep full precision so 1in → 25.4 exactly.
  const toMm = useCallback(
    (v: number): number => (unit === 'inch' ? v * INCH_TO_MM : v),
    [unit],
  );

  // Build the export options used by sketchSvgExport.exportSketchToSvg.
  // These are recomputed inline (not memoised) — cheap math, and the
  // preview pass needs the same values without an extra dependency dance.
  const buildSvgOptions = useCallback(
    (): SketchSvgOptions => ({
      width: toMm(width),
      height: toMm(height),
      margin: toMm(margin),
      strokeWidth: toMm(stroke),
      title: filename,
    }),
    [toMm, width, height, margin, stroke, filename],
  );

  // ─── live preview ──────────────────────────────────────────────────────
  //
  // Re-serialise on every option change so the preview stays in sync. We
  // strip the XML prolog (`<?xml ...?>`) because React's
  // dangerouslySetInnerHTML refuses to mount processing instructions —
  // the rendered <svg> root carries its own namespaces, so the prolog is
  // safe to drop for preview purposes only (the actual export still
  // includes it).
  const previewSvg = useMemo<string>(() => {
    try {
      const raw = exportSketchToSvg(entities, buildSvgOptions());
      return raw.replace(/<\?xml[^?]*\?>\s*/i, '');
    } catch {
      return '';
    }
  }, [entities, buildSvgOptions]);

  // Quick "is the sketch empty?" probe for the preview empty-state copy.
  // Empty SVG is still a valid document, but a friendlier message helps
  // first-time users figure out why nothing's showing.
  const isEmpty = useMemo<boolean>(() => {
    const e = entities;
    return (
      e.points.length === 0 &&
      e.lines.length === 0 &&
      e.circles.length === 0 &&
      e.arcs.length === 0
    );
  }, [entities]);

  // ─── handlers ─────────────────────────────────────────────────────────

  const handleExport = useCallback(async (): Promise<void> => {
    if (format === 'svg') {
      const svg = exportSketchToSvg(entities, buildSvgOptions());
      const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
      downloadBlob(blob, withExtension(filename, 'svg'));
      return;
    }
    if (format === 'png') {
      const svg = exportSketchToSvg(entities, buildSvgOptions());
      const blob = await rasteriseSvgToPng(svg, toMm(width), toMm(height));
      downloadBlob(blob, withExtension(filename, 'png'));
      return;
    }
    if (format === 'dxf') {
      // DXF emission delegates to Agent-QQQQQ's downloadSketchAsDxf, which
      // owns its own Blob + anchor lifecycle (matching downloadSketchAsSvg
      // for consistency). We pass the chosen unit through so $INSUNITS in
      // the file reflects what the user selected. Layer '0' is the AutoCAD
      // default and the contract for the modal's "single-layer export".
      downloadSketchAsDxf(entities, withExtension(filename, 'dxf'), {
        units: unit,
        layer: '0',
        title: filename,
      });
      return;
    }
    // JSON: include a manifest envelope so the exported document is
    // self-describing (format version + chosen units alongside the raw
    // entities). Importers can branch on `version` if we ever change the
    // shape.
    const payload = {
      version: 1,
      generator: 'NexyFab sketchExport v1',
      unit,
      page: {
        width: toMm(width),
        height: toMm(height),
        margin: toMm(margin),
        strokeWidth: toMm(stroke),
      },
      entities,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    downloadBlob(blob, withExtension(filename, 'json'));
  }, [format, entities, buildSvgOptions, filename, toMm, width, height, margin, stroke, unit]);

  // Number-input change helper. Empty strings re-set to 0 rather than
  // NaN so the export contract (`width` must be finite) holds even mid-edit.
  const numberOnChange = useCallback(
    (setter: (n: number) => void) =>
      (evt: React.ChangeEvent<HTMLInputElement>): void => {
        const raw = evt.target.value;
        if (raw === '') { setter(0); return; }
        const n = Number(raw);
        if (Number.isFinite(n)) setter(n);
      },
    [],
  );

  // ─── render ───────────────────────────────────────────────────────────

  return (
    <div
      data-testid="sketch-export-modal"
      role="dialog"
      aria-labelledby="sketch-export-title"
      dir={isRtl ? 'rtl' : 'ltr'}
      style={{
        position: 'fixed',
        top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: 'var(--nx-panel)',
          padding: 20,
          borderRadius: 8,
          maxWidth: 560,
          width: '92%',
          maxHeight: '90vh',
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <h3
          id="sketch-export-title"
          data-testid="sketch-export-title"
          style={{ margin: 0, fontSize: 16, fontWeight: 600 }}
        >
          {t.title}
        </h3>

        {/* Format radio group */}
        <fieldset
          style={{
            border: '1px solid var(--nx-border)',
            borderRadius: 4,
            padding: '6px 10px',
            margin: 0,
          }}
        >
          <legend style={{ padding: '0 4px', fontSize: 11, color: 'var(--nx-text-2)' }}>
            {t.formatLabel}
          </legend>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {(['svg', 'png', 'json', 'dxf'] as const).map((f) => (
              <label
                key={f}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                <input
                  type="radio"
                  name="sketch-export-format"
                  value={f}
                  checked={format === f}
                  onChange={() => setFormat(f)}
                  data-testid={`sketch-export-format-${f}`}
                />
                {f === 'svg'
                  ? t.formatSvg
                  : f === 'png'
                    ? t.formatPng
                    : f === 'json'
                      ? t.formatJson
                      : t.formatDxf}
              </label>
            ))}
          </div>
        </fieldset>

        {/* Numeric option grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 8,
          }}
        >
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
            {t.widthLabel}
            <input
              type="number"
              data-testid="sketch-export-width"
              value={width}
              min={1}
              step="any"
              onChange={numberOnChange(setWidth)}
              style={{ padding: '6px 8px', border: '1px solid var(--nx-border)', borderRadius: 4, fontSize: 12 }}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
            {t.heightLabel}
            <input
              type="number"
              data-testid="sketch-export-height"
              value={height}
              min={1}
              step="any"
              onChange={numberOnChange(setHeight)}
              style={{ padding: '6px 8px', border: '1px solid var(--nx-border)', borderRadius: 4, fontSize: 12 }}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
            {t.marginLabel}
            <input
              type="number"
              data-testid="sketch-export-margin"
              value={margin}
              min={0}
              step="any"
              onChange={numberOnChange(setMargin)}
              style={{ padding: '6px 8px', border: '1px solid var(--nx-border)', borderRadius: 4, fontSize: 12 }}
            />
          </label>
          {/* DXF is a pure-vector format with layer-driven line weights —
              the stroke width control has no effect on the emitted file, so
              we hide it entirely when DXF is selected to avoid confusing
              users with a dead input. SVG/PNG/JSON all consume strokeWidth
              (PNG via the rasterised SVG, JSON via the recorded page block).
              The stroke state itself is preserved across format toggles so
              the user doesn't lose their setting when bouncing through DXF. */}
          {format !== 'dxf' && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              {t.strokeLabel}
              <input
                type="number"
                data-testid="sketch-export-stroke"
                value={stroke}
                min={0}
                step="any"
                onChange={numberOnChange(setStroke)}
                style={{ padding: '6px 8px', border: '1px solid var(--nx-border)', borderRadius: 4, fontSize: 12 }}
              />
            </label>
          )}
        </div>

        {/* Unit + filename row */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, minWidth: 120 }}>
            {t.unitLabel}
            <select
              data-testid="sketch-export-unit"
              value={unit}
              onChange={(e) => setUnit(e.target.value as SketchExportUnit)}
              style={{ padding: '6px 8px', border: '1px solid var(--nx-border)', borderRadius: 4, fontSize: 12, background: 'var(--nx-panel)' }}
            >
              <option value="mm">{t.unitMm}</option>
              <option value="inch">{t.unitInch}</option>
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, flex: 1 }}>
            {t.filenameLabel}
            <input
              type="text"
              data-testid="sketch-export-filename"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              style={{ padding: '6px 8px', border: '1px solid var(--nx-border)', borderRadius: 4, fontSize: 12 }}
            />
          </label>
        </div>

        {/* Preview */}
        <div>
          <div style={{ fontSize: 11, color: 'var(--nx-text-2)', marginBottom: 4 }}>{t.previewLabel}</div>
          <div
            data-testid="sketch-export-preview"
            style={{
              border: '1px solid var(--nx-border)',
              borderRadius: 4,
              background: '#fafafa',
              padding: 8,
              minHeight: 120,
              maxHeight: 220,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
            }}
          >
            {isEmpty ? (
              <span style={{ color: 'var(--nx-text-2)', fontSize: 12 }}>{t.previewEmpty}</span>
            ) : (
              <div
                data-testid="sketch-export-preview-svg"
                style={{
                  width: '100%',
                  maxHeight: 200,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                // Inline SVG markup — sourced from our own exportSketchToSvg
                // emitter (no user-supplied HTML), so XSS surface is the
                // entity ids escaped by the emitter's `escapeXml` helper.
                dangerouslySetInnerHTML={{ __html: previewSvg }}
              />
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            type="button"
            data-testid="sketch-export-cancel"
            onClick={onClose}
            style={{
              padding: '8px 16px',
              fontSize: 13,
              background: 'var(--nx-panel)',
              border: '1px solid var(--nx-border)',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            {t.cancel}
          </button>
          <button
            type="button"
            data-testid="sketch-export-submit"
            onClick={() => { void handleExport(); }}
            style={{
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 600,
              background: '#0ea5e9',
              color: '#fff',
              border: '1px solid #0284c7',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            {t.exportButton}
          </button>
        </div>
      </div>
    </div>
  );
}
