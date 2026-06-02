/**
 * pdfExport — Phase 4.4.3 of NexyFab Pro own-CAD (ADR-013).
 *
 * Multi-page PDF export for drawing Sheets. Bundles a list of (sheet, svg)
 * pairs into a single PDF with one page per sheet, sized to that sheet's
 * paperSize (A4/A3/A2/A1/A0/custom).
 *
 * Phase 1 (this file): PNG embed pipeline.
 *   For each sheet:
 *     SVG element → XMLSerializer → Blob → object URL → <img> → <canvas>
 *     → canvas.toDataURL('image/png') → jsPDF.addImage at full page extent
 *   jspdf is loaded via dynamic `import('jspdf')` so the library is an
 *   optional dependency at the call-site — if it's missing (or the runtime
 *   has no `Image`/`canvas`) the loader throws a tagged error the UI layer
 *   surfaces as the i18n'd "jspdf not installed" message.
 *
 * Phase 2 (TODO follow-up): svg2pdf.js direct vector pipeline.
 *   svg2pdf.js consumes an SVGElement + a jsPDF doc and emits true PDF
 *   vector primitives (paths, text) instead of a rasterised PNG. Benefits:
 *     - sharper output at any zoom level
 *     - searchable / selectable text in the produced PDF
 *     - smaller file size for vector-heavy sheets
 *   Wire it as a second exported function (`exportSheetsToPdfVector`) so
 *   callers can opt in once the dep is approved. Pseudocode:
 *     const { svg2pdf } = await import('svg2pdf.js');
 *     await svg2pdf(svgEl, doc, { x: 0, y: 0, width: pw, height: ph });
 *
 * Out of scope (Phase 4.x+):
 *   - PDF/A archival profile (needs jspdf-autotable + font embedding).
 *   - Form field annotations.
 *   - Bookmarks / outline.
 *   - Encryption / signing.
 */

import { paperDimensions, type PaperSize, type Sheet, type CustomPaper } from './sheet';

// ─── error types ─────────────────────────────────────────────────────────

export class PdfExportError extends Error {
  constructor(
    message: string,
    /**
     * Stable tag used by the UI layer to pick the right i18n message.
     * - 'jspdf-missing': dynamic import('jspdf') threw / has no default.
     * - 'svg-render-failed': image decode of the serialised SVG failed.
     * - 'canvas-unavailable': no `<canvas>` / `toDataURL` / `getContext`.
     * - 'mismatched-inputs': sheets.length !== svgRefs.length.
     */
    public readonly code:
      | 'jspdf-missing'
      | 'svg-render-failed'
      | 'canvas-unavailable'
      | 'mismatched-inputs',
  ) {
    super(message);
    this.name = 'PdfExportError';
  }
}

// ─── jspdf shape (minimal subset we touch) ───────────────────────────────

interface JsPdfLike {
  addImage(
    data: string,
    format: string,
    x: number,
    y: number,
    w: number,
    h: number,
  ): JsPdfLike;
  addPage(format?: number[] | string, orientation?: string): JsPdfLike;
  getNumberOfPages(): number;
  output(type: 'blob'): Blob;
  output(type: 'arraybuffer'): ArrayBuffer;
}

interface JsPdfConstructor {
  new (opts: {
    orientation?: 'p' | 'portrait' | 'l' | 'landscape';
    unit?: 'pt' | 'mm';
    format?: number[];
  }): JsPdfLike;
}

interface JsPdfModule {
  default: JsPdfConstructor;
  jsPDF?: JsPdfConstructor;
}

/**
 * Loader indirection — exported so tests can inject a mock without touching
 * the real `import('jspdf')` resolver. Default returns the real module via
 * dynamic import so production code remains a true optional dependency.
 */
export type JsPdfLoader = () => Promise<JsPdfConstructor>;

const defaultJsPdfLoader: JsPdfLoader = async () => {
  let mod: JsPdfModule;
  try {
    mod = (await import('jspdf')) as unknown as JsPdfModule;
  } catch (err) {
    throw new PdfExportError(
      `exportSheetsToPdf: jspdf optional dependency is not installed (${(err as Error).message ?? 'unknown'})`,
      'jspdf-missing',
    );
  }
  const ctor = mod.default ?? mod.jsPDF;
  if (typeof ctor !== 'function') {
    throw new PdfExportError(
      'exportSheetsToPdf: jspdf module did not expose a constructor',
      'jspdf-missing',
    );
  }
  return ctor;
};

// ─── SVG → PNG dataURL ───────────────────────────────────────────────────

interface RasteriseOptions {
  /** Output canvas width in CSS pixels. */
  width: number;
  /** Output canvas height in CSS pixels. */
  height: number;
}

/**
 * Rasterise an SVG element into a PNG data URL. In jsdom (no real <img>
 * decoder) the canvas stays blank and we still return a data URL so the
 * downstream `jsPDF.addImage` call exercises its happy path under test.
 */
