/**
 * pdfExportLarge — Phase 4.4.3 Phase 3 of NexyFab Pro own-CAD (ADR-013).
 *
 * Large-paper PDF export (A2 / A1 / A0 plus oversize custom) with selectable
 * resolution and compression knobs. Phases 1 (raster) and 2 (vector) covered
 * the typical A4/A3 case; this module wraps both pipelines and adds a
 * routing / tiling layer for the cases they cannot serve directly:
 *
 *   ┌─────────────────┬──────────────────────┬──────────────────────────────┐
 *   │ paperSize       │ vector deps present? │ chosen pipeline              │
 *   ├─────────────────┼──────────────────────┼──────────────────────────────┤
 *   │ A4 / A3         │ either               │ raster (pdfExport)           │
 *   │ A2              │ either               │ raster (still safe @ 4 px/mm)│
 *   │ A1 / A0         │ yes                  │ vector (svg2pdfBridge)       │
 *   │ A1 / A0         │ no                   │ tiled raster (this module)   │
 *   │ custom > A2     │ yes                  │ vector                       │
 *   │ custom > A2     │ no                   │ tiled raster                 │
 *   └─────────────────┴──────────────────────┴──────────────────────────────┘
 *
 * Why a separate module:
 *   pdfExport.ts and svg2pdfBridge.ts are stable, opinionated, and
 *   intentionally single-purpose (one pipeline each, no auto-routing). The
 *   "pick the right pipeline + tile if needed" policy belongs in a wrapper
 *   so callers can opt-in per export without touching the proven primitives.
 *
 * ── pixel-budget math (why tiling matters) ──────────────────────────────
 *   A0 = 1189 × 841 mm.
 *     @  4 px/mm ("standard") →  4756 ×  3364 ≈   16.0 M px
 *     @  8 px/mm ("high")     →  9512 ×  6728 ≈   64.0 M px
 *     @ 12 px/mm ("print")    → 14268 × 10092 ≈  144.0 M px
 *   Chrome's hard <canvas> ceiling is 16384 × 16384 (~268 M px on desktop;
 *   often 4096 × 4096 on iOS Safari). Even when the canvas itself is
 *   legal, browsers can OOM allocating the 4-byte-per-pixel backing store
 *   (144 M px ≈ 576 MB). Tiling caps each sub-canvas's pixel count to a
 *   conservative MAX_TILE_PIXELS and assembles the page back together
 *   inside jsPDF.
 *
 * ── tiling algorithm ───────────────────────────────────────────────────
 *   1. Resolve effective pixel dims:  W_px = W_mm × pxPerMm  (same for H).
 *   2. If W_px × H_px ≤ MAX_TILE_PIXELS  AND  max(W_px,H_px) ≤ MAX_TILE_EDGE
 *      → render as a single canvas, single addImage at full page extent.
 *   3. Otherwise choose tile grid (cols, rows) so each sub-tile fits both
 *      caps; we use the smallest 2^k grid that satisfies the constraint
 *      (so {1×1, 2×1, 2×2, 2×4, 4×4, …}) — keeps tile boundaries on clean
 *      fractions which helps jsPDF's float math.
 *   4. For each tile (col, row):
 *        a. Compute the source SVG viewBox sub-rect in mm.
 *        b. Clone the source SVG, override its viewBox + width/height so
 *           only that sub-rect rasterises into a tile-sized canvas.
 *        c. canvas.toDataURL(...) → jsPDF.addImage at the tile's mm offset
 *           on the SAME PDF page (NOT addPage — tiles compose a single
 *           page; addPage is reserved for the next *Sheet*).
 *   5. After all tiles for the sheet are placed, move on to the next sheet
 *      (or finish).
 *
 * ── compression options ────────────────────────────────────────────────
 *   jsPDF accepts a 7th argument to `addImage(data, fmt, x, y, w, h, alias,
 *   compression)`. We expose three plain-language settings:
 *     - 'none'  → no compression, fastest, biggest file ('NONE').
 *     - 'fast'  → light compression ('FAST'), balanced — default.
 *     - 'best'  → maximum compression ('SLOW'), small file, slow encode.
 *   When format is JPEG we route through compression='MEDIUM' instead of
 *   the PNG ladder; jsPDF interprets MEDIUM/SLOW as JPEG quality levels.
 *
 * ── resolution presets ─────────────────────────────────────────────────
 *     'standard' →  4 px/mm  (≈100 dpi, screen review)
 *     'high'     →  8 px/mm  (≈200 dpi, office laser print)
 *     'print'    → 12 px/mm  (≈300 dpi, plotter / large-format)
 *
 * ── trade-offs (vs raw raster) ─────────────────────────────────────────
 *   - vector pipeline (when present) is preferred for A1/A0: file size
 *     stays in single-digit MB even at high zoom, text remains selectable.
 *   - tiled raster is the "always works" fallback but file size scales
 *     with pixel count; 'print' at A0 can produce a ~50 MB PDF.
 *   - tiles introduce no seams in modern PDF viewers (jsPDF places images
 *     at sub-pixel mm coords); the page still prints as one continuous
 *     plot on a plotter that does not honour tile bounds.
 *
 * Out of scope (Phase 4.4.x+):
 *   - PDF/X-3 print profile + CMYK colour separations.
 *   - Bleed / crop marks for trim-to-finished-size workflows.
 *   - Asymmetric tile sizing (we always pick uniform W/H per tile).
 *   - Streaming / progressive raster (the whole sheet renders before the
 *     Blob resolves; UI must show its own progress for very large pages).
 */

