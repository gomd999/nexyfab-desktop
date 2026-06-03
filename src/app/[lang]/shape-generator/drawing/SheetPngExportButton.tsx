'use client';

/**
 * SheetPngExportButton — Phase 4.4.4 standalone PNG export.
 *
 * Self-contained button + resolution picker that wraps
 * `exportSheetToPng` and triggers a browser download. Designed to drop
 * into any page that has a `Sheet` IR in hand without forcing the host
 * to also mount the heavy `DrawingPageContent` shell. Typical hosts:
 *   - assembly / mate-inference detail pages that want a quick PNG of
 *     the active drawing sheet
 *   - marketplace / share dialogs that need a raster thumbnail
 *   - admin tooling that audits sheets in bulk
 *
 * Pipeline:
 *   1. Render the supplied Sheet through `SheetRenderer` in an
 *      off-screen wrapper (`display: none`) so the produced SVG is
 *      identical to what users see in the live drawing page.
 *   2. On click: read the rendered SVG ref → call `exportSheetToPng`
 *      with `pixelsPerMm` derived from the selected DPI (DPI / 25.4).
 *   3. Trigger a download by creating a temporary `<a>` with
 *      `URL.createObjectURL(blob)` + `.click()`.
 *   4. Fire `onExported` (if provided) with the raw bytes so callers
 *      can also stash the PNG in storage / send via email / etc.
 *
 * Error handling:
 *   - `SheetPngExportError` codes (`no-dom`, `canvas-unavailable`,
 *     `svg-render-failed`) and any other thrown error surface in an
 *     inline alert with the `drawing-png-export-error` testid. The
 *     `canvas-unavailable` case carries the iOS Safari 16MP cap hint.
 *
 * Defaults match the brief:
 *   - resolution: 150 DPI (≈ 5.91 px/mm — "high")
 *   - filename:   `{sheet.name}-{YYYYMMDDHHMMSS}.png`
 *
 * jsdom note: `URL.createObjectURL` exists in jsdom but `<a>.click()`
 * does not dispatch a real download — tests assert on the createObjectURL
 * blob + the spy'd anchor click, not on any actual file appearing on
 * disk.
 */

import * as React from 'react';
import type { Sheet } from '@/lib/drawing/sheet';
import { exportSheetToPng, SheetPngExportError } from '@/lib/drawing/sheetPngExport';
import { SheetRenderer } from './SheetRenderer';

// ─── props ───────────────────────────────────────────────────────────────

export interface SheetPngExportButtonProps {
  /** Route lang segment (`kr`, `en`, `ja`, `cn`, `es`, `ar`) or ISO. */
  lang: string;
  /** Sheet IR to rasterise. */
  sheet: Sheet;
  /** Override filename (defaults to `{sheet.name}-{YYYYMMDDHHMMSS}.png`). */
  filename?: string;
  /** Initial DPI (72/96/150/300). Default 150. */
  resolution?: number;
  /** Optional sink for the raw PNG bytes after a successful export. */
  onExported?: (bytes: Uint8Array) => void;
}

// ─── i18n ────────────────────────────────────────────────────────────────

interface ButtonDict {
  exportPng: string;
  resolutionDpi: string;
  exporting: string;
  exportError: string;
  /** Specific hint for the iOS Safari 16MP canvas cap. */
  canvasCapWarning: string;
}

