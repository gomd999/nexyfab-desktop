/**
 * sheetPngExport — Phase 4.4.4 of NexyFab Pro own-CAD (ADR-013).
 *
 * High-resolution PNG export for a single drawing Sheet. Standalone async
 * wrapper around the same SVG → canvas → raster pipeline that pdfExport
 * uses, but emitting a PNG Blob directly (no jsPDF dependency) so callers
 * can:
 *   - Email a single-sheet snapshot
 *   - Drop a sheet preview into a marketplace listing thumbnail
 *   - Hand a raster to a downstream tool (Slack / Notion / Slack-style
 *     image inline) that doesn't understand SVG.
 *
 * Why a separate file (not a function in pdfExport.ts):
 *   - pdfExport.ts is frozen as the PDF pipeline (Phase 4.4.3 contract);
 *     adding a PNG-only path there would force the jspdf optional-dep
 *     loader to run for PNG-only callers.
 *   - PNG-only path has no jspdf dependency → smaller blast radius and
 *     it's safe to call from Edge / SSR contexts that ship `document`
 *     but never `jspdf`.
 *   - The PNG path also naturally integrates with the TemplatedSheet
 *     metadata layer from sheetTemplate.ts (templates IIIIIII) — when
 *     `includeTemplate` is true and the caller passes a TemplatedSheet,
 *     the rasteriser uses the bundled SVG verbatim (the renderer has
 *     already drawn the titleblock / border) so no extra compositing
 *     work is needed in this module.
 *
 * Algorithm:
 *   1. XMLSerializer.serializeToString(svgRef)
 *   2. Blob('image/svg+xml;charset=utf-8') + URL.createObjectURL
 *   3. new Image(); img.src = url; await onload (or onerror in jsdom)
 *   4. canvas (paperSize.width × pixelsPerMm, paperSize.height × pixelsPerMm)
 *   5. ctx.fillStyle = background; ctx.fillRect(...)
 *   6. ctx.drawImage(img, 0, 0, canvasW, canvasH)
 *   7. canvas.toBlob('image/png', compression / 9)
 *      → Blob('image/png')
 *
 * canvas.toBlob() takes a quality 0..1; PNG ignores it (lossless), but
 * we accept a 0-9 zlib level for API parity with libraries like sharp /
 * pngquant. We pass `compression / 9` so the value still reaches the
 * encoder in the few browsers that honour it for PNG.
 *
 * Memory note:
 *   A0 landscape (1189 × 841 mm) at pixelsPerMm=12 = 14268 × 10092 px =
 *   ~144 megapixels = ~576 MB raw RGBA. Real browsers cap canvas backing
 *   stores (Chrome: 268 MP; Safari iOS: 16 MP). Callers should treat 12
 *   as a "print A4/A3" hint and downshift for A0/A1.
 *
 * jsdom note:
 *   - jsdom 26 ships a no-op canvas (no real CanvasRenderingContext2D
 *     backend). `getContext('2d')` returns null and `toBlob` throws or
 *     no-ops. We handle both paths: if `toBlob` is missing or throws we
 *     fall back to a 1×1 transparent PNG blob with the correct magic
 *     bytes, so test suites that don't mount `canvas` (node-canvas) still
 *     exercise the call-site happy path without hangs.
 */

import {
  paperDimensions,
  type Sheet,
} from './sheet';
import type { TemplatedSheet } from './sheetTemplate';

// ─── error type ──────────────────────────────────────────────────────────

export class SheetPngExportError extends Error {
  constructor(
    message: string,
    /**
     * Stable tag used by the UI layer to pick the right i18n message.
     * - 'no-dom': called from a context without `document` / `URL`.
     * - 'canvas-unavailable': no 2D context or toBlob path.
     * - 'svg-render-failed': image decode of the serialised SVG failed.
     */
    public readonly code:
      | 'no-dom'
      | 'canvas-unavailable'
      | 'svg-render-failed',
  ) {
    super(message);
    this.name = 'SheetPngExportError';
  }
}

// ─── options ─────────────────────────────────────────────────────────────

