/**
 * svg2pdfBridge — Phase 4.4.3 Phase 2 of NexyFab Pro own-CAD (ADR-013).
 *
 * Alternative vector-pipeline PDF export for drawing Sheets, built on top
 * of `svg2pdf.js` instead of the Phase 1 PNG raster path in `pdfExport.ts`.
 *
 * Pipeline:
 *   For each (sheet, svgEl) pair:
 *     1. resolve effective paper dimensions in mm (paperSize / customPaper).
 *     2. on page 1, instantiate `new jsPDF({ unit:'mm', format:[w,h] })`;
 *        on page ≥ 2, `doc.addPage([w,h], orientation)`.
 *     3. `await svg2pdf(svgEl, doc, { x:0, y:0, width:w, height:h })` —
 *        emits true PDF vector primitives (paths, text, glyphs) instead of
 *        an embedded PNG.
 *     4. final `doc.output('blob')` → Blob with `application/pdf`.
 *
 * Phase 1 (pdfExport.ts) vs Phase 2 (this file) — trade-offs:
 *   ┌────────────────────────────────┬───── raster (PNG) ─────┬──── vector ─┐
 *   │ output text                    │ rasterised, not selec. │ selectable  │
 *   │ output sharpness @ zoom        │ blurs                  │ stays sharp │
 *   │ file size (vector-heavy sheet) │ large (full-page PNG)  │ smaller     │
 *   │ file size (raster-heavy)       │ smaller                │ embeds img  │
 *   │ SVG fidelity                   │ pixel-exact            │ partial*    │
 *   │ font requirements              │ none (image)           │ embed fonts │
 *   └────────────────────────────────┴────────────────────────┴─────────────┘
 *   * svg2pdf.js v2 has known gaps for `filter`, `mask`, `clipPath` on
 *     non-trivial paths, `pattern`, and CSS `transform` (vs. attribute
 *     transform). The Phase 1 raster path remains the safe default and
 *     callers can fall back to it on error — this module never silently
 *     downgrades.
 *
 * Optional-dependency model:
 *   Both `svg2pdf.js` and `jspdf` are loaded via `import()` at call time so
 *   the modules stay optional at build/install. If either fails to load,
 *   a tagged {@link VectorPdfError} bubbles up so the UI layer can show
 *   an i18n'd install-prompt message and offer the raster fallback.
 *
 * Korean / CJK font embedding — wishlist (NOT implemented in this Phase 2):
 *   svg2pdf.js renders text using jsPDF's font table; jsPDF v4 ships only
 *   the 14 PDF base fonts (Latin-1). Korean / Japanese / Chinese glyphs
 *   render as missing-glyph rectangles unless a TTF is registered with
 *   `doc.addFileToVFS(...)` + `doc.addFont(...)` BEFORE `svg2pdf()` runs.
 *   Recommended follow-up:
 *     - bundle NotoSansKR-Regular.ttf (or a subset) in /public/fonts/
 *     - load + register via `doc.addFileToVFS('NotoKR.ttf', base64); doc.addFont('NotoKR.ttf','NotoKR','normal')`
 *     - inject a fontFamily attribute on the SVG <text> nodes that contain
 *       CJK text so svg2pdf maps to the registered font name.
 *   Tracked as a Phase 4.4.4 wishlist item; not blocking on Phase 2 vector
 *   export for Latin-1-only sheets (most engineering drawings).
 *
 * Out of scope (Phase 4.x+):
 *   - Mixed raster+vector page (e.g. embedded photo + vector dims).
 *   - PDF/A archival profile + ICC color profile embedding.
 *   - Hyperlink annotations on dimension tags.
 *   - Layer-based PDF (Optional Content Groups) for visibility toggles.
 */

import { paperDimensions, type CustomPaper, type PaperSize, type Sheet } from './sheet';

// ─── error types ─────────────────────────────────────────────────────────