const DICT: Record<string, ButtonDict> = {
  ko: {
    exportPng: 'PNG 내보내기',
    resolutionDpi: '해상도 (DPI)',
    exporting: '내보내는 중...',
    exportError: 'PNG 내보내기 실패',
    canvasCapWarning: 'iOS Safari는 16메가픽셀 캔버스 상한이 있습니다 — 해상도를 낮춰주세요.',
  },
  en: {
    exportPng: 'Export PNG',
    resolutionDpi: 'Resolution (DPI)',
    exporting: 'Exporting...',
    exportError: 'PNG export failed',
    canvasCapWarning: 'iOS Safari caps canvas at 16 megapixels — lower the resolution.',
  },
  ja: {
    exportPng: 'PNGエクスポート',
    resolutionDpi: '解像度 (DPI)',
    exporting: 'エクスポート中...',
    exportError: 'PNGエクスポートに失敗',
    canvasCapWarning: 'iOS Safariは16メガピクセルのキャンバス上限があります — 解像度を下げてください。',
  },
  zh: {
    exportPng: '导出PNG',
    resolutionDpi: '分辨率 (DPI)',
    exporting: '导出中...',
    exportError: 'PNG导出失败',
    canvasCapWarning: 'iOS Safari将画布上限为1600万像素 — 请降低分辨率。',
  },
  es: {
    exportPng: 'Exportar PNG',
    resolutionDpi: 'Resolución (DPI)',
    exporting: 'Exportando...',
    exportError: 'Error al exportar PNG',
    canvasCapWarning: 'iOS Safari limita el lienzo a 16 megapíxeles — reduzca la resolución.',
  },
  ar: {
    exportPng: 'تصدير PNG',
    resolutionDpi: 'الدقة (DPI)',
    exporting: 'جاري التصدير...',
    exportError: 'فشل تصدير PNG',
    canvasCapWarning: 'يحد iOS Safari اللوحة بـ 16 ميجابكسل — قلل الدقة.',
  },
};

function pickDict(lang: string): ButtonDict {
  // Accept both ISO (ko/zh) and route (kr/cn) codes.
  const key = lang === 'kr' ? 'ko' : lang === 'cn' ? 'zh' : lang;
  return DICT[key] ?? DICT.en!;
}

// ─── constants ───────────────────────────────────────────────────────────

const DPI_OPTIONS: ReadonlyArray<number> = [72, 96, 150, 300];
const DEFAULT_DPI = 150;
/** 1 inch = 25.4 mm. exportSheetToPng wants pixels per mm. */
const MM_PER_INCH = 25.4;