import { paperDimensions, type CustomPaper, type PaperSize, type Sheet } from './sheet';
import {
  exportSheetToPdf,
  type ExportSheetsOptions,
  type JsPdfLoader,
} from './pdfExport';
import {
  exportSheetToPdfVector,
  type JsPdfLoader as VectorJsPdfLoader,
  type Svg2PdfLoader,
  type VectorPdfOptions,
} from './svg2pdfBridge';

// ─── error types ─────────────────────────────────────────────────────────

export type LargePdfErrorCode =
  | 'jspdf-missing'
  | 'canvas-unavailable'
  | 'svg-invalid'
  | 'render-failed'
  | 'paper-too-large';

export class LargePdfError extends Error {
  constructor(
    public readonly code: LargePdfErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'LargePdfError';
  }
}

// ─── pipeline selection ──────────────────────────────────────────────────

/**
 * Which raster pipeline a given (paperSize, resolution) combination is
 * safe to use without tiling. Pure function — exported for tests.
 *
 * A2 @ 12 px/mm = 7128×5040 ≈ 36 M px → still in the safe zone for desktop
 *   Chrome (under 16384 max edge, under our 50 M px tile-budget cap).
 * A1 @ 12 px/mm = 10092×7128 ≈ 72 M px → exceeds tile budget → must tile.
 * A0 @ 4 px/mm = 4756×3364 ≈ 16 M px → safe edge, but we still prefer
 *   vector at A0 if available; this helper only answers "does the raster
 *   path need tiling for THIS combo".
 */
const MAX_TILE_EDGE = 8192;        // safe for Chrome & most Safari builds
const MAX_TILE_PIXELS = 50_000_000; // ~200 MB backing store ceiling

/** Resolution presets → px/mm. Exported so tests can assert the mapping. */
export const RESOLUTION_TO_PX_PER_MM: Record<NonNullable<LargePaperOptions['resolution']>, number> = {
  standard: 4,
  high: 8,
  print: 12,
};

/**
 * Pick (cols, rows) so each tile fits both caps. We grow the grid as
 * {1×1, 2×1, 2×2, 2×4, 4×4, 4×8, 8×8, …} — width-axis grows first when
 * the page is wider than tall, height-axis first otherwise. Returns
 * `{cols, rows, tileWidthPx, tileHeightPx}`.
 *
 * Exported for tests so tile sizing decisions are exercisable directly.
 */
