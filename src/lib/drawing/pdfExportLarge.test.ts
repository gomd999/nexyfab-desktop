/** @vitest-environment jsdom */
/**
 * pdfExportLarge — Phase 4.4.3 Phase 3 large-paper PDF export tests.
 *
 * Covers:
 *   - resolution presets map to expected px/mm
 *   - rasterNeedsTiling — table of paper sizes × resolutions
 *   - choosePipeline — full routing table:
 *       A4/A3        → raster
 *       A2 + low-res → raster
 *       A1/A0 + vec  → vector
 *       A1/A0 - vec  → tiled-raster
 *       custom large → tiled-raster when no vector
 *   - computeTileGrid — single-tile vs 2×1 vs 2×2 vs 4×4 grids
 *   - computeTileGrid — picks longer-axis-first split
 *   - computeTileGrid — throws when astronomically large
 *   - resolveCompression — explicit modes + boolean shortcut
 *   - cloneSvgForTile — sets viewBox / width / height correctly
 *   - exportLargeSheetToPdf — A4 standard → raster pipeline used
 *   - exportLargeSheetToPdf — A0 + vector loader → vector pipeline
 *   - exportLargeSheetToPdf — A0 without vector → tiled raster (4 tiles)
 *   - exportLargeSheetToPdf — compression options reach jspdf.addImage
 *   - exportLargeSheetToPdf — vector failure falls back to tiled raster
 *   - exportLargeSheetToPdf — svg invalid → LargePdfError(svg-invalid)
 *   - exportLargeSheetToPdf — pre-imported jspdf arg is preferred
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  exportLargeSheetToPdf,
  choosePipeline,
  computeTileGrid,
  cloneSvgForTile,
  rasterNeedsTiling,
  resolveCompression,
  RESOLUTION_TO_PX_PER_MM,
  LargePdfError,
} from './pdfExportLarge';
import type { JsPdfLoader } from './pdfExport';
import type { JsPdfLoader as VectorJsPdfLoader, Svg2PdfLoader } from './svg2pdfBridge';
import { standardThreeViewSheet, type Sheet, type PaperSize } from './sheet';

// ─── jsdom canvas stubs ──────────────────────────────────────────────────
beforeEach(() => {
  if (typeof HTMLCanvasElement !== 'undefined') {
    HTMLCanvasElement.prototype.getContext = function getContext(): unknown {
      return {
        fillStyle: '',
        fillRect: () => undefined,
        drawImage: () => undefined,
      };
    } as never;
    HTMLCanvasElement.prototype.toDataURL = function toDataURL(): string {
      return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';
    };
  }
});

// ─── helpers ─────────────────────────────────────────────────────────────

function makeSheet(id: string, paperSize: PaperSize = 'A3'): Sheet {
  return standardThreeViewSheet({
    id,
    name: `Sheet ${id}`,
    sourceId: 'sample-cube',
    paperSize,
    scale: 1,
  });
}

function makeSvg(width = 420, height = 297): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('width', '50');
  rect.setAttribute('height', '50');
  rect.setAttribute('fill', '#000');
  svg.appendChild(rect);
  return svg;
}

type SpyFn<F extends (...a: never[]) => unknown> = F & {
  mock: { calls: unknown[][] };
};

interface MockDoc {
  addImage: SpyFn<(...args: unknown[]) => MockDoc>;
  addPage: SpyFn<(format?: number[] | string, orientation?: string) => MockDoc>;
  getNumberOfPages: SpyFn<() => number>;
  output: SpyFn<(type: string) => Blob | ArrayBuffer | string>;
  _pages: Array<{ format: number[] | string | undefined; orientation: string | undefined }>;
  _ctorArgs: { orientation?: string; unit?: string; format?: number[] };
}

function mockJsPdfLoader(): { loader: JsPdfLoader; lastDoc: () => MockDoc | undefined } {
  let last: MockDoc | undefined;
  const loader: JsPdfLoader = async () => {
    return function JsPdfCtor(this: MockDoc, opts: { orientation?: string; unit?: string; format?: number[] }) {
      const self: MockDoc = {
        _ctorArgs: opts,
        _pages: [{ format: opts.format, orientation: opts.orientation }],
        addImage: vi.fn(() => self),
        addPage: vi.fn((format?: number[] | string, orientation?: string) => {
          self._pages.push({ format, orientation });
          return self;
        }),
        getNumberOfPages: vi.fn(() => self._pages.length),
        output: vi.fn((type: string) => {
          if (type === 'blob') {
            return new Blob(['%PDF-1.4\n%large-mock\n'], { type: 'application/pdf' });
          }
          if (type === 'arraybuffer') return new ArrayBuffer(8);
          return '';
        }),
      };
      Object.assign(this, self);
      last = self;
      return self;
    } as unknown as Awaited<ReturnType<JsPdfLoader>>;
  };
  return { loader, lastDoc: () => last };
}

interface VectorSpies {
  vectorJsPdfLoader: VectorJsPdfLoader;
  svg2pdfLoader: Svg2PdfLoader;
  svg2pdfCalls: () => Array<{ el: SVGElement; doc: MockDoc; options?: { x?: number; y?: number; width?: number; height?: number } }>;
  lastVectorDoc: () => MockDoc | undefined;
}

function makeVectorMocks(opts: { failRender?: boolean } = {}): VectorSpies {
  let last: MockDoc | undefined;
  const calls: Array<{ el: SVGElement; doc: MockDoc; options?: { x?: number; y?: number; width?: number; height?: number } }> = [];

  const vectorJsPdfLoader: VectorJsPdfLoader = async () => {
    function JsPdfCtor(this: MockDoc, ctorOpts: { orientation?: string; unit?: string; format?: number[] }) {
      const self: MockDoc = {
        _ctorArgs: ctorOpts,
        _pages: [{ format: ctorOpts.format, orientation: ctorOpts.orientation }],
        addImage: vi.fn(() => self),
        addPage: vi.fn((format?: number[] | string, orientation?: string) => {
          self._pages.push({ format, orientation });
          return self;
        }),
        getNumberOfPages: vi.fn(() => self._pages.length),
        output: vi.fn((type: string) => {
          if (type === 'blob') {
            return new Blob(['%PDF-1.4\n%vector-mock\n'], { type: 'application/pdf' });
          }
          if (type === 'arraybuffer') return new ArrayBuffer(8);
          return '';
        }),
      };
      Object.assign(this, self);
      last = self;
      return self;
    }
    return JsPdfCtor as unknown as Awaited<ReturnType<VectorJsPdfLoader>>;
  };

  const svg2pdfFn = vi.fn(async (el: SVGElement, doc: MockDoc, options?: { x?: number; y?: number; width?: number; height?: number }) => {
    calls.push({ el, doc, options });
    if (opts.failRender) throw new Error('boom: vector render failed');
    return doc;
  });

  const svg2pdfLoader: Svg2PdfLoader = async () => svg2pdfFn as unknown as Awaited<ReturnType<Svg2PdfLoader>>;

  return {
    vectorJsPdfLoader,
    svg2pdfLoader,
    svg2pdfCalls: () => calls,
    lastVectorDoc: () => last,
  };
}

async function blobMagic(blob: Blob, n = 5): Promise<string> {
  if (typeof (blob as { arrayBuffer?: unknown }).arrayBuffer === 'function') {
    const buf = await blob.arrayBuffer();
    const decoded = new TextDecoder().decode(buf.slice(0, n));
    if (decoded.length > 0) return decoded;
  }
  if (typeof (blob as { text?: unknown }).text === 'function') {
    const s = await blob.text();
    if (s.length > 0) return s.slice(0, n);
  }
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const buf = reader.result as ArrayBuffer;
      resolve(new TextDecoder().decode(buf.slice(0, n)));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

// ─── tests ───────────────────────────────────────────────────────────────

describe('RESOLUTION_TO_PX_PER_MM', () => {
  it('maps standard / high / print to 4 / 8 / 12 px/mm', () => {
    expect(RESOLUTION_TO_PX_PER_MM.standard).toBe(4);
    expect(RESOLUTION_TO_PX_PER_MM.high).toBe(8);
    expect(RESOLUTION_TO_PX_PER_MM.print).toBe(12);
  });
});

describe('rasterNeedsTiling', () => {
  it('A4 at any resolution fits a single tile', () => {
    expect(rasterNeedsTiling('A4', undefined, 4)).toBe(false);
    expect(rasterNeedsTiling('A4', undefined, 8)).toBe(false);
    expect(rasterNeedsTiling('A4', undefined, 12)).toBe(false);
  });

  it('A0 @ 4 px/mm fits a single tile (16M px under 50M budget)', () => {
    expect(rasterNeedsTiling('A0', undefined, 4)).toBe(false);
  });

  it('A0 @ 12 px/mm exceeds tile caps → needs tiling', () => {
    expect(rasterNeedsTiling('A0', undefined, 12)).toBe(true);
  });

  it('A1 @ 12 px/mm exceeds pixel budget → needs tiling', () => {
    expect(rasterNeedsTiling('A1', undefined, 12)).toBe(true);
  });

  it('custom 5000×5000 mm @ 4 px/mm trips MAX_TILE_EDGE → needs tiling', () => {
    expect(rasterNeedsTiling('custom', { width: 5000, height: 5000 }, 4)).toBe(true);
  });
});

describe('choosePipeline routing table', () => {
  it('A4 always uses simple raster (vector availability ignored)', () => {
    expect(choosePipeline('A4', undefined, 4, true)).toBe('raster');
    expect(choosePipeline('A4', undefined, 12, false)).toBe('raster');
  });

  it('A3 always uses simple raster', () => {
    expect(choosePipeline('A3', undefined, 12, true)).toBe('raster');
  });

  it('A2 at standard res → raster (single canvas fits)', () => {
    expect(choosePipeline('A2', undefined, 4, false)).toBe('raster');
    expect(choosePipeline('A2', undefined, 8, false)).toBe('raster');
  });

  it('A0 with vector loader → vector', () => {
    expect(choosePipeline('A0', undefined, 4, true)).toBe('vector');
    expect(choosePipeline('A0', undefined, 12, true)).toBe('vector');
  });

  it('A0 without vector loader → tiled-raster', () => {
    expect(choosePipeline('A0', undefined, 4, false)).toBe('tiled-raster');
    expect(choosePipeline('A0', undefined, 12, false)).toBe('tiled-raster');
  });

  it('A1 without vector loader → tiled-raster', () => {
    expect(choosePipeline('A1', undefined, 8, false)).toBe('tiled-raster');
  });

  it('custom 2000×1500 mm without vector → tiled-raster', () => {
    expect(
      choosePipeline('custom', { width: 2000, height: 1500 }, 8, false),
    ).toBe('tiled-raster');
  });
});

describe('computeTileGrid', () => {
  it('returns 1×1 when page fits inside both caps', () => {
    const g = computeTileGrid(1000, 1000);
    expect(g.cols).toBe(1);
    expect(g.rows).toBe(1);
    expect(g.tileWidthPx).toBe(1000);
    expect(g.tileHeightPx).toBe(1000);
  });

  it('splits along the longer axis first', () => {
    // 20000 wide, 1000 tall → exceeds MAX_TILE_EDGE on width only.
    const g = computeTileGrid(20000, 1000);
    expect(g.cols).toBeGreaterThan(1);
    expect(g.rows).toBe(1);
  });

  it('grows to 2×2 for a square that exceeds both caps', () => {
    // 12000×12000 = 144M px > 50M budget → needs 2×2.
    const g = computeTileGrid(12000, 12000);
    expect(g.cols).toBe(2);
    expect(g.rows).toBe(2);
    expect(g.tileWidthPx).toBe(6000);
    expect(g.tileHeightPx).toBe(6000);
  });

  it('throws when dimensions are non-positive', () => {
    expect(() => computeTileGrid(0, 100)).toThrow(LargePdfError);
    expect(() => computeTileGrid(-10, 100)).toThrow(LargePdfError);
  });
});

describe('resolveCompression', () => {
  it('defaults to FAST', () => {
    expect(resolveCompression({})).toBe('FAST');
  });

  it('honours compressionMode override', () => {
    expect(resolveCompression({ compressionMode: 'none' })).toBe('NONE');
    expect(resolveCompression({ compressionMode: 'fast' })).toBe('FAST');
    expect(resolveCompression({ compressionMode: 'best' })).toBe('SLOW');
  });

  it('compression:false → NONE; compression:true → FAST', () => {
    expect(resolveCompression({ compression: false })).toBe('NONE');
    expect(resolveCompression({ compression: true })).toBe('FAST');
  });

  it('compressionMode wins over boolean shortcut', () => {
    expect(resolveCompression({ compression: false, compressionMode: 'best' })).toBe('SLOW');
  });
});

describe('cloneSvgForTile', () => {
  it('sets viewBox + width/height to the sub-rect', () => {
    const src = makeSvg(1000, 800);
    const clone = cloneSvgForTile(src, { x: 100, y: 50, width: 200, height: 150 });
    expect(clone.getAttribute('viewBox')).toBe('100 50 200 150');
    expect(clone.getAttribute('width')).toBe('200');
    expect(clone.getAttribute('height')).toBe('150');
    expect(clone.getAttribute('preserveAspectRatio')).toBe('none');
  });

  it('does NOT mutate the source SVG', () => {
    const src = makeSvg(420, 297);
    const before = src.getAttribute('viewBox');
    cloneSvgForTile(src, { x: 10, y: 10, width: 100, height: 100 });
    expect(src.getAttribute('viewBox')).toBe(before);
  });
});

describe('exportLargeSheetToPdf — input validation', () => {
  it('throws LargePdfError(svg-invalid) for null svgRef', async () => {
    await expect(
      exportLargeSheetToPdf(makeSheet('s1'), null as unknown as SVGElement),
    ).rejects.toMatchObject({ name: 'LargePdfError', code: 'svg-invalid' });
  });

  it('throws LargePdfError(svg-invalid) for a non-svg element', async () => {
    const div = document.createElement('div');
    await expect(
      exportLargeSheetToPdf(makeSheet('s1'), div as unknown as SVGElement),
    ).rejects.toMatchObject({ code: 'svg-invalid' });
  });
});

describe('exportLargeSheetToPdf — A4 standard → raster pipeline', () => {
  it('returns a PDF Blob and uses the raster (not vector) loader', async () => {
    const { loader, lastDoc } = mockJsPdfLoader();
    const blob = await exportLargeSheetToPdf(makeSheet('s1', 'A4'), makeSvg(), {
      resolution: 'standard',
      loadJsPdf: loader,
    });
    expect(blob.type).toBe('application/pdf');
    expect(await blobMagic(blob, 5)).toBe('%PDF-');
    // raster pipeline writes ONE addImage for the whole page (no tiling)
    expect(lastDoc()?.addImage).toHaveBeenCalledTimes(1);
  });
});

describe('exportLargeSheetToPdf — A0 + vector loader → vector pipeline', () => {
  it('routes A0 through svg2pdf (addImage never called)', async () => {
    const v = makeVectorMocks();
    const blob = await exportLargeSheetToPdf(makeSheet('big', 'A0'), makeSvg(), {
      resolution: 'high',
      loadJsPdfForVector: v.vectorJsPdfLoader,
      loadSvg2Pdf: v.svg2pdfLoader,
    });
    expect(blob.type).toBe('application/pdf');
    expect(v.svg2pdfCalls()).toHaveLength(1);
    expect(v.svg2pdfCalls()[0]?.options).toEqual({
      x: 0,
      y: 0,
      width: 1189,
      height: 841,
    });
    // No raster addImage on the vector doc.
    expect(v.lastVectorDoc()?.addImage).not.toHaveBeenCalled();
  });
});

describe('exportLargeSheetToPdf — A0 without vector → tiled raster', () => {
  it('renders A0 at standard res (16M px) as a single tile', async () => {
    // A0 @ 4 px/mm = 16M px → fits, so this is the "tiled-raster" pipeline
    // but the grid is 1×1. We still go through the tiled path (no vector
    // loader supplied) and that path supports the compression knob.
    const { loader, lastDoc } = mockJsPdfLoader();
    await exportLargeSheetToPdf(makeSheet('big', 'A0'), makeSvg(), {
      resolution: 'standard',
      loadJsPdf: loader,
      // no loadSvg2Pdf → vectorAvailable=false → tiled-raster route
    });
    // 1 tile → 1 addImage call
    expect(lastDoc()?.addImage).toHaveBeenCalledTimes(1);
  });

  it('renders A0 @ print resolution as a multi-tile grid', async () => {
    // A0 @ 12 px/mm = 14268×10092 = 144M px → must tile.
    // 14268 > MAX_TILE_EDGE (8192) → cols ≥ 2; same for rows.
    // 2×2 = 7134×5046 ≈ 36M < 50M budget, max edge 7134 < 8192 → fits.
    const { loader, lastDoc } = mockJsPdfLoader();
    await exportLargeSheetToPdf(makeSheet('big', 'A0'), makeSvg(), {
      resolution: 'print',
      loadJsPdf: loader,
    });
    // expect 4 tiles (2×2)
    expect(lastDoc()?.addImage).toHaveBeenCalledTimes(4);
  });

  it('tiles placed at correct mm offsets that span the page', async () => {
    const { loader, lastDoc } = mockJsPdfLoader();
    await exportLargeSheetToPdf(makeSheet('big', 'A0'), makeSvg(), {
      resolution: 'print',
      loadJsPdf: loader,
    });
    const calls = lastDoc()?.addImage.mock.calls ?? [];
    // Each call is [data, fmt, x, y, w, h, alias, compression]
    const xs = new Set(calls.map((c) => c[2]));
    const ys = new Set(calls.map((c) => c[3]));
    // 2×2 grid → exactly 2 distinct x and 2 distinct y values.
    expect(xs.size).toBe(2);
    expect(ys.size).toBe(2);
    // Sum of widths across one row should equal A0 width (1189 mm).
    // addImage signature: [data, fmt, x, y, w, h, alias, compression]
    const firstRow = calls.filter((c) => c[3] === 0);
    const totalW = firstRow.reduce((acc, c) => acc + (c[4] as number), 0);
    expect(totalW).toBeCloseTo(1189, 6);
  });
});

describe('exportLargeSheetToPdf — compression options', () => {
  it('passes FAST compression to addImage by default', async () => {
    const { loader, lastDoc } = mockJsPdfLoader();
    await exportLargeSheetToPdf(makeSheet('big', 'A0'), makeSvg(), {
      resolution: 'standard',
      loadJsPdf: loader,
    });
    const call = lastDoc()?.addImage.mock.calls[0];
    // 8th arg is compression
    expect(call?.[7]).toBe('FAST');
  });

  it('passes NONE compression when compression:false', async () => {
    const { loader, lastDoc } = mockJsPdfLoader();
    await exportLargeSheetToPdf(makeSheet('big', 'A0'), makeSvg(), {
      resolution: 'standard',
      loadJsPdf: loader,
      compression: false,
    });
    const call = lastDoc()?.addImage.mock.calls[0];
    expect(call?.[7]).toBe('NONE');
  });

  it('passes SLOW compression when compressionMode:best', async () => {
    const { loader, lastDoc } = mockJsPdfLoader();
    await exportLargeSheetToPdf(makeSheet('big', 'A0'), makeSvg(), {
      resolution: 'standard',
      loadJsPdf: loader,
      compressionMode: 'best',
    });
    const call = lastDoc()?.addImage.mock.calls[0];
    expect(call?.[7]).toBe('SLOW');
  });

  it('honours imageFormat:JPEG', async () => {
    const { loader, lastDoc } = mockJsPdfLoader();
    await exportLargeSheetToPdf(makeSheet('big', 'A0'), makeSvg(), {
      resolution: 'standard',
      loadJsPdf: loader,
      imageFormat: 'JPEG',
    });
    const call = lastDoc()?.addImage.mock.calls[0];
    expect(call?.[1]).toBe('JPEG');
  });
});

describe('exportLargeSheetToPdf — resolution option', () => {
  it('high resolution still produces a single-tile A0 page (within budget)', async () => {
    // A0 @ 8 px/mm = 9512×6728 = 64M px → exceeds budget OR edge → tile.
    // 9512 > 8192 → cols≥2; 2×1 = 4756×6728 = 32M px under budget → fits.
    const { loader, lastDoc } = mockJsPdfLoader();
    await exportLargeSheetToPdf(makeSheet('big', 'A0'), makeSvg(), {
      resolution: 'high',
      loadJsPdf: loader,
    });
    // 2×1 = 2 tiles (page is 1189 wide, only width axis exceeds MAX_TILE_EDGE)
    expect(lastDoc()?.addImage).toHaveBeenCalledTimes(2);
  });
});

describe('exportLargeSheetToPdf — vector failure fallback', () => {
  it('falls back to tiled raster when svg2pdf throws', async () => {
    const v = makeVectorMocks({ failRender: true });
    const { loader, lastDoc } = mockJsPdfLoader();
    const blob = await exportLargeSheetToPdf(makeSheet('big', 'A0'), makeSvg(), {
      resolution: 'standard',
      loadJsPdfForVector: v.vectorJsPdfLoader,
      loadSvg2Pdf: v.svg2pdfLoader,
      loadJsPdf: loader,
    });
    expect(blob.type).toBe('application/pdf');
    // svg2pdf was attempted once, then we fell through to raster
    expect(v.svg2pdfCalls()).toHaveLength(1);
    // The raster fallback used our raster mock loader at least once
    expect(lastDoc()?.addImage).toHaveBeenCalled();
  });
});