export type VectorPdfErrorCode =
  | 'svg2pdf-missing'
  | 'jspdf-missing'
  | 'svg-invalid'
  | 'mismatched-inputs'
  | 'render-failed';

export class VectorPdfError extends Error {
  constructor(
    public readonly code: VectorPdfErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'VectorPdfError';
  }
}

// ─── minimal jspdf / svg2pdf surface we touch ────────────────────────────

interface JsPdfLike {
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
  default?: JsPdfConstructor;
  jsPDF?: JsPdfConstructor;
}

interface Svg2pdfOptionsLike {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

type Svg2pdfFn = (
  element: SVGElement,
  doc: JsPdfLike,
  options?: Svg2pdfOptionsLike,
) => Promise<JsPdfLike>;

interface Svg2pdfModule {
  svg2pdf?: Svg2pdfFn;
  default?: Svg2pdfFn;
}

// ─── loaders (test-injectable seams) ─────────────────────────────────────

export type JsPdfLoader = () => Promise<JsPdfConstructor>;
export type Svg2PdfLoader = () => Promise<Svg2pdfFn>;

const defaultJsPdfLoader: JsPdfLoader = async () => {
  let mod: JsPdfModule;
  try {
    mod = (await import('jspdf')) as unknown as JsPdfModule;
  } catch (err) {
    throw new VectorPdfError(
      'jspdf-missing',
      `exportSheetsToPdfVector: jspdf optional dependency is not installed (${(err as Error).message ?? 'unknown'})`,
    );
  }
  const ctor = mod.default ?? mod.jsPDF;
  if (typeof ctor !== 'function') {
    throw new VectorPdfError(
      'jspdf-missing',
      'exportSheetsToPdfVector: jspdf module did not expose a constructor',
    );
  }
  return ctor;
};

const defaultSvg2PdfLoader: Svg2PdfLoader = async () => {
  let mod: Svg2pdfModule;
  try {
    mod = (await import('svg2pdf.js')) as unknown as Svg2pdfModule;
  } catch (err) {
    throw new VectorPdfError(
      'svg2pdf-missing',
      `exportSheetsToPdfVector: svg2pdf.js optional dependency is not installed (${(err as Error).message ?? 'unknown'})`,
    );
  }
  const fn = mod.svg2pdf ?? mod.default;
  if (typeof fn !== 'function') {
    throw new VectorPdfError(
      'svg2pdf-missing',
      'exportSheetsToPdfVector: svg2pdf.js module did not expose a callable',
    );
  }
  return fn;
};

// ─── helpers ─────────────────────────────────────────────────────────────

/**
 * Resolve effective paper dimensions in mm + orientation. Mirrors the
 * helper in pdfExport.ts (intentionally duplicated here so this module
 * has zero dependency on pdfExport — they're alternative pipelines).
 */
export function resolveVectorPagePaper(
  size: PaperSize,
  custom?: CustomPaper,
): { widthMm: number; heightMm: number; orientation: 'landscape' | 'portrait' } {
  const d = paperDimensions(size, custom);
  return {
    widthMm: d.width,
    heightMm: d.height,
    orientation: d.width >= d.height ? 'landscape' : 'portrait',
  };
}

/**
 * Surface-level SVG sanity check. Catches the common caller mistakes
 * (passing `null`, `undefined`, an HTML element, a string) BEFORE handing
 * the element to svg2pdf — its own error messages are not user-friendly.
 *
 * Accepts any DOM Element with `tagName === 'svg'` (case-insensitive). In
 * non-DOM environments where SVGElement is unavailable, this also tolerates
 * a structural duck-typed object so node-side tests can exercise the API.
 */
function assertSvgElement(el: unknown, index: number): asserts el is SVGElement {
  if (el === null || el === undefined) {
    throw new VectorPdfError(
      'svg-invalid',
      `exportSheetsToPdfVector: svgRefs[${index}] is ${el === null ? 'null' : 'undefined'}`,
    );
  }
  if (typeof el !== 'object') {
    throw new VectorPdfError(
      'svg-invalid',
      `exportSheetsToPdfVector: svgRefs[${index}] is not an Element (got ${typeof el})`,
    );
  }
  const tag = (el as { tagName?: unknown }).tagName;
  if (typeof tag !== 'string' || tag.toLowerCase() !== 'svg') {
    throw new VectorPdfError(
      'svg-invalid',
      `exportSheetsToPdfVector: svgRefs[${index}] is not an <svg> element (tagName=${String(tag)})`,
    );
  }
}

// ─── public API ──────────────────────────────────────────────────────────

export interface VectorPdfOptions {
  /** Test seam — inject a stub svg2pdf loader. Production callers omit. */
  loadSvg2Pdf?: Svg2PdfLoader;
  /** Test seam — inject a stub jspdf loader. Production callers omit. */
  loadJsPdf?: JsPdfLoader;
}

/**
 * Bundle a list of (sheet, svgEl) pairs into a single multi-page PDF Blob
 * using svg2pdf.js's true-vector pipeline. Each page is sized to its
 * sheet's paperSize so mixed-paper documents work.
 *
 * Throws {@link VectorPdfError} for: missing svg2pdf.js, missing jspdf,
 * invalid SVG element, mismatched array lengths, or downstream render
 * failures. The Phase 1 raster pipeline in `pdfExport.ts` remains the
 * supported fallback; callers should catch and offer it on error.
 *
 * @returns PDF Blob with `type: 'application/pdf'`.
 */
export async function exportSheetsToPdfVector(
  sheets: ReadonlyArray<Sheet>,
  svgRefs: ReadonlyArray<SVGElement>,
  opts: VectorPdfOptions = {},
): Promise<Blob> {
  if (sheets.length === 0) {
    throw new VectorPdfError(
      'mismatched-inputs',
      'exportSheetsToPdfVector: sheets array is empty',
    );
  }
  if (sheets.length !== svgRefs.length) {
    throw new VectorPdfError(
      'mismatched-inputs',
      `exportSheetsToPdfVector: sheets.length (${sheets.length}) !== svgRefs.length (${svgRefs.length})`,
    );
  }
  // Validate every svg ref up-front so we fail fast before any heavy work.
  for (let i = 0; i < svgRefs.length; i += 1) {
    assertSvgElement(svgRefs[i], i);
  }

  // Load both optional deps in parallel — they're independent.
  const jsPdfLoader = opts.loadJsPdf ?? defaultJsPdfLoader;
  const svg2pdfLoader = opts.loadSvg2Pdf ?? defaultSvg2PdfLoader;
  const [Ctor, svg2pdf] = await Promise.all([jsPdfLoader(), svg2pdfLoader()]);

  let doc: JsPdfLike | undefined;
  for (let i = 0; i < sheets.length; i += 1) {
    const sheet = sheets[i]!;
    const svgEl = svgRefs[i]!;
    const { widthMm, heightMm, orientation } = resolveVectorPagePaper(
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

    try {
      await svg2pdf(svgEl, doc!, {
        x: 0,
        y: 0,
        width: widthMm,
        height: heightMm,
      });
    } catch (err) {
      throw new VectorPdfError(
        'render-failed',
        `exportSheetsToPdfVector: svg2pdf failed on sheet ${sheet.id} — ${(err as Error).message ?? 'unknown'}`,
      );
    }
  }

  return doc!.output('blob');
}

/**
 * Convenience wrapper for the single-sheet case (mirrors exportSheetToPdf).
 */
export async function exportSheetToPdfVector(
  sheet: Sheet,
  svgEl: SVGElement,
  opts: VectorPdfOptions = {},
): Promise<Blob> {
  return exportSheetsToPdfVector([sheet], [svgEl], opts);
}