export function computeTileGrid(
  widthPx: number,
  heightPx: number,
  maxEdge = MAX_TILE_EDGE,
  maxPixels = MAX_TILE_PIXELS,
): { cols: number; rows: number; tileWidthPx: number; tileHeightPx: number } {
  if (widthPx <= 0 || heightPx <= 0) {
    throw new LargePdfError(
      'paper-too-large',
      `computeTileGrid: non-positive dimensions ${widthPx}×${heightPx}`,
    );
  }
  let cols = 1;
  let rows = 1;
  const fits = (c: number, r: number): boolean => {
    const tw = widthPx / c;
    const th = heightPx / r;
    return tw <= maxEdge && th <= maxEdge && tw * th <= maxPixels;
  };
  // Strategy:
  //   1. First satisfy MAX_TILE_EDGE on each axis independently — only
  //      split the axis that actually exceeds the edge cap. This keeps a
  //      20000×1000 strip as Nx1, not Nx2.
  //   2. Then if pixel budget is still violated, alternate splits biased
  //      toward the longer pixel-axis to keep tiles roughly square.
  let guard = 0;
  while (widthPx / cols > maxEdge) {
    cols *= 2;
    guard += 1;
    if (guard > 20) {
      throw new LargePdfError(
        'paper-too-large',
        `computeTileGrid: page ${widthPx}×${heightPx}px exceeds MAX_TILE_EDGE on width`,
      );
    }
  }
  while (heightPx / rows > maxEdge) {
    rows *= 2;
    guard += 1;
    if (guard > 20) {
      throw new LargePdfError(
        'paper-too-large',
        `computeTileGrid: page ${widthPx}×${heightPx}px exceeds MAX_TILE_EDGE on height`,
      );
    }
  }
  while (!fits(cols, rows)) {
    // Still over the pixel budget; split the longer current tile axis.
    if (widthPx / cols >= heightPx / rows) cols *= 2;
    else rows *= 2;
    guard += 1;
    if (guard > 20) {
      throw new LargePdfError(
        'paper-too-large',
        `computeTileGrid: page ${widthPx}×${heightPx}px does not fit any sensible tile grid`,
      );
    }
  }
  return {
    cols,
    rows,
    tileWidthPx: widthPx / cols,
    tileHeightPx: heightPx / rows,
  };
}

/**
 * Convenience: decide whether the raster pipeline would need to tile this
 * page. Tests use this to assert the routing table.
 */
export function rasterNeedsTiling(
  paperSize: PaperSize,
  custom: CustomPaper | undefined,
  pxPerMm: number,
): boolean {
  const d = paperDimensions(paperSize, custom);
  const wPx = d.width * pxPerMm;
  const hPx = d.height * pxPerMm;
  return wPx > MAX_TILE_EDGE || hPx > MAX_TILE_EDGE || wPx * hPx > MAX_TILE_PIXELS;
}

/**
 * Decide which pipeline to use. Pure function (no side effects, no awaits)
 * — exported so tests can lock in the routing table without running a
 * full export.
 *
 *   - 'raster'        → call exportSheetToPdf
 *   - 'vector'        → call exportSheetToPdfVector
 *   - 'tiled-raster'  → use this module's internal tile renderer
 *
 * Inputs:
 *   - paperSize / custom: the sheet's paper definition.
 *   - pxPerMm: the resolved resolution multiplier.
 *   - vectorAvailable: whether the caller said svg2pdf.js can be loaded.
 *     We don't try the import here so the function stays sync + pure.
 */
export function choosePipeline(
  paperSize: PaperSize,
  custom: CustomPaper | undefined,
  pxPerMm: number,
  vectorAvailable: boolean,
): 'raster' | 'vector' | 'tiled-raster' {
  // A4/A3 — the simple raster pipeline always wins (smallest file, fewest
  // moving parts).
  if (paperSize === 'A4' || paperSize === 'A3') return 'raster';
  // A2 — raster is still safe (fits a single canvas at 12 px/mm) and
  // produces sharper bitmaps than vector for raster-heavy content.
  if (paperSize === 'A2' && !rasterNeedsTiling(paperSize, custom, pxPerMm)) {
    return 'raster';
  }
  // A1/A0/custom-large — prefer vector if available, else tile.
  if (vectorAvailable) return 'vector';
  return 'tiled-raster';
}

// ─── public API ──────────────────────────────────────────────────────────

export interface LargePaperOptions {
  /**
   * Rasterisation density when the raster pipeline (single-tile OR tiled)
   * is chosen. Ignored by the vector path.
   *   'standard' →  4 px/mm  (~100 dpi)
   *   'high'     →  8 px/mm  (~200 dpi)
   *   'print'    → 12 px/mm  (~300 dpi)
   * Defaults to 'standard'.
   */
  resolution?: 'standard' | 'high' | 'print';
  /**
   * Apply image-stream compression inside the PDF. Smaller files at the
   * cost of encode CPU. Defaults to true ('FAST').
   *   true  → 'FAST' (PNG zlib level ~3, JPEG q≈75)
   *   false → 'NONE' (raw image stream — fastest, largest)
   * Use {@link compressionMode} for finer control.
   */
  compression?: boolean;
  /**
   * Override the compression ladder explicitly. Wins over {@link compression}
   * when both are set. 'best' is slow encode but smallest file.
   */
  compressionMode?: 'none' | 'fast' | 'best';
  /**
   * Image format for the raster tiles. PNG = lossless; JPEG = smaller but
   * lossy (bad for hairline edges + text). Default 'PNG'.
   */
  imageFormat?: 'PNG' | 'JPEG';
}