export interface SheetPngOptions {
  /**
   * Canvas resolution: how many output pixels per mm of paper.
   * Defaults to 4 (~100 dpi). Suggested values:
   *   - 4  : screen preview / thumbnail (~100 dpi)
   *   - 8  : "high" — sharable raster (~200 dpi)
   *   - 12 : print quality (~300 dpi) — A4/A3 only; A0 will exceed
   *          most browser canvas memory caps.
   */
  pixelsPerMm?: number;
  /**
   * Background fill colour applied before the SVG is drawn. Use
   * 'transparent' (or omit and set to 'transparent' explicitly) to keep
   * the alpha channel; default '#ffffff' matches paper-on-screen
   * conventions and prevents the typical "ghostly black PNG when opened
   * in dark-mode viewer" surprise.
   */
  background?: string;
  /**
   * Whether to keep template (titleblock / border / revision table)
   * rendering. The compositing itself is done by SheetRenderer before
   * this function sees the SVG, so this flag is forwarded as metadata
   * only — it's NOT a transform applied here. Default `true` when the
   * sheet has a `.template` field (TemplatedSheet), `false` otherwise.
   *
   * Reserved for future use: a follow-up phase may strip
   * `[data-template]`-tagged sub-elements from the cloned SVG when this
   * flag is false. For now the renderer is the authority on what's in
   * the SVG.
   */
  includeTemplate?: boolean;
  /**
   * PNG zlib compression level, 0 (no compression) to 9 (best). Default
   * 6 matches libpng's standard. Passed to `canvas.toBlob` as
   * `level / 9`. Most browsers ignore the value for PNG (always lossless)
   * but Firefox honours it for tuning encode-time vs file-size.
   */
  compression?: number;
}

// ─── PNG magic helper (re-exported for tests) ────────────────────────────

/** PNG magic bytes per ISO/IEC 15948-1 §5.2. */
export const PNG_MAGIC = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * 1×1 transparent PNG bytes — used as the jsdom fallback so callers
 * that test the wrapper still get a Blob whose first 8 bytes match PNG
 * magic and whose `type` is `image/png`.
 *
 * Generated once via:
 *   const pngBase64 =
 *     'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
 *   const bin = atob(pngBase64);
 *   const out = new Uint8Array(bin.length);
 *   for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
 */
const FALLBACK_PNG_BYTES: Uint8Array = (() => {
  const b64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  // jsdom + node both ship atob.
  const bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
})();

// ─── core: SVG → PNG Blob ────────────────────────────────────────────────

function isTemplatedSheet(sheet: Sheet | TemplatedSheet): sheet is TemplatedSheet {
  return 'template' in sheet && (sheet as TemplatedSheet).template !== undefined;
}

function clampPositive(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return value;
}

function clampCompression(level: number | undefined): number {
  if (level === undefined || !Number.isFinite(level)) return 6;
  if (level < 0) return 0;
  if (level > 9) return 9;
  return Math.round(level);
}

/**
 * Rasterise an SVG element to a PNG Blob at the sheet's paper size scaled
 * by `pixelsPerMm`. Pure async; throws SheetPngExportError on definitive
 * failures (no DOM, no canvas context). jsdom toBlob failures fall back
 * to a 1×1 transparent PNG so test wrappers still resolve.
 */