// ─── helpers ─────────────────────────────────────────────────────────────

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** YYYYMMDDHHMMSS — local time (export filename, not a sortable key). */
function timestampNow(d: Date = new Date()): string {
  return (
    `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}` +
    `${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
  );
}

function defaultFilename(sheet: Sheet): string {
  const safe = (sheet.name ?? sheet.id ?? 'sheet').replace(/[^\w.-]+/g, '_');
  return `${safe}-${timestampNow()}.png`;
}

function ensurePngExtension(name: string): string {
  return name.toLowerCase().endsWith('.png') ? name : `${name}.png`;
}

async function blobToBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof (blob as { arrayBuffer?: unknown }).arrayBuffer === 'function') {
    const buf = await blob.arrayBuffer();
    return new Uint8Array(buf);
  }
  // FileReader fallback for the rare jsdom build that omits Blob.arrayBuffer.
  return await new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const buf = reader.result as ArrayBuffer;
      resolve(new Uint8Array(buf));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

function triggerDownload(blob: Blob, filename: string): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return;
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = ensurePngExtension(filename);
    a.rel = 'noopener';
    // Some browsers require the anchor to be in the DOM for click() to fire.
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Defer revoke so Safari has time to start the stream — immediate
    // revoke can cancel the download mid-flight.
    setTimeout(() => {
      try { URL.revokeObjectURL(url); } catch { /* noop */ }
    }, 0);
  }
}

// ─── component ───────────────────────────────────────────────────────────

export function SheetPngExportButton(
  props: SheetPngExportButtonProps,
): React.ReactElement {
  const { lang, sheet, filename, resolution, onExported } = props;
  const dict = pickDict(lang);

  const initialDpi = resolution && DPI_OPTIONS.includes(resolution) ? resolution : DEFAULT_DPI;
  const [dpi, setDpi] = React.useState<number>(initialDpi);
  const [exporting, setExporting] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string | null>(null);

  const svgWrapperRef = React.useRef<HTMLDivElement | null>(null);
  // Synchronous re-entrancy guard. `exporting` state can lag behind
  // back-to-back clicks within the same React batch (and disabled
  // buttons still receive click events under some test harnesses) — the
  // ref flips immediately so duplicate invocations are dropped.
  const inFlightRef = React.useRef<boolean>(false);

  const handleClick = React.useCallback(async () => {
    if (inFlightRef.current || exporting) return;
    inFlightRef.current = true;
    setError(null);
    setExporting(true);
    try {
      const svg = svgWrapperRef.current?.querySelector('svg');
      if (!svg) {
        throw new SheetPngExportError(
          'SheetPngExportButton: no SVG ref available',
          'svg-render-failed',
        );
      }
      const pixelsPerMm = dpi / MM_PER_INCH;
      const blob = await exportSheetToPng(sheet, svg as SVGElement, { pixelsPerMm });
      const bytes = await blobToBytes(blob);
      const outName = filename ?? defaultFilename(sheet);
      triggerDownload(blob, outName);
      if (onExported) onExported(bytes);
    } catch (e) {
      const msg =
        e instanceof SheetPngExportError && e.code === 'canvas-unavailable'
          ? `${dict.exportError}: ${dict.canvasCapWarning}`
          : `${dict.exportError}: ${(e as Error).message ?? String(e)}`;
      setError(msg);
    } finally {
      inFlightRef.current = false;
      setExporting(false);
    }
  }, [exporting, dpi, sheet, filename, onExported, dict.exportError, dict.canvasCapWarning]);

  return (
    <div
      data-testid="drawing-png-export-root"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
    >
      {/* Off-screen sheet renderer — supplies the SVG ref consumed by exportSheetToPng. */}
      <div
        ref={svgWrapperRef}
        aria-hidden="true"
        style={{
          position: 'absolute',
          width: 0,
          height: 0,
          overflow: 'hidden',
          opacity: 0,
          pointerEvents: 'none',
        }}
      >
        <SheetRenderer sheet={sheet} />
      </div>

      <label
        htmlFor="drawing-png-export-resolution-select"
        style={{ fontSize: 13, color: '#374151' }}
      >
        {dict.resolutionDpi}
      </label>
      <select
        id="drawing-png-export-resolution-select"
        data-testid="drawing-png-export-resolution-select"
        value={dpi}
        onChange={(e) => setDpi(Number(e.target.value))}
        disabled={exporting}
        style={{
          padding: '4px 8px',
          borderRadius: 4,
          border: '1px solid #cbd5e1',
          background: '#fff',
          color: '#0f172a',
          fontSize: 13,
        }}
      >
        {DPI_OPTIONS.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>

      <button
        type="button"
        data-testid="drawing-png-export-button"
        onClick={handleClick}
        disabled={exporting}
        aria-busy={exporting}
        style={{
          padding: '8px 14px',
          background: exporting ? '#475569' : '#0f172a',
          color: '#fff',
          border: 'none',
          borderRadius: 4,
          cursor: exporting ? 'wait' : 'pointer',
          fontSize: 13,
        }}
      >
        {exporting ? dict.exporting : dict.exportPng}
      </button>

      {exporting && (
        <span
          data-testid="drawing-png-export-spinner"
          role="status"
          aria-live="polite"
          style={{
            display: 'inline-block',
            width: 12,
            height: 12,
            borderRadius: '50%',
            border: '2px solid #cbd5e1',
            borderTopColor: '#0f172a',
            animation: 'spin 1s linear infinite',
          }}
        />
      )}

      {error && (
        <div
          data-testid="drawing-png-export-error"
          role="alert"
          style={{
            flexBasis: '100%',
            padding: '6px 10px',
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 4,
            color: '#991b1b',
            fontSize: 12,
            marginTop: 4,
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}

export default SheetPngExportButton;