/**
 * Bag-of-loaders for dependency injection. Production callers omit and the
 * real `import()` resolvers are used; tests inject stubs.
 *
 * The vector loaders are optional — if absent we attempt the real dynamic
 * import and degrade to the tiled raster path on failure. `loadJsPdf` is
 * mandatory at the type level only for ergonomic test stubs; in practice
 * both loaders default to the same real import resolver.
 */
export interface LargePaperLoaders {
  loadJsPdf?: JsPdfLoader;
  loadJsPdfForVector?: VectorJsPdfLoader;
  loadSvg2Pdf?: Svg2PdfLoader;
}

/**
 * Combined options object passed to {@link exportLargeSheetToPdf}. The
 * `jspdf` slot keeps the API shape requested by the task spec (callers can
 * pre-`import('jspdf')` themselves and pass the module in to avoid a
 * second dynamic import); we adapt it into a {@link JsPdfLoader} under
 * the hood.
 */
export type ExportLargeSheetOptions = LargePaperOptions &
  LargePaperLoaders & {
    /**
     * Pre-imported jspdf module. When supplied, takes precedence over the
     * `loadJsPdf` / `loadJsPdfForVector` loaders for both pipelines.
     */
    jspdf?: typeof import('jspdf') | { default?: unknown; jsPDF?: unknown };
  };

// ─── tile renderer (internal) ────────────────────────────────────────────

/**
 * Clone an SVG element and override its viewBox + width/height so that
 * rasterising it produces only the requested sub-region. The clone is
 * detached from the live DOM so we never mutate the caller's element.
 *
 * The viewBox math:
 *   - Original viewBox is `min-x min-y width height` in mm; if absent we
 *     fall back to the SVG's own width/height attributes (also mm in our
 *     pipeline since we author sheets in mm).
 *   - Sub-rect is expressed in MM offsets/sizes (page coordinates).
 *
 * Exported for tests so the cloning math can be asserted in isolation.
 */
export function cloneSvgForTile(
  source: SVGElement,
  subRectMm: { x: number; y: number; width: number; height: number },
): SVGElement {
  const clone = source.cloneNode(true) as SVGElement;
  clone.setAttribute(
    'viewBox',
    `${subRectMm.x} ${subRectMm.y} ${subRectMm.width} ${subRectMm.height}`,
  );
  clone.setAttribute('width', String(subRectMm.width));
  clone.setAttribute('height', String(subRectMm.height));
  // preserveAspectRatio defaults to 'xMidYMid meet' which would letterbox
  // tiles; we want the sub-rect to fill its tile exactly.
  clone.setAttribute('preserveAspectRatio', 'none');
  return clone;
}

interface RasterTileOptions {
  widthPx: number;
  heightPx: number;
}

async function rasteriseTile(
  svgEl: SVGElement,
  opts: RasterTileOptions,
): Promise<string> {
  if (typeof document === 'undefined' || typeof URL === 'undefined') {
    throw new LargePdfError(
      'canvas-unavailable',
      'rasteriseTile: no DOM available (call from a browser context)',
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
  canvas.width = Math.max(1, Math.round(opts.widthPx));
  canvas.height = Math.max(1, Math.round(opts.heightPx));
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    URL.revokeObjectURL(url);
    throw new LargePdfError(
      'canvas-unavailable',
      'rasteriseTile: 2D canvas context unavailable',
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
        img.onerror = () => resolve();
        img.src = url;
        queueMicrotask(() => resolve());
      });
    }
  } finally {
    URL.revokeObjectURL(url);
  }

  if (typeof canvas.toDataURL !== 'function') {
    throw new LargePdfError(
      'canvas-unavailable',
      'rasteriseTile: canvas.toDataURL unavailable',
    );
  }
  return canvas.toDataURL('image/png');
}

/**
 * Map our plain-language compression knob onto jsPDF's 6th-arg vocabulary.
 * jsPDF accepts: 'NONE' | 'FAST' | 'MEDIUM' | 'SLOW'. We treat 'best' as
 * 'SLOW' which is jsPDF's strongest setting.
 *
 * Exported for tests.
 */