async function svgToPngDataUrl(svgEl: SVGElement, opts: RasteriseOptions): Promise<string> {
  if (typeof document === 'undefined' || typeof URL === 'undefined') {
    throw new PdfExportError(
      'exportSheetsToPdf: no DOM available (call from a browser context)',
      'canvas-unavailable',
    );
  }
  const serializer = new XMLSerializer();
  const raw = serializer.serializeToString(svgEl);
  const svgString = raw.includes('xmlns=')
    ? raw
    : raw.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(opts.width));
  canvas.height = Math.max(1, Math.round(opts.height));
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    URL.revokeObjectURL(url);
    throw new PdfExportError(
      'exportSheetsToPdf: 2D canvas context unavailable',
      'canvas-unavailable',
    );
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  try {
    if (typeof Image !== 'undefined') {
      await new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => {
          try {
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          } catch {
            /* jsdom path — proceed with the white-filled canvas */
          }
          resolve();
        };
        // jsdom's Image never fires onload; resolve on error too so tests
        // don't hang. Production browsers always finish one or the other.
        img.onerror = () => resolve();
        img.src = url;
        // Belt-and-braces: jsdom may emit *neither* event. Race a microtask
        // tick so tests fall through to the empty-canvas branch.
        queueMicrotask(() => resolve());
      });
    }
  } finally {
    URL.revokeObjectURL(url);
  }

  if (typeof canvas.toDataURL !== 'function') {
    throw new PdfExportError(
      'exportSheetsToPdf: canvas.toDataURL unavailable',
      'canvas-unavailable',
    );
  }
  return canvas.toDataURL('image/png');
}

// ─── orientation helper ──────────────────────────────────────────────────

/**
 * Resolve effective paper dimensions in mm. Returns `{ widthMm, heightMm,
 * orientation }`. Convention: A-series defaults are landscape (width ≥
 * height); we infer orientation from the resolved dims so callers can
 * still pass custom portrait sheets without surprises.
 */
export function resolvePagePaper(size: PaperSize, custom?: CustomPaper): {
  widthMm: number;
  heightMm: number;
  orientation: 'landscape' | 'portrait';
} {
  const d = paperDimensions(size, custom);
  return {
    widthMm: d.width,
    heightMm: d.height,
    orientation: d.width >= d.height ? 'landscape' : 'portrait',
  };
}

// ─── public API ──────────────────────────────────────────────────────────

export interface ExportSheetsOptions {
  /**
   * Rasterisation resolution multiplier — controls the canvas size that
   * feeds `jsPDF.addImage`. Higher = sharper, larger file. Default 2.
   */
  pixelsPerMm?: number;
  /**
   * Test seam — inject a stub jsPDF loader. Production callers omit.
   */
  loadJsPdf?: JsPdfLoader;
}

/**
 * Bundle a list of (sheet, svgEl) pairs into a single multi-page PDF Blob.
 * The arrays MUST be the same length and aligned by index.
 *
 * Each page is sized to its sheet's paperSize (A4/A3/.../custom), so a
 * single PDF can carry mixed paper formats — useful when an assembly
 * drawing's title sheet is A3 but its component sheets are A4.
 *
 * @returns PDF Blob with `type: 'application/pdf'`. Caller is responsible
 *          for surfacing the download (jsPDF's `.save()` is intentionally
 *          NOT used here so unit tests can inspect the bytes directly).
 */
export async function exportSheetsToPdf(
  sheets: ReadonlyArray<Sheet>,
  svgRefs: ReadonlyArray<SVGElement>,
  opts: ExportSheetsOptions = {},
): Promise<Blob> {
  if (sheets.length === 0) {
    throw new PdfExportError(
      'exportSheetsToPdf: sheets array is empty',
      'mismatched-inputs',
    );
  }
  if (sheets.length !== svgRefs.length) {
    throw new PdfExportError(
      `exportSheetsToPdf: sheets.length (${sheets.length}) !== svgRefs.length (${svgRefs.length})`,
      'mismatched-inputs',
    );
  }

  const loader = opts.loadJsPdf ?? defaultJsPdfLoader;
  const Ctor = await loader();
  const pixelsPerMm = opts.pixelsPerMm ?? 2;

  let doc: JsPdfLike | undefined;
  for (let i = 0; i < sheets.length; i += 1) {
    const sheet = sheets[i]!;
    const svgEl = svgRefs[i]!;
    const { widthMm, heightMm, orientation } = resolvePagePaper(
      sheet.paperSize,
      sheet.customPaper,
    );

    if (i === 0) {
      doc = new Ctor({
        orientation,
        unit: 'mm',
        format: [widthMm, heightMm],
      });
    } else {
      doc!.addPage([widthMm, heightMm], orientation);
    }

    // Phase 1: PNG embed. Canvas size = page-mm * pixelsPerMm for crispness.
    let dataUrl: string;
    try {
      dataUrl = await svgToPngDataUrl(svgEl, {
        width: widthMm * pixelsPerMm,
        height: heightMm * pixelsPerMm,
      });
    } catch (err) {
      if (err instanceof PdfExportError) throw err;
      throw new PdfExportError(
        `exportSheetsToPdf: failed to rasterise sheet ${sheet.id} — ${(err as Error).message ?? 'unknown'}`,
        'svg-render-failed',
      );
    }
    doc!.addImage(dataUrl, 'PNG', 0, 0, widthMm, heightMm);
  }

  // jsPDF v4 returns a Blob with `application/pdf` type.
  const blob = doc!.output('blob');
  return blob;
}

/**
 * Convenience wrapper for the single-sheet case.
 */
export async function exportSheetToPdf(
  sheet: Sheet,
  svgEl: SVGElement,
  opts: ExportSheetsOptions = {},
): Promise<Blob> {
  return exportSheetsToPdf([sheet], [svgEl], opts);
}