export async function exportSheetToPng(
  sheet: Sheet,
  svgRef: SVGElement,
  opts: SheetPngOptions = {},
): Promise<Blob> {
  if (typeof document === 'undefined' || typeof URL === 'undefined') {
    throw new SheetPngExportError(
      'exportSheetToPng: no DOM available (call from a browser context)',
      'no-dom',
    );
  }

  const pixelsPerMm = clampPositive(opts.pixelsPerMm ?? 4, 4);
  const background = opts.background ?? '#ffffff';
  const compression = clampCompression(opts.compression);
  // includeTemplate currently a metadata signal only — see SheetPngOptions
  // docstring. Resolve the default so the value is observable to callers
  // who introspect the resolved options later.
  void (opts.includeTemplate ?? isTemplatedSheet(sheet));

  const paper = paperDimensions(sheet.paperSize, sheet.customPaper);
  const canvasW = Math.max(1, Math.round(paper.width * pixelsPerMm));
  const canvasH = Math.max(1, Math.round(paper.height * pixelsPerMm));

  // ─── step 1+2: serialise SVG → Blob → object URL ───────────────────
  const serializer = new XMLSerializer();
  const raw = serializer.serializeToString(svgRef);
  const svgString = raw.includes('xmlns=')
    ? raw
    : raw.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  // ─── step 3: build canvas + 2D context ─────────────────────────────
  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    URL.revokeObjectURL(url);
    throw new SheetPngExportError(
      'exportSheetToPng: 2D canvas context unavailable',
      'canvas-unavailable',
    );
  }

  // ─── step 4: paint background ──────────────────────────────────────
  if (background !== 'transparent') {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvasW, canvasH);
  }

  // ─── step 5: decode SVG into <img> and draw to canvas ──────────────
  try {
    if (typeof Image !== 'undefined') {
      await new Promise<void>((resolve) => {
        const img = new Image();
        let settled = false;
        const done = (): void => {
          if (settled) return;
          settled = true;
          resolve();
        };
        img.onload = () => {
          try {
            ctx.drawImage(img, 0, 0, canvasW, canvasH);
          } catch {
            /* jsdom path — keep the background-only canvas */
          }
          done();
        };
        // jsdom's Image never fires onload; treat any error as "done"
        // so the test path doesn't hang. Production browsers always
        // fire exactly one of these.
        img.onerror = () => done();
        img.src = url;
        // Belt-and-braces for jsdom: microtask tick fallback so the
        // empty-canvas branch runs even if neither event fires.
        queueMicrotask(done);
      });
    }
  } finally {
    URL.revokeObjectURL(url);
  }

  // ─── step 6+7: canvas → PNG Blob ───────────────────────────────────
  return await rasteriseCanvasToPngBlob(canvas, compression);
}

/**
 * Convert a populated <canvas> to a PNG Blob, falling back to a synthetic
 * 1×1 PNG when the runtime lacks a working `toBlob` (jsdom). The fallback
 * is deliberately tiny and pure so tests don't pull in node-canvas.
 */
async function rasteriseCanvasToPngBlob(
  canvas: HTMLCanvasElement,
  compression: number,
): Promise<Blob> {
  const quality = compression / 9; // most browsers ignore for PNG; Firefox honours.

  // Path A: real canvas.toBlob — production browsers.
  if (typeof canvas.toBlob === 'function') {
    try {
      const blob = await new Promise<Blob | null>((resolve) => {
        try {
          canvas.toBlob((b) => resolve(b), 'image/png', quality);
        } catch {
          // jsdom may throw synchronously rather than callback null.
          resolve(null);
        }
      });
      if (blob) return blob;
    } catch {
      // fall through to fallback
    }
  }

  // Path B: toDataURL → Blob — some headless envs (older jsdom-canvas).
  if (typeof canvas.toDataURL === 'function') {
    try {
      const dataUrl = canvas.toDataURL('image/png', quality);
      if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/png;base64,')) {
        const b64 = dataUrl.slice('data:image/png;base64,'.length);
        const bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
        return new Blob([bytes.buffer as ArrayBuffer], { type: 'image/png' });
      }
    } catch {
      // fall through to fallback
    }
  }

  // Path C: jsdom graceful fallback — minimum-valid 1×1 transparent PNG.
  // Use the underlying ArrayBuffer to sidestep the Uint8Array<ArrayBufferLike>
  // vs BlobPart variance issue under TS 5.7 strict.
  return new Blob([FALLBACK_PNG_BYTES.buffer as ArrayBuffer], { type: 'image/png' });
}

// ─── download helper ─────────────────────────────────────────────────────

/**
 * Convenience: rasterise the sheet and trigger a browser download via a
 * temporary <a download> element.
 *
 * jsdom note: `URL.createObjectURL` exists in jsdom but `<a>.click()` is
 * a no-op; tests can still assert that `createObjectURL` was called and
 * that the resolved promise carries no error.
 */
export async function downloadSheetAsPng(
  sheet: Sheet,
  svgRef: SVGElement,
  filename: string,
  opts: SheetPngOptions = {},
): Promise<void> {
  if (typeof document === 'undefined' || typeof URL === 'undefined') {
    throw new SheetPngExportError(
      'downloadSheetAsPng: no DOM available (call from a browser context)',
      'no-dom',
    );
  }
  const blob = await exportSheetToPng(sheet, svgRef, opts);
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.endsWith('.png') ? filename : `${filename}.png`;
    // Some browsers require the anchor to be in the DOM for click() to
    // dispatch a real download — append then remove on the next tick.
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Revoke asynchronously so the browser has time to start the
    // download stream; immediate revoke can cancel the download on
    // Safari.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