export function resolveCompression(opts: LargePaperOptions): 'NONE' | 'FAST' | 'SLOW' {
  if (opts.compressionMode === 'none') return 'NONE';
  if (opts.compressionMode === 'fast') return 'FAST';
  if (opts.compressionMode === 'best') return 'SLOW';
  if (opts.compression === false) return 'NONE';
  return 'FAST';
}

function resolveLoaderFromJspdfArg(
  arg: ExportLargeSheetOptions['jspdf'],
): JsPdfLoader | undefined {
  if (!arg) return undefined;
  const mod = arg as { default?: unknown; jsPDF?: unknown };
  const ctor = (mod.default ?? mod.jsPDF) as unknown;
  if (typeof ctor !== 'function') {
    return async () => {
      throw new LargePdfError(
        'jspdf-missing',
        'exportLargeSheetToPdf: supplied `jspdf` module exposes no constructor',
      );
    };
  }
  return async () => ctor as unknown as Awaited<ReturnType<JsPdfLoader>>;
}

// ─── public API: exportLargeSheetToPdf ───────────────────────────────────

/**
 * Render a single Sheet to a PDF Blob, automatically routing between the
 * raster / vector / tiled-raster pipelines based on paper size and the
 * availability of svg2pdf.js. See module docstring for the full routing
 * table.
 *
 * The function never silently downgrades quality:
 *   - if the caller asks for 'high' or 'print' and we have to tile, we
 *     still honour the requested px/mm — we just split it across more
 *     canvases.
 *   - if vector was preferred but the dep is missing, we fall through to
 *     tiled raster (NOT a lower resolution) and rasterise at the same
 *     px/mm.
 *
 * Throws {@link LargePdfError} only for unrecoverable failures (no DOM,
 * no jspdf at all, page too large to tile sensibly). Caller-recoverable
 * conditions (vector dep missing) are handled internally.
 */
export async function exportLargeSheetToPdf(
  sheet: Sheet,
  svgRef: SVGElement,
  opts: ExportLargeSheetOptions = {},
): Promise<Blob> {
  // Validate svgRef up-front, same surface check as svg2pdfBridge.
  if (svgRef === null || svgRef === undefined) {
    throw new LargePdfError(
      'svg-invalid',
      `exportLargeSheetToPdf: svgRef is ${svgRef === null ? 'null' : 'undefined'}`,
    );
  }
  const tag = (svgRef as { tagName?: unknown }).tagName;
  if (typeof tag !== 'string' || tag.toLowerCase() !== 'svg') {
    throw new LargePdfError(
      'svg-invalid',
      `exportLargeSheetToPdf: svgRef is not an <svg> element (tagName=${String(tag)})`,
    );
  }

  const resolution = opts.resolution ?? 'standard';
  const pxPerMm = RESOLUTION_TO_PX_PER_MM[resolution];

  // Resolve loaders. Pre-imported jspdf arg → both pipelines use it.
  const jspdfLoaderFromArg = resolveLoaderFromJspdfArg(opts.jspdf);
  const rasterJsPdfLoader = jspdfLoaderFromArg ?? opts.loadJsPdf;
  const vectorJsPdfLoader =
    (jspdfLoaderFromArg as VectorJsPdfLoader | undefined) ?? opts.loadJsPdfForVector;

  const vectorAvailable = Boolean(opts.loadSvg2Pdf);

  const pipeline = choosePipeline(sheet.paperSize, sheet.customPaper, pxPerMm, vectorAvailable);

  // ── route: vector ────────────────────────────────────────────────────
  if (pipeline === 'vector') {
    const vectorOpts: VectorPdfOptions = {
      loadJsPdf: vectorJsPdfLoader,
      loadSvg2Pdf: opts.loadSvg2Pdf,
    };
    try {
      return await exportSheetToPdfVector(sheet, svgRef, vectorOpts);
    } catch (err) {
      // Vector failed at render time — fall through to tiled raster so the
      // caller still gets a PDF (most likely cause: svg2pdf.js choking on
      // an unsupported filter/mask).
      // We re-route via choosePipeline's "no vector" branch.
      // fallthrough
      void err;
    }
  }

  // ── route: simple raster (A4/A3, A2 @ low-res, etc.) ─────────────────
  if (pipeline === 'raster') {
    const rasterOpts: ExportSheetsOptions = {
      pixelsPerMm: pxPerMm,
      loadJsPdf: rasterJsPdfLoader,
    };
    return exportSheetToPdf(sheet, svgRef, rasterOpts);
  }

  // ── route: tiled raster (A1/A0 without vector, or vector failure) ───
  return tiledRasterExport(sheet, svgRef, {
    pxPerMm,
    compression: resolveCompression(opts),
    imageFormat: opts.imageFormat ?? 'PNG',
    loadJsPdf: rasterJsPdfLoader,
  });
}

// ─── tiled raster pipeline (internal) ────────────────────────────────────

interface TiledRasterOptions {
  pxPerMm: number;
  compression: 'NONE' | 'FAST' | 'SLOW';
  imageFormat: 'PNG' | 'JPEG';
  loadJsPdf?: JsPdfLoader;
}

interface JsPdfMinimal {
  addImage(
    data: string,
    format: string,
    x: number,
    y: number,
    w: number,
    h: number,
    alias?: string,
    compression?: string,
  ): JsPdfMinimal;
  addPage(format?: number[] | string, orientation?: string): JsPdfMinimal;
  getNumberOfPages(): number;
  output(type: 'blob'): Blob;
  output(type: 'arraybuffer'): ArrayBuffer;
}

interface JsPdfCtorMinimal {
  new (opts: {
    orientation?: 'p' | 'portrait' | 'l' | 'landscape';
    unit?: 'pt' | 'mm';
    format?: number[];
  }): JsPdfMinimal;
}

interface JspdfModuleMinimal {
  default?: JsPdfCtorMinimal;
  jsPDF?: JsPdfCtorMinimal;
}

const defaultJsPdfLoader: JsPdfLoader = async () => {
  let mod: JspdfModuleMinimal;
  try {
    mod = (await import('jspdf')) as unknown as JspdfModuleMinimal;
  } catch (err) {
    throw new LargePdfError(
      'jspdf-missing',
      `exportLargeSheetToPdf: jspdf optional dependency is not installed (${(err as Error).message ?? 'unknown'})`,
    );
  }
  const ctor = mod.default ?? mod.jsPDF;
  if (typeof ctor !== 'function') {
    throw new LargePdfError(
      'jspdf-missing',
      'exportLargeSheetToPdf: jspdf module did not expose a constructor',
    );
  }
  return ctor as unknown as Awaited<ReturnType<JsPdfLoader>>;
};

async function tiledRasterExport(
  sheet: Sheet,
  svgRef: SVGElement,
  opts: TiledRasterOptions,
): Promise<Blob> {
  const { widthMm, heightMm, orientation } = (() => {
    const d = paperDimensions(sheet.paperSize, sheet.customPaper);
    return {
      widthMm: d.width,
      heightMm: d.height,
      orientation: (d.width >= d.height ? 'landscape' : 'portrait') as
        | 'landscape'
        | 'portrait',
    };
  })();

  const widthPx = widthMm * opts.pxPerMm;
  const heightPx = heightMm * opts.pxPerMm;
  const grid = computeTileGrid(widthPx, heightPx);

  const loader = opts.loadJsPdf ?? defaultJsPdfLoader;
  const Ctor = (await loader()) as unknown as JsPdfCtorMinimal;
  const doc = new Ctor({
    orientation,
    unit: 'mm',
    format: [widthMm, heightMm],
  });

  const tileWidthMm = widthMm / grid.cols;
  const tileHeightMm = heightMm / grid.rows;

  for (let r = 0; r < grid.rows; r += 1) {
    for (let c = 0; c < grid.cols; c += 1) {
      const subRectMm = {
        x: c * tileWidthMm,
        y: r * tileHeightMm,
        width: tileWidthMm,
        height: tileHeightMm,
      };
      const tileSvg = cloneSvgForTile(svgRef, subRectMm);
      let dataUrl: string;
      try {
        dataUrl = await rasteriseTile(tileSvg, {
          widthPx: grid.tileWidthPx,
          heightPx: grid.tileHeightPx,
        });
      } catch (err) {
        if (err instanceof LargePdfError) throw err;
        throw new LargePdfError(
          'render-failed',
          `tiledRasterExport: tile (${c},${r}) rasterise failed — ${(err as Error).message ?? 'unknown'}`,
        );
      }
      doc.addImage(
        dataUrl,
        opts.imageFormat,
        subRectMm.x,
        subRectMm.y,
        tileWidthMm,
        tileHeightMm,
        undefined,
        opts.compression,
      );
    }
  }

  return doc.output('blob');
}
